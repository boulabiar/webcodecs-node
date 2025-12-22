/**
 * NodeAvVideoEncoder - Video encoder using node-av native bindings
 *
 * Implements the VideoEncoderBackend interface for encoding video frames
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Encoder, FilterAPI, HardwareContext } from 'node-av/api';
import { Frame, Rational } from 'node-av/lib';
import {
  AV_PIX_FMT_BGRA,
  AV_PIX_FMT_NV12,
  AV_PIX_FMT_RGBA,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_YUV422P,
  AV_PIX_FMT_YUV444P,
  AV_PIX_FMT_YUVA420P,
  type AVPixelFormat,
  type FFEncoderCodec,
  AV_PKT_FLAG_KEY,
} from 'node-av/constants';

import type {
  VideoEncoderBackend,
  VideoEncoderBackendConfig,
  EncodedFrame,
} from '../backends/types.js';
import {
  DEFAULT_FRAMERATE,
  DEFAULT_VP_BITRATE,
  CRF_DEFAULTS,
} from '../backends/types.js';
import { parseCodecString } from '../hardware/index.js';
import { createLogger } from '../utils/logger.js';
import {
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
} from '../utils/hevc.js';
import {
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
} from '../utils/avc.js';
import { acquireHardwareContext, releaseHardwareContext } from '../utils/hardware-pool.js';
import { getFfmpegQualityOverrides } from '../config/ffmpeg-quality.js';

const logger = createLogger('NodeAvVideoEncoder');

/**
 * Get human-readable name for AVPixelFormat
 */
function pixelFormatName(fmt: AVPixelFormat): string {
  switch (fmt) {
    case AV_PIX_FMT_YUV420P: return 'yuv420p';
    case AV_PIX_FMT_YUVA420P: return 'yuva420p';
    case AV_PIX_FMT_YUV422P: return 'yuv422p';
    case AV_PIX_FMT_YUV444P: return 'yuv444p';
    case AV_PIX_FMT_NV12: return 'nv12';
    case AV_PIX_FMT_RGBA: return 'rgba';
    case AV_PIX_FMT_BGRA: return 'bgra';
    default: return 'unknown';
  }
}

/**
 * Map WebCodecs pixel format string to AVPixelFormat
 */
function mapPixelFormat(format: string): AVPixelFormat {
  const fmt = format.toUpperCase();
  switch (fmt) {
    case 'I420':
    case 'YUV420P':
      return AV_PIX_FMT_YUV420P;
    case 'I420A':
    case 'YUVA420P':
      return AV_PIX_FMT_YUVA420P;
    case 'I422':
    case 'YUV422P':
      return AV_PIX_FMT_YUV422P;
    case 'I444':
    case 'YUV444P':
      return AV_PIX_FMT_YUV444P;
    case 'NV12':
      return AV_PIX_FMT_NV12;
    case 'BGRA':
      return AV_PIX_FMT_BGRA;
    case 'RGBA':
      return AV_PIX_FMT_RGBA;
    default:
      return AV_PIX_FMT_YUV420P;
  }
}

/**
 * Get software encoder name for a codec
 */
function getSoftwareEncoder(codecName: string): string {
  switch (codecName) {
    case 'h264': return 'libx264';
    case 'hevc': return 'libx265';
    case 'vp8': return 'libvpx';
    case 'vp9': return 'libvpx-vp9';
    case 'av1': return 'libsvtav1';
    default: return codecName;
  }
}

/**
 * NodeAV-backed video encoder implementing VideoEncoderBackend interface
 */
export class NodeAvVideoEncoder extends EventEmitter implements VideoEncoderBackend {
  private encoder: Encoder | null = null;
  private hardware: HardwareContext | null = null;
  private filter: FilterAPI | null = null;
  private config: VideoEncoderBackendConfig | null = null;
  private frameIndex = 0;
  private queue: Array<{ buffer?: Buffer; frame?: Frame; owned?: boolean }> = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private inputPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private encoderPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private timeBase: Rational = new Rational(1, DEFAULT_FRAMERATE);
  private codecDescription: Buffer | null = null;
  private isHevcCodec = false;
  private isAvcCodec = false;
  private needsFormatConversion = false;
  private outputFormat: 'annexb' | 'mp4' = 'mp4'; // Default to MP4/AVCC format

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startEncoder(config: VideoEncoderBackendConfig): void {
    this.config = { ...config };
    const framerate = config.framerate ?? DEFAULT_FRAMERATE;
    this.timeBase = new Rational(1, framerate);
    this.inputPixelFormat = mapPixelFormat(config.inputPixelFormat || 'yuv420p');
    this.outputFormat = config.format ?? 'mp4'; // Default to MP4/AVCC format
  }

  write(data: Buffer | Uint8Array): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ buffer: Buffer.from(data), owned: true });
    void this.processQueue();
    return true;
  }

  writeFrame(frame: Frame): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ frame, owned: false });
    void this.processQueue();
    return true;
  }

  end(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void this.finish().catch((err) => this.emit('error', err));
  }

  kill(): void {
    this.shuttingDown = true;
    this.cleanup();
    this.emit('close', null);
  }

  async shutdown(): Promise<void> {
    this.end();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      if (this.processing) return;
      this.processing = true;

      try {
        while (this.queue.length > 0) {
          const item = this.queue.shift()!;
          // Emit frameAccepted when frame starts processing (for dequeue event)
          // Use setImmediate to ensure emit happens after write() returns
          setImmediate(() => this.emit('frameAccepted'));
          if (item.frame) {
            await this.encodeFrame(item.frame, item.owned ?? true);
          } else if (item.buffer) {
            await this.encodeBuffer(item.buffer);
          }
        }
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      } finally {
        this.processing = false;
        this.processingPromise = null;
      }
    })();

    return this.processingPromise;
  }

  private async ensureEncoder(): Promise<void> {
    if (this.encoder || !this.config) {
      return;
    }

    const codecName = parseCodecString(this.config.codec) ?? 'h264';
    this.isHevcCodec = codecName === 'hevc';
    this.isAvcCodec = codecName === 'h264';
    const framerate = this.config.framerate ?? DEFAULT_FRAMERATE;
    const gopSize = Math.max(1, framerate);

    const { encoderCodec, isHardware } = await this.selectEncoderCodec(codecName);
    const options = this.buildEncoderOptions(codecName, framerate, gopSize);

    this.configurePixelFormat(isHardware, options);

    try {
      this.encoder = await Encoder.create(encoderCodec, options);
      logger.info(`Created encoder: ${encoderCodec}`);
    } catch (hwErr) {
      if (isHardware) {
        logger.warn(`Hardware encoder failed, falling back to software: ${(hwErr as Error).message}`);
        releaseHardwareContext(this.hardware);
        this.hardware = null;

        const softwareCodec = getSoftwareEncoder(codecName);
        this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
        options.pixelFormat = AV_PIX_FMT_YUV420P;
        options.hardware = undefined;
        this.encoder = await Encoder.create(softwareCodec as FFEncoderCodec, options);
        logger.info(`Using software encoder: ${softwareCodec}`);
      } else {
        throw hwErr;
      }
    }
  }

  private configurePixelFormat(
    isHardware: boolean,
    options: Record<string, any>
  ): void {
    if (isHardware) {
      this.encoderPixelFormat = AV_PIX_FMT_NV12;
      options.pixelFormat = AV_PIX_FMT_NV12;
    } else {
      this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
      options.pixelFormat = AV_PIX_FMT_YUV420P;
    }

    // Check if format conversion is needed
    this.needsFormatConversion = this.inputPixelFormat !== this.encoderPixelFormat;

    if (this.needsFormatConversion) {
      const targetFormat = this.encoderPixelFormat === AV_PIX_FMT_NV12 ? 'nv12' : 'yuv420p';

      // Try GPU-accelerated filter if hardware context is available
      if (this.hardware) {
        const hwType = this.hardware.deviceTypeName;
        const gpuFilter = this.buildGpuFilterChain(hwType, targetFormat);

        if (gpuFilter) {
          try {
            this.filter = FilterAPI.create(gpuFilter, {
              hardware: this.hardware,
            } as any);
            logger.debug(`Created GPU format conversion filter (${hwType}): ${gpuFilter}`);
            return;
          } catch (err) {
            logger.debug(`GPU filter failed, falling back to CPU: ${(err as Error).message}`);
          }
        }
      }

      // Fallback: CPU SIMD conversion via libswscale
      this.filter = FilterAPI.create(`format=${targetFormat}`);
      logger.debug(`Created CPU format conversion filter: ${pixelFormatName(this.inputPixelFormat)} → ${targetFormat}`);
    }
  }

  /**
   * Build GPU-accelerated filter chain for format conversion
   * Returns null if no GPU filter is available for this hardware type
   */
  private buildGpuFilterChain(hwType: string, targetFormat: string): string | null {
    // GPU filter chains: upload to GPU → convert on GPU → keep on GPU for encoder
    switch (hwType) {
      case 'vaapi':
        return `format=nv12,hwupload,scale_vaapi=format=${targetFormat}`;
      case 'cuda':
        return `format=nv12,hwupload_cuda,scale_cuda=format=${targetFormat}`;
      case 'qsv':
        return `format=nv12,hwupload=extra_hw_frames=64,scale_qsv=format=${targetFormat}`;
      case 'videotoolbox':
        return `format=nv12,hwupload,scale_vt=format=${targetFormat}`;
      default:
        return null;
    }
  }

  private async selectEncoderCodec(codecName: string): Promise<{ encoderCodec: any; isHardware: boolean }> {
    const hwPref = this.config?.hardwareAcceleration;

    // Hardware encoding via HardwareContext requires proper GPU setup (CUDA, QSV with working drivers)
    // VAAPI requires uploading frames to GPU memory which adds complexity
    // For now, only try hardware when explicitly requested and drivers are known to work
    const shouldTryHardware = hwPref === 'prefer-hardware';

    if (shouldTryHardware) {
      try {
        // Use pooled hardware context instead of creating new one
        this.hardware = acquireHardwareContext();
        if (this.hardware) {
          const hwCodec = this.hardware.getEncoderCodec(codecName as any);
          if (hwCodec) {
            logger.info(`Using hardware encoder: ${hwCodec.name ?? hwCodec} (${this.hardware.deviceTypeName})`);
            return { encoderCodec: hwCodec, isHardware: true };
          }
        }
      } catch {
        releaseHardwareContext(this.hardware);
        this.hardware = null;
      }
    }

    const softwareCodec = getSoftwareEncoder(codecName);
    logger.info(`Using software encoder: ${softwareCodec}`);
    return { encoderCodec: softwareCodec as FFEncoderCodec, isHardware: false };
  }

  private buildEncoderOptions(codecName: string, framerate: number, gopSize: number): Record<string, any> {
    const options: Record<string, string | number> = {};
    const isVpCodec = codecName === 'vp8' || codecName === 'vp9';
    const isAv1 = codecName === 'av1';
    const hwType = this.hardware?.deviceTypeName;
    const qualityOverrides = getFfmpegQualityOverrides(codecName);

    // Codec-specific options
    if (isVpCodec) {
      this.configureVpxOptions(options);
    } else if (isAv1) {
      this.configureSvtAv1Options(options);
    } else {
      this.configureX26xOptions(options, hwType);
    }

    // Quality mode
    if (qualityOverrides.crf !== undefined) {
      options.crf = String(qualityOverrides.crf);
    } else if (this.config?.bitrateMode === 'quantizer') {
      const crf = CRF_DEFAULTS[codecName as keyof typeof CRF_DEFAULTS];
      if (crf) {
        options.crf = String(crf);
      }
    }

    // Explicit preset overrides codec defaults when supported
    if (qualityOverrides.preset) {
      options.preset = qualityOverrides.preset;
    }

    // Bitrate (required for VP/AV1)
    let bitrate = this.config?.bitrate;
    if (!bitrate && (isVpCodec || isAv1)) {
      bitrate = DEFAULT_VP_BITRATE;
    }

    return {
      type: 'video' as const,
      width: this.config!.width,
      height: this.config!.height,
      pixelFormat: this.inputPixelFormat,
      timeBase: this.timeBase,
      frameRate: new Rational(framerate, 1),
      bitrate,
      gopSize,
      maxBFrames: this.config?.latencyMode === 'realtime' ? 0 : undefined,
      hardware: this.hardware ?? undefined,
      options,
    };
  }

  private configureVpxOptions(options: Record<string, string | number>): void {
    if (this.config?.latencyMode === 'realtime') {
      options.deadline = 'realtime';
      options['cpu-used'] = '8';
      options['lag-in-frames'] = '0';
    } else {
      options.deadline = 'good';
      options['cpu-used'] = '4';
    }
  }

  private configureSvtAv1Options(options: Record<string, string | number>): void {
    if (this.config?.latencyMode === 'realtime') {
      options.preset = '10';
    } else {
      options.preset = '6';
    }
  }

  private configureX26xOptions(options: Record<string, string | number>, hwType?: string): void {
    if (this.config?.latencyMode === 'realtime') {
      if (hwType === 'qsv') {
        options.preset = 'veryfast';
      } else if (!hwType) {
        options.preset = 'ultrafast';
      }
    } else {
      if (hwType === 'qsv') {
        options.preset = 'medium';
      } else if (!hwType) {
        options.preset = 'medium';
      }
    }
  }

  private async encodeBuffer(buffer: Buffer): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const frame = await this.createFrame(buffer, true);
    frame.pts = BigInt(this.frameIndex);

    await this.encoder.encode(frame);
    frame.unref();

    await this.drainPackets();
    this.frameIndex++;
  }

  private async encodeFrame(inputFrame: Frame, owned: boolean): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const frame = await this.createFrame(inputFrame, owned);
    frame.pts = BigInt(this.frameIndex);

    await this.encoder.encode(frame);
    if (owned || frame !== inputFrame) {
      frame.unref();
    }

    await this.drainPackets();
    this.frameIndex++;
  }

  private async createFrame(source: Buffer | Frame, ownInput: boolean): Promise<Frame> {
    const { width, height } = this.config!;

    const inputFrame = source instanceof Frame
      ? source
      : Frame.fromVideoBuffer(source, {
        width,
        height,
        format: this.inputPixelFormat,
        timeBase: this.timeBase,
      });

    if (!this.needsFormatConversion || !this.filter) {
      return inputFrame;
    }

    try {
      await this.filter.process(inputFrame);
      if (ownInput) {
        inputFrame.unref();
      }

      const convertedFrame = await this.filter.receive();
      if (!convertedFrame) {
        throw new Error('Format conversion failed: no output from filter');
      }

      return convertedFrame;
    } catch (err) {
      // GPU filter failed - fall back to CPU SIMD filter
      logger.warn(`Filter processing failed, falling back to CPU: ${(err as Error).message}`);
      if (ownInput) {
        inputFrame.unref();
      }

      // Close failed filter and create CPU fallback
      this.filter.close();
      const targetFormat = this.encoderPixelFormat === AV_PIX_FMT_NV12 ? 'nv12' : 'yuv420p';
      this.filter = FilterAPI.create(`format=${targetFormat}`);
      logger.debug(`Created CPU fallback filter: format=${targetFormat}`);

      const retryFrame = source instanceof Frame
        ? source
        : Frame.fromVideoBuffer(source, {
          width,
          height,
          format: this.inputPixelFormat,
          timeBase: this.timeBase,
        });

      await this.filter.process(retryFrame);
      if (ownInput || retryFrame !== source) {
        retryFrame.unref();
      }

      const convertedFrame = await this.filter.receive();
      if (!convertedFrame) {
        throw new Error('CPU format conversion failed: no output from filter');
      }

      return convertedFrame;
    }
  }

  private async drainPackets(): Promise<void> {
    if (!this.encoder) return;

    let packet = await this.encoder.receive();
    while (packet) {
      if (packet.data) {
        const timestamp = packet.pts !== undefined ? Number(packet.pts) : this.frameIndex;
        const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || packet.isKeyframe;

        // For H.264/HEVC, extract parameter sets from first keyframe and build description
        // Also convert Annex B (start codes) to length-prefixed format for MP4 compatibility
        let frameData: Buffer = Buffer.from(packet.data);

        // H.264: Extract SPS/PPS and build AVCC description
        if (this.isAvcCodec && keyFrame && !this.codecDescription) {
          try {
            const { sps, pps } = extractAvcParameterSetsFromAnnexB(packet.data);
            if (sps.length > 0 && pps.length > 0) {
              this.codecDescription = Buffer.from(buildAvcDecoderConfig(sps, pps, 4));
              logger.debug(`Built AVCC description: ${this.codecDescription.length} bytes`);
            } else {
              logger.warn('H.264 keyframe missing parameter sets (SPS/PPS)');
            }
          } catch (err) {
            logger.warn(`Failed to extract H.264 parameter sets: ${(err as Error).message}`);
          }
        }

        // HEVC: Extract VPS/SPS/PPS and build HVCC description
        if (this.isHevcCodec && keyFrame && !this.codecDescription) {
          try {
            const { vps, sps, pps } = extractHevcParameterSetsFromAnnexB(packet.data);
            if (vps.length > 0 && sps.length > 0 && pps.length > 0) {
              this.codecDescription = Buffer.from(buildHvccDecoderConfig(vps, sps, pps, 4));
              logger.debug(`Built HVCC description: ${this.codecDescription.length} bytes`);
            } else {
              logger.warn('HEVC keyframe missing parameter sets (VPS/SPS/PPS)');
            }
          } catch (err) {
            logger.warn(`Failed to extract HEVC parameter sets: ${(err as Error).message}`);
          }
        }

        // Convert H.264/HEVC Annex B to length-prefixed format only when format is 'mp4'
        // When format is 'annexb', preserve the raw Annex B output with start codes
        if (this.outputFormat !== 'annexb') {
          if (this.isAvcCodec) {
            frameData = convertAnnexBToAvcc(packet.data, 4);
            logger.debug(`Converted H.264 frame to length-prefixed: ${packet.data.length} -> ${frameData.length} bytes`);
          }

          if (this.isHevcCodec) {
            frameData = convertAnnexBToHvcc(packet.data, 4);
            logger.debug(`Converted HEVC frame to length-prefixed: ${packet.data.length} -> ${frameData.length} bytes`);
          }
        }

        const frame: EncodedFrame = {
          data: frameData,
          timestamp,
          keyFrame,
          description: this.codecDescription ?? undefined,
        };

        logger.debug(`Encoded packet: size=${packet.data.length}, key=${keyFrame}`);
        this.emit('encodedFrame', frame);
      }
      packet.unref();
      packet = await this.encoder.receive();
    }
  }

  private async finish(): Promise<void> {
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
    }

    if (this.encoder) {
      try {
        await this.encoder.flush();
        await this.drainPackets();
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.emit('close', 0);
    this.cleanup();
  }

  private cleanup(): void {
    this.filter?.close();
    this.filter = null;
    this.encoder?.close();
    this.encoder = null;
    // Release hardware context back to pool for reuse
    releaseHardwareContext(this.hardware);
    this.hardware = null;
    this.queue = [];
  }
}

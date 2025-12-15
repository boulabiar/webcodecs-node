/**
 * NodeAvVideoEncoder - Video encoder using node-av native bindings
 *
 * Implements the VideoEncoderBackend interface for encoding video frames
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Encoder, HardwareContext } from 'node-av/api';
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
  convertRgbaToI420,
  convertRgbaToNv12,
  convertNv12ToI420,
  convertI420ToNv12,
} from '../formats/conversions/index.js';
import { calculateFrameSize } from '../ffmpeg/formats.js';
import {
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
} from '../utils/hevc.js';

const logger = createLogger('NodeAvVideoEncoder');

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
  private config: VideoEncoderBackendConfig | null = null;
  private frameIndex = 0;
  private queue: Buffer[] = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private inputPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private encoderPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private timeBase: Rational = new Rational(1, DEFAULT_FRAMERATE);
  private codecDescription: Buffer | null = null;
  private isHevcCodec = false;

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startEncoder(config: VideoEncoderBackendConfig): void {
    this.config = { ...config };
    const framerate = config.framerate ?? DEFAULT_FRAMERATE;
    this.timeBase = new Rational(1, framerate);
    this.inputPixelFormat = mapPixelFormat(config.inputPixelFormat || 'yuv420p');
  }

  write(data: Buffer | Uint8Array): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push(Buffer.from(data));
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
          const data = this.queue.shift()!;
          // Emit frameAccepted when frame starts processing (for dequeue event)
          // Use setImmediate to ensure emit happens after write() returns
          setImmediate(() => this.emit('frameAccepted'));
          await this.encodeBuffer(data);
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
        this.hardware?.dispose();
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
    const isRgba = this.inputPixelFormat === AV_PIX_FMT_RGBA || this.inputPixelFormat === AV_PIX_FMT_BGRA;
    const isNv12Input = this.inputPixelFormat === AV_PIX_FMT_NV12;

    if (isHardware) {
      this.encoderPixelFormat = AV_PIX_FMT_NV12;
      options.pixelFormat = AV_PIX_FMT_NV12;
      if (isRgba) {
        logger.debug('Converting RGBA input to NV12 for hardware encoder');
      } else if (!isNv12Input) {
        logger.debug('Converting input to NV12 for hardware encoder');
      }
    } else {
      this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
      options.pixelFormat = AV_PIX_FMT_YUV420P;
      if (isRgba) {
        logger.debug('Converting RGBA input to I420 for software encoder');
      } else if (isNv12Input) {
        logger.debug('Converting NV12 input to I420 for software encoder');
      }
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
        this.hardware = HardwareContext.auto();
        if (this.hardware) {
          const hwCodec = this.hardware.getEncoderCodec(codecName as any);
          if (hwCodec) {
            logger.info(`Using hardware encoder: ${hwCodec.name ?? hwCodec} (${this.hardware.deviceTypeName})`);
            return { encoderCodec: hwCodec, isHardware: true };
          }
        }
      } catch {
        this.hardware?.dispose();
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

    // Codec-specific options
    if (isVpCodec) {
      this.configureVpxOptions(options);
    } else if (isAv1) {
      this.configureSvtAv1Options(options);
    } else {
      this.configureX26xOptions(options, hwType);
    }

    // Quality mode
    if (this.config?.bitrateMode === 'quantizer') {
      const crf = CRF_DEFAULTS[codecName as keyof typeof CRF_DEFAULTS];
      if (crf) {
        options.crf = String(crf);
      }
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

    const frame = this.createFrame(buffer);
    frame.pts = BigInt(this.frameIndex);

    await this.encoder.encode(frame);
    frame.unref();

    await this.drainPackets();
    this.frameIndex++;
  }

  private createFrame(buffer: Buffer): Frame {
    const { width, height, inputPixelFormat } = this.config!;

    // Convert input format to encoder format if needed
    if (this.inputPixelFormat === AV_PIX_FMT_RGBA || this.inputPixelFormat === AV_PIX_FMT_BGRA) {
      const convertedData = this.encoderPixelFormat === AV_PIX_FMT_NV12
        ? convertRgbaToNv12(buffer, width, height)
        : convertRgbaToI420(buffer, width, height);

      return Frame.fromVideoBuffer(Buffer.from(convertedData), {
        width,
        height,
        format: this.encoderPixelFormat,
        timeBase: this.timeBase,
      });
    }

    if (this.inputPixelFormat === AV_PIX_FMT_NV12 && this.encoderPixelFormat === AV_PIX_FMT_YUV420P) {
      const convertedData = convertNv12ToI420(buffer, width, height);
      return Frame.fromVideoBuffer(Buffer.from(convertedData), {
        width,
        height,
        format: AV_PIX_FMT_YUV420P,
        timeBase: this.timeBase,
      });
    }

    // I420 input to NV12 for hardware encoding
    if (this.inputPixelFormat === AV_PIX_FMT_YUV420P && this.encoderPixelFormat === AV_PIX_FMT_NV12) {
      const convertedData = convertI420ToNv12(buffer, width, height);
      return Frame.fromVideoBuffer(Buffer.from(convertedData), {
        width,
        height,
        format: AV_PIX_FMT_NV12,
        timeBase: this.timeBase,
      });
    }

    // Direct pass-through - validate buffer size first
    const formatName = inputPixelFormat || 'yuv420p';
    const expectedSize = calculateFrameSize(formatName, width, height);
    if (buffer.length < expectedSize) {
      throw new Error(
        `Buffer too small for ${formatName} frame: got ${buffer.length} bytes, expected ${expectedSize} bytes ` +
        `(${width}x${height}). For I420, size should be width*height*1.5 = ${Math.floor(width * height * 1.5)}`
      );
    }

    return Frame.fromVideoBuffer(buffer, {
      width,
      height,
      format: this.inputPixelFormat,
      timeBase: this.timeBase,
    });
  }

  private async drainPackets(): Promise<void> {
    if (!this.encoder) return;

    let packet = await this.encoder.receive();
    while (packet) {
      if (packet.data) {
        const timestamp = packet.pts !== undefined ? Number(packet.pts) : this.frameIndex;
        const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || packet.isKeyframe;

        // For HEVC, extract VPS/SPS/PPS from first keyframe and build HVCC description
        // Also convert Annex B (start codes) to length-prefixed format for MP4 compatibility
        let frameData: Buffer = Buffer.from(packet.data);
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

        // Convert HEVC Annex B to length-prefixed (HVCC) format
        if (this.isHevcCodec) {
          frameData = convertAnnexBToHvcc(packet.data, 4);
          logger.debug(`Converted HEVC frame to length-prefixed: ${packet.data.length} -> ${frameData.length} bytes`);
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
    this.encoder?.close();
    this.encoder = null;
    this.hardware?.dispose();
    this.hardware = null;
    this.queue = [];
  }
}

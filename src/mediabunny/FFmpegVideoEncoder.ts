/**
 * FFmpeg-backed VideoEncoder for Mediabunny
 *
 * Implements Mediabunny's CustomVideoEncoder interface using FFmpeg child process.
 * Supports hardware acceleration via VAAPI, NVENC, QSV, VideoToolbox.
 */

import { spawn, ChildProcess } from 'child_process';
import {
  CustomVideoEncoder,
  VideoSample,
  EncodedPacket,
  VideoCodec,
} from 'mediabunny';
import {
  getBestEncoder,
  parseCodecString,
  HardwareAccelerationMethod,
  VideoCodecName,
} from '../HardwareAcceleration.js';
import {
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
} from '../utils/avc.js';
import {
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
} from '../utils/hevc.js';

// Codec mapping: Mediabunny codec -> FFmpeg encoder (software fallback)
const CODEC_MAP: Record<VideoCodec, string> = {
  avc: 'libx264',
  hevc: 'libx265',
  vp8: 'libvpx',
  vp9: 'libvpx-vp9',
  av1: 'libaom-av1',
};

// Map Mediabunny codec to VideoCodecName
const CODEC_NAME_MAP: Record<VideoCodec, VideoCodecName> = {
  avc: 'h264',
  hevc: 'hevc',
  vp8: 'vp8',
  vp9: 'vp9',
  av1: 'av1',
};

// Container format for each codec
const FORMAT_MAP: Record<VideoCodec, string> = {
  avc: 'h264',
  hevc: 'hevc',
  vp8: 'ivf',
  vp9: 'ivf',
  av1: 'ivf',
};

export class FFmpegVideoEncoder extends CustomVideoEncoder {
  private process: ChildProcess | null = null;
  private accumulatedData: Buffer = Buffer.alloc(0);
  private ivfHeaderParsed = false;
  private frameIndex = 0;
  private resolveFlush: (() => void) | null = null;
  private useIvf = false;
  private useAnnexB = false;
  private codecDescription: Uint8Array | null = null;
  private metadataEmitted = false;
  private usingHardwareAcceleration = false;
  private hwaccelMethod: HardwareAccelerationMethod | null = null;
  private bitstreamFormat: 'annexb' | 'mp4' = 'annexb';

  static supports(codec: VideoCodec, _config: VideoEncoderConfig): boolean {
    return codec in CODEC_MAP;
  }

  async init(): Promise<void> {
    const format = FORMAT_MAP[this.codec];
    this.useIvf = format === 'ivf';
    this.useAnnexB = format === 'h264' || format === 'hevc';
    const configExt = this.config as Record<string, any>;
    if (this.codec === 'avc' && configExt.avc?.format === 'avc') {
      this.bitstreamFormat = 'mp4';
    } else if (this.codec === 'hevc' && configExt.hevc?.format === 'hevc') {
      this.bitstreamFormat = 'mp4';
    } else {
      this.bitstreamFormat = 'annexb';
    }

    // Determine hardware acceleration preference from config
    // Default to software encoding for maximum compatibility
    // Hardware encoding requires specific GPU support and can fail on some systems
    const hwPref = (this.config as any).hardwareAcceleration as
      'prefer-hardware' | 'prefer-software' | 'no-preference' | undefined;

    // Try to get hardware-accelerated encoder only if explicitly requested
    const codecName = CODEC_NAME_MAP[this.codec];
    let ffmpegCodec: string;

    if (hwPref === 'prefer-hardware' && codecName) {
      try {
        const best = await getBestEncoder(codecName, hwPref);
        ffmpegCodec = best.encoder;
        this.usingHardwareAcceleration = best.isHardware;
        this.hwaccelMethod = best.hwaccel;

        if (best.isHardware) {
          console.log(`[FFmpegVideoEncoder] Using hardware encoder: ${ffmpegCodec} (${best.hwaccel})`);
        }
      } catch {
        // Fall back to software
        ffmpegCodec = CODEC_MAP[this.codec];
      }
    } else {
      ffmpegCodec = CODEC_MAP[this.codec];
    }

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
    ];

    // Add hardware acceleration input options
    if (this.hwaccelMethod === 'vaapi') {
      args.push('-vaapi_device', '/dev/dri/renderD128');
    } else if (this.hwaccelMethod === 'cuda' || this.hwaccelMethod === 'nvenc') {
      // NVENC can accept regular input, no special input args needed
    } else if (this.hwaccelMethod === 'qsv') {
      args.push('-hwaccel', 'qsv');
    }

    // Input: raw video from pipe
    args.push(
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${this.config.width}x${this.config.height}`,
      '-r', String(this.config.framerate ?? 30),
      '-i', 'pipe:0',
    );

    // Add video filter for hardware upload if needed
    if (this.hwaccelMethod === 'vaapi') {
      args.push('-vf', 'format=nv12,hwupload');
    }

    // Encoder settings
    args.push('-c:v', ffmpegCodec);

    if (this.config.bitrate) {
      args.push('-b:v', String(this.config.bitrate));
    }

    // Add codec-specific options based on encoder type
    if (ffmpegCodec.includes('nvenc')) {
      // NVENC-specific options
      args.push('-preset', 'p4'); // Balanced preset
      args.push('-rc', 'vbr');
    } else if (ffmpegCodec.includes('qsv')) {
      // QSV-specific options
      args.push('-preset', 'medium');
    } else if (ffmpegCodec.includes('vaapi')) {
      // VAAPI-specific options
      args.push('-rc_mode', 'VBR');
    } else if (ffmpegCodec === 'libx264') {
      // Software x264 options
      // aud=1: Access Unit Delimiters for reliable frame parsing
      // bframes=0: Disable B-frames for immediate output
      // rc-lookahead=0: No lookahead buffering
      args.push('-x264-params', 'aud=1:bframes=0:rc-lookahead=0');
      args.push('-tune', 'zerolatency');
    } else if (ffmpegCodec === 'libx265') {
      args.push('-x265-params', 'aud=1:bframes=0:rc-lookahead=0');
    }

    // Output format
    args.push('-f', format);
    args.push('pipe:1');

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.accumulatedData = Buffer.concat([this.accumulatedData, data]);

      if (this.useIvf) {
        this.parseIvfFrames();
      } else if (this.useAnnexB) {
        this.parseAnnexBFrames();
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('FFmpeg encoder error:', data.toString());
    });

    this.process.on('close', () => {
      // Emit any remaining data
      if (this.useAnnexB && this.accumulatedData.length > 0) {
        this.emitAnnexBFrame(this.accumulatedData);
        this.accumulatedData = Buffer.alloc(0);
      } else if (!this.useIvf && !this.useAnnexB && this.accumulatedData.length > 0) {
        this.emitPacket(this.accumulatedData, this.frameIndex++, true);
        this.accumulatedData = Buffer.alloc(0);
      }

      if (this.resolveFlush) {
        this.resolveFlush();
        this.resolveFlush = null;
      }
    });

    this.process.stdin?.on('error', () => {
      // Ignore EPIPE errors when closing
    });
  }

  async encode(videoSample: VideoSample, _options: { keyFrame?: boolean }): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Encoder not initialized');
    }

    // Get raw RGBA data from VideoSample
    const frameData = await this.getFrameData(videoSample);
    this.process.stdin.write(frameData);
  }

  async flush(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveFlush = resolve;

      if (this.process?.stdin) {
        this.process.stdin.end();
      } else {
        resolve();
      }
    });
  }

  async close(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Extract raw RGBA pixel data from VideoSample
   */
  private async getFrameData(sample: VideoSample): Promise<Buffer> {
    const width = sample.codedWidth;
    const height = sample.codedHeight;
    const size = width * height * 4; // RGBA

    // VideoSample stores data in _data which can be:
    // - VideoFrame (browser)
    // - Uint8Array (raw data)
    // - OffscreenCanvas (canvas fallback)

    const sampleData = (sample as any)._data;

    // If _data is already a Uint8Array, use it directly
    if (sampleData instanceof Uint8Array) {
      return Buffer.from(sampleData);
    }

    // Try to use copyTo if available (works for VideoFrame and VideoSample)
    if (typeof sample.copyTo === 'function') {
      const buffer = new Uint8Array(size);
      await sample.copyTo(buffer);
      return Buffer.from(buffer);
    }

    // If it's a VideoFrame, use its copyTo method
    if (sampleData && typeof sampleData.copyTo === 'function') {
      const buffer = new Uint8Array(size);
      await sampleData.copyTo(buffer);
      return Buffer.from(buffer);
    }

    throw new Error('Cannot extract frame data from VideoSample');
  }

  /**
   * Parse IVF container and emit individual encoded packets
   */
  private parseIvfFrames(): void {
    // Skip 32-byte IVF file header
    if (!this.ivfHeaderParsed) {
      if (this.accumulatedData.length < 32) {
        return;
      }
      const signature = this.accumulatedData.subarray(0, 4).toString();
      if (signature !== 'DKIF') {
        console.error('Invalid IVF signature:', signature);
        return;
      }
      this.accumulatedData = this.accumulatedData.subarray(32);
      this.ivfHeaderParsed = true;
    }

    // Parse frames: 4-byte size + 8-byte timestamp + data
    while (this.accumulatedData.length >= 12) {
      const frameSize = this.accumulatedData.readUInt32LE(0);
      const timestamp = Number(this.accumulatedData.readBigUInt64LE(4));

      const totalFrameSize = 12 + frameSize;
      if (this.accumulatedData.length < totalFrameSize) {
        return;
      }

      const frameData = Buffer.from(this.accumulatedData.subarray(12, totalFrameSize));
      this.accumulatedData = this.accumulatedData.subarray(totalFrameSize);

      const isKeyFrame = this.isKeyFrame(frameData);
      this.emitPacket(frameData, timestamp, isKeyFrame);
    }
  }

  /**
   * Parse H.264/HEVC Annex B bitstream and emit frames
   * Annex B uses start codes (0x00 0x00 0x01 or 0x00 0x00 0x00 0x01) to delimit NAL units.
   * When AUD (Access Unit Delimiter) is enabled, each frame starts with an AUD NAL.
   */
  private parseAnnexBFrames(): void {
    // Find all AUD positions (frame boundaries)
    const audPositions: number[] = [];
    let i = 0;

    while (i < this.accumulatedData.length - 4) {
      // Check for start code
      if (this.accumulatedData[i] === 0 && this.accumulatedData[i + 1] === 0) {
        let startCodeLen = 0;
        let nalStart = 0;

        if (this.accumulatedData[i + 2] === 1) {
          startCodeLen = 3;
          nalStart = i + 3;
        } else if (
          this.accumulatedData[i + 2] === 0 &&
          i + 3 < this.accumulatedData.length &&
          this.accumulatedData[i + 3] === 1
        ) {
          startCodeLen = 4;
          nalStart = i + 4;
        }

        if (startCodeLen > 0 && nalStart < this.accumulatedData.length) {
          const nalType = this.getNalType(this.accumulatedData[nalStart]);
          // AUD = type 9 for H.264, type 35 for HEVC
          const isAud =
            (this.codec === 'avc' && nalType === 9) ||
            (this.codec === 'hevc' && nalType === 35);

          if (isAud) {
            audPositions.push(i);
          }
          i += startCodeLen;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    // Need at least 2 AUDs to have a complete frame
    if (audPositions.length < 2) {
      return;
    }

    // Emit all complete frames (all except the last AUD's frame which is incomplete)
    for (let j = 0; j < audPositions.length - 1; j++) {
      const frameData = this.accumulatedData.subarray(
        audPositions[j],
        audPositions[j + 1]
      );
      this.emitAnnexBFrame(Buffer.from(frameData));
    }

    // Keep the last incomplete frame
    const lastAudPos = audPositions[audPositions.length - 1];
    this.accumulatedData = Buffer.from(this.accumulatedData.subarray(lastAudPos));
  }

  /**
   * Find all Annex B start codes in buffer
   */
  private findStartCodes(buf: Buffer): Array<{ pos: number; len: number }> {
    const codes: Array<{ pos: number; len: number }> = [];
    let i = 0;

    while (i < buf.length - 2) {
      // Check for 0x00 0x00 0x01 (3-byte) or 0x00 0x00 0x00 0x01 (4-byte)
      if (buf[i] === 0 && buf[i + 1] === 0) {
        if (buf[i + 2] === 1) {
          codes.push({ pos: i, len: 3 });
          i += 3;
        } else if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) {
          codes.push({ pos: i, len: 4 });
          i += 4;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return codes;
  }

  /**
   * Get NAL unit type from first byte after start code
   */
  private getNalType(firstByte: number): number {
    if (this.codec === 'avc') {
      // H.264: NAL type is in bits 0-4
      return firstByte & 0x1f;
    } else {
      // HEVC: NAL type is in bits 1-6
      return (firstByte >> 1) & 0x3f;
    }
  }

  /**
   * Check if this NAL unit starts a new Access Unit (frame)
   */
  private isAccessUnitStart(nalType: number, buf: Buffer, nalStart: number): boolean {
    if (this.codec === 'avc') {
      // H.264 NAL types:
      // 1-5: VCL (coded slice)
      // 6: SEI
      // 7: SPS
      // 8: PPS
      // 9: AUD (Access Unit Delimiter)

      // AUD always starts a new AU
      if (nalType === 9) return true;

      // SPS starts a new AU (typically followed by PPS and IDR)
      if (nalType === 7) return true;

      // For VCL NALs (1-5), check first_mb_in_slice
      // If it's 0, it's the first slice of a new frame
      if (nalType >= 1 && nalType <= 5 && nalStart + 1 < buf.length) {
        // first_mb_in_slice is the first value in slice header (exp-golomb coded)
        // If the byte after NAL header has high bit set, first_mb_in_slice could be 0
        // Simplified: check if this looks like start of frame
        const sliceHeader = buf[nalStart + 1];
        // first_mb_in_slice = 0 encodes as 1 (unary), so high bit = 1
        if (sliceHeader & 0x80) return true;
      }
    } else {
      // HEVC NAL types:
      // 0-9, 16-21: VCL
      // 32: VPS
      // 33: SPS
      // 34: PPS
      // 35: AUD

      if (nalType === 35) return true; // AUD
      if (nalType === 32) return true; // VPS
    }

    return false;
  }

  /**
   * Emit a complete Annex B frame
   */
  private emitAnnexBFrame(data: Buffer): void {
    const isKey = this.isH264KeyFrame(data);
    this.emitPacket(data, this.frameIndex, isKey);
  }

  /**
   * Check if H.264/HEVC Annex B frame is a keyframe
   */
  private isH264KeyFrame(data: Buffer): boolean {
    // Find first VCL NAL and check its type
    const startCodes = this.findStartCodes(data);

    for (const sc of startCodes) {
      const nalStart = sc.pos + sc.len;
      if (nalStart >= data.length) continue;

      const nalType = this.getNalType(data[nalStart]);

      if (this.codec === 'avc') {
        // H.264: type 5 = IDR (keyframe)
        if (nalType === 5) return true;
        // type 1 = non-IDR (not keyframe)
        if (nalType === 1) return false;
      } else {
        // HEVC: types 16-21 are IDR/CRA (keyframes)
        if (nalType >= 16 && nalType <= 21) return true;
        // types 0-9 are non-IDR
        if (nalType >= 0 && nalType <= 9) return false;
      }
    }

    // Default to keyframe for first frame
    return this.frameIndex === 0;
  }

  /**
   * Check if VP8/VP9/AV1 frame is a keyframe
   */
  private isKeyFrame(data: Buffer): boolean {
    if (data.length === 0) return false;

    if (this.codec === 'vp9') {
      // VP9: bit 2 of first byte (0 = keyframe)
      return (data[0] & 0x04) === 0;
    } else if (this.codec === 'vp8') {
      // VP8: bit 0 of first byte (0 = keyframe)
      return (data[0] & 0x01) === 0;
    } else if (this.codec === 'av1') {
      // AV1: more complex, assume first frame is key
      return this.frameIndex === 0;
    }

    // For H.264/HEVC, use dedicated method
    if (this.codec === 'avc' || this.codec === 'hevc') {
      return this.isH264KeyFrame(data);
    }

    return this.frameIndex === 0;
  }

  /**
   * Emit an encoded packet via Mediabunny callback
   */
  private emitPacket(data: Buffer, timestamp: number, isKey: boolean): void {
    const framerate = this.config.framerate ?? 30;
    const timestampSeconds = timestamp / framerate;
    const durationSeconds = 1 / framerate;

    let payload = data;
    if (this.useAnnexB && this.bitstreamFormat === 'mp4') {
      payload = this.convertAnnexBFrame(data);
    }

    const packet = new EncodedPacket(
      new Uint8Array(payload),
      isKey ? 'key' : 'delta',
      timestampSeconds,
      durationSeconds
    );

    // Build metadata with decoder config (required by Mediabunny)
    // Only emit full metadata on first packet or keyframes
    let meta: EncodedVideoChunkMetadata | undefined;

    if (!this.metadataEmitted || isKey) {
      // Extract codec description from first keyframe for AVC/HEVC
      if (isKey && this.useAnnexB && !this.codecDescription) {
        this.codecDescription = this.buildCodecDescription(data);
      }

      meta = {
        decoderConfig: {
          codec: this.getCodecString(),
          codedWidth: this.config.width,
          codedHeight: this.config.height,
          description: this.codecDescription ?? undefined,
        },
      };
      this.metadataEmitted = true;
    }

    this.frameIndex++;
    this.onPacket(packet, meta);
  }

  /**
   * Get codec string for the output format
   */
  private getCodecString(): string {
    switch (this.codec) {
      case 'avc':
        // AVC codec string: avc1.PPCCLL (profile, constraints, level)
        // Default to High profile, level 4.0
        return 'avc1.640028';
      case 'hevc':
        // HEVC codec string
        return 'hev1.1.6.L93.B0';
      case 'vp8':
        return 'vp8';
      case 'vp9':
        // VP9 codec string: vp09.PP.LL.DD (profile, level, bit depth)
        return 'vp09.00.10.08';
      case 'av1':
        // AV1 codec string
        return 'av01.0.01M.08';
      default:
        return this.codec;
    }
  }

  private buildCodecDescription(data: Buffer): Uint8Array | null {
    if (!this.useAnnexB) {
      return null;
    }

    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    if (this.codec === 'avc') {
      const { sps, pps } = extractAvcParameterSetsFromAnnexB(view);
      if (sps.length && pps.length) {
        return buildAvcDecoderConfig(sps, pps);
      }
    } else if (this.codec === 'hevc') {
      const { vps, sps, pps } = extractHevcParameterSetsFromAnnexB(view);
      if (sps.length && pps.length) {
        return buildHvccDecoderConfig(vps, sps, pps);
      }
    }

    return null;
  }

  private convertAnnexBFrame(data: Buffer): Buffer {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (this.codec === 'avc') {
      return convertAnnexBToAvcc(view);
    }
    if (this.codec === 'hevc') {
      return convertAnnexBToHvcc(view);
    }
    return data;
  }
}

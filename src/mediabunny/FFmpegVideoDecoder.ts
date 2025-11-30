/**
 * FFmpeg-backed VideoDecoder for Mediabunny
 *
 * Implements Mediabunny's CustomVideoDecoder interface using FFmpeg child process.
 * Supports hardware acceleration via VAAPI, CUDA/CUVID, QSV.
 */

import { spawn, ChildProcess } from 'child_process';
import {
  CustomVideoDecoder,
  VideoSample,
  EncodedPacket,
  VideoCodec,
} from 'mediabunny';
import {
  getBestDecoder,
  HardwareAccelerationMethod,
  VideoCodecName,
} from '../HardwareAcceleration.js';

// Container format for each codec (for decoder input)
const FORMAT_MAP: Record<VideoCodec, string> = {
  avc: 'h264',
  hevc: 'hevc',
  vp8: 'ivf',
  vp9: 'ivf',
  av1: 'ivf',
};

// Map Mediabunny codec to VideoCodecName
const CODEC_NAME_MAP: Record<VideoCodec, VideoCodecName> = {
  avc: 'h264',
  hevc: 'hevc',
  vp8: 'vp8',
  vp9: 'vp9',
  av1: 'av1',
};

export class FFmpegVideoDecoder extends CustomVideoDecoder {
  private process: ChildProcess | null = null;
  private accumulatedData: Buffer = Buffer.alloc(0);
  private frameSize: number = 0;
  private frameIndex = 0;
  private ivfHeaderSent = false;
  private resolveFlush: (() => void) | null = null;
  private useIvf: boolean = false;
  private useAnnexB: boolean = false;
  private nalLengthSize: number = 4; // Default AVC NAL length size
  private spsNal: Buffer | null = null;
  private ppsNal: Buffer | null = null;
  private paramsSent: boolean = false;
  // Track input packet timestamps for output frames
  private packetTimestamps: number[] = [];
  private packetDurations: number[] = [];
  private usingHardwareAcceleration = false;
  private hwaccelMethod: HardwareAccelerationMethod | null = null;

  static supports(codec: VideoCodec, _config: VideoDecoderConfig): boolean {
    return codec in FORMAT_MAP;
  }

  async init(): Promise<void> {
    const format = FORMAT_MAP[this.codec];
    this.useIvf = format === 'ivf';
    this.useAnnexB = format === 'h264' || format === 'hevc';

    const width = this.config.codedWidth ?? 1920;
    const height = this.config.codedHeight ?? 1080;
    this.frameSize = width * height * 4; // RGBA output

    // Parse AVC decoder config to get SPS/PPS
    if (this.useAnnexB && this.config.description) {
      this.parseAvcDecoderConfig(this.config.description);
    }

    // Determine hardware acceleration preference from config
    // Default to 'no-preference' which uses software for better compatibility
    // Hardware decoding with pipe input can have issues with format conversion
    const hwPref = (this.config as any).hardwareAcceleration as
      'prefer-hardware' | 'prefer-software' | 'no-preference' | undefined;

    // Try to get hardware-accelerated decoder only if explicitly requested
    const codecName = CODEC_NAME_MAP[this.codec];
    let hwDecoder: string | null = null;

    if (hwPref === 'prefer-hardware' && codecName) {
      try {
        const best = await getBestDecoder(codecName, hwPref);
        hwDecoder = best.decoder;
        this.usingHardwareAcceleration = best.isHardware;
        this.hwaccelMethod = best.hwaccel;

        if (best.isHardware) {
          console.log(`[FFmpegVideoDecoder] Using hardware decoder: ${best.decoder || best.hwaccel}`);
        }
      } catch {
        // Fall back to software
      }
    }

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
    ];

    // Add hardware acceleration options
    if (this.hwaccelMethod === 'vaapi') {
      args.push('-hwaccel', 'vaapi');
      args.push('-vaapi_device', '/dev/dri/renderD128');
    } else if (this.hwaccelMethod === 'cuda') {
      args.push('-hwaccel', 'cuda');
      if (hwDecoder) {
        args.push('-c:v', hwDecoder);
      }
    } else if (this.hwaccelMethod === 'qsv') {
      args.push('-hwaccel', 'qsv');
      if (hwDecoder) {
        args.push('-c:v', hwDecoder);
      }
    }

    // Input from pipe
    args.push('-f', format);
    args.push('-i', 'pipe:0');

    // Output raw video - need hwdownload for hardware frames
    // VAAPI outputs nv12, so we need to download and convert to rgba
    if (this.hwaccelMethod === 'vaapi') {
      args.push('-vf', 'hwdownload,format=nv12,format=rgba');
    } else if (this.hwaccelMethod === 'cuda') {
      args.push('-vf', 'hwdownload,format=nv12,format=rgba');
    } else if (this.hwaccelMethod === 'qsv') {
      args.push('-vf', 'hwdownload,format=nv12,format=rgba');
    }

    args.push(
      '-vsync', 'passthrough',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      'pipe:1',
    );

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.accumulatedData = Buffer.concat([this.accumulatedData, data]);

      // Emit complete frames
      while (this.accumulatedData.length >= this.frameSize) {
        const frameData = this.accumulatedData.subarray(0, this.frameSize);
        this.accumulatedData = this.accumulatedData.subarray(this.frameSize);
        this.emitSample(frameData);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('FFmpeg decoder error:', data.toString());
    });

    this.process.on('close', () => {
      if (this.resolveFlush) {
        this.resolveFlush();
        this.resolveFlush = null;
      }
    });

    this.process.stdin?.on('error', () => {
      // Ignore EPIPE errors
    });
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Decoder not initialized');
    }

    // Store packet timing info for output frames
    this.packetTimestamps.push(packet.timestamp);
    this.packetDurations.push(packet.duration);

    if (this.useIvf) {
      // Wrap packet data in IVF framing
      this.writeIvfFrame(packet.data, this.frameIndex++);
    } else if (this.useAnnexB) {
      // Convert AVC/AVCC format to Annex B and write
      this.writeAnnexBFrame(packet.data, packet.type === 'key');
      this.frameIndex++;
    } else {
      // Write raw encoded data
      this.process.stdin.write(Buffer.from(packet.data));
    }
  }

  /**
   * Parse AVCDecoderConfigurationRecord from config.description
   * This extracts SPS and PPS NAL units needed for Annex B stream
   */
  private parseAvcDecoderConfig(description: ArrayBuffer | ArrayBufferView): void {
    let data: Buffer;
    if (description instanceof ArrayBuffer) {
      data = Buffer.from(description);
    } else if (ArrayBuffer.isView(description)) {
      data = Buffer.from(description.buffer, description.byteOffset, description.byteLength);
    } else {
      return;
    }

    if (data.length < 7) return;

    // AVCDecoderConfigurationRecord structure:
    // configurationVersion (1 byte)
    // AVCProfileIndication (1 byte)
    // profile_compatibility (1 byte)
    // AVCLevelIndication (1 byte)
    // lengthSizeMinusOne (1 byte, lower 2 bits) -> NAL length size
    // numOfSequenceParameterSets (1 byte, lower 5 bits)
    // SPS entries...
    // numOfPictureParameterSets (1 byte)
    // PPS entries...

    this.nalLengthSize = (data[4] & 0x03) + 1;

    let offset = 5;

    // Parse SPS
    const numSps = data[offset] & 0x1f;
    offset++;

    for (let i = 0; i < numSps; i++) {
      if (offset + 2 > data.length) break;
      const spsLength = data.readUInt16BE(offset);
      offset += 2;

      if (offset + spsLength > data.length) break;
      this.spsNal = data.subarray(offset, offset + spsLength);
      offset += spsLength;
    }

    // Parse PPS
    if (offset >= data.length) return;
    const numPps = data[offset];
    offset++;

    for (let i = 0; i < numPps; i++) {
      if (offset + 2 > data.length) break;
      const ppsLength = data.readUInt16BE(offset);
      offset += 2;

      if (offset + ppsLength > data.length) break;
      this.ppsNal = data.subarray(offset, offset + ppsLength);
      offset += ppsLength;
    }
  }

  /**
   * Convert AVC/AVCC format packet to Annex B and write to FFmpeg
   * AVC format: [length][NAL][length][NAL]...
   * Annex B:    [start code][NAL][start code][NAL]...
   */
  private writeAnnexBFrame(data: Uint8Array, isKeyFrame: boolean): void {
    if (!this.process?.stdin) return;

    const buf = Buffer.from(data);
    const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);

    // For keyframes, prepend SPS and PPS
    if (isKeyFrame && !this.paramsSent && this.spsNal && this.ppsNal) {
      this.process.stdin.write(startCode);
      this.process.stdin.write(this.spsNal);
      this.process.stdin.write(startCode);
      this.process.stdin.write(this.ppsNal);
      this.paramsSent = true;
    }

    // Check if data is already in Annex B format (starts with 0x00 0x00 0x01)
    if (this.isAnnexBFormat(buf)) {
      this.process.stdin.write(buf);
      return;
    }

    // Convert AVC format to Annex B
    let offset = 0;
    while (offset + this.nalLengthSize <= buf.length) {
      // Read NAL length
      let nalLength = 0;
      for (let i = 0; i < this.nalLengthSize; i++) {
        nalLength = (nalLength << 8) | buf[offset + i];
      }
      offset += this.nalLengthSize;

      if (offset + nalLength > buf.length) {
        console.error('Invalid NAL length in AVC data');
        break;
      }

      // Write start code + NAL data
      this.process.stdin.write(startCode);
      this.process.stdin.write(buf.subarray(offset, offset + nalLength));
      offset += nalLength;
    }
  }

  /**
   * Check if buffer is already in Annex B format
   */
  private isAnnexBFormat(buf: Buffer): boolean {
    if (buf.length < 4) return false;
    // Check for 3-byte or 4-byte start code
    return (
      (buf[0] === 0 && buf[1] === 0 && buf[2] === 1) ||
      (buf[0] === 0 && buf[1] === 0 && buf[2] === 0 && buf[3] === 1)
    );
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
   * Write IVF file header (32 bytes)
   */
  private writeIvfHeader(): void {
    if (!this.process?.stdin) return;

    const width = this.config.codedWidth ?? 1920;
    const height = this.config.codedHeight ?? 1080;

    const header = Buffer.alloc(32);
    header.write('DKIF', 0);
    header.writeUInt16LE(0, 4); // Version
    header.writeUInt16LE(32, 6); // Header length

    // FourCC based on codec
    if (this.codec === 'vp8') {
      header.write('VP80', 8);
    } else if (this.codec === 'vp9') {
      header.write('VP90', 8);
    } else if (this.codec === 'av1') {
      header.write('AV01', 8);
    }

    header.writeUInt16LE(width, 12);
    header.writeUInt16LE(height, 14);
    header.writeUInt32LE(30, 16); // Framerate
    header.writeUInt32LE(1, 20); // Timebase
    header.writeUInt32LE(0, 24); // Frame count (unknown)
    header.writeUInt32LE(0, 28); // Unused

    this.process.stdin.write(header);
    this.ivfHeaderSent = true;
  }

  /**
   * Write an IVF frame (12-byte header + data)
   */
  private writeIvfFrame(data: Uint8Array, frameIndex: number): void {
    if (!this.process?.stdin) return;

    if (!this.ivfHeaderSent) {
      this.writeIvfHeader();
    }

    const frameHeader = Buffer.alloc(12);
    frameHeader.writeUInt32LE(data.length, 0);
    frameHeader.writeBigUInt64LE(BigInt(frameIndex), 4);

    this.process.stdin.write(frameHeader);
    this.process.stdin.write(Buffer.from(data));
  }

  /**
   * Emit a decoded VideoSample via Mediabunny callback
   */
  private emitSample(data: Buffer): void {
    const width = this.config.codedWidth ?? 1920;
    const height = this.config.codedHeight ?? 1080;

    // Use stored timestamp from input packet, or calculate from frame index
    let timestampSeconds: number;
    let durationSeconds: number;

    if (this.packetTimestamps.length > 0) {
      timestampSeconds = this.packetTimestamps.shift()!;
      durationSeconds = this.packetDurations.shift() ?? (1 / 30);
    } else {
      // Fallback to calculated timestamp
      const framerate = 30;
      timestampSeconds = this.frameIndex / framerate;
      durationSeconds = 1 / framerate;
    }

    // Create VideoSample from raw pixel data (Uint8Array)
    // Mediabunny accepts AllowSharedBufferSource with format/dimensions/timestamp
    const sample = new VideoSample(new Uint8Array(data), {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: timestampSeconds,
      duration: durationSeconds,
    });

    this.frameIndex++;
    this.onSample(sample);
  }
}

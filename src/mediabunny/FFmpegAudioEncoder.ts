/**
 * FFmpeg-backed AudioEncoder for Mediabunny
 *
 * Implements Mediabunny's CustomAudioEncoder interface using FFmpeg child process.
 */

import { spawn, ChildProcess } from 'child_process';
import {
  CustomAudioEncoder,
  AudioSample,
  EncodedPacket,
  AudioCodec,
} from 'mediabunny';
import { buildAudioSpecificConfig } from '../utils/aac.js';

// Codec mapping: Mediabunny codec -> FFmpeg encoder
const CODEC_MAP: Record<AudioCodec, string> = {
  'aac': 'aac',
  'opus': 'libopus',
  'mp3': 'libmp3lame',
  'flac': 'flac',
  'vorbis': 'libvorbis',
  'pcm-s16': 'pcm_s16le',
  'pcm-s16be': 'pcm_s16be',
  'pcm-s24': 'pcm_s24le',
  'pcm-s24be': 'pcm_s24be',
  'pcm-s32': 'pcm_s32le',
  'pcm-s32be': 'pcm_s32be',
  'pcm-f32': 'pcm_f32le',
  'pcm-f32be': 'pcm_f32be',
  'pcm-f64': 'pcm_f64le',
  'pcm-f64be': 'pcm_f64be',
  'pcm-u8': 'pcm_u8',
  'pcm-s8': 'pcm_s8',
  'ulaw': 'pcm_mulaw',
  'alaw': 'pcm_alaw',
};

// Output container format for each codec
// Using formats that allow easy frame parsing
const FORMAT_MAP: Record<string, string> = {
  'aac': 'adts',
  'libopus': 'opus',  // Use raw opus format (OggS pages with single packets)
  'libmp3lame': 'mp3',
  'flac': 'flac',
  'libvorbis': 'ogg',
  'pcm_s16le': 's16le',
  'pcm_s16be': 's16be',
  'pcm_s24le': 's24le',
  'pcm_s24be': 's24be',
  'pcm_s32le': 's32le',
  'pcm_s32be': 's32be',
  'pcm_f32le': 'f32le',
  'pcm_f32be': 'f32be',
  'pcm_f64le': 'f64le',
  'pcm_f64be': 'f64be',
  'pcm_u8': 'u8',
  'pcm_s8': 's8',
  'pcm_mulaw': 'mulaw',
  'pcm_alaw': 'alaw',
};

export class FFmpegAudioEncoder extends CustomAudioEncoder {
  private process: ChildProcess | null = null;
  private accumulatedData: Buffer = Buffer.alloc(0);
  private frameIndex = 0;
  private resolveFlush: (() => void) | null = null;
  private ffmpegCodec = '';
  private metadataEmitted = false;
  private codecDescription: Uint8Array | null = null;
  private audioOutputFormat: 'adts' | 'aac' = 'adts';

  static supports(codec: AudioCodec, _config: AudioEncoderConfig): boolean {
    return codec in CODEC_MAP;
  }

  async init(): Promise<void> {
    this.ffmpegCodec = CODEC_MAP[this.codec] || 'aac';
    const format = FORMAT_MAP[this.ffmpegCodec] || 'adts';
    const configExt = this.config as Record<string, any>;
    if (this.codec === 'aac' && configExt.aac?.format === 'aac') {
      this.audioOutputFormat = 'aac';
    } else {
      this.audioOutputFormat = 'adts';
    }

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      // Input: raw PCM from pipe
      '-f', 'f32le',
      '-ar', String(this.config.sampleRate),
      '-ac', String(this.config.numberOfChannels),
      '-i', 'pipe:0',
      // Output encoder
      '-c:a', this.ffmpegCodec,
    ];

    // Add bitrate if specified
    if (this.config.bitrate) {
      args.push('-b:a', String(this.config.bitrate));
    }

    // Codec-specific options
    if (this.ffmpegCodec === 'libopus') {
      args.push('-application', 'audio');
    }

    // Output format
    args.push('-f', format);
    args.push('pipe:1');

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.accumulatedData = Buffer.concat([this.accumulatedData, data]);
      this.parseEncodedFrames();
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (!msg.includes('Discarding')) {
        console.error('FFmpeg audio encoder:', msg);
      }
    });

    this.process.on('close', () => {
      // Emit remaining data
      if (this.accumulatedData.length > 0) {
        this.emitPacket(this.accumulatedData);
        this.accumulatedData = Buffer.alloc(0);
      }

      if (this.resolveFlush) {
        this.resolveFlush();
        this.resolveFlush = null;
      }
    });

    this.process.stdin?.on('error', () => {
      // Ignore EPIPE
    });
  }

  async encode(audioSample: AudioSample): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Encoder not initialized');
    }

    // Get raw PCM data from AudioSample (f32 interleaved)
    const pcmData = await this.getSampleData(audioSample);
    this.process.stdin.write(pcmData);
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
   * Extract raw PCM data from AudioSample
   */
  private async getSampleData(sample: AudioSample): Promise<Buffer> {
    const numFrames = sample.numberOfFrames;
    const numChannels = sample.numberOfChannels;
    const bufferSize = numFrames * numChannels * 4; // f32 = 4 bytes
    const buffer = Buffer.alloc(bufferSize);

    // Copy data from sample (convert to f32 interleaved if needed)
    const isPlanar = sample.format.endsWith('-planar');

    if (isPlanar) {
      // Planar: interleave channels
      const tempBuffer = new Float32Array(numFrames);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      for (let ch = 0; ch < numChannels; ch++) {
        sample.copyTo(new Uint8Array(tempBuffer.buffer), {
          planeIndex: ch,
          format: 'f32',
        });

        for (let frame = 0; frame < numFrames; frame++) {
          const offset = (frame * numChannels + ch) * 4;
          view.setFloat32(offset, tempBuffer[frame], true);
        }
      }
    } else {
      // Already interleaved
      sample.copyTo(buffer, { planeIndex: 0, format: 'f32' });
    }

    return buffer;
  }

  /**
   * Parse encoded audio frames from FFmpeg output
   */
  private parseEncodedFrames(): void {
    const minChunkSize = 64;

    while (this.accumulatedData.length >= minChunkSize) {
      let frameEnd = this.findFrameEnd();

      if (frameEnd > 0) {
        const frameData = Buffer.from(this.accumulatedData.subarray(0, frameEnd));
        this.accumulatedData = this.accumulatedData.subarray(frameEnd);
        this.emitPacket(frameData);
      } else {
        break;
      }
    }
  }

  /**
   * Find the end of an audio frame
   */
  private findFrameEnd(): number {
    if (this.ffmpegCodec === 'aac') {
      return this.findADTSFrame();
    } else if (this.ffmpegCodec === 'libmp3lame') {
      return this.findMP3Frame();
    } else if (this.ffmpegCodec === 'libopus' || this.ffmpegCodec === 'libvorbis') {
      return this.findOggPage();
    } else {
      return Math.min(this.accumulatedData.length, 4096);
    }
  }

  private findADTSFrame(): number {
    if (this.accumulatedData.length < 7) return 0;

    if ((this.accumulatedData[0] !== 0xFF) ||
        ((this.accumulatedData[1] & 0xF0) !== 0xF0)) {
      for (let i = 1; i < this.accumulatedData.length - 1; i++) {
        if (this.accumulatedData[i] === 0xFF &&
            (this.accumulatedData[i + 1] & 0xF0) === 0xF0) {
          this.accumulatedData = this.accumulatedData.subarray(i);
          return 0;
        }
      }
      return 0;
    }

    const frameLength = ((this.accumulatedData[3] & 0x03) << 11) |
                        (this.accumulatedData[4] << 3) |
                        ((this.accumulatedData[5] & 0xE0) >> 5);

    if (frameLength > this.accumulatedData.length) return 0;

    return frameLength;
  }

  private findMP3Frame(): number {
    if (this.accumulatedData.length < 4) return 0;

    if (this.accumulatedData[0] !== 0xFF ||
        (this.accumulatedData[1] & 0xE0) !== 0xE0) {
      for (let i = 1; i < this.accumulatedData.length - 1; i++) {
        if (this.accumulatedData[i] === 0xFF &&
            (this.accumulatedData[i + 1] & 0xE0) === 0xE0) {
          this.accumulatedData = this.accumulatedData.subarray(i);
          return 0;
        }
      }
      return 0;
    }

    const header = this.accumulatedData.readUInt32BE(0);
    const bitrateIndex = (header >> 12) & 0x0F;
    const samplingRateIndex = (header >> 10) & 0x03;
    const padding = (header >> 9) & 0x01;

    const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const sampleRates = [44100, 48000, 32000, 0];

    const bitrate = bitrates[bitrateIndex] * 1000;
    const sampleRate = sampleRates[samplingRateIndex];

    if (bitrate === 0 || sampleRate === 0) return 0;

    const frameSize = Math.floor((144 * bitrate) / sampleRate) + padding;

    if (frameSize > this.accumulatedData.length) return 0;

    return frameSize;
  }

  /**
   * Parse Ogg pages and extract individual Opus packets
   * Ogg page structure:
   * - 4 bytes: "OggS" magic
   * - 1 byte: version
   * - 1 byte: header type
   * - 8 bytes: granule position
   * - 4 bytes: serial number
   * - 4 bytes: page sequence number
   * - 4 bytes: checksum
   * - 1 byte: number of segments
   * - N bytes: segment table (one byte per segment)
   * - data: concatenated segments
   */
  private findOggPage(): number {
    if (this.accumulatedData.length < 27) return 0;

    if (this.accumulatedData.toString('ascii', 0, 4) !== 'OggS') {
      for (let i = 1; i < this.accumulatedData.length - 3; i++) {
        if (this.accumulatedData.toString('ascii', i, i + 4) === 'OggS') {
          this.accumulatedData = this.accumulatedData.subarray(i);
          return 0;
        }
      }
      return this.accumulatedData.length;
    }

    const numSegments = this.accumulatedData[26];
    if (this.accumulatedData.length < 27 + numSegments) return 0;

    // Calculate total page size
    let pageDataSize = 0;
    for (let i = 0; i < numSegments; i++) {
      pageDataSize += this.accumulatedData[27 + i];
    }

    const headerSize = 27 + numSegments;
    const pageSize = headerSize + pageDataSize;

    if (pageSize > this.accumulatedData.length) return 0;

    // Skip header pages (OpusHead, OpusTags)
    const pageData = this.accumulatedData.subarray(headerSize, pageSize);
    if (pageData.length >= 8) {
      const magic = pageData.toString('ascii', 0, 8);
      if (magic === 'OpusHead' || magic === 'OpusTags') {
        // Skip this header page, return the page size to advance past it
        this.accumulatedData = this.accumulatedData.subarray(pageSize);
        return 0; // Return 0 to continue parsing
      }
    }

    // Extract individual Opus packets from segments
    // In Ogg, a packet ends when a segment is < 255 bytes
    // Multiple packets can be in one page
    this.extractOggPackets(headerSize, numSegments);

    // Remove the processed page
    this.accumulatedData = this.accumulatedData.subarray(pageSize);
    return 0; // We've already emitted packets, return 0 to continue
  }

  /**
   * Extract individual Opus packets from Ogg page segments
   */
  private extractOggPackets(headerSize: number, numSegments: number): void {
    let dataOffset = headerSize;
    let packetData: Buffer[] = [];

    for (let i = 0; i < numSegments; i++) {
      const segmentSize = this.accumulatedData[27 + i];
      const segmentData = this.accumulatedData.subarray(dataOffset, dataOffset + segmentSize);
      packetData.push(Buffer.from(segmentData));
      dataOffset += segmentSize;

      // A segment < 255 bytes marks the end of a packet
      if (segmentSize < 255) {
        if (packetData.length > 0) {
          const packet = Buffer.concat(packetData);
          // Only emit non-empty packets that aren't headers
          if (packet.length > 0 && packet.toString('ascii', 0, 4) !== 'Opus') {
            this.emitPacket(packet);
          }
          packetData = [];
        }
      }
    }

    // Handle any remaining data (packet spanning pages)
    if (packetData.length > 0) {
      const packet = Buffer.concat(packetData);
      if (packet.length > 0) {
        this.emitPacket(packet);
      }
    }
  }

  /**
   * Emit an encoded packet via Mediabunny callback
   */
  private emitPacket(data: Buffer): void {
    const sampleRate = this.config.sampleRate;

    // Get frame size based on codec
    const frameSamples = this.getFrameSamples();

    const timestampSeconds = this.frameIndex / sampleRate;
    const durationSeconds = frameSamples / sampleRate;

    let payload = data;
    if (this.codec === 'aac' && this.audioOutputFormat === 'aac') {
      payload = this.stripAdtsHeader(data);
    }

    const packet = new EncodedPacket(
      new Uint8Array(payload),
      'key',
      timestampSeconds,
      durationSeconds
    );

    // Build metadata with decoder config (required by Mediabunny)
    let meta: EncodedAudioChunkMetadata | undefined;

    if (!this.metadataEmitted) {
      // Build codec description based on codec type
      if (!this.codecDescription) {
        if (this.codec === 'opus') {
          this.codecDescription = this.buildOpusDescription();
        } else if (this.codec === 'aac') {
          this.codecDescription = this.buildAacDescription();
        }
      }

      meta = {
        decoderConfig: {
          codec: this.getCodecString(),
          sampleRate: this.config.sampleRate,
          numberOfChannels: this.config.numberOfChannels,
          description: this.codecDescription ?? undefined,
        },
      };
      this.metadataEmitted = true;
    }

    this.frameIndex += frameSamples;
    this.onPacket(packet, meta);
  }

  /**
   * Get the number of samples per frame based on codec
   */
  private getFrameSamples(): number {
    switch (this.codec) {
      case 'opus':
        // Opus typically uses 20ms frames at 48kHz = 960 samples
        return 960;
      case 'aac':
        // AAC uses 1024 samples per frame
        return 1024;
      case 'mp3':
        // MP3 uses 1152 samples per frame
        return 1152;
      case 'vorbis':
        // Vorbis frame size varies, use approximate average
        return 1024;
      case 'flac':
        // FLAC frame size varies, use approximate
        return 4096;
      default:
        return 1024;
    }
  }

  /**
   * Get codec string for the output format
   */
  private getCodecString(): string {
    switch (this.codec) {
      case 'aac':
        return 'mp4a.40.2'; // AAC-LC
      case 'opus':
        return 'opus';
      case 'mp3':
        return 'mp3';
      case 'flac':
        return 'flac';
      case 'vorbis':
        return 'vorbis';
      default:
        return this.codec;
    }
  }

  /**
   * Build Opus identification header for decoder config description
   */
  private buildOpusDescription(): Uint8Array {
    // Opus Identification Header (19 bytes minimum)
    const header = Buffer.alloc(19);
    let offset = 0;

    // Magic signature "OpusHead"
    header.write('OpusHead', offset);
    offset += 8;

    // Version (1 byte)
    header[offset++] = 1;

    // Channel count (1 byte)
    header[offset++] = this.config.numberOfChannels;

    // Pre-skip (2 bytes, little-endian)
    header.writeUInt16LE(312, offset); // Default pre-skip
    offset += 2;

    // Input sample rate (4 bytes, little-endian)
    header.writeUInt32LE(this.config.sampleRate, offset);
    offset += 4;

    // Output gain (2 bytes, little-endian)
    header.writeInt16LE(0, offset);
    offset += 2;

    // Channel mapping family (1 byte)
    header[offset++] = 0; // 0 = mono/stereo, no mapping table

    return new Uint8Array(header);
  }

  /**
   * Build AAC AudioSpecificConfig for decoder config description
   * ISO 14496-3 section 1.6.2.1
   */
  private buildAacDescription(): Uint8Array {
    return buildAudioSpecificConfig({
      samplingRate: this.config.sampleRate,
      channelConfiguration: this.config.numberOfChannels,
    });
  }

  private stripAdtsHeader(frame: Buffer): Buffer {
    if (frame.length < 7) {
      return frame;
    }

    const protectionAbsent = frame[1] & 0x01;
    const headerLength = protectionAbsent ? 7 : 9;
    if (frame.length <= headerLength) {
      return Buffer.alloc(0);
    }
    return frame.subarray(headerLength);
  }
}

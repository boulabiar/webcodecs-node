/**
 * FFmpeg-backed AudioDecoder for Mediabunny
 *
 * Implements Mediabunny's CustomAudioDecoder interface using FFmpeg child process.
 */

import { spawn, ChildProcess } from 'child_process';
import {
  CustomAudioDecoder,
  AudioSample,
  EncodedPacket,
  AudioCodec,
} from 'mediabunny';

// Codec mapping: Mediabunny codec -> FFmpeg decoder and input format
const CODEC_MAP: Record<AudioCodec, { decoder: string; format: string }> = {
  'aac': { decoder: 'aac', format: 'aac' },
  'opus': { decoder: 'libopus', format: 'ogg' },
  'mp3': { decoder: 'mp3', format: 'mp3' },
  'flac': { decoder: 'flac', format: 'flac' },
  'vorbis': { decoder: 'libvorbis', format: 'ogg' },
  'pcm-s16': { decoder: 'pcm_s16le', format: 's16le' },
  'pcm-s16be': { decoder: 'pcm_s16be', format: 's16be' },
  'pcm-s24': { decoder: 'pcm_s24le', format: 's24le' },
  'pcm-s24be': { decoder: 'pcm_s24be', format: 's24be' },
  'pcm-s32': { decoder: 'pcm_s32le', format: 's32le' },
  'pcm-s32be': { decoder: 'pcm_s32be', format: 's32be' },
  'pcm-f32': { decoder: 'pcm_f32le', format: 'f32le' },
  'pcm-f32be': { decoder: 'pcm_f32be', format: 'f32be' },
  'pcm-f64': { decoder: 'pcm_f64le', format: 'f64le' },
  'pcm-f64be': { decoder: 'pcm_f64be', format: 'f64be' },
  'pcm-u8': { decoder: 'pcm_u8', format: 'u8' },
  'pcm-s8': { decoder: 'pcm_s8', format: 's8' },
  'ulaw': { decoder: 'pcm_mulaw', format: 'mulaw' },
  'alaw': { decoder: 'pcm_alaw', format: 'alaw' },
};

// AAC frequency table for ADTS header
const AAC_FREQUENCIES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000, 7350
];

export class FFmpegAudioDecoder extends CustomAudioDecoder {
  private process: ChildProcess | null = null;
  private accumulatedData: Buffer = Buffer.alloc(0);
  private frameIndex = 0;
  private resolveFlush: (() => void) | null = null;
  private aacConfig: { objectType: number; frequencyIndex: number; channelConfig: number } | null = null;
  // Track base timestamp from first input packet
  private baseTimestamp: number = 0;
  private hasBaseTimestamp: boolean = false;

  static supports(codec: AudioCodec, _config: AudioDecoderConfig): boolean {
    return codec in CODEC_MAP;
  }

  async init(): Promise<void> {
    const codecInfo = CODEC_MAP[this.codec] || { decoder: 'aac', format: 'aac' };

    const sampleRate = this.config.sampleRate ?? 44100;
    const numberOfChannels = this.config.numberOfChannels ?? 2;

    // Parse AAC AudioSpecificConfig if available
    if (this.codec === 'aac' && this.config.description) {
      this.aacConfig = this.parseAacAudioSpecificConfig(this.config.description);
    } else if (this.codec === 'aac') {
      // Build default AAC config from sample rate and channels
      const frequencyIndex = AAC_FREQUENCIES.indexOf(sampleRate);
      this.aacConfig = {
        objectType: 2, // AAC-LC
        frequencyIndex: frequencyIndex >= 0 ? frequencyIndex : 4, // Default to 44100
        channelConfig: numberOfChannels,
      };
    }

    // Use 'adts' format for AAC since we'll wrap packets with ADTS headers
    const inputFormat = this.codec === 'aac' ? 'aac' : codecInfo.format;

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      // Input from pipe
      '-f', inputFormat,
      '-i', 'pipe:0',
      // Output: raw PCM f32le
      '-f', 'f32le',
      '-ar', String(sampleRate),
      '-ac', String(numberOfChannels),
      'pipe:1',
    ];

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.accumulatedData = Buffer.concat([this.accumulatedData, data]);
      this.emitDecodedSamples();
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      // Ignore common warnings, but log real errors for debugging
      if (!msg.includes('Discarding') && !msg.includes('Last message repeated')) {
        console.error('FFmpeg audio decoder:', msg);
      }
    });

    this.process.on('close', () => {
      // Emit any remaining samples
      if (this.accumulatedData.length > 0) {
        this.emitAudioSample(this.accumulatedData);
        this.accumulatedData = Buffer.alloc(0);
      }

      if (this.resolveFlush) {
        this.resolveFlush();
        this.resolveFlush = null;
      }
    });

    this.process.stdin?.on('error', () => {
      // Ignore EPIPE errors
    });
  }

  /**
   * Parse AAC AudioSpecificConfig from description buffer
   */
  private parseAacAudioSpecificConfig(description: ArrayBuffer | ArrayBufferView): { objectType: number; frequencyIndex: number; channelConfig: number } {
    let data: Uint8Array;
    if (description instanceof ArrayBuffer) {
      data = new Uint8Array(description);
    } else {
      data = new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
    }

    if (data.length < 2) {
      // Default config
      return { objectType: 2, frequencyIndex: 4, channelConfig: 2 };
    }

    // Parse AudioSpecificConfig
    // 5 bits: objectType
    // 4 bits: frequencyIndex
    // 4 bits: channelConfiguration
    const objectType = (data[0] >> 3) & 0x1f;
    const frequencyIndex = ((data[0] & 0x07) << 1) | ((data[1] >> 7) & 0x01);
    const channelConfig = (data[1] >> 3) & 0x0f;

    return { objectType, frequencyIndex, channelConfig };
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Decoder not initialized');
    }

    // Capture the base timestamp from the first packet
    if (!this.hasBaseTimestamp) {
      this.baseTimestamp = packet.timestamp;
      this.hasBaseTimestamp = true;
    }

    // For AAC, wrap with ADTS header
    if (this.codec === 'aac' && this.aacConfig) {
      const adtsFrame = this.wrapWithAdtsHeader(packet.data);
      this.process.stdin.write(adtsFrame);
    } else {
      // Write encoded data directly to FFmpeg
      this.process.stdin.write(Buffer.from(packet.data));
    }
  }

  /**
   * Wrap raw AAC frame with ADTS header (7 bytes)
   */
  private wrapWithAdtsHeader(rawAac: Uint8Array): Buffer {
    if (!this.aacConfig) {
      return Buffer.from(rawAac);
    }

    const frameLength = rawAac.length + 7; // 7-byte ADTS header
    const header = Buffer.alloc(7);

    // ADTS header structure (7 bytes, no CRC):
    // Syncword: 12 bits (0xFFF)
    // ID: 1 bit (0 = MPEG-4, 1 = MPEG-2)
    // Layer: 2 bits (always 0)
    // Protection absent: 1 bit (1 = no CRC)
    // Profile: 2 bits (objectType - 1)
    // Sampling frequency index: 4 bits
    // Private bit: 1 bit (0)
    // Channel configuration: 3 bits
    // Original/copy: 1 bit (0)
    // Home: 1 bit (0)
    // Copyright ID bit: 1 bit (0)
    // Copyright ID start: 1 bit (0)
    // Frame length: 13 bits
    // Buffer fullness: 11 bits (0x7FF = variable)
    // Number of AAC frames - 1: 2 bits (0 = 1 frame)

    const profile = this.aacConfig.objectType - 1; // Profile is objectType - 1
    const freqIdx = this.aacConfig.frequencyIndex;
    const chanCfg = this.aacConfig.channelConfig;

    // Byte 0: Syncword high (0xFF)
    header[0] = 0xff;

    // Byte 1: Syncword low (0xF) + ID (0) + Layer (00) + Protection absent (1)
    header[1] = 0xf1; // 0xF0 | 0x01

    // Byte 2: Profile (2 bits) + Frequency index (4 bits) + Private (1 bit) + Channel config high (1 bit)
    header[2] = ((profile & 0x03) << 6) | ((freqIdx & 0x0f) << 2) | ((chanCfg >> 2) & 0x01);

    // Byte 3: Channel config low (2 bits) + Original (1 bit) + Home (1 bit) + Copyright ID (1 bit) + Copyright start (1 bit) + Frame length high (2 bits)
    header[3] = ((chanCfg & 0x03) << 6) | ((frameLength >> 11) & 0x03);

    // Byte 4: Frame length middle (8 bits)
    header[4] = (frameLength >> 3) & 0xff;

    // Byte 5: Frame length low (3 bits) + Buffer fullness high (5 bits)
    header[5] = ((frameLength & 0x07) << 5) | 0x1f; // Buffer fullness = 0x7FF

    // Byte 6: Buffer fullness low (6 bits) + Number of frames - 1 (2 bits)
    header[6] = 0xfc; // (0x3F << 2) | 0x00

    return Buffer.concat([header, Buffer.from(rawAac)]);
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
   * Emit decoded audio samples
   */
  private emitDecodedSamples(): void {
    const sampleRate = this.config.sampleRate ?? 44100;
    const numberOfChannels = this.config.numberOfChannels ?? 2;

    // Calculate chunk size (emit ~20ms chunks)
    const samplesPerChunk = Math.floor(sampleRate * 0.02); // 20ms
    const bytesPerSample = 4; // f32
    const bytesPerChunk = samplesPerChunk * numberOfChannels * bytesPerSample;

    while (this.accumulatedData.length >= bytesPerChunk) {
      const chunkData = Buffer.from(this.accumulatedData.subarray(0, bytesPerChunk));
      this.accumulatedData = this.accumulatedData.subarray(bytesPerChunk);
      this.emitAudioSample(chunkData);
    }
  }

  /**
   * Emit an AudioSample via Mediabunny callback
   */
  private emitAudioSample(data: Buffer): void {
    if (data.length === 0) return;

    const sampleRate = this.config.sampleRate ?? 44100;
    const numberOfChannels = this.config.numberOfChannels ?? 2;
    const bytesPerSample = 4; // f32

    const numberOfFrames = Math.floor(data.length / (numberOfChannels * bytesPerSample));
    if (numberOfFrames === 0) return;

    // Calculate timestamp in seconds, preserving base timestamp from input
    const offsetSeconds = this.frameIndex / sampleRate;
    const timestampSeconds = this.baseTimestamp + offsetSeconds;

    // Create AudioSample from raw f32 interleaved data
    const sample = new AudioSample({
      format: 'f32',
      sampleRate,
      numberOfChannels,
      timestamp: timestampSeconds,
      data: new Uint8Array(data),
    });

    this.frameIndex += numberOfFrames;
    this.onSample(sample);
  }
}

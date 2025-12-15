/**
 * NodeAvAudioDecoder - Audio decoder using node-av native bindings
 *
 * Implements the AudioDecoderBackend interface for decoding audio streams
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Decoder, FilterAPI } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import {
  AVMEDIA_TYPE_AUDIO,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16,
  AV_SAMPLE_FMT_S16P,
  AV_SAMPLE_FMT_S32,
  AV_SAMPLE_FMT_S32P,
  AV_SAMPLE_FMT_U8,
  AV_SAMPLE_FMT_U8P,
  AV_CODEC_ID_AAC,
  AV_CODEC_ID_OPUS,
  AV_CODEC_ID_MP3,
  AV_CODEC_ID_FLAC,
  AV_CODEC_ID_VORBIS,
  AV_CODEC_ID_PCM_S16LE,
  AV_CODEC_ID_PCM_F32LE,
  AV_CHANNEL_ORDER_NATIVE,
  AV_CH_LAYOUT_MONO,
  AV_CH_LAYOUT_STEREO,
  AV_CH_LAYOUT_5POINT1,
  AV_CH_LAYOUT_7POINT1,
  type AVSampleFormat,
  type AVCodecID,
} from 'node-av/constants';

import type {
  AudioDecoderBackend,
  AudioDecoderBackendConfig,
  DecodedFrame,
} from '../backends/types.js';
import type { AudioSampleFormat } from '../types/audio.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('NodeAvAudioDecoder');

/** Default sample rate for audio decoding */
const DEFAULT_SAMPLE_RATE = 48000;

/**
 * NodeAV-backed audio decoder implementing AudioDecoderBackend interface
 */
export class NodeAvAudioDecoder extends EventEmitter implements AudioDecoderBackend {
  private decoder: Decoder | null = null;
  private formatContext: FormatContext | null = null;
  private stream: Stream | null = null;
  private filter: FilterAPI | null = null;
  private config: AudioDecoderBackendConfig | null = null;
  private queue: Buffer[] = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private packetIndex = 0;
  private frameIndex = 0;
  private packetTimeBase: Rational = new Rational(1, DEFAULT_SAMPLE_RATE);
  private outputSampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLT;
  private filterDescription: string | null = null;
  private outputFormat: AudioSampleFormat = 'f32';

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startDecoder(config: AudioDecoderBackendConfig): void {
    this.config = { ...config };
    this.packetTimeBase = new Rational(1, config.sampleRate);
    this.outputFormat = this.parseOutputFormat(config);
    this.outputSampleFormat = mapSampleFormat(this.outputFormat);
  }

  write(data: Buffer | Uint8Array): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    // Pass raw data directly - extradata is set on the decoder context
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
          await this.decodeBuffer(data);
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

  private async ensureDecoder(): Promise<void> {
    if (this.decoder || !this.config) {
      return;
    }

    const codecId = mapCodecId(this.config.codec);
    if (!codecId) {
      throw new Error(`Unsupported audio codec: ${this.config.codec}`);
    }

    this.formatContext = new FormatContext();
    this.formatContext.allocContext();
    this.stream = this.formatContext.newStream();
    this.stream.timeBase = this.packetTimeBase;

    const params = this.stream.codecpar;
    params.codecType = AVMEDIA_TYPE_AUDIO;
    params.codecId = codecId;
    params.sampleRate = this.config.sampleRate;
    params.channelLayout = this.getChannelLayout(this.config.numberOfChannels) as any;
    (params as any).channels = this.config.numberOfChannels;

    // Set extradata if we have description (e.g., AudioSpecificConfig for AAC)
    if (this.config.description) {
      const desc = this.config.description;
      let bytes: Uint8Array;
      if (desc instanceof ArrayBuffer) {
        bytes = new Uint8Array(desc);
      } else {
        bytes = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
      }
      params.extradata = Buffer.from(bytes);
    }

    this.decoder = await Decoder.create(this.stream, {
      exitOnError: true,
    });

    logger.info(`Created decoder for codec: ${this.config.codec}`);
  }

  private parseOutputFormat(config: AudioDecoderBackendConfig): AudioSampleFormat {
    // Default to f32 if not specified
    return 'f32';
  }

  private async decodeBuffer(buffer: Buffer): Promise<void> {
    await this.ensureDecoder();
    if (!this.decoder || !this.stream) {
      throw new Error('Decoder not initialized');
    }

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = this.stream.index;
    packet.pts = BigInt(this.packetIndex);
    packet.dts = BigInt(this.packetIndex);
    packet.timeBase = this.packetTimeBase;
    packet.data = buffer;
    packet.duration = 1n;

    await this.decoder.decode(packet);
    packet.unref();
    await this.drainFrames();
    this.packetIndex++;
  }

  private async drainFrames(): Promise<void> {
    if (!this.decoder) return;

    let frame = await this.decoder.receive();
    while (frame) {
      const nbSamples = frame.nbSamples;
      if (nbSamples > 0) {
        const converted = await this.toOutputBuffer(frame);
        frame.unref();
        if (converted) {
          this.emit('frame', {
            data: converted,
            numberOfFrames: nbSamples,
            timestamp: this.frameIndex,
          });
          this.frameIndex += nbSamples;
        }
      } else {
        frame.unref();
      }
      frame = await this.decoder.receive();
    }
  }

  private async toOutputBuffer(frame: any): Promise<Buffer | null> {
    const frameFormat = frame.format as AVSampleFormat;
    const frameChannels = frame.channels || this.config?.numberOfChannels || 2;
    const nbSamples = frame.nbSamples;

    // If frame already matches requested format, just export
    if (frameFormat === this.outputSampleFormat) {
      return frame.toBuffer();
    }

    // For multi-channel audio (>2 channels), the filter has issues with channel layouts
    // Convert manually from planar float to interleaved float if needed
    if (frameChannels > 2 && frameFormat === AV_SAMPLE_FMT_FLTP && this.outputSampleFormat === AV_SAMPLE_FMT_FLT) {
      return this.convertPlanarToInterleaved(frame, nbSamples, frameChannels);
    }

    // For stereo/mono, use filter for conversion
    const outputFormatName = sampleFormatToFFmpegName(this.outputSampleFormat);
    const description = `aformat=sample_fmts=${outputFormatName}`;

    if (!this.filter || this.filterDescription !== description) {
      this.filter?.close();
      this.filter = FilterAPI.create(description, {} as any);
      this.filterDescription = description;
    }

    await this.filter.process(frame);

    let filtered = await this.filter.receive();
    while (filtered === null) {
      filtered = await this.filter.receive();
    }
    if (!filtered) {
      return null;
    }

    const buffer = filtered.toBuffer();
    filtered.unref();
    return buffer;
  }

  private convertPlanarToInterleaved(frame: any, nbSamples: number, numChannels: number): Buffer {
    // Get planar buffer from frame - each channel is stored separately
    const planarBuffer = frame.toBuffer() as Buffer;
    const bytesPerSample = 4; // float32
    const planeSize = nbSamples * bytesPerSample;

    // Create interleaved output
    const outputSize = nbSamples * numChannels * bytesPerSample;
    const output = Buffer.alloc(outputSize);

    // Convert from planar (LLLLLLLL RRRRRRRR ...) to interleaved (LRLRLRLR ...)
    const inputView = new Float32Array(planarBuffer.buffer, planarBuffer.byteOffset, planarBuffer.byteLength / 4);
    const outputView = new Float32Array(output.buffer, output.byteOffset, output.byteLength / 4);

    for (let s = 0; s < nbSamples; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const srcIdx = ch * nbSamples + s;
        const dstIdx = s * numChannels + ch;
        outputView[dstIdx] = inputView[srcIdx];
      }
    }

    return output;
  }

  private getChannelLayout(numChannels: number): { nbChannels: number; order: number; mask: bigint } {
    // Standard channel layouts as ChannelLayout objects
    // Order 1 = AV_CHANNEL_ORDER_NATIVE (required for FFmpeg)
    switch (numChannels) {
      case 1:
        return { nbChannels: 1, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_MONO };
      case 2:
        return { nbChannels: 2, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_STEREO };
      case 6:
        return { nbChannels: 6, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_5POINT1 };
      case 8:
        return { nbChannels: 8, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_7POINT1 };
      default:
        return { nbChannels: numChannels, order: AV_CHANNEL_ORDER_NATIVE, mask: BigInt((1 << numChannels) - 1) };
    }
  }

  private async finish(): Promise<void> {
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
    }

    if (this.decoder) {
      try {
        await this.decoder.flush();
        await this.drainFrames();
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
    this.decoder?.close();
    this.decoder = null;
    this.formatContext = null;
    this.stream = null;
    this.queue = [];
  }
}

function mapCodecId(codec: string): AVCodecID | null {
  const codecBase = codec.split('.')[0].toLowerCase();
  switch (codecBase) {
    case 'mp4a':
    case 'aac':
      return AV_CODEC_ID_AAC;
    case 'opus':
      return AV_CODEC_ID_OPUS;
    case 'mp3':
      return AV_CODEC_ID_MP3;
    case 'flac':
      return AV_CODEC_ID_FLAC;
    case 'vorbis':
      return AV_CODEC_ID_VORBIS;
    case 'pcm-s16':
      return AV_CODEC_ID_PCM_S16LE;
    case 'pcm-f32':
      return AV_CODEC_ID_PCM_F32LE;
    default:
      return null;
  }
}

function mapSampleFormat(format: AudioSampleFormat): AVSampleFormat {
  switch (format) {
    case 'u8':
      return AV_SAMPLE_FMT_U8;
    case 'u8-planar':
      return AV_SAMPLE_FMT_U8P;
    case 's16':
      return AV_SAMPLE_FMT_S16;
    case 's16-planar':
      return AV_SAMPLE_FMT_S16P;
    case 's32':
      return AV_SAMPLE_FMT_S32;
    case 's32-planar':
      return AV_SAMPLE_FMT_S32P;
    case 'f32':
      return AV_SAMPLE_FMT_FLT;
    case 'f32-planar':
      return AV_SAMPLE_FMT_FLTP;
    default:
      return AV_SAMPLE_FMT_FLT;
  }
}

function sampleFormatToFFmpegName(fmt: AVSampleFormat): string {
  switch (fmt) {
    case AV_SAMPLE_FMT_U8:
      return 'u8';
    case AV_SAMPLE_FMT_U8P:
      return 'u8p';
    case AV_SAMPLE_FMT_S16:
      return 's16';
    case AV_SAMPLE_FMT_S16P:
      return 's16p';
    case AV_SAMPLE_FMT_S32:
      return 's32';
    case AV_SAMPLE_FMT_S32P:
      return 's32p';
    case AV_SAMPLE_FMT_FLTP:
      return 'fltp';
    case AV_SAMPLE_FMT_FLT:
    default:
      return 'flt';
  }
}

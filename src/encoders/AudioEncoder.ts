/**
 * AudioEncoder - Encodes AudioData into EncodedAudioChunks
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { AudioData } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import type { EncodedAudioChunkType } from '../core/EncodedAudioChunk.js';
import { DOMException } from '../types/index.js';
import { createLogger } from '../utils/index.js';
import {
  getAudioEncoderCodec,
  getAudioEncoderFormat,
  getAudioFrameSize,
  AUDIO_ENCODER_CODEC_MAP,
} from '../ffmpeg/audio-codecs.js';
import { buildAudioSpecificConfig, stripAdtsHeader } from '../utils/aac.js';

const logger = createLogger('AudioEncoder');

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
  bitrateMode?: 'constant' | 'variable';
  latencyMode?: 'quality' | 'realtime';
  format?: 'adts' | 'aac';
}

export interface AudioEncoderInit {
  output: (chunk: EncodedAudioChunk, metadata?: AudioEncoderOutputMetadata) => void;
  error: (error: Error) => void;
}

export interface AudioEncoderOutputMetadata {
  decoderConfig?: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    description?: Uint8Array;
  };
}

export interface AudioEncoderSupport {
  supported: boolean;
  config: AudioEncoderConfig;
}

const DEFAULT_FLUSH_TIMEOUT = 30000;

export class AudioEncoder extends EventEmitter {
  private _state: CodecState = 'unconfigured';
  private _encodeQueueSize = 0;
  private _config: AudioEncoderConfig | null = null;
  private _outputCallback: (chunk: EncodedAudioChunk, metadata?: AudioEncoderOutputMetadata) => void;
  private _errorCallback: (error: Error) => void;
  private _process: ChildProcess | null = null;
  private _frameCount = 0;
  private _firstChunk = true;
  private _accumulatedData: Buffer = Buffer.alloc(0);
  private _ffmpegCodec = '';
  private _bitstreamFormat: 'adts' | 'aac' = 'adts';
  private _codecDescription: Uint8Array | null = null;

  constructor(init: AudioEncoderInit) {
    super();

    if (!init || typeof init.output !== 'function') {
      throw new TypeError('output callback is required');
    }
    if (typeof init.error !== 'function') {
      throw new TypeError('error callback is required');
    }

    this._outputCallback = init.output;
    this._errorCallback = init.error;
  }

  get state(): CodecState { return this._state; }
  get encodeQueueSize(): number { return this._encodeQueueSize; }

  private get _isProcessHealthy(): boolean {
    return this._process !== null && this._process.stdin?.writable === true;
  }

  private _safeErrorCallback(error: Error): void {
    try {
      this._errorCallback(error);
    } catch {
      this.emit('callbackError', error);
    }
  }

  private _safeOutputCallback(chunk: EncodedAudioChunk, metadata?: AudioEncoderOutputMetadata): void {
    try {
      this._outputCallback(chunk, metadata);
    } catch (err) {
      this._safeErrorCallback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  static async isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport> {
    if (!config.codec || !config.sampleRate || !config.numberOfChannels) {
      return { supported: false, config };
    }

    const codecBase = config.codec.split('.')[0].toLowerCase();
    const supported = codecBase in AUDIO_ENCODER_CODEC_MAP || config.codec in AUDIO_ENCODER_CODEC_MAP;

    return { supported, config };
  }

  configure(config: AudioEncoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    if (!config || typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    if (typeof config.codec !== 'string' || config.codec.length === 0) {
      throw new TypeError('codec must be a non-empty string');
    }
    if (typeof config.sampleRate !== 'number' || config.sampleRate <= 0 || !Number.isInteger(config.sampleRate)) {
      throw new TypeError('sampleRate must be a positive integer');
    }
    if (typeof config.numberOfChannels !== 'number' || config.numberOfChannels <= 0 || !Number.isInteger(config.numberOfChannels)) {
      throw new TypeError('numberOfChannels must be a positive integer');
    }

    if (config.bitrate !== undefined && (typeof config.bitrate !== 'number' || config.bitrate <= 0)) {
      throw new TypeError('bitrate must be a positive number');
    }
    if (config.bitrateMode !== undefined && !['constant', 'variable'].includes(config.bitrateMode)) {
      throw new TypeError("bitrateMode must be 'constant' or 'variable'");
    }
    if (config.latencyMode !== undefined && !['quality', 'realtime'].includes(config.latencyMode)) {
      throw new TypeError("latencyMode must be 'quality' or 'realtime'");
    }

    const ffmpegCodec = getAudioEncoderCodec(config.codec);
    if (!ffmpegCodec) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (this._process) {
      this._process.kill();
      this._process = null;
    }

    this._config = { ...config };
    this._state = 'configured';
    this._frameCount = 0;
    this._firstChunk = true;
    this._accumulatedData = Buffer.alloc(0);
    this._bitstreamFormat = config.format ?? 'adts';
    this._codecDescription = null;

    this._startFFmpeg();
  }

  encode(data: AudioData): void {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    if (!(data instanceof AudioData)) {
      throw new TypeError('data must be an AudioData');
    }

    if (!this._isProcessHealthy) {
      this._safeErrorCallback(new Error('Encoder process is not healthy'));
      return;
    }

    this._encodeQueueSize++;

    const pcmData = this._audioDataToPCM(data);

    try {
      this._process!.stdin!.write(pcmData);
    } catch {
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      this._safeErrorCallback(new Error('Failed to write audio data to encoder'));
      return;
    }

    this._frameCount += data.numberOfFrames;
  }

  async flush(timeout: number = DEFAULT_FLUSH_TIMEOUT): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    return new Promise((resolve, reject) => {
      if (!this._process) {
        resolve();
        return;
      }

      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this._encodeQueueSize = 0;
        this._frameCount = 0;
        this._firstChunk = true;
        this._accumulatedData = Buffer.alloc(0);
        this._process = null;
        if (this._config) {
          this._startFFmpeg();
        }
        resolve();
      };

      const doReject = (err: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(err);
      };

      timeoutId = setTimeout(() => {
        doReject(new DOMException('Flush operation timed out', 'TimeoutError'));
      }, timeout);

      this._process.once('close', doResolve);
      this._process.once('error', doReject);
      this._process.stdin?.end();
    });
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    this._stopFFmpeg();
    this._state = 'unconfigured';
    this._config = null;
    this._encodeQueueSize = 0;
    this._frameCount = 0;
    this._firstChunk = true;
    this._accumulatedData = Buffer.alloc(0);
    this._codecDescription = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopFFmpeg();
    this._state = 'closed';
    this._config = null;
    this._encodeQueueSize = 0;
    this._codecDescription = null;
  }

  private _startFFmpeg(): void {
    if (!this._config) return;

    // Codec was already validated in configure(), so we can safely use a fallback here
    this._ffmpegCodec = getAudioEncoderCodec(this._config.codec) || 'aac';
    const format = getAudioEncoderFormat(this._ffmpegCodec);

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'f32le',
      '-ar', String(this._config.sampleRate),
      '-ac', String(this._config.numberOfChannels),
      '-i', 'pipe:0',
      '-c:a', this._ffmpegCodec,
    ];

    if (this._config.bitrate) {
      args.push('-b:a', String(this._config.bitrate));
    }

    const isRealtime = this._config.latencyMode === 'realtime';

    if (this._ffmpegCodec === 'libopus') {
      args.push('-application', isRealtime ? 'voip' : 'audio');
      if (isRealtime) {
        args.push('-frame_duration', '10');
      }
      if (this._config.sampleRate !== 48000) {
        args.push('-ar', '48000');
      }
    } else if (this._ffmpegCodec === 'aac') {
      if (isRealtime) {
        args.push('-profile:a', 'aac_low');
      }
    }

    args.push('-f', format, 'pipe:1');

    this._process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this._process.stdout?.on('data', (data: Buffer) => {
      this._accumulatedData = Buffer.concat([this._accumulatedData, data]);
      this._parseEncodedFrames();
    });

    this._process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (!msg.includes('Discarding ID3')) {
        logger.warn('FFmpeg stderr', { message: msg });
      }
    });

    this._process.on('close', () => {
      if (this._accumulatedData.length > 0) {
        this._emitChunk(this._accumulatedData, 'key');
        this._accumulatedData = Buffer.alloc(0);
      }
    });

    this._process.stdin?.on('error', () => {});
  }

  private _stopFFmpeg(): void {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
    }
  }

  private _audioDataToPCM(data: AudioData): Buffer {
    const numFrames = data.numberOfFrames;
    const numChannels = data.numberOfChannels;
    const bufferSize = numFrames * numChannels * 4;
    const buffer = Buffer.alloc(bufferSize);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const isPlanar = data.format.endsWith('-planar');
    const tempBuffer = new Float32Array(numFrames);

    if (isPlanar) {
      for (let ch = 0; ch < numChannels; ch++) {
        data.copyTo(new Uint8Array(tempBuffer.buffer), {
          planeIndex: ch,
          format: 'f32-planar',
        });

        for (let frame = 0; frame < numFrames; frame++) {
          const offset = (frame * numChannels + ch) * 4;
          view.setFloat32(offset, tempBuffer[frame], true);
        }
      }
    } else {
      const srcBuffer = new Uint8Array(bufferSize);
      data.copyTo(srcBuffer, { planeIndex: 0, format: 'f32' });
      buffer.set(srcBuffer);
    }

    return buffer;
  }

  private _parseEncodedFrames(): void {
    const minChunkSize = 64;

    while (this._accumulatedData.length >= minChunkSize) {
      let frameEnd = this._findFrameEnd();

      if (frameEnd > 0) {
        const frameData = Buffer.from(this._accumulatedData.subarray(0, frameEnd));
        this._accumulatedData = this._accumulatedData.subarray(frameEnd);
        this._emitChunk(frameData, 'key');
      } else {
        break;
      }
    }
  }

  private _findFrameEnd(): number {
    if (this._ffmpegCodec === 'aac') {
      return this._findADTSFrame();
    } else if (this._ffmpegCodec === 'libmp3lame') {
      return this._findMP3Frame();
    } else if (this._ffmpegCodec === 'libopus' || this._ffmpegCodec === 'libvorbis') {
      return this._findOggPage();
    } else {
      return Math.min(this._accumulatedData.length, 4096);
    }
  }

  private _findADTSFrame(): number {
    if (this._accumulatedData.length < 7) return 0;

    if ((this._accumulatedData[0] !== 0xFF) || ((this._accumulatedData[1] & 0xF0) !== 0xF0)) {
      for (let i = 1; i < this._accumulatedData.length - 1; i++) {
        if (this._accumulatedData[i] === 0xFF && (this._accumulatedData[i + 1] & 0xF0) === 0xF0) {
          this._accumulatedData = this._accumulatedData.subarray(i);
          return 0;
        }
      }
      return 0;
    }

    const frameLength = ((this._accumulatedData[3] & 0x03) << 11) |
                        (this._accumulatedData[4] << 3) |
                        ((this._accumulatedData[5] & 0xE0) >> 5);

    if (frameLength > this._accumulatedData.length) return 0;
    return frameLength;
  }

  private _findMP3Frame(): number {
    if (this._accumulatedData.length < 4) return 0;

    if (this._accumulatedData[0] !== 0xFF || (this._accumulatedData[1] & 0xE0) !== 0xE0) {
      for (let i = 1; i < this._accumulatedData.length - 1; i++) {
        if (this._accumulatedData[i] === 0xFF && (this._accumulatedData[i + 1] & 0xE0) === 0xE0) {
          this._accumulatedData = this._accumulatedData.subarray(i);
          return 0;
        }
      }
      return 0;
    }

    const header = this._accumulatedData.readUInt32BE(0);
    const bitrateIndex = (header >> 12) & 0x0F;
    const samplingRateIndex = (header >> 10) & 0x03;
    const padding = (header >> 9) & 0x01;

    const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const sampleRates = [44100, 48000, 32000, 0];

    const bitrate = bitrates[bitrateIndex] * 1000;
    const sampleRate = sampleRates[samplingRateIndex];

    if (bitrate === 0 || sampleRate === 0) return 0;

    const frameSize = Math.floor((144 * bitrate) / sampleRate) + padding;

    if (frameSize > this._accumulatedData.length) return 0;
    return frameSize;
  }

  private _findOggPage(): number {
    if (this._accumulatedData.length < 27) return 0;

    if (this._accumulatedData.toString('ascii', 0, 4) !== 'OggS') {
      for (let i = 1; i < this._accumulatedData.length - 3; i++) {
        if (this._accumulatedData.toString('ascii', i, i + 4) === 'OggS') {
          this._accumulatedData = this._accumulatedData.subarray(i);
          return 0;
        }
      }
      return this._accumulatedData.length;
    }

    const numSegments = this._accumulatedData[26];
    if (this._accumulatedData.length < 27 + numSegments) return 0;

    let pageSize = 27 + numSegments;
    for (let i = 0; i < numSegments; i++) {
      pageSize += this._accumulatedData[27 + i];
    }

    if (pageSize > this._accumulatedData.length) return 0;
    return pageSize;
  }

  private _emitChunk(data: Buffer, type: EncodedAudioChunkType): void {
    if (!this._config || data.length === 0) return;

    const samplesPerFrame = getAudioFrameSize(this._ffmpegCodec) || 1024;
    const timestamp = (this._frameCount * 1_000_000) / this._config.sampleRate;
    const duration = (samplesPerFrame * 1_000_000) / this._config.sampleRate;

    let payload: Buffer = data;
    const codecBase = this._config.codec.split('.')[0].toLowerCase();
    const isAac = codecBase === 'mp4a' || codecBase === 'aac';

    if (this._bitstreamFormat === 'aac' && isAac) {
      const stripped = stripAdtsHeader(new Uint8Array(data));
      payload = Buffer.from(stripped);
      if (!this._codecDescription) {
        this._codecDescription = buildAudioSpecificConfig({
          samplingRate: this._config.sampleRate,
          channelConfiguration: this._config.numberOfChannels,
        });
      }
    }

    const chunk = new EncodedAudioChunk({
      type,
      timestamp,
      duration,
      data: new Uint8Array(payload),
    });

    this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
    this.emit('dequeue');

    const metadata: AudioEncoderOutputMetadata | undefined = this._firstChunk
      ? {
          decoderConfig: {
            codec: this._config.codec,
            sampleRate: this._config.sampleRate,
            numberOfChannels: this._config.numberOfChannels,
            description: this._codecDescription ?? undefined,
          },
        }
      : undefined;

    this._firstChunk = false;
    this._safeOutputCallback(chunk, metadata);
  }
}

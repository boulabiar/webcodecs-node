/**
 * AudioDecoder - Decodes EncodedAudioChunks into AudioData
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { AudioData } from '../core/AudioData.js';
import type { AudioSampleFormat } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { DOMException } from '../types/index.js';
import { createLogger } from '../utils/index.js';
import {
  getAudioDecoderInfo,
  getAudioOutputFormatSettings,
  AUDIO_DECODER_CODEC_MAP,
  AUDIO_OUTPUT_FORMAT_MAP,
} from '../ffmpeg/audio-codecs.js';
import type { AacConfig } from '../utils/aac.js';
import { parseAudioSpecificConfig, wrapAacFrameWithAdts } from '../utils/aac.js';

const logger = createLogger('AudioDecoder');

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer | ArrayBufferView;
  outputFormat?: AudioSampleFormat;
}

export interface AudioDecoderInit {
  output: (data: AudioData) => void;
  error: (error: Error) => void;
}

export interface AudioDecoderSupport {
  supported: boolean;
  config: AudioDecoderConfig;
}

const DEFAULT_FLUSH_TIMEOUT = 30000;

export class AudioDecoder extends EventEmitter {
  private _state: CodecState = 'unconfigured';
  private _decodeQueueSize = 0;
  private _config: AudioDecoderConfig | null = null;
  private _outputCallback: (data: AudioData) => void;
  private _errorCallback: (error: Error) => void;
  private _process: ChildProcess | null = null;
  private _accumulatedData: Buffer = Buffer.alloc(0);
  private _frameIndex = 0;
  private _resolveFlush: (() => void) | null = null;
  private _outputFormat: AudioSampleFormat = 'f32';
  private _aacConfig: AacConfig | null = null;

  constructor(init: AudioDecoderInit) {
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
  get decodeQueueSize(): number { return this._decodeQueueSize; }

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

  private _safeOutputCallback(data: AudioData): void {
    try {
      this._outputCallback(data);
    } catch (err) {
      this._safeErrorCallback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  static async isConfigSupported(config: AudioDecoderConfig): Promise<AudioDecoderSupport> {
    if (!config.codec || !config.sampleRate || !config.numberOfChannels) {
      return { supported: false, config };
    }

    const codecBase = config.codec.split('.')[0].toLowerCase();
    const supported = codecBase in AUDIO_DECODER_CODEC_MAP || config.codec in AUDIO_DECODER_CODEC_MAP;

    return { supported, config };
  }

  configure(config: AudioDecoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
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

    const codecBase = config.codec.split('.')[0].toLowerCase();
    if (!(codecBase in AUDIO_DECODER_CODEC_MAP) && !(config.codec in AUDIO_DECODER_CODEC_MAP)) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (config.outputFormat !== undefined && !(config.outputFormat in AUDIO_OUTPUT_FORMAT_MAP)) {
      throw new TypeError(`Invalid outputFormat: ${config.outputFormat}`);
    }

    if (this._process) {
      this._process.kill();
      this._process = null;
    }

    this._config = { ...config };
    this._outputFormat = config.outputFormat ?? 'f32';
    this._state = 'configured';
    this._frameIndex = 0;
    this._accumulatedData = Buffer.alloc(0);
    this._aacConfig = this._parseAacDescription(config);

    this._startFFmpeg();
  }

  decode(chunk: EncodedAudioChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    if (!(chunk instanceof EncodedAudioChunk)) {
      throw new TypeError('chunk must be an EncodedAudioChunk');
    }

    if (!this._isProcessHealthy) {
      this._safeErrorCallback(new Error('Decoder process is not healthy'));
      return;
    }

    this._decodeQueueSize++;

    try {
      let dataToWrite: Buffer | Uint8Array = chunk._rawData;
      if (this._aacConfig) {
        dataToWrite = wrapAacFrameWithAdts(chunk._rawData, this._aacConfig);
      }
      const bufferData = Buffer.isBuffer(dataToWrite) ? dataToWrite : Buffer.from(dataToWrite);
      this._process!.stdin!.write(bufferData);
    } catch {
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
      this._safeErrorCallback(new Error('Failed to write chunk data to decoder'));
    }
  }

  async flush(timeout: number = DEFAULT_FLUSH_TIMEOUT): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
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
        this._resolveFlush = null;
      };

      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
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

      this._resolveFlush = doResolve;
      this._process.once('error', doReject);
      this._process.stdin?.end();
    });
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    this._stopFFmpeg();
    this._state = 'unconfigured';
    this._config = null;
    this._decodeQueueSize = 0;
    this._frameIndex = 0;
    this._accumulatedData = Buffer.alloc(0);
    this._aacConfig = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopFFmpeg();
    this._state = 'closed';
    this._config = null;
    this._decodeQueueSize = 0;
    this._aacConfig = null;
  }

  private _startFFmpeg(): void {
    if (!this._config) return;

    const codecInfo = getAudioDecoderInfo(this._config.codec);
    const outputInfo = getAudioOutputFormatSettings(this._outputFormat);

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', codecInfo.format,
      '-i', 'pipe:0',
      '-f', outputInfo.ffmpegFormat,
      '-ar', String(this._config.sampleRate),
      '-ac', String(this._config.numberOfChannels),
    ];

    if (outputInfo.isPlanar) {
      args.push('-channel_layout', this._getChannelLayout(this._config.numberOfChannels));
    }

    args.push('pipe:1');

    this._process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this._process.stdout?.on('data', (data: Buffer) => {
      this._accumulatedData = Buffer.concat([this._accumulatedData, data]);
      this._emitDecodedFrames();
    });

    this._process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (!msg.includes('Discarding') && !msg.includes('invalid')) {
        logger.warn('FFmpeg stderr', { message: msg });
      }
    });

    this._process.on('close', () => {
      if (this._accumulatedData.length > 0) {
        this._emitAudioData(this._accumulatedData);
        this._accumulatedData = Buffer.alloc(0);
      }

      this._decodeQueueSize = 0;

      const wasFlushing = Boolean(this._resolveFlush);
      if (this._resolveFlush) {
        this._resolveFlush();
        this._resolveFlush = null;
      }

      if (wasFlushing && this._state === 'configured' && this._config) {
        this._process = null;
        this._startFFmpeg();
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

  private _parseAacDescription(config: AudioDecoderConfig): AacConfig | null {
    const codecBase = config.codec.split('.')[0].toLowerCase();
    const isAac = codecBase === 'mp4a' || codecBase === 'aac';

    if (!isAac || !config.description) {
      return null;
    }

    let bytes: Uint8Array;
    if (config.description instanceof ArrayBuffer) {
      bytes = new Uint8Array(config.description);
    } else if (ArrayBuffer.isView(config.description)) {
      bytes = new Uint8Array(
        config.description.buffer,
        config.description.byteOffset,
        config.description.byteLength
      );
    } else {
      return null;
    }

    const copy = new Uint8Array(bytes);

    try {
      return parseAudioSpecificConfig(copy);
    } catch {
      return null;
    }
  }

  private _getChannelLayout(numChannels: number): string {
    switch (numChannels) {
      case 1: return 'mono';
      case 2: return 'stereo';
      case 6: return '5.1';
      case 8: return '7.1';
      default: return `${numChannels}c`;
    }
  }

  private _emitDecodedFrames(): void {
    if (!this._config) return;

    const outputInfo = getAudioOutputFormatSettings(this._outputFormat);
    const samplesPerChunk = Math.floor(this._config.sampleRate * 0.02);
    const bytesPerSample = outputInfo.bytesPerSample;
    const bytesPerChunk = samplesPerChunk * this._config.numberOfChannels * bytesPerSample;

    while (this._accumulatedData.length >= bytesPerChunk) {
      const chunkData = Buffer.from(this._accumulatedData.subarray(0, bytesPerChunk));
      this._accumulatedData = this._accumulatedData.subarray(bytesPerChunk);
      this._emitAudioData(chunkData);
    }
  }

  private _emitAudioData(data: Buffer): void {
    if (!this._config || data.length === 0) return;

    const outputInfo = getAudioOutputFormatSettings(this._outputFormat);
    const bytesPerSample = outputInfo.bytesPerSample;
    const numberOfFrames = Math.floor(data.length / (this._config.numberOfChannels * bytesPerSample));

    if (numberOfFrames === 0) return;

    let outputData: Uint8Array;
    if (outputInfo.isPlanar) {
      outputData = this._convertToplanar(data, numberOfFrames, bytesPerSample);
    } else {
      outputData = new Uint8Array(data);
    }

    const timestamp = (this._frameIndex * 1_000_000) / this._config.sampleRate;

    const audioData = new AudioData({
      format: this._outputFormat,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      numberOfFrames,
      timestamp,
      data: outputData,
    });

    this._frameIndex += numberOfFrames;
    this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
    this.emit('dequeue');

    this._safeOutputCallback(audioData);
  }

  private _convertToplanar(data: Buffer, numberOfFrames: number, bytesPerSample: number): Uint8Array {
    if (!this._config) return new Uint8Array(data);

    const numChannels = this._config.numberOfChannels;
    const result = new Uint8Array(data.length);
    const planeSize = numberOfFrames * bytesPerSample;

    for (let frame = 0; frame < numberOfFrames; frame++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const srcOffset = (frame * numChannels + ch) * bytesPerSample;
        const dstOffset = ch * planeSize + frame * bytesPerSample;

        for (let b = 0; b < bytesPerSample; b++) {
          result[dstOffset + b] = data[srcOffset + b];
        }
      }
    }

    return result;
  }
}

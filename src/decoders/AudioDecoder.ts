/**
 * AudioDecoder - Decodes EncodedAudioChunks into AudioData
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { AudioData } from '../core/AudioData.js';
import type { AudioSampleFormat } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { DOMException } from '../types/index.js';
import {
  AUDIO_DECODER_CODEC_MAP,
  AUDIO_OUTPUT_FORMAT_MAP,
} from '../ffmpeg/audio-codecs.js';
import type { AacConfig } from '../utils/aac.js';
import { parseAudioSpecificConfig } from '../utils/aac.js';
import { NodeAvAudioDecoder } from '../node-av/NodeAvAudioDecoder.js';

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

export class AudioDecoder extends WebCodecsEventTarget {
  private _state: CodecState = 'unconfigured';
  private _decodeQueueSize = 0;
  private _config: AudioDecoderConfig | null = null;
  private _outputCallback: (data: AudioData) => void;
  private _errorCallback: (error: Error) => void;
  private _decoder: NodeAvAudioDecoder | null = null;
  private _frameIndex = 0;
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

    this._stopDecoder();

    this._config = { ...config };
    this._outputFormat = config.outputFormat ?? 'f32';
    this._state = 'configured';
    this._frameIndex = 0;
    this._aacConfig = this._parseAacDescription(config);

    this._startDecoder();
  }

  decode(chunk: EncodedAudioChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    if (!(chunk instanceof EncodedAudioChunk)) {
      throw new TypeError('chunk must be an EncodedAudioChunk');
    }

    if (!this._decoder?.isHealthy) {
      this._safeErrorCallback(new Error('Decoder is not healthy'));
      return;
    }

    this._decodeQueueSize++;

    try {
      const bufferData = Buffer.from(chunk._rawData);
      this._decoder.write(bufferData);
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
      if (!this._decoder) {
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
        this._decodeQueueSize = 0;
        this._frameIndex = 0;
        this._decoder = null;
        if (this._config) {
          this._startDecoder();
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

      this._decoder.once('close', doResolve);
      this._decoder.once('error', doReject);
      this._decoder.end();
    });
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    this._stopDecoder();
    this._state = 'unconfigured';
    this._config = null;
    this._decodeQueueSize = 0;
    this._frameIndex = 0;
    this._aacConfig = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopDecoder();
    this._state = 'closed';
    this._config = null;
    this._decodeQueueSize = 0;
    this._aacConfig = null;
  }

  private _startDecoder(): void {
    if (!this._config) return;

    this._decoder = new NodeAvAudioDecoder();
    this._decoder.startDecoder({
      codec: this._config.codec,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      description: this._config.description,
      outputFormat: this._outputFormat,
    });

    this._decoder.on('frame', (frame: { data: Buffer; numberOfFrames: number; timestamp: number }) => {
      this._handleDecodedFrame(frame);
    });

    this._decoder.on('error', (err: Error) => {
      this._safeErrorCallback(err);
    });
  }

  private _stopDecoder(): void {
    if (this._decoder) {
      this._decoder.kill();
      this._decoder = null;
    }
  }

  private _handleDecodedFrame(frame: { data: Buffer; numberOfFrames: number; timestamp: number }): void {
    if (!this._config) return;

    const timestamp = (this._frameIndex * 1_000_000) / this._config.sampleRate;

    const audioData = new AudioData({
      format: this._outputFormat,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      numberOfFrames: frame.numberOfFrames,
      timestamp,
      data: new Uint8Array(frame.data),
    });

    this._frameIndex += frame.numberOfFrames;
    this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
    this.emit('dequeue');

    this._safeOutputCallback(audioData);
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
}

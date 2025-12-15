/**
 * AudioEncoder - Encodes AudioData into EncodedAudioChunks
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { AudioData } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { DOMException } from '../types/index.js';
import {
  getAudioEncoderCodec,
  getAudioFrameSize,
  AUDIO_ENCODER_CODEC_MAP,
} from '../ffmpeg/audio-codecs.js';
import { buildAudioSpecificConfig, stripAdtsHeader } from '../utils/aac.js';
import { NodeAvAudioEncoder } from '../node-av/NodeAvAudioEncoder.js';

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

export class AudioEncoder extends WebCodecsEventTarget {
  private _state: CodecState = 'unconfigured';
  private _encodeQueueSize = 0;
  private _config: AudioEncoderConfig | null = null;
  private _outputCallback: (chunk: EncodedAudioChunk, metadata?: AudioEncoderOutputMetadata) => void;
  private _errorCallback: (error: Error) => void;
  private _encoder: NodeAvAudioEncoder | null = null;
  private _frameCount = 0;
  private _firstChunk = true;
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

    this._stopEncoder();

    this._config = { ...config };
    this._state = 'configured';
    this._frameCount = 0;
    this._firstChunk = true;
    this._bitstreamFormat = config.format ?? 'adts';
    this._codecDescription = null;

    this._startEncoder();
  }

  encode(data: AudioData): void {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    if (!(data instanceof AudioData)) {
      throw new TypeError('data must be an AudioData');
    }

    if (!this._encoder?.isHealthy) {
      this._safeErrorCallback(new Error('Encoder is not healthy'));
      return;
    }

    this._encodeQueueSize++;

    const pcmData = this._audioDataToPCM(data);

    const writeSuccess = this._encoder.write(pcmData);
    if (!writeSuccess) {
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
      if (!this._encoder) {
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
        this._encoder = null;
        if (this._config) {
          this._startEncoder();
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

      this._encoder.once('close', doResolve);
      this._encoder.once('error', doReject);
      this._encoder.end();
    });
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    this._stopEncoder();
    this._state = 'unconfigured';
    this._config = null;
    this._encodeQueueSize = 0;
    this._frameCount = 0;
    this._firstChunk = true;
    this._codecDescription = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopEncoder();
    this._state = 'closed';
    this._config = null;
    this._encodeQueueSize = 0;
    this._codecDescription = null;
  }

  private _startEncoder(): void {
    if (!this._config) return;

    this._ffmpegCodec = getAudioEncoderCodec(this._config.codec) || 'aac';

    this._encoder = new NodeAvAudioEncoder();
    this._encoder.startEncoder({
      codec: this._config.codec,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      bitrate: this._config.bitrate,
      bitrateMode: this._config.bitrateMode,
      latencyMode: this._config.latencyMode,
    });

    this._encoder.on('encodedFrame', (frame: { data: Buffer; timestamp: number; keyFrame: boolean; description?: Buffer }) => {
      this._handleEncodedFrame(frame);
    });

    this._encoder.on('frameAccepted', () => {
      // Frame has started processing - decrement queue and emit dequeue
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      this.emit('dequeue');
    });

    this._encoder.on('error', (err: Error) => {
      this._safeErrorCallback(err);
    });
  }

  private _stopEncoder(): void {
    if (this._encoder) {
      this._encoder.kill();
      this._encoder = null;
    }
  }

  private _handleEncodedFrame(frame: { data: Buffer; timestamp: number; keyFrame: boolean; description?: Buffer }): void {
    if (!this._config) return;

    const samplesPerFrame = getAudioFrameSize(this._ffmpegCodec) || 1024;
    // Use timestamp from backend (in samples) converted to microseconds
    // Clamp to non-negative (AAC encoder has priming delay causing negative initial timestamps)
    const timestamp = Math.max(0, (frame.timestamp * 1_000_000) / this._config.sampleRate);
    const duration = (samplesPerFrame * 1_000_000) / this._config.sampleRate;

    let payload = frame.data;
    const codecBase = this._config.codec.split('.')[0].toLowerCase();
    const isAac = codecBase === 'mp4a' || codecBase === 'aac';

    // Use description from backend if provided (AAC, FLAC, Vorbis, etc.)
    // For AAC, the backend provides proper AudioSpecificConfig with correct channelConfiguration
    if (frame.description && !this._codecDescription) {
      this._codecDescription = new Uint8Array(frame.description);
    }

    if (this._bitstreamFormat === 'aac' && isAac) {
      const stripped = stripAdtsHeader(new Uint8Array(frame.data));
      payload = Buffer.from(stripped);
      // Only build AudioSpecificConfig if backend didn't provide one
      if (!this._codecDescription) {
        this._codecDescription = buildAudioSpecificConfig({
          samplingRate: this._config.sampleRate,
          channelConfiguration: this._config.numberOfChannels,
        });
      }
    }

    const chunk = new EncodedAudioChunk({
      type: frame.keyFrame ? 'key' : 'delta',
      timestamp,
      duration,
      data: new Uint8Array(payload),
    });

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

  private _audioDataToPCM(data: AudioData): Buffer {
    const numFrames = data.numberOfFrames;
    const numChannels = data.numberOfChannels;
    const format = data.format;

    if (!format) {
      throw new Error('Cannot convert closed AudioData to PCM');
    }

    const bufferSize = numFrames * numChannels * 4;
    const buffer = Buffer.alloc(bufferSize);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const isPlanar = format.endsWith('-planar');
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
}

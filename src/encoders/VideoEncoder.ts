/**
 * VideoEncoder - Encodes VideoFrames into EncodedVideoChunks
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedVideoChunkType } from '../core/EncodedVideoChunk.js';
import { DOMException } from '../types/index.js';
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { isVideoCodecBaseSupported } from '../capabilities/index.js';
import { pixelFormatToFFmpeg } from '../ffmpeg/formats.js';
import { NodeAvVideoEncoder } from '../node-av/NodeAvVideoEncoder.js';

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface VideoEncoderConfig {
  codec: string;
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  bitrate?: number;
  framerate?: number;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  alpha?: 'discard' | 'keep';
  scalabilityMode?: string;
  bitrateMode?: 'constant' | 'variable' | 'quantizer';
  latencyMode?: 'quality' | 'realtime';
  format?: 'annexb' | 'mp4';
}

export interface VideoEncoderInit {
  output: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  error: (error: Error) => void;
}

export interface VideoEncoderOutputMetadata {
  decoderConfig?: {
    codec: string;
    description?: Uint8Array;
    codedWidth?: number;
    codedHeight?: number;
  };
}

export interface VideoEncoderSupport {
  supported: boolean;
  config: VideoEncoderConfig;
}

export interface VideoEncoderEncodeOptions {
  keyFrame?: boolean;
}

const DEFAULT_FLUSH_TIMEOUT = 30000;

export class VideoEncoder extends WebCodecsEventTarget {
  private _state: CodecState = 'unconfigured';
  private _encodeQueueSize = 0;
  private _config: VideoEncoderConfig | null = null;
  private _outputCallback: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  private _errorCallback: (error: Error) => void;
  private _encoder: NodeAvVideoEncoder | null = null;
  private _frameCount = 0;
  private _keyFrameInterval = 30;
  private _pendingFrames: { timestamp: number; duration: number | null; keyFrame: boolean }[] = [];
  private _firstChunk = true;
  private _inputFormat: VideoPixelFormat | null = null;
  private _hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';

  constructor(init: VideoEncoderInit) {
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

  private _safeOutputCallback(chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata): void {
    try {
      this._outputCallback(chunk, metadata);
    } catch (err) {
      this._safeErrorCallback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
    if (!config.codec || !config.width || !config.height) {
      return { supported: false, config };
    }

    const supported = isVideoCodecBaseSupported(config.codec);
    return { supported, config };
  }

  configure(config: VideoEncoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    if (!config || typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    if (typeof config.codec !== 'string' || config.codec.length === 0) {
      throw new TypeError('codec must be a non-empty string');
    }
    if (typeof config.width !== 'number' || config.width <= 0 || !Number.isInteger(config.width)) {
      throw new TypeError('width must be a positive integer');
    }
    if (typeof config.height !== 'number' || config.height <= 0 || !Number.isInteger(config.height)) {
      throw new TypeError('height must be a positive integer');
    }

    if (config.bitrate !== undefined && (typeof config.bitrate !== 'number' || config.bitrate <= 0)) {
      throw new TypeError('bitrate must be a positive number');
    }
    if (config.framerate !== undefined && (typeof config.framerate !== 'number' || config.framerate <= 0)) {
      throw new TypeError('framerate must be a positive number');
    }
    if (config.displayWidth !== undefined && (typeof config.displayWidth !== 'number' || config.displayWidth <= 0)) {
      throw new TypeError('displayWidth must be a positive number');
    }
    if (config.displayHeight !== undefined && (typeof config.displayHeight !== 'number' || config.displayHeight <= 0)) {
      throw new TypeError('displayHeight must be a positive number');
    }

    if (!isVideoCodecBaseSupported(config.codec)) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (this._encoder) {
      this._encoder.kill();
      this._encoder = null;
    }

    this._config = { ...config };
    this._state = 'configured';
    this._frameCount = 0;
    this._firstChunk = true;
    this._pendingFrames = [];
    this._inputFormat = null;
    this._hardwarePreference = config.hardwareAcceleration ?? 'no-preference';
  }

  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    if (!(frame instanceof VideoFrame)) {
      throw new TypeError('frame must be a VideoFrame');
    }

    if (!frame.format) {
      this._safeErrorCallback(new Error('Cannot encode a closed VideoFrame'));
      return;
    }

    if (!this._encoder) {
      this._inputFormat = frame.format;
      const pixFormat = pixelFormatToFFmpeg(frame.format);
      this._startEncoder(pixFormat);
    }

    if (!this._encoder?.isHealthy) {
      this._safeErrorCallback(new Error('Encoder process is not healthy'));
      return;
    }

    if (frame.format !== this._inputFormat) {
      this._safeErrorCallback(new Error(
        `Frame format mismatch: expected ${this._inputFormat}, got ${frame.format}. All frames must use the same pixel format.`
      ));
      return;
    }

    const keyFrame = options?.keyFrame ?? (this._frameCount % this._keyFrameInterval === 0);

    this._encodeQueueSize++;
    this._frameCount++;

    this._pendingFrames.push({
      timestamp: frame.timestamp,
      duration: frame.duration,
      keyFrame,
    });

    const writeSuccess = this._encoder.write(frame._buffer);
    if (!writeSuccess) {
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      this._pendingFrames.pop();
      this._safeErrorCallback(new Error('Failed to write frame data to encoder'));
    }
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
        this._pendingFrames = [];
        this._encoder = null;
        this._inputFormat = null;
        this._frameCount = 0;
        this._firstChunk = true;
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

      this._encoder.end();
      this._encoder.once('close', doResolve);
      this._encoder.once('error', doReject);
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
    this._pendingFrames = [];
    this._frameCount = 0;
    this._firstChunk = true;
    this._inputFormat = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopEncoder();
    this._state = 'closed';
    this._config = null;
    this._encodeQueueSize = 0;
    this._pendingFrames = [];
  }

  private _startEncoder(inputFormat?: string): void {
    if (!this._config) return;

    const pixFormat = inputFormat || 'yuv420p';
    this._encoder = new NodeAvVideoEncoder();

    this._encoder.startEncoder({
      codec: this._config.codec,
      width: this._config.width,
      height: this._config.height,
      inputPixelFormat: pixFormat,
      framerate: this._config.framerate,
      bitrate: this._config.bitrate,
      bitrateMode: this._config.bitrateMode,
      latencyMode: this._config.latencyMode,
      alpha: this._config.alpha,
      hardwareAcceleration: this._hardwarePreference,
    });

    this._encoder.on('encodedFrame', (frame: { data: Buffer; timestamp: number; keyFrame: boolean }) => {
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

    const frameInfo = this._pendingFrames.shift();
    const duration = frameInfo?.duration ?? undefined;

    const framerate = this._config.framerate || 30;
    const timestamp = (frame.timestamp * 1_000_000) / framerate;

    const chunk = new EncodedVideoChunk({
      type: frame.keyFrame ? 'key' : 'delta' as EncodedVideoChunkType,
      timestamp,
      duration,
      data: new Uint8Array(frame.data),
    });

    // Include decoder config with description on first chunk
    const metadata: VideoEncoderOutputMetadata | undefined = this._firstChunk
      ? {
          decoderConfig: {
            codec: this._config.codec,
            codedWidth: this._config.width,
            codedHeight: this._config.height,
            description: frame.description ? new Uint8Array(frame.description) : undefined,
          },
        }
      : undefined;

    this._firstChunk = false;
    this._safeOutputCallback(chunk, metadata);
  }

}

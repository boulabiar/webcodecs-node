/**
 * VideoEncoder - Encodes VideoFrames into EncodedVideoChunks
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedVideoChunkType } from '../core/EncodedVideoChunk.js';
import { DOMException } from '../types/index.js';

type EventHandler = ((event: Event) => void) | null;
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { isVideoCodecBaseSupported } from '../capabilities/index.js';
import { pixelFormatToFFmpeg } from '../codec-utils/formats.js';
import { NodeAvVideoEncoder } from '../node-av/NodeAvVideoEncoder.js';
import { encodingError, wrapAsWebCodecsError } from '../utils/errors.js';

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
const MAX_QUEUE_SIZE = 100; // Prevent unbounded memory growth

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
  private _ondequeue: EventHandler | null = null;
  private _flushPromise: Promise<void> | null = null;

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

  /** Event handler called when encodeQueueSize decreases */
  get ondequeue(): EventHandler { return this._ondequeue; }
  set ondequeue(handler: EventHandler) { this._ondequeue = handler; }

  private _safeErrorCallback(error: Error): void {
    try {
      this._errorCallback(error);
    } catch {
      this.emit('callbackError', error);
    }
  }

  /** Fire the dequeue event (both EventTarget and ondequeue handler) */
  private _fireDequeueEvent(): void {
    queueMicrotask(() => {
      this.emit('dequeue');
      if (this._ondequeue) {
        try {
          this._ondequeue(new Event('dequeue'));
        } catch {
          // Ignore errors in user handler per spec
        }
      }
    });
  }

  private _safeOutputCallback(chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata): void {
    try {
      this._outputCallback(chunk, metadata);
    } catch (err) {
      this._safeErrorCallback(wrapAsWebCodecsError(err, 'EncodingError'));
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

    // Validate even dimensions for hardware encoder compatibility
    // Many hardware encoders (NVENC, QuickSync, VideoToolbox) fail silently with odd dimensions
    if (config.width % 2 !== 0 || config.height % 2 !== 0) {
      const oddDims: string[] = [];
      if (config.width % 2 !== 0) oddDims.push(`width=${config.width}`);
      if (config.height % 2 !== 0) oddDims.push(`height=${config.height}`);
      throw new TypeError(
        `Dimensions must be even for video encoding (${oddDims.join(', ')}). ` +
        `Most video codecs require even dimensions for YUV420 chroma subsampling. ` +
        `Use ensureEvenDimensions() to auto-fix odd dimensions.`
      );
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

    // Prevent encoding during flush to avoid race conditions
    if (this._flushPromise) {
      throw new DOMException(
        'Cannot encode while flush is pending. Wait for flush() to complete.',
        'InvalidStateError'
      );
    }

    if (!(frame instanceof VideoFrame)) {
      throw new TypeError('frame must be a VideoFrame');
    }

    if (!frame.format) {
      this._safeErrorCallback(encodingError('Cannot encode a closed VideoFrame'));
      return;
    }

    if (!this._encoder) {
      this._inputFormat = frame.format;
      const pixFormat = pixelFormatToFFmpeg(frame.format);
      this._startEncoder(pixFormat);
    }

    if (!this._encoder?.isHealthy) {
      this._safeErrorCallback(encodingError('Encoder process is not healthy'));
      return;
    }

    if (frame.format !== this._inputFormat) {
      this._safeErrorCallback(encodingError(
        `Frame format mismatch: expected ${this._inputFormat}, got ${frame.format}. All frames must use the same pixel format.`
      ));
      return;
    }

    // Check queue saturation to prevent unbounded memory growth
    if (this._encodeQueueSize >= MAX_QUEUE_SIZE) {
      this._safeErrorCallback(new DOMException(
        `Encoder queue saturated (${MAX_QUEUE_SIZE} frames pending). Wait for dequeue events before encoding more frames.`,
        'QuotaExceededError'
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

    const nativeFrame = (frame as any)._native ?? null;
    const writeSuccess = nativeFrame
      ? this._encoder.writeFrame(nativeFrame)
      : this._encoder.write(frame._buffer);
    if (!writeSuccess) {
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      this._pendingFrames.pop();
      this._safeErrorCallback(encodingError('Failed to write frame data to encoder'));
    }
  }

  async flush(timeout: number = DEFAULT_FLUSH_TIMEOUT): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    // If flush is already pending, return the existing promise
    if (this._flushPromise) {
      return this._flushPromise;
    }

    this._flushPromise = new Promise<void>((resolve, reject) => {
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
        this._flushPromise = null;
        resolve();
      };

      const doReject = (err: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this._flushPromise = null;
        reject(err);
      };

      timeoutId = setTimeout(() => {
        doReject(new DOMException('Flush operation timed out', 'TimeoutError'));
      }, timeout);

      this._encoder.end();
      this._encoder.once('close', doResolve);
      this._encoder.once('error', doReject);
    });

    return this._flushPromise;
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
    this._flushPromise = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopEncoder();
    this._state = 'closed';
    this._config = null;
    this._encodeQueueSize = 0;
    this._pendingFrames = [];
    this._flushPromise = null;
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
      format: this._config.format,
    });

    this._encoder.on('encodedFrame', (frame: { data: Buffer; timestamp: number; keyFrame: boolean }) => {
      this._handleEncodedFrame(frame);
    });

    this._encoder.on('frameAccepted', () => {
      // Frame has started processing - decrement queue and fire dequeue event
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      this._fireDequeueEvent();
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

    // Use the original timestamp from the input frame (stored in pendingFrames)
    // Fall back to calculated timestamp only if frameInfo is not available
    let timestamp: number;
    if (frameInfo?.timestamp !== undefined) {
      timestamp = frameInfo.timestamp;
    } else {
      // Legacy fallback: calculate from frame index
      const framerate = this._config.framerate || 30;
      timestamp = Math.round((frame.timestamp * 1_000_000) / framerate);
    }

    // Determine if this is a keyframe:
    // - If the encoder produced a keyframe (frame.keyFrame), it's definitely a key
    // - If user explicitly requested a keyframe (frameInfo.keyFrame), honor that
    // - Note: Some encoders may not honor keyframe requests immediately due to
    //   internal buffering, but we report what was requested for spec compliance
    const isKeyFrame = frame.keyFrame || (frameInfo?.keyFrame ?? false);

    const chunk = new EncodedVideoChunk({
      type: isKeyFrame ? 'key' : 'delta' as EncodedVideoChunkType,
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

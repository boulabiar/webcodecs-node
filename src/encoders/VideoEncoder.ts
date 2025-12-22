/**
 * VideoEncoder - Encodes VideoFrames into EncodedVideoChunks
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
 */

import { EventEmitter } from 'events';
import { VideoFrame } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedVideoChunkType } from '../core/EncodedVideoChunk.js';
import { FFmpegProcess } from '../FFmpegProcess.js';
import { DOMException } from '../types/index.js';
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { isVideoCodecBaseSupported } from '../capabilities/index.js';
import { pixelFormatToFFmpeg } from '../ffmpeg/formats.js';
import {
  convertAnnexBToAvcc,
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
} from '../utils/avc.js';
import {
  convertAnnexBToHvcc,
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
} from '../utils/hevc.js';
import type { HardwareAccelerationMethod } from '../hardware/index.js';
import {
  getBestEncoderSync,
  getEncoderArgs,
  parseCodecString,
} from '../hardware/index.js';

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

export class VideoEncoder extends EventEmitter {
  private _state: CodecState = 'unconfigured';
  private _encodeQueueSize = 0;
  private _config: VideoEncoderConfig | null = null;
  private _outputCallback: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  private _errorCallback: (error: Error) => void;
  private _ffmpeg: FFmpegProcess | null = null;
  private _frameCount = 0;
  private _keyFrameInterval = 30;
  private _pendingFrames: { timestamp: number; duration: number | null; keyFrame: boolean }[] = [];
  private _encodedBuffer: Buffer = Buffer.alloc(0);
  private _firstChunk = true;
  private _inputFormat: VideoPixelFormat | null = null;
  private _bitstreamFormat: 'annexb' | 'mp4' = 'annexb';
  private _codecDescription: Uint8Array | null = null;
  private _hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';
  private _hardwareEncoderSelection: {
    encoder: string;
    hwaccel: HardwareAccelerationMethod | null;
    isHardware: boolean;
  } | null = null;

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

    if (this._ffmpeg) {
      this._ffmpeg.kill();
      this._ffmpeg = null;
    }

    this._config = { ...config };
    this._state = 'configured';
    this._frameCount = 0;
    this._firstChunk = true;
    this._pendingFrames = [];
    this._encodedBuffer = Buffer.alloc(0);
    this._inputFormat = null;
    this._codecDescription = null;
    this._bitstreamFormat = config.format ?? 'annexb';

    this._hardwarePreference = config.hardwareAcceleration ?? 'no-preference';
    this._hardwareEncoderSelection = null;

    if (this._hardwarePreference === 'prefer-hardware') {
      this._hardwareEncoderSelection = this._selectHardwareEncoder(config.codec);
    }
  }

  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    if (!(frame instanceof VideoFrame)) {
      throw new TypeError('frame must be a VideoFrame');
    }

    if (!this._ffmpeg) {
      this._inputFormat = frame.format;
      const ffmpegFormat = pixelFormatToFFmpeg(frame.format);
      this._startFFmpeg(ffmpegFormat);
    }

    if (!this._ffmpeg?.isHealthy) {
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

    const writeSuccess = this._ffmpeg.write(frame._buffer);
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
      if (!this._ffmpeg) {
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
        if (this._encodedBuffer.length > 0) {
          this._emitEncodedChunk(this._encodedBuffer);
          this._encodedBuffer = Buffer.alloc(0);
        }
        this._encodeQueueSize = 0;
        this._pendingFrames = [];
        this._ffmpeg = null;
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

      this._ffmpeg.end();
      this._ffmpeg.once('close', doResolve);
      this._ffmpeg.once('error', doReject);
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
    this._pendingFrames = [];
    this._frameCount = 0;
    this._encodedBuffer = Buffer.alloc(0);
    this._firstChunk = true;
    this._inputFormat = null;
    this._codecDescription = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopFFmpeg();
    this._state = 'closed';
    this._config = null;
    this._encodeQueueSize = 0;
    this._pendingFrames = [];
    this._codecDescription = null;
  }

  private _startFFmpeg(inputFormat?: string): void {
    if (!this._config) return;

    this._ffmpeg = new FFmpegProcess();
    const ffmpegFormat = inputFormat || 'yuv420p';

    const hardwareArgs = this._getHardwareEncoderArgs();

    this._ffmpeg.startEncoder({
      codec: this._config.codec,
      width: this._config.width,
      height: this._config.height,
      inputPixelFormat: ffmpegFormat,
      framerate: this._config.framerate,
      bitrate: this._config.bitrate,
      bitrateMode: this._config.bitrateMode,
      latencyMode: this._config.latencyMode,
      alpha: this._config.alpha,
      hardwareEncoderArgs: hardwareArgs ?? undefined,
    });

    this._ffmpeg.on('encodedFrame', (frame: { data: Buffer; timestamp: number; keyFrame: boolean }) => {
      this._handleEncodedFrame(frame);
    });

    this._ffmpeg.on('data', (data: Buffer) => {
      this._handleEncodedData(data);
    });

    this._ffmpeg.on('error', (err: Error) => {
      this._safeErrorCallback(err);
    });
  }

  private _stopFFmpeg(): void {
    if (this._ffmpeg) {
      this._ffmpeg.kill();
      this._ffmpeg = null;
    }
  }

  private _selectHardwareEncoder(codec: string): {
    encoder: string;
    hwaccel: HardwareAccelerationMethod | null;
    isHardware: boolean;
  } | null {
    const codecName = parseCodecString(codec);
    if (!codecName) {
      return null;
    }

    try {
      const selection = getBestEncoderSync(codecName, 'prefer-hardware');
      return selection.isHardware ? selection : null;
    } catch {
      return null;
    }
  }

  private _getHardwareEncoderArgs(): string[] | null {
    if (!this._config) return null;
    if (this._hardwarePreference !== 'prefer-hardware') return null;
    if (!this._hardwareEncoderSelection?.isHardware) return null;

    try {
      return getEncoderArgs(
        this._hardwareEncoderSelection.encoder,
        this._hardwareEncoderSelection.hwaccel,
        this._buildHardwareEncoderOptions()
      );
    } catch {
      this._hardwareEncoderSelection = null;
      return null;
    }
  }

  private _buildHardwareEncoderOptions(): { bitrate?: number; quality?: number; preset?: string } {
    if (!this._config) {
      return {};
    }

    const options: { bitrate?: number; quality?: number; preset?: string } = {};

    if (this._config.bitrate) {
      options.bitrate = this._config.bitrate;
    }

    if (this._config.bitrateMode === 'quantizer') {
      options.quality = 23;
    }

    if (this._config.latencyMode === 'realtime') {
      options.preset = 'p1';
    }

    return options;
  }

  private _handleEncodedFrame(frame: { data: Buffer; timestamp: number; keyFrame: boolean }): void {
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

    this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
    this.emit('dequeue');

    const metadata: VideoEncoderOutputMetadata | undefined = this._firstChunk
      ? { decoderConfig: { codec: this._config.codec, codedWidth: this._config.width, codedHeight: this._config.height } }
      : undefined;

    this._firstChunk = false;
    this._safeOutputCallback(chunk, metadata);
  }

  private _handleEncodedData(data: Buffer): void {
    this._encodedBuffer = Buffer.concat([this._encodedBuffer, data]);

    if (this._encodedBuffer.length > 4096) {
      this._emitEncodedChunk(this._encodedBuffer);
      this._encodedBuffer = Buffer.alloc(0);
    }
  }

  private _emitEncodedChunk(data: Buffer): void {
    if (!this._config || data.length === 0) return;

    const frameInfo = this._pendingFrames.shift();
    const timestamp = frameInfo?.timestamp ?? 0;
    const duration = frameInfo?.duration ?? undefined;
    const isKeyFrame = frameInfo?.keyFrame ?? this._firstChunk;

    let payload: Buffer = data;
    const codecBase = this._config.codec.split('.')[0].toLowerCase();

    if (this._bitstreamFormat === 'mp4') {
      const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (codecBase === 'avc1' || codecBase === 'avc3') {
        if (!this._codecDescription) {
          const { sps, pps } = extractAvcParameterSetsFromAnnexB(view);
          if (sps.length && pps.length) {
            this._codecDescription = buildAvcDecoderConfig(sps, pps);
          }
        }
        payload = convertAnnexBToAvcc(view);
      } else if (codecBase === 'hev1' || codecBase === 'hvc1') {
        if (!this._codecDescription) {
          const { vps, sps, pps } = extractHevcParameterSetsFromAnnexB(view);
          if (sps.length && pps.length) {
            this._codecDescription = buildHvccDecoderConfig(vps, sps, pps);
          }
        }
        payload = convertAnnexBToHvcc(view);
      }
    }

    const chunk = new EncodedVideoChunk({
      type: isKeyFrame ? 'key' : 'delta' as EncodedVideoChunkType,
      timestamp,
      duration,
      data: new Uint8Array(payload),
    });

    this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
    this.emit('dequeue');

    const metadata: VideoEncoderOutputMetadata | undefined = this._firstChunk
      ? {
          decoderConfig: {
            codec: this._config.codec,
            codedWidth: this._config.width,
            codedHeight: this._config.height,
            description: this._codecDescription ?? undefined,
          },
        }
      : undefined;

    this._firstChunk = false;
    this._safeOutputCallback(chunk, metadata);
  }
}

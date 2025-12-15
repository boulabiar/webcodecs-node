/**
 * VideoDecoder - Decodes encoded video chunks into VideoFrames
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { Buffer } from 'buffer';
import { VideoFrame } from '../core/VideoFrame.js';
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { NodeAvVideoDecoder } from '../node-av/NodeAvVideoDecoder.js';
import { DOMException } from '../types/index.js';
import type { VideoColorSpaceInit } from '../formats/index.js';
import { isVideoCodecBaseSupported } from '../capabilities/index.js';
import { pixelFormatToFFmpeg } from '../ffmpeg/formats.js';
import type { AvcConfig } from '../utils/avc.js';
import { convertAvccToAnnexB, parseAvcDecoderConfig } from '../utils/avc.js';
import type { HvccConfig } from '../utils/hevc.js';
import { convertHvccToAnnexB, parseHvccDecoderConfig } from '../utils/hevc.js';

const SUPPORTED_OUTPUT_FORMATS: VideoPixelFormat[] = [
  'I420', 'I420A', 'I422', 'I444', 'NV12', 'RGBA', 'RGBX', 'BGRA', 'BGRX'
];

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface VideoDecoderConfig {
  codec: string;
  description?: ArrayBuffer | ArrayBufferView;
  codedWidth?: number;
  codedHeight?: number;
  displayAspectWidth?: number;
  displayAspectHeight?: number;
  colorSpace?: VideoColorSpaceInit;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  optimizeForLatency?: boolean;
  outputFormat?: VideoPixelFormat;
}

export interface VideoDecoderInit {
  output: (frame: VideoFrame) => void;
  error: (error: Error) => void;
}

export interface VideoDecoderSupport {
  supported: boolean;
  config: VideoDecoderConfig;
}

const DEFAULT_FLUSH_TIMEOUT = 30000;

export class VideoDecoder extends WebCodecsEventTarget {
  private _state: CodecState = 'unconfigured';
  private _decodeQueueSize = 0;
  private _config: VideoDecoderConfig | null = null;
  private _outputCallback: (frame: VideoFrame) => void;
  private _errorCallback: (error: Error) => void;
  private _decoder: NodeAvVideoDecoder | null = null;
  private _frameTimestamp = 0;
  private _frameDuration = 0;
  private _pendingChunks: { timestamp: number; duration: number | null }[] = [];
  private _outputFormat: VideoPixelFormat = 'I420';
  private _avcConfig: AvcConfig | null = null;
  private _hevcConfig: HvccConfig | null = null;
  private _hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';

  constructor(init: VideoDecoderInit) {
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

  private _safeOutputCallback(frame: VideoFrame): void {
    try {
      this._outputCallback(frame);
    } catch (err) {
      this._safeErrorCallback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  static async isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport> {
    if (!config.codec) {
      return { supported: false, config };
    }

    const supported = isVideoCodecBaseSupported(config.codec);
    return { supported, config };
  }

  configure(config: VideoDecoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    if (!config || typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    if (typeof config.codec !== 'string' || config.codec.length === 0) {
      throw new TypeError('codec must be a non-empty string');
    }

    if (config.codedWidth !== undefined && (typeof config.codedWidth !== 'number' || config.codedWidth <= 0)) {
      throw new TypeError('codedWidth must be a positive number');
    }
    if (config.codedHeight !== undefined && (typeof config.codedHeight !== 'number' || config.codedHeight <= 0)) {
      throw new TypeError('codedHeight must be a positive number');
    }

    if (!isVideoCodecBaseSupported(config.codec)) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (config.outputFormat !== undefined && !SUPPORTED_OUTPUT_FORMATS.includes(config.outputFormat)) {
      throw new TypeError(`Invalid outputFormat: ${config.outputFormat}`);
    }

    if (this._decoder) {
      this._decoder.kill();
      this._decoder = null;
    }

    this._config = { ...config };
    this._outputFormat = config.outputFormat ?? 'I420';
    this._state = 'configured';
    this._pendingChunks = [];
    this._avcConfig = this._parseAvcDescription(config);
    this._hevcConfig = this._parseHevcDescription(config);
    this._hardwarePreference = config.hardwareAcceleration ?? 'no-preference';

    if (config.codedWidth && config.codedHeight) {
      this._startDecoder();
    }
  }

  decode(chunk: EncodedVideoChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    if (!(chunk instanceof EncodedVideoChunk)) {
      throw new TypeError('chunk must be an EncodedVideoChunk');
    }

    if (!this._decoder?.isHealthy) {
      if (!this._decoder) {
        this._safeErrorCallback(new Error('Decoder not fully initialized - missing dimensions'));
      } else {
        this._safeErrorCallback(new Error('Decoder process is not healthy'));
      }
      return;
    }

    this._decodeQueueSize++;

    this._pendingChunks.push({
      timestamp: chunk.timestamp,
      duration: chunk.duration,
    });

    let dataToWrite: Buffer | Uint8Array = chunk._buffer;

    const codecBase = this._config?.codec.split('.')[0].toLowerCase();
    if (codecBase) {
      if (this._avcConfig && (codecBase === 'avc1' || codecBase === 'avc3')) {
        const includeParameterSets = chunk.type === 'key';
        dataToWrite = convertAvccToAnnexB(chunk._buffer, this._avcConfig, includeParameterSets);
      } else if (this._hevcConfig && (codecBase === 'hvc1' || codecBase === 'hev1')) {
        const includeParameterSets = chunk.type === 'key';
        dataToWrite = convertHvccToAnnexB(chunk._buffer, this._hevcConfig, includeParameterSets);
      }
    }

    const bufferData = Buffer.isBuffer(dataToWrite) ? dataToWrite : Buffer.from(dataToWrite);
    const writeSuccess = this._decoder.write(bufferData);

    if (!writeSuccess) {
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
      this._pendingChunks.pop();
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
        this._pendingChunks = [];
        this._decoder = null;
        if (this._config?.codedWidth && this._config?.codedHeight) {
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

      this._decoder.end();
      this._decoder.once('close', doResolve);
      this._decoder.once('error', doReject);
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
    this._pendingChunks = [];
    this._avcConfig = null;
    this._hevcConfig = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopDecoder();
    this._state = 'closed';
    this._config = null;
    this._decodeQueueSize = 0;
    this._pendingChunks = [];
    this._avcConfig = null;
    this._hevcConfig = null;
  }

  private _startDecoder(): void {
    if (!this._config?.codedWidth || !this._config?.codedHeight) return;

    const pixFmt = pixelFormatToFFmpeg(this._outputFormat);

    // Don't pass HVCC/AVCC description to backend when we convert to Annex B
    // because VPS/SPS/PPS are already included in the converted keyframe data.
    // Passing HVCC extradata makes FFmpeg expect length-prefixed packets.
    const shouldPassDescription = !this._avcConfig && !this._hevcConfig;
    const description = shouldPassDescription ? this._getDescriptionBuffer() : null;

    this._decoder = new NodeAvVideoDecoder();

    this._decoder.startDecoder({
      codec: this._config.codec,
      width: this._config.codedWidth,
      height: this._config.codedHeight,
      framerate: this._config.optimizeForLatency ? 60 : 30,
      outputPixelFormat: pixFmt,
      description: description ?? undefined,
      hardwareAcceleration: this._hardwarePreference,
    });

    this._decoder.on('frame', (data: Buffer) => {
      this._handleDecodedFrame(data);
    });

    this._decoder.on('chunkAccepted', () => {
      // Chunk has started processing - decrement queue and emit dequeue
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
      this.emit('dequeue');
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

  private _parseAvcDescription(config: VideoDecoderConfig): AvcConfig | null {
    if (!config.description) {
      return null;
    }

    const codecBase = config.codec.split('.')[0].toLowerCase();
    if (codecBase !== 'avc1' && codecBase !== 'avc3') {
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
      return parseAvcDecoderConfig(copy);
    } catch {
      return null;
    }
  }

  private _parseHevcDescription(config: VideoDecoderConfig): HvccConfig | null {
    if (!config.description) {
      return null;
    }

    const codecBase = config.codec.split('.')[0].toLowerCase();
    if (codecBase !== 'hvc1' && codecBase !== 'hev1') {
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
      return parseHvccDecoderConfig(copy);
    } catch {
      return null;
    }
  }

  private _getDescriptionBuffer(): Uint8Array | null {
    if (!this._config?.description) {
      return null;
    }

    if (this._config.description instanceof ArrayBuffer) {
      return new Uint8Array(this._config.description);
    }

    if (ArrayBuffer.isView(this._config.description)) {
      return new Uint8Array(
        this._config.description.buffer,
        this._config.description.byteOffset,
        this._config.description.byteLength
      );
    }

    return null;
  }

  private _handleDecodedFrame(data: Buffer): void {
    if (!this._config) return;

    const chunkInfo = this._pendingChunks.shift();
    const timestamp = chunkInfo?.timestamp ?? this._frameTimestamp;
    const duration = chunkInfo?.duration ?? this._frameDuration;

    const frame = new VideoFrame(data, {
      format: this._outputFormat,
      codedWidth: this._config.codedWidth!,
      codedHeight: this._config.codedHeight!,
      timestamp,
      duration: duration ?? undefined,
      colorSpace: this._config.colorSpace,
    });

    this._safeOutputCallback(frame);
  }
}

/**
 * VideoDecoder - Decodes encoded video chunks into VideoFrames
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder
 */

import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { VideoFrame } from '../core/VideoFrame.js';
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { FFmpegProcess } from '../FFmpegProcess.js';
import { DOMException } from '../types/index.js';
import type { VideoColorSpaceInit } from '../formats/index.js';
import { isVideoCodecBaseSupported } from '../capabilities/index.js';
import { pixelFormatToFFmpeg } from '../ffmpeg/formats.js';
import type { AvcConfig } from '../utils/avc.js';
import { convertAvccToAnnexB, parseAvcDecoderConfig } from '../utils/avc.js';
import type { HvccConfig } from '../utils/hevc.js';
import { convertHvccToAnnexB, parseHvccDecoderConfig } from '../utils/hevc.js';
import type { HardwareAccelerationMethod } from '../hardware/index.js';
import {
  getBestDecoderSync,
  getDecoderArgs,
  parseCodecString,
} from '../hardware/index.js';

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

export class VideoDecoder extends EventEmitter {
  private _state: CodecState = 'unconfigured';
  private _decodeQueueSize = 0;
  private _config: VideoDecoderConfig | null = null;
  private _outputCallback: (frame: VideoFrame) => void;
  private _errorCallback: (error: Error) => void;
  private _ffmpeg: FFmpegProcess | null = null;
  private _frameTimestamp = 0;
  private _frameDuration = 0;
  private _pendingChunks: { timestamp: number; duration: number | null }[] = [];
  private _useIvf = false;
  private _ivfHeaderSent = false;
  private _frameIndex = 0;
  private _outputFormat: VideoPixelFormat = 'I420';
  private _avcConfig: AvcConfig | null = null;
  private _hevcConfig: HvccConfig | null = null;
  private _hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';
  private _hardwareDecoderSelection: {
    decoder: string | null;
    hwaccel: HardwareAccelerationMethod | null;
    isHardware: boolean;
  } | null = null;

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

    if (this._ffmpeg) {
      this._ffmpeg.kill();
      this._ffmpeg = null;
    }

    this._config = { ...config };
    this._outputFormat = config.outputFormat ?? 'I420';
    this._state = 'configured';
    this._pendingChunks = [];
    this._ivfHeaderSent = false;
    this._frameIndex = 0;
    this._avcConfig = this._parseAvcDescription(config);
    this._hevcConfig = this._parseHevcDescription(config);
    this._hardwarePreference = config.hardwareAcceleration ?? 'no-preference';
    this._hardwareDecoderSelection = null;

    if (this._hardwarePreference === 'prefer-hardware') {
      this._hardwareDecoderSelection = this._selectHardwareDecoder(config.codec);
    }

    if (config.codedWidth && config.codedHeight) {
      this._startFFmpeg();
    }
  }

  decode(chunk: EncodedVideoChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    if (!(chunk instanceof EncodedVideoChunk)) {
      throw new TypeError('chunk must be an EncodedVideoChunk');
    }

    if (!this._ffmpeg?.isHealthy) {
      if (!this._ffmpeg) {
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

    let writeSuccess = false;
    let dataToWrite: Buffer | Uint8Array = chunk._buffer;

    const codecBase = this._config?.codec.split('.')[0].toLowerCase();
    if (!this._useIvf && codecBase) {
      if (this._avcConfig && (codecBase === 'avc1' || codecBase === 'avc3')) {
        const includeParameterSets = chunk.type === 'key';
        dataToWrite = convertAvccToAnnexB(chunk._buffer, this._avcConfig, includeParameterSets);
      } else if (this._hevcConfig && (codecBase === 'hvc1' || codecBase === 'hev1')) {
        const includeParameterSets = chunk.type === 'key';
        dataToWrite = convertHvccToAnnexB(chunk._buffer, this._hevcConfig, includeParameterSets);
      }
    }

    if (this._useIvf) {
      writeSuccess = this._writeIvfFrame(chunk._buffer, this._frameIndex++);
    } else {
      const bufferData = Buffer.isBuffer(dataToWrite) ? dataToWrite : Buffer.from(dataToWrite);
      writeSuccess = this._ffmpeg.write(bufferData);
    }

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
        this._decodeQueueSize = 0;
        this._pendingChunks = [];
        this._frameIndex = 0;
        this._ivfHeaderSent = false;
        this._ffmpeg = null;
        if (this._config?.codedWidth && this._config?.codedHeight) {
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

      this._ffmpeg.end();
      this._ffmpeg.once('close', doResolve);
      this._ffmpeg.once('error', doReject);
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
    this._pendingChunks = [];
    this._avcConfig = null;
    this._hevcConfig = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopFFmpeg();
    this._state = 'closed';
    this._config = null;
    this._decodeQueueSize = 0;
    this._pendingChunks = [];
    this._avcConfig = null;
    this._hevcConfig = null;
  }

  private _startFFmpeg(): void {
    if (!this._config?.codedWidth || !this._config?.codedHeight) return;

    const codecBase = this._config.codec.split('.')[0].toLowerCase();
    this._useIvf = ['vp8', 'vp9', 'vp09', 'av01', 'av1'].includes(codecBase);
    this._ivfHeaderSent = false;
    this._frameIndex = 0;

    this._ffmpeg = new FFmpegProcess();

    const ffmpegPixFmt = pixelFormatToFFmpeg(this._outputFormat);
    const hardwareOptions = this._getHardwareDecoderArgs(ffmpegPixFmt);

    this._ffmpeg.startDecoder({
      codec: this._config.codec,
      width: this._config.codedWidth,
      height: this._config.codedHeight,
      outputPixelFormat: ffmpegPixFmt,
      hardwareDecoderArgs: hardwareOptions.args ?? undefined,
      hardwareDownloadFilter: hardwareOptions.filter ?? undefined,
    });

    this._ffmpeg.on('frame', (data: Buffer) => {
      this._handleDecodedFrame(data);
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

  private _selectHardwareDecoder(codec: string): {
    decoder: string | null;
    hwaccel: HardwareAccelerationMethod | null;
    isHardware: boolean;
  } | null {
    const codecName = parseCodecString(codec);
    if (!codecName) {
      return null;
    }

    try {
      const selection = getBestDecoderSync(codecName, 'prefer-hardware');
      return selection.isHardware ? selection : null;
    } catch {
      return null;
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

  private _getHardwareDecoderArgs(ffmpegPixFmt: string): { args: string[] | null; filter: string | null } {
    if (!this._config) {
      return { args: null, filter: null };
    }

    if (this._hardwarePreference !== 'prefer-hardware') {
      return { args: null, filter: null };
    }

    if (!this._hardwareDecoderSelection?.isHardware) {
      return { args: null, filter: null };
    }

    try {
      const args = getDecoderArgs(
        this._hardwareDecoderSelection.decoder,
        this._hardwareDecoderSelection.hwaccel
      );

      const needsDownload = ['vaapi', 'cuda', 'qsv'].includes(
        this._hardwareDecoderSelection.hwaccel ?? 'none'
      );
      const filter = needsDownload ? `hwdownload,format=${ffmpegPixFmt}` : null;

      return { args, filter };
    } catch {
      this._hardwareDecoderSelection = null;
      return { args: null, filter: null };
    }
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

    this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
    this.emit('dequeue');

    this._safeOutputCallback(frame);
  }

  private _writeIvfHeader(): void {
    if (!this._config || !this._ffmpeg) return;

    const header = Buffer.alloc(32);
    header.write('DKIF', 0);
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(32, 6);

    const codecBase = this._config.codec.split('.')[0].toLowerCase();
    if (codecBase === 'vp8') {
      header.write('VP80', 8);
    } else if (codecBase === 'vp9' || codecBase === 'vp09') {
      header.write('VP90', 8);
    } else if (codecBase === 'av01' || codecBase === 'av1') {
      header.write('AV01', 8);
    }

    header.writeUInt16LE(this._config.codedWidth!, 12);
    header.writeUInt16LE(this._config.codedHeight!, 14);
    header.writeUInt32LE(30, 16);
    header.writeUInt32LE(1, 20);
    header.writeUInt32LE(0, 24);
    header.writeUInt32LE(0, 28);

    this._ffmpeg.write(header);
    this._ivfHeaderSent = true;
  }

  private _writeIvfFrame(data: Uint8Array, frameIndex: number): boolean {
    if (!this._ffmpeg) return false;

    if (!this._ivfHeaderSent) {
      this._writeIvfHeader();
    }

    const frameHeader = Buffer.alloc(12);
    frameHeader.writeUInt32LE(data.length, 0);
    const timestamp = BigInt(frameIndex);
    frameHeader.writeBigUInt64LE(timestamp, 4);

    const headerSuccess = this._ffmpeg.write(frameHeader);
    const dataSuccess = this._ffmpeg.write(Buffer.from(data));
    return headerSuccess && dataSuccess;
  }
}

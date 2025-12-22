/**
 * ImageDecoder - Decodes encoded image data to VideoFrames
 * https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder
 */

import { VideoFrame } from '../core/VideoFrame.js';
import { DOMException } from '../types/index.js';
import { createLogger } from '../utils/index.js';
import type { VideoColorSpaceInit } from '../formats/index.js';
import { NodeAvImageDecoder } from '../node-av/NodeAvImageDecoder.js';
import { WebPImageDecoder } from '../node-av/WebPImageDecoder.js';

const logger = createLogger('ImageDecoder');

export type ColorSpaceConversion = 'none' | 'default';
export type PremultiplyAlpha = 'none' | 'premultiply' | 'default';

export interface ImageDecoderInit {
  type: string;
  data: ArrayBuffer | ArrayBufferView | ReadableStream<ArrayBufferView>;
  colorSpaceConversion?: ColorSpaceConversion;
  desiredWidth?: number;
  desiredHeight?: number;
  preferAnimation?: boolean;
  premultiplyAlpha?: PremultiplyAlpha;
  transfer?: ArrayBuffer[];
}

export interface ImageDecodeOptions {
  frameIndex?: number;
  completeFramesOnly?: boolean;
}

export interface ImageDecodeResult {
  image: VideoFrame;
  complete: boolean;
}

/**
 * ImageTrack - Represents an individual image track
 */
export class ImageTrack {
  private _animated: boolean;
  private _frameCount: number;
  private _repetitionCount: number;
  private _selected: boolean;

  constructor(options: {
    animated: boolean;
    frameCount: number;
    repetitionCount: number;
    selected: boolean;
  }) {
    this._animated = options.animated;
    this._frameCount = options.frameCount;
    this._repetitionCount = options.repetitionCount;
    this._selected = options.selected;
  }

  get animated(): boolean { return this._animated; }
  get frameCount(): number { return this._frameCount; }
  get repetitionCount(): number { return this._repetitionCount; }
  get selected(): boolean { return this._selected; }
}

/**
 * ImageTrackList - A list of image tracks
 */
export class ImageTrackList {
  private _tracks: ImageTrack[] = [];
  private _selectedIndex: number = -1;
  private _ready: Promise<void>;
  private _resolveReady!: () => void;

  constructor() {
    this._ready = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  get ready(): Promise<void> { return this._ready; }
  get length(): number { return this._tracks.length; }
  get selectedIndex(): number { return this._selectedIndex; }

  get selectedTrack(): ImageTrack | null {
    if (this._selectedIndex >= 0 && this._selectedIndex < this._tracks.length) {
      return this._tracks[this._selectedIndex];
    }
    return null;
  }

  /** @internal */
  _addTrack(track: ImageTrack): void {
    const index = this._tracks.length;
    this._tracks.push(track);
    if (track.selected && this._selectedIndex === -1) {
      this._selectedIndex = index;
    }
  }

  /** @internal */
  _markReady(): void {
    this._resolveReady();
  }

  [Symbol.iterator](): Iterator<ImageTrack> {
    return this._tracks[Symbol.iterator]();
  }
}

// Supported image types (delegated to node-av)
const ANIMATED_FORMATS = ['image/gif', 'image/apng', 'image/webp'];

function isReadableStream(obj: unknown): obj is ReadableStream {
  return typeof obj === 'object' && obj !== null && typeof (obj as ReadableStream).getReader === 'function';
}

export class ImageDecoder {
  private _type: string;
  private _data: Uint8Array | null = null;
  private _complete: boolean = false;
  private _completed: Promise<void>;
  private _resolveCompleted!: () => void;
  private _rejectCompleted!: (error: Error) => void;
  private _tracks: ImageTrackList;
  private _closed: boolean = false;
  private _colorSpaceConversion: ColorSpaceConversion;
  private _premultiplyAlpha: PremultiplyAlpha;
  private _desiredWidth?: number;
  private _desiredHeight?: number;
  private _preferAnimation: boolean;
  private _visibleFrameCount: number = 0;
  private _visibleAnimated: boolean = false;
  private _visibleRepetitionCount: number = 1;
  private _preferredColorSpace: VideoColorSpaceInit | undefined;
  private _orientation: number = 1;
  private _orientationEvaluated = false;

  private _frames: Array<{
    data: Uint8Array;
    width: number;
    height: number;
    timestamp: number;
    duration: number;
    complete: boolean;
    colorSpace?: VideoColorSpaceInit;
  }> = [];
  private _framesParsed: boolean = false;
  private _repetitionCount: number = 0;

  constructor(init: ImageDecoderInit) {
    if (!init || typeof init !== 'object') {
      throw new TypeError('init must be an object');
    }
    if (!init.type || typeof init.type !== 'string') {
      throw new TypeError('type is required and must be a string');
    }
    if (!init.data) {
      throw new TypeError('data is required');
    }

    this._type = init.type;
    this._colorSpaceConversion = init.colorSpaceConversion ?? 'default';
    this._premultiplyAlpha = init.premultiplyAlpha ?? 'default';
    this._desiredWidth = init.desiredWidth;
    this._desiredHeight = init.desiredHeight;
    this._preferAnimation = init.preferAnimation ?? false;
    this._preferredColorSpace = this._colorSpaceConversion === 'default'
      ? { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true }
      : undefined;
    this._tracks = new ImageTrackList();

    this._completed = new Promise((resolve, reject) => {
      this._resolveCompleted = resolve;
      this._rejectCompleted = reject;
    });

    const transferSet = new Set(init.transfer || []);

    if (init.data instanceof ArrayBuffer) {
      if (transferSet.has(init.data)) {
        this._data = new Uint8Array(init.data);
      } else {
        this._data = new Uint8Array(init.data.slice(0));
      }
      this._complete = true;
      this._initializeTracks();
    } else if (ArrayBuffer.isView(init.data)) {
      const view = init.data;
      if (view.buffer instanceof ArrayBuffer && transferSet.has(view.buffer)) {
        this._data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      } else {
        this._data = new Uint8Array(view.byteLength);
        this._data.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      }
      this._complete = true;
      this._initializeTracks();
    } else if (isReadableStream(init.data)) {
      this._readStream(init.data as ReadableStream<ArrayBufferView>);
    } else {
      throw new TypeError('data must be ArrayBuffer, ArrayBufferView, or ReadableStream');
    }
  }

  private async _readStream(stream: ReadableStream<ArrayBufferView>): Promise<void> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        }
      }

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      this._data = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        this._data.set(chunk, offset);
        offset += chunk.length;
      }

      this._complete = true;
      this._initializeTracks();
    } catch (error) {
      this._rejectCompleted(error as Error);
    }
  }

  private async _initializeTracks(): Promise<void> {
    try {
      this._evaluateOrientation();
      await this._parseImage();
      this._tracks._markReady();
      this._resolveCompleted();
    } catch (error) {
      this._rejectCompleted(error as Error);
    }
  }

  private async _parseImage(): Promise<void> {
    if (!this._data || this._framesParsed) return;

    if (!NodeAvImageDecoder.isTypeSupported(this._type)) {
      throw new DOMException(`Unsupported image type: ${this._type}`, 'NotSupportedError');
    }

    // Set default repetition count (GIF loops forever by default)
    const type = this._type.toLowerCase();
    this._repetitionCount = type === 'image/gif' ? Infinity : 1;

    await this._decodeAllFramesDirect();

    this._framesParsed = true;
    this._updateVisibleTrackInfo();

    const track = new ImageTrack({
      animated: this._visibleAnimated,
      frameCount: this._visibleFrameCount,
      repetitionCount: this._visibleRepetitionCount,
      selected: true,
    });
    this._tracks._addTrack(track);
  }

  private _frameTypeSupportsAlpha(): boolean {
    const type = this._type.toLowerCase();
    return ['image/png', 'image/apng', 'image/webp', 'image/gif', 'image/avif'].includes(type);
  }

  private _evaluateOrientation(): void {
    if (this._orientationEvaluated) {
      return;
    }
    this._orientationEvaluated = true;
    if (!this._data) {
      return;
    }

    const type = this._type.toLowerCase();
    if (type !== 'image/jpeg' && type !== 'image/jpg') {
      return;
    }

    const orientation = this._parseExifOrientation(this._data);
    if (orientation && orientation >= 1 && orientation <= 8) {
      this._orientation = orientation;
    }
  }

  private _shouldPremultiplyAlpha(): boolean {
    if (this._premultiplyAlpha === 'premultiply') {
      return true;
    }
    if (this._premultiplyAlpha === 'none') {
      return false;
    }
    return this._frameTypeSupportsAlpha();
  }

  private _processFrameData(data: Uint8Array): Uint8Array {
    if (!this._shouldPremultiplyAlpha()) {
      return data;
    }

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        continue;
      }
      const factor = alpha / 255;
      data[i] = Math.round(data[i] * factor);
      data[i + 1] = Math.round(data[i + 1] * factor);
      data[i + 2] = Math.round(data[i + 2] * factor);
    }

    return data;
  }

  private _updateVisibleTrackInfo(): void {
    const totalFrames = this._frames.length;
    this._visibleFrameCount = totalFrames;
    this._visibleAnimated = totalFrames > 1;
    this._visibleRepetitionCount = this._repetitionCount || 1;
  }

  private _parseExifOrientation(data: Uint8Array): number | null {
    if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) {
      return null;
    }

    const readUint16 = (buffer: Uint8Array, offset: number, littleEndian: boolean): number => {
      if (littleEndian) {
        return buffer[offset] | (buffer[offset + 1] << 8);
      }
      return (buffer[offset] << 8) | buffer[offset + 1];
    };

    const readUint32 = (buffer: Uint8Array, offset: number, littleEndian: boolean): number => {
      if (littleEndian) {
        return (
          buffer[offset] |
          (buffer[offset + 1] << 8) |
          (buffer[offset + 2] << 16) |
          (buffer[offset + 3] << 24)
        );
      }
      return (
        (buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3]
      );
    };

    let offset = 2;

    while (offset + 4 < data.length) {
      if (data[offset] !== 0xFF) {
        break;
      }
      const marker = data[offset + 1];
      offset += 2;

      if (marker === 0xD9 || marker === 0xDA) {
        break;
      }

      if (offset + 2 > data.length) {
        break;
      }

      const segmentLength = (data[offset] << 8) | data[offset + 1];
      if (segmentLength < 2) {
        break;
      }

      const segmentStart = offset + 2;
      const segmentEnd = segmentStart + segmentLength - 2;

      if (segmentEnd > data.length) {
        break;
      }

      if (marker === 0xE1 && segmentLength >= 8) {
        const hasExifHeader =
          data[segmentStart] === 0x45 && // E
          data[segmentStart + 1] === 0x78 && // x
          data[segmentStart + 2] === 0x69 && // i
          data[segmentStart + 3] === 0x66 && // f
          data[segmentStart + 4] === 0x00 &&
          data[segmentStart + 5] === 0x00;

        if (hasExifHeader) {
          const tiffStart = segmentStart + 6;
          if (tiffStart + 8 > data.length) {
            return null;
          }

          const byteOrder = String.fromCharCode(data[tiffStart], data[tiffStart + 1]);
          const littleEndian = byteOrder === 'II';
          const bigEndian = byteOrder === 'MM';
          if (!littleEndian && !bigEndian) {
            return null;
          }
          const isLittleEndian = littleEndian;

          const firstIFDOffset = readUint32(data, tiffStart + 4, isLittleEndian);
          let ifdOffset = tiffStart + firstIFDOffset;

          if (ifdOffset < tiffStart || ifdOffset + 2 > data.length) {
            return null;
          }

          let entryCount = readUint16(data, ifdOffset, isLittleEndian);
          const entrySize = 12;
          const maxEntries = Math.floor((data.length - (ifdOffset + 2)) / entrySize);
          if (entryCount > maxEntries) {
            entryCount = maxEntries;
          }

          for (let i = 0; i < entryCount; i++) {
            const entryOffset = ifdOffset + 2 + i * entrySize;
            if (entryOffset + entrySize > data.length) {
              break;
            }

            const tag = readUint16(data, entryOffset, isLittleEndian);
            if (tag !== 0x0112) {
              continue;
            }

            const type = readUint16(data, entryOffset + 2, isLittleEndian);
            const count = readUint32(data, entryOffset + 4, isLittleEndian);
            if (type !== 3 || count < 1) {
              return null;
            }

            const valueOffset = entryOffset + 8;
            if (valueOffset + 2 > data.length) {
              return null;
            }

            const orientation = readUint16(data, valueOffset, isLittleEndian);
            return orientation;
          }
        }
      }

      offset = segmentEnd;
    }

    return null;
  }

  private _applyOrientation(
    data: Uint8Array,
    width: number,
    height: number
  ): { data: Uint8Array; width: number; height: number } {
    const orientation = this._orientation;
    if (orientation === 1 || orientation < 1 || orientation > 8) {
      return { data, width, height };
    }

    const shouldSwapDimensions = orientation >= 5 && orientation <= 8;
    const newWidth = shouldSwapDimensions ? height : width;
    const newHeight = shouldSwapDimensions ? width : height;
    const transformed = new Uint8Array(newWidth * newHeight * 4);

    const copyPixel = (destX: number, destY: number, srcIndex: number): void => {
      const destIndex = (destY * newWidth + destX) * 4;
      transformed[destIndex] = data[srcIndex];
      transformed[destIndex + 1] = data[srcIndex + 1];
      transformed[destIndex + 2] = data[srcIndex + 2];
      transformed[destIndex + 3] = data[srcIndex + 3];
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIndex = (y * width + x) * 4;
        let destX = x;
        let destY = y;

        switch (orientation) {
          case 2:
            destX = width - 1 - x;
            destY = y;
            break;
          case 3:
            destX = width - 1 - x;
            destY = height - 1 - y;
            break;
          case 4:
            destX = x;
            destY = height - 1 - y;
            break;
          case 5:
            destX = y;
            destY = x;
            break;
          case 6:
            destX = height - 1 - y;
            destY = x;
            break;
          case 7:
            destX = height - 1 - y;
            destY = width - 1 - x;
            break;
          case 8:
            destX = y;
            destY = width - 1 - x;
            break;
          default:
            destX = x;
            destY = y;
            break;
        }

        copyPixel(destX, destY, srcIndex);
      }
    }

    return { data: transformed, width: newWidth, height: newHeight };
  }

  private async _decodeWithNodeAv(): Promise<void> {
    if (!this._data) return;

    logger.debug('Using node-av backend for image decoding');
    const nodeAvDecoder = new NodeAvImageDecoder({
      mimeType: this._type,
      data: this._data,
      desiredWidth: this._desiredWidth,
      desiredHeight: this._desiredHeight,
      colorSpace: this._preferredColorSpace,
    });

    try {
      const decodedFrames = await nodeAvDecoder.decode();

      for (const frame of decodedFrames) {
        // Apply premultiplication if needed
        const processed = this._processFrameData(frame.data);
        // Apply orientation correction for JPEG
        const oriented = this._applyOrientation(processed, frame.width, frame.height);

        this._frames.push({
          data: oriented.data,
          width: oriented.width,
          height: oriented.height,
          timestamp: frame.timestamp,
          duration: frame.duration,
          complete: frame.complete,
          colorSpace: frame.colorSpace,
        });
      }
    } finally {
      nodeAvDecoder.close();
    }
  }

  private async _decodeWithWebP(): Promise<void> {
    if (!this._data) return;

    logger.debug('Using WebP decoder for WebP image');
    const webpDecoder = new WebPImageDecoder({
      data: this._data,
      desiredWidth: this._desiredWidth,
      desiredHeight: this._desiredHeight,
      colorSpace: this._preferredColorSpace,
    });

    try {
      const decodedFrames = await webpDecoder.decode();

      for (const frame of decodedFrames) {
        // Apply premultiplication if needed
        const processed = this._processFrameData(frame.data);

        this._frames.push({
          data: processed,
          width: frame.width,
          height: frame.height,
          timestamp: frame.timestamp,
          duration: frame.duration,
          complete: frame.complete,
          colorSpace: frame.colorSpace,
        });
      }
    } finally {
      webpDecoder.close();
    }
  }

  private async _decodeAllFramesDirect(): Promise<void> {
    if (!this._data) return;

    const type = this._type.toLowerCase();

    // Use dedicated WebP decoder for full animated WebP support
    if (type === 'image/webp') {
      await this._decodeWithWebP();
    } else {
      // Decode using node-av for other formats
      await this._decodeWithNodeAv();
    }

    if (this._frames.length === 0) {
      throw new Error('No frames decoded');
    }
  }

  get complete(): boolean { return this._complete; }
  get completed(): Promise<void> { return this._completed; }
  get tracks(): ImageTrackList { return this._tracks; }
  get type(): string { return this._type; }

  static async isTypeSupported(type: string): Promise<boolean> {
    return NodeAvImageDecoder.isTypeSupported(type);
  }

  async decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult> {
    if (this._closed) {
      throw new DOMException('ImageDecoder is closed', 'InvalidStateError');
    }

    await this._completed;

    const frameIndex = options?.frameIndex ?? 0;
    const availableFrames = this._frames.length;

    if (availableFrames === 0) {
      throw new DOMException('No frames available', 'InvalidStateError');
    }

    if (frameIndex < 0 || frameIndex >= availableFrames) {
      throw new DOMException(
        `Frame index ${frameIndex} out of range (0-${availableFrames - 1})`,
        'InvalidStateError'
      );
    }

    const frame = this._frames[frameIndex];
    const requireComplete = options?.completeFramesOnly ?? true;
    const frameComplete = frame.complete ?? true;

    if (requireComplete && !frameComplete) {
      throw new DOMException('Requested frame is not fully decoded', 'InvalidStateError');
    }

    const videoFrame = new VideoFrame(frame.data, {
      format: 'RGBA',
      codedWidth: frame.width,
      codedHeight: frame.height,
      timestamp: frame.timestamp,
      duration: frame.duration,
      colorSpace: frame.colorSpace,
    });

    return { image: videoFrame, complete: frameComplete };
  }

  reset(): void {
    if (this._closed) {
      throw new DOMException('ImageDecoder is closed', 'InvalidStateError');
    }

    if (!this._data) {
      return;
    }

    this._frames = [];
    this._framesParsed = false;
    this._repetitionCount = 0;
    this._visibleFrameCount = 0;
    this._visibleAnimated = false;
    this._visibleRepetitionCount = 1;
    this._tracks = new ImageTrackList();
    this._complete = false;
    this._completed = new Promise((resolve, reject) => {
      this._resolveCompleted = resolve;
      this._rejectCompleted = reject;
    });
    this._initializeTracks();
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._data = null;
    this._frames = [];
    this._visibleFrameCount = 0;
    this._visibleAnimated = false;
    this._visibleRepetitionCount = 1;
  }
}

/**
 * VideoFrame - Represents a frame of video data
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame
 */

import type { BufferSource, DOMRectInit, PlaneLayout, NativeFrame } from '../types/index.js';
import { DOMException, DOMRectReadOnly, isNativeFrame } from '../types/index.js';
import { toUint8Array } from '../utils/buffer.js';
import type { VideoColorSpaceInit } from '../formats/index.js';
import {
  getFrameAllocationSize,
  getPlaneCount,
  getPlaneInfo,
  isRgbFormat,
  VideoColorSpace,
} from '../formats/index.js';

import {
  convertFrameFormat,
  getPlaneOffset,
  type FrameBuffer,
} from '../formats/conversions/frame-converter.js';

// Import types from types/video.ts
import type {
  VideoPixelFormat,
  VideoFrameBufferInit,
  VideoFrameCopyToOptions,
  VideoFrameInit,
} from '../types/video.js';

// Re-export types for backwards compatibility
export type { VideoPixelFormat, VideoFrameBufferInit, VideoFrameCopyToOptions, VideoFrameInit };

// Import type guards from utils
import {
  isImageDataLike,
  isCanvasLike,
  isVideoFrameLike,
  isCanvasImageSource,
  extractCanvasPixels,
  type ImageDataLike,
  type CanvasLike,
  type VideoFrameLike,
  type SkiaCanvasLike,
} from '../utils/type-guards.js';

export class VideoFrame {
  private _data: Uint8Array;
  private _closed = false;
  private _nativeFrame: NativeFrame | null = null;
  private _nativeCleanup: (() => void) | null = null;

  private _format: VideoPixelFormat;
  private _codedWidth: number;
  private _codedHeight: number;
  private _codedRect: DOMRectReadOnly;
  private _visibleRect: DOMRectReadOnly;
  private _displayWidth: number;
  private _displayHeight: number;
  private _duration: number | null;
  private _timestamp: number;
  private _colorSpace: VideoColorSpace;

  get format(): VideoPixelFormat | null { return this._closed ? null : this._format; }
  get codedWidth(): number { return this._closed ? 0 : this._codedWidth; }
  get codedHeight(): number { return this._closed ? 0 : this._codedHeight; }
  get codedRect(): DOMRectReadOnly | null { return this._closed ? null : this._codedRect; }
  get visibleRect(): DOMRectReadOnly | null { return this._closed ? null : this._visibleRect; }
  get displayWidth(): number { return this._closed ? 0 : this._displayWidth; }
  get displayHeight(): number { return this._closed ? 0 : this._displayHeight; }
  // timestamp and duration are preserved after close per WebCodecs spec
  get duration(): number | null { return this._duration; }
  get timestamp(): number { return this._timestamp; }
  get colorSpace(): VideoColorSpace | null { return this._closed ? null : this._colorSpace; }

  /**
   * Create a VideoFrame from raw pixel data or CanvasImageSource
   */
  constructor(data: BufferSource, init: VideoFrameBufferInit);
  constructor(image: unknown, init?: VideoFrameInit);
  constructor(dataOrImage: BufferSource | unknown, init?: VideoFrameBufferInit | VideoFrameInit) {
    // Special case: constructing from another VideoFrame without init
    if (isVideoFrameLike(dataOrImage)) {
      const sourceFrame = dataOrImage as VideoFrameLike;

      // Source frame must not be closed
      if (sourceFrame.format === null) {
        throw new DOMException('Source VideoFrame is closed', 'InvalidStateError');
      }

      // Init is optional when constructing from VideoFrame
      const frameInit = (init as VideoFrameInit) || {};

      // Copy data from source frame
      let pixelData: Uint8Array;
      if ((sourceFrame as any)._buffer instanceof Uint8Array) {
        pixelData = new Uint8Array((sourceFrame as any)._buffer);
      } else if ((sourceFrame as any)._rawData instanceof Uint8Array) {
        pixelData = new Uint8Array((sourceFrame as any)._rawData);
      } else if ((sourceFrame as any)._data instanceof Uint8Array) {
        pixelData = new Uint8Array((sourceFrame as any)._data);
      } else {
        // Try copyTo if available
        const size = sourceFrame.allocationSize ? sourceFrame.allocationSize() : sourceFrame.codedWidth * sourceFrame.codedHeight * 4;
        pixelData = new Uint8Array(size);
        if (sourceFrame.copyTo) {
          sourceFrame.copyTo(pixelData);
        }
      }

      this._data = pixelData;
      this._format = sourceFrame.format as VideoPixelFormat;
      this._codedWidth = sourceFrame.codedWidth;
      this._codedHeight = sourceFrame.codedHeight;
      // Inherit timestamp from source if not specified
      this._timestamp = frameInit.timestamp ?? sourceFrame.timestamp;
      this._duration = frameInit.duration ?? sourceFrame.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, sourceFrame.codedWidth, sourceFrame.codedHeight);

      if (frameInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          frameInit.visibleRect.x ?? 0,
          frameInit.visibleRect.y ?? 0,
          frameInit.visibleRect.width ?? sourceFrame.codedWidth,
          frameInit.visibleRect.height ?? sourceFrame.codedHeight
        );
      } else if (sourceFrame.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          sourceFrame.visibleRect.x,
          sourceFrame.visibleRect.y,
          sourceFrame.visibleRect.width,
          sourceFrame.visibleRect.height
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, sourceFrame.codedWidth, sourceFrame.codedHeight);
      }

      this._displayWidth = frameInit.displayWidth ?? sourceFrame.displayWidth;
      this._displayHeight = frameInit.displayHeight ?? sourceFrame.displayHeight;
      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(this._format, frameInit.colorSpace)
      );
      return;
    }

    // Validate init is provided for non-VideoFrame sources
    if (!init || typeof init !== 'object') {
      throw new TypeError('VideoFrame init is required');
    }

    // Check if it's raw pixel data (BufferSource) first
    if (this._isNativeFrame(dataOrImage)) {
      const bufferInit = init as VideoFrameBufferInit;

      if (!bufferInit.format) {
        throw new TypeError('format is required');
      }
      if (typeof bufferInit.codedWidth !== 'number' || bufferInit.codedWidth <= 0) {
        throw new TypeError('codedWidth must be a positive number');
      }
      if (typeof bufferInit.codedHeight !== 'number' || bufferInit.codedHeight <= 0) {
        throw new TypeError('codedHeight must be a positive number');
      }
      if (typeof bufferInit.timestamp !== 'number') {
        throw new TypeError('timestamp is required');
      }

      this._nativeFrame = dataOrImage as NativeFrame;
      this._nativeCleanup = (init as { _nativeCleanup?: () => void })._nativeCleanup ?? null;
      this._data = new Uint8Array(0);

      this._format = bufferInit.format;
      this._codedWidth = bufferInit.codedWidth;
      this._codedHeight = bufferInit.codedHeight;
      this._timestamp = bufferInit.timestamp;
      this._duration = bufferInit.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);

      if (bufferInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          bufferInit.visibleRect.x ?? 0,
          bufferInit.visibleRect.y ?? 0,
          bufferInit.visibleRect.width ?? bufferInit.codedWidth,
          bufferInit.visibleRect.height ?? bufferInit.codedHeight
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);
      }

      this._displayWidth = bufferInit.displayWidth ?? this._visibleRect.width;
      this._displayHeight = bufferInit.displayHeight ?? this._visibleRect.height;
      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(bufferInit.format, bufferInit.colorSpace)
      );
    } else if (dataOrImage instanceof ArrayBuffer || ArrayBuffer.isView(dataOrImage)) {
      const data = dataOrImage as BufferSource;
      const bufferInit = init as VideoFrameBufferInit;

      // Validate required parameters for buffer init
      if (!bufferInit.format) {
        throw new TypeError('format is required');
      }
      if (typeof bufferInit.codedWidth !== 'number' || bufferInit.codedWidth <= 0) {
        throw new TypeError('codedWidth must be a positive number');
      }
      if (typeof bufferInit.codedHeight !== 'number' || bufferInit.codedHeight <= 0) {
        throw new TypeError('codedHeight must be a positive number');
      }
      if (typeof bufferInit.timestamp !== 'number') {
        throw new TypeError('timestamp is required');
      }

      // Validate buffer size
      const expectedSize = getFrameAllocationSize(
        bufferInit.format,
        bufferInit.codedWidth,
        bufferInit.codedHeight
      );
      const actualSize = data instanceof ArrayBuffer ? data.byteLength : (data as ArrayBufferView).byteLength;
      if (actualSize < expectedSize) {
        throw new TypeError(
          `Buffer too small: expected at least ${expectedSize} bytes for ${bufferInit.format} ` +
          `${bufferInit.codedWidth}x${bufferInit.codedHeight}, got ${actualSize}`
        );
      }

      this._data = toUint8Array(data);

      this._format = bufferInit.format;
      this._codedWidth = bufferInit.codedWidth;
      this._codedHeight = bufferInit.codedHeight;
      this._timestamp = bufferInit.timestamp;
      this._duration = bufferInit.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);

      if (bufferInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          bufferInit.visibleRect.x ?? 0,
          bufferInit.visibleRect.y ?? 0,
          bufferInit.visibleRect.width ?? bufferInit.codedWidth,
          bufferInit.visibleRect.height ?? bufferInit.codedHeight
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);
      }

      this._displayWidth = bufferInit.displayWidth ?? this._visibleRect.width;
      this._displayHeight = bufferInit.displayHeight ?? this._visibleRect.height;
      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(bufferInit.format, bufferInit.colorSpace)
      );
    } else if (isCanvasImageSource(dataOrImage)) {
      const frameInit = init as VideoFrameInit;

      // WebCodecs spec §7.1 step 3: CanvasImageSource requires a finite timestamp
      if (typeof frameInit.timestamp !== 'number' || !Number.isFinite(frameInit.timestamp)) {
        throw new TypeError('timestamp is required and must be a finite number for CanvasImageSource');
      }

      const result = this._extractFromCanvasImageSource(dataOrImage, frameInit);

      this._data = result.data;
      this._format = result.format;
      this._codedWidth = result.width;
      this._codedHeight = result.height;
      this._timestamp = frameInit.timestamp;
      this._duration = frameInit.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, result.width, result.height);

      if (frameInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          frameInit.visibleRect.x ?? 0,
          frameInit.visibleRect.y ?? 0,
          frameInit.visibleRect.width ?? result.width,
          frameInit.visibleRect.height ?? result.height
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, result.width, result.height);
      }

      this._displayWidth = frameInit.displayWidth ?? this._visibleRect.width;
      this._displayHeight = frameInit.displayHeight ?? this._visibleRect.height;
      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(result.format, frameInit.colorSpace)
      );
    } else {
      throw new TypeError('data must be an ArrayBuffer, ArrayBufferView, or CanvasImageSource');
    }
  }

  /**
   * Get default color space based on pixel format
   * RGB formats default to sRGB, YUV formats to BT.709
   */
  private _getDefaultColorSpace(
    format: VideoPixelFormat,
    init?: VideoColorSpaceInit
  ): VideoColorSpaceInit {
    // If user provided values, use them
    if (init && (init.primaries || init.transfer || init.matrix || init.fullRange !== undefined)) {
      return init;
    }

    // Apply defaults based on format
    if (isRgbFormat(format)) {
      // sRGB defaults for RGB formats
      return {
        primaries: 'bt709',
        transfer: 'iec61966-2-1', // sRGB transfer function
        matrix: 'rgb',
        fullRange: true,
      };
    }

    // For YUV formats, return user init (or undefined for null values)
    return init ?? {};
  }

  /**
   * Extract pixel data from various CanvasImageSource types
   */
  private _extractFromCanvasImageSource(
    source: unknown,
    init: VideoFrameInit
  ): { data: Uint8Array; width: number; height: number; format: VideoPixelFormat } {
    const discardAlpha = init.alpha === 'discard';

    // 1. VideoFrame-like objects
    if (isVideoFrameLike(source)) {
      const vf = source as VideoFrameLike;
      let pixelData: Uint8Array;

      if (vf._buffer instanceof Uint8Array) {
        pixelData = new Uint8Array(vf._buffer);
      } else if (vf._rawData instanceof Uint8Array) {
        pixelData = new Uint8Array(vf._rawData);
      } else if (vf._data instanceof Uint8Array) {
        pixelData = new Uint8Array(vf._data);
      } else {
        pixelData = new Uint8Array(vf.codedWidth * vf.codedHeight * 4);
      }

      if (discardAlpha && (vf.format === 'RGBA' || vf.format === 'BGRA')) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }

      return {
        data: pixelData,
        width: vf.codedWidth,
        height: vf.codedHeight,
        format: vf.format as VideoPixelFormat,
      };
    }

    // 2. ImageData-like objects
    if (isImageDataLike(source)) {
      const imgData = source as ImageDataLike;
      let pixelData = new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength);
      pixelData = new Uint8Array(pixelData);

      if (discardAlpha) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }

      return {
        data: pixelData,
        width: imgData.width,
        height: imgData.height,
        format: 'RGBA',
      };
    }

    // 3. Canvas-like objects (including skia-canvas)
    if (isCanvasLike(source)) {
      const canvas = source as CanvasLike | SkiaCanvasLike;
      const width = canvas.width;
      const height = canvas.height;

      // Use unified pixel extraction (handles skia-canvas, polyfills, and standard canvas)
      let pixelData = extractCanvasPixels(canvas);
      pixelData = new Uint8Array(pixelData); // Copy to avoid sharing

      if (discardAlpha) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }

      return { data: pixelData, width, height, format: 'RGBA' };
    }

    // 4. Objects with raw data properties
    const obj = source as Record<string, unknown>;
    const width = (obj.width ?? obj.codedWidth ?? 0) as number;
    const height = (obj.height ?? obj.codedHeight ?? 0) as number;

    let pixelData: Uint8Array | null = null;

    if (obj._data instanceof Uint8Array || obj._data instanceof Uint8ClampedArray) {
      pixelData = new Uint8Array(obj._data as Uint8Array);
    } else if (obj._rawData instanceof Uint8Array) {
      pixelData = new Uint8Array(obj._rawData as Uint8Array);
    } else if (obj.data instanceof Uint8Array || obj.data instanceof Uint8ClampedArray) {
      pixelData = new Uint8Array(obj.data as Uint8Array);
    }

    if (pixelData) {
      if (discardAlpha) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }
      return { data: pixelData, width, height, format: 'RGBA' };
    }

    return {
      data: new Uint8Array(width * height * 4),
      width,
      height,
      format: 'RGBA',
    };
  }

  /**
   * Returns the number of bytes required to hold the frame
   */
  allocationSize(options?: VideoFrameCopyToOptions): number {
    this._checkNotClosed();
    this._ensureDataLoaded();

    const format = options?.format ?? this._format;
    const rect = options?.rect;
    const width = rect?.width ?? this._visibleRect.width;
    const height = rect?.height ?? this._visibleRect.height;

    return getFrameAllocationSize(format, width, height);
  }

  /**
   * Returns the number of planes for this frame's format
   */
  get numberOfPlanes(): number {
    return this._closed ? 0 : getPlaneCount(this._format);
  }

  /**
   * Copies the frame data to the destination buffer
   */
  async copyTo(
    destination: BufferSource,
    options?: VideoFrameCopyToOptions
  ): Promise<PlaneLayout[]> {
    this._checkNotClosed();
    this._ensureDataLoaded();

    const destArray = toUint8Array(destination);

    const destFormat = options?.format ?? this._format;
    const rect = options?.rect;

    const srcX = Math.floor(rect?.x ?? this._visibleRect.x);
    const srcY = Math.floor(rect?.y ?? this._visibleRect.y);
    const srcW = Math.floor(rect?.width ?? this._visibleRect.width);
    const srcH = Math.floor(rect?.height ?? this._visibleRect.height);

    if (srcX < 0 || srcY < 0 || srcX + srcW > this._codedWidth || srcY + srcH > this._codedHeight) {
      throw new DOMException('Rect is out of bounds', 'ConstraintError');
    }

    const requiredSize = getFrameAllocationSize(destFormat, srcW, srcH);
    if (destArray.byteLength < requiredSize) {
      throw new TypeError(`destination buffer is too small (need ${requiredSize}, got ${destArray.byteLength})`);
    }

    if (destFormat === this._format && srcX === 0 && srcY === 0 &&
        srcW === this._codedWidth && srcH === this._codedHeight) {
      destArray.set(this._data);
      return this._getPlaneLayoutForSize(srcW, srcH, destFormat);
    }

    this._copyWithConversion(destArray, destFormat, srcX, srcY, srcW, srcH);
    return this._getPlaneLayoutForSize(srcW, srcH, destFormat);
  }

  private _copyWithConversion(
    dest: Uint8Array,
    destFormat: VideoPixelFormat,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number
  ): void {
    if (this._format === destFormat) {
      this._copyDirectWithClipping(dest, srcX, srcY, srcW, srcH);
      return;
    }

    // Use standalone conversion function
    const src: FrameBuffer = {
      data: this._data,
      format: this._format,
      width: this._codedWidth,
      height: this._codedHeight,
    };

    convertFrameFormat(src, dest, destFormat, srcX, srcY, srcW, srcH);
  }

  private _copyDirectWithClipping(
    dest: Uint8Array,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number
  ): void {
    const numPlanes = getPlaneCount(this._format);
    let destOffset = 0;

    for (let p = 0; p < numPlanes; p++) {
      const planeInfo = getPlaneInfo(this._format, this._codedWidth, this._codedHeight, p);
      const srcPlaneInfo = getPlaneInfo(this._format, this._codedWidth, this._codedHeight, p);
      const dstPlaneInfo = getPlaneInfo(this._format, srcW, srcH, p);

      const subsampleX = this._codedWidth / srcPlaneInfo.width;
      const subsampleY = this._codedHeight / srcPlaneInfo.height;

      const planeX = Math.floor(srcX / subsampleX);
      const planeY = Math.floor(srcY / subsampleY);
      const planeW = dstPlaneInfo.width;
      const planeH = dstPlaneInfo.height;

      const srcPlaneOffset = getPlaneOffset(this._format, this._codedWidth, this._codedHeight, p);
      const srcStride = srcPlaneInfo.width * srcPlaneInfo.bytesPerPixel;
      const dstStride = planeW * planeInfo.bytesPerPixel;

      for (let row = 0; row < planeH; row++) {
        const srcRowOffset = srcPlaneOffset + (planeY + row) * srcStride + planeX * planeInfo.bytesPerPixel;
        dest.set(this._data.subarray(srcRowOffset, srcRowOffset + dstStride), destOffset);
        destOffset += dstStride;
      }
    }
  }

  private _getPlaneLayoutForSize(width: number, height: number, format: VideoPixelFormat): PlaneLayout[] {
    const chromaW = Math.ceil(width / 2);
    const chromaH = Math.ceil(height / 2);

    switch (format) {
      case 'I420': {
        const ySize = width * height;
        const uvSize = chromaW * chromaH;
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: chromaW },
          { offset: ySize + uvSize, stride: chromaW },
        ];
      }
      case 'I420A': {
        const ySize = width * height;
        const uvSize = chromaW * chromaH;
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: chromaW },
          { offset: ySize + uvSize, stride: chromaW },
          { offset: ySize + 2 * uvSize, stride: width },
        ];
      }
      case 'I422': {
        const ySize = width * height;
        const uvSize = chromaW * height;
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: chromaW },
          { offset: ySize + uvSize, stride: chromaW },
        ];
      }
      case 'I444': {
        const planeSize = width * height;
        return [
          { offset: 0, stride: width },
          { offset: planeSize, stride: width },
          { offset: 2 * planeSize, stride: width },
        ];
      }
      case 'NV12': {
        const ySize = width * height;
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: width },
        ];
      }
      // 10-bit formats: 2 bytes per sample
      case 'I420P10': {
        const ySize = width * height * 2;
        const uvSize = chromaW * chromaH * 2;
        return [
          { offset: 0, stride: width * 2 },
          { offset: ySize, stride: chromaW * 2 },
          { offset: ySize + uvSize, stride: chromaW * 2 },
        ];
      }
      case 'I422P10': {
        const ySize = width * height * 2;
        const uvSize = chromaW * height * 2;
        return [
          { offset: 0, stride: width * 2 },
          { offset: ySize, stride: chromaW * 2 },
          { offset: ySize + uvSize, stride: chromaW * 2 },
        ];
      }
      case 'I444P10': {
        const planeSize = width * height * 2;
        return [
          { offset: 0, stride: width * 2 },
          { offset: planeSize, stride: width * 2 },
          { offset: 2 * planeSize, stride: width * 2 },
        ];
      }
      case 'P010': {
        const ySize = width * height * 2;
        return [
          { offset: 0, stride: width * 2 },
          { offset: ySize, stride: width * 2 },
        ];
      }
      case 'RGBA':
      case 'RGBX':
      case 'BGRA':
      case 'BGRX':
        return [{ offset: 0, stride: width * 4 }];
      default:
        return [{ offset: 0, stride: width * 4 }];
    }
  }

  /**
   * Creates a copy of this VideoFrame
   */
  clone(): VideoFrame {
    this._checkNotClosed();
    this._ensureDataLoaded();
    const dataCopy = new Uint8Array(this._data);
    return new VideoFrame(dataCopy, {
      format: this._format,
      codedWidth: this._codedWidth,
      codedHeight: this._codedHeight,
      timestamp: this._timestamp,
      duration: this._duration ?? undefined,
      displayWidth: this._displayWidth,
      displayHeight: this._displayHeight,
      visibleRect: this._visibleRect.toJSON(),
      colorSpace: this._colorSpace.toJSON(),
    });
  }

  /**
   * Releases the frame's resources
   */
  close(): void {
    this._closed = true;
    if (this._nativeCleanup) {
      try {
        this._nativeCleanup();
      } catch {
        // ignore cleanup failures
      }
    }
    this._nativeFrame = null;
    this._nativeCleanup = null;
    this._data = new Uint8Array(0);
  }

  /**
   * Get the raw data buffer (non-standard, for internal use)
   */
  get _buffer(): Uint8Array {
    this._checkNotClosed();
    this._ensureDataLoaded();
    return this._data;
  }

  get _native(): NativeFrame | null {
    return this._closed ? null : this._nativeFrame;
  }

  private _checkNotClosed(): void {
    if (this._closed) {
      throw new DOMException('VideoFrame is closed', 'InvalidStateError');
    }
  }

  private _isNativeFrame(obj: unknown): obj is NativeFrame {
    return isNativeFrame(obj);
  }

  private _ensureDataLoaded(): void {
    if (this._data.byteLength === 0 && this._nativeFrame) {
      try {
        const buffer = this._nativeFrame.toBuffer();
        this._data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      } catch {
        this._data = new Uint8Array(0);
      }
    }
  }
}

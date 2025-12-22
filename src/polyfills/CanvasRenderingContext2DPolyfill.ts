/**
 * Minimal CanvasRenderingContext2D implementation using sharp
 */

import sharp from 'sharp';
import { ImageDataPolyfill } from './ImageDataPolyfill.js';
import type { OffscreenCanvasPolyfill } from './OffscreenCanvasPolyfill.js';
import type { VideoFramePolyfill } from './VideoFramePolyfill.js';

export class OffscreenCanvasRenderingContext2DPolyfill {
  private _canvas: OffscreenCanvasPolyfill;
  private _imageData: Uint8ClampedArray;

  // Canvas state (minimal)
  fillStyle: string = '#000000';
  strokeStyle: string = '#000000';
  globalAlpha: number = 1;
  imageSmoothingEnabled: boolean = true;

  constructor(canvas: OffscreenCanvasPolyfill) {
    this._canvas = canvas;
    this._imageData = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  get canvas(): OffscreenCanvasPolyfill {
    return this._canvas;
  }

  // Pending resize operation
  private _pendingResize: {
    sourceData: Uint8Array;
    sourceWidth: number;
    sourceHeight: number;
    destX: number;
    destY: number;
    destW: number;
    destH: number;
  } | null = null;

  /**
   * Draw image to canvas - the main method Mediabunny uses
   */
  drawImage(
    image: unknown,
    sxOrDx: number,
    syOrDy: number,
    swOrDw?: number,
    shOrDh?: number,
    dx?: number,
    dy?: number,
    dw?: number,
    dh?: number
  ): void {
    // Extract source data and dimensions from various image types
    let sourceData: Uint8Array | Uint8ClampedArray;
    let sourceWidth: number;
    let sourceHeight: number;

    const img = image as Record<string, unknown>;

    if (this._isOffscreenCanvas(image)) {
      const canvas = image as OffscreenCanvasPolyfill;
      sourceData = canvas._getImageData();
      sourceWidth = canvas.width;
      sourceHeight = canvas.height;
    } else if (this._isVideoFrame(image)) {
      // VideoFrame polyfill
      const frame = image as VideoFramePolyfill;
      sourceData = frame._rawData;
      sourceWidth = frame.codedWidth;
      sourceHeight = frame.codedHeight;
    } else if (img._rawData instanceof Uint8Array) {
      // VideoFrame polyfill accessed via generic object
      sourceData = img._rawData as Uint8Array;
      sourceWidth = (img.codedWidth || img.width) as number;
      sourceHeight = (img.codedHeight || img.height) as number;
    } else if (img._data instanceof Uint8Array || img._data instanceof Uint8ClampedArray) {
      // VideoSample with raw pixel data
      sourceData = img._data as Uint8Array;
      sourceWidth = (img.codedWidth || img.width) as number;
      sourceHeight = (img.codedHeight || img.height) as number;
    } else if (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray) {
      sourceData = img.data as Uint8Array;
      sourceWidth = img.width as number;
      sourceHeight = img.height as number;
    } else {
      // Try to get dimensions from common properties
      sourceWidth = (img.width || img.codedWidth || this._canvas.width) as number;
      sourceHeight = (img.height || img.codedHeight || this._canvas.height) as number;
      // Create empty data if we can't extract it
      sourceData = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
    }

    // Determine destination coordinates
    let destX: number, destY: number, destW: number, destH: number;

    if (dx !== undefined) {
      // 9-argument form: drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
      destX = dx;
      destY = dy!;
      destW = dw!;
      destH = dh!;
    } else if (swOrDw !== undefined) {
      // 5-argument form: drawImage(image, dx, dy, dw, dh)
      destX = sxOrDx;
      destY = syOrDy;
      destW = swOrDw;
      destH = shOrDh!;
    } else {
      // 3-argument form: drawImage(image, dx, dy)
      destX = sxOrDx;
      destY = syOrDy;
      destW = sourceWidth;
      destH = sourceHeight;
    }

    // If dimensions match and no offset, just copy directly
    if (destX === 0 && destY === 0 &&
        destW === this._canvas.width && destH === this._canvas.height &&
        sourceWidth === destW && sourceHeight === destH) {
      this._imageData.set(new Uint8ClampedArray(sourceData.buffer, sourceData.byteOffset, sourceData.byteLength));
      return;
    }

    // Store for async resize
    this._pendingResize = {
      sourceData: new Uint8Array(sourceData),
      sourceWidth,
      sourceHeight,
      destX,
      destY,
      destW,
      destH,
    };

    // Apply resize synchronously using sharp (blocking)
    this._applyPendingResizeSync();
  }

  private _isOffscreenCanvas(obj: unknown): obj is OffscreenCanvasPolyfill {
    return obj !== null && typeof obj === 'object' && '_getImageData' in obj && 'width' in obj && 'height' in obj;
  }

  private _isVideoFrame(obj: unknown): obj is VideoFramePolyfill {
    return obj !== null && typeof obj === 'object' && '_rawData' in obj && 'codedWidth' in obj && 'codedHeight' in obj;
  }

  /**
   * Apply pending resize synchronously
   */
  private _applyPendingResizeSync(): void {
    if (!this._pendingResize) return;

    const { sourceData, sourceWidth, sourceHeight, destX, destY, destW, destH } = this._pendingResize;
    this._pendingResize = null;

    // Use sharp for high-quality resizing (sync via deasync pattern or direct buffer manipulation)
    // For now, do a simple nearest-neighbor resize synchronously
    this._resizeNearest(sourceData, sourceWidth, sourceHeight, destX, destY, destW, destH);
  }

  /**
   * Simple nearest-neighbor resize (synchronous fallback)
   */
  private _resizeNearest(
    sourceData: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    destX: number,
    destY: number,
    destW: number,
    destH: number
  ): void {
    const canvasWidth = this._canvas.width;

    for (let y = 0; y < destH; y++) {
      const srcY = Math.floor(y * sourceHeight / destH);
      for (let x = 0; x < destW; x++) {
        const srcX = Math.floor(x * sourceWidth / destW);

        const srcOffset = (srcY * sourceWidth + srcX) * 4;
        const dstOffset = ((destY + y) * canvasWidth + (destX + x)) * 4;

        this._imageData[dstOffset] = sourceData[srcOffset];
        this._imageData[dstOffset + 1] = sourceData[srcOffset + 1];
        this._imageData[dstOffset + 2] = sourceData[srcOffset + 2];
        this._imageData[dstOffset + 3] = sourceData[srcOffset + 3];
      }
    }
  }

  /**
   * Apply pending resize asynchronously using sharp (higher quality)
   */
  async _applyPendingResizeAsync(): Promise<void> {
    if (!this._pendingResize) return;

    const { sourceData, sourceWidth, sourceHeight, destX, destY, destW, destH } = this._pendingResize;
    this._pendingResize = null;

    try {
      // Use sharp for high-quality resizing
      const resized = await sharp(Buffer.from(sourceData), {
        raw: {
          width: sourceWidth,
          height: sourceHeight,
          channels: 4,
        },
      })
        .resize(destW, destH, {
          fit: 'fill',
          kernel: 'lanczos3',
        })
        .raw()
        .toBuffer();

      // Copy resized data to canvas at destination position
      const canvasWidth = this._canvas.width;
      for (let y = 0; y < destH; y++) {
        const srcOffset = y * destW * 4;
        const dstOffset = ((destY + y) * canvasWidth + destX) * 4;
        for (let x = 0; x < destW * 4; x++) {
          this._imageData[dstOffset + x] = resized[srcOffset + x];
        }
      }
    } catch (error) {
      console.error('Sharp resize error:', error);
    }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): ImageDataPolyfill {
    const data = new Uint8ClampedArray(sw * sh * 4);
    const canvasWidth = this._canvas.width;

    for (let y = 0; y < sh; y++) {
      const srcOffset = ((sy + y) * canvasWidth + sx) * 4;
      const dstOffset = y * sw * 4;
      for (let x = 0; x < sw * 4; x++) {
        data[dstOffset + x] = this._imageData[srcOffset + x];
      }
    }

    return new ImageDataPolyfill(data, sw, sh);
  }

  putImageData(imageData: ImageDataPolyfill, dx: number, dy: number): void {
    const canvasWidth = this._canvas.width;
    const srcWidth = imageData.width;
    const srcHeight = imageData.height;

    for (let y = 0; y < srcHeight; y++) {
      const srcOffset = y * srcWidth * 4;
      const dstOffset = ((dy + y) * canvasWidth + dx) * 4;
      for (let x = 0; x < srcWidth * 4; x++) {
        this._imageData[dstOffset + x] = imageData.data[srcOffset + x];
      }
    }
  }

  createImageData(width: number, height: number): ImageDataPolyfill;
  createImageData(imagedata: ImageDataPolyfill): ImageDataPolyfill;
  createImageData(widthOrImageData: number | ImageDataPolyfill, height?: number): ImageDataPolyfill {
    if (typeof widthOrImageData === 'number') {
      return new ImageDataPolyfill(widthOrImageData, height!);
    }
    return new ImageDataPolyfill(widthOrImageData.width, widthOrImageData.height);
  }

  // Internal methods to access data
  _getImageData(): Uint8ClampedArray {
    return this._imageData;
  }

  _setImageData(data: Uint8ClampedArray): void {
    this._imageData = data;
  }

  // Basic drawing operations
  clearRect(x: number, y: number, w: number, h: number): void {
    const canvasWidth = this._canvas.width;
    for (let py = y; py < y + h && py < this._canvas.height; py++) {
      for (let px = x; px < x + w && px < canvasWidth; px++) {
        const offset = (py * canvasWidth + px) * 4;
        this._imageData[offset] = 0;
        this._imageData[offset + 1] = 0;
        this._imageData[offset + 2] = 0;
        this._imageData[offset + 3] = 0;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const color = this._parseColor(this.fillStyle);
    const canvasWidth = this._canvas.width;

    for (let py = y; py < y + h && py < this._canvas.height; py++) {
      for (let px = x; px < x + w && px < canvasWidth; px++) {
        const offset = (py * canvasWidth + px) * 4;
        this._imageData[offset] = color.r;
        this._imageData[offset + 1] = color.g;
        this._imageData[offset + 2] = color.b;
        this._imageData[offset + 3] = color.a;
      }
    }
  }

  private _parseColor(color: string): { r: number; g: number; b: number; a: number } {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 255,
        };
      }
    }
    return { r: 0, g: 0, b: 0, a: 255 };
  }

  // Stub methods that Mediabunny might call
  save(): void {}
  restore(): void {}
  reset(): void {
    this._imageData.fill(0);
  }
  scale(_x: number, _y: number): void {}
  rotate(_angle: number): void {}
  translate(_x: number, _y: number): void {}
  transform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number): void {}
  setTransform(_a?: number, _b?: number, _c?: number, _d?: number, _e?: number, _f?: number): void {}
  resetTransform(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(_x: number, _y: number): void {}
  lineTo(_x: number, _y: number): void {}
  rect(_x: number, _y: number, _w: number, _h: number): void {}
  arc(_x: number, _y: number, _r: number, _start: number, _end: number, _ccw?: boolean): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  strokeRect(_x: number, _y: number, _w: number, _h: number): void {}
  fillText(_text: string, _x: number, _y: number): void {}
  strokeText(_text: string, _x: number, _y: number): void {}
  measureText(_text: string): { width: number } {
    return { width: 0 };
  }
  getContextAttributes(): { alpha: boolean; willReadFrequently: boolean } {
    return { alpha: true, willReadFrequently: true };
  }
}

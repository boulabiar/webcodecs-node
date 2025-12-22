/**
 * VideoFrame polyfill for Node.js
 * Minimal implementation sufficient for Mediabunny's needs
 */

import type { OffscreenCanvasPolyfill } from './OffscreenCanvasPolyfill.js';

export class VideoFramePolyfill {
  readonly format: string;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly timestamp: number;
  readonly duration: number | null;
  readonly colorSpace: { primaries: string; transfer: string; matrix: string; fullRange: boolean };
  private _data: Uint8Array;
  private _closed: boolean = false;

  constructor(
    data: Uint8Array | Uint8ClampedArray | OffscreenCanvasPolyfill | unknown,
    init: {
      format?: string;
      codedWidth?: number;
      codedHeight?: number;
      timestamp: number;
      duration?: number;
      colorSpace?: { primaries?: string; transfer?: string; matrix?: string; fullRange?: boolean };
    }
  ) {
    // Handle OffscreenCanvas input
    if (data && typeof data === 'object' && '_getImageData' in data && typeof (data as OffscreenCanvasPolyfill)._getImageData === 'function') {
      const canvas = data as OffscreenCanvasPolyfill;
      this._data = new Uint8Array(canvas._getImageData());
      this.format = 'RGBA';
      this.codedWidth = canvas.width;
      this.codedHeight = canvas.height;
    } else if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
      // Handle raw data input
      this._data = new Uint8Array(data);
      this.format = init.format ?? 'RGBA';
      this.codedWidth = init.codedWidth ?? 0;
      this.codedHeight = init.codedHeight ?? 0;
    } else {
      // Try to extract data from canvas-like objects
      const obj = data as Record<string, unknown>;
      if (obj && obj.width !== undefined && obj.height !== undefined) {
        const width = obj.width as number;
        const height = obj.height as number;
        // Try to get image data
        if (typeof obj._getImageData === 'function') {
          this._data = new Uint8Array((obj._getImageData as () => Uint8ClampedArray)());
        } else {
          this._data = new Uint8Array(width * height * 4);
        }
        this.format = 'RGBA';
        this.codedWidth = width;
        this.codedHeight = height;
      } else {
        this._data = new Uint8Array(0);
        this.format = init.format ?? 'RGBA';
        this.codedWidth = init.codedWidth ?? 0;
        this.codedHeight = init.codedHeight ?? 0;
      }
    }

    this.displayWidth = this.codedWidth;
    this.displayHeight = this.codedHeight;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? null;
    this.colorSpace = {
      primaries: init.colorSpace?.primaries ?? 'bt709',
      transfer: init.colorSpace?.transfer ?? 'bt709',
      matrix: init.colorSpace?.matrix ?? 'bt709',
      fullRange: init.colorSpace?.fullRange ?? true,
    };
  }

  allocationSize(): number {
    return this._data.byteLength;
  }

  async copyTo(destination: Uint8Array | Uint8ClampedArray): Promise<Array<{ offset: number; stride: number }>> {
    if (this._closed) {
      throw new Error('VideoFrame is closed');
    }
    destination.set(this._data.subarray(0, destination.length));
    return [{ offset: 0, stride: this.codedWidth * 4 }];
  }

  clone(): VideoFramePolyfill {
    if (this._closed) {
      throw new Error('VideoFrame is closed');
    }
    return new VideoFramePolyfill(this._data, {
      format: this.format,
      codedWidth: this.codedWidth,
      codedHeight: this.codedHeight,
      timestamp: this.timestamp,
      duration: this.duration ?? undefined,
      colorSpace: this.colorSpace,
    });
  }

  close(): void {
    this._closed = true;
  }

  // Property to expose data for OffscreenCanvas polyfill
  get _rawData(): Uint8Array {
    return this._data;
  }
}

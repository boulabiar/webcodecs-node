/**
 * OffscreenCanvas polyfill using sharp for image processing
 */

import { OffscreenCanvasRenderingContext2DPolyfill } from './CanvasRenderingContext2DPolyfill.js';

export class OffscreenCanvasPolyfill {
  readonly width: number;
  readonly height: number;
  private _context: OffscreenCanvasRenderingContext2DPolyfill | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(contextId: string, _options?: unknown): OffscreenCanvasRenderingContext2DPolyfill | null {
    if (contextId === '2d') {
      if (!this._context) {
        this._context = new OffscreenCanvasRenderingContext2DPolyfill(this);
      }
      return this._context;
    }
    return null;
  }

  convertToBlob(_options?: unknown): Promise<Blob> {
    return Promise.reject(new Error('convertToBlob not implemented'));
  }

  transferToImageBitmap(): unknown {
    // Create a minimal ImageBitmap-like object
    const imageData = this._context?._getImageData() || new Uint8ClampedArray(this.width * this.height * 4);

    return {
      width: this.width,
      height: this.height,
      close: () => {},
      _data: imageData,
    };
  }

  // Internal method to get image data
  _getImageData(): Uint8ClampedArray {
    return this._context?._getImageData() || new Uint8ClampedArray(this.width * this.height * 4);
  }

  // Apply any pending async operations
  async _flush(): Promise<void> {
    if (this._context) {
      await this._context._applyPendingResizeAsync();
    }
  }
}

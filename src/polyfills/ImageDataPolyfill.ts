/**
 * ImageData polyfill for Node.js
 */

export class ImageDataPolyfill {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: string = 'srgb';

  constructor(width: number, height: number);
  constructor(data: Uint8ClampedArray, width: number, height?: number);
  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    height?: number
  ) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? (dataOrWidth.length / 4 / widthOrHeight);
    }
  }
}

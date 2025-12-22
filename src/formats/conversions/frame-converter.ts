/**
 * Frame format conversion utilities
 *
 * Standalone functions for converting video frame data between pixel formats.
 * These functions operate on raw pixel buffers without requiring a VideoFrame instance.
 */

import { rgbaToYuv, yuvToRgba } from '../color-space.js';
import { getPlaneInfo, isRgbFormat, isBgrFormat, type VideoPixelFormat } from '../pixel-formats.js';

// Re-export VideoPixelFormat for backwards compatibility
export type { VideoPixelFormat };

/**
 * Frame buffer descriptor
 */
export interface FrameBuffer {
  data: Uint8Array;
  format: VideoPixelFormat;
  width: number;
  height: number;
}

/**
 * Get UV values at a specific position in a YUV frame
 */
export function getUvAt(
  data: Uint8Array,
  format: VideoPixelFormat,
  width: number,
  height: number,
  x: number,
  y: number
): [number, number] {
  if (format === 'I420' || format === 'I420A') {
    const chromaW = Math.ceil(width / 2);
    const chromaH = Math.ceil(height / 2);
    const ySize = width * height;
    const uvSize = chromaW * chromaH;

    const cx = Math.floor(x / 2);
    const cy = Math.floor(y / 2);

    const u = data[ySize + cy * chromaW + cx];
    const v = data[ySize + uvSize + cy * chromaW + cx];
    return [u, v];
  } else if (format === 'NV12') {
    const ySize = width * height;
    const cx = Math.floor(x / 2) * 2;
    const cy = Math.floor(y / 2);

    const u = data[ySize + cy * width + cx];
    const v = data[ySize + cy * width + cx + 1];
    return [u, v];
  } else if (format === 'I422') {
    const chromaW = Math.ceil(width / 2);
    const ySize = width * height;
    const uvSize = chromaW * height;

    const cx = Math.floor(x / 2);

    const u = data[ySize + y * chromaW + cx];
    const v = data[ySize + uvSize + y * chromaW + cx];
    return [u, v];
  } else if (format === 'I444') {
    const ySize = width * height;

    const u = data[ySize + y * width + x];
    const v = data[2 * ySize + y * width + x];
    return [u, v];
  }

  return [128, 128];
}

/**
 * Get the byte offset for a plane in a frame buffer
 */
export function getPlaneOffset(
  format: VideoPixelFormat,
  width: number,
  height: number,
  planeIndex: number
): number {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format) {
    case 'I420':
    case 'I420A': {
      const ySize = width * height;
      const uvSize = chromaW * chromaH;
      if (planeIndex === 0) return 0;
      if (planeIndex === 1) return ySize;
      if (planeIndex === 2) return ySize + uvSize;
      if (planeIndex === 3) return ySize + 2 * uvSize;
      return 0;
    }
    case 'I422': {
      const ySize = width * height;
      const uvSize = chromaW * height;
      if (planeIndex === 0) return 0;
      if (planeIndex === 1) return ySize;
      if (planeIndex === 2) return ySize + uvSize;
      return 0;
    }
    case 'I444': {
      const planeSize = width * height;
      return planeIndex * planeSize;
    }
    case 'NV12': {
      if (planeIndex === 0) return 0;
      return width * height;
    }
    default:
      return 0;
  }
}

/**
 * Convert RGB to RGB with potential channel swap (RGBA <-> BGRA)
 */
export function convertRgbToRgb(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number
): void {
  const srcStride = src.width * 4;
  const swapRB = isBgrFormat(src.format) !== isBgrFormat(destFormat);

  let destOffset = 0;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const srcOffset = (srcY + y) * srcStride + (srcX + x) * 4;
      if (swapRB) {
        dest[destOffset++] = src.data[srcOffset + 2];
        dest[destOffset++] = src.data[srcOffset + 1];
        dest[destOffset++] = src.data[srcOffset];
        dest[destOffset++] = src.data[srcOffset + 3];
      } else {
        dest[destOffset++] = src.data[srcOffset];
        dest[destOffset++] = src.data[srcOffset + 1];
        dest[destOffset++] = src.data[srcOffset + 2];
        dest[destOffset++] = src.data[srcOffset + 3];
      }
    }
  }
}

/**
 * Convert YUV to RGB format
 */
export function convertYuvToRgb(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number
): void {
  const isBgr = isBgrFormat(destFormat);
  const yOffset = getPlaneOffset(src.format, src.width, src.height, 0);
  const yStride = src.width;

  let destOffset = 0;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const absX = srcX + x;
      const absY = srcY + y;

      const yVal = src.data[yOffset + absY * yStride + absX];
      const [uVal, vVal] = getUvAt(src.data, src.format, src.width, src.height, absX, absY);
      const [r, g, b, a] = yuvToRgba(yVal, uVal, vVal);

      if (isBgr) {
        dest[destOffset++] = b;
        dest[destOffset++] = g;
        dest[destOffset++] = r;
        dest[destOffset++] = a;
      } else {
        dest[destOffset++] = r;
        dest[destOffset++] = g;
        dest[destOffset++] = b;
        dest[destOffset++] = a;
      }
    }
  }
}

/**
 * Convert RGB to YUV format
 */
export function convertRgbToYuv(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number
): void {
  const isBgr = isBgrFormat(src.format);
  const srcStride = src.width * 4;

  const yPlaneSize = srcW * srcH;
  const chromaW = Math.ceil(srcW / 2);
  const chromaH = Math.ceil(srcH / 2);

  // Fill Y plane
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const srcOffset = (srcY + y) * srcStride + (srcX + x) * 4;
      const r = isBgr ? src.data[srcOffset + 2] : src.data[srcOffset];
      const g = src.data[srcOffset + 1];
      const b = isBgr ? src.data[srcOffset] : src.data[srcOffset + 2];

      const [yVal] = rgbaToYuv(r, g, b);
      dest[y * srcW + x] = yVal;
    }
  }

  // Fill U, V planes
  if (destFormat === 'I420' || destFormat === 'I420A') {
    const uOffset = yPlaneSize;
    const vOffset = yPlaneSize + chromaW * chromaH;

    for (let y = 0; y < chromaH; y++) {
      for (let x = 0; x < chromaW; x++) {
        const srcPx = Math.min((srcX + x * 2), src.width - 1);
        const srcPy = Math.min((srcY + y * 2), src.height - 1);
        const srcOffset = srcPy * srcStride + srcPx * 4;

        const r = isBgr ? src.data[srcOffset + 2] : src.data[srcOffset];
        const g = src.data[srcOffset + 1];
        const b = isBgr ? src.data[srcOffset] : src.data[srcOffset + 2];

        const [, uVal, vVal] = rgbaToYuv(r, g, b);
        dest[uOffset + y * chromaW + x] = uVal;
        dest[vOffset + y * chromaW + x] = vVal;
      }
    }

    if (destFormat === 'I420A') {
      const aOffset = yPlaneSize + 2 * chromaW * chromaH;
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const srcOffset = (srcY + y) * srcStride + (srcX + x) * 4;
          dest[aOffset + y * srcW + x] = src.data[srcOffset + 3];
        }
      }
    }
  } else if (destFormat === 'NV12') {
    const uvOffset = yPlaneSize;

    for (let y = 0; y < chromaH; y++) {
      for (let x = 0; x < chromaW; x++) {
        const srcPx = Math.min((srcX + x * 2), src.width - 1);
        const srcPy = Math.min((srcY + y * 2), src.height - 1);
        const srcOffset = srcPy * srcStride + srcPx * 4;

        const r = isBgr ? src.data[srcOffset + 2] : src.data[srcOffset];
        const g = src.data[srcOffset + 1];
        const b = isBgr ? src.data[srcOffset] : src.data[srcOffset + 2];

        const [, uVal, vVal] = rgbaToYuv(r, g, b);
        dest[uvOffset + y * srcW + x * 2] = uVal;
        dest[uvOffset + y * srcW + x * 2 + 1] = vVal;
      }
    }
  }
}

/**
 * Convert between any two pixel formats
 */
export function convertFrameFormat(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number = 0,
  srcY: number = 0,
  srcW?: number,
  srcH?: number
): void {
  const width = srcW ?? src.width;
  const height = srcH ?? src.height;

  const srcIsRgb = isRgbFormat(src.format);
  const destIsRgb = isRgbFormat(destFormat);

  if (srcIsRgb && destIsRgb) {
    convertRgbToRgb(src, dest, destFormat, srcX, srcY, width, height);
  } else if (!srcIsRgb && destIsRgb) {
    convertYuvToRgb(src, dest, destFormat, srcX, srcY, width, height);
  } else if (srcIsRgb && !destIsRgb) {
    convertRgbToYuv(src, dest, destFormat, srcX, srcY, width, height);
  } else {
    // YUV to YUV - convert via RGB
    const rgbaSize = width * height * 4;
    const rgbaBuffer = new Uint8Array(rgbaSize);
    convertYuvToRgb(src, rgbaBuffer, 'RGBA', srcX, srcY, width, height);

    const tempSrc: FrameBuffer = {
      data: rgbaBuffer,
      format: 'RGBA',
      width,
      height,
    };
    convertRgbToYuv(tempSrc, dest, destFormat, 0, 0, width, height);
  }
}

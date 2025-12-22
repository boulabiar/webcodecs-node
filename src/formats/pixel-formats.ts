/**
 * Pixel format definitions and utilities
 */

export type VideoPixelFormat =
  | 'I420'
  | 'I420A'
  | 'I422'
  | 'I444'
  | 'NV12'
  | 'RGBA'
  | 'RGBX'
  | 'BGRA'
  | 'BGRX';

/**
 * Information about a single plane in a pixel format
 */
export interface PlaneInfo {
  width: number;
  height: number;
  bytesPerPixel: number;
}

/**
 * Calculate total allocation size for a frame
 */
export function getFrameAllocationSize(format: VideoPixelFormat, width: number, height: number): number {
  switch (format) {
    case 'I420':
      // Y: width * height, U: (width/2) * (height/2), V: (width/2) * (height/2)
      return width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2);
    case 'I420A':
      // I420 + Alpha plane (width * height)
      return width * height * 2 + 2 * Math.ceil(width / 2) * Math.ceil(height / 2);
    case 'I422':
      // Y: width * height, U: (width/2) * height, V: (width/2) * height
      return width * height + 2 * Math.ceil(width / 2) * height;
    case 'I444':
      // Y: width * height, U: width * height, V: width * height
      return width * height * 3;
    case 'NV12':
      // Y: width * height, UV interleaved: width * (height/2)
      return width * height + width * Math.ceil(height / 2);
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return width * height * 4;
    default:
      return width * height * 4; // Assume RGBA as fallback
  }
}

/**
 * Get number of planes for a pixel format
 */
export function getPlaneCount(format: VideoPixelFormat): number {
  switch (format) {
    case 'I420':
    case 'I422':
    case 'I444':
      return 3; // Y, U, V
    case 'I420A':
      return 4; // Y, U, V, A
    case 'NV12':
      return 2; // Y, UV interleaved
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return 1; // Single plane
    default:
      return 1;
  }
}

/**
 * Get plane info for a format at a specific plane index
 */
export function getPlaneInfo(
  format: VideoPixelFormat,
  width: number,
  height: number,
  planeIndex: number
): PlaneInfo {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format) {
    case 'I420':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 1 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 1 };
    case 'I420A':
      if (planeIndex === 0 || planeIndex === 3) return { width, height, bytesPerPixel: 1 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 1 };
    case 'I422':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 1 };
      return { width: chromaW, height, bytesPerPixel: 1 };
    case 'I444':
      return { width, height, bytesPerPixel: 1 };
    case 'NV12':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 1 };
      return { width, height: chromaH, bytesPerPixel: 2 }; // UV interleaved
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return { width, height, bytesPerPixel: 4 };
    default:
      return { width, height, bytesPerPixel: 4 };
  }
}

/**
 * Check if a format is RGB-based (as opposed to YUV)
 */
export function isRgbFormat(format: VideoPixelFormat): boolean {
  return format === 'RGBA' || format === 'RGBX' || format === 'BGRA' || format === 'BGRX';
}

/**
 * Check if a format is YUV-based
 */
export function isYuvFormat(format: VideoPixelFormat): boolean {
  return !isRgbFormat(format);
}

/**
 * Check if a format uses BGR channel order
 */
export function isBgrFormat(format: VideoPixelFormat): boolean {
  return format === 'BGRA' || format === 'BGRX';
}

/**
 * Check if a format has an alpha channel
 */
export function hasAlphaChannel(format: VideoPixelFormat): boolean {
  return format === 'RGBA' || format === 'BGRA' || format === 'I420A';
}

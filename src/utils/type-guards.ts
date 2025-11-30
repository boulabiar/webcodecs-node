/**
 * Type guards for checking object types at runtime
 */

/**
 * Interface for ImageData-like objects
 */
export interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Interface for canvas-like objects with getContext
 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext: (type: string, options?: unknown) => unknown;
  _getImageData?: () => Uint8ClampedArray;
}

/**
 * Interface for VideoFrame-like objects (including our polyfill)
 */
export interface VideoFrameLike {
  codedWidth: number;
  codedHeight: number;
  format: string;
  timestamp: number;
  duration?: number | null;
  _buffer?: Uint8Array;
  _rawData?: Uint8Array;
  _data?: Uint8Array;
}

/**
 * Check if object is ImageData-like (has data, width, height)
 */
export function isImageDataLike(obj: unknown): obj is ImageDataLike {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    (o.data instanceof Uint8ClampedArray || o.data instanceof Uint8Array) &&
    typeof o.width === 'number' &&
    typeof o.height === 'number'
  );
}

/**
 * Check if object is a canvas-like object with getContext
 */
export function isCanvasLike(obj: unknown): obj is CanvasLike {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    typeof o.getContext === 'function'
  );
}

/**
 * Check if object is a VideoFrame-like object
 */
export function isVideoFrameLike(obj: unknown): obj is VideoFrameLike {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.codedWidth === 'number' &&
    typeof o.codedHeight === 'number' &&
    typeof o.format === 'string' &&
    typeof o.timestamp === 'number'
  );
}

/**
 * Check if an object is a CanvasImageSource-like object
 */
export function isCanvasImageSource(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    (typeof o.width === 'number' && typeof o.height === 'number') ||
    (typeof o.codedWidth === 'number' && typeof o.codedHeight === 'number') ||
    isImageDataLike(obj)
  );
}

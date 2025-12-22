/**
 * OffscreenCanvas polyfill for Node.js using sharp
 *
 * This provides a minimal implementation of OffscreenCanvas and CanvasRenderingContext2D
 * sufficient for Mediabunny's video frame processing needs.
 */

// Re-export all polyfill classes
export { ImageDataPolyfill } from './ImageDataPolyfill.js';
export { OffscreenCanvasRenderingContext2DPolyfill } from './CanvasRenderingContext2DPolyfill.js';
export { OffscreenCanvasPolyfill } from './OffscreenCanvasPolyfill.js';
export { VideoFramePolyfill } from './VideoFramePolyfill.js';

// Import for global installation
import { ImageDataPolyfill } from './ImageDataPolyfill.js';
import { OffscreenCanvasRenderingContext2DPolyfill } from './CanvasRenderingContext2DPolyfill.js';
import { OffscreenCanvasPolyfill } from './OffscreenCanvasPolyfill.js';
import { VideoFramePolyfill } from './VideoFramePolyfill.js';

/**
 * Install the OffscreenCanvas polyfill globally
 */
export function installOffscreenCanvasPolyfill(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.OffscreenCanvas === 'undefined') {
    g.OffscreenCanvas = OffscreenCanvasPolyfill;
  }
  if (typeof g.OffscreenCanvasRenderingContext2D === 'undefined') {
    g.OffscreenCanvasRenderingContext2D = OffscreenCanvasRenderingContext2DPolyfill;
  }
  if (typeof g.ImageData === 'undefined') {
    g.ImageData = ImageDataPolyfill;
  }
  if (typeof g.VideoFrame === 'undefined') {
    g.VideoFrame = VideoFramePolyfill;
  }
}

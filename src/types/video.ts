/**
 * Video-related type definitions
 */

import type { PlaneLayout, DOMRectInit } from './geometry.js';
import type { VideoColorSpaceInit } from '../formats/color-space.js';
import type { VideoPixelFormat } from '../formats/pixel-formats.js';

// Re-export VideoPixelFormat from pixel-formats (canonical source)
export type { VideoPixelFormat };

/**
 * Initialization options for creating a VideoFrame from raw pixel data
 */
export interface VideoFrameBufferInit {
  format: VideoPixelFormat;
  codedWidth: number;
  codedHeight: number;
  timestamp: number;
  duration?: number;
  layout?: PlaneLayout[];
  visibleRect?: DOMRectInit;
  displayWidth?: number;
  displayHeight?: number;
  colorSpace?: VideoColorSpaceInit;
}

/**
 * Initialization options for creating a VideoFrame from CanvasImageSource
 */
export interface VideoFrameInit {
  timestamp: number;
  duration?: number;
  alpha?: 'discard' | 'keep';
  visibleRect?: DOMRectInit;
  displayWidth?: number;
  displayHeight?: number;
  colorSpace?: VideoColorSpaceInit;
}

/**
 * Options for VideoFrame.copyTo()
 */
export interface VideoFrameCopyToOptions {
  rect?: DOMRectInit;
  layout?: PlaneLayout[];
  format?: VideoPixelFormat;
}

/**
 * VideoFrame - Re-export from new location for backwards compatibility
 * @deprecated Import from './core/VideoFrame.js' or './formats/index.js' instead
 */

export * from './core/VideoFrame.js';

// Re-export classes that were previously in this file (runtime exports)
export { VideoColorSpace } from './formats/color-space.js';
export { DOMRectReadOnly } from './types/geometry.js';

// Re-export types that were previously in this file (type-only exports)
export type { VideoColorSpaceInit } from './formats/color-space.js';
export type { DOMRectInit, PlaneLayout } from './types/geometry.js';

/**
 * Type exports for WebCodecs implementation
 */

// Common types
export {
  type BufferSource,
  DOMException,
  type CodecState,
  type HardwareAcceleration,
  type AlphaOption,
  type LatencyMode,
  type BitrateMode,
  type AvcBitstreamFormat,
  type HevcBitstreamFormat,
} from './common.js';

// Geometry types
export {
  type DOMRectInit,
  DOMRectReadOnly,
  type PlaneLayout,
} from './geometry.js';

// Video types
export {
  type VideoPixelFormat,
  type VideoFrameBufferInit,
  type VideoFrameInit,
  type VideoFrameCopyToOptions,
} from './video.js';

// Audio types
export {
  type AudioSampleFormat,
  type AudioDataInit,
  type AudioDataCopyToOptions,
} from './audio.js';

// Native frame types (for node-av integration)
export {
  type NativeFrame,
  type NativeVideoFrame,
  type NativeAudioFrame,
  isNativeFrame,
  hasUnref,
  hasClone,
} from './native-frame.js';

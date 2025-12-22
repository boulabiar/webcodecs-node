/**
 * Encoder exports
 */

export {
  VideoEncoder,
  type VideoEncoderConfig,
  type VideoEncoderInit,
  type VideoEncoderOutputMetadata,
  type VideoEncoderSupport,
  type VideoEncoderEncodeOptions,
} from './VideoEncoder.js';

export {
  AudioEncoder,
  type AudioEncoderConfig,
  type AudioEncoderInit,
  type AudioEncoderOutputMetadata,
  type AudioEncoderSupport,
} from './AudioEncoder.js';

export {
  ImageEncoder,
  type ImageEncoderOptions,
  type ImageEncoderResult,
  type ImageEncoderOutputType,
} from './ImageEncoder.js';

export type { CodecState } from './VideoEncoder.js';

// Codec-specific configurations
export * from './codecs/index.js';

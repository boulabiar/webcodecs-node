/**
 * Utility exports
 */

// Buffer utilities
export {
  toUint8Array,
  copyToUint8Array,
  concatUint8Arrays,
  isReadableStream,
  readStreamToUint8Array,
} from './buffer.js';

// Validation utilities
export {
  validatePositiveInteger,
  validateNonNegativeInteger,
  validateFiniteNumber,
  validateRequired,
  validateNonEmptyString,
  validateConfigured,
  validateNotClosed,
} from './validation.js';

// Logger
export {
  Logger,
  createLogger,
  setDebugMode,
  isDebugMode,
  type LogLevel,
  type LogEntry,
} from './logger.js';

// Type guards
export {
  isImageDataLike,
  isCanvasLike,
  isVideoFrameLike,
  isCanvasImageSource,
  type ImageDataLike,
  type CanvasLike,
  type VideoFrameLike,
} from './type-guards.js';

// Codec helpers
export {
  parseAvcDecoderConfig,
  convertAvccToAnnexB,
  splitAnnexBNals,
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
  type AvcConfig,
} from './avc.js';

export {
  parseHvccDecoderConfig,
  convertHvccToAnnexB,
  splitHevcAnnexBNals,
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
  type HvccConfig,
} from './hevc.js';

export {
  parseAudioSpecificConfig,
  wrapAacFrameWithAdts,
  buildAudioSpecificConfig,
  stripAdtsHeader,
  type AacConfig,
} from './aac.js';

// EventTarget support
export {
  WebCodecsEventTarget,
  type EventListener,
  type EventListenerOptions,
} from './event-target.js';

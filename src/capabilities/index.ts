/**
 * MediaCapabilities module - capability detection and querying
 */

// Types
export type {
  VideoConfiguration,
  AudioConfiguration,
  MediaDecodingConfiguration,
  MediaEncodingConfiguration,
  MediaCapabilitiesInfo,
  MediaCapabilitiesDecodingInfo,
  MediaCapabilitiesEncodingInfo,
} from './types.js';

// Codec utilities
export {
  SUPPORTED_VIDEO_CODECS,
  SUPPORTED_AUDIO_CODECS,
  SUPPORTED_VIDEO_CODEC_BASES,
  SUPPORTED_AUDIO_CODEC_BASES,
  SMOOTH_THRESHOLDS,
  parseContentType,
  isVideoCodecSupported,
  isAudioCodecSupported,
  isVideoCodecBaseSupported,
  isAudioCodecBaseSupported,
  estimateSmoothPlayback,
  checkHardwareAcceleration,
} from './codecs.js';

// MediaCapabilities class
export {
  MediaCapabilities,
  mediaCapabilities,
  loadCapabilitiesProfile,
  setCapabilitiesProfilePath,
} from './MediaCapabilities.js';

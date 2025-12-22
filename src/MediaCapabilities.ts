/**
 * MediaCapabilities API - Query codec capabilities
 * https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities
 *
 * Re-exports from capabilities/ module for backwards compatibility.
 */

export {
  MediaCapabilities,
  mediaCapabilities,
  SUPPORTED_VIDEO_CODECS,
  SUPPORTED_AUDIO_CODECS,
  SMOOTH_THRESHOLDS,
  parseContentType,
  isVideoCodecSupported,
  isAudioCodecSupported,
  estimateSmoothPlayback,
  checkHardwareAcceleration,
} from './capabilities/index.js';

export type {
  VideoConfiguration,
  AudioConfiguration,
  MediaDecodingConfiguration,
  MediaEncodingConfiguration,
  MediaCapabilitiesInfo,
  MediaCapabilitiesDecodingInfo,
  MediaCapabilitiesEncodingInfo,
} from './capabilities/index.js';

/**
 * MediaCapabilities type definitions
 */

/**
 * Video configuration for capability queries
 */
export interface VideoConfiguration {
  contentType: string; // MIME type with codec parameter, e.g., 'video/mp4; codecs="avc1.42E01E"'
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  profile?: string;
  level?: string;
}

/**
 * Audio configuration for capability queries
 */
export interface AudioConfiguration {
  contentType: string; // MIME type with codec parameter, e.g., 'audio/mp4; codecs="mp4a.40.2"'
  channels?: number;
  bitrate?: number;
  samplerate?: number;
  profile?: string;
}

/**
 * Media configuration for decoding capability queries
 */
export interface MediaDecodingConfiguration {
  type: 'file' | 'media-source' | 'webrtc';
  video?: VideoConfiguration;
  audio?: AudioConfiguration;
}

/**
 * Media configuration for encoding capability queries
 */
export interface MediaEncodingConfiguration {
  type: 'record' | 'webrtc';
  video?: VideoConfiguration;
  audio?: AudioConfiguration;
}

/**
 * Result of a capability query
 */
export interface MediaCapabilitiesInfo {
  supported: boolean;
  smooth: boolean;
  powerEfficient: boolean;
}

/**
 * Result of a decoding capability query
 */
export interface MediaCapabilitiesDecodingInfo extends MediaCapabilitiesInfo {
  configuration?: MediaDecodingConfiguration;
}

/**
 * Result of an encoding capability query
 */
export interface MediaCapabilitiesEncodingInfo extends MediaCapabilitiesInfo {
  configuration?: MediaEncodingConfiguration;
}

export interface CapabilityProfile {
  video: CapabilityProfileEntry[];
  audio: CapabilityProfileEntry[];
}

export interface CapabilityProfileEntry {
  codec: string;
  profile?: string;
  level?: string;
  maxWidth?: number;
  maxHeight?: number;
  maxFramerate?: number;
  maxBitrate?: number;
  pixelFormat?: string;
  hardwareAccelerated?: boolean;
}

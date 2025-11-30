/**
 * MediaCapabilities API implementation
 * https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities
 *
 * Provides methods to query decoding and encoding capabilities.
 */

import type {
  MediaDecodingConfiguration,
  MediaEncodingConfiguration,
  MediaCapabilitiesDecodingInfo,
  MediaCapabilitiesEncodingInfo,
  CapabilityProfile,
  CapabilityProfileEntry,
} from './types.js';
import * as fs from 'fs';
import * as path from 'path';

import {
  parseContentType,
  isVideoCodecSupported,
  isAudioCodecSupported,
  estimateSmoothPlayback,
  checkHardwareAcceleration,
} from './codecs.js';
import type { VideoConfiguration, AudioConfiguration } from './types.js';

/**
 * MediaCapabilities API implementation
 */
export class MediaCapabilities {
  private _profile: CapabilityProfile | null = null;

  constructor(profile?: CapabilityProfile | null) {
    this._profile = profile ?? loadCapabilitiesProfileFromEnv();
  }
  /**
   * Query decoding capabilities for a media configuration
   *
   * @param configuration - The media configuration to query
   * @returns Promise resolving to capability information
   *
   * @example
   * ```typescript
   * const info = await mediaCapabilities.decodingInfo({
   *   type: 'file',
   *   video: {
   *     contentType: 'video/mp4; codecs="avc1.42E01E"',
   *     width: 1920,
   *     height: 1080,
   *     bitrate: 5000000,
   *     framerate: 30,
   *   },
   * });
   *
   * if (info.supported && info.smooth) {
   *   console.log('Can decode smoothly!');
   * }
   * ```
   */
  async decodingInfo(
    configuration: MediaDecodingConfiguration
  ): Promise<MediaCapabilitiesDecodingInfo> {
    // Validate configuration
    if (!configuration.type) {
      throw new TypeError('configuration.type is required');
    }

    if (!configuration.video && !configuration.audio) {
      throw new TypeError('At least one of video or audio configuration is required');
    }

    let videoSupported = true;
    let audioSupported = true;
    let videoCodec: string | null = null;

    // Check video support
    if (configuration.video) {
      const videoConfig = configuration.video;
      const { mimeType, codec } = parseContentType(videoConfig.contentType);
      videoCodec = codec;
      videoSupported = isVideoCodecSupported(mimeType, codec) && this._isVideoConfigValid(videoConfig);
    }

    // Check audio support
    if (configuration.audio) {
      const audioConfig = configuration.audio;
      const { mimeType, codec } = parseContentType(audioConfig.contentType);
      audioSupported = isAudioCodecSupported(mimeType, codec) && this._isAudioConfigValid(audioConfig);
    }

    const supported = videoSupported && audioSupported;

    if (!supported) {
      return {
        supported: false,
        smooth: false,
        powerEfficient: false,
        configuration,
      };
    }

    const { smooth, powerEfficient } = await this._evaluateVideoCapabilities(configuration.video, videoCodec);

    return {
      supported,
      smooth,
      powerEfficient,
      configuration,
    };
  }

  /**
   * Query encoding capabilities for a media configuration
   *
   * @param configuration - The media configuration to query
   * @returns Promise resolving to capability information
   *
   * @example
   * ```typescript
   * const info = await mediaCapabilities.encodingInfo({
   *   type: 'record',
   *   video: {
   *     contentType: 'video/webm; codecs="vp9"',
   *     width: 1280,
   *     height: 720,
   *     bitrate: 2000000,
   *     framerate: 30,
   *   },
   * });
   *
   * if (info.supported && info.powerEfficient) {
   *   console.log('Can encode with hardware acceleration!');
   * }
   * ```
   */
  async encodingInfo(
    configuration: MediaEncodingConfiguration
  ): Promise<MediaCapabilitiesEncodingInfo> {
    // Validate configuration
    if (!configuration.type) {
      throw new TypeError('configuration.type is required');
    }

    if (!configuration.video && !configuration.audio) {
      throw new TypeError('At least one of video or audio configuration is required');
    }

    let videoSupported = true;
    let audioSupported = true;
    let videoCodec: string | null = null;

    // Check video support
    if (configuration.video) {
      const videoConfig = configuration.video;
      const { mimeType, codec } = parseContentType(videoConfig.contentType);
      videoCodec = codec;
      videoSupported = isVideoCodecSupported(mimeType, codec) && this._isVideoConfigValid(videoConfig);
    }

    // Check audio support
    if (configuration.audio) {
      const audioConfig = configuration.audio;
      const { mimeType, codec } = parseContentType(audioConfig.contentType);
      audioSupported = isAudioCodecSupported(mimeType, codec) && this._isAudioConfigValid(audioConfig);
    }

    const supported = videoSupported && audioSupported;

    if (!supported) {
      return {
        supported: false,
        smooth: false,
        powerEfficient: false,
        configuration,
      };
    }

    const { smooth, powerEfficient } = await this._evaluateVideoCapabilities(configuration.video, videoCodec);

    return {
      supported,
      smooth,
      powerEfficient,
      configuration,
    };
  }

  private _isVideoConfigValid(config: VideoConfiguration): boolean {
    return (
      this._isPositiveInteger(config.width) &&
      this._isPositiveInteger(config.height) &&
      this._isPositiveNumber(config.framerate) &&
      this._isPositiveNumber(config.bitrate)
    );
  }

  private _isAudioConfigValid(config: AudioConfiguration): boolean {
    if (config.channels !== undefined && config.channels <= 0) {
      return false;
    }
    if (config.samplerate !== undefined && config.samplerate <= 0) {
      return false;
    }
    if (config.bitrate !== undefined && config.bitrate <= 0) {
      return false;
    }
    return true;
  }

  private _isPositiveNumber(value: number | undefined): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }
  private _isPositiveInteger(value: number): boolean {
    return Number.isInteger(value) && value > 0;
  }

  private async _evaluateVideoCapabilities(
    video: VideoConfiguration | undefined,
    codec: string | null
  ): Promise<{ smooth: boolean; powerEfficient: boolean }> {
    if (!video) {
      return { smooth: true, powerEfficient: false };
    }

    const hasHardwareAcceleration = await checkHardwareAcceleration(codec);
    const smooth = this._profile
      ? this._evaluateWithProfile(video, codec, hasHardwareAcceleration)
      : await estimateSmoothPlayback(video, hasHardwareAcceleration);
    return {
      smooth,
      powerEfficient: hasHardwareAcceleration,
    };
  }

  private _evaluateWithProfile(
    video: VideoConfiguration,
    codec: string | null,
    hasHardwareAccel: boolean
  ): boolean {
    if (!this._profile || !codec) {
      return false;
    }

    const entry = findProfileEntry(this._profile.video, codec, video.profile, video.level);
    if (!entry) {
      return false;
    }

    if (entry.maxWidth && video.width > entry.maxWidth) return false;
    if (entry.maxHeight && video.height > entry.maxHeight) return false;
    if (entry.maxFramerate && video.framerate > entry.maxFramerate) return false;
    if (entry.maxBitrate && video.bitrate > entry.maxBitrate) return false;

    return true;
  }
}

let cachedProfile: CapabilityProfile | null = null;
let profilePath: string | null = null;

export function loadCapabilitiesProfile(filePath?: string): CapabilityProfile | null {
  try {
    const resolved = filePath ?? profilePath ?? defaultProfilePath();
    if (!resolved) {
      return null;
    }
    const data = fs.readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(data) as CapabilityProfile;
    cachedProfile = parsed;
    profilePath = resolved;
    return parsed;
  } catch {
    return null;
  }
}

export function setCapabilitiesProfilePath(filePath: string | null): void {
  profilePath = filePath;
  if (filePath) {
    loadCapabilitiesProfile(filePath);
  } else {
    cachedProfile = null;
  }
}

export function loadCapabilitiesProfileFromEnv(): CapabilityProfile | null {
  const envPath = process.env.WEBCODECS_CAPABILITIES_PROFILE;
  if (envPath) {
    return loadCapabilitiesProfile(envPath);
  }
  if (cachedProfile) {
    return cachedProfile;
  }
  return loadCapabilitiesProfile();
}

function defaultProfilePath(): string | null {
  try {
    const home = process.env.HOME;
    if (!home) return null;
    const candidate = path.join(home, '.config', 'webcodecs-node', 'capabilities.json');
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function findProfileEntry(
  entries: CapabilityProfileEntry[] | undefined,
  codec: string,
  profile?: string,
  level?: string
): CapabilityProfileEntry | null {
  if (!entries) {
    return null;
  }

  const codecBase = codec.split('.')[0].toLowerCase();

  const exact = entries.find((entry) => {
    const base = entry.codec.split('.')[0].toLowerCase();
    if (base !== codecBase) return false;
    if (entry.profile && profile && entry.profile !== profile) return false;
    if (entry.level && level && entry.level !== level) return false;
    return true;
  });

  if (exact) return exact;

  return entries.find((entry) => entry.codec.split('.')[0].toLowerCase() === codecBase) ?? null;
}

/**
 * Global MediaCapabilities instance (matches browser API pattern)
 */
export const mediaCapabilities = new MediaCapabilities();

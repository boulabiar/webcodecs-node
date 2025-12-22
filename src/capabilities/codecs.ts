/**
 * Supported codecs and codec checking utilities
 */

import { detectHardwareAcceleration, parseCodecString } from '../hardware/index.js';
import type { VideoConfiguration } from './types.js';

/**
 * Supported video codecs by container (via FFmpeg)
 */
export const SUPPORTED_VIDEO_CODECS: Record<string, string[]> = {
  'video/mp4': ['avc1', 'avc3', 'hev1', 'hvc1', 'av01'],
  'video/webm': ['vp8', 'vp9', 'vp09', 'av01'],
  'video/ogg': ['theora'],
};

/**
 * Supported audio codecs by container (via FFmpeg)
 */
export const SUPPORTED_AUDIO_CODECS: Record<string, string[]> = {
  'audio/mp4': ['mp4a', 'aac'],
  'audio/webm': ['opus', 'vorbis'],
  'audio/ogg': ['opus', 'vorbis', 'flac'],
  'audio/mpeg': ['mp3'],
  'audio/flac': ['flac'],
};

/**
 * Supported video codec base names (for encoder/decoder validation)
 */
export const SUPPORTED_VIDEO_CODEC_BASES = [
  'avc1', 'avc3', 'hev1', 'hvc1', 'vp8', 'vp09', 'vp9', 'av01', 'av1'
] as const;

/**
 * Supported audio codec base names (for encoder/decoder validation)
 */
export const SUPPORTED_AUDIO_CODEC_BASES = [
  'mp4a', 'aac', 'opus', 'vorbis', 'flac', 'mp3'
] as const;

/**
 * Check if a video codec base name is supported
 */
export function isVideoCodecBaseSupported(codec: string): boolean {
  const codecBase = codec.split('.')[0].toLowerCase();
  return SUPPORTED_VIDEO_CODEC_BASES.includes(codecBase as typeof SUPPORTED_VIDEO_CODEC_BASES[number]);
}

/**
 * Check if an audio codec base name is supported
 */
export function isAudioCodecBaseSupported(codec: string): boolean {
  const codecBase = codec.split('.')[0].toLowerCase();
  return SUPPORTED_AUDIO_CODEC_BASES.includes(codecBase as typeof SUPPORTED_AUDIO_CODEC_BASES[number]);
}

/**
 * Resolution thresholds for smooth playback estimation
 */
export const SMOOTH_THRESHOLDS = {
  software: {
    maxWidth: 1920,
    maxHeight: 1080,
    maxFramerate: 60,
    maxPixelRate: 1920 * 1080 * 60,
    maxBitrate: 10_000_000,
  },
  hardware: {
    maxWidth: 3840,
    maxHeight: 2160,
    maxFramerate: 120,
    maxPixelRate: 3840 * 2160 * 120,
    maxBitrate: 50_000_000,
  },
};

/**
 * Parse a content type string to extract MIME type and codec
 * @param contentType - e.g., 'video/mp4; codecs="avc1.42E01E"'
 */
export function parseContentType(contentType: string): { mimeType: string; codec: string | null } {
  const parts = contentType.split(';').map(p => p.trim());
  const mimeType = parts[0].toLowerCase();

  let codec: string | null = null;
  for (const part of parts.slice(1)) {
    const codecMatch = part.match(/codecs\s*=\s*["']?([^"']+)["']?/i);
    if (codecMatch) {
      codec = codecMatch[1];
      break;
    }
  }

  return { mimeType, codec };
}

/**
 * Check if a video codec is supported
 */
export function isVideoCodecSupported(mimeType: string, codec: string | null): boolean {
  const supportedCodecs = SUPPORTED_VIDEO_CODECS[mimeType];
  if (!supportedCodecs) return false;

  if (!codec) return true; // MIME type supported, no specific codec required

  // Extract base codec (e.g., 'avc1' from 'avc1.42E01E')
  const codecBase = codec.split('.')[0].toLowerCase();
  return supportedCodecs.some(c => c.toLowerCase() === codecBase);
}

/**
 * Check if an audio codec is supported
 */
export function isAudioCodecSupported(mimeType: string, codec: string | null): boolean {
  const supportedCodecs = SUPPORTED_AUDIO_CODECS[mimeType];
  if (!supportedCodecs) return false;

  if (!codec) return true;

  const codecBase = codec.split('.')[0].toLowerCase();
  return supportedCodecs.some(c => c.toLowerCase() === codecBase);
}

/**
 * Estimate if playback would be smooth based on resolution and hardware capabilities
 */
export async function estimateSmoothPlayback(
  video: VideoConfiguration | undefined,
  hasHardwareAccel: boolean
): Promise<boolean> {
  if (!video) return true; // Audio-only is always smooth

  const thresholds = hasHardwareAccel ? SMOOTH_THRESHOLDS.hardware : SMOOTH_THRESHOLDS.software;
  const framerate = video.framerate ?? thresholds.maxFramerate;

  if (video.width > thresholds.maxWidth || video.height > thresholds.maxHeight) {
    return false;
  }
  if (framerate > thresholds.maxFramerate) {
    return false;
  }

  const pixelRate = video.width * video.height * framerate;
  if (pixelRate > thresholds.maxPixelRate) {
    return false;
  }

  if (typeof video.bitrate === 'number' && video.bitrate > thresholds.maxBitrate) {
    return false;
  }

  return true;
}

/**
 * Check if hardware acceleration is available for a codec
 */
export async function checkHardwareAcceleration(codec: string | null): Promise<boolean> {
  if (!codec) return false;

  try {
    const hwCapabilities = await detectHardwareAcceleration();
    const codecName = parseCodecString(codec);

    if (!codecName) return false;

    // Check if any hardware decoder/encoder is available for this codec
    const hasHwDecoder = hwCapabilities.decoders.some(d => d.codec === codecName);
    const hasHwEncoder = hwCapabilities.encoders.some(e => e.codec === codecName);

    return hasHwDecoder || hasHwEncoder;
  } catch {
    return false;
  }
}

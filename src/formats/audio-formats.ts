/**
 * Audio format utilities
 *
 * Provides utilities for working with audio sample formats,
 * including conversion between different formats.
 */

/**
 * Audio sample formats supported by WebCodecs
 * - Interleaved formats: samples for all channels are interleaved
 * - Planar formats: each channel has its own plane
 */
export type AudioSampleFormat =
  | 'u8'        // Unsigned 8-bit interleaved
  | 's16'       // Signed 16-bit interleaved
  | 's32'       // Signed 32-bit interleaved
  | 'f32'       // Float 32-bit interleaved
  | 'u8-planar' // Unsigned 8-bit planar
  | 's16-planar'// Signed 16-bit planar
  | 's32-planar'// Signed 32-bit planar
  | 'f32-planar';// Float 32-bit planar

/**
 * Bytes per sample for each format
 */
export const BYTES_PER_SAMPLE: Record<AudioSampleFormat, number> = {
  'u8': 1,
  's16': 2,
  's32': 4,
  'f32': 4,
  'u8-planar': 1,
  's16-planar': 2,
  's32-planar': 4,
  'f32-planar': 4,
};

/**
 * Check if format is planar
 */
export function isPlanarFormat(format: AudioSampleFormat): boolean {
  return format.endsWith('-planar');
}

/**
 * Check if format is interleaved
 */
export function isInterleavedFormat(format: AudioSampleFormat): boolean {
  return !format.endsWith('-planar');
}

/**
 * Get the base format type (without -planar suffix)
 */
export function getBaseFormat(format: AudioSampleFormat): 'u8' | 's16' | 's32' | 'f32' {
  return format.replace('-planar', '') as 'u8' | 's16' | 's32' | 'f32';
}

/**
 * Get the planar version of a format
 */
export function toPlanarFormat(format: AudioSampleFormat): AudioSampleFormat {
  if (isPlanarFormat(format)) return format;
  return `${format}-planar` as AudioSampleFormat;
}

/**
 * Get the interleaved version of a format
 */
export function toInterleavedFormat(format: AudioSampleFormat): AudioSampleFormat {
  if (isInterleavedFormat(format)) return format;
  return format.replace('-planar', '') as AudioSampleFormat;
}

/**
 * Calculate the size in bytes for audio data
 */
export function calculateAudioDataSize(
  format: AudioSampleFormat,
  numberOfFrames: number,
  numberOfChannels: number
): number {
  const bytesPerSample = BYTES_PER_SAMPLE[format];
  return bytesPerSample * numberOfFrames * numberOfChannels;
}

/**
 * Calculate the allocation size for a single plane
 */
export function calculatePlaneSize(
  format: AudioSampleFormat,
  numberOfFrames: number,
  numberOfChannels: number
): number {
  const bytesPerSample = BYTES_PER_SAMPLE[format];
  if (isPlanarFormat(format)) {
    return bytesPerSample * numberOfFrames;
  }
  return bytesPerSample * numberOfFrames * numberOfChannels;
}

/**
 * Get the number of planes for a format
 */
export function getNumberOfPlanes(format: AudioSampleFormat, numberOfChannels: number): number {
  return isPlanarFormat(format) ? numberOfChannels : 1;
}

/**
 * FFmpeg audio format mapping
 */
export const FFMPEG_AUDIO_FORMAT_MAP: Record<AudioSampleFormat, string> = {
  'u8': 'u8',
  's16': 's16le',
  's32': 's32le',
  'f32': 'f32le',
  'u8-planar': 'u8p',
  's16-planar': 's16p',
  's32-planar': 's32p',
  'f32-planar': 'flt',
};

/**
 * Convert audio sample format to FFmpeg format string
 */
export function audioFormatToFFmpeg(format: AudioSampleFormat): string {
  return FFMPEG_AUDIO_FORMAT_MAP[format] || format;
}

/**
 * Convert FFmpeg format to audio sample format
 */
export function ffmpegToAudioFormat(ffmpegFormat: string): AudioSampleFormat | null {
  const reverseMap: Record<string, AudioSampleFormat> = {
    'u8': 'u8',
    's16le': 's16',
    's32le': 's32',
    'f32le': 'f32',
    'flt': 'f32',
    'fltp': 'f32-planar',
    'u8p': 'u8-planar',
    's16p': 's16-planar',
    's32p': 's32-planar',
  };
  return reverseMap[ffmpegFormat] || null;
}

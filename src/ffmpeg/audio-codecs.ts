/**
 * FFmpeg audio codec mappings
 *
 * Consolidates all audio codec mappings for encoders and decoders
 */

import type { AudioSampleFormat } from '../types/audio.js';

/**
 * WebCodecs audio codec to FFmpeg encoder mapping
 */
export const AUDIO_ENCODER_CODEC_MAP: Record<string, string> = {
  'opus': 'libopus',
  'mp3': 'libmp3lame',
  'flac': 'flac',
  'mp4a.40.2': 'aac',
  'mp4a.40.5': 'aac',
  'mp4a.40.29': 'aac',
  'aac': 'aac',
  'pcm-s16': 'pcm_s16le',
  'pcm-f32': 'pcm_f32le',
  'vorbis': 'libvorbis',
};

/**
 * WebCodecs audio codec to FFmpeg decoder mapping
 */
export const AUDIO_DECODER_CODEC_MAP: Record<string, { decoder: string; format: string }> = {
  'opus': { decoder: 'libopus', format: 'ogg' },
  'mp3': { decoder: 'mp3', format: 'mp3' },
  'flac': { decoder: 'flac', format: 'flac' },
  'mp4a.40.2': { decoder: 'aac', format: 'aac' },
  'mp4a.40.5': { decoder: 'aac', format: 'aac' },
  'mp4a.40.29': { decoder: 'aac', format: 'aac' },
  'aac': { decoder: 'aac', format: 'aac' },
  'pcm-s16': { decoder: 'pcm_s16le', format: 's16le' },
  'pcm-f32': { decoder: 'pcm_f32le', format: 'f32le' },
  'vorbis': { decoder: 'libvorbis', format: 'ogg' },
};

/**
 * FFmpeg encoder to output container format mapping
 */
export const AUDIO_ENCODER_FORMAT_MAP: Record<string, string> = {
  'libopus': 'ogg',
  'libmp3lame': 'mp3',
  'flac': 'flac',
  'aac': 'adts',
  'pcm_s16le': 's16le',
  'pcm_f32le': 'f32le',
  'libvorbis': 'ogg',
};

/**
 * Frame size per FFmpeg codec (samples per frame)
 */
export const AUDIO_FRAME_SIZE_MAP: Record<string, number> = {
  'libopus': 960,
  'aac': 1024,
  'libmp3lame': 1152,
};

/**
 * Audio sample format to FFmpeg settings mapping
 */
export interface AudioFormatSettings {
  ffmpegFormat: string;
  bytesPerSample: number;
  isPlanar: boolean;
}

export const AUDIO_OUTPUT_FORMAT_MAP: Record<AudioSampleFormat, AudioFormatSettings> = {
  'u8': { ffmpegFormat: 'u8', bytesPerSample: 1, isPlanar: false },
  's16': { ffmpegFormat: 's16le', bytesPerSample: 2, isPlanar: false },
  's32': { ffmpegFormat: 's32le', bytesPerSample: 4, isPlanar: false },
  'f32': { ffmpegFormat: 'f32le', bytesPerSample: 4, isPlanar: false },
  'u8-planar': { ffmpegFormat: 'u8', bytesPerSample: 1, isPlanar: true },
  's16-planar': { ffmpegFormat: 's16le', bytesPerSample: 2, isPlanar: true },
  's32-planar': { ffmpegFormat: 's32le', bytesPerSample: 4, isPlanar: true },
  'f32-planar': { ffmpegFormat: 'f32le', bytesPerSample: 4, isPlanar: true },
};

/**
 * Get FFmpeg encoder codec from WebCodecs codec string
 * Returns undefined if codec is not supported
 */
export function getAudioEncoderCodec(codec: string): string | undefined {
  const codecBase = codec.split('.')[0].toLowerCase();
  return AUDIO_ENCODER_CODEC_MAP[codecBase] || AUDIO_ENCODER_CODEC_MAP[codec];
}

/**
 * Get FFmpeg decoder info from WebCodecs codec string
 */
export function getAudioDecoderInfo(codec: string): { decoder: string; format: string } {
  const codecBase = codec.split('.')[0].toLowerCase();
  return AUDIO_DECODER_CODEC_MAP[codecBase] || AUDIO_DECODER_CODEC_MAP[codec] || { decoder: 'aac', format: 'adts' };
}

/**
 * Get output format for an FFmpeg encoder codec
 */
export function getAudioEncoderFormat(ffmpegCodec: string): string {
  return AUDIO_ENCODER_FORMAT_MAP[ffmpegCodec] || 'wav';
}

/**
 * Get frame size for an FFmpeg encoder codec
 */
export function getAudioFrameSize(ffmpegCodec: string): number | undefined {
  return AUDIO_FRAME_SIZE_MAP[ffmpegCodec];
}

/**
 * Get FFmpeg output format settings for an AudioSampleFormat
 */
export function getAudioOutputFormatSettings(format: AudioSampleFormat): AudioFormatSettings {
  return AUDIO_OUTPUT_FORMAT_MAP[format] || AUDIO_OUTPUT_FORMAT_MAP['f32'];
}

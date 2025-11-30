/**
 * FFmpeg utilities
 */

export {
  FFmpegProcess,
  type FFmpegConfig,
  type FFmpegInputConfig,
  type FFmpegOutputConfig,
} from './FFmpegProcess.js';

// Types
export {
  type EncodedFrameData,
  type DecoderConfig,
  type EncoderConfig,
  type BitrateMode,
  type AlphaOption,
  DEFAULT_SHUTDOWN_TIMEOUT,
  DEFAULT_FLUSH_TIMEOUT,
} from './types.js';

// Format mappings
export {
  pixelFormatToFFmpeg,
  ffmpegToPixelFormat,
  webCodecToFFmpegCodec,
  webCodecToContainerFormat,
  calculateFrameSize,
  webCodecToFFmpegAudioCodec,
  IMAGE_MIME_TO_FFMPEG,
  AUDIO_CODEC_MAP,
} from './formats.js';

// Audio codec mappings
export {
  AUDIO_ENCODER_CODEC_MAP,
  AUDIO_DECODER_CODEC_MAP,
  AUDIO_ENCODER_FORMAT_MAP,
  AUDIO_FRAME_SIZE_MAP,
  AUDIO_OUTPUT_FORMAT_MAP,
  getAudioEncoderCodec,
  getAudioDecoderInfo,
  getAudioEncoderFormat,
  getAudioFrameSize,
  getAudioOutputFormatSettings,
  type AudioFormatSettings,
} from './audio-codecs.js';

// Parsers
export * from './parsers/index.js';

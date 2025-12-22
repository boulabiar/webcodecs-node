/**
 * FFmpeg configuration types
 */

/**
 * FFmpeg process configuration
 */
export interface FFmpegConfig {
  input: FFmpegInputConfig;
  output: FFmpegOutputConfig;
}

/**
 * FFmpeg input configuration
 */
export interface FFmpegInputConfig {
  format: string;
  codec?: string;
  width?: number;
  height?: number;
  framerate?: number;
  pixelFormat?: string;
}

/**
 * FFmpeg output configuration
 */
export interface FFmpegOutputConfig {
  format: string;
  codec?: string;
  width?: number;
  height?: number;
  framerate?: number;
  pixelFormat?: string;
  bitrate?: number;
}

/**
 * Encoded frame data emitted by parsers
 */
export interface EncodedFrameData {
  data: Buffer;
  timestamp: number;
  keyFrame: boolean;
}

/**
 * Decoder configuration for FFmpegProcess
 */
export interface DecoderConfig {
  codec: string;
  width: number;
  height: number;
  outputPixelFormat?: string;
  hardwareDecoderArgs?: string[];
  hardwareDownloadFilter?: string;
}

/**
 * Bitrate mode for encoding
 * - 'constant': Constant bitrate (CBR) - predictable file size, may vary quality
 * - 'variable': Variable bitrate (VBR) - better quality, less predictable size
 * - 'quantizer': Fixed quality mode (CRF/CQ) - consistent quality, variable size
 */
export type BitrateMode = 'constant' | 'variable' | 'quantizer';

/**
 * Alpha channel handling mode
 * - 'discard': Drop alpha channel (default, works with all codecs)
 * - 'keep': Preserve alpha channel (only VP9 and AV1 support this)
 */
export type AlphaOption = 'discard' | 'keep';

/**
 * Encoder configuration for FFmpegProcess
 */
export interface EncoderConfig {
  codec: string;
  width: number;
  height: number;
  inputPixelFormat?: string;
  framerate?: number;
  bitrate?: number;
  bitrateMode?: BitrateMode;
  latencyMode?: 'quality' | 'realtime';
  alpha?: AlphaOption;
  hardwareEncoderArgs?: string[];
}

/** Default timeout for graceful shutdown (ms) */
export const DEFAULT_SHUTDOWN_TIMEOUT = 5000;

/** Default timeout for flush operations (ms) */
export const DEFAULT_FLUSH_TIMEOUT = 30000;

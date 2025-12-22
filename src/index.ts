/**
 * WebCodecs API implementation for Node.js
 *
 * This module provides a Node.js implementation of the WebCodecs API
 * using FFmpeg as the underlying codec engine.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
 */

// Types
export type { BufferSource, CodecState } from './types/index.js';
export { DOMException, DOMRectReadOnly } from './types/index.js';
export type { PlaneLayout, DOMRectInit } from './types/index.js';
export type {
  VideoPixelFormat,
  VideoFrameBufferInit,
  VideoFrameInit,
  VideoFrameCopyToOptions,
} from './types/index.js';

// Core data structures
export { VideoFrame } from './core/index.js';
export { AudioData } from './core/index.js';
export type {
  AudioSampleFormat,
  AudioDataInit,
  AudioDataCopyToOptions,
} from './core/AudioData.js';

export { EncodedVideoChunk } from './core/index.js';
export type {
  EncodedVideoChunkType,
  EncodedVideoChunkInit,
} from './core/EncodedVideoChunk.js';

export { EncodedAudioChunk } from './core/index.js';
export type {
  EncodedAudioChunkType,
  EncodedAudioChunkInit,
} from './core/EncodedAudioChunk.js';

// Formats
export { VideoColorSpace } from './formats/index.js';
export type { VideoColorSpaceInit } from './formats/index.js';

// Encoders
export { VideoEncoder } from './encoders/index.js';
export type {
  VideoEncoderConfig,
  VideoEncoderInit,
  VideoEncoderSupport,
  VideoEncoderOutputMetadata,
  VideoEncoderEncodeOptions,
} from './encoders/VideoEncoder.js';

export { AudioEncoder } from './encoders/index.js';
export type {
  AudioEncoderConfig,
  AudioEncoderInit,
  AudioEncoderSupport,
  AudioEncoderOutputMetadata,
} from './encoders/AudioEncoder.js';

// Decoders
export { VideoDecoder } from './decoders/index.js';
export type {
  VideoDecoderConfig,
  VideoDecoderInit,
  VideoDecoderSupport,
} from './decoders/VideoDecoder.js';

export { AudioDecoder } from './decoders/index.js';
export type {
  AudioDecoderConfig,
  AudioDecoderInit,
  AudioDecoderSupport,
} from './decoders/AudioDecoder.js';

export { ImageDecoder, ImageTrack, ImageTrackList } from './decoders/index.js';
export type {
  ImageDecoderInit,
  ImageDecodeOptions,
  ImageDecodeResult,
  ColorSpaceConversion,
  PremultiplyAlpha,
} from './decoders/ImageDecoder.js';

// FFmpeg utilities (for advanced use)
export { FFmpegProcess } from './ffmpeg/index.js';
export type { FFmpegConfig, FFmpegInputConfig, FFmpegOutputConfig } from './ffmpeg/index.js';
export {
  pixelFormatToFFmpeg,
  ffmpegToPixelFormat,
  webCodecToFFmpegCodec,
  webCodecToContainerFormat,
  calculateFrameSize,
} from './ffmpeg/index.js';

// Hardware acceleration
export {
  detectHardwareAcceleration,
  getBestEncoder,
  getBestDecoder,
  getHardwareAccelerationSummary,
  testEncoder,
  parseCodecString,
  clearCapabilitiesCache,
  getEncoderArgs,
  getDecoderArgs,
} from './hardware/index.js';
export type {
  HardwareAccelerationMethod,
  VideoCodecName,
  HardwareEncoderInfo,
  HardwareDecoderInfo,
  HardwareCapabilities,
} from './hardware/index.js';

// MediaCapabilities API
export { MediaCapabilities, mediaCapabilities } from './MediaCapabilities.js';
export type {
  VideoConfiguration,
  AudioConfiguration,
  MediaDecodingConfiguration,
  MediaEncodingConfiguration,
  MediaCapabilitiesInfo,
  MediaCapabilitiesDecodingInfo,
  MediaCapabilitiesEncodingInfo,
} from './MediaCapabilities.js';

// Utilities
export { Logger, createLogger, setDebugMode, isDebugMode } from './utils/index.js';
export type { LogLevel, LogEntry } from './utils/index.js';
export {
  isImageDataLike,
  isCanvasLike,
  isVideoFrameLike,
  isCanvasImageSource,
} from './utils/index.js';

// Polyfills
export { installWebCodecsPolyfill } from './polyfill.js';
export { installOffscreenCanvasPolyfill } from './polyfills/OffscreenCanvas.js';

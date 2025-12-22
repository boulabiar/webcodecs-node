/**
 * WebCodecs API implementation for Node.js
 *
 * This module provides a Node.js implementation of the WebCodecs API
 * using node-av (FFmpeg's libav* libraries) as the underlying codec engine.
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
export type {
  VideoColorSpaceInit,
  HdrMetadata,
  SmpteSt2086Metadata,
  ContentLightLevelInfo,
} from './formats/index.js';
export {
  HDR10_DISPLAY_PRIMARIES,
  createHdr10MasteringMetadata,
  createContentLightLevel,
} from './formats/index.js';

// Pixel format utilities (10-bit support)
export {
  is10BitFormat,
  getBitDepth,
  get8BitEquivalent,
  get10BitEquivalent,
  getFrameAllocationSize,
  getPlaneCount,
  getPlaneInfo,
  isRgbFormat,
  isYuvFormat,
  hasAlphaChannel,
} from './formats/index.js';

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

export { ImageEncoder } from './encoders/index.js';
export type {
  ImageEncoderOptions,
  ImageEncoderResult,
  ImageEncoderOutputType,
} from './encoders/ImageEncoder.js';

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

// Codec utilities (for format conversion)
export {
  pixelFormatToFFmpeg,
  ffmpegToPixelFormat,
  webCodecToFFmpegCodec,
  webCodecToContainerFormat,
  calculateFrameSize,
} from './codec-utils/index.js';

// Hardware acceleration
export {
  detectHardwareAcceleration,
  getBestEncoder,
  getBestDecoder,
  getHardwareAccelerationSummary,
  testEncoder,
  parseCodecString,
  clearCapabilitiesCache,
} from './hardware/index.js';
export type {
  HardwareAccelerationMethod,
  VideoCodecName,
  HardwareEncoderInfo,
  HardwareDecoderInfo,
  HardwareCapabilities,
} from './hardware/index.js';

// MediaCapabilities API
export { MediaCapabilities, mediaCapabilities } from './capabilities/index.js';
export type {
  VideoConfiguration,
  AudioConfiguration,
  MediaDecodingConfiguration,
  MediaEncodingConfiguration,
  MediaCapabilitiesInfo,
  MediaCapabilitiesDecodingInfo,
  MediaCapabilitiesEncodingInfo,
} from './capabilities/index.js';

// Utilities
export { Logger, createLogger, setDebugMode, isDebugMode } from './utils/index.js';
export type { LogLevel, LogEntry } from './utils/index.js';
export {
  isImageDataLike,
  isCanvasLike,
  isVideoFrameLike,
  isCanvasImageSource,
  isSkiaCanvas,
  extractCanvasPixels,
} from './utils/index.js';
export type { SkiaCanvasLike } from './utils/index.js';

// Polyfills
export { installWebCodecsPolyfill } from './polyfill.js';
export {
  installOffscreenCanvasPolyfill,
  OffscreenCanvasPolyfill,
  ImageDataPolyfill,
} from './polyfills/OffscreenCanvas.js';
export type { ImageBitmapPolyfill } from './polyfills/OffscreenCanvas.js';

// Canvas module (GPU-accelerated via skia-canvas)
export {
  Canvas,
  loadImage,
  FontLibrary,
  detectGpuAcceleration,
  isGpuAvailable,
  getGpuApi,
  createCanvas,
  ensureEvenDimensions,
  validateEvenDimensions,
  resetGpuCache,
  createPixelBuffer,
  createPixelBufferWithColor,
  getRawPixels,
  getRawPixelsAsync,
  resetCanvas,
  pixelsToImageData,
  drawPixelsToCanvas,
  bufferToUint8Array,
  resizePixels,
  FrameLoop,
  createFrameLoop,
} from './canvas/index.js';
export type {
  GpuEngineInfo,
  CanvasConfig,
  FrameTiming,
  FrameLoopConfig,
  FrameLoopState,
  RawBufferOptions,
  FrameCallback,
} from './canvas/index.js';

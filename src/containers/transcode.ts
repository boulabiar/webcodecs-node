/**
 * High-level transcoding utilities using node-av
 *
 * Provides easy-to-use functions for common transcoding operations.
 * Uses node-av internally for efficient end-to-end processing.
 */

import {
  Demuxer as NodeAvDemuxer,
  Muxer as NodeAvMuxer,
  Decoder as NodeAvDecoder,
  Encoder as NodeAvEncoder,
  HardwareContext,
  FilterAPI,
  AV_CODEC_ID_H264,
  AV_CODEC_ID_HEVC,
  AV_CODEC_ID_VP8,
  AV_CODEC_ID_VP9,
  AV_CODEC_ID_AV1,
  AV_CODEC_ID_AAC,
  AV_CODEC_ID_OPUS,
  AV_CODEC_ID_MP3,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_NV12,
} from 'node-av';
import { Demuxer } from './Demuxer.js';
import { StreamCopier } from './NodeAvMuxer.js';
import { inferFormat } from './muxer-types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Transcode');

/**
 * Video codec options for transcoding
 */
export type VideoCodec = 'h264' | 'hevc' | 'vp8' | 'vp9' | 'av1' | 'copy';

/**
 * Audio codec options for transcoding
 */
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'copy';

/**
 * Hardware acceleration preference
 */
export type HardwareAcceleration = 'no-preference' | 'prefer-hardware' | 'prefer-software';

/**
 * Transcoding options
 */
export interface TranscodeOptions {
  /** Target video codec */
  videoCodec?: VideoCodec;
  /** Target audio codec */
  audioCodec?: AudioCodec;
  /** Target video bitrate in bits per second */
  videoBitrate?: number;
  /** Target audio bitrate in bits per second */
  audioBitrate?: number;
  /** Target video width (maintains aspect ratio if only width specified) */
  width?: number;
  /** Target video height */
  height?: number;
  /** Target framerate */
  framerate?: number;
  /** GOP size (keyframe interval) */
  gopSize?: number;
  /** Target audio sample rate */
  sampleRate?: number;
  /** Target number of audio channels */
  numberOfChannels?: number;
  /** Output container format (mp4, webm, mkv) - inferred from extension if not specified */
  format?: string;
  /** Hardware acceleration preference (default: 'no-preference') */
  hardwareAcceleration?: HardwareAcceleration;
  /** Progress callback */
  onProgress?: (progress: TranscodeProgress) => void;
}

/**
 * Progress information during transcoding
 */
export interface TranscodeProgress {
  /** Number of video frames processed */
  videoFrames: number;
  /** Number of audio frames processed */
  audioFrames: number;
  /** Estimated progress (0-1) if duration is known */
  progress?: number;
}

/**
 * Transcoding result
 */
export interface TranscodeResult {
  /** Number of video frames transcoded */
  videoFrames: number;
  /** Number of audio frames transcoded */
  audioFrames: number;
  /** Output file size in bytes */
  outputSize: number;
}

/**
 * Map video codec string to FFmpeg codec ID
 */
function getVideoCodecId(codec: VideoCodec): number {
  switch (codec) {
    case 'h264':
      return AV_CODEC_ID_H264;
    case 'hevc':
      return AV_CODEC_ID_HEVC;
    case 'vp8':
      return AV_CODEC_ID_VP8;
    case 'vp9':
      return AV_CODEC_ID_VP9;
    case 'av1':
      return AV_CODEC_ID_AV1;
    default:
      return AV_CODEC_ID_H264;
  }
}

/**
 * Map audio codec string to FFmpeg codec ID
 */
function getAudioCodecId(codec: AudioCodec): number {
  switch (codec) {
    case 'aac':
      return AV_CODEC_ID_AAC;
    case 'opus':
      return AV_CODEC_ID_OPUS;
    case 'mp3':
      return AV_CODEC_ID_MP3;
    default:
      return AV_CODEC_ID_AAC;
  }
}

/**
 * Try to create a hardware context for acceleration
 * Returns null if hardware acceleration is not available
 */
function tryCreateHardwareContext(preference: HardwareAcceleration): HardwareContext | null {
  if (preference !== 'prefer-hardware') {
    return null;
  }

  // Try hardware backends in order of reliability
  // VAAPI tends to be more stable on Linux than QSV
  const hwTypesToTry = ['vaapi', 'cuda', 'qsv', 'videotoolbox'];
  for (const hwType of hwTypesToTry) {
    try {
      const hw = HardwareContext.create(hwType as any);
      logger.info(`Using hardware acceleration: ${hw?.deviceTypeName}`);
      return hw;
    } catch {
      // Try next backend
    }
  }

  // Fallback to auto-detection
  try {
    const hw = HardwareContext.auto();
    logger.info(`Using hardware acceleration (auto): ${hw?.deviceTypeName}`);
    return hw;
  } catch {
    logger.info('Hardware acceleration not available, using software');
    return null;
  }
}

/**
 * Video pipeline configuration result
 */
interface VideoPipelineResult {
  decoder: any;
  encoder: any;
  filter: FilterAPI | null;
  streamIndex: number;
  usingHardwareDecoder: boolean;
  usingHardwareEncoder: boolean;
}

/**
 * Create video decoder with optional hardware acceleration
 */
async function createVideoDecoder(
  inputStream: any,
  hardware: HardwareContext | null,
  codecName: string
): Promise<{ decoder: any; isHardware: boolean }> {
  try {
    const decoder = await NodeAvDecoder.create(inputStream, {
      hardware: hardware ?? undefined,
      extraHwFrames: 64,
    } as any);
    const isHardware = hardware !== null && decoder.isHardware?.();
    if (isHardware) {
      logger.info(`Using hardware decoder for ${codecName}`);
    }
    return { decoder, isHardware };
  } catch (err) {
    logger.info(`Hardware decoder failed: ${(err as Error).message}, using software`);
    const decoder = await NodeAvDecoder.create(inputStream);
    return { decoder, isHardware: false };
  }
}

/**
 * Create video encoder with optional hardware acceleration
 */
async function createVideoEncoder(
  codecId: number,
  codecName: string,
  hardware: HardwareContext | null,
  config: {
    width: number;
    height: number;
    framerate: number;
    bitrate: number;
    gopSize: number;
  }
): Promise<{ encoder: any; pixelFormat: number; isHardware: boolean }> {
  let encoderCodec: any = codecId;
  let pixelFormat = AV_PIX_FMT_YUV420P;
  let isHardware = false;

  // Try hardware encoder first
  if (hardware) {
    try {
      const hwCodec = hardware.getEncoderCodec(codecName as any);
      if (hwCodec) {
        encoderCodec = hwCodec;
        pixelFormat = AV_PIX_FMT_NV12;
        isHardware = true;
        logger.info(`Using hardware encoder for ${codecName}`);
      }
    } catch {
      // Fallback to software encoder
    }
  }

  // Create encoder
  try {
    const encoder = await NodeAvEncoder.create(encoderCodec, {
      width: config.width,
      height: config.height,
      pixelFormat,
      timeBase: { num: 1, den: config.framerate },
      frameRate: { num: config.framerate, den: 1 },
      bitrate: config.bitrate,
      gopSize: config.gopSize,
      hardware: isHardware ? hardware ?? undefined : undefined,
      extraHwFrames: 64,
    } as any);
    return { encoder, pixelFormat, isHardware };
  } catch (err) {
    if (!isHardware) throw err;

    // Fallback to software encoder
    logger.info(`Hardware encoder failed: ${(err as Error).message}, using software`);
    const encoder = await NodeAvEncoder.create(codecId as any, {
      width: config.width,
      height: config.height,
      pixelFormat: AV_PIX_FMT_YUV420P,
      timeBase: { num: 1, den: config.framerate },
      frameRate: { num: config.framerate, den: 1 },
      bitrate: config.bitrate,
      gopSize: config.gopSize,
    } as any);
    return { encoder, pixelFormat: AV_PIX_FMT_YUV420P, isHardware: false };
  }
}

/**
 * Create video filter for format conversion between decoder and encoder
 */
function createVideoFilter(
  hardware: HardwareContext | null,
  usingHardwareDecoder: boolean,
  usingHardwareEncoder: boolean,
  encoderPixelFormat: number
): FilterAPI | null {
  if (!usingHardwareDecoder && !usingHardwareEncoder) {
    return null;
  }

  const filterChain = buildTranscodeFilterChain(
    hardware?.deviceTypeName || 'software',
    usingHardwareDecoder,
    usingHardwareEncoder,
    encoderPixelFormat === AV_PIX_FMT_NV12 ? 'nv12' : 'yuv420p'
  );

  if (!filterChain) {
    return null;
  }

  try {
    const filter = FilterAPI.create(filterChain, {
      hardware: hardware ?? undefined,
    } as any);
    logger.info(`Using filter chain: ${filterChain}`);
    return filter;
  } catch (err) {
    logger.info(`Filter chain failed, using simple format conversion: ${(err as Error).message}`);
    return FilterAPI.create(`format=${encoderPixelFormat === AV_PIX_FMT_NV12 ? 'nv12' : 'yuv420p'}`);
  }
}

/**
 * Audio pipeline configuration result
 */
interface AudioPipelineResult {
  decoder: any;
  encoder: any;
  streamIndex: number;
}

/**
 * Create audio transcoding pipeline
 */
async function createAudioPipeline(
  inputStream: any,
  muxer: any,
  options: TranscodeOptions
): Promise<AudioPipelineResult> {
  const cp = inputStream.codecpar;
  const codecId = getAudioCodecId(options.audioCodec || 'aac');

  const decoder = await NodeAvDecoder.create(inputStream);
  const encoder = await NodeAvEncoder.create(codecId as any, {
    sampleRate: options.sampleRate || cp.sampleRate,
    channels: options.numberOfChannels || cp.channels,
    bitrate: options.audioBitrate || 128_000,
  } as any);

  const streamIndex = muxer.addStream(encoder);
  return { decoder, encoder, streamIndex };
}

/**
 * Build filter chain for transcoding based on hardware configuration
 * Handles: hardware frame download, format conversion, and optionally hardware upload
 */
function buildTranscodeFilterChain(
  hwType: string,
  hwDecoder: boolean,
  hwEncoder: boolean,
  targetFormat: string
): string | null {
  // Case 1: Both hardware - try to stay on GPU
  if (hwDecoder && hwEncoder) {
    switch (hwType) {
      case 'vaapi':
        return `scale_vaapi=format=${targetFormat}`;
      case 'cuda':
        return `scale_cuda=format=${targetFormat}`;
      case 'qsv':
        return `vpp_qsv=format=${targetFormat}`;
      case 'videotoolbox':
        return `scale_vt=format=${targetFormat}`;
    }
  }

  // Case 2: Hardware decoder only - download and convert
  if (hwDecoder && !hwEncoder) {
    return `hwdownload,format=nv12,format=${targetFormat}`;
  }

  // Case 3: Hardware encoder only - convert and upload
  if (!hwDecoder && hwEncoder) {
    switch (hwType) {
      case 'vaapi':
        return `format=nv12,hwupload`;
      case 'cuda':
        return `format=nv12,hwupload_cuda`;
      case 'qsv':
        return `format=nv12,hwupload=extra_hw_frames=64`;
      case 'videotoolbox':
        return `format=nv12,hwupload`;
    }
  }

  // Case 4: Both software - no filter needed
  return null;
}


/**
 * Remux a file from one container format to another without re-encoding
 *
 * This is a fast operation that just changes the container format.
 * The video and audio streams are copied without modification.
 *
 * @example
 * ```typescript
 * // Convert MP4 to MKV container (keeping same codecs)
 * await remux('input.mp4', 'output.mkv');
 * ```
 */
export async function remux(inputPath: string, outputPath: string): Promise<void> {
  await StreamCopier.remux(inputPath, outputPath);
}

/**
 * Transcode a video file to different codecs/settings
 *
 * Uses node-av internally for efficient end-to-end processing.
 *
 * @example
 * ```typescript
 * // Convert to H.264 with lower bitrate
 * await transcode('input.mp4', 'output.mp4', {
 *   videoCodec: 'h264',
 *   videoBitrate: 1_000_000,
 * });
 *
 * // Convert to VP9 WebM
 * await transcode('input.mp4', 'output.webm', {
 *   videoCodec: 'vp9',
 *   videoBitrate: 2_000_000,
 * });
 * ```
 */
export async function transcode(
  inputPath: string,
  outputPath: string,
  options: TranscodeOptions = {}
): Promise<TranscodeResult> {
  // Check for stream copy mode
  if (options.videoCodec === 'copy' && options.audioCodec === 'copy') {
    await remux(inputPath, outputPath);
    const { stat } = await import('fs/promises');
    const info = await stat(outputPath);
    return { videoFrames: 0, audioFrames: 0, outputSize: info.size };
  }

  // Open input
  const demuxer = await NodeAvDemuxer.open(inputPath);
  const inputVideo = demuxer.video();
  const inputAudio = demuxer.audio();

  if (!inputVideo && !inputAudio) {
    await demuxer.close();
    throw new Error('No video or audio streams in input file');
  }

  // Setup hardware acceleration if requested
  const hardware = tryCreateHardwareContext(options.hardwareAcceleration || 'no-preference');
  let videoFilter: FilterAPI | null = null;
  let usingHardwareDecoder = false;
  let usingHardwareEncoder = false;

  // Create output muxer
  const format = options.format || inferFormat(outputPath);
  const muxer = await NodeAvMuxer.open(outputPath, { format });

  // Setup video pipeline
  let videoDecoder: any = null;
  let videoEncoder: any = null;
  let videoOutStreamIndex = -1;
  let videoFrameCount = 0;
  let videoPacketCount = 0;

  if (inputVideo && options.videoCodec !== 'copy') {
    const cp = inputVideo.codecpar;
    const outputWidth = options.width || cp.width;
    const outputHeight = options.height || cp.height;
    const outputCodecId = getVideoCodecId(options.videoCodec || 'h264');
    const codecName = options.videoCodec || 'h264';

    // Create decoder with hardware acceleration
    const decoderResult = await createVideoDecoder(inputVideo, hardware, codecName);
    videoDecoder = decoderResult.decoder;
    usingHardwareDecoder = decoderResult.isHardware;

    // Create encoder with hardware acceleration
    const encoderResult = await createVideoEncoder(outputCodecId, codecName, hardware, {
      width: outputWidth,
      height: outputHeight,
      framerate: options.framerate || 30,
      bitrate: options.videoBitrate || 1_000_000,
      gopSize: options.gopSize || 30,
    });
    videoEncoder = encoderResult.encoder;
    usingHardwareEncoder = encoderResult.isHardware;

    // Create video filter for format conversion
    videoFilter = createVideoFilter(
      hardware,
      usingHardwareDecoder,
      usingHardwareEncoder,
      encoderResult.pixelFormat
    );

    videoOutStreamIndex = muxer.addStream(videoEncoder);
  } else if (inputVideo && options.videoCodec === 'copy') {
    // Stream copy video
    videoOutStreamIndex = muxer.addStream(inputVideo);
  }

  // Setup audio pipeline
  let audioDecoder: any = null;
  let audioEncoder: any = null;
  let audioOutStreamIndex = -1;
  let audioFrameCount = 0;

  if (inputAudio && options.audioCodec !== 'copy') {
    const audioPipeline = await createAudioPipeline(inputAudio, muxer, options);
    audioDecoder = audioPipeline.decoder;
    audioEncoder = audioPipeline.encoder;
    audioOutStreamIndex = audioPipeline.streamIndex;
  } else if (inputAudio && options.audioCodec === 'copy') {
    // Stream copy audio
    audioOutStreamIndex = muxer.addStream(inputAudio);
  }

  // Helper to drain encoder packets
  async function drainVideoEncoder() {
    if (!videoEncoder) return;
    while (true) {
      try {
        const pkt = await videoEncoder.receive();
        if (pkt) {
          await muxer.writePacket(pkt, videoOutStreamIndex);
          videoPacketCount++;
        } else break;
      } catch {
        break;
      }
    }
  }

  async function drainAudioEncoder() {
    if (!audioEncoder) return;
    while (true) {
      try {
        const pkt = await audioEncoder.receive();
        if (pkt) {
          await muxer.writePacket(pkt, audioOutStreamIndex);
        } else break;
      } catch {
        break;
      }
    }
  }

  // Helper to drain decoder frames and encode
  async function drainVideoDecoder() {
    if (!videoDecoder || !videoEncoder) return;
    while (true) {
      try {
        let frame = await videoDecoder.receive();
        if (!frame) break;

        // Apply video filter if present (handles hw download/upload and format conversion)
        if (videoFilter) {
          try {
            await videoFilter.process(frame);
            frame.free();
            frame = await videoFilter.receive();
            if (!frame) continue;
          } catch (filterErr) {
            // Filter failed, try to continue without it
            logger.warn(`Filter processing failed: ${(filterErr as Error).message}`);
            frame.free();
            continue;
          }
        }

        frame.pts = BigInt(videoFrameCount);
        videoFrameCount++;
        await videoEncoder.encode(frame);
        frame.free();
        await drainVideoEncoder();

        // Report progress
        if (options.onProgress) {
          const duration = demuxer.duration || 0;
          options.onProgress({
            videoFrames: videoFrameCount,
            audioFrames: audioFrameCount,
            progress: duration > 0 ? videoFrameCount / (duration * 30) : undefined,
          });
        }
      } catch {
        break;
      }
    }
  }

  async function drainAudioDecoder() {
    if (!audioDecoder || !audioEncoder) return;
    while (true) {
      try {
        const frame = await audioDecoder.receive();
        if (!frame) break;
        audioFrameCount++;
        await audioEncoder.encode(frame);
        frame.free();
        await drainAudioEncoder();
      } catch {
        break;
      }
    }
  }

  // Process all packets
  let hardwareDecodeFailed = false;
  for await (const packet of demuxer.packets()) {
    if (!packet) continue;

    if (packet.streamIndex === inputVideo?.index) {
      if (videoDecoder && videoEncoder && !hardwareDecodeFailed) {
        // Transcode video
        try {
          await videoDecoder.decode(packet);
          await drainVideoDecoder();
        } catch (decodeErr) {
          // Hardware decoding can fail mid-stream, rethrow with context
          const errMsg = (decodeErr as Error).message;
          if (errMsg.includes('allocate') || errMsg.includes('memory') || errMsg.includes('hardware')) {
            throw new Error(`Hardware decoding failed: ${errMsg}. Try with hardwareAcceleration: 'prefer-software'`);
          }
          throw decodeErr;
        }
      } else if (videoOutStreamIndex >= 0) {
        // Stream copy video
        await muxer.writePacket(packet, videoOutStreamIndex);
        videoPacketCount++;
      }
    } else if (packet.streamIndex === inputAudio?.index) {
      if (audioDecoder && audioEncoder) {
        // Transcode audio
        await audioDecoder.decode(packet);
        await drainAudioDecoder();
      } else if (audioOutStreamIndex >= 0) {
        // Stream copy audio
        await muxer.writePacket(packet, audioOutStreamIndex);
      }
    }
  }

  // Flush decoders and encoders
  if (videoDecoder) {
    await videoDecoder.flush();
    await drainVideoDecoder();
  }
  if (videoEncoder) {
    await videoEncoder.flush();
    await drainVideoEncoder();
  }
  if (audioDecoder) {
    await audioDecoder.flush();
    await drainAudioDecoder();
  }
  if (audioEncoder) {
    await audioEncoder.flush();
    await drainAudioEncoder();
  }

  // Close everything
  if (videoFilter) videoFilter.close();
  if (videoDecoder) await videoDecoder.close();
  if (videoEncoder) await videoEncoder.close();
  if (audioDecoder) await audioDecoder.close();
  if (audioEncoder) await audioEncoder.close();
  if (hardware) hardware.dispose();
  await demuxer.close();
  await muxer.close();

  // Get output file size
  const { stat } = await import('fs/promises');
  const info = await stat(outputPath);

  return {
    videoFrames: videoFrameCount,
    audioFrames: audioFrameCount,
    outputSize: info.size,
  };
}

/**
 * Get media information from a container file
 */
export interface MediaInfo {
  format: string;
  duration: number;
  video?: {
    codec: string;
    width: number;
    height: number;
  };
  audio?: {
    codec: string;
    sampleRate: number;
    channels: number;
  };
}

export async function getMediaInfo(inputPath: string): Promise<MediaInfo> {
  const demuxer = new Demuxer({ path: inputPath });
  await demuxer.open();

  const info: MediaInfo = {
    format: demuxer.format || 'unknown',
    duration: demuxer.duration || 0,
  };

  const videoConfig = demuxer.videoConfig;
  if (videoConfig) {
    info.video = {
      codec: videoConfig.codec,
      width: videoConfig.codedWidth,
      height: videoConfig.codedHeight,
    };
  }

  const audioConfig = demuxer.audioConfig;
  if (audioConfig) {
    info.audio = {
      codec: audioConfig.codec,
      sampleRate: audioConfig.sampleRate,
      channels: audioConfig.numberOfChannels,
    };
  }

  await demuxer.close();
  return info;
}

/**
 * Extract video frames from a container file as VideoFrame objects
 *
 * @example
 * ```typescript
 * import { extractVideoFrames } from 'webcodecs-node/containers';
 *
 * for await (const frame of extractVideoFrames('input.mp4')) {
 *   console.log(`Frame: ${frame.timestamp}us`);
 *   frame.close();
 * }
 * ```
 */
export { extractVideoFrames } from './extract.js';

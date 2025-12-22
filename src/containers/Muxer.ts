/**
 * Container Muxer - Writes encoded chunks to container files (MP4, WebM, MKV)
 *
 * Wraps node-av's Muxer to provide a WebCodecs-compatible interface that accepts
 * EncodedVideoChunk and EncodedAudioChunk objects.
 */

import {
  Muxer as NodeAvMuxer,
  Demuxer as NodeAvDemuxer,
  Encoder as NodeAvEncoder,
  AV_CODEC_ID_H264,
  AV_CODEC_ID_HEVC,
  AV_CODEC_ID_VP8,
  AV_CODEC_ID_VP9,
  AV_CODEC_ID_AV1,
  AV_CODEC_ID_AAC,
  AV_CODEC_ID_OPUS,
  AV_CODEC_ID_MP3,
  AV_CODEC_ID_VORBIS,
  AV_CODEC_ID_FLAC,
  AV_PIX_FMT_YUV420P,
  AV_SAMPLE_FMT_FLTP,
} from 'node-av';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../utils/timeout.js';

/**
 * Video track configuration for muxing
 */
export interface VideoTrackConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  framerate?: number;
  bitrate?: number;
  description?: Uint8Array;
}

/**
 * Audio track configuration for muxing
 */
export interface AudioTrackConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
  description?: Uint8Array;
}

/**
 * Muxer configuration
 */
export interface MuxerConfig {
  /** Path to the output file */
  path: string;
  /** Container format (mp4, webm, mkv) - inferred from extension if not specified */
  format?: string;
}

/**
 * Maps WebCodecs codec strings to FFmpeg codec IDs
 */
function mapVideoCodecId(codec: string): number {
  const codecLower = codec.toLowerCase();
  if (codecLower.startsWith('avc1') || codecLower.startsWith('avc3') || codecLower === 'h264') {
    return AV_CODEC_ID_H264;
  } else if (codecLower.startsWith('hvc1') || codecLower.startsWith('hev1') || codecLower === 'hevc') {
    return AV_CODEC_ID_HEVC;
  } else if (codecLower === 'vp8') {
    return AV_CODEC_ID_VP8;
  } else if (codecLower.startsWith('vp09') || codecLower === 'vp9') {
    return AV_CODEC_ID_VP9;
  } else if (codecLower.startsWith('av01') || codecLower === 'av1') {
    return AV_CODEC_ID_AV1;
  }
  throw new Error(`Unsupported video codec: ${codec}`);
}

function mapAudioCodecId(codec: string): number {
  const codecLower = codec.toLowerCase();
  if (codecLower.startsWith('mp4a') || codecLower === 'aac') {
    return AV_CODEC_ID_AAC;
  } else if (codecLower === 'mp3') {
    return AV_CODEC_ID_MP3;
  } else if (codecLower === 'opus') {
    return AV_CODEC_ID_OPUS;
  } else if (codecLower === 'vorbis') {
    return AV_CODEC_ID_VORBIS;
  } else if (codecLower === 'flac') {
    return AV_CODEC_ID_FLAC;
  }
  throw new Error(`Unsupported audio codec: ${codec}`);
}

/**
 * Infer container format from file extension
 */
function inferFormat(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'mp4';
    case 'webm':
      return 'webm';
    case 'mkv':
      return 'matroska';
    case 'mov':
      return 'mov';
    case 'avi':
      return 'avi';
    case 'ts':
      return 'mpegts';
    default:
      return 'mp4';
  }
}

/**
 * Container muxer that accepts WebCodecs-compatible chunks
 *
 * @example
 * ```typescript
 * const muxer = new Muxer({ path: 'output.mp4' });
 * await muxer.open();
 * await muxer.addVideoTrack({
 *   codec: 'avc1.42001E',
 *   codedWidth: 640,
 *   codedHeight: 480,
 *   framerate: 30,
 *   description: spsNaluBuffer, // Optional: H.264 SPS/PPS
 * });
 *
 * // Write encoded chunks from VideoEncoder
 * encoder.configure({ codec: 'avc1.42001E', ... });
 * encoder.encode(frame);
 * // In output callback:
 * await muxer.writeVideoChunk(chunk);
 *
 * await muxer.close();
 * ```
 */
export class Muxer {
  private muxer: NodeAvMuxer | null = null;
  private config: MuxerConfig;
  private _videoStreamIndex: number = -1;
  private _audioStreamIndex: number = -1;
  private _videoEncoder: NodeAvEncoder | null = null;
  private _audioEncoder: NodeAvEncoder | null = null;
  private _videoConfig: VideoTrackConfig | null = null;
  private _audioConfig: AudioTrackConfig | null = null;
  private _videoChunkCount = 0;
  private _audioChunkCount = 0;

  constructor(config: MuxerConfig) {
    this.config = config;
  }

  /**
   * Open the muxer for writing
   *
   * @param timeout - Operation timeout in milliseconds (default: 15000)
   */
  async open(timeout: number = DEFAULT_TIMEOUTS.open): Promise<void> {
    const format = this.config.format || inferFormat(this.config.path);
    this.muxer = await withTimeout(
      NodeAvMuxer.open(this.config.path, { format }),
      timeout,
      `Muxer open (${this.config.path})`
    );
  }

  /**
   * Add a video track to the output
   *
   * @param config - Video track configuration
   * @returns Stream index for the video track
   */
  async addVideoTrack(config: VideoTrackConfig): Promise<number> {
    if (!this.muxer) {
      throw new Error('Muxer not opened');
    }

    this._videoConfig = config;
    const codecId = mapVideoCodecId(config.codec);

    // Create an encoder to properly configure the output stream
    // The encoder sets up codec parameters that the muxer needs
    // Use microsecond timeBase (1/1000000) to match WebCodecs timestamp units
    this._videoEncoder = await NodeAvEncoder.create(codecId as any, {
      width: config.codedWidth,
      height: config.codedHeight,
      pixelFormat: AV_PIX_FMT_YUV420P,
      timeBase: { num: 1, den: 1_000_000 }, // Microseconds - matches WebCodecs
      frameRate: { num: config.framerate || 30, den: 1 },
      bitrate: config.bitrate || 1_000_000,
      gopSize: 30,
      // Set extradata from description (SPS/PPS for H.264, etc.)
      extradata: config.description ? Buffer.from(config.description) : undefined,
    } as any);

    // Add the encoder's stream to the muxer
    this._videoStreamIndex = this.muxer.addStream(this._videoEncoder);
    return this._videoStreamIndex;
  }

  /**
   * Add an audio track to the output
   *
   * @param config - Audio track configuration
   * @returns Stream index for the audio track
   */
  async addAudioTrack(config: AudioTrackConfig): Promise<number> {
    if (!this.muxer) {
      throw new Error('Muxer not opened');
    }

    this._audioConfig = config;
    const codecId = mapAudioCodecId(config.codec);

    // Create an encoder to properly configure the output stream
    // Use microsecond timeBase (1/1000000) to match WebCodecs timestamp units
    this._audioEncoder = await NodeAvEncoder.create(codecId as any, {
      sampleRate: config.sampleRate,
      channels: config.numberOfChannels,
      sampleFormat: AV_SAMPLE_FMT_FLTP,
      timeBase: { num: 1, den: 1_000_000 }, // Microseconds - matches WebCodecs
      bitrate: config.bitrate || 128_000,
      // Set extradata from description (AudioSpecificConfig for AAC, etc.)
      extradata: config.description ? Buffer.from(config.description) : undefined,
    } as any);

    // Add the encoder's stream to the muxer
    this._audioStreamIndex = this.muxer.addStream(this._audioEncoder);
    return this._audioStreamIndex;
  }

  /**
   * Write an encoded video chunk to the output container
   *
   * @param chunk - EncodedVideoChunk from VideoEncoder
   */
  async writeVideoChunk(chunk: EncodedVideoChunk): Promise<void> {
    if (!this.muxer || this._videoStreamIndex < 0) {
      throw new Error('Video track not configured. Call addVideoTrack() first.');
    }

    // Create a packet from the chunk data
    const packetData = {
      data: Buffer.from(chunk._buffer),
      pts: BigInt(Math.round(chunk.timestamp)), // microseconds
      dts: BigInt(Math.round(chunk.timestamp)),
      duration: chunk.duration ? BigInt(Math.round(chunk.duration)) : undefined,
      isKeyframe: chunk.type === 'key',
    };

    await this.muxer.writePacket(packetData as any, this._videoStreamIndex);
    this._videoChunkCount++;
  }

  /**
   * Write an encoded audio chunk to the output container
   *
   * @param chunk - EncodedAudioChunk from AudioEncoder
   */
  async writeAudioChunk(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.muxer || this._audioStreamIndex < 0) {
      throw new Error('Audio track not configured. Call addAudioTrack() first.');
    }

    // Create a packet from the chunk data
    const packetData = {
      data: Buffer.from(chunk._rawData),
      pts: BigInt(Math.round(chunk.timestamp)), // microseconds
      dts: BigInt(Math.round(chunk.timestamp)),
      duration: chunk.duration ? BigInt(Math.round(chunk.duration)) : undefined,
      isKeyframe: chunk.type === 'key',
    };

    await this.muxer.writePacket(packetData as any, this._audioStreamIndex);
    this._audioChunkCount++;
  }

  /**
   * Finalize and close the muxer
   *
   * @param timeout - Operation timeout in milliseconds (default: 10000)
   */
  async close(timeout: number = DEFAULT_TIMEOUTS.close): Promise<void> {
    // Close encoders (sync)
    if (this._videoEncoder) {
      this._videoEncoder.close();
      this._videoEncoder = null;
    }
    if (this._audioEncoder) {
      this._audioEncoder.close();
      this._audioEncoder = null;
    }

    // Close muxer (async with timeout)
    if (this.muxer) {
      await withTimeout(
        this.muxer.close(),
        timeout,
        'Muxer close'
      );
      this.muxer = null;
    }
  }

  /**
   * Get the underlying node-av muxer (for advanced use)
   */
  get native(): NodeAvMuxer | null {
    return this.muxer;
  }

  /**
   * Get number of video chunks written
   */
  get videoChunkCount(): number {
    return this._videoChunkCount;
  }

  /**
   * Get number of audio chunks written
   */
  get audioChunkCount(): number {
    return this._audioChunkCount;
  }
}

/**
 * Helper class for stream copy (remux) operations
 * This copies encoded data from one container to another without re-encoding
 */
export class StreamCopier {
  private srcDemuxer: NodeAvDemuxer | null = null;
  private dstMuxer: NodeAvMuxer | null = null;

  /**
   * Remux a file from one container format to another
   * This performs a stream copy without re-encoding
   */
  static async remux(
    inputPath: string,
    outputPath: string,
    options?: { format?: string }
  ): Promise<void> {
    const demuxer = await NodeAvDemuxer.open(inputPath);
    const format = options?.format || inferFormat(outputPath);
    const muxer = await NodeAvMuxer.open(outputPath, { format });

    const streamMap = new Map<number, number>();

    // Copy video stream
    const videoStream = demuxer.video();
    if (videoStream) {
      const outIndex = muxer.addStream(videoStream);
      streamMap.set(videoStream.index, outIndex);
    }

    // Copy audio stream
    const audioStream = demuxer.audio();
    if (audioStream) {
      const outIndex = muxer.addStream(audioStream);
      streamMap.set(audioStream.index, outIndex);
    }

    // Copy packets
    for await (const packet of demuxer.packets()) {
      if (!packet) continue;
      const outIndex = streamMap.get(packet.streamIndex);
      if (outIndex !== undefined) {
        await muxer.writePacket(packet, outIndex);
      }
    }

    await demuxer.close();
    await muxer.close();
  }
}

/**
 * Node-av Muxer - Fast muxer using node-av's FormatContext API
 *
 * Uses node-av's low-level FormatContext API to provide a WebCodecs-compatible interface
 * that accepts EncodedVideoChunk and EncodedAudioChunk objects. This is the fast path
 * (~5ms muxing time) used by the main Muxer class.
 */

import {
  FormatContext,
  Packet,
  Rational,
  Demuxer as NodeAvDemuxerInternal,
  Muxer as NodeAvMuxerInternal,
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
  AVMEDIA_TYPE_VIDEO,
  AVMEDIA_TYPE_AUDIO,
} from 'node-av';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../utils/timeout.js';
import { Logger } from '../utils/logger.js';
import type {
  IMuxer,
  MuxerConfig,
  VideoTrackConfig,
  AudioTrackConfig,
} from './muxer-types.js';
import { inferFormat } from './muxer-types.js';

// Re-export types from muxer-types for backwards compatibility
export type { MuxerConfig, VideoTrackConfig, AudioTrackConfig } from './muxer-types.js';

const logger = new Logger('NodeAvMuxer');

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
 * Node-av based muxer that accepts WebCodecs-compatible chunks
 *
 * Uses node-av's low-level FormatContext API for direct packet writing.
 * This is the fast implementation (~5ms) used internally by the main Muxer class.
 *
 * @example
 * ```typescript
 * const muxer = new NodeAvMuxer({ path: 'output.mp4' });
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
 * await muxer.writeVideoChunk(chunk);
 *
 * await muxer.close();
 * ```
 */
export class NodeAvMuxer implements IMuxer {
  private formatContext: FormatContext | null = null;
  private config: MuxerConfig;
  private _videoStreamIndex: number = -1;
  private _audioStreamIndex: number = -1;
  private _videoConfig: VideoTrackConfig | null = null;
  private _audioConfig: AudioTrackConfig | null = null;
  private _videoChunkCount = 0;
  private _audioChunkCount = 0;
  private _headerWritten = false;

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

    // Create and configure FormatContext
    this.formatContext = new FormatContext();
    this.formatContext.allocOutputContext2(null, format, this.config.path);

    // Open output file
    await withTimeout(
      (this.formatContext as any).openOutput(this.config.path),
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
    if (!this.formatContext) {
      throw new Error('Muxer not opened');
    }

    this._videoConfig = config;
    const codecId = mapVideoCodecId(config.codec);

    // Create a new stream
    const stream = this.formatContext.newStream(null);
    this._videoStreamIndex = stream.index;

    // Set codec parameters on the stream
    const cp = stream.codecpar;
    (cp as any).codecType = AVMEDIA_TYPE_VIDEO;
    (cp as any).codecId = codecId;
    cp.width = config.codedWidth;
    cp.height = config.codedHeight;
    cp.bitRate = BigInt(config.bitrate || 1_000_000);
    (cp as any).format = 0; // YUV420P

    // Set extradata if description is provided (SPS/PPS for H.264, etc.)
    if (config.description && config.description.length > 0) {
      cp.extradata = Buffer.from(config.description);
    }

    // Set stream time base to microseconds (WebCodecs uses microseconds)
    stream.timeBase = new Rational(1, 1_000_000);

    return this._videoStreamIndex;
  }

  /**
   * Add an audio track to the output
   *
   * @param config - Audio track configuration
   * @returns Stream index for the audio track
   */
  async addAudioTrack(config: AudioTrackConfig): Promise<number> {
    if (!this.formatContext) {
      throw new Error('Muxer not opened');
    }

    this._audioConfig = config;
    const codecId = mapAudioCodecId(config.codec);

    // Create a new stream
    const stream = this.formatContext.newStream(null);
    this._audioStreamIndex = stream.index;

    // Set codec parameters on the stream
    const cp = stream.codecpar;
    (cp as any).codecType = AVMEDIA_TYPE_AUDIO;
    (cp as any).codecId = codecId;
    cp.sampleRate = config.sampleRate;
    cp.channels = config.numberOfChannels;
    cp.bitRate = BigInt(config.bitrate || 128_000);

    // Set extradata if description is provided (AudioSpecificConfig for AAC, etc.)
    if (config.description && config.description.length > 0) {
      cp.extradata = Buffer.from(config.description);
    }

    // Set stream time base to microseconds (WebCodecs uses microseconds)
    stream.timeBase = new Rational(1, 1_000_000);

    return this._audioStreamIndex;
  }

  /**
   * Write header if not already written
   */
  private writeHeaderIfNeeded(): void {
    if (!this._headerWritten && this.formatContext) {
      const ret = this.formatContext.writeHeaderSync();
      if (ret < 0) {
        throw new Error(`Failed to write header: ${ret}`);
      }
      this._headerWritten = true;
    }
  }

  /**
   * Write an encoded video chunk to the output container
   *
   * @param chunk - EncodedVideoChunk from VideoEncoder
   */
  async writeVideoChunk(chunk: EncodedVideoChunk): Promise<void> {
    if (!this.formatContext || this._videoStreamIndex < 0) {
      throw new Error('Video track not configured. Call addVideoTrack() first.');
    }

    // Write header on first chunk
    this.writeHeaderIfNeeded();

    // Get the output stream's actual time base (may differ from what we set)
    const stream = this.formatContext.streams[this._videoStreamIndex];
    const streamTimeBase = stream.timeBase;

    // Create a proper node-av Packet from the chunk data
    const packet = new Packet();
    packet.alloc();
    packet.data = Buffer.from(chunk._buffer);

    // Convert timestamps from microseconds to stream timebase
    const usToStreamTs = (us: number) => {
      // ts_out = ts_in * (timebase_in / timebase_out)
      // ts_out = us * (1/1000000) / (streamTimeBase.num / streamTimeBase.den)
      // ts_out = us * streamTimeBase.den / (1000000 * streamTimeBase.num)
      return BigInt(Math.round(us * streamTimeBase.den / (1_000_000 * streamTimeBase.num)));
    };

    packet.pts = usToStreamTs(chunk.timestamp);
    packet.dts = usToStreamTs(chunk.timestamp);
    if (chunk.duration) {
      packet.duration = usToStreamTs(chunk.duration);
    }
    packet.streamIndex = this._videoStreamIndex;
    packet.isKeyframe = chunk.type === 'key';
    packet.timeBase = streamTimeBase;

    const ret = (this.formatContext as any).interleavedWriteFrameSync(packet);
    packet.free();

    if (ret < 0) {
      throw new Error(`Failed to write video packet: ${ret}`);
    }

    this._videoChunkCount++;
  }

  /**
   * Write an encoded audio chunk to the output container
   *
   * @param chunk - EncodedAudioChunk from AudioEncoder
   */
  async writeAudioChunk(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.formatContext || this._audioStreamIndex < 0 || !this._audioConfig) {
      throw new Error('Audio track not configured. Call addAudioTrack() first.');
    }

    // Write header on first chunk
    this.writeHeaderIfNeeded();

    // Get the output stream's actual time base (may differ from what we set)
    const stream = this.formatContext.streams[this._audioStreamIndex];
    const streamTimeBase = stream.timeBase;

    // Create a proper node-av Packet from the chunk data
    const packet = new Packet();
    packet.alloc();
    packet.data = Buffer.from(chunk._rawData);

    // Convert timestamps from microseconds to stream timebase
    // For audio, the stream timebase is typically 1/sampleRate
    const usToStreamTs = (us: number) => {
      // ts_out = ts_in * (timebase_in / timebase_out)
      // ts_out = us * (1/1000000) / (streamTimeBase.num / streamTimeBase.den)
      // ts_out = us * streamTimeBase.den / (1000000 * streamTimeBase.num)
      return BigInt(Math.round(us * streamTimeBase.den / (1_000_000 * streamTimeBase.num)));
    };

    packet.pts = usToStreamTs(chunk.timestamp);
    packet.dts = usToStreamTs(chunk.timestamp);
    if (chunk.duration) {
      packet.duration = usToStreamTs(chunk.duration);
    }
    packet.streamIndex = this._audioStreamIndex;
    packet.isKeyframe = chunk.type === 'key';
    packet.timeBase = streamTimeBase;

    const ret = (this.formatContext as any).interleavedWriteFrameSync(packet);
    packet.free();

    if (ret < 0) {
      throw new Error(`Failed to write audio packet: ${ret}`);
    }

    this._audioChunkCount++;
  }

  /**
   * Finalize and close the muxer
   *
   * @param timeout - Operation timeout in milliseconds (default: 10000)
   */
  async close(timeout: number = DEFAULT_TIMEOUTS.close): Promise<void> {
    if (this.formatContext) {
      // Write trailer
      if (this._headerWritten) {
        const ret = this.formatContext.writeTrailerSync();
        if (ret < 0) {
          logger.warn(`writeTrailer returned error code ${ret}`);
        }
      }

      // Close output and free context
      await withTimeout(
        this.formatContext.closeOutput(),
        timeout,
        'Muxer close output'
      );
      this.formatContext.freeContext();
      this.formatContext = null;
    }
  }

  /**
   * Get the underlying FormatContext (for advanced use)
   */
  get native(): FormatContext | null {
    return this.formatContext;
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
  private srcDemuxer: NodeAvDemuxerInternal | null = null;
  private dstMuxer: NodeAvMuxerInternal | null = null;

  /**
   * Remux a file from one container format to another
   * This performs a stream copy without re-encoding
   */
  static async remux(
    inputPath: string,
    outputPath: string,
    options?: { format?: string }
  ): Promise<void> {
    const demuxer = await NodeAvDemuxerInternal.open(inputPath);
    const format = options?.format || inferFormat(outputPath);
    const muxer = await NodeAvMuxerInternal.open(outputPath, { format });

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

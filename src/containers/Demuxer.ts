/**
 * Container Demuxer - Extracts encoded chunks from container files (MP4, WebM, MKV)
 *
 * Wraps node-av's Demuxer to provide a WebCodecs-compatible interface that outputs
 * EncodedVideoChunk and EncodedAudioChunk objects.
 */

import { Demuxer as NodeAvDemuxer } from 'node-av';
import { EncodedVideoChunk, type EncodedVideoChunkType } from '../core/EncodedVideoChunk.js';
import { EncodedAudioChunk, type EncodedAudioChunkType } from '../core/EncodedAudioChunk.js';
import { withTimeout, DEFAULT_TIMEOUTS } from '../utils/timeout.js';

/**
 * Video stream configuration extracted from container
 */
export interface VideoStreamConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: Uint8Array;
}

/**
 * Audio stream configuration extracted from container
 */
export interface AudioStreamConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: Uint8Array;
}

/**
 * Demuxer configuration
 */
export interface DemuxerConfig {
  /** Path to the input file */
  path: string;
}

/**
 * Callback types for demuxed chunks
 */
export type VideoChunkCallback = (chunk: EncodedVideoChunk, config: VideoStreamConfig) => void;
export type AudioChunkCallback = (chunk: EncodedAudioChunk, config: AudioStreamConfig) => void;

/**
 * Maps FFmpeg codec IDs to WebCodecs codec strings
 */
function mapVideoCodecId(codecId: number, extradata?: Buffer | null): string {
  // Common FFmpeg codec IDs
  switch (codecId) {
    case 27: // AV_CODEC_ID_H264
      // Try to extract profile/level from extradata
      if (extradata && extradata.length >= 4) {
        const profile = extradata[1];
        const constraints = extradata[2];
        const level = extradata[3];
        return `avc1.${profile.toString(16).padStart(2, '0')}${constraints.toString(16).padStart(2, '0')}${level.toString(16).padStart(2, '0')}`;
      }
      return 'avc1.42001E'; // Baseline level 3.0 default
    case 173: // AV_CODEC_ID_HEVC
      return 'hvc1.1.6.L93.B0';
    case 225: // AV_CODEC_ID_VP8
      return 'vp8';
    case 167: // AV_CODEC_ID_VP9
      return 'vp09.00.10.08';
    case 226: // AV_CODEC_ID_AV1
      return 'av01.0.01M.08';
    default:
      return `unknown-${codecId}`;
  }
}

function mapAudioCodecId(codecId: number): string {
  switch (codecId) {
    case 86018: // AV_CODEC_ID_AAC
      return 'mp4a.40.2';
    case 86017: // AV_CODEC_ID_MP3
      return 'mp3';
    case 86076: // AV_CODEC_ID_OPUS
      return 'opus';
    case 86028: // AV_CODEC_ID_VORBIS
      return 'vorbis';
    case 86030: // AV_CODEC_ID_FLAC
      return 'flac';
    default:
      return `unknown-${codecId}`;
  }
}

/**
 * Container demuxer that outputs WebCodecs-compatible chunks
 */
export class Demuxer {
  private demuxer: NodeAvDemuxer | null = null;
  private path: string;
  private _videoConfig: VideoStreamConfig | null = null;
  private _audioConfig: AudioStreamConfig | null = null;
  private _videoStreamIndex: number = -1;
  private _audioStreamIndex: number = -1;
  private _videoTimeBase: { num: number; den: number } | null = null;
  private _audioTimeBase: { num: number; den: number } | null = null;
  // Pre-calculated multipliers for timestamp conversion (avoids division per packet)
  private _videoTimeMultiplier: number = 0;
  private _audioTimeMultiplier: number = 0;

  constructor(config: DemuxerConfig) {
    this.path = config.path;
  }

  /**
   * Open the container file and parse stream information
   */
  async open(timeout: number = DEFAULT_TIMEOUTS.open): Promise<void> {
    this.demuxer = await withTimeout(
      NodeAvDemuxer.open(this.path),
      timeout,
      `Demuxer open (${this.path})`
    );

    // Extract video stream info
    const videoStream = this.demuxer.video();
    if (videoStream) {
      this._videoStreamIndex = videoStream.index;
      this._videoTimeBase = {
        num: videoStream.timeBase.num,
        den: videoStream.timeBase.den,
      };
      // Pre-calculate multiplier: (num * 1_000_000) / den
      this._videoTimeMultiplier = (videoStream.timeBase.num * 1_000_000) / videoStream.timeBase.den;

      const cp = videoStream.codecpar;
      this._videoConfig = {
        codec: mapVideoCodecId(cp.codecId, cp.extradata),
        codedWidth: cp.width,
        codedHeight: cp.height,
        description: cp.extradata ? new Uint8Array(cp.extradata) : undefined,
      };
    }

    // Extract audio stream info
    const audioStream = this.demuxer.audio();
    if (audioStream) {
      this._audioStreamIndex = audioStream.index;
      this._audioTimeBase = {
        num: audioStream.timeBase.num,
        den: audioStream.timeBase.den,
      };
      // Pre-calculate multiplier: (num * 1_000_000) / den
      this._audioTimeMultiplier = (audioStream.timeBase.num * 1_000_000) / audioStream.timeBase.den;

      const cp = audioStream.codecpar;
      this._audioConfig = {
        codec: mapAudioCodecId(cp.codecId),
        sampleRate: cp.sampleRate,
        numberOfChannels: cp.channels,
        description: cp.extradata ? new Uint8Array(cp.extradata) : undefined,
      };
    }
  }

  /**
   * Get video stream configuration (null if no video stream)
   */
  get videoConfig(): VideoStreamConfig | null {
    return this._videoConfig;
  }

  /**
   * Get audio stream configuration (null if no audio stream)
   */
  get audioConfig(): AudioStreamConfig | null {
    return this._audioConfig;
  }

  /**
   * Get container format name (e.g., "mp4", "webm")
   */
  get format(): string | undefined {
    return this.demuxer?.formatName;
  }

  /**
   * Get duration in seconds
   */
  get duration(): number | undefined {
    return this.demuxer?.duration;
  }

  /**
   * Convert timestamp from stream time base to microseconds using pre-calculated multiplier
   */
  private toMicroseconds(pts: bigint | number, multiplier: number): number {
    const ptsNum = typeof pts === 'bigint' ? Number(pts) : pts;
    return Math.round(ptsNum * multiplier);
  }

  /**
   * Iterate over video chunks
   */
  async *videoChunks(): AsyncGenerator<EncodedVideoChunk> {
    if (!this.demuxer || this._videoStreamIndex < 0 || !this._videoConfig || !this._videoTimeMultiplier) {
      return;
    }

    for await (const packet of this.demuxer.packets()) {
      if (!packet || !packet.data) continue;
      if (packet.streamIndex === this._videoStreamIndex) {
        const timestamp = this.toMicroseconds(packet.pts, this._videoTimeMultiplier);
        const duration = packet.duration
          ? this.toMicroseconds(packet.duration, this._videoTimeMultiplier)
          : undefined;

        const chunk = new EncodedVideoChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          timestamp,
          duration,
          data: packet.data.slice(),
        });

        yield chunk;
      }
    }
  }

  /**
   * Iterate over audio chunks
   */
  async *audioChunks(): AsyncGenerator<EncodedAudioChunk> {
    if (!this.demuxer || this._audioStreamIndex < 0 || !this._audioConfig || !this._audioTimeMultiplier) {
      return;
    }

    for await (const packet of this.demuxer.packets()) {
      if (!packet || !packet.data) continue;
      if (packet.streamIndex === this._audioStreamIndex) {
        const timestamp = this.toMicroseconds(packet.pts, this._audioTimeMultiplier);
        const duration = packet.duration
          ? this.toMicroseconds(packet.duration, this._audioTimeMultiplier)
          : undefined;

        const chunk = new EncodedAudioChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          timestamp,
          duration,
          data: packet.data.slice(),
        });

        yield chunk;
      }
    }
  }

  /**
   * Iterate over all chunks (video and audio interleaved)
   * Returns both the chunk and its type/config for proper routing
   */
  async *chunks(): AsyncGenerator<
    | { type: 'video'; chunk: EncodedVideoChunk; config: VideoStreamConfig }
    | { type: 'audio'; chunk: EncodedAudioChunk; config: AudioStreamConfig }
  > {
    if (!this.demuxer) {
      return;
    }

    for await (const packet of this.demuxer.packets()) {
      if (!packet || !packet.data) continue;
      if (packet.streamIndex === this._videoStreamIndex && this._videoConfig && this._videoTimeMultiplier) {
        const timestamp = this.toMicroseconds(packet.pts, this._videoTimeMultiplier);
        const duration = packet.duration
          ? this.toMicroseconds(packet.duration, this._videoTimeMultiplier)
          : undefined;

        const chunk = new EncodedVideoChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          timestamp,
          duration,
          data: packet.data.slice(),
        });

        yield { type: 'video', chunk, config: this._videoConfig };
      } else if (packet.streamIndex === this._audioStreamIndex && this._audioConfig && this._audioTimeMultiplier) {
        const timestamp = this.toMicroseconds(packet.pts, this._audioTimeMultiplier);
        const duration = packet.duration
          ? this.toMicroseconds(packet.duration, this._audioTimeMultiplier)
          : undefined;

        const chunk = new EncodedAudioChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          timestamp,
          duration,
          data: packet.data.slice(),
        });

        yield { type: 'audio', chunk, config: this._audioConfig };
      }
    }
  }

  /**
   * Demux all chunks with callbacks (alternative API)
   */
  async demux(options: {
    onVideoChunk?: VideoChunkCallback;
    onAudioChunk?: AudioChunkCallback;
  }): Promise<void> {
    for await (const item of this.chunks()) {
      if (item.type === 'video' && options.onVideoChunk) {
        options.onVideoChunk(item.chunk, item.config);
      } else if (item.type === 'audio' && options.onAudioChunk) {
        options.onAudioChunk(item.chunk, item.config);
      }
    }
  }

  /**
   * Close the demuxer and release resources
   */
  async close(): Promise<void> {
    if (this.demuxer) {
      await this.demuxer.close();
      this.demuxer = null;
    }
  }

  /**
   * Get the underlying node-av demuxer (for advanced use)
   */
  get native(): NodeAvDemuxer | null {
    return this.demuxer;
  }
}

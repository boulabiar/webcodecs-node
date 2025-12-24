/**
 * Muxer - Primary muxer with automatic fallback
 *
 * This muxer attempts to use the fast node-av muxer first, and automatically
 * falls back to FFmpeg spawn if it fails. This provides the best of both worlds:
 * fast muxing when possible, with reliable fallback for edge cases.
 */

import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import type {
  IMuxer,
  MuxerConfig,
  VideoTrackConfig,
  AudioTrackConfig,
  MuxResult,
} from './muxer-types.js';
import { MuxerError } from './muxer-types.js';
import { NodeAvMuxer } from './NodeAvMuxer.js';
import { FFmpegMuxer } from './FFmpegMuxer.js';

/**
 * Options for Muxer
 */
export interface MuxerOptions extends MuxerConfig {
  /**
   * Callback when fallback is triggered
   * Useful for logging or metrics
   */
  onFallback?: (error: Error) => void;

  /**
   * Force using a specific backend (skip fallback logic)
   */
  forceBackend?: 'node-av' | 'ffmpeg-spawn';
}

/**
 * Muxer that tries node-av first, then falls back to FFmpeg spawn
 *
 * This implementation buffers all chunks and only performs the actual
 * muxing when close() is called. This allows seamless fallback if the
 * primary muxer fails at any point.
 *
 * @example
 * ```typescript
 * const muxer = new Muxer({
 *   path: 'output.mp4',
 *   onFallback: (err) => console.warn('Using FFmpeg fallback:', err.message),
 * });
 *
 * await muxer.open();
 * await muxer.addVideoTrack({ codec: 'avc1.64001E', ... });
 * await muxer.addAudioTrack({ codec: 'mp4a.40.2', ... });
 *
 * for (const chunk of videoChunks) await muxer.writeVideoChunk(chunk);
 * for (const chunk of audioChunks) await muxer.writeAudioChunk(chunk);
 *
 * const result = await muxer.closeWithResult();
 * console.log(`Muxed with ${result.backend} in ${result.durationMs}ms`);
 * ```
 */
export class Muxer implements IMuxer {
  private config: MuxerOptions;
  private videoConfig: VideoTrackConfig | null = null;
  private audioConfig: AudioTrackConfig | null = null;
  private videoChunks: EncodedVideoChunk[] = [];
  private audioChunks: EncodedAudioChunk[] = [];
  private _videoChunkCount = 0;
  private _audioChunkCount = 0;
  private isOpen = false;
  private usedBackend: 'node-av' | 'ffmpeg-spawn' | null = null;

  constructor(config: MuxerOptions) {
    this.config = config;
  }

  async open(timeout?: number): Promise<void> {
    this.isOpen = true;
    // We don't actually open anything yet - we buffer chunks
    // and open the muxer during close()
  }

  async addVideoTrack(config: VideoTrackConfig): Promise<number> {
    if (!this.isOpen) {
      throw new MuxerError('Muxer not opened', 'node-av', 'addTrack');
    }
    this.videoConfig = config;
    return 0;
  }

  async addAudioTrack(config: AudioTrackConfig): Promise<number> {
    if (!this.isOpen) {
      throw new MuxerError('Muxer not opened', 'node-av', 'addTrack');
    }
    this.audioConfig = config;
    return this.videoConfig ? 1 : 0;
  }

  async writeVideoChunk(chunk: EncodedVideoChunk): Promise<void> {
    if (!this.isOpen || !this.videoConfig) {
      throw new MuxerError('Video track not configured', 'node-av', 'write');
    }
    this.videoChunks.push(chunk);
    this._videoChunkCount++;
  }

  async writeAudioChunk(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.isOpen || !this.audioConfig) {
      throw new MuxerError('Audio track not configured', 'node-av', 'write');
    }
    this.audioChunks.push(chunk);
    this._audioChunkCount++;
  }

  /**
   * Close the muxer and finalize the output file
   */
  async close(timeout?: number): Promise<void> {
    await this.closeWithResult(timeout);
  }

  /**
   * Close the muxer and return detailed result including which backend was used
   */
  async closeWithResult(timeout?: number): Promise<MuxResult> {
    if (!this.isOpen) {
      return {
        path: this.config.path,
        videoChunkCount: 0,
        audioChunkCount: 0,
        durationMs: 0,
        backend: 'node-av',
      };
    }

    const startTime = Date.now();

    // If force backend is specified, use only that
    if (this.config.forceBackend === 'ffmpeg-spawn') {
      await this.muxWithFFmpeg();
      this.usedBackend = 'ffmpeg-spawn';
    } else if (this.config.forceBackend === 'node-av') {
      await this.muxWithNodeAv(timeout);
      this.usedBackend = 'node-av';
    } else {
      // Try node-av first, fallback to FFmpeg
      try {
        await this.muxWithNodeAv(timeout);
        this.usedBackend = 'node-av';
      } catch (error) {
        // Notify about fallback
        if (this.config.onFallback) {
          this.config.onFallback(error as Error);
        }

        // Fall back to FFmpeg
        await this.muxWithFFmpeg();
        this.usedBackend = 'ffmpeg-spawn';
      }
    }

    this.isOpen = false;
    const durationMs = Date.now() - startTime;

    return {
      path: this.config.path,
      videoChunkCount: this._videoChunkCount,
      audioChunkCount: this._audioChunkCount,
      durationMs,
      backend: this.usedBackend,
    };
  }

  private async muxWithNodeAv(timeout?: number): Promise<void> {
    const muxer = new NodeAvMuxer({
      path: this.config.path,
      format: this.config.format,
    });

    try {
      await muxer.open(timeout);

      if (this.videoConfig) {
        await muxer.addVideoTrack(this.videoConfig);
      }
      if (this.audioConfig) {
        await muxer.addAudioTrack(this.audioConfig);
      }

      // Write all buffered chunks
      for (const chunk of this.videoChunks) {
        await muxer.writeVideoChunk(chunk);
      }
      for (const chunk of this.audioChunks) {
        await muxer.writeAudioChunk(chunk);
      }

      await muxer.close(timeout);
    } catch (error) {
      // Try to clean up partial file
      try {
        await muxer.close(1000);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  private async muxWithFFmpeg(): Promise<void> {
    const muxer = new FFmpegMuxer({
      path: this.config.path,
      format: this.config.format,
    });

    await muxer.open();

    if (this.videoConfig) {
      await muxer.addVideoTrack(this.videoConfig);
    }
    if (this.audioConfig) {
      await muxer.addAudioTrack(this.audioConfig);
    }

    // Write all buffered chunks
    for (const chunk of this.videoChunks) {
      await muxer.writeVideoChunk(chunk);
    }
    for (const chunk of this.audioChunks) {
      await muxer.writeAudioChunk(chunk);
    }

    await muxer.close();
  }

  get videoChunkCount(): number {
    return this._videoChunkCount;
  }

  get audioChunkCount(): number {
    return this._audioChunkCount;
  }

  /**
   * Get which backend was used for muxing (available after close)
   */
  get backend(): 'node-av' | 'ffmpeg-spawn' | null {
    return this.usedBackend;
  }
}

/**
 * Convenience function to mux video and audio chunks to a file
 *
 * @example
 * ```typescript
 * const result = await muxChunks({
 *   path: 'output.mp4',
 *   video: { config: videoTrackConfig, chunks: videoChunks },
 *   audio: { config: audioTrackConfig, chunks: audioChunks },
 * });
 * console.log(`Created ${result.path} using ${result.backend}`);
 * ```
 */
export async function muxChunks(options: {
  path: string;
  format?: string;
  video?: {
    config: VideoTrackConfig;
    chunks: EncodedVideoChunk[];
  };
  audio?: {
    config: AudioTrackConfig;
    chunks: EncodedAudioChunk[];
  };
  onFallback?: (error: Error) => void;
  forceBackend?: 'node-av' | 'ffmpeg-spawn';
}): Promise<MuxResult> {
  const muxer = new Muxer({
    path: options.path,
    format: options.format,
    onFallback: options.onFallback,
    forceBackend: options.forceBackend,
  });

  await muxer.open();

  if (options.video) {
    await muxer.addVideoTrack(options.video.config);
    for (const chunk of options.video.chunks) {
      await muxer.writeVideoChunk(chunk);
    }
  }

  if (options.audio) {
    await muxer.addAudioTrack(options.audio.config);
    for (const chunk of options.audio.chunks) {
      await muxer.writeAudioChunk(chunk);
    }
  }

  return muxer.closeWithResult();
}

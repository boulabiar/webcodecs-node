/**
 * Shared types and interfaces for muxers
 *
 * This module defines common interfaces that both NodeAvMuxer and FFmpegSpawnMuxer
 * implement, enabling a clean fallback mechanism.
 */

import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';

/**
 * Video track configuration for muxing
 */
export interface VideoTrackConfig {
  /** WebCodecs codec string (e.g., 'avc1.64001E', 'hvc1.1.6.L93.B0') */
  codec: string;
  /** Video width in pixels */
  codedWidth: number;
  /** Video height in pixels */
  codedHeight: number;
  /** Frame rate (optional, used for timing) */
  framerate?: number;
  /** Target bitrate in bits/second (optional, for container hints) */
  bitrate?: number;
  /** Codec-specific description (SPS/PPS for H.264, etc.) */
  description?: Uint8Array;
}

/**
 * Audio track configuration for muxing
 */
export interface AudioTrackConfig {
  /** WebCodecs codec string (e.g., 'mp4a.40.2', 'opus') */
  codec: string;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of audio channels */
  numberOfChannels: number;
  /** Target bitrate in bits/second (optional) */
  bitrate?: number;
  /** Codec-specific description (AudioSpecificConfig for AAC, etc.) */
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
 * Result of a muxing operation
 */
export interface MuxResult {
  /** Path to the output file */
  path: string;
  /** Number of video chunks written */
  videoChunkCount: number;
  /** Number of audio chunks written */
  audioChunkCount: number;
  /** Time taken for muxing in milliseconds */
  durationMs: number;
  /** Which muxer backend was used */
  backend: 'node-av' | 'ffmpeg-spawn';
}

/**
 * Common interface for all muxer implementations
 */
export interface IMuxer {
  /**
   * Open the muxer for writing
   */
  open(timeout?: number): Promise<void>;

  /**
   * Add a video track to the output
   * @returns Stream index for the video track
   */
  addVideoTrack(config: VideoTrackConfig): Promise<number>;

  /**
   * Add an audio track to the output
   * @returns Stream index for the audio track
   */
  addAudioTrack(config: AudioTrackConfig): Promise<number>;

  /**
   * Write an encoded video chunk
   */
  writeVideoChunk(chunk: EncodedVideoChunk): Promise<void>;

  /**
   * Write an encoded audio chunk
   */
  writeAudioChunk(chunk: EncodedAudioChunk): Promise<void>;

  /**
   * Finalize and close the muxer
   */
  close(timeout?: number): Promise<void>;

  /**
   * Get number of video chunks written
   */
  readonly videoChunkCount: number;

  /**
   * Get number of audio chunks written
   */
  readonly audioChunkCount: number;
}

/**
 * Muxer error with additional context
 */
export class MuxerError extends Error {
  constructor(
    message: string,
    public readonly backend: 'node-av' | 'ffmpeg-spawn',
    public readonly operation: 'open' | 'addTrack' | 'write' | 'close',
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'MuxerError';
  }
}

/**
 * Infer container format from file extension
 */
export function inferFormat(path: string): string {
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

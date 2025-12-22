/**
 * Backend interfaces for video/audio encoders and decoders.
 *
 * These interfaces define the contract that backend implementations
 * (node-av) must follow.
 */

import { EventEmitter } from 'events';
import type { AudioSampleFormat } from '../formats/audio-formats.js';

/**
 * Encoded frame data emitted by encoders
 */
export interface EncodedFrame {
  data: Buffer;
  timestamp: number;
  keyFrame: boolean;
  /** Optional codec description (e.g., HVCC for HEVC, AVC config for H.264) */
  description?: Buffer;
}

/**
 * Decoded frame data emitted by decoders
 */
export interface DecodedFrame {
  data: Buffer;
  width: number;
  height: number;
  timestamp: number;
  format: string;
}

/**
 * Video encoder configuration
 */
export interface VideoEncoderBackendConfig {
  codec: string;
  width: number;
  height: number;
  inputPixelFormat?: string;
  framerate?: number;
  bitrate?: number;
  bitrateMode?: 'constant' | 'variable' | 'quantizer';
  latencyMode?: 'quality' | 'realtime';
  alpha?: 'discard' | 'keep';
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  /** Output format: 'annexb' for raw Annex B, 'mp4' for length-prefixed (AVCC/HVCC) */
  format?: 'annexb' | 'mp4';
}

/**
 * Video decoder configuration
 */
export interface VideoDecoderBackendConfig {
  codec: string;
  width: number;
  height: number;
  description?: Buffer | Uint8Array;
  outputPixelFormat?: string;
  framerate?: number;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
}

/**
 * Audio encoder configuration
 */
export interface AudioEncoderBackendConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
  bitrateMode?: 'constant' | 'variable';
  latencyMode?: 'quality' | 'realtime';
}

/**
 * Audio decoder configuration
 */
export interface AudioDecoderBackendConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer | ArrayBufferView;
  outputFormat?: AudioSampleFormat;
}

/**
 * Base interface for all backends
 */
export interface BaseBackend {
  /** Whether the backend is healthy and accepting input */
  readonly isHealthy: boolean;

  /** Signal end of input stream */
  end(): void;

  /** Graceful shutdown with optional timeout */
  shutdown(timeout?: number): Promise<void>;

  /** Immediate termination */
  kill(): void;
}

/**
 * Video encoder backend interface
 */
export interface VideoEncoderBackend extends BaseBackend, EventEmitter {
  /** Initialize the encoder with configuration */
  startEncoder(config: VideoEncoderBackendConfig): void;

  /** Write raw frame data to encode */
  write(data: Buffer | Uint8Array): boolean;

  // Events
  on(event: 'encodedFrame', listener: (frame: EncodedFrame) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;

  emit(event: 'encodedFrame', frame: EncodedFrame): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'close', code: number | null): boolean;
}

/**
 * Video decoder backend interface
 */
export interface VideoDecoderBackend extends BaseBackend, EventEmitter {
  /** Initialize the decoder with configuration */
  startDecoder(config: VideoDecoderBackendConfig): void;

  /** Write encoded data to decode */
  write(data: Buffer | Uint8Array): boolean;

  // Events
  on(event: 'frame', listener: (frame: DecodedFrame) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;

  emit(event: 'frame', frame: DecodedFrame): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'close', code: number | null): boolean;
}

/**
 * Audio encoder backend interface
 */
export interface AudioEncoderBackend extends BaseBackend, EventEmitter {
  /** Initialize the encoder with configuration */
  startEncoder(config: AudioEncoderBackendConfig): void;

  /** Write raw audio samples to encode */
  write(data: Buffer | Uint8Array): boolean;

  // Events
  on(event: 'encodedFrame', listener: (frame: EncodedFrame) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;

  emit(event: 'encodedFrame', frame: EncodedFrame): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'close', code: number | null): boolean;
}

/**
 * Audio decoder backend interface
 */
export interface AudioDecoderBackend extends BaseBackend, EventEmitter {
  /** Initialize the decoder with configuration */
  startDecoder(config: AudioDecoderBackendConfig): void;

  /** Write encoded audio data to decode */
  write(data: Buffer | Uint8Array): boolean;

  // Events
  on(event: 'frame', listener: (frame: DecodedFrame) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;

  emit(event: 'frame', frame: DecodedFrame): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'close', code: number | null): boolean;
}

/** Default timeout for graceful shutdown (ms) */
export const DEFAULT_SHUTDOWN_TIMEOUT = 5000;

/** Default timeout for flush operations (ms) */
export const DEFAULT_FLUSH_TIMEOUT = 30000;

/** Buffer size threshold for emitting encoded chunks */
export const ENCODED_BUFFER_THRESHOLD = 4096;

/** Default framerate when not specified */
export const DEFAULT_FRAMERATE = 30;

/** Default bitrate for VP/AV1 codecs when not specified */
export const DEFAULT_VP_BITRATE = 500_000;

/** CRF values for quality-based encoding */
export const CRF_DEFAULTS = {
  h264: 23,
  hevc: 23,
  vp8: 31,
  vp9: 31,
  av1: 30,
} as const;

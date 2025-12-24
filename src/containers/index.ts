/**
 * Container handling module for WebCodecs
 *
 * This module provides container (MP4, WebM, MKV) demuxing, muxing, and transcoding
 * capabilities using node-av as the backend.
 *
 * @example
 * ```typescript
 * import { Demuxer, Muxer, muxChunks } from 'webcodecs-node/containers';
 *
 * // Demux video chunks for WebCodecs processing
 * const demuxer = new Demuxer({ path: 'video.mp4' });
 * await demuxer.open();
 * for await (const chunk of demuxer.videoChunks()) {
 *   // Feed to VideoDecoder...
 * }
 * await demuxer.close();
 *
 * // Mux encoded chunks to a file (with automatic fallback)
 * const muxer = new Muxer({ path: 'output.mp4' });
 * await muxer.open();
 * await muxer.addVideoTrack({ codec: 'avc1.64001E', ... });
 * // ... write chunks
 * const result = await muxer.closeWithResult();
 * console.log(`Used ${result.backend} in ${result.durationMs}ms`);
 *
 * // Or use the convenience function
 * const result = await muxChunks({
 *   path: 'output.mp4',
 *   video: { config, chunks },
 *   audio: { config, chunks },
 * });
 * ```
 */

// Demuxer
export { Demuxer } from './Demuxer.js';
export type {
  DemuxerConfig,
  VideoStreamConfig,
  AudioStreamConfig,
  VideoChunkCallback,
  AudioChunkCallback,
} from './Demuxer.js';

// Muxer types (shared interfaces)
export type {
  IMuxer,
  MuxerConfig,
  VideoTrackConfig,
  AudioTrackConfig,
  MuxResult,
} from './muxer-types.js';
export { MuxerError, inferFormat } from './muxer-types.js';

// Main Muxer (with automatic fallback - recommended)
export { Muxer, muxChunks } from './Muxer.js';
export type { MuxerOptions } from './Muxer.js';

// Node-av Muxer (fast, direct implementation)
export { NodeAvMuxer, StreamCopier } from './NodeAvMuxer.js';

// FFmpeg Muxer (subprocess-based, more compatible)
export { FFmpegMuxer } from './FFmpegMuxer.js';

// Transcoding utilities
export { remux, transcode, getMediaInfo } from './transcode.js';
export type {
  TranscodeOptions,
  TranscodeProgress,
  TranscodeResult,
  MediaInfo,
  VideoCodec,
  AudioCodec,
  HardwareAcceleration,
} from './transcode.js';

// Frame extraction
export { extractVideoFrames } from './extract.js';

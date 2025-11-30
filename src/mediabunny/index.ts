/**
 * Mediabunny FFmpeg Backend
 *
 * Provides FFmpeg-backed video and audio encoder/decoder implementations
 * for use with Mediabunny in Node.js environments.
 *
 * Usage:
 *   import { registerFFmpegCoders } from './mediabunny';
 *   registerFFmpegCoders();
 *   // Now Mediabunny will use FFmpeg for encoding/decoding
 */

import { registerEncoder, registerDecoder } from 'mediabunny';
import { FFmpegVideoEncoder } from './FFmpegVideoEncoder.js';
import { FFmpegVideoDecoder } from './FFmpegVideoDecoder.js';
import { FFmpegAudioEncoder } from './FFmpegAudioEncoder.js';
import { FFmpegAudioDecoder } from './FFmpegAudioDecoder.js';

export { FFmpegVideoEncoder } from './FFmpegVideoEncoder.js';
export { FFmpegVideoDecoder } from './FFmpegVideoDecoder.js';
export { FFmpegAudioEncoder } from './FFmpegAudioEncoder.js';
export { FFmpegAudioDecoder } from './FFmpegAudioDecoder.js';

/**
 * Register FFmpeg-backed encoders and decoders with Mediabunny.
 * Call this once at startup before using Mediabunny.
 */
export function registerFFmpegCoders(): void {
  // Video coders
  registerEncoder(FFmpegVideoEncoder);
  registerDecoder(FFmpegVideoDecoder);

  // Audio coders
  registerEncoder(FFmpegAudioEncoder);
  registerDecoder(FFmpegAudioDecoder);
}

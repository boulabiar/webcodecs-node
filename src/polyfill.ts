/**
 * WebCodecs Global Polyfill
 *
 * Installs WebCodecs API classes as globals, making them available
 * just like in a browser environment.
 *
 * Usage:
 *   import 'webcodecs-node/polyfill';
 *   // or
 *   import { installWebCodecsPolyfill } from 'webcodecs-node';
 *   installWebCodecsPolyfill();
 *
 *   // Now use WebCodecs as in browser:
 *   const encoder = new VideoEncoder({ ... });
 */

import { VideoFrame, VideoColorSpace, DOMRectReadOnly } from './VideoFrame.js';
import { EncodedVideoChunk } from './EncodedVideoChunk.js';
import { VideoEncoder } from './VideoEncoder.js';
import { VideoDecoder } from './VideoDecoder.js';
import { AudioData } from './AudioData.js';
import { EncodedAudioChunk } from './EncodedAudioChunk.js';
import { AudioEncoder } from './AudioEncoder.js';
import { AudioDecoder } from './AudioDecoder.js';
import { ImageDecoder } from './ImageDecoder.js';
import { installOffscreenCanvasPolyfill } from './polyfills/OffscreenCanvas.js';

/**
 * Install WebCodecs API as global objects.
 *
 * After calling this function, you can use WebCodecs classes
 * without importing them, just like in a browser.
 *
 * @param options.force - If true, overwrite existing globals
 */
export function installWebCodecsPolyfill(options?: { force?: boolean }): void {
  const force = options?.force ?? false;
  const g = globalThis as Record<string, unknown>;

  // Video classes
  if (force || typeof g.VideoFrame === 'undefined') {
    g.VideoFrame = VideoFrame;
  }
  if (force || typeof g.VideoColorSpace === 'undefined') {
    g.VideoColorSpace = VideoColorSpace;
  }
  if (force || typeof g.DOMRectReadOnly === 'undefined') {
    g.DOMRectReadOnly = DOMRectReadOnly;
  }
  if (force || typeof g.EncodedVideoChunk === 'undefined') {
    g.EncodedVideoChunk = EncodedVideoChunk;
  }
  if (force || typeof g.VideoEncoder === 'undefined') {
    g.VideoEncoder = VideoEncoder;
  }
  if (force || typeof g.VideoDecoder === 'undefined') {
    g.VideoDecoder = VideoDecoder;
  }

  // Audio classes
  if (force || typeof g.AudioData === 'undefined') {
    g.AudioData = AudioData;
  }
  if (force || typeof g.EncodedAudioChunk === 'undefined') {
    g.EncodedAudioChunk = EncodedAudioChunk;
  }
  if (force || typeof g.AudioEncoder === 'undefined') {
    g.AudioEncoder = AudioEncoder;
  }
  if (force || typeof g.AudioDecoder === 'undefined') {
    g.AudioDecoder = AudioDecoder;
  }

  // Image classes
  if (force || typeof g.ImageDecoder === 'undefined') {
    g.ImageDecoder = ImageDecoder;
  }

  // Also install OffscreenCanvas polyfill for video resizing support
  installOffscreenCanvasPolyfill();
}

// Auto-install when this module is imported
installWebCodecsPolyfill();

/**
 * Native frame interface for node-av integration
 *
 * Represents a native (non-JavaScript) audio or video frame from the node-av backend.
 * These frames hold references to native memory that must be properly released.
 */

/**
 * Base interface for native frames from node-av
 */
export interface NativeFrame {
  /**
   * Convert the native frame data to a JavaScript Buffer.
   * For video frames, returns raw pixel data.
   * For audio frames, returns raw PCM samples.
   */
  toBuffer(): Buffer;

  /**
   * Release the native resources associated with this frame.
   * Should be called when the frame is no longer needed.
   * Some implementations may not have this method (returns undefined).
   */
  unref?(): void;

  /**
   * Create a clone of this native frame.
   * Returns a new frame with its own native resources.
   * Some implementations may not support cloning.
   */
  clone?(): NativeFrame;
}

/**
 * Native video frame with additional video-specific properties
 */
export interface NativeVideoFrame extends NativeFrame {
  /** Frame width in pixels */
  readonly width?: number;
  /** Frame height in pixels */
  readonly height?: number;
  /** Pixel format (e.g., 'yuv420p', 'rgba') */
  readonly format?: string;
}

/**
 * Native audio frame with additional audio-specific properties
 */
export interface NativeAudioFrame extends NativeFrame {
  /** Number of audio samples per channel */
  readonly nbSamples?: number;
  /** Sample rate in Hz */
  readonly sampleRate?: number;
  /** Number of audio channels */
  readonly channels?: number;
  /** Sample format (e.g., 'fltp', 's16') */
  readonly format?: string;
}

/**
 * Type guard to check if an object is a NativeFrame
 *
 * A NativeFrame must have both toBuffer() and unref() methods.
 * This distinguishes it from objects like skia-canvas Canvas which
 * have toBuffer() but are not native frames from node-av.
 */
export function isNativeFrame(obj: unknown): obj is NativeFrame {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    typeof (obj as NativeFrame).toBuffer === 'function' &&
    typeof (obj as NativeFrame).unref === 'function'
  );
}

/**
 * Type guard to check if a NativeFrame has unref capability
 */
export function hasUnref(frame: NativeFrame): frame is NativeFrame & { unref(): void } {
  return typeof frame.unref === 'function';
}

/**
 * Type guard to check if a NativeFrame has clone capability
 */
export function hasClone(frame: NativeFrame): frame is NativeFrame & { clone(): NativeFrame } {
  return typeof frame.clone === 'function';
}

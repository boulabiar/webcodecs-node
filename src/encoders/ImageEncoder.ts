/**
 * ImageEncoder - Encodes VideoFrames to image formats
 *
 * Note: This is not part of the WebCodecs spec but is a useful utility
 * that mirrors the ImageDecoder API for symmetry.
 *
 * Supports encoding to PNG, JPEG, and WebP using skia-canvas.
 */

import { Canvas } from 'skia-canvas';
import { VideoFrame } from '../core/VideoFrame.js';
import { DOMException } from '../types/index.js';
import { isRgbFormat } from '../formats/pixel-formats.js';
import { convertFrameFormat, type FrameBuffer } from '../formats/conversions/frame-converter.js';

/**
 * Supported image output types
 */
export type ImageEncoderOutputType = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * Options for encoding an image
 */
export interface ImageEncoderOptions {
  /**
   * Output image format (default: 'image/png')
   */
  type?: ImageEncoderOutputType;

  /**
   * Quality for lossy formats (0-1, default: 0.92 for JPEG, 0.8 for WebP)
   * Ignored for PNG
   */
  quality?: number;
}

/**
 * Result of encoding an image
 */
export interface ImageEncoderResult {
  /**
   * Encoded image data
   */
  data: ArrayBuffer;

  /**
   * MIME type of the encoded image
   */
  type: ImageEncoderOutputType;
}

/**
 * Static class for encoding VideoFrames to image formats
 */
export class ImageEncoder {
  /**
   * Check if a given MIME type is supported for encoding
   */
  static isTypeSupported(type: string): boolean {
    return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp';
  }

  /**
   * Encode a VideoFrame to an image format
   *
   * @param frame - The VideoFrame to encode
   * @param options - Encoding options (type, quality)
   * @returns Promise resolving to encoded image data
   *
   * @example
   * ```typescript
   * const result = await ImageEncoder.encode(frame, {
   *   type: 'image/jpeg',
   *   quality: 0.85
   * });
   * fs.writeFileSync('output.jpg', Buffer.from(result.data));
   * ```
   */
  static async encode(frame: VideoFrame, options: ImageEncoderOptions = {}): Promise<ImageEncoderResult> {
    if (!frame || frame.format === null) {
      throw new DOMException('VideoFrame is closed or invalid', 'InvalidStateError');
    }

    const type = options.type ?? 'image/png';

    if (!ImageEncoder.isTypeSupported(type)) {
      throw new DOMException(`Unsupported image type: ${type}`, 'NotSupportedError');
    }

    // Get quality (default varies by format)
    let quality = options.quality;
    if (quality === undefined) {
      quality = type === 'image/jpeg' ? 0.92 : type === 'image/webp' ? 0.8 : 1.0;
    }
    quality = Math.max(0, Math.min(1, quality));

    // Get frame dimensions and data
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const format = frame.format;

    // Get pixel data - need RGBA for canvas
    let rgbaData: Uint8Array;

    if (format === 'RGBA') {
      // Already RGBA, just get the buffer
      rgbaData = frame._buffer;
    } else {
      // Need to convert to RGBA
      const srcBuffer: FrameBuffer = {
        data: frame._buffer,
        format: format,
        width: frame.codedWidth,
        height: frame.codedHeight,
      };
      rgbaData = new Uint8Array(width * height * 4);
      convertFrameFormat(srcBuffer, rgbaData, 'RGBA', 0, 0, width, height);
    }

    // Create canvas and draw the frame
    const canvas = new Canvas(width, height);
    const ctx = canvas.getContext('2d');

    // Create ImageData and put it on canvas
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgbaData);
    ctx.putImageData(imageData, 0, 0);

    // Encode to the requested format
    const skiaFormat = ImageEncoder._typeToSkiaFormat(type);
    const buffer = await (canvas as any).toBuffer(skiaFormat, { quality });

    return {
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      type,
    };
  }

  /**
   * Synchronous version of encode
   * Note: May block the event loop for large images
   */
  static encodeSync(frame: VideoFrame, options: ImageEncoderOptions = {}): ImageEncoderResult {
    if (!frame || frame.format === null) {
      throw new DOMException('VideoFrame is closed or invalid', 'InvalidStateError');
    }

    const type = options.type ?? 'image/png';

    if (!ImageEncoder.isTypeSupported(type)) {
      throw new DOMException(`Unsupported image type: ${type}`, 'NotSupportedError');
    }

    let quality = options.quality;
    if (quality === undefined) {
      quality = type === 'image/jpeg' ? 0.92 : type === 'image/webp' ? 0.8 : 1.0;
    }
    quality = Math.max(0, Math.min(1, quality));

    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const format = frame.format;

    let rgbaData: Uint8Array;

    if (format === 'RGBA') {
      rgbaData = frame._buffer;
    } else {
      const srcBuffer: FrameBuffer = {
        data: frame._buffer,
        format: format,
        width: frame.codedWidth,
        height: frame.codedHeight,
      };
      rgbaData = new Uint8Array(width * height * 4);
      convertFrameFormat(srcBuffer, rgbaData, 'RGBA', 0, 0, width, height);
    }

    const canvas = new Canvas(width, height);
    const ctx = canvas.getContext('2d');

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgbaData);
    ctx.putImageData(imageData, 0, 0);

    const skiaFormat = ImageEncoder._typeToSkiaFormat(type);
    const buffer = (canvas as any).toBufferSync(skiaFormat, { quality });

    return {
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      type,
    };
  }

  /**
   * Encode multiple frames in batch (useful for animations)
   */
  static async encodeBatch(
    frames: VideoFrame[],
    options: ImageEncoderOptions = {}
  ): Promise<ImageEncoderResult[]> {
    return Promise.all(frames.map(frame => ImageEncoder.encode(frame, options)));
  }

  /**
   * Convert MIME type to skia-canvas format string
   */
  private static _typeToSkiaFormat(type: ImageEncoderOutputType): string {
    switch (type) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
        return 'jpeg';
      case 'image/webp':
        return 'webp';
      default:
        return 'png';
    }
  }
}

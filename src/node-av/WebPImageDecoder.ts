/**
 * WebPImageDecoder - WebP image decoder using node-webpmux
 *
 * Provides full support for WebP images including animated WebP,
 * which FFmpeg's webp demuxer does not support (skips ANIM/ANMF chunks).
 */

import WebP from 'node-webpmux';
import type { VideoColorSpaceInit } from '../formats/index.js';

export interface DecodedWebPFrame {
  data: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  duration: number;
  complete: boolean;
  colorSpace?: VideoColorSpaceInit;
}

export interface WebPDecoderConfig {
  data: Uint8Array;
  desiredWidth?: number;
  desiredHeight?: number;
  colorSpace?: VideoColorSpaceInit;
}

// Track if the WASM library has been initialized
let libInitialized = false;
let libInitPromise: Promise<void> | null = null;

/**
 * Ensure the node-webpmux WASM library is initialized
 */
async function ensureLibInitialized(): Promise<void> {
  if (libInitialized) return;
  if (libInitPromise) {
    await libInitPromise;
    return;
  }
  libInitPromise = WebP.Image.initLib().then(() => {
    libInitialized = true;
  });
  await libInitPromise;
}

/**
 * Decode WebP images using node-webpmux
 * Supports both static and animated WebP
 */
export class WebPImageDecoder {
  private config: WebPDecoderConfig;
  private frames: DecodedWebPFrame[] = [];
  private closed = false;

  constructor(config: WebPDecoderConfig) {
    this.config = config;
  }

  /**
   * Decode all frames from the WebP data
   */
  async decode(): Promise<DecodedWebPFrame[]> {
    if (this.closed) {
      throw new Error('Decoder is closed');
    }

    await ensureLibInitialized();

    const img = new WebP.Image();
    await img.load(Buffer.from(this.config.data));

    const width = img.width;
    const height = img.height;
    const hasAnim = img.hasAnim;

    if (hasAnim && img.frames && img.frames.length > 0) {
      // Animated WebP - decode each frame
      let timestamp = 0;
      for (let i = 0; i < img.frames.length; i++) {
        const frameInfo = img.frames[i];
        const rgbaData = await img.getFrameData(i);

        // Frame duration in microseconds (frameInfo.delay is in ms)
        const durationUs = (frameInfo.delay || 100) * 1000;

        // Handle frame positioning if frame is smaller than canvas
        let frameData: Uint8Array;
        if (frameInfo.width === width && frameInfo.height === height &&
            frameInfo.x === 0 && frameInfo.y === 0) {
          // Frame fills entire canvas
          frameData = new Uint8Array(rgbaData);
        } else {
          // Frame is positioned within canvas - composite it
          frameData = this.compositeFrame(
            rgbaData,
            frameInfo.width,
            frameInfo.height,
            frameInfo.x,
            frameInfo.y,
            width,
            height
          );
        }

        // Apply scaling if desired dimensions specified
        const scaled = this.scaleIfNeeded(frameData, width, height);

        this.frames.push({
          data: scaled.data,
          width: scaled.width,
          height: scaled.height,
          timestamp,
          duration: durationUs,
          complete: true,
          colorSpace: this.config.colorSpace,
        });

        timestamp += durationUs;
      }
    } else {
      // Static WebP - single frame
      const rgbaData = await img.getImageData();

      // Apply scaling if desired dimensions specified
      const scaled = this.scaleIfNeeded(new Uint8Array(rgbaData), width, height);

      this.frames.push({
        data: scaled.data,
        width: scaled.width,
        height: scaled.height,
        timestamp: 0,
        duration: 0,
        complete: true,
        colorSpace: this.config.colorSpace,
      });
    }

    return this.frames;
  }

  /**
   * Composite a frame onto a canvas at the specified position
   */
  private compositeFrame(
    frameData: Buffer,
    frameWidth: number,
    frameHeight: number,
    frameX: number,
    frameY: number,
    canvasWidth: number,
    canvasHeight: number
  ): Uint8Array {
    // Create full canvas with transparent background
    const canvas = new Uint8Array(canvasWidth * canvasHeight * 4);

    // Copy frame pixels to their position on canvas
    for (let y = 0; y < frameHeight; y++) {
      const canvasY = frameY + y;
      if (canvasY < 0 || canvasY >= canvasHeight) continue;

      for (let x = 0; x < frameWidth; x++) {
        const canvasX = frameX + x;
        if (canvasX < 0 || canvasX >= canvasWidth) continue;

        const srcIdx = (y * frameWidth + x) * 4;
        const dstIdx = (canvasY * canvasWidth + canvasX) * 4;

        canvas[dstIdx] = frameData[srcIdx];
        canvas[dstIdx + 1] = frameData[srcIdx + 1];
        canvas[dstIdx + 2] = frameData[srcIdx + 2];
        canvas[dstIdx + 3] = frameData[srcIdx + 3];
      }
    }

    return canvas;
  }

  /**
   * Scale the frame if desired dimensions are specified
   * Uses simple nearest-neighbor scaling for performance
   */
  private scaleIfNeeded(
    data: Uint8Array,
    width: number,
    height: number
  ): { data: Uint8Array; width: number; height: number } {
    const desiredW = this.config.desiredWidth;
    const desiredH = this.config.desiredHeight;

    if (!desiredW && !desiredH) {
      return { data, width, height };
    }

    // Calculate target dimensions maintaining aspect ratio if only one dimension specified
    let targetW = desiredW || Math.round(width * (desiredH! / height));
    let targetH = desiredH || Math.round(height * (desiredW! / width));

    if (targetW === width && targetH === height) {
      return { data, width, height };
    }

    // Nearest-neighbor scaling
    const scaled = new Uint8Array(targetW * targetH * 4);
    const xRatio = width / targetW;
    const yRatio = height / targetH;

    for (let y = 0; y < targetH; y++) {
      const srcY = Math.floor(y * yRatio);
      for (let x = 0; x < targetW; x++) {
        const srcX = Math.floor(x * xRatio);
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * targetW + x) * 4;

        scaled[dstIdx] = data[srcIdx];
        scaled[dstIdx + 1] = data[srcIdx + 1];
        scaled[dstIdx + 2] = data[srcIdx + 2];
        scaled[dstIdx + 3] = data[srcIdx + 3];
      }
    }

    return { data: scaled, width: targetW, height: targetH };
  }

  /**
   * Close the decoder and release resources
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.frames = [];
  }

  /**
   * Check if WebP MIME type is supported
   */
  static isTypeSupported(mimeType: string): boolean {
    const type = mimeType.toLowerCase();
    return type === 'image/webp';
  }
}

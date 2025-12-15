/**
 * NodeAvImageDecoder - Node-av based image decoder
 *
 * Decodes still images and animated images (GIF, APNG) using node-av
 * native bindings instead of spawning FFmpeg CLI processes.
 *
 * Note: Animated WebP is NOT supported due to FFmpeg's webp demuxer
 * skipping ANIM/ANMF chunks. Use FFmpeg CLI fallback for animated WebP.
 */

import { Decoder, Demuxer, FilterAPI } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import {
  AVMEDIA_TYPE_VIDEO,
  AV_CODEC_ID_PNG,
  AV_CODEC_ID_MJPEG,
  AV_CODEC_ID_WEBP,
  AV_CODEC_ID_GIF,
  AV_CODEC_ID_BMP,
  AV_CODEC_ID_TIFF,
  AV_CODEC_ID_AV1,
  type AVCodecID,
} from 'node-av/constants';

import type { VideoColorSpaceInit } from '../formats/index.js';

export interface DecodedImageFrame {
  data: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  duration: number;
  complete: boolean;
  colorSpace?: VideoColorSpaceInit;
}

export interface ImageDecoderConfig {
  mimeType: string;
  data: Uint8Array;
  desiredWidth?: number;
  desiredHeight?: number;
  colorSpace?: VideoColorSpaceInit;
}

// MIME type to AVCodecID mapping
const MIME_TO_CODEC_ID: Record<string, AVCodecID> = {
  'image/png': AV_CODEC_ID_PNG,
  'image/apng': AV_CODEC_ID_PNG,
  'image/jpeg': AV_CODEC_ID_MJPEG,
  'image/jpg': AV_CODEC_ID_MJPEG,
  'image/webp': AV_CODEC_ID_WEBP,
  'image/gif': AV_CODEC_ID_GIF,
  'image/bmp': AV_CODEC_ID_BMP,
  'image/tiff': AV_CODEC_ID_TIFF,
  'image/avif': AV_CODEC_ID_AV1,
};

// Formats that require Demuxer for proper multi-frame decoding
// Note: WebP is excluded because FFmpeg's webp demuxer doesn't support ANIM/ANMF
const DEMUXER_FORMATS = ['image/gif', 'image/apng'];

/**
 * Decode images using node-av native bindings
 */
export class NodeAvImageDecoder {
  private decoder: Decoder | null = null;
  private demuxer: Demuxer | null = null;
  private formatContext: FormatContext | null = null;
  private stream: Stream | null = null;
  private filter: FilterAPI | null = null;
  private config: ImageDecoderConfig;
  private frames: DecodedImageFrame[] = [];
  private closed = false;

  // Use a dummy time_base for still images (required by node-av)
  private static readonly DUMMY_TIME_BASE = new Rational(1, 25);
  private static readonly DEFAULT_FRAME_DURATION = 100000; // 100ms in microseconds

  constructor(config: ImageDecoderConfig) {
    this.config = config;
  }

  /**
   * Decode all frames from the image data
   */
  async decode(): Promise<DecodedImageFrame[]> {
    if (this.closed) {
      throw new Error('Decoder is closed');
    }

    const codecId = this.getCodecId();
    if (!codecId) {
      throw new Error(`Unsupported image type: ${this.config.mimeType}`);
    }

    try {
      if (this.usesDemuxer()) {
        // Use Demuxer for animated formats (GIF, APNG)
        await this.decodeWithDemuxer();
      } else {
        // Use raw Decoder for static images
        await this.initializeDecoder(codecId);
        await this.decodeData();
        await this.flush();
      }
    } finally {
      this.cleanup();
    }

    return this.frames;
  }

  /**
   * Check if this format requires Demuxer for proper decoding
   */
  private usesDemuxer(): boolean {
    return DEMUXER_FORMATS.includes(this.config.mimeType.toLowerCase());
  }

  /**
   * Get the codec ID for the MIME type
   */
  private getCodecId(): AVCodecID | null {
    return MIME_TO_CODEC_ID[this.config.mimeType.toLowerCase()] ?? null;
  }

  /**
   * Decode animated images using Demuxer API
   * This properly parses container formats like GIF and APNG
   */
  private async decodeWithDemuxer(): Promise<void> {
    // Open demuxer from buffer
    this.demuxer = await Demuxer.open(Buffer.from(this.config.data));

    // Find video stream
    const videoStream = this.demuxer.streams.find(
      (s: Stream) => s.codecpar.codecType === AVMEDIA_TYPE_VIDEO
    );

    if (!videoStream) {
      throw new Error('No video stream found in image');
    }

    // Store stream reference and create decoder
    this.stream = videoStream;
    this.decoder = await Decoder.create(videoStream, { exitOnError: false });

    // Get time base for duration calculation
    const timeBase = videoStream.timeBase;
    const timeBaseNum = timeBase?.num ?? 1;
    const timeBaseDen = timeBase?.den ?? 1;

    // Read and decode all packets
    for await (const packet of this.demuxer.packets()) {
      if (!packet) break;

      if (packet.streamIndex === videoStream.index) {
        // Calculate timestamp and duration in microseconds
        const pts = Number(packet.pts ?? 0n);
        const duration = Number(packet.duration ?? 0n);

        const timestampUs = Math.round((pts * timeBaseNum / timeBaseDen) * 1_000_000);
        const durationUs = duration > 0
          ? Math.round((duration * timeBaseNum / timeBaseDen) * 1_000_000)
          : NodeAvImageDecoder.DEFAULT_FRAME_DURATION;

        // Decode packet
        await this.decoder.decode(packet);

        // Drain frames
        let frame = await this.decoder.receive();
        while (frame) {
          const converted = await this.convertFrameWithTiming(frame, timestampUs, durationUs);
          frame.unref();

          if (converted) {
            this.frames.push(converted);
          }

          frame = await this.decoder.receive();
        }
      }

      packet.unref();
    }

    // Flush decoder
    try {
      await this.decoder.flush();
      let frame = await this.decoder.receive();
      while (frame) {
        const lastTimestamp = this.frames.length > 0
          ? this.frames[this.frames.length - 1].timestamp + this.frames[this.frames.length - 1].duration
          : 0;
        const converted = await this.convertFrameWithTiming(
          frame,
          lastTimestamp,
          NodeAvImageDecoder.DEFAULT_FRAME_DURATION
        );
        frame.unref();

        if (converted) {
          this.frames.push(converted);
        }

        frame = await this.decoder.receive();
      }
    } catch {
      // Ignore flush errors
    }
  }

  /**
   * Convert a decoded frame to RGBA with specific timing
   */
  private async convertFrameWithTiming(
    frame: any,
    timestamp: number,
    duration: number
  ): Promise<DecodedImageFrame | null> {
    const width = frame.width;
    const height = frame.height;

    if (width === 0 || height === 0) {
      return null;
    }

    // Build filter description for scaling and format conversion
    let filterDesc = '';
    if (this.config.desiredWidth || this.config.desiredHeight) {
      const scaleW = this.config.desiredWidth || -1;
      const scaleH = this.config.desiredHeight || -1;
      filterDesc = `scale=${scaleW}:${scaleH},format=rgba`;
    } else {
      filterDesc = 'format=rgba';
    }

    // Create or reuse filter
    if (!this.filter) {
      this.filter = FilterAPI.create(filterDesc, {});
    }

    await this.filter.process(frame);

    let filtered = await this.filter.receive();
    let attempts = 0;
    while (filtered === null && attempts < 10) {
      filtered = await this.filter.receive();
      attempts++;
    }

    if (!filtered) {
      return null;
    }

    const outputWidth = this.config.desiredWidth || width;
    const outputHeight = this.config.desiredHeight || height;
    const buffer = filtered.toBuffer();
    filtered.unref();

    return {
      data: new Uint8Array(buffer),
      width: outputWidth,
      height: outputHeight,
      timestamp,
      duration,
      complete: true,
      colorSpace: this.config.colorSpace,
    };
  }

  /**
   * Initialize the decoder with the given codec (for static images)
   */
  private async initializeDecoder(codecId: AVCodecID): Promise<void> {
    this.formatContext = new FormatContext();
    this.formatContext.allocContext();
    this.stream = this.formatContext.newStream();
    this.stream.timeBase = NodeAvImageDecoder.DUMMY_TIME_BASE;

    const params = this.stream.codecpar;
    params.codecType = AVMEDIA_TYPE_VIDEO;
    params.codecId = codecId;
    params.width = 0;
    params.height = 0;

    this.decoder = await Decoder.create(this.stream, {
      exitOnError: false,
    });
  }

  /**
   * Decode static image data
   */
  private async decodeData(): Promise<void> {
    if (!this.decoder || !this.stream) {
      throw new Error('Decoder not initialized');
    }

    await this.sendPacket(Buffer.from(this.config.data), 0);
    await this.drainFrames();
  }

  /**
   * Send a packet to the decoder
   */
  private async sendPacket(data: Buffer, pts: number): Promise<void> {
    if (!this.decoder || !this.stream) return;

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = this.stream.index;
    packet.pts = BigInt(pts);
    packet.dts = BigInt(pts);
    packet.timeBase = NodeAvImageDecoder.DUMMY_TIME_BASE;
    packet.data = data;
    packet.duration = 1n;

    await this.decoder.decode(packet);
    packet.unref();
  }

  /**
   * Drain decoded frames from the decoder
   */
  private async drainFrames(): Promise<void> {
    if (!this.decoder) return;

    let frame = await this.decoder.receive();
    while (frame) {
      const converted = await this.convertFrame(frame);
      frame.unref();

      if (converted) {
        this.frames.push(converted);
      }

      frame = await this.decoder.receive();
    }
  }

  /**
   * Convert a decoded frame to RGBA (for static images)
   */
  private async convertFrame(frame: any): Promise<DecodedImageFrame | null> {
    const width = frame.width;
    const height = frame.height;

    if (width === 0 || height === 0) {
      return null;
    }

    let filterDesc = '';
    if (this.config.desiredWidth || this.config.desiredHeight) {
      const scaleW = this.config.desiredWidth || -1;
      const scaleH = this.config.desiredHeight || -1;
      filterDesc = `scale=${scaleW}:${scaleH},format=rgba`;
    } else {
      filterDesc = 'format=rgba';
    }

    if (!this.filter) {
      this.filter = FilterAPI.create(filterDesc, {});
    }

    await this.filter.process(frame);

    let filtered = await this.filter.receive();
    let attempts = 0;
    while (filtered === null && attempts < 10) {
      filtered = await this.filter.receive();
      attempts++;
    }

    if (!filtered) {
      return null;
    }

    const outputWidth = this.config.desiredWidth || width;
    const outputHeight = this.config.desiredHeight || height;
    const buffer = filtered.toBuffer();
    filtered.unref();

    // Static images have timestamp 0 and duration 0
    return {
      data: new Uint8Array(buffer),
      width: outputWidth,
      height: outputHeight,
      timestamp: 0,
      duration: 0,
      complete: true,
      colorSpace: this.config.colorSpace,
    };
  }

  /**
   * Flush the decoder to get any remaining frames
   */
  private async flush(): Promise<void> {
    if (!this.decoder) return;

    try {
      await this.decoder.flush();
      await this.drainFrames();
    } catch {
      // Ignore flush errors
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.filter?.close();
    this.filter = null;
    this.decoder?.close();
    this.decoder = null;
    this.demuxer?.close();
    this.demuxer = null;
    this.formatContext = null;
    this.stream = null;
  }

  /**
   * Close the decoder
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    this.frames = [];
  }

  /**
   * Check if a MIME type is supported
   */
  static isTypeSupported(mimeType: string): boolean {
    return mimeType.toLowerCase() in MIME_TO_CODEC_ID;
  }

  /**
   * Check if animated decoding is supported for this type
   * (GIF and APNG work, WebP does not due to FFmpeg limitations)
   */
  static isAnimatedTypeSupported(mimeType: string): boolean {
    return DEMUXER_FORMATS.includes(mimeType.toLowerCase());
  }
}

/**
 * Probe image dimensions using node-av
 * Returns { width, height } or { width: 0, height: 0 } if probing fails
 */
export async function probeImageDimensions(
  data: Uint8Array,
  mimeType: string
): Promise<{ width: number; height: number }> {
  const codecId = MIME_TO_CODEC_ID[mimeType.toLowerCase()];
  if (!codecId) {
    return { width: 0, height: 0 };
  }

  let formatContext: FormatContext | null = null;
  let stream: Stream | null = null;
  let decoder: Decoder | null = null;

  try {
    formatContext = new FormatContext();
    formatContext.allocContext();
    stream = formatContext.newStream();
    stream.timeBase = new Rational(1, 25);

    const params = stream.codecpar;
    params.codecType = AVMEDIA_TYPE_VIDEO;
    params.codecId = codecId;
    params.width = 0;
    params.height = 0;

    decoder = await Decoder.create(stream, { exitOnError: false });

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = stream.index;
    packet.pts = 0n;
    packet.dts = 0n;
    packet.timeBase = new Rational(1, 25);
    packet.data = Buffer.from(data);
    packet.duration = 1n;

    await decoder.decode(packet);
    packet.unref();

    const frame = await decoder.receive();
    if (frame) {
      const width = frame.width;
      const height = frame.height;
      frame.unref();
      return { width, height };
    }

    return { width: 0, height: 0 };
  } catch {
    return { width: 0, height: 0 };
  } finally {
    decoder?.close();
  }
}

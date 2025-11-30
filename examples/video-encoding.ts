/**
 * Video Encoding Example
 *
 * Demonstrates how to encode raw video frames to H.264.
 *
 * Run: npx tsx examples/video-encoding.ts
 */

import { VideoEncoder, VideoFrame, EncodedVideoChunk } from '../src/index.js';
import { writeFileSync } from 'fs';

async function main() {
  const width = 320;
  const height = 240;
  const frameCount = 60;
  const framerate = 30;

  const chunks: EncodedVideoChunk[] = [];

  // Create encoder with callbacks
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      console.log(
        `Encoded frame: ${chunk.type} ${chunk.byteLength} bytes, timestamp: ${chunk.timestamp}`
      );

      // First chunk includes decoder configuration
      if (metadata?.decoderConfig) {
        console.log('Decoder config:', metadata.decoderConfig);
      }
    },
    error: (err) => {
      console.error('Encoding error:', err);
    },
  });

  // Configure the encoder
  encoder.configure({
    codec: 'avc1.42001E', // H.264 Baseline
    width,
    height,
    bitrate: 1_000_000,
    framerate,
    bitrateMode: 'variable', // VBR for better quality
  });

  console.log(`Encoding ${frameCount} frames at ${width}x${height}...`);

  // Generate and encode frames
  for (let i = 0; i < frameCount; i++) {
    // Create a simple gradient frame
    const rgba = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Animate color based on frame number
        rgba[idx] = (x + i * 5) % 256; // R
        rgba[idx + 1] = (y + i * 3) % 256; // G
        rgba[idx + 2] = ((x + y) / 2 + i * 2) % 256; // B
        rgba[idx + 3] = 255; // A
      }
    }

    const frame = new VideoFrame(rgba, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: (i * 1_000_000) / framerate, // microseconds
    });

    // Force keyframe every second
    encoder.encode(frame, { keyFrame: i % framerate === 0 });
    frame.close();
  }

  // Wait for all frames to be encoded
  await encoder.flush();
  encoder.close();

  // Calculate total size
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const keyFrames = chunks.filter((c) => c.type === 'key').length;

  console.log(`\nEncoding complete:`);
  console.log(`  Total chunks: ${chunks.length}`);
  console.log(`  Key frames: ${keyFrames}`);
  console.log(`  Total size: ${(totalBytes / 1024).toFixed(2)} KB`);
  console.log(`  Avg bitrate: ${((totalBytes * 8 * framerate) / frameCount / 1000).toFixed(0)} kbps`);
}

main().catch(console.error);

/**
 * Video Decoding Example
 *
 * Demonstrates how to decode video chunks back to raw frames.
 *
 * Run: npx tsx examples/video-decoding.ts
 */

import {
  VideoEncoder,
  VideoDecoder,
  VideoFrame,
  EncodedVideoChunk,
} from '../src/index.js';

async function main() {
  const width = 320;
  const height = 240;
  const frameCount = 10;
  const framerate = 30;

  // First, encode some frames to get chunks to decode
  const chunks: EncodedVideoChunk[] = [];

  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: console.error,
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 500_000,
    framerate,
  });

  console.log('Encoding frames...');

  for (let i = 0; i < frameCount; i++) {
    const rgba = new Uint8Array(width * height * 4);
    // Create solid color frames for easy verification
    const color = Math.floor((i / frameCount) * 255);
    for (let j = 0; j < rgba.length; j += 4) {
      rgba[j] = color; // R
      rgba[j + 1] = 255 - color; // G
      rgba[j + 2] = 128; // B
      rgba[j + 3] = 255; // A
    }

    const frame = new VideoFrame(rgba, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: (i * 1_000_000) / framerate,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  console.log(`Encoded ${chunks.length} chunks\n`);

  // Now decode the chunks
  const decodedFrames: { timestamp: number; size: string }[] = [];

  const decoder = new VideoDecoder({
    output: (frame) => {
      decodedFrames.push({
        timestamp: frame.timestamp,
        size: `${frame.codedWidth}x${frame.codedHeight}`,
      });
      console.log(
        `Decoded frame: ${frame.codedWidth}x${frame.codedHeight}, ` +
          `format: ${frame.format}, timestamp: ${frame.timestamp}`
      );
      frame.close();
    },
    error: (err) => {
      console.error('Decoding error:', err);
    },
  });

  decoder.configure({
    codec: 'avc1.42001E',
    codedWidth: width,
    codedHeight: height,
  });

  console.log('Decoding chunks...');

  for (const chunk of chunks) {
    decoder.decode(chunk);
  }

  await decoder.flush();
  decoder.close();

  console.log(`\nDecoding complete:`);
  console.log(`  Input chunks: ${chunks.length}`);
  console.log(`  Output frames: ${decodedFrames.length}`);
}

main().catch(console.error);

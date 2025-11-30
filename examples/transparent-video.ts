/**
 * Transparent Video Example
 *
 * Demonstrates encoding video with alpha channel using VP9.
 *
 * Run: npx tsx examples/transparent-video.ts
 */

import { VideoEncoder, VideoFrame, EncodedVideoChunk } from '../src/index.js';

async function main() {
  const width = 256;
  const height = 256;
  const frameCount = 30;
  const framerate = 30;

  console.log('=== Transparent Video Encoding Example ===\n');

  // Check if VP9 supports alpha
  const support = await VideoEncoder.isConfigSupported({
    codec: 'vp9',
    width,
    height,
  });

  if (!support.supported) {
    console.log('VP9 encoding not supported');
    return;
  }

  const chunks: EncodedVideoChunk[] = [];

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      console.log(`Encoded: ${chunk.type} frame, ${chunk.byteLength} bytes`);
    },
    error: console.error,
  });

  // Configure VP9 with alpha preservation
  encoder.configure({
    codec: 'vp9',
    width,
    height,
    alpha: 'keep', // Preserve transparency
    framerate,
  });

  console.log('Encoding frames with transparency...\n');

  // Generate frames with animated transparency
  for (let i = 0; i < frameCount; i++) {
    const rgba = new Uint8Array(width * height * 4);

    // Create a circular gradient with animated transparency
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2;
    const animPhase = (i / frameCount) * Math.PI * 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // Distance from center
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Animated radius
        const radius = maxRadius * (0.5 + 0.3 * Math.sin(animPhase));

        if (dist < radius) {
          // Inside circle: solid color with gradient alpha
          const alpha = 255 * (1 - dist / radius);
          rgba[idx] = 100; // R
          rgba[idx + 1] = 200; // G
          rgba[idx + 2] = 255; // B
          rgba[idx + 3] = Math.floor(alpha); // A
        } else {
          // Outside circle: fully transparent
          rgba[idx] = 0;
          rgba[idx + 1] = 0;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 0;
        }
      }
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

  // Statistics
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);

  console.log(`\nEncoding complete:`);
  console.log(`  Codec: VP9 with alpha`);
  console.log(`  Frames: ${frameCount}`);
  console.log(`  Size: ${(totalBytes / 1024).toFixed(2)} KB`);

  // Compare with discarded alpha
  console.log('\n--- Comparison with alpha:discard ---\n');

  const chunksNoAlpha: EncodedVideoChunk[] = [];

  const encoderNoAlpha = new VideoEncoder({
    output: (chunk) => chunksNoAlpha.push(chunk),
    error: console.error,
  });

  encoderNoAlpha.configure({
    codec: 'vp9',
    width,
    height,
    alpha: 'discard', // Strip transparency
    framerate,
  });

  // Encode same content without alpha
  for (let i = 0; i < frameCount; i++) {
    const rgba = new Uint8Array(width * height * 4);
    rgba.fill(128); // Gray with full alpha
    for (let j = 3; j < rgba.length; j += 4) {
      rgba[j] = 255;
    }

    const frame = new VideoFrame(rgba, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: (i * 1_000_000) / framerate,
    });

    encoderNoAlpha.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  await encoderNoAlpha.flush();
  encoderNoAlpha.close();

  const totalBytesNoAlpha = chunksNoAlpha.reduce((sum, c) => sum + c.byteLength, 0);

  console.log(`Without alpha: ${(totalBytesNoAlpha / 1024).toFixed(2)} KB`);
  console.log(`With alpha: ${(totalBytes / 1024).toFixed(2)} KB`);
  console.log(
    `Alpha overhead: ${(((totalBytes - totalBytesNoAlpha) / totalBytesNoAlpha) * 100).toFixed(1)}%`
  );
}

main().catch(console.error);

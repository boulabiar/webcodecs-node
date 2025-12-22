/**
 * Image Decoding Example
 *
 * Demonstrates how to decode images including animated GIFs.
 *
 * Run: npx tsx examples/image-decoding.ts
 */

import { ImageDecoder } from '../src/index.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

async function decodeImage(imagePath: string) {
  if (!existsSync(imagePath)) {
    console.log(`File not found: ${imagePath}`);
    return;
  }

  const data = readFileSync(imagePath);
  const ext = imagePath.split('.').pop()?.toLowerCase();

  // Map extension to MIME type
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
  };

  const type = mimeTypes[ext || ''] || 'image/png';

  console.log(`\nDecoding: ${imagePath}`);
  console.log(`MIME type: ${type}`);
  console.log(`File size: ${(data.length / 1024).toFixed(2)} KB`);

  const decoder = new ImageDecoder({
    type,
    data,
  });

  // Wait for parsing to complete
  await decoder.completed;

  const track = decoder.tracks.selectedTrack;
  if (!track) {
    console.log('No image track found');
    decoder.close();
    return;
  }

  console.log(`\nImage properties:`);
  console.log(`  Frames: ${track.frameCount}`);
  console.log(`  Animated: ${track.animated}`);
  if (track.animated) {
    console.log(
      `  Loop count: ${track.repetitionCount === Infinity ? 'infinite' : track.repetitionCount}`
    );
  }

  // Decode each frame
  console.log(`\nFrames:`);
  for (let i = 0; i < track.frameCount; i++) {
    const { image, complete } = await decoder.decode({ frameIndex: i });

    console.log(
      `  Frame ${i}: ${image.codedWidth}x${image.codedHeight}, ` +
        `format: ${image.format}, ` +
        `duration: ${(image.duration || 0) / 1000}ms`
    );

    image.close();
  }

  decoder.close();
}

async function main() {
  console.log('=== Image Decoding Example ===');

  // Check if ImageDecoder supports various formats
  const formats = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

  console.log('\nSupported formats:');
  for (const format of formats) {
    const supported = await ImageDecoder.isTypeSupported(format);
    console.log(`  ${format}: ${supported ? 'yes' : 'no'}`);
  }

  // Try to decode sample images if they exist
  const samplePaths = [
    '/tmp/webcodecs-test-images/test.png',
    '/tmp/webcodecs-test-images/test.gif',
    '/tmp/webcodecs-test-images/test.webp',
  ];

  for (const path of samplePaths) {
    if (existsSync(path)) {
      await decodeImage(path);
    }
  }

  // If no sample images, create a simple PNG in memory
  if (!samplePaths.some(existsSync)) {
    console.log('\nNo sample images found. Creating a test image in memory...');

    // Minimal valid PNG (1x1 red pixel)
    const minimalPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x18, 0xdd,
      0x8d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, // IEND chunk
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const decoder = new ImageDecoder({
      type: 'image/png',
      data: minimalPng,
    });

    await decoder.completed;

    const track = decoder.tracks.selectedTrack;
    console.log(`\nDecoded in-memory PNG:`);
    console.log(`  Frames: ${track?.frameCount}`);

    if (track && track.frameCount > 0) {
      const { image } = await decoder.decode({ frameIndex: 0 });
      console.log(`  Size: ${image.codedWidth}x${image.codedHeight}`);
      console.log(`  Format: ${image.format}`);
      image.close();
    }

    decoder.close();
  }
}

main().catch(console.error);

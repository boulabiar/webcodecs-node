/**
 * Demo: ImageDecoder with WebCodecs API
 *
 * This demo shows how to:
 * 1. Decode various image formats (PNG, JPEG, WebP, GIF)
 * 2. Access frame data as VideoFrame
 * 3. Handle animated images (GIF, APNG, WebP)
 * 4. Access frame timing/duration information
 * 5. Handle loop count for animations
 */

import * as fs from 'fs';
import * as path from 'path';
import { ImageDecoder } from '../index.js';

// Create test images using FFmpeg
async function createTestImages(): Promise<void> {
  const { execSync } = await import('child_process');
  const testDir = '/tmp/webcodecs-test-images';

  // Create test directory
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  console.log('Creating test images...\n');

  // Create a simple PNG (red square)
  execSync(`ffmpeg -y -f lavfi -i color=c=red:size=100x100:d=1 -frames:v 1 ${testDir}/test.png 2>/dev/null`);
  console.log('  Created test.png (100x100 red square)');

  // Create a JPEG (blue gradient)
  execSync(`ffmpeg -y -f lavfi -i "gradients=size=200x150:c0=blue:c1=white:d=1" -frames:v 1 ${testDir}/test.jpg 2>/dev/null`);
  console.log('  Created test.jpg (200x150 blue gradient)');

  // Create a WebP (green circle on transparent)
  execSync(`ffmpeg -y -f lavfi -i color=c=green:size=80x80:d=1 -frames:v 1 ${testDir}/test.webp 2>/dev/null`);
  console.log('  Created test.webp (80x80 green square)');

  // Create an animated GIF (3 frames, cycling colors)
  execSync(`ffmpeg -y -f lavfi -i "color=c=red:size=50x50:d=0.5,format=rgb24[r];color=c=green:size=50x50:d=0.5,format=rgb24[g];color=c=blue:size=50x50:d=0.5,format=rgb24[b];[r][g][b]concat=n=3:v=1:a=0" -frames:v 3 ${testDir}/test.gif 2>/dev/null`);
  console.log('  Created test.gif (50x50 animated, 3 frames)');

  // Create a BMP
  execSync(`ffmpeg -y -f lavfi -i color=c=yellow:size=64x64:d=1 -frames:v 1 ${testDir}/test.bmp 2>/dev/null`);
  console.log('  Created test.bmp (64x64 yellow square)');

  console.log('');
}

async function testImageDecoder(
  filePath: string,
  mimeType: string
): Promise<void> {
  const fileName = path.basename(filePath);
  console.log(`\nTesting: ${fileName} (${mimeType})`);
  console.log('-'.repeat(40));

  // Read file
  const data = fs.readFileSync(filePath);
  console.log(`  File size: ${data.length} bytes`);

  // Check support
  const supported = await ImageDecoder.isTypeSupported(mimeType);
  console.log(`  Type supported: ${supported}`);

  if (!supported) {
    console.log('  Skipping unsupported type');
    return;
  }

  // Create decoder
  // Note: Pass the Buffer directly (as ArrayBufferView), not data.buffer
  // because Buffer.buffer can include extra data from Node's buffer pool
  const decoder = new ImageDecoder({
    type: mimeType,
    data: data,
  });

  // Wait for completion
  await decoder.completed;
  console.log(`  Decoder complete: ${decoder.complete}`);

  // Get track info
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;

  if (track) {
    console.log(`  Track info:`);
    console.log(`    - Animated: ${track.animated}`);
    console.log(`    - Frame count: ${track.frameCount}`);
    console.log(`    - Repetition count: ${track.repetitionCount === Infinity ? 'infinite' : track.repetitionCount}`);
  }

  // Decode first frame
  const result = await decoder.decode({ frameIndex: 0 });
  const frame = result.image;

  console.log(`  First frame:`);
  console.log(`    - Dimensions: ${frame.codedWidth}x${frame.codedHeight}`);
  console.log(`    - Format: ${frame.format}`);
  console.log(`    - Timestamp: ${frame.timestamp}µs`);
  console.log(`    - Duration: ${frame.duration}µs`);

  // If animated, decode all frames and show timing info
  if (track && track.frameCount > 1) {
    console.log(`  Decoding all ${track.frameCount} frames with timing:`);
    let totalDuration = 0;
    const framesToShow = Math.min(track.frameCount, 10);

    for (let i = 0; i < framesToShow; i++) {
      const frameResult = await decoder.decode({ frameIndex: i });
      const durationMs = (frameResult.image.duration || 0) / 1000;
      const timestampMs = frameResult.image.timestamp / 1000;
      totalDuration += frameResult.image.duration || 0;

      console.log(
        `    Frame ${i.toString().padStart(2)}: ` +
        `${frameResult.image.codedWidth}x${frameResult.image.codedHeight}, ` +
        `ts=${timestampMs.toFixed(1).padStart(7)}ms, ` +
        `dur=${durationMs.toFixed(1).padStart(6)}ms`
      );
      frameResult.image.close();
    }

    if (track.frameCount > framesToShow) {
      console.log(`    ... and ${track.frameCount - framesToShow} more frames`);
    }

    console.log(`  Total animation duration: ${(totalDuration / 1000).toFixed(1)}ms`);
  }

  // Cleanup
  frame.close();
  decoder.close();

  console.log('  SUCCESS');
}

async function main() {
  console.log('WebCodecs ImageDecoder Demo');
  console.log('===========================\n');

  // Create test images
  await createTestImages();

  const testDir = '/tmp/webcodecs-test-images';

  // Test each format
  const testCases = [
    { file: 'test.png', type: 'image/png' },
    { file: 'test.jpg', type: 'image/jpeg' },
    { file: 'test.webp', type: 'image/webp' },
    { file: 'test.gif', type: 'image/gif' },
    { file: 'animated_multi.gif', type: 'image/gif' },  // Multi-frame animated GIF
    { file: 'test.bmp', type: 'image/bmp' },
  ];

  for (const { file, type } of testCases) {
    try {
      await testImageDecoder(path.join(testDir, file), type);
    } catch (error) {
      console.log(`  ERROR: ${(error as Error).message}`);
    }
  }

  // Test with ReadableStream (Node.js 18+ has web streams)
  console.log('\n\nTesting with ReadableStream:');
  console.log('-'.repeat(40));

  // Check if ReadableStream is available (Node.js 18+)
  if (typeof globalThis.ReadableStream !== 'undefined') {
    const pngData = fs.readFileSync(path.join(testDir, 'test.png'));

    // Create a ReadableStream from the buffer
    const stream = new globalThis.ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(pngData));
        controller.close();
      },
    });

    const streamDecoder = new ImageDecoder({
      type: 'image/png',
      data: stream,
    });

    await streamDecoder.completed;
    const streamResult = await streamDecoder.decode();
    console.log(`  Stream decode: ${streamResult.image.codedWidth}x${streamResult.image.codedHeight}`);
    streamResult.image.close();
    streamDecoder.close();
    console.log('  SUCCESS');
  } else {
    console.log('  ReadableStream not available (requires Node.js 18+)');
    console.log('  SKIPPED');
  }

  // Test with desiredWidth/desiredHeight (scaling)
  console.log('\n\nTesting image scaling:');
  console.log('-'.repeat(40));

  const jpgData = fs.readFileSync(path.join(testDir, 'test.jpg'));
  const scaledDecoder = new ImageDecoder({
    type: 'image/jpeg',
    data: jpgData,
    desiredWidth: 100,
    desiredHeight: 75,
  });

  await scaledDecoder.completed;
  const scaledResult = await scaledDecoder.decode();
  console.log(`  Original: 200x150`);
  console.log(`  Scaled: ${scaledResult.image.codedWidth}x${scaledResult.image.codedHeight}`);
  scaledResult.image.close();
  scaledDecoder.close();
  console.log('  SUCCESS');

  console.log('\n\nDemo complete!');
}

main().catch(console.error);

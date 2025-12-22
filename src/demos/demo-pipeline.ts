/**
 * Demo: Direct encoding/decoding pipeline
 *
 * This demo shows a more practical use case: piping frames through
 * an encode/decode cycle without storing intermediate chunks.
 */

import { spawn } from 'child_process';

async function main() {
  console.log('WebCodecs Pipeline Demo');
  console.log('=======================\n');

  const width = 320;
  const height = 240;
  const frameCount = 30;
  const framerate = 30;
  const frameSize = width * height * 4; // RGBA

  // Spawn encoder
  const encoder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(framerate),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-f', 'h264',
    'pipe:1'
  ]);

  // Spawn decoder
  const decoder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'h264',
    '-i', 'pipe:0',
    '-vsync', 'passthrough',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    'pipe:1'
  ]);

  // Pipe encoder output to decoder input
  encoder.stdout.pipe(decoder.stdin);

  // Track decoded frames
  let decodedFrameCount = 0;
  let buffer = Buffer.alloc(0);

  decoder.stdout.on('data', (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= frameSize) {
      decodedFrameCount++;
      const timestamp = ((decodedFrameCount - 1) * 1_000_000) / framerate;
      console.log(`Decoded frame ${decodedFrameCount}: ${width}x${height}, timestamp=${timestamp}µs`);
      buffer = buffer.subarray(frameSize);
    }
  });

  encoder.stderr.on('data', (d) => console.error('Encoder:', d.toString()));
  decoder.stderr.on('data', (d) => console.error('Decoder:', d.toString()));

  console.log(`Encoding ${frameCount} frames...`);

  // Generate and encode frames
  for (let i = 0; i < frameCount; i++) {
    const frameData = Buffer.alloc(frameSize);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        frameData[idx] = (x + i * 10) % 256;     // R
        frameData[idx + 1] = (y + i * 5) % 256;  // G
        frameData[idx + 2] = (i * 8) % 256;      // B
        frameData[idx + 3] = 255;                // A
      }
    }
    encoder.stdin.write(frameData);
  }

  encoder.stdin.end();

  // Wait for completion
  await new Promise<void>((resolve) => {
    decoder.on('close', () => {
      console.log(`\n=== Results ===`);
      console.log(`Input frames:  ${frameCount}`);
      console.log(`Output frames: ${decodedFrameCount}`);
      console.log(`Match: ${frameCount === decodedFrameCount ? 'YES ✓' : 'NO ✗'}`);
      resolve();
    });
  });
}

main().catch(console.error);

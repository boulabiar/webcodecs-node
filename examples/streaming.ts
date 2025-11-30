/**
 * Streaming Example
 *
 * Demonstrates real-time encoding with latencyMode comparison.
 *
 * Run: npx tsx examples/streaming.ts
 */

import { VideoEncoder, VideoFrame, EncodedVideoChunk } from '../src/index.js';

interface EncodingResult {
  mode: string;
  chunks: number;
  totalBytes: number;
  keyFrames: number;
  encodeTime: number;
}

async function encodeWithMode(
  mode: 'quality' | 'realtime',
  width: number,
  height: number,
  frameCount: number,
  framerate: number
): Promise<EncodingResult> {
  const chunks: EncodedVideoChunk[] = [];
  const startTime = Date.now();

  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: console.error,
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 1_000_000,
    framerate,
    latencyMode: mode,
  });

  // Generate frames
  for (let i = 0; i < frameCount; i++) {
    const rgba = new Uint8Array(width * height * 4);

    // Create moving pattern for realistic encoding
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = ((x + i * 10) % 256); // R
        rgba[idx + 1] = ((y + i * 5) % 256); // G
        rgba[idx + 2] = (((x + y) / 2 + i * 3) % 256); // B
        rgba[idx + 3] = 255; // A
      }
    }

    const frame = new VideoFrame(rgba, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: (i * 1_000_000) / framerate,
    });

    encoder.encode(frame, { keyFrame: i % framerate === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  const encodeTime = Date.now() - startTime;

  return {
    mode,
    chunks: chunks.length,
    totalBytes: chunks.reduce((sum, c) => sum + c.byteLength, 0),
    keyFrames: chunks.filter((c) => c.type === 'key').length,
    encodeTime,
  };
}

async function main() {
  console.log('=== Streaming / Latency Mode Comparison ===\n');

  const width = 640;
  const height = 480;
  const frameCount = 60;
  const framerate = 30;

  console.log(`Encoding ${frameCount} frames at ${width}x${height} @ ${framerate}fps\n`);

  // Test quality mode
  console.log('Testing quality mode...');
  const qualityResult = await encodeWithMode('quality', width, height, frameCount, framerate);

  // Test realtime mode
  console.log('Testing realtime mode...');
  const realtimeResult = await encodeWithMode('realtime', width, height, frameCount, framerate);

  // Display results
  console.log('\n=== Results ===\n');

  console.log('Quality Mode (optimized for compression):');
  console.log(`  Encode time: ${qualityResult.encodeTime}ms`);
  console.log(`  Output size: ${(qualityResult.totalBytes / 1024).toFixed(2)} KB`);
  console.log(`  Chunks: ${qualityResult.chunks}`);
  console.log(`  Key frames: ${qualityResult.keyFrames}`);
  console.log(
    `  Bitrate: ${((qualityResult.totalBytes * 8 * framerate) / frameCount / 1000).toFixed(0)} kbps`
  );

  console.log('\nRealtime Mode (optimized for low latency):');
  console.log(`  Encode time: ${realtimeResult.encodeTime}ms`);
  console.log(`  Output size: ${(realtimeResult.totalBytes / 1024).toFixed(2)} KB`);
  console.log(`  Chunks: ${realtimeResult.chunks}`);
  console.log(`  Key frames: ${realtimeResult.keyFrames}`);
  console.log(
    `  Bitrate: ${((realtimeResult.totalBytes * 8 * framerate) / frameCount / 1000).toFixed(0)} kbps`
  );

  console.log('\n=== Comparison ===\n');

  const sizeDiff =
    ((realtimeResult.totalBytes - qualityResult.totalBytes) / qualityResult.totalBytes) * 100;
  const timeDiff =
    ((realtimeResult.encodeTime - qualityResult.encodeTime) / qualityResult.encodeTime) * 100;

  console.log(
    `Size difference: ${sizeDiff > 0 ? '+' : ''}${sizeDiff.toFixed(1)}% ` +
      `(realtime uses ${sizeDiff > 0 ? 'more' : 'less'} space)`
  );
  console.log(
    `Time difference: ${timeDiff > 0 ? '+' : ''}${timeDiff.toFixed(1)}% ` +
      `(realtime is ${timeDiff < 0 ? 'faster' : 'slower'})`
  );

  console.log('\n=== When to use each mode ===\n');
  console.log('Quality mode:');
  console.log('  - File encoding for storage/distribution');
  console.log('  - VOD (Video on Demand) content');
  console.log('  - When file size matters more than latency');

  console.log('\nRealtime mode:');
  console.log('  - Live streaming');
  console.log('  - Video conferencing');
  console.log('  - Real-time screen sharing');
  console.log('  - When latency matters more than compression');
}

main().catch(console.error);

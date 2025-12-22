/**
 * Hardware Accelerated Video Encoding Example
 *
 * Demonstrates GPU-accelerated encoding with VAAPI, NVENC, or QSV.
 *
 * Run: npx tsx examples/hardware-encoding.ts
 */

import { VideoEncoder, VideoFrame, EncodedVideoChunk } from '../src/index.js';
import {
  detectHardwareAcceleration,
  getHardwareAccelerationSummary,
  getBestEncoder,
} from '../src/index.js';

interface BenchmarkResult {
  mode: string;
  encoder: string;
  encodeTime: number;
  totalBytes: number;
  fps: number;
}

async function benchmark(
  width: number,
  height: number,
  frameCount: number,
  framerate: number,
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software'
): Promise<BenchmarkResult> {
  const chunks: EncodedVideoChunk[] = [];

  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: console.error,
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 5_000_000,
    framerate,
    hardwareAcceleration,
  });

  // Pre-generate all frame data to exclude from timing
  const frames: Uint8Array[] = [];
  for (let i = 0; i < frameCount; i++) {
    const rgba = new Uint8Array(width * height * 4);
    // Create complex pattern for realistic encoding load
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Animated noise pattern
        rgba[idx] = (x * y + i * 17) % 256;
        rgba[idx + 1] = (x + y * 2 + i * 23) % 256;
        rgba[idx + 2] = ((x - y) * 3 + i * 31) % 256;
        rgba[idx + 3] = 255;
      }
    }
    frames.push(rgba);
  }

  // Time the encoding
  const startTime = Date.now();

  for (let i = 0; i < frameCount; i++) {
    const frame = new VideoFrame(frames[i], {
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
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);

  return {
    mode: hardwareAcceleration,
    encoder: hardwareAcceleration === 'prefer-hardware' ? 'GPU (if available)' : 'CPU',
    encodeTime,
    totalBytes,
    fps: (frameCount * 1000) / encodeTime,
  };
}

async function main() {
  console.log('=== Hardware Accelerated Video Encoding ===\n');

  // Detect available hardware acceleration
  console.log('Detecting hardware acceleration...\n');

  const summary = await getHardwareAccelerationSummary();
  console.log(summary);
  console.log('');

  // Get detailed capabilities
  const capabilities = await detectHardwareAcceleration();

  if (capabilities.methods.length > 0) {
    console.log('Available acceleration methods:');
    for (const method of capabilities.methods) {
      console.log(`  - ${method}`);
    }
    console.log('');
  }

  if (capabilities.encoders.length > 0) {
    console.log('Hardware encoders:');
    for (const enc of capabilities.encoders) {
      console.log(`  - ${enc}`);
    }
    console.log('');
  }

  // Get best encoder for H.264
  console.log('Finding best H.264 encoder...');
  const bestH264 = await getBestEncoder('h264', 'prefer-hardware');
  console.log(`  Best encoder: ${bestH264.encoder}`);
  console.log(`  Hardware: ${bestH264.isHardware}`);
  console.log('');

  // Benchmark parameters
  const width = 1280;
  const height = 720;
  const frameCount = 60;
  const framerate = 30;

  console.log(`\nBenchmarking ${width}x${height} @ ${framerate}fps (${frameCount} frames)...\n`);

  // Benchmark software encoding
  console.log('Testing software encoding...');
  const softwareResult = await benchmark(
    width,
    height,
    frameCount,
    framerate,
    'prefer-software'
  );

  // Benchmark hardware encoding
  console.log('Testing hardware encoding...');
  const hardwareResult = await benchmark(
    width,
    height,
    frameCount,
    framerate,
    'prefer-hardware'
  );

  // Display results
  console.log('\n=== Benchmark Results ===\n');

  console.log('Software Encoding (CPU):');
  console.log(`  Encode time: ${softwareResult.encodeTime}ms`);
  console.log(`  Throughput: ${softwareResult.fps.toFixed(1)} fps`);
  console.log(`  Output size: ${(softwareResult.totalBytes / 1024).toFixed(2)} KB`);
  console.log(
    `  Bitrate: ${((softwareResult.totalBytes * 8 * framerate) / frameCount / 1000).toFixed(0)} kbps`
  );

  console.log('\nHardware Encoding (GPU):');
  console.log(`  Encode time: ${hardwareResult.encodeTime}ms`);
  console.log(`  Throughput: ${hardwareResult.fps.toFixed(1)} fps`);
  console.log(`  Output size: ${(hardwareResult.totalBytes / 1024).toFixed(2)} KB`);
  console.log(
    `  Bitrate: ${((hardwareResult.totalBytes * 8 * framerate) / frameCount / 1000).toFixed(0)} kbps`
  );

  // Comparison
  console.log('\n=== Comparison ===\n');

  const speedup = softwareResult.encodeTime / hardwareResult.encodeTime;
  const sizeRatio = hardwareResult.totalBytes / softwareResult.totalBytes;

  if (speedup > 1.1) {
    console.log(`Hardware encoding is ${speedup.toFixed(2)}x faster`);
  } else if (speedup < 0.9) {
    console.log(`Software encoding is ${(1 / speedup).toFixed(2)}x faster`);
    console.log('(Hardware acceleration may not be available or configured)');
  } else {
    console.log('Performance is similar (hardware may not be available)');
  }

  console.log(
    `File size difference: ${((sizeRatio - 1) * 100).toFixed(1)}% ` +
      `(${sizeRatio > 1 ? 'larger' : 'smaller'} with hardware)`
  );

  // Usage recommendations
  console.log('\n=== When to Use Hardware Acceleration ===\n');

  console.log('Use prefer-hardware when:');
  console.log('  - Encoding HD/4K video');
  console.log('  - Real-time streaming');
  console.log('  - Batch processing many videos');
  console.log('  - CPU resources are constrained');

  console.log('\nUse prefer-software when:');
  console.log('  - Maximum compression quality needed');
  console.log('  - Archival purposes');
  console.log('  - No compatible GPU available');
  console.log('  - Encoding small/low-res content');

  // Example configuration
  console.log('\n=== Example Configuration ===\n');
  console.log(`const encoder = new VideoEncoder({
  output: handleChunk,
  error: handleError,
});

encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  framerate: 30,
  hardwareAcceleration: 'prefer-hardware',
  latencyMode: 'realtime', // Combine with low-latency for streaming
});`);
}

main().catch(console.error);

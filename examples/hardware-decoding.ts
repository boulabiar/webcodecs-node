/**
 * Hardware Accelerated Video Decoding Example
 *
 * Demonstrates GPU-accelerated decoding with VAAPI, NVDEC, or QSV.
 *
 * Run: npx tsx examples/hardware-decoding.ts
 */

import {
  VideoEncoder,
  VideoDecoder,
  VideoFrame,
  EncodedVideoChunk,
} from '../src/index.js';
import {
  detectHardwareAcceleration,
  getHardwareAccelerationSummary,
} from '../src/index.js';

interface BenchmarkResult {
  mode: string;
  decodeTime: number;
  framesDecoded: number;
  fps: number;
}

async function createTestChunks(
  width: number,
  height: number,
  frameCount: number,
  framerate: number
): Promise<EncodedVideoChunk[]> {
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
  });

  // Generate complex frames for realistic decoding load
  for (let i = 0; i < frameCount; i++) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = (x * y + i * 17) % 256;
        rgba[idx + 1] = (x + y * 2 + i * 23) % 256;
        rgba[idx + 2] = ((x - y) * 3 + i * 31) % 256;
        rgba[idx + 3] = 255;
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

  return chunks;
}

async function benchmarkDecode(
  chunks: EncodedVideoChunk[],
  width: number,
  height: number,
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software'
): Promise<BenchmarkResult> {
  let framesDecoded = 0;

  const decoder = new VideoDecoder({
    output: (frame) => {
      framesDecoded++;
      frame.close();
    },
    error: console.error,
  });

  decoder.configure({
    codec: 'avc1.42001E',
    codedWidth: width,
    codedHeight: height,
    hardwareAcceleration,
  });

  const startTime = Date.now();

  for (const chunk of chunks) {
    decoder.decode(chunk);
  }

  await decoder.flush();
  decoder.close();

  const decodeTime = Date.now() - startTime;

  return {
    mode: hardwareAcceleration,
    decodeTime,
    framesDecoded,
    fps: (framesDecoded * 1000) / decodeTime,
  };
}

async function main() {
  console.log('=== Hardware Accelerated Video Decoding ===\n');

  // Detect available hardware acceleration
  console.log('Detecting hardware acceleration...\n');

  const summary = await getHardwareAccelerationSummary();
  console.log(summary);
  console.log('');

  // Get detailed capabilities
  const capabilities = await detectHardwareAcceleration();

  if (capabilities.decoders.length > 0) {
    console.log('Hardware decoders:');
    for (const dec of capabilities.decoders) {
      console.log(`  - ${dec}`);
    }
    console.log('');
  } else {
    console.log('No hardware decoders detected.\n');
  }

  // Benchmark parameters
  const width = 1280;
  const height = 720;
  const frameCount = 120;
  const framerate = 30;

  console.log(`Creating ${frameCount} test frames at ${width}x${height}...`);
  const chunks = await createTestChunks(width, height, frameCount, framerate);
  console.log(`Created ${chunks.length} encoded chunks\n`);

  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  console.log(`Total encoded size: ${(totalBytes / 1024).toFixed(2)} KB`);
  console.log(`Average chunk size: ${(totalBytes / chunks.length).toFixed(0)} bytes\n`);

  // Benchmark software decoding
  console.log('Testing software decoding...');
  const softwareResult = await benchmarkDecode(chunks, width, height, 'prefer-software');

  // Benchmark hardware decoding
  console.log('Testing hardware decoding...');
  const hardwareResult = await benchmarkDecode(chunks, width, height, 'prefer-hardware');

  // Display results
  console.log('\n=== Benchmark Results ===\n');

  console.log('Software Decoding (CPU):');
  console.log(`  Decode time: ${softwareResult.decodeTime}ms`);
  console.log(`  Frames decoded: ${softwareResult.framesDecoded}`);
  console.log(`  Throughput: ${softwareResult.fps.toFixed(1)} fps`);
  console.log(`  Real-time capable: ${softwareResult.fps >= framerate ? 'Yes' : 'No'}`);

  console.log('\nHardware Decoding (GPU):');
  console.log(`  Decode time: ${hardwareResult.decodeTime}ms`);
  console.log(`  Frames decoded: ${hardwareResult.framesDecoded}`);
  console.log(`  Throughput: ${hardwareResult.fps.toFixed(1)} fps`);
  console.log(`  Real-time capable: ${hardwareResult.fps >= framerate ? 'Yes' : 'No'}`);

  // Comparison
  console.log('\n=== Comparison ===\n');

  const speedup = softwareResult.decodeTime / hardwareResult.decodeTime;

  if (speedup > 1.1) {
    console.log(`Hardware decoding is ${speedup.toFixed(2)}x faster`);
  } else if (speedup < 0.9) {
    console.log(`Software decoding is ${(1 / speedup).toFixed(2)}x faster`);
    console.log('(Hardware acceleration may not be available or configured)');
  } else {
    console.log('Performance is similar (hardware may not be available)');
  }

  // Calculate how many streams could be decoded in real-time
  const softwareStreams = Math.floor(softwareResult.fps / framerate);
  const hardwareStreams = Math.floor(hardwareResult.fps / framerate);

  console.log(`\nConcurrent streams (real-time @ ${framerate}fps):`);
  console.log(`  Software: ${softwareStreams} stream${softwareStreams !== 1 ? 's' : ''}`);
  console.log(`  Hardware: ${hardwareStreams} stream${hardwareStreams !== 1 ? 's' : ''}`);

  // Usage recommendations
  console.log('\n=== When to Use Hardware Decoding ===\n');

  console.log('Use prefer-hardware when:');
  console.log('  - Decoding HD/4K video');
  console.log('  - Multiple simultaneous streams');
  console.log('  - Real-time playback');
  console.log('  - Transcoding pipelines');
  console.log('  - CPU resources are constrained');

  console.log('\nUse prefer-software when:');
  console.log('  - Maximum compatibility needed');
  console.log('  - No compatible GPU available');
  console.log('  - Decoding unusual/rare codecs');
  console.log('  - Frame-accurate seeking required');

  // Example configuration
  console.log('\n=== Example Configuration ===\n');
  console.log(`const decoder = new VideoDecoder({
  output: (frame) => {
    // Process decoded frame
    processFrame(frame);
    frame.close();
  },
  error: handleError,
});

decoder.configure({
  codec: 'avc1.42001E',
  codedWidth: 1920,
  codedHeight: 1080,
  hardwareAcceleration: 'prefer-hardware',
});

// Decode chunks
for (const chunk of encodedChunks) {
  decoder.decode(chunk);
}

await decoder.flush();
decoder.close();`);
}

main().catch(console.error);

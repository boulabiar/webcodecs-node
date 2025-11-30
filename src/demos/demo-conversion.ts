/**
 * Demo: Real File Conversion with Mediabunny + WebCodecs
 *
 * This demo shows how to:
 * 1. Use WebCodecs API (VideoEncoder, AudioEncoder, etc.) with Mediabunny
 * 2. Convert MP4 to WebM with progress tracking
 * 3. Handle video resizing, codec conversion, and audio transcoding
 *
 * The WebCodecs polyfill makes VideoFrame, AudioData, EncodedVideoChunk, etc.
 * available globally, so Mediabunny uses our FFmpeg-backed implementations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ReadableStream, WritableStream, TransformStream } from 'stream/web';

// Polyfill Web Streams for Node.js < 18.x or environments without them
if (typeof globalThis.WritableStream === 'undefined') {
  (globalThis as typeof globalThis & { WritableStream: typeof WritableStream }).WritableStream = WritableStream;
}
if (typeof globalThis.ReadableStream === 'undefined') {
  (globalThis as typeof globalThis & { ReadableStream: typeof ReadableStream }).ReadableStream = ReadableStream;
}
if (typeof globalThis.TransformStream === 'undefined') {
  (globalThis as typeof globalThis & { TransformStream: typeof TransformStream }).TransformStream = TransformStream;
}

// Install WebCodecs polyfill - this provides VideoFrame, AudioData, EncodedVideoChunk, etc.
// Mediabunny will use these global classes for encoding/decoding
// The side-effect import ensures auto-install happens before any other imports
import '../polyfill.js';

// Mediabunny imports
import {
  Input,
  Output,
  Conversion,
  FilePathSource,
  FilePathTarget,
  MP4,
  Mp4OutputFormat,
  WebMOutputFormat,
  ALL_FORMATS,
} from 'mediabunny';

// Register our FFmpeg-based encoders/decoders
import { registerFFmpegCoders } from '../mediabunny/index.js';

// Register FFmpeg coders before using Mediabunny
registerFFmpegCoders();

const testDir = '/tmp/webcodecs-test-conversion';

/**
 * Create a sample video file for testing
 */
async function createSampleVideo(): Promise<string> {
  // Create test directory
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const inputPath = path.join(testDir, 'sample.mp4');

  console.log('Creating sample video...');

  // Create a 5-second test video with testsrc and sine wave audio
  // 640x480, 30fps, H.264 video + AAC audio
  execSync(
    `ffmpeg -y ` +
      `-f lavfi -i "testsrc=duration=5:size=640x480:rate=30" ` +
      `-f lavfi -i "sine=frequency=440:duration=5" ` +
      `-c:v libx264 -preset ultrafast -c:a aac -b:a 128k ` +
      `-pix_fmt yuv420p ` +
      `"${inputPath}" 2>/dev/null`
  );

  const stats = fs.statSync(inputPath);
  console.log(`  Created: ${inputPath}`);
  console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`);

  return inputPath;
}

/**
 * Get file info using ffprobe
 */
function getFileInfo(filePath: string): {
  duration: number;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
} {
  const output = execSync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
    { encoding: 'utf-8' }
  );

  const info = JSON.parse(output);
  const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
  const audioStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');

  return {
    duration: parseFloat(info.format?.duration || '0'),
    videoCodec: videoStream?.codec_name || 'unknown',
    audioCodec: audioStream?.codec_name || 'unknown',
    width: videoStream?.width || 0,
    height: videoStream?.height || 0,
  };
}

/**
 * Demo 1: Basic MP4 to WebM conversion
 */
async function demo1_BasicConversion(inputPath: string): Promise<void> {
  console.log('\n=== Demo 1: Basic MP4 to WebM Conversion ===\n');

  const outputPath = path.join(testDir, 'output_basic.webm');

  // Create input from file
  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource(inputPath),
  });

  // Create output with WebM format
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new FilePathTarget(outputPath),
  });

  // Initialize conversion
  const conversion = await Conversion.init({
    input,
    output,
    showWarnings: false,
  });

  console.log('Conversion initialized:');
  console.log(`  Is valid: ${conversion.isValid}`);
  console.log(`  Utilized tracks: ${conversion.utilizedTracks.length}`);
  console.log(`  Discarded tracks: ${conversion.discardedTracks.length}`);

  if (conversion.discardedTracks.length > 0) {
    for (const { track, reason } of conversion.discardedTracks) {
      console.log(`    - ${track.type}: ${reason}`);
    }
  }

  // Add progress tracking
  let lastProgress = 0;
  conversion.onProgress = (progress) => {
    const percent = Math.floor(progress * 100);
    if (percent > lastProgress) {
      process.stdout.write(`\r  Converting: ${percent}%`);
      lastProgress = percent;
    }
  };

  // Execute conversion
  console.log('  Converting: 0%');
  await conversion.execute();
  console.log('\n  Done!');

  // Verify output
  const inputInfo = getFileInfo(inputPath);
  const outputInfo = getFileInfo(outputPath);

  console.log('\n  Input file:');
  console.log(`    Codec: ${inputInfo.videoCodec}/${inputInfo.audioCodec}`);
  console.log(`    Size: ${inputInfo.width}x${inputInfo.height}`);
  console.log(`    Duration: ${inputInfo.duration.toFixed(2)}s`);

  console.log('\n  Output file:');
  console.log(`    Codec: ${outputInfo.videoCodec}/${outputInfo.audioCodec}`);
  console.log(`    Size: ${outputInfo.width}x${outputInfo.height}`);
  console.log(`    Duration: ${outputInfo.duration.toFixed(2)}s`);

  const outputStats = fs.statSync(outputPath);
  console.log(`    File size: ${(outputStats.size / 1024).toFixed(1)} KB`);

  // Clean up
  input.dispose();
}

/**
 * Demo 2: Conversion with resizing (using OffscreenCanvas polyfill)
 */
async function demo2_ResizedConversion(inputPath: string): Promise<void> {
  console.log('\n=== Demo 2: Conversion with Resizing (640x480 -> 320x240) ===\n');

  const outputPath = path.join(testDir, 'output_resized.webm');

  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource(inputPath),
  });

  const output = new Output({
    format: new WebMOutputFormat(),
    target: new FilePathTarget(outputPath),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      width: 320,
      height: 240,
      fit: 'fill',
    },
    showWarnings: false,
  });

  console.log(`  Is valid: ${conversion.isValid}`);
  console.log(`  Utilized tracks: ${conversion.utilizedTracks.length}`);

  // Progress tracking
  let lastProgress = 0;
  conversion.onProgress = (progress) => {
    const percent = Math.floor(progress * 100);
    if (percent > lastProgress) {
      process.stdout.write(`\r  Converting: ${percent}%`);
      lastProgress = percent;
    }
  };

  console.log('  Converting: 0%');
  await conversion.execute();
  console.log('\n  Done!');

  // Verify output
  const outputInfo = getFileInfo(outputPath);
  console.log(`\n  Output size: ${outputInfo.width}x${outputInfo.height}`);
  console.log(`  Duration: ${outputInfo.duration.toFixed(2)}s`);

  const outputStats = fs.statSync(outputPath);
  console.log(`  File size: ${(outputStats.size / 1024).toFixed(1)} KB`);

  input.dispose();
}

/**
 * Demo 3: Conversion with trimming
 */
async function demo3_TrimmedConversion(inputPath: string): Promise<void> {
  console.log('\n=== Demo 3: Conversion with Trimming (1s to 3s) ===\n');

  const outputPath = path.join(testDir, 'output_trimmed.webm');

  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource(inputPath),
  });

  const output = new Output({
    format: new WebMOutputFormat(),
    target: new FilePathTarget(outputPath),
  });

  const conversion = await Conversion.init({
    input,
    output,
    trim: {
      start: 1, // Start at 1 second
      end: 3, // End at 3 seconds
    },
    showWarnings: false,
  });

  console.log(`  Is valid: ${conversion.isValid}`);

  // Progress tracking
  let lastProgress = 0;
  conversion.onProgress = (progress) => {
    const percent = Math.floor(progress * 100);
    if (percent > lastProgress) {
      process.stdout.write(`\r  Converting: ${percent}%`);
      lastProgress = percent;
    }
  };

  console.log('  Converting: 0%');
  await conversion.execute();
  console.log('\n  Done!');

  // Verify output
  const outputInfo = getFileInfo(outputPath);
  console.log(`\n  Output duration: ${outputInfo.duration.toFixed(2)}s (expected ~2s)`);

  const outputStats = fs.statSync(outputPath);
  console.log(`  File size: ${(outputStats.size / 1024).toFixed(1)} KB`);

  input.dispose();
}

/**
 * Demo 4: Audio-only extraction
 */
async function demo4_AudioOnlyConversion(inputPath: string): Promise<void> {
  console.log('\n=== Demo 4: Audio-Only Extraction ===\n');

  const outputPath = path.join(testDir, 'output_audio.webm');

  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource(inputPath),
  });

  const output = new Output({
    format: new WebMOutputFormat(),
    target: new FilePathTarget(outputPath),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      discard: true, // Discard video track
    },
    showWarnings: false,
  });

  console.log(`  Is valid: ${conversion.isValid}`);
  console.log(`  Utilized tracks: ${conversion.utilizedTracks.length}`);

  // Progress tracking
  let lastProgress = 0;
  conversion.onProgress = (progress) => {
    const percent = Math.floor(progress * 100);
    if (percent > lastProgress) {
      process.stdout.write(`\r  Converting: ${percent}%`);
      lastProgress = percent;
    }
  };

  console.log('  Converting: 0%');
  await conversion.execute();
  console.log('\n  Done!');

  // Verify output
  const outputInfo = getFileInfo(outputPath);
  console.log(`\n  Audio codec: ${outputInfo.audioCodec}`);
  console.log(`  Duration: ${outputInfo.duration.toFixed(2)}s`);

  const outputStats = fs.statSync(outputPath);
  console.log(`  File size: ${(outputStats.size / 1024).toFixed(1)} KB`);

  input.dispose();
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     Mediabunny + FFmpeg Real File Conversion Demo             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('This demo uses the WebCodecs FFmpeg backend with Mediabunny');
  console.log('to perform real file conversions.\n');

  try {
    // Create sample video
    const inputPath = await createSampleVideo();

    // Run demos
    await demo1_BasicConversion(inputPath);
    await demo2_ResizedConversion(inputPath);
    await demo3_TrimmedConversion(inputPath);
    await demo4_AudioOnlyConversion(inputPath);

    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    All demos completed!                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    console.log('Output files:');
    console.log(`  ${testDir}/output_basic.webm`);
    console.log(`  ${testDir}/output_resized.webm`);
    console.log(`  ${testDir}/output_trimmed.webm`);
    console.log(`  ${testDir}/output_audio.webm`);
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main().catch(console.error);

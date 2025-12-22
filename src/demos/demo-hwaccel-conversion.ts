/**
 * Hardware Acceleration Conversion Demo
 *
 * Tests video conversion with VAAPI hardware acceleration enabled.
 * Uses H.264 codec which is well-supported by Intel VAAPI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ReadableStream, WritableStream, TransformStream } from 'stream/web';

// Polyfill Web Streams
if (typeof globalThis.WritableStream === 'undefined') {
  (globalThis as any).WritableStream = WritableStream;
}
if (typeof globalThis.ReadableStream === 'undefined') {
  (globalThis as any).ReadableStream = ReadableStream;
}
if (typeof globalThis.TransformStream === 'undefined') {
  (globalThis as any).TransformStream = TransformStream;
}

// Install WebCodecs polyfill
import '../polyfill.js';

import {
  Input,
  Output,
  Conversion,
  FilePathSource,
  FilePathTarget,
  Mp4OutputFormat,
  ALL_FORMATS,
  registerEncoder,
  registerDecoder,
} from 'mediabunny';

import { FFmpegVideoEncoder } from '../mediabunny/FFmpegVideoEncoder.js';
import { FFmpegVideoDecoder } from '../mediabunny/FFmpegVideoDecoder.js';
import { FFmpegAudioEncoder } from '../mediabunny/FFmpegAudioEncoder.js';
import { FFmpegAudioDecoder } from '../mediabunny/FFmpegAudioDecoder.js';

import { getHardwareAccelerationSummary, getBestEncoder, testEncoder } from '../HardwareAcceleration.js';

const OUTPUT_DIR = '/tmp/webcodecs-test-hwaccel';

// Custom encoder that forces hardware acceleration
class HardwareVideoEncoder extends FFmpegVideoEncoder {
  async init(): Promise<void> {
    (this.config as any).hardwareAcceleration = 'prefer-hardware';
    return super.init();
  }
}

// Custom encoder that forces software
class SoftwareVideoEncoder extends FFmpegVideoEncoder {
  async init(): Promise<void> {
    (this.config as any).hardwareAcceleration = 'prefer-software';
    return super.init();
  }
}

async function createSampleVideo(): Promise<string> {
  const outputPath = path.join(OUTPUT_DIR, 'sample.mp4');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Create a 5-second test video with FFmpeg (longer for better timing comparison)
  execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=5:size=1280x720:rate=30" -f lavfi -i "sine=frequency=440:duration=5" -c:v libx264 -preset ultrafast -c:a aac -pix_fmt yuv420p "${outputPath}" 2>/dev/null`);

  return outputPath;
}

function getFileInfo(filePath: string): { duration: number; size: number } {
  const probe = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}" 2>/dev/null`
  ).toString().trim();
  const size = fs.statSync(filePath).size;
  return {
    duration: parseFloat(probe),
    size,
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║      Hardware vs Software Encoding Comparison Demo            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Show hardware acceleration info
  const summary = await getHardwareAccelerationSummary();
  console.log(summary);
  console.log('');

  // Check what encoders will be used and test them
  console.log('Testing encoder availability:');
  for (const codec of ['h264', 'hevc', 'vp8', 'vp9'] as const) {
    const best = await getBestEncoder(codec, 'prefer-hardware');
    const works = best.isHardware ? await testEncoder(best.encoder) : true;
    const status = best.isHardware ? (works ? '✓ HW' : '✗ HW (failed)') : '○ SW';
    console.log(`  ${codec.toUpperCase()}: ${status} ${best.encoder}`);
  }
  console.log('');

  // Create sample video (1280x720, 5 seconds)
  console.log('Creating sample video (1280x720, 5 seconds)...');
  const inputPath = await createSampleVideo();
  const inputInfo = getFileInfo(inputPath);
  console.log(`  Input: ${inputPath} (${(inputInfo.size / 1024).toFixed(1)} KB)\n`);

  // Register audio encoders/decoders (these don't have HW acceleration)
  registerEncoder(FFmpegAudioEncoder);
  registerDecoder(FFmpegAudioDecoder);
  registerDecoder(FFmpegVideoDecoder);

  // Test with hardware acceleration (H.264 VAAPI)
  console.log('=== Converting with Hardware Acceleration (H.264 VAAPI) ===\n');
  registerEncoder(HardwareVideoEncoder);

  try {
    const hwOutput = path.join(OUTPUT_DIR, 'output_hardware.mp4');
    const startTime = Date.now();

    const input = new Input({
      formats: ALL_FORMATS,
      source: new FilePathSource(inputPath),
    });

    // MP4 with H.264 - well supported by VAAPI
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new FilePathTarget(hwOutput),
    });

    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
    });

    await conversion.execute();
    const endTime = Date.now();
    const info = getFileInfo(hwOutput);

    console.log(`  Output: ${hwOutput}`);
    console.log(`  Duration: ${info.duration.toFixed(2)}s`);
    console.log(`  File size: ${(info.size / 1024).toFixed(1)} KB`);
    console.log(`  Encoding time: ${endTime - startTime}ms`);
  } catch (err) {
    console.log(`  Error: ${(err as Error).message}`);
  }

  console.log('');

  // Test with software encoding (H.264 libx264)
  console.log('=== Converting with Software Encoding (H.264 libx264) ===\n');
  registerEncoder(SoftwareVideoEncoder);

  try {
    const swOutput = path.join(OUTPUT_DIR, 'output_software.mp4');
    const startTime = Date.now();

    const input = new Input({
      formats: ALL_FORMATS,
      source: new FilePathSource(inputPath),
    });

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new FilePathTarget(swOutput),
    });

    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
    });

    await conversion.execute();
    const endTime = Date.now();
    const info = getFileInfo(swOutput);

    console.log(`  Output: ${swOutput}`);
    console.log(`  Duration: ${info.duration.toFixed(2)}s`);
    console.log(`  File size: ${(info.size / 1024).toFixed(1)} KB`);
    console.log(`  Encoding time: ${endTime - startTime}ms`);
  } catch (err) {
    console.log(`  Error: ${(err as Error).message}`);
  }

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Demo Complete!                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Summary
  console.log('Note: Intel VAAPI typically supports:');
  console.log('  - H.264 encoding ✓');
  console.log('  - HEVC encoding ✓');
  console.log('  - VP8 encoding ✓');
  console.log('  - VP9 decoding only (no encoding)');
  console.log('');
}

main().catch(console.error);

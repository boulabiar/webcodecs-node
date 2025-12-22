/**
 * Demo: Standalone WebCodecs API Usage
 *
 * This demo shows how to use the WebCodecs API directly (without Mediabunny)
 * for encoding and decoding video/audio in Node.js.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Import WebCodecs classes
import {
  VideoFrame,
  VideoEncoder,
  VideoDecoder,
  EncodedVideoChunk,
  AudioData,
  AudioEncoder,
  AudioDecoder,
  EncodedAudioChunk,
} from '../index.js';

const testDir = '/tmp/webcodecs-test';

/**
 * Demo 1: VideoEncoder - Encode raw frames to H.264
 */
async function demo1_VideoEncoder(): Promise<void> {
  console.log('\n=== Demo 1: VideoEncoder (Raw Frames → H.264) ===\n');

  const width = 320;
  const height = 240;
  const frameCount = 30;
  const encodedChunks: EncodedVideoChunk[] = [];

  // Check if H.264 is supported
  const support = await VideoEncoder.isConfigSupported({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 1_000_000,
  });
  console.log(`  H.264 encoding supported: ${support.supported}`);

  if (!support.supported) {
    console.log('  Skipping - H.264 not supported');
    return;
  }

  // Create encoder
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      encodedChunks.push(chunk);
      if (metadata?.decoderConfig) {
        console.log(`  Received decoder config: ${metadata.decoderConfig.codec}`);
      }
    },
    error: (err) => {
      console.error('  Encoder error:', err);
    },
  });

  // Configure encoder
  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 1_000_000,
    framerate: 30,
  });

  console.log(`  Encoder state: ${encoder.state}`);
  console.log(`  Encoding ${frameCount} frames...`);

  // Generate and encode test frames (gradient pattern)
  for (let i = 0; i < frameCount; i++) {
    const frameData = generateTestFrame(width, height, i);
    const frame = new VideoFrame(frameData, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: i * (1_000_000 / 30), // microseconds
      duration: 1_000_000 / 30,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  // Wait for encoding to complete
  await encoder.flush();
  encoder.close();

  console.log(`  Encoded ${encodedChunks.length} chunks`);
  const totalBytes = encodedChunks.reduce((sum, c) => sum + c.byteLength, 0);
  console.log(`  Total encoded size: ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`  Key frames: ${encodedChunks.filter(c => c.type === 'key').length}`);
}

/**
 * Demo 2: AudioEncoder - Encode PCM to Opus
 */
async function demo2_AudioEncoder(): Promise<void> {
  console.log('\n=== Demo 2: AudioEncoder (PCM → Opus) ===\n');

  const sampleRate = 48000;
  const channels = 2;
  const duration = 1; // seconds
  const encodedChunks: EncodedAudioChunk[] = [];

  // Check if Opus is supported
  const support = await AudioEncoder.isConfigSupported({
    codec: 'opus',
    sampleRate,
    numberOfChannels: channels,
    bitrate: 128000,
  });
  console.log(`  Opus encoding supported: ${support.supported}`);

  if (!support.supported) {
    console.log('  Skipping - Opus not supported');
    return;
  }

  // Create encoder
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      encodedChunks.push(chunk);
      if (metadata?.decoderConfig) {
        console.log(`  Received decoder config: ${metadata.decoderConfig.codec}`);
      }
    },
    error: (err) => {
      console.error('  Encoder error:', err);
    },
  });

  // Configure encoder
  encoder.configure({
    codec: 'opus',
    sampleRate,
    numberOfChannels: channels,
    bitrate: 128000,
  });

  console.log(`  Encoder state: ${encoder.state}`);

  // Generate and encode test audio (sine wave)
  const samplesPerChunk = 960; // 20ms at 48kHz
  const totalSamples = sampleRate * duration;
  const numChunks = Math.ceil(totalSamples / samplesPerChunk);

  console.log(`  Encoding ${duration}s of audio (${numChunks} chunks)...`);

  for (let i = 0; i < numChunks; i++) {
    const audioData = generateTestAudio(sampleRate, channels, samplesPerChunk, i * samplesPerChunk);
    encoder.encode(audioData);
    audioData.close();
  }

  // Wait for encoding to complete
  await encoder.flush();
  encoder.close();

  console.log(`  Encoded ${encodedChunks.length} chunks`);
  const totalBytes = encodedChunks.reduce((sum, c) => sum + c.byteLength, 0);
  console.log(`  Total encoded size: ${(totalBytes / 1024).toFixed(1)} KB`);
}

/**
 * Demo 3: Full encode/decode roundtrip
 */
async function demo3_Roundtrip(): Promise<void> {
  console.log('\n=== Demo 3: Encode/Decode Roundtrip ===\n');

  const width = 160;
  const height = 120;
  const frameCount = 10;
  const encodedChunks: { chunk: EncodedVideoChunk; metadata?: any }[] = [];
  const decodedFrames: VideoFrame[] = [];

  // Create encoder
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      encodedChunks.push({ chunk, metadata });
    },
    error: (err) => console.error('Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 500_000,
    framerate: 30,
  });

  console.log('  Encoding frames...');

  // Encode test frames
  for (let i = 0; i < frameCount; i++) {
    const frameData = generateTestFrame(width, height, i);
    const frame = new VideoFrame(frameData, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: i * (1_000_000 / 30),
    });
    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  console.log(`  Encoded ${encodedChunks.length} chunks`);

  // Create decoder
  const decoder = new VideoDecoder({
    output: (frame) => {
      decodedFrames.push(frame);
    },
    error: (err) => console.error('Decoder error:', err),
  });

  // Get decoder config from first chunk's metadata
  const decoderConfig = encodedChunks[0]?.metadata?.decoderConfig;
  if (decoderConfig) {
    decoder.configure({
      codec: decoderConfig.codec,
      codedWidth: decoderConfig.codedWidth || width,
      codedHeight: decoderConfig.codedHeight || height,
      description: decoderConfig.description, // SPS/PPS for H.264
    });

    console.log('  Decoding chunks...');

    // Decode all chunks
    for (const { chunk } of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    console.log(`  Decoded ${decodedFrames.length} frames`);

    // Verify first decoded frame
    if (decodedFrames.length > 0) {
      const frame = decodedFrames[0];
      console.log(`  First frame: ${frame.codedWidth}x${frame.codedHeight}, format=${frame.format}`);
    }

    // Clean up
    decodedFrames.forEach(f => f.close());
  } else {
    console.log('  No decoder config available, skipping decode');
    decoder.close();
  }
}

/**
 * Demo 4: Check supported codecs
 */
async function demo4_CodecSupport(): Promise<void> {
  console.log('\n=== Demo 4: Codec Support Check ===\n');

  const videoCodecs = ['vp8', 'vp9', 'avc1.42E01E', 'hev1.1.6.L93.B0', 'av01.0.04M.08'];
  const audioCodecs = ['opus', 'mp3', 'aac', 'flac', 'vorbis'];

  console.log('  Video Encoders:');
  for (const codec of videoCodecs) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width: 1920,
      height: 1080,
    });
    console.log(`    ${codec}: ${support.supported ? '✓' : '✗'}`);
  }

  console.log('\n  Video Decoders:');
  for (const codec of videoCodecs) {
    const support = await VideoDecoder.isConfigSupported({ codec });
    console.log(`    ${codec}: ${support.supported ? '✓' : '✗'}`);
  }

  console.log('\n  Audio Encoders:');
  for (const codec of audioCodecs) {
    const support = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate: 48000,
      numberOfChannels: 2,
    });
    console.log(`    ${codec}: ${support.supported ? '✓' : '✗'}`);
  }

  console.log('\n  Audio Decoders:');
  for (const codec of audioCodecs) {
    const support = await AudioDecoder.isConfigSupported({
      codec,
      sampleRate: 48000,
      numberOfChannels: 2,
    });
    console.log(`    ${codec}: ${support.supported ? '✓' : '✗'}`);
  }
}

/**
 * Generate a test frame with a gradient pattern
 */
function generateTestFrame(width: number, height: number, frameIndex: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const offset = frameIndex * 8; // Animate the pattern

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = ((x + offset) * 255 / width) & 255;     // R
      data[i + 1] = ((y + offset) * 255 / height) & 255; // G
      data[i + 2] = (frameIndex * 8) & 255;              // B
      data[i + 3] = 255;                                  // A
    }
  }

  return data;
}

/**
 * Generate test audio (440Hz sine wave)
 */
function generateTestAudio(
  sampleRate: number,
  channels: number,
  numFrames: number,
  startFrame: number
): AudioData {
  const data = new Float32Array(numFrames * channels);
  const frequency = 440; // A4 note

  for (let i = 0; i < numFrames; i++) {
    const t = (startFrame + i) / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.5;

    for (let ch = 0; ch < channels; ch++) {
      data[i * channels + ch] = sample;
    }
  }

  return new AudioData({
    format: 'f32',
    sampleRate,
    numberOfChannels: channels,
    numberOfFrames: numFrames,
    timestamp: (startFrame / sampleRate) * 1_000_000, // microseconds
    data,
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          WebCodecs API Demo (Standalone Usage)                ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  console.log('\nThis demo shows direct usage of WebCodecs API classes');
  console.log('without Mediabunny, similar to browser WebCodecs.\n');

  // Create test directory
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  try {
    await demo4_CodecSupport();
    await demo1_VideoEncoder();
    await demo2_AudioEncoder();
    await demo3_Roundtrip();

    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    All demos completed!                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main().catch(console.error);

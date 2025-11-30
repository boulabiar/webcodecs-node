/**
 * Audio Encoding Example
 *
 * Demonstrates how to encode raw audio samples to Opus.
 *
 * Run: npx tsx examples/audio-encoding.ts
 */

import { AudioEncoder, AudioData, EncodedAudioChunk } from '../src/index.js';

async function main() {
  const sampleRate = 48000;
  const numberOfChannels = 2;
  const duration = 2; // seconds
  const samplesPerChunk = 960; // Opus frame size

  const chunks: EncodedAudioChunk[] = [];

  // Create encoder
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      console.log(
        `Encoded audio: ${chunk.byteLength} bytes, timestamp: ${chunk.timestamp}`
      );
    },
    error: (err) => {
      console.error('Encoding error:', err);
    },
  });

  // Configure for Opus encoding
  encoder.configure({
    codec: 'opus',
    sampleRate,
    numberOfChannels,
    bitrate: 128000,
  });

  console.log(`Encoding ${duration}s of audio at ${sampleRate}Hz stereo...\n`);

  // Generate and encode audio samples (sine wave)
  const totalSamples = sampleRate * duration;
  let timestamp = 0;

  for (let offset = 0; offset < totalSamples; offset += samplesPerChunk) {
    const samples = new Float32Array(samplesPerChunk * numberOfChannels);

    // Generate stereo sine wave (440Hz left, 880Hz right)
    for (let i = 0; i < samplesPerChunk; i++) {
      const t = (offset + i) / sampleRate;
      samples[i * 2] = Math.sin(2 * Math.PI * 440 * t) * 0.5; // Left
      samples[i * 2 + 1] = Math.sin(2 * Math.PI * 880 * t) * 0.5; // Right
    }

    const audioData = new AudioData({
      format: 'f32', // Interleaved float32
      sampleRate,
      numberOfChannels,
      numberOfFrames: samplesPerChunk,
      timestamp,
      data: samples,
    });

    encoder.encode(audioData);
    audioData.close();

    timestamp += (samplesPerChunk * 1_000_000) / sampleRate;
  }

  await encoder.flush();
  encoder.close();

  // Calculate statistics
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const actualBitrate = (totalBytes * 8) / duration;

  console.log(`\nEncoding complete:`);
  console.log(`  Duration: ${duration}s`);
  console.log(`  Chunks: ${chunks.length}`);
  console.log(`  Total size: ${(totalBytes / 1024).toFixed(2)} KB`);
  console.log(`  Actual bitrate: ${(actualBitrate / 1000).toFixed(0)} kbps`);
}

main().catch(console.error);

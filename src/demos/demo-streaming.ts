/**
 * Streaming Demo - Real-time frame-by-frame encoding and decoding
 *
 * Demonstrates that encoding/decoding happens in streaming fashion,
 * with frames emitted as soon as they're ready (not buffered until end).
 */

import { VideoEncoder } from '../VideoEncoder.js';
import { VideoDecoder } from '../VideoDecoder.js';
import { VideoFrame } from '../VideoFrame.js';
import { EncodedVideoChunk } from '../EncodedVideoChunk.js';
import { AudioEncoder } from '../AudioEncoder.js';
import { AudioDecoder } from '../AudioDecoder.js';
import { AudioData } from '../AudioData.js';
import { EncodedAudioChunk } from '../EncodedAudioChunk.js';

const WIDTH = 320;
const HEIGHT = 240;
const FRAME_COUNT = 30;
const FRAME_INTERVAL_MS = 33; // ~30fps

function formatTime(ms: number): string {
  return `${ms.toFixed(0).padStart(4)}ms`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demoVideoStreaming(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           Video Streaming Demo (Frame-by-Frame)               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();
  let encodedCount = 0;
  let decodedCount = 0;

  // Collect encoded chunks to pass to decoder
  const encodedChunks: EncodedVideoChunk[] = [];

  // Create encoder
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const elapsed = Date.now() - startTime;
      encodedCount++;
      console.log(`  [${formatTime(elapsed)}] ENCODED frame ${encodedCount}: ${chunk.byteLength} bytes (${chunk.type})`);
      encodedChunks.push(chunk);
    },
    error: (err) => console.error('Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width: WIDTH,
    height: HEIGHT,
    bitrate: 1_000_000,
    framerate: 30,
    latencyMode: 'realtime', // Use realtime mode for minimum latency
  });

  console.log('Encoding frames in real-time (simulating live capture):\n');

  // Simulate real-time frame generation
  for (let i = 0; i < FRAME_COUNT; i++) {
    // Create frame with changing color (simulating video content)
    const data = new Uint8Array(WIDTH * HEIGHT * 4);
    const hue = (i / FRAME_COUNT) * 360;
    const [r, g, b] = hslToRgb(hue, 0.7, 0.5);

    for (let p = 0; p < WIDTH * HEIGHT; p++) {
      // Add some variation to make it more interesting
      const x = p % WIDTH;
      const y = Math.floor(p / WIDTH);
      const noise = Math.sin(x / 20 + i) * 30 + Math.sin(y / 20 + i) * 30;

      data[p * 4] = Math.min(255, Math.max(0, r + noise));
      data[p * 4 + 1] = Math.min(255, Math.max(0, g + noise));
      data[p * 4 + 2] = Math.min(255, Math.max(0, b + noise));
      data[p * 4 + 3] = 255;
    }

    const elapsed = Date.now() - startTime;
    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: WIDTH,
      codedHeight: HEIGHT,
      timestamp: i * 33333, // microseconds
    });

    console.log(`  [${formatTime(elapsed)}] INPUT   frame ${i + 1}`);
    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();

    // Wait to simulate real-time capture
    await sleep(FRAME_INTERVAL_MS);
  }

  console.log('\n  Flushing encoder...');
  await encoder.flush();
  encoder.close();

  console.log(`\n  Encoding complete: ${encodedCount} frames encoded\n`);

  // Now decode the frames
  console.log('Decoding frames in real-time:\n');

  const decoder = new VideoDecoder({
    output: (frame) => {
      const elapsed = Date.now() - startTime;
      decodedCount++;
      console.log(`  [${formatTime(elapsed)}] DECODED frame ${decodedCount}: ${frame.codedWidth}x${frame.codedHeight}`);
      frame.close();
    },
    error: (err) => console.error('Decoder error:', err),
  });

  decoder.configure({
    codec: 'avc1.42001E',
    codedWidth: WIDTH,
    codedHeight: HEIGHT,
  });

  // Feed chunks to decoder one by one with delays
  for (let i = 0; i < encodedChunks.length; i++) {
    const elapsed = Date.now() - startTime;
    console.log(`  [${formatTime(elapsed)}] FEED    chunk ${i + 1}`);
    decoder.decode(encodedChunks[i]);

    // Small delay to show streaming behavior
    await sleep(10);
  }

  console.log('\n  Flushing decoder...');
  await decoder.flush();
  decoder.close();

  console.log(`\n  Decoding complete: ${decodedCount} frames decoded`);
  console.log(`  Total time: ${Date.now() - startTime}ms\n`);
}

async function demoAudioStreaming(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           Audio Streaming Demo (Chunk-by-Chunk)               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();
  const SAMPLE_RATE = 48000;
  const CHANNELS = 2;
  const CHUNK_SIZE = 960; // 20ms at 48kHz (Opus frame size)
  const CHUNK_COUNT = 50; // 1 second of audio

  let encodedCount = 0;
  let decodedCount = 0;
  const encodedChunks: EncodedAudioChunk[] = [];

  // Create encoder
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const elapsed = Date.now() - startTime;
      encodedCount++;
      console.log(`  [${formatTime(elapsed)}] ENCODED chunk ${encodedCount}: ${chunk.byteLength} bytes`);
      encodedChunks.push(chunk);
    },
    error: (err) => console.error('Encoder error:', err),
  });

  encoder.configure({
    codec: 'opus',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: CHANNELS,
    bitrate: 64000,
  });

  console.log('Encoding audio chunks in real-time (simulating live audio):\n');

  // Generate and encode audio chunks
  for (let c = 0; c < CHUNK_COUNT; c++) {
    const samples = new Float32Array(CHUNK_SIZE * CHANNELS);
    const frequency = 440 + Math.sin(c / 10) * 100; // Varying frequency

    for (let i = 0; i < CHUNK_SIZE; i++) {
      const t = (c * CHUNK_SIZE + i) / SAMPLE_RATE;
      const value = Math.sin(2 * Math.PI * frequency * t) * 0.3;
      for (let ch = 0; ch < CHANNELS; ch++) {
        samples[i * CHANNELS + ch] = value;
      }
    }

    const elapsed = Date.now() - startTime;
    const audioData = new AudioData({
      format: 'f32',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: CHANNELS,
      numberOfFrames: CHUNK_SIZE,
      timestamp: c * (CHUNK_SIZE * 1_000_000 / SAMPLE_RATE),
      data: samples,
    });

    console.log(`  [${formatTime(elapsed)}] INPUT   chunk ${c + 1} (${CHUNK_SIZE} samples)`);
    encoder.encode(audioData);
    audioData.close();

    // Simulate real-time: 20ms chunks
    await sleep(20);
  }

  console.log('\n  Flushing encoder...');
  await encoder.flush();
  encoder.close();

  console.log(`\n  Encoding complete: ${encodedCount} chunks encoded\n`);

  // Decode
  console.log('Decoding audio chunks:\n');

  const decoder = new AudioDecoder({
    output: (audio) => {
      const elapsed = Date.now() - startTime;
      decodedCount++;
      console.log(`  [${formatTime(elapsed)}] DECODED chunk ${decodedCount}: ${audio.numberOfFrames} samples`);
      audio.close();
    },
    error: (err) => console.error('Decoder error:', err),
  });

  decoder.configure({
    codec: 'opus',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: CHANNELS,
  });

  for (let i = 0; i < encodedChunks.length; i++) {
    const elapsed = Date.now() - startTime;
    console.log(`  [${formatTime(elapsed)}] FEED    chunk ${i + 1}`);
    decoder.decode(encodedChunks[i]);
    await sleep(5);
  }

  console.log('\n  Flushing decoder...');
  await decoder.flush();
  decoder.close();

  console.log(`\n  Decoding complete: ${decodedCount} chunks decoded`);
  console.log(`  Total time: ${Date.now() - startTime}ms\n`);
}

async function demoLatencyComparison(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║        Latency Mode Comparison (realtime vs quality)          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const FRAMES = 10;

  for (const latencyMode of ['realtime', 'quality'] as const) {
    console.log(`Testing latencyMode: "${latencyMode}"\n`);

    const frameTimings: number[] = [];
    let frameCount = 0;
    const startTime = Date.now();

    const encoder = new VideoEncoder({
      output: (chunk) => {
        const elapsed = Date.now() - startTime;
        frameTimings.push(elapsed);
        frameCount++;
      },
      error: (err) => console.error('Error:', err),
    });

    encoder.configure({
      codec: 'avc1.42001E',
      width: 640,
      height: 480,
      bitrate: 2_000_000,
      framerate: 30,
      latencyMode,
    });

    // Encode frames as fast as possible
    for (let i = 0; i < FRAMES; i++) {
      const data = new Uint8Array(640 * 480 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 640,
        codedHeight: 480,
        timestamp: i * 33333,
      });

      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }

    await encoder.flush();
    encoder.close();

    // Calculate statistics
    const totalTime = Date.now() - startTime;
    const avgLatency = frameTimings.length > 1
      ? frameTimings.reduce((a, b, i) => i > 0 ? a + (b - frameTimings[i-1]) : a, 0) / (frameTimings.length - 1)
      : 0;
    const firstFrameLatency = frameTimings[0] || 0;

    console.log(`  First frame output: ${firstFrameLatency}ms`);
    console.log(`  Average inter-frame: ${avgLatency.toFixed(1)}ms`);
    console.log(`  Total encode time: ${totalTime}ms`);
    console.log(`  Frames encoded: ${frameCount}\n`);
  }
}

// Helper: HSL to RGB conversion
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = h / 360;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

async function main() {
  console.log('\n');

  await demoVideoStreaming();
  console.log('\n');

  await demoAudioStreaming();
  console.log('\n');

  await demoLatencyComparison();

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Streaming Demo Complete                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('Key observations:');
  console.log('  - Encoded frames appear WHILE input is still being fed');
  console.log('  - No buffering of entire video before output starts');
  console.log('  - "realtime" latencyMode reduces first-frame latency');
  console.log('  - Suitable for live streaming, video conferencing, etc.\n');
}

main().catch(console.error);

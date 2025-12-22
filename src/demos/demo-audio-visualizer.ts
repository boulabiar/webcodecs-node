/**
 * Demo: Audio Visualizer
 *
 * Generates audio (multiple sine waves) and visualizes them as:
 * - Waveform display (top half)
 * - Spectrum bars (bottom half)
 *
 * Outputs both video and audio files, then muxes them together.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { createCanvas, getRawPixels } from '../canvas/index.js';
import type { Canvas } from 'skia-canvas';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';

const WIDTH = 800;
const HEIGHT = 600;
const DURATION_SECONDS = 10;
const FRAME_RATE = 30;
const SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const FRAME_COUNT = DURATION_SECONDS * FRAME_RATE;
const FRAME_DURATION_US = Math.round(1_000_000 / FRAME_RATE);
const SAMPLES_PER_FRAME = Math.round(SAMPLE_RATE / FRAME_RATE);

const OUTPUT_DIR = path.resolve('media', 'visualizer-demo');
const OUTPUT_VIDEO = path.join(OUTPUT_DIR, 'visualizer.mp4');

// Musical frequencies (A minor pentatonic scale)
const FREQUENCIES = [220, 261.63, 329.63, 392, 440, 523.25, 659.25, 783.99];

// Visualization colors
const COLORS = {
  background: '#1a1a2e',
  waveform: '#00ff88',
  bars: ['#ff0080', '#ff4080', '#ff8080', '#ffaa00', '#ffff00', '#80ff00', '#00ff80', '#00ffff'],
  text: '#ffffff',
  grid: '#333355',
};

interface AudioState {
  frequencies: number[];
  amplitudes: number[];
  phases: number[];
}

function generateAudioSamples(
  state: AudioState,
  numSamples: number,
  sampleRate: number,
  startSample: number
): Float32Array {
  const samples = new Float32Array(numSamples * AUDIO_CHANNELS);

  for (let i = 0; i < numSamples; i++) {
    const t = (startSample + i) / sampleRate;
    let sample = 0;

    // Mix multiple frequencies with their amplitudes
    for (let f = 0; f < state.frequencies.length; f++) {
      const freq = state.frequencies[f];
      const amp = state.amplitudes[f];
      const phase = state.phases[f];
      sample += Math.sin(2 * Math.PI * freq * t + phase) * amp;
    }

    // Normalize
    sample = sample / state.frequencies.length * 0.7;

    // Stereo (same for both channels)
    samples[i * AUDIO_CHANNELS] = sample;
    samples[i * AUDIO_CHANNELS + 1] = sample;
  }

  return samples;
}

function drawWaveform(
  ctx: any,
  samples: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const step = Math.ceil(samples.length / AUDIO_CHANNELS / width);
  const centerY = y + height / 2;

  ctx.beginPath();
  ctx.strokeStyle = COLORS.waveform;
  ctx.lineWidth = 2;
  ctx.shadowColor = COLORS.waveform;
  ctx.shadowBlur = 10;

  for (let i = 0; i < width; i++) {
    const sampleIndex = Math.min(i * step, samples.length / AUDIO_CHANNELS - 1);
    const sample = samples[sampleIndex * AUDIO_CHANNELS];
    const py = centerY - sample * (height / 2) * 0.9;

    if (i === 0) {
      ctx.moveTo(x + i, py);
    } else {
      ctx.lineTo(x + i, py);
    }
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSpectrumBars(
  ctx: any,
  amplitudes: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  time: number
): void {
  const numBars = amplitudes.length;
  const barWidth = (width / numBars) * 0.8;
  const gap = (width / numBars) * 0.2;

  for (let i = 0; i < numBars; i++) {
    // Add some animation to the bars
    const animatedAmp = amplitudes[i] * (0.8 + 0.2 * Math.sin(time * 5 + i));
    const barHeight = animatedAmp * height * 0.9;
    const bx = x + i * (barWidth + gap) + gap / 2;
    const by = y + height - barHeight;

    // Gradient effect
    const gradient = ctx.createLinearGradient(bx, by, bx, y + height);
    gradient.addColorStop(0, COLORS.bars[i % COLORS.bars.length]);
    gradient.addColorStop(1, '#000033');

    ctx.fillStyle = gradient;
    ctx.shadowColor = COLORS.bars[i % COLORS.bars.length];
    ctx.shadowBlur = 15;

    // Rounded rectangle
    const radius = barWidth / 4;
    ctx.beginPath();
    ctx.moveTo(bx + radius, by);
    ctx.lineTo(bx + barWidth - radius, by);
    ctx.quadraticCurveTo(bx + barWidth, by, bx + barWidth, by + radius);
    ctx.lineTo(bx + barWidth, y + height);
    ctx.lineTo(bx, y + height);
    ctx.lineTo(bx, by + radius);
    ctx.quadraticCurveTo(bx, by, bx + radius, by);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
}

function drawGrid(ctx: any, width: number, height: number): void {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;

  // Horizontal lines
  for (let y = 0; y < height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Vertical lines
  for (let x = 0; x < width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawLabels(
  ctx: any,
  frequencies: number[],
  time: number
): void {
  ctx.fillStyle = COLORS.text;
  ctx.font = '16px monospace';
  ctx.textAlign = 'left';

  // Title
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('Audio Visualizer', 20, 35);

  // Time
  ctx.font = '16px monospace';
  ctx.fillText(`Time: ${time.toFixed(2)}s`, WIDTH - 120, 35);

  // Frequency labels
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  const barWidth = (WIDTH - 40) / frequencies.length;
  for (let i = 0; i < frequencies.length; i++) {
    const x = 20 + i * barWidth + barWidth / 2;
    ctx.fillText(`${frequencies[i].toFixed(0)}Hz`, x, HEIGHT - 10);
  }
}

async function muxAudioVideo(
  h264Path: string,
  pcmPath: string,
  outputPath: string,
  sampleRate: number,
  channels: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-f', 'h264', '-r', String(FRAME_RATE), '-i', h264Path,
      '-f', 'f32le', '-ar', String(sampleRate), '-ac', String(channels), '-i', pcmPath,
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest',
      outputPath,
    ]);
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg mux failed: ${code}`));
    });
  });
}

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              Audio Visualizer Demo                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Initialize audio state with varying amplitudes
  const audioState: AudioState = {
    frequencies: FREQUENCIES.slice(0, 8),
    amplitudes: [0.8, 0.6, 0.7, 0.5, 0.9, 0.4, 0.6, 0.7],
    phases: FREQUENCIES.map((_, i) => (i * Math.PI) / 4),
  };

  // Create canvas
  const canvas = createCanvas({ width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext('2d');

  // Video encoder
  const videoBuffers: Uint8Array[] = [];
  const videoEncoder = new VideoEncoder({
    output: (chunk) => videoBuffers.push(chunk._buffer),
    error: (err) => console.error('Video encoder error:', err),
  });

  videoEncoder.configure({
    codec: 'avc1.64001E',
    width: WIDTH,
    height: HEIGHT,
    framerate: FRAME_RATE,
    bitrate: 4_000_000,
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-hardware',
    format: 'annexb',
  });

  // Collect raw PCM samples (will be encoded by ffmpeg during mux)
  const audioSamples: Float32Array[] = [];

  console.log(`  Resolution: ${WIDTH}x${HEIGHT}`);
  console.log(`  Duration: ${DURATION_SECONDS}s`);
  console.log(`  Frequencies: ${audioState.frequencies.map(f => f.toFixed(0) + 'Hz').join(', ')}`);
  console.log(`  Encoding...\n`);

  const startTime = Date.now();
  let totalSamples = 0;

  for (let i = 0; i < FRAME_COUNT; i++) {
    // Backpressure: wait if encoder queue is getting full
    while (videoEncoder.encodeQueueSize >= 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const time = i / FRAME_RATE;

    // Animate amplitudes over time
    for (let f = 0; f < audioState.amplitudes.length; f++) {
      audioState.amplitudes[f] = 0.3 + 0.5 * Math.abs(Math.sin(time * 0.5 + f * 0.7));
    }

    // Generate audio samples for this frame
    const samples = generateAudioSamples(
      audioState,
      SAMPLES_PER_FRAME,
      SAMPLE_RATE,
      totalSamples
    );
    audioSamples.push(samples);
    totalSamples += SAMPLES_PER_FRAME;

    // Draw visualization
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    drawGrid(ctx, WIDTH, HEIGHT);

    // Waveform in top half
    drawWaveform(ctx, samples, 20, 60, WIDTH - 40, HEIGHT / 2 - 80);

    // Spectrum bars in bottom half
    drawSpectrumBars(
      ctx,
      audioState.amplitudes,
      20,
      HEIGHT / 2 + 20,
      WIDTH - 40,
      HEIGHT / 2 - 60,
      time
    );

    // Labels
    drawLabels(ctx, audioState.frequencies, time);

    // Divider line
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT / 2);
    ctx.lineTo(WIDTH, HEIGHT / 2);
    ctx.stroke();

    // Create video frame
    const pixels = getRawPixels(canvas as Canvas);
    const frame = new VideoFrame(pixels, {
      format: 'RGBA',
      codedWidth: WIDTH,
      codedHeight: HEIGHT,
      timestamp: i * FRAME_DURATION_US,
    });

    videoEncoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();

    // Progress indicator
    if ((i + 1) % 60 === 0) {
      const elapsed = Date.now() - startTime;
      const fps = ((i + 1) / elapsed) * 1000;
      console.log(`  Frame ${i + 1}/${FRAME_COUNT} (${fps.toFixed(1)} fps)`);
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();

  const encodeTime = Date.now() - startTime;
  console.log(`\n  Encoding complete: ${encodeTime}ms`);

  // Write temporary files
  const h264Path = path.join(OUTPUT_DIR, 'temp.h264');
  const pcmPath = path.join(OUTPUT_DIR, 'temp.pcm');

  fs.writeFileSync(h264Path, Buffer.concat(videoBuffers.map(b => Buffer.from(b))));

  // Write raw PCM audio (float32 little-endian)
  const totalAudioBytes = audioSamples.reduce((sum, s) => sum + s.byteLength, 0);
  const pcmBuffer = Buffer.alloc(totalAudioBytes);
  let offset = 0;
  for (const samples of audioSamples) {
    Buffer.from(samples.buffer).copy(pcmBuffer, offset);
    offset += samples.byteLength;
  }
  fs.writeFileSync(pcmPath, pcmBuffer);

  // Mux audio and video
  console.log('  Muxing audio and video...');
  await muxAudioVideo(h264Path, pcmPath, OUTPUT_VIDEO, SAMPLE_RATE, AUDIO_CHANNELS);

  // Clean up temp files
  fs.unlinkSync(h264Path);
  fs.unlinkSync(pcmPath);

  const stats = fs.statSync(OUTPUT_VIDEO);
  console.log(`\n  Output: ${OUTPUT_VIDEO}`);
  console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`);

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Demo Complete!                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

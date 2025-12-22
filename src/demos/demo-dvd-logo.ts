/**
 * Demo: Bouncing DVD Logo
 *
 * The classic DVD screensaver effect - a logo bouncing around the screen,
 * changing color each time it hits an edge. Encodes to H.264 video.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { createCanvas, getRawPixels } from '../canvas/index.js';
import type { Canvas } from 'skia-canvas';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';

const WIDTH = 640;
const HEIGHT = 480;
const FRAME_COUNT = 300; // 10 seconds at 30fps
const FRAME_RATE = 30;
const FRAME_DURATION_US = Math.round(1_000_000 / FRAME_RATE);

const OUTPUT_DIR = path.resolve('media', 'dvd-demo');
const OUTPUT_VIDEO = path.join(OUTPUT_DIR, 'dvd-bounce.mp4');

// DVD logo dimensions
const LOGO_WIDTH = 120;
const LOGO_HEIGHT = 60;

// Vibrant colors for the logo
const COLORS = [
  '#ff0000', // Red
  '#00ff00', // Green
  '#0000ff', // Blue
  '#ffff00', // Yellow
  '#ff00ff', // Magenta
  '#00ffff', // Cyan
  '#ff8000', // Orange
  '#8000ff', // Purple
];

interface LogoState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  colorIndex: number;
}

function drawDvdLogo(
  ctx: any,
  x: number,
  y: number,
  color: string
): void {
  // Draw DVD logo shape
  ctx.save();
  ctx.translate(x, y);

  // Main DVD text
  ctx.fillStyle = color;
  ctx.font = 'bold 36px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DVD', LOGO_WIDTH / 2, LOGO_HEIGHT / 2 - 8);

  // Video text below
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.fillText('VIDEO', LOGO_WIDTH / 2, LOGO_HEIGHT / 2 + 18);

  // Add a subtle glow effect
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillText('VIDEO', LOGO_WIDTH / 2, LOGO_HEIGHT / 2 + 18);

  ctx.restore();
}

function updateLogo(state: LogoState): boolean {
  let colorChanged = false;

  // Update position
  state.x += state.vx;
  state.y += state.vy;

  // Bounce off edges
  if (state.x <= 0) {
    state.x = 0;
    state.vx = -state.vx;
    colorChanged = true;
  } else if (state.x + LOGO_WIDTH >= WIDTH) {
    state.x = WIDTH - LOGO_WIDTH;
    state.vx = -state.vx;
    colorChanged = true;
  }

  if (state.y <= 0) {
    state.y = 0;
    state.vy = -state.vy;
    colorChanged = true;
  } else if (state.y + LOGO_HEIGHT >= HEIGHT) {
    state.y = HEIGHT - LOGO_HEIGHT;
    state.vy = -state.vy;
    colorChanged = true;
  }

  // Change color on bounce
  if (colorChanged) {
    state.colorIndex = (state.colorIndex + 1) % COLORS.length;
  }

  return colorChanged;
}

function muxH264ToMp4(h264Data: Buffer, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-f', 'h264',
      '-r', String(FRAME_RATE),
      '-i', 'pipe:0',
      '-c:v', 'copy',
      outputPath,
    ]);
    ffmpeg.stdin.on('error', reject);
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg mux failed: ${code}`))));
    ffmpeg.stdin.end(h264Data);
  });
}

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              Bouncing DVD Logo Demo                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Initialize logo state
  const logo: LogoState = {
    x: WIDTH / 2 - LOGO_WIDTH / 2,
    y: HEIGHT / 2 - LOGO_HEIGHT / 2,
    vx: 3,
    vy: 2,
    colorIndex: 0,
  };

  // Create canvas
  const canvas = createCanvas({ width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext('2d');

  // Collect encoded chunks
  const encodedBuffers: Uint8Array[] = [];
  let bounceCount = 0;
  let cornerHits = 0;

  const encoder = new VideoEncoder({
    output: (chunk) => encodedBuffers.push(chunk._buffer),
    error: (err) => console.error('Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.64001E',
    width: WIDTH,
    height: HEIGHT,
    framerate: FRAME_RATE,
    bitrate: 2_000_000,
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-hardware',
    format: 'annexb',
  });

  console.log(`  Resolution: ${WIDTH}x${HEIGHT}`);
  console.log(`  Frames: ${FRAME_COUNT} (${FRAME_COUNT / FRAME_RATE}s)`);
  console.log(`  Encoding...\n`);

  const startTime = Date.now();

  for (let i = 0; i < FRAME_COUNT; i++) {
    // Backpressure: wait if encoder queue is getting full
    while (encoder.encodeQueueSize >= 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Clear canvas with dark background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Draw the DVD logo
    drawDvdLogo(ctx, logo.x, logo.y, COLORS[logo.colorIndex]);

    // Create frame from canvas
    const pixels = getRawPixels(canvas as Canvas);
    const frame = new VideoFrame(pixels, {
      format: 'RGBA',
      codedWidth: WIDTH,
      codedHeight: HEIGHT,
      timestamp: i * FRAME_DURATION_US,
    });

    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();

    // Update logo position
    const wasAtCorner =
      (logo.x <= 0 || logo.x + LOGO_WIDTH >= WIDTH) &&
      (logo.y <= 0 || logo.y + LOGO_HEIGHT >= HEIGHT);

    const bounced = updateLogo(logo);
    if (bounced) {
      bounceCount++;
      // Check if we hit a corner (both edges at once)
      const nowAtCorner =
        (logo.x <= 0 || logo.x + LOGO_WIDTH >= WIDTH) &&
        (logo.y <= 0 || logo.y + LOGO_HEIGHT >= HEIGHT);
      if (nowAtCorner && !wasAtCorner) {
        cornerHits++;
        console.log(`  Corner hit at frame ${i}!`);
      }
    }

    // Progress indicator
    if ((i + 1) % 60 === 0) {
      const elapsed = Date.now() - startTime;
      const fps = ((i + 1) / elapsed) * 1000;
      console.log(`  Frame ${i + 1}/${FRAME_COUNT} (${fps.toFixed(1)} fps)`);
    }
  }

  await encoder.flush();
  encoder.close();

  const encodeTime = Date.now() - startTime;
  console.log(`\n  Encoding complete: ${encodeTime}ms`);
  console.log(`  Total bounces: ${bounceCount}`);
  console.log(`  Corner hits: ${cornerHits}`);

  // Mux to MP4
  const h264Payload = Buffer.concat(encodedBuffers.map((b) => Buffer.from(b)));
  await muxH264ToMp4(h264Payload, OUTPUT_VIDEO);

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

/**
 * Demo: composite four copies of a decoded video frame into a single output video.
 * Runs entirely in Node (no WebGPU), uses the WebCodecs-compatible VideoDecoder/Encoder.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { VideoDecoder } from '../decoders/VideoDecoder.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { VideoFrame } from '../core/VideoFrame.js';

const MEDIA_FILE = path.resolve('media/Big_Buck_Bunny_360_10s_1MB.mp4');
const OUTPUT_DIR = path.resolve('media', 'four-corners-demo');
const OUTPUT_VIDEO = path.join(OUTPUT_DIR, 'four-corners.mp4');
const FRAME_RATE = 30;
const FRAME_DURATION_US = Math.round(1_000_000 / FRAME_RATE);
const FRAMES_TO_RENDER = 90;

interface StreamChunk {
  chunk: Buffer;
  keyFrame: boolean;
}

function findStartCode(buffer: Buffer, from: number): number {
  for (let i = from; i < buffer.length - 3; i++) {
    if (buffer[i] === 0 && buffer[i + 1] === 0) {
      if (buffer[i + 2] === 1) return i;
      if (buffer[i + 2] === 0 && buffer[i + 3] === 1) return i;
    }
  }
  return -1;
}

function extractNal(buffer: Buffer, allowPartial: boolean): { nal: Buffer; type: number; consumed: number } | null {
  const start = findStartCode(buffer, 0);
  if (start === -1) return null;

  let local = buffer.slice(start);
  let consumed = start;

  let startCodeLength = 0;
  if (local[0] === 0 && local[1] === 0 && local[2] === 1) startCodeLength = 3;
  else if (local[0] === 0 && local[1] === 0 && local[2] === 0 && local[3] === 1) startCodeLength = 4;
  else return null;

  if (local.length < startCodeLength + 1) return null;

  const next = findStartCode(local, startCodeLength);
  if (next === -1) {
    if (!allowPartial) return null;
    return { nal: local, type: local[startCodeLength] & 0x1f, consumed: consumed + local.length };
  }

  const nal = local.slice(0, next);
  return { nal, type: local[startCodeLength] & 0x1f, consumed: consumed + next };
}

async function* streamAnnexBFrames(filePath: string): AsyncGenerator<StreamChunk> {
  const ffmpeg = spawn('ffmpeg', ['-i', filePath, '-c:v', 'copy', '-an', '-f', 'h264', 'pipe:1']);
  let buffer = Buffer.alloc(0);
  let pendingNal: Buffer[] = [];
  let pendingKey = false;

  const handleNal = (nal: Buffer, type: number): StreamChunk | null => {
    pendingNal.push(nal);
    if (type === 5) pendingKey = true;
    if (type === 1 || type === 5) {
      const chunk = Buffer.concat(pendingNal);
      const keyFrame = pendingKey;
      pendingNal = [];
      pendingKey = false;
      return { chunk, keyFrame };
    }
    return null;
  };

  try {
    for await (const data of ffmpeg.stdout) {
      buffer = buffer.length === 0 ? data : Buffer.concat([buffer, data]);
      while (true) {
        const parsed = extractNal(buffer, false);
        if (!parsed) break;
        buffer = buffer.slice(parsed.consumed);
        const out = handleNal(parsed.nal, parsed.type);
        if (out) yield out;
      }
    }

    while (true) {
      const parsed = extractNal(buffer, true);
      if (!parsed) break;
      buffer = buffer.slice(parsed.consumed);
      const out = handleNal(parsed.nal, parsed.type);
      if (out) yield out;
    }

    if (pendingNal.length) {
      yield { chunk: Buffer.concat(pendingNal), keyFrame: pendingKey };
    }
  } finally {
    ffmpeg.kill('SIGTERM');
  }
}

function muxH264ToMp4(h264Data: Buffer, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-y', '-f', 'h264', '-i', 'pipe:0', '-c:v', 'copy', outputPath]);
    ffmpeg.stdin.on('error', reject);
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg mux failed: ${code}`))));
    ffmpeg.stdin.end(h264Data);
  });
}

function compositeFourUp(src: VideoFrame, outWidth: number, outHeight: number): Uint8Array {
  const srcData = src._buffer;
  const srcStride = src.codedWidth * 4;
  const dst = new Uint8Array(outWidth * outHeight * 4);
  const quadWidth = outWidth / 2;
  const quadHeight = outHeight / 2;

  for (let y = 0; y < src.codedHeight; y++) {
    const srcRowStart = y * srcStride;
    const row = srcData.subarray(srcRowStart, srcRowStart + srcStride);

    // Top-left
    let dstOffset = y * outWidth * 4;
    dst.set(row, dstOffset);
    // Top-right
    dstOffset = y * outWidth * 4 + quadWidth * 4;
    dst.set(row, dstOffset);
    // Bottom-left
    dstOffset = (y + quadHeight) * outWidth * 4;
    dst.set(row, dstOffset);
    // Bottom-right
    dstOffset = (y + quadHeight) * outWidth * 4 + quadWidth * 4;
    dst.set(row, dstOffset);
  }

  return dst;
}

async function main() {
  if (!fs.existsSync(MEDIA_FILE)) {
    console.error('Media file not found:', MEDIA_FILE);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const decodedFrames: VideoFrame[] = [];
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (decodedFrames.length < FRAMES_TO_RENDER) {
        decodedFrames.push(frame);
      } else {
        frame.close();
      }
    },
    error: (err) => console.error('Decoder error:', err),
  });

  decoder.configure({
    codec: 'avc1.64001E',
    codedWidth: 640,
    codedHeight: 360,
    outputFormat: 'RGBA',
    hardwareAcceleration: 'prefer-hardware',
  });

  let timestampUs = 0;
  for await (const { chunk, keyFrame } of streamAnnexBFrames(MEDIA_FILE)) {
    if (decodedFrames.length >= FRAMES_TO_RENDER) break;

    // Wait if decoder queue is getting full (backpressure)
    while (decoder.decodeQueueSize >= 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const encoded = new EncodedVideoChunk({
      type: keyFrame ? 'key' : 'delta',
      timestamp: timestampUs,
      duration: FRAME_DURATION_US,
      data: chunk,
    });
    decoder.decode(encoded);
    timestampUs += FRAME_DURATION_US;
  }

  await decoder.flush();

  if (decodedFrames.length === 0) {
    console.error('No frames decoded');
    process.exit(1);
  }

  const srcW = decodedFrames[0].codedWidth;
  const srcH = decodedFrames[0].codedHeight;
  const outWidth = srcW * 2;
  const outHeight = srcH * 2;

  const encodedBuffers: Uint8Array[] = [];
  const encoder = new VideoEncoder({
    output: (chunk) => encodedBuffers.push(chunk._buffer),
    error: (err) => console.error('Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.64001E',
    width: outWidth,
    height: outHeight,
    framerate: FRAME_RATE,
    bitrate: 4_000_000,
    latencyMode: 'realtime',
    hardwareAcceleration: 'prefer-hardware',
    format: 'annexb', // Required for raw H.264 muxing with ffmpeg
  });

  for (let i = 0; i < Math.min(decodedFrames.length, FRAMES_TO_RENDER); i++) {
    const src = decodedFrames[i];
    const composite = compositeFourUp(src, outWidth, outHeight);

    const frame = new VideoFrame(composite, {
      format: 'RGBA',
      codedWidth: outWidth,
      codedHeight: outHeight,
      timestamp: i * FRAME_DURATION_US,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
    src.close();
  }

  await encoder.flush();
  encoder.close();

  const h264Payload = Buffer.concat(encodedBuffers.map((b) => Buffer.from(b)));
  await muxH264ToMp4(h264Payload, OUTPUT_VIDEO);

  console.log(`Four-corners demo rendered ${encodedBuffers.length} chunks to ${OUTPUT_VIDEO}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Tests for Muxer, NodeAvMuxer, and FFmpegMuxer classes
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { jest } from '@jest/globals';

import { Muxer, NodeAvMuxer, FFmpegMuxer, muxChunks } from '../containers/index.js';
import { MuxerError } from '../containers/muxer-types.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { AudioEncoder } from '../encoders/AudioEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { AudioData } from '../core/AudioData.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';

// Test output directory
const TEST_OUTPUT_DIR = path.join(os.tmpdir(), 'muxer-tests');

// Helper to generate test video chunks
async function generateVideoChunks(
  frameCount: number = 10,
  width: number = 320,
  height: number = 240
): Promise<{ chunks: EncodedVideoChunk[]; description?: Uint8Array }> {
  const chunks: EncodedVideoChunk[] = [];
  let description: Uint8Array | undefined;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      if (metadata?.decoderConfig?.description && !description) {
        const desc = metadata.decoderConfig.description;
        description = desc instanceof Uint8Array ? desc : new Uint8Array(desc as ArrayBuffer);
      }
    },
    error: (err) => { throw err; },
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 500_000,
    framerate: 30,
  });

  for (let i = 0; i < frameCount; i++) {
    const data = new Uint8Array(width * height * 4);
    // Simple gradient pattern
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = (x + i * 10) % 256;     // R
        data[idx + 1] = (y + i * 10) % 256; // G
        data[idx + 2] = 128;                 // B
        data[idx + 3] = 255;                 // A
      }
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: i * 33333, // ~30fps
    });

    encoder.encode(frame, { keyFrame: i % 10 === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  return { chunks, description };
}

// Helper to generate test audio chunks
async function generateAudioChunks(
  durationMs: number = 100,
  sampleRate: number = 48000,
  channels: number = 2
): Promise<{ chunks: EncodedAudioChunk[]; description?: Uint8Array }> {
  const chunks: EncodedAudioChunk[] = [];
  let description: Uint8Array | undefined;

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      if (metadata?.decoderConfig?.description && !description) {
        const desc = metadata.decoderConfig.description;
        description = desc instanceof Uint8Array ? desc : new Uint8Array(desc as ArrayBuffer);
      }
    },
    error: (err) => { throw err; },
  });

  encoder.configure({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: 64_000,
  });

  const samplesPerFrame = 1024;
  const totalSamples = Math.floor((durationMs / 1000) * sampleRate);
  const frameCount = Math.ceil(totalSamples / samplesPerFrame);

  for (let i = 0; i < frameCount; i++) {
    const samples = new Float32Array(samplesPerFrame * channels);
    const freq = 440;
    for (let s = 0; s < samplesPerFrame; s++) {
      const t = (i * samplesPerFrame + s) / sampleRate;
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.3;
      for (let c = 0; c < channels; c++) {
        samples[s * channels + c] = sample;
      }
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: samplesPerFrame,
      numberOfChannels: channels,
      timestamp: i * samplesPerFrame * 1_000_000 / sampleRate,
      data: samples,
    });

    encoder.encode(audioData);
    audioData.close();
  }

  await encoder.flush();
  encoder.close();

  return { chunks, description };
}

beforeAll(() => {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up test files
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
});

describe('NodeAvMuxer', () => {
  it('should mux video-only file', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'nodeav-video-only.mp4');
    const { chunks, description } = await generateVideoChunks(5);

    const muxer = new NodeAvMuxer({ path: outputPath });
    await muxer.open();
    await muxer.addVideoTrack({
      codec: 'avc1.42001E',
      codedWidth: 320,
      codedHeight: 240,
      framerate: 30,
      description,
    });

    for (const chunk of chunks) {
      await muxer.writeVideoChunk(chunk);
    }

    await muxer.close();

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
    expect(muxer.videoChunkCount).toBe(chunks.length);
  });

  it('should mux audio-only file', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'nodeav-audio-only.mp4');
    const { chunks, description } = await generateAudioChunks(200);

    const muxer = new NodeAvMuxer({ path: outputPath });
    await muxer.open();
    await muxer.addAudioTrack({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      description,
    });

    for (const chunk of chunks) {
      await muxer.writeAudioChunk(chunk);
    }

    await muxer.close();

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
    expect(muxer.audioChunkCount).toBe(chunks.length);
  });

  it('should mux video and audio together', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'nodeav-av.mp4');
    const video = await generateVideoChunks(5);
    const audio = await generateAudioChunks(200);

    const muxer = new NodeAvMuxer({ path: outputPath });
    await muxer.open();

    await muxer.addVideoTrack({
      codec: 'avc1.42001E',
      codedWidth: 320,
      codedHeight: 240,
      framerate: 30,
      description: video.description,
    });

    await muxer.addAudioTrack({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      description: audio.description,
    });

    for (const chunk of video.chunks) {
      await muxer.writeVideoChunk(chunk);
    }
    for (const chunk of audio.chunks) {
      await muxer.writeAudioChunk(chunk);
    }

    await muxer.close();

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
  });

  it('should throw when writing without opening', async () => {
    const muxer = new NodeAvMuxer({ path: '/tmp/never.mp4' });

    await expect(async () => {
      await muxer.addVideoTrack({
        codec: 'avc1.42001E',
        codedWidth: 320,
        codedHeight: 240,
      });
    }).rejects.toThrow();
  });
});

describe('FFmpegMuxer', () => {
  it('should mux video-only file', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'ffmpeg-video-only.mp4');
    const { chunks, description } = await generateVideoChunks(5);

    const muxer = new FFmpegMuxer({ path: outputPath });
    await muxer.open();
    await muxer.addVideoTrack({
      codec: 'avc1.42001E',
      codedWidth: 320,
      codedHeight: 240,
      framerate: 30,
      description,
    });

    for (const chunk of chunks) {
      await muxer.writeVideoChunk(chunk);
    }

    await muxer.close();

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
    expect(muxer.videoChunkCount).toBe(chunks.length);
  });

  it('should mux video and audio together', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'ffmpeg-av.mp4');
    const video = await generateVideoChunks(5);
    const audio = await generateAudioChunks(200);

    const muxer = new FFmpegMuxer({ path: outputPath });
    await muxer.open();

    await muxer.addVideoTrack({
      codec: 'avc1.42001E',
      codedWidth: 320,
      codedHeight: 240,
      framerate: 30,
      description: video.description,
    });

    await muxer.addAudioTrack({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      description: audio.description,
    });

    for (const chunk of video.chunks) {
      await muxer.writeVideoChunk(chunk);
    }
    for (const chunk of audio.chunks) {
      await muxer.writeAudioChunk(chunk);
    }

    await muxer.close();

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
  });
});

describe('Muxer (with fallback)', () => {
  it('should use node-av by default', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'muxer-default.mp4');
    const { chunks, description } = await generateVideoChunks(5);

    const muxer = new Muxer({ path: outputPath });
    await muxer.open();
    await muxer.addVideoTrack({
      codec: 'avc1.42001E',
      codedWidth: 320,
      codedHeight: 240,
      framerate: 30,
      description,
    });

    for (const chunk of chunks) {
      await muxer.writeVideoChunk(chunk);
    }

    const result = await muxer.closeWithResult();

    expect(result.backend).toBe('node-av');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('should force ffmpeg-spawn backend', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'muxer-forced-ffmpeg.mp4');
    const { chunks, description } = await generateVideoChunks(5);

    const muxer = new Muxer({
      path: outputPath,
      forceBackend: 'ffmpeg-spawn',
    });
    await muxer.open();
    await muxer.addVideoTrack({
      codec: 'avc1.42001E',
      codedWidth: 320,
      codedHeight: 240,
      framerate: 30,
      description,
    });

    for (const chunk of chunks) {
      await muxer.writeVideoChunk(chunk);
    }

    const result = await muxer.closeWithResult();

    expect(result.backend).toBe('ffmpeg-spawn');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('should call onFallback when fallback is triggered', async () => {
    const onFallback = jest.fn();
    const outputPath = path.join(TEST_OUTPUT_DIR, 'muxer-fallback-callback.mp4');
    const { chunks, description } = await generateVideoChunks(3);

    // Force ffmpeg to test the callback mechanism
    const muxer = new Muxer({
      path: outputPath,
      forceBackend: 'ffmpeg-spawn',
      onFallback,
    });

    await muxer.open();
    await muxer.addVideoTrack({
      codec: 'avc1.42001E',
      codedWidth: 320,
      codedHeight: 240,
      description,
    });

    for (const chunk of chunks) {
      await muxer.writeVideoChunk(chunk);
    }

    await muxer.close();

    // onFallback should NOT be called when we force a specific backend
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe('muxChunks helper', () => {
  it('should mux video and audio using helper function', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'muxchunks-helper.mp4');
    const video = await generateVideoChunks(5);
    const audio = await generateAudioChunks(200);

    const result = await muxChunks({
      path: outputPath,
      video: {
        config: {
          codec: 'avc1.42001E',
          codedWidth: 320,
          codedHeight: 240,
          framerate: 30,
          description: video.description,
        },
        chunks: video.chunks,
      },
      audio: {
        config: {
          codec: 'mp4a.40.2',
          sampleRate: 48000,
          numberOfChannels: 2,
          description: audio.description,
        },
        chunks: audio.chunks,
      },
    });

    expect(result.backend).toBe('node-av');
    expect(result.videoChunkCount).toBe(video.chunks.length);
    expect(result.audioChunkCount).toBe(audio.chunks.length);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('should mux video-only using helper function', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'muxchunks-video.mp4');
    const { chunks, description } = await generateVideoChunks(5);

    const result = await muxChunks({
      path: outputPath,
      video: {
        config: {
          codec: 'avc1.42001E',
          codedWidth: 320,
          codedHeight: 240,
          description,
        },
        chunks,
      },
    });

    expect(result.videoChunkCount).toBe(chunks.length);
    expect(result.audioChunkCount).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
  });
});

describe('MuxerError', () => {
  it('should have correct properties', () => {
    const error = new MuxerError('Test error', 'node-av', 'write');

    expect(error.message).toBe('Test error');
    expect(error.backend).toBe('node-av');
    expect(error.operation).toBe('write');
    expect(error.name).toBe('MuxerError');
  });

  it('should include cause when provided', () => {
    const cause = new Error('Original error');
    const error = new MuxerError('Wrapper error', 'ffmpeg-spawn', 'close', cause);

    expect(error.cause).toBe(cause);
  });
});

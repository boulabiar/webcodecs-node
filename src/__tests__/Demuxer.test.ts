/**
 * Tests for Demuxer class
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { Demuxer, Muxer, muxChunks } from '../containers/index.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { AudioEncoder } from '../encoders/AudioEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { AudioData } from '../core/AudioData.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';

// Test output directory
const TEST_OUTPUT_DIR = path.join(os.tmpdir(), 'demuxer-tests');
const TEST_VIDEO_PATH = path.join(TEST_OUTPUT_DIR, 'test-video.mp4');

// Generate a test video file before running tests
async function createTestVideoFile(): Promise<void> {
  const videoChunks: EncodedVideoChunk[] = [];
  const audioChunks: EncodedAudioChunk[] = [];
  let videoDescription: Uint8Array | undefined;
  let audioDescription: Uint8Array | undefined;

  // Create video encoder
  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      videoChunks.push(chunk);
      if (metadata?.decoderConfig?.description && !videoDescription) {
        const desc = metadata.decoderConfig.description;
        videoDescription = desc instanceof Uint8Array ? desc : new Uint8Array(desc as ArrayBuffer);
      }
    },
    error: (err) => { throw err; },
  });

  videoEncoder.configure({
    codec: 'avc1.42001E',
    width: 320,
    height: 240,
    bitrate: 500_000,
    framerate: 30,
  });

  // Create audio encoder
  const audioEncoder = new AudioEncoder({
    output: (chunk, metadata) => {
      audioChunks.push(chunk);
      if (metadata?.decoderConfig?.description && !audioDescription) {
        const desc = metadata.decoderConfig.description;
        audioDescription = desc instanceof Uint8Array ? desc : new Uint8Array(desc as ArrayBuffer);
      }
    },
    error: (err) => { throw err; },
  });

  audioEncoder.configure({
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 64_000,
  });

  // Generate 30 frames (1 second at 30fps)
  for (let i = 0; i < 30; i++) {
    const data = new Uint8Array(320 * 240 * 4);
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 320; x++) {
        const idx = (y * 320 + x) * 4;
        data[idx] = (x + i * 10) % 256;
        data[idx + 1] = (y + i * 10) % 256;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
      }
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 320,
      codedHeight: 240,
      timestamp: i * 33333,
    });

    videoEncoder.encode(frame, { keyFrame: i % 10 === 0 });
    frame.close();
  }

  // Generate ~1 second of audio
  const samplesPerFrame = 1024;
  const sampleRate = 48000;
  for (let i = 0; i < 47; i++) { // ~1 second
    const samples = new Float32Array(samplesPerFrame * 2);
    const freq = 440;
    for (let s = 0; s < samplesPerFrame; s++) {
      const t = (i * samplesPerFrame + s) / sampleRate;
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.3;
      samples[s * 2] = sample;
      samples[s * 2 + 1] = sample;
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: samplesPerFrame,
      numberOfChannels: 2,
      timestamp: i * samplesPerFrame * 1_000_000 / sampleRate,
      data: samples,
    });

    audioEncoder.encode(audioData);
    audioData.close();
  }

  await videoEncoder.flush();
  await audioEncoder.flush();
  videoEncoder.close();
  audioEncoder.close();

  // Mux to file
  await muxChunks({
    path: TEST_VIDEO_PATH,
    video: {
      config: {
        codec: 'avc1.42001E',
        codedWidth: 320,
        codedHeight: 240,
        framerate: 30,
        description: videoDescription,
      },
      chunks: videoChunks,
    },
    audio: {
      config: {
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        description: audioDescription,
      },
      chunks: audioChunks,
    },
  });
}

beforeAll(async () => {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  await createTestVideoFile();
}, 60000); // 60 second timeout for file creation

afterAll(() => {
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
});

describe('Demuxer', () => {
  describe('open and close', () => {
    it('should open and close a valid file', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      expect(demuxer.videoConfig).not.toBeNull();
      expect(demuxer.audioConfig).not.toBeNull();

      await demuxer.close();
    });

    it('should throw when opening non-existent file', async () => {
      const demuxer = new Demuxer({ path: '/nonexistent/file.mp4' });

      await expect(demuxer.open()).rejects.toThrow();
    });
  });

  describe('video stream', () => {
    it('should get video stream configuration', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      const config = demuxer.videoConfig;

      expect(config).toBeDefined();
      expect(config!.codedWidth).toBe(320);
      expect(config!.codedHeight).toBe(240);
      expect(config!.codec).toContain('avc');

      await demuxer.close();
    });

    it('should iterate video chunks', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      const chunks: EncodedVideoChunk[] = [];
      for await (const chunk of demuxer.videoChunks()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      // Should have key frames
      expect(chunks.some(c => c.type === 'key')).toBe(true);

      await demuxer.close();
    });

    it('should provide video description', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      const config = demuxer.videoConfig;

      expect(config!.description).toBeDefined();
      expect(config!.description!.length).toBeGreaterThan(0);

      await demuxer.close();
    });
  });

  describe('audio stream', () => {
    it('should get audio stream configuration', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      const config = demuxer.audioConfig;

      expect(config).toBeDefined();
      expect(config!.sampleRate).toBe(48000);
      expect(config!.numberOfChannels).toBe(2);
      expect(config!.codec).toContain('mp4a');

      await demuxer.close();
    });

    it('should iterate audio chunks', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      const chunks: EncodedAudioChunk[] = [];
      for await (const chunk of demuxer.audioChunks()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);

      await demuxer.close();
    });
  });

  describe('interleaved reading', () => {
    it('should read all chunks interleaved', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      let videoCount = 0;
      let audioCount = 0;

      for await (const item of demuxer.chunks()) {
        if (item.type === 'video') {
          videoCount++;
        } else if (item.type === 'audio') {
          audioCount++;
        }
      }

      expect(videoCount).toBeGreaterThan(0);
      expect(audioCount).toBeGreaterThan(0);

      await demuxer.close();
    });
  });

  describe('duration', () => {
    it('should report duration', async () => {
      const demuxer = new Demuxer({ path: TEST_VIDEO_PATH });
      await demuxer.open();

      const duration = demuxer.duration;

      // Should be approximately 1 second (in seconds)
      expect(duration).toBeGreaterThan(0.5);
      expect(duration).toBeLessThan(2);

      await demuxer.close();
    });
  });
});

describe('Round-trip: Muxer -> Demuxer', () => {
  it('should preserve video data through mux/demux cycle', async () => {
    const originalPath = TEST_VIDEO_PATH;
    const remuxedPath = path.join(TEST_OUTPUT_DIR, 'remuxed.mp4');

    // Demux original
    const demuxer1 = new Demuxer({ path: originalPath });
    await demuxer1.open();

    const videoConfig = demuxer1.videoConfig!;
    const audioConfig = demuxer1.audioConfig!;

    const videoChunks: EncodedVideoChunk[] = [];
    const audioChunks: EncodedAudioChunk[] = [];

    for await (const chunk of demuxer1.videoChunks()) {
      videoChunks.push(chunk);
    }

    // Re-open to read audio (separate iteration)
    await demuxer1.close();
    const demuxer1b = new Demuxer({ path: originalPath });
    await demuxer1b.open();

    for await (const chunk of demuxer1b.audioChunks()) {
      audioChunks.push(chunk);
    }
    await demuxer1b.close();

    // Remux
    await muxChunks({
      path: remuxedPath,
      video: {
        config: {
          codec: videoConfig.codec,
          codedWidth: videoConfig.codedWidth,
          codedHeight: videoConfig.codedHeight,
          description: videoConfig.description,
        },
        chunks: videoChunks,
      },
      audio: {
        config: {
          codec: audioConfig.codec,
          sampleRate: audioConfig.sampleRate,
          numberOfChannels: audioConfig.numberOfChannels,
          description: audioConfig.description,
        },
        chunks: audioChunks,
      },
    });

    // Demux remuxed file
    const demuxer2 = new Demuxer({ path: remuxedPath });
    await demuxer2.open();

    const remuxedVideoConfig = demuxer2.videoConfig!;
    const remuxedAudioConfig = demuxer2.audioConfig!;

    // Verify configs match
    expect(remuxedVideoConfig.codedWidth).toBe(videoConfig.codedWidth);
    expect(remuxedVideoConfig.codedHeight).toBe(videoConfig.codedHeight);
    expect(remuxedAudioConfig.sampleRate).toBe(audioConfig.sampleRate);
    expect(remuxedAudioConfig.numberOfChannels).toBe(audioConfig.numberOfChannels);

    // Verify chunk counts match
    let remuxedVideoCount = 0;
    for await (const _ of demuxer2.videoChunks()) {
      remuxedVideoCount++;
    }
    expect(remuxedVideoCount).toBe(videoChunks.length);

    await demuxer2.close();
  });
});

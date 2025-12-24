/**
 * Tests for transcode utilities (transcode, remux, getMediaInfo)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { transcode, remux, getMediaInfo, Muxer } from '../containers/index.js';
import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { AudioEncoder } from '../encoders/AudioEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { AudioData } from '../core/AudioData.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';

// Test output directory
const TEST_OUTPUT_DIR = path.join(os.tmpdir(), 'transcode-tests');
const TEST_VIDEO_PATH = path.join(TEST_OUTPUT_DIR, 'test-input.mp4');

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

  // Generate 15 frames (0.5 seconds at 30fps)
  for (let i = 0; i < 15; i++) {
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

  // Generate ~0.5 second of audio
  const samplesPerFrame = 1024;
  const sampleRate = 48000;
  for (let i = 0; i < 24; i++) {
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
  const muxer = new Muxer({ path: TEST_VIDEO_PATH });
  await muxer.open();
  await muxer.addVideoTrack({
    codec: 'avc1.42001E',
    codedWidth: 320,
    codedHeight: 240,
    framerate: 30,
    description: videoDescription,
  });
  await muxer.addAudioTrack({
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2,
    description: audioDescription,
  });

  for (const chunk of videoChunks) {
    await muxer.writeVideoChunk(chunk);
  }
  for (const chunk of audioChunks) {
    await muxer.writeAudioChunk(chunk);
  }

  await muxer.close();
}

beforeAll(async () => {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  await createTestVideoFile();
}, 60000);

afterAll(() => {
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
});

describe('getMediaInfo', () => {
  it('should return media info for a valid file', async () => {
    const info = await getMediaInfo(TEST_VIDEO_PATH);

    expect(info.format).toBeDefined();
    expect(info.duration).toBeGreaterThan(0);
    expect(info.video).toBeDefined();
    expect(info.video!.width).toBe(320);
    expect(info.video!.height).toBe(240);
    expect(info.video!.codec).toContain('avc');
    expect(info.audio).toBeDefined();
    expect(info.audio!.sampleRate).toBe(48000);
    expect(info.audio!.channels).toBe(2);
  });

  it('should throw for non-existent file', async () => {
    await expect(getMediaInfo('/nonexistent/file.mp4')).rejects.toThrow();
  });
});

describe('remux', () => {
  it('should remux MP4 to another MP4', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'remuxed.mp4');

    await remux(TEST_VIDEO_PATH, outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);

    // Verify output has same streams
    const info = await getMediaInfo(outputPath);
    expect(info.video).toBeDefined();
    expect(info.audio).toBeDefined();
    expect(info.video!.width).toBe(320);
    expect(info.video!.height).toBe(240);
  });

  it('should throw when remuxing to incompatible container', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'remuxed.webm');

    // WebM requires VP8/VP9/AV1 for video and Opus/Vorbis for audio
    // Since our source is H.264/AAC, this should fail
    await expect(remux(TEST_VIDEO_PATH, outputPath)).rejects.toThrow();
  });
});

describe('transcode', () => {
  it('should transcode with stream copy', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'stream-copy.mp4');

    const result = await transcode(TEST_VIDEO_PATH, outputPath, {
      videoCodec: 'copy',
      audioCodec: 'copy',
    });

    expect(result.videoFrames).toBe(0); // Stream copy doesn't count frames
    expect(result.audioFrames).toBe(0);
    expect(result.outputSize).toBeGreaterThan(0);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('should transcode video to H.264', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'transcoded-h264.mp4');

    const result = await transcode(TEST_VIDEO_PATH, outputPath, {
      videoCodec: 'h264',
      videoBitrate: 300_000,
      audioCodec: 'copy',
    });

    expect(result.videoFrames).toBeGreaterThan(0);
    expect(result.outputSize).toBeGreaterThan(0);
    expect(fs.existsSync(outputPath)).toBe(true);

    // Verify output
    const info = await getMediaInfo(outputPath);
    expect(info.video).toBeDefined();
    expect(info.video!.codec).toContain('avc');
  }, 30000);

  it('should transcode audio to AAC', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'transcoded-aac.mp4');

    const result = await transcode(TEST_VIDEO_PATH, outputPath, {
      videoCodec: 'copy',
      audioCodec: 'aac',
      audioBitrate: 96_000,
    });

    expect(result.audioFrames).toBeGreaterThan(0);
    expect(result.outputSize).toBeGreaterThan(0);
    expect(fs.existsSync(outputPath)).toBe(true);
  }, 30000);

  it('should call onProgress callback', async () => {
    const outputPath = path.join(TEST_OUTPUT_DIR, 'progress-test.mp4');
    const progressCalls: number[] = [];

    await transcode(TEST_VIDEO_PATH, outputPath, {
      videoCodec: 'h264',
      videoBitrate: 300_000,
      audioCodec: 'copy',
      onProgress: (progress) => {
        progressCalls.push(progress.videoFrames);
      },
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    // Progress should be monotonically increasing
    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i]).toBeGreaterThanOrEqual(progressCalls[i - 1]);
    }
  }, 30000);
});

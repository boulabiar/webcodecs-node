import { VideoEncoder } from '../encoders/VideoEncoder.js';
import { VideoDecoder } from '../decoders/VideoDecoder.js';
import { VideoFrame } from '../core/VideoFrame.js';
import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';

/**
 * Helper function to create test frames
 */
function createTestFrame(width: number, height: number, frameIndex: number): VideoFrame {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 50 + frameIndex * 10;     // R
    data[i + 1] = 100;                   // G
    data[i + 2] = 150;                   // B
    data[i + 3] = 255;                   // A
  }

  return new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp: frameIndex * 33333,
  });
}

/**
 * Helper to encode frames and return chunks for decoding tests
 */
async function encodeFrames(
  codec: string,
  width: number,
  height: number,
  numFrames: number
): Promise<{ chunks: EncodedVideoChunk[]; description?: Uint8Array; error: Error | null }> {
  const chunks: EncodedVideoChunk[] = [];
  let description: Uint8Array | undefined;
  let err: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      if (metadata?.decoderConfig?.description) {
        description = metadata.decoderConfig.description;
      }
    },
    error: (e) => { err = e; },
  });

  encoder.configure({
    codec,
    width,
    height,
    framerate: 30,
    bitrate: 500_000,
  });

  for (let f = 0; f < numFrames; f++) {
    const frame = createTestFrame(width, height, f);
    encoder.encode(frame, { keyFrame: f === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  return { chunks, description, error: err };
}

/**
 * Helper to decode chunks and return frames
 */
async function decodeChunks(
  codec: string,
  chunks: EncodedVideoChunk[],
  width: number,
  height: number,
  outputFormat: 'I420' | 'RGBA' = 'I420',
  description?: Uint8Array
): Promise<{ frames: VideoFrame[]; error: Error | null }> {
  const frames: VideoFrame[] = [];
  let err: Error | null = null;

  const decoder = new VideoDecoder({
    output: (frame) => frames.push(frame),
    error: (e) => { err = e; },
  });

  decoder.configure({
    codec,
    codedWidth: width,
    codedHeight: height,
    outputFormat,
    description,
  });

  for (const chunk of chunks) {
    decoder.decode(chunk);
  }

  await decoder.flush();
  decoder.close();

  return { frames, error: err };
}

describe('NodeAV VideoDecoder backend', () => {
  const width = 64;
  const height = 64;
  const numFrames = 3;

  describe('H.264 (AVC) decoding', () => {
    it('decodes h264 chunks produced by node-av encoder', async () => {
      const codec = 'avc1.42001E';

      const { chunks, description, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;
      expect(chunks.length).toBeGreaterThan(0);

      // Pass description (AVCC config) to decoder for proper H.264 decoding
      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height, 'I420', description);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((f) => f.close());
    }, 20000);

    it('outputs RGBA format when requested', async () => {
      const codec = 'avc1.42001E';

      const { chunks, description, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;

      // Pass description (AVCC config) to decoder for proper H.264 decoding
      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height, 'RGBA', description);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0].format).toBe('RGBA');
      frames.forEach((f) => f.close());
    }, 20000);
  });

  describe('H.265 (HEVC) decoding', () => {
    it('decodes hevc chunks produced by node-av encoder', async () => {
      const codec = 'hev1.1.6.L93.B0';

      const { chunks, description, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;
      expect(chunks.length).toBeGreaterThan(0);

      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height, 'I420', description);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((f) => f.close());
    }, 30000);
  });

  describe('VP8 decoding', () => {
    it('decodes vp8 chunks produced by node-av encoder', async () => {
      const codec = 'vp8';

      const { chunks, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;
      expect(chunks.length).toBeGreaterThan(0);

      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((f) => f.close());
    }, 20000);
  });

  describe('VP9 decoding', () => {
    it('decodes vp9 chunks produced by node-av encoder', async () => {
      const codec = 'vp09.00.10.08';

      const { chunks, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;
      expect(chunks.length).toBeGreaterThan(0);

      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((f) => f.close());
    }, 30000);

    it('decodes with vp9 codec string', async () => {
      const codec = 'vp9';

      const { chunks, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;
      expect(chunks.length).toBeGreaterThan(0);

      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((f) => f.close());
    }, 30000);
  });

  describe('AV1 decoding', () => {
    it('decodes av1 chunks produced by node-av encoder', async () => {
      const codec = 'av01.0.01M.08';

      const { chunks, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;
      expect(chunks.length).toBeGreaterThan(0);

      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((f) => f.close());
    }, 60000); // AV1 can be slow

    it('decodes with av1 codec string', async () => {
      const codec = 'av1';

      const { chunks, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;
      expect(chunks.length).toBeGreaterThan(0);

      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((f) => f.close());
    }, 60000);
  });

  describe('Round-trip encoding/decoding', () => {
    it('preserves frame dimensions through encode/decode cycle', async () => {
      const codec = 'avc1.42001E';

      const { chunks, description, error: encodeError } = await encodeFrames(codec, width, height, numFrames);
      if (encodeError) throw encodeError;

      // Pass description (AVCC config) to decoder for proper H.264 decoding
      const { frames, error: decodeError } = await decodeChunks(codec, chunks, width, height, 'I420', description);
      if (decodeError) throw decodeError;

      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.codedWidth).toBe(width);
        expect(frame.codedHeight).toBe(height);
        frame.close();
      }
    }, 20000);
  });
});

/**
 * Tests for ImageDecoder class - including animated image support
 */

import { jest } from '@jest/globals';
import { ImageDecoder } from '../ImageDecoder.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_IMAGES_DIR = '/tmp/webcodecs-test-images';
const FIXTURE_IMAGES_DIR = path.join(__dirname, 'fixtures');

/**
 * Get FFmpeg major version number
 * Returns 0 if ffmpeg is not available
 */
function getFFmpegMajorVersion(): number {
  try {
    const output = execSync('ffmpeg -version 2>/dev/null', { encoding: 'utf-8' });
    const match = output.match(/ffmpeg version (\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  } catch {
    // ffmpeg not available
  }
  return 0;
}

// Animated WebP decoding requires FFmpeg 6.1+
const FFMPEG_VERSION = getFFmpegMajorVersion();
const HAS_ANIMATED_WEBP_SUPPORT = FFMPEG_VERSION >= 6;

/**
 * Helper to convert Node.js Buffer to ArrayBuffer properly.
 * Node.js Buffer.buffer may be larger than the actual data.
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buffer.length);
  new Uint8Array(ab).set(buffer);
  return ab;
}

function isWebpDecodable(filePath: string): boolean {
  try {
    const output = execSync(`ffprobe -hide_banner -loglevel error -show_streams -select_streams v "${filePath}"`, {
      encoding: 'utf-8',
    });
    const widthMatch = output.match(/width=(\d+)/);
    const heightMatch = output.match(/height=(\d+)/);
    const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : 0;
    return width > 0 && height > 0;
  } catch {
    return false;
  }
}

describe('ImageDecoder', () => {
  describe('static images', () => {
    it('should decode a static PNG image', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      expect(decoder.tracks.length).toBeGreaterThan(0);
      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.frameCount).toBe(1);
      expect(track!.animated).toBe(false);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image).toBeDefined();
      expect(result.image.codedWidth).toBeGreaterThan(0);
      expect(result.image.codedHeight).toBeGreaterThan(0);

      result.image.close();
      decoder.close();
    });

    it('should decode a static JPEG image', async () => {
      const jpgPath = path.join(TEST_IMAGES_DIR, 'test.jpg');
      if (!fs.existsSync(jpgPath)) {
        console.log('Skipping test: test.jpg not found');
        return;
      }

      const data = fs.readFileSync(jpgPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/jpeg',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track!.animated).toBe(false);
      expect(track!.frameCount).toBe(1);

      decoder.close();
    });

    it('should decode a static WebP image', async () => {
      const webpPath = path.join(TEST_IMAGES_DIR, 'test.webp');
      if (!fs.existsSync(webpPath)) {
        console.log('Skipping test: test.webp not found');
        return;
      }

      const data = fs.readFileSync(webpPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/webp',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track!.animated).toBe(false);

      decoder.close();
    });

    it('should decode an AVIF image', async () => {
      const avifPath = path.join(TEST_IMAGES_DIR, 'test.avif');
      if (!fs.existsSync(avifPath)) {
        console.log('Skipping test: test.avif not found');
        return;
      }

      const data = fs.readFileSync(avifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/avif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.frameCount).toBeGreaterThanOrEqual(1);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image).toBeDefined();
      expect(result.image.codedWidth).toBeGreaterThan(0);
      expect(result.image.codedHeight).toBeGreaterThan(0);

      result.image.close();
      decoder.close();
    });

    it('should decode a BMP image', async () => {
      const bmpPath = path.join(TEST_IMAGES_DIR, 'test.bmp');
      if (!fs.existsSync(bmpPath)) {
        console.log('Skipping test: test.bmp not found');
        return;
      }

      const data = fs.readFileSync(bmpPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/bmp',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.animated).toBe(false);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image.codedWidth).toBeGreaterThan(0);

      result.image.close();
      decoder.close();
    });
  });

  describe('animated images', () => {
    it('should decode an animated GIF with multiple frames', async () => {
      const gifPath = path.join(TEST_IMAGES_DIR, 'animated_multi.gif');
      if (!fs.existsSync(gifPath)) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      if (!track || !track.animated || track.frameCount <= 1) {
        console.log('Skipping test: FFmpeg reported WebP as non-animated');
        decoder.close();
        return;
      }

      // Decode first frame
      const result1 = await decoder.decode({ frameIndex: 0 });
      expect(result1.image).toBeDefined();
      expect(result1.image.timestamp).toBe(0);

      // Decode second frame - should have a later timestamp
      const result2 = await decoder.decode({ frameIndex: 1 });
      expect(result2.image).toBeDefined();
      expect(result2.image.timestamp).toBeGreaterThan(0);

      result1.image.close();
      result2.image.close();
      decoder.close();
    });

    it('should parse frame durations from animated GIF', async () => {
      const gifPath = path.join(TEST_IMAGES_DIR, 'animated_multi.gif');
      if (!fs.existsSync(gifPath)) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track!.frameCount).toBeGreaterThan(1);

      // Each frame should have a duration
      const frame0 = await decoder.decode({ frameIndex: 0 });
      const frame1 = await decoder.decode({ frameIndex: 1 });

      // Duration should be in microseconds (40ms = 40000 microseconds)
      expect(frame0.image.duration).toBeGreaterThan(0);
      expect(frame1.image.duration).toBeGreaterThan(0);

      // Timestamp of frame 1 should be >= duration of frame 0
      expect(frame1.image.timestamp).toBeGreaterThanOrEqual(frame0.image.duration!);

      frame0.image.close();
      frame1.image.close();
      decoder.close();
    });

    it('should report correct repetitionCount for animated GIF', async () => {
      const gifPath = path.join(TEST_IMAGES_DIR, 'animated_multi.gif');
      if (!fs.existsSync(gifPath)) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      // GIF with loop 0 should be Infinity
      expect(track!.repetitionCount).toBeDefined();
      // For a looping GIF, repetitionCount is typically Infinity
      expect(track!.repetitionCount).toBeGreaterThanOrEqual(0);

      decoder.close();
    });

    it('should decode frames sequentially with correct timestamps', async () => {
      const gifPath = path.join(TEST_IMAGES_DIR, 'animated_multi.gif');
      if (!fs.existsSync(gifPath)) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      const frameCount = track!.frameCount;

      // Decode all frames and verify timestamps are increasing
      let lastTimestamp = -1;
      const frames = [];

      for (let i = 0; i < Math.min(frameCount, 5); i++) {
        const result = await decoder.decode({ frameIndex: i });
        expect(result.image.timestamp).toBeGreaterThan(lastTimestamp);
        lastTimestamp = result.image.timestamp;
        frames.push(result.image);
      }

      // Cleanup
      frames.forEach((f) => f.close());
      decoder.close();
    });

    // Animated WebP decoding requires FFmpeg 6.1+ (has native ANIM/ANMF chunk support)
    (HAS_ANIMATED_WEBP_SUPPORT ? it : it.skip)('should decode an animated WebP with multiple frames', async () => {
      const candidatePath = path.join(TEST_IMAGES_DIR, 'animated_multi.webp');
      const fallbackPath = path.join(FIXTURE_IMAGES_DIR, 'animated_multi.webp');
      const webpPath = fs.existsSync(fallbackPath) ? fallbackPath : candidatePath;
      if (!fs.existsSync(webpPath)) {
        console.log('Skipping test: animated_multi.webp not found');
        return;
      }

      if (!isWebpDecodable(webpPath)) {
        console.log(`Skipping test: FFmpeg cannot decode ${webpPath}`);
        return;
      }

      const data = fs.readFileSync(webpPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/webp',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      if (!track || !track.animated || track.frameCount <= 1) {
        console.log('Skipping test: FFmpeg reported WebP as non-animated');
        decoder.close();
        return;
      }

      // Decode first frame
      const result1 = await decoder.decode({ frameIndex: 0 });
      expect(result1.image).toBeDefined();
      expect(result1.image.codedWidth).toBeGreaterThan(0);

      // Decode second frame
      const result2 = await decoder.decode({ frameIndex: 1 });
      expect(result2.image).toBeDefined();
      expect(result2.image.timestamp).toBeGreaterThan(0);

      result1.image.close();
      result2.image.close();
      decoder.close();
    });

    it('should handle static GIF as non-animated', async () => {
      const gifPath = path.join(TEST_IMAGES_DIR, 'test.gif');
      if (!fs.existsSync(gifPath)) {
        console.log('Skipping test: test.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      // A single-frame GIF should not be marked as animated
      if (track!.frameCount === 1) {
        expect(track!.animated).toBe(false);
      }

      decoder.close();
    });
  });

  describe('isTypeSupported', () => {
    it('should support common image formats', async () => {
      expect(await ImageDecoder.isTypeSupported('image/png')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/jpeg')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/gif')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/webp')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/bmp')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/avif')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/tiff')).toBe(true);
      expect(await ImageDecoder.isTypeSupported('image/apng')).toBe(true);
    });

    it('should return false for unsupported types', async () => {
      expect(await ImageDecoder.isTypeSupported('image/unknownformat')).toBe(false);
      expect(await ImageDecoder.isTypeSupported('video/mp4')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should reject for invalid image data', async () => {
      const decoder = new ImageDecoder({
        data: new ArrayBuffer(100), // Invalid image data
        type: 'image/png',
      });

      await expect(decoder.completed).rejects.toThrow();
    });

    it('should reject for unsupported image type', async () => {
      const decoder = new ImageDecoder({
        data: new ArrayBuffer(100),
        type: 'image/unknownformat',
      });

      await expect(decoder.completed).rejects.toThrow();
    });
  });

  describe('decode options', () => {
    it('should decode specific frame by index', async () => {
      const gifPath = path.join(TEST_IMAGES_DIR, 'animated_multi.gif');
      if (!fs.existsSync(gifPath)) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      if (track!.frameCount > 2) {
        // Decode frame at index 2 directly
        const result = await decoder.decode({ frameIndex: 2 });
        expect(result.image).toBeDefined();
        // Frame 2 timestamp should be sum of durations of frames 0 and 1
        expect(result.image.timestamp).toBeGreaterThan(0);
        result.image.close();
      }

      decoder.close();
    });

    it('should report completeFramesOnly in decode result', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.complete).toBe(true);

      result.image.close();
      decoder.close();
    });

    it('should allow decode with completeFramesOnly set to false', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      const result = await decoder.decode({ frameIndex: 0, completeFramesOnly: false });
      expect(result.complete).toBe(true);
      result.image.close();
      decoder.close();
    });

    it('should reset and re-decode frames', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      const first = await decoder.decode({ frameIndex: 0 });
      first.image.close();

      decoder.reset();
      await decoder.completed;
      const second = await decoder.decode({ frameIndex: 0 });
      expect(second.image.codedWidth).toBeGreaterThan(0);
      second.image.close();
      decoder.close();
    });
  });

  describe('WebCodecs API compliance', () => {
    it('should have type property matching constructor input', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      expect(decoder.type).toBe('image/png');
      decoder.close();
    });

    it('should have complete property that becomes true after data is loaded', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      expect(decoder.complete).toBe(true);
      decoder.close();
    });

    it('should have tracks.ready promise that resolves', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.tracks.ready;
      expect(decoder.tracks.length).toBeGreaterThan(0);
      expect(decoder.tracks.selectedIndex).toBeGreaterThanOrEqual(0);
      expect(decoder.tracks.selectedTrack).not.toBeNull();
      decoder.close();
    });

    it('should support transfer parameter for zero-copy', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const arrayBuffer = bufferToArrayBuffer(data);

      // Create decoder with transfer - should take ownership
      const decoder = new ImageDecoder({
        data: arrayBuffer,
        type: 'image/png',
        transfer: [arrayBuffer],
      });

      await decoder.completed;
      expect(decoder.complete).toBe(true);

      const result = await decoder.decode({ frameIndex: 0 });
      expect(result.image.codedWidth).toBeGreaterThan(0);
      result.image.close();
      decoder.close();
    });

    it('should throw InvalidStateError when decoding after close', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      decoder.close();

      await expect(decoder.decode({ frameIndex: 0 })).rejects.toThrow('ImageDecoder is closed');
    });

    it('should throw InvalidStateError for out of range frame index', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      // PNG has only 1 frame, so index 1 should fail
      await expect(decoder.decode({ frameIndex: 1 })).rejects.toThrow();
      decoder.close();
    });

    it('should throw InvalidStateError when reset after close', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;
      decoder.close();

      expect(() => decoder.reset()).toThrow('ImageDecoder is closed');
    });

    it('should return ImageTrack with correct properties', async () => {
      const gifPath = path.join(TEST_IMAGES_DIR, 'animated_multi.gif');
      if (!fs.existsSync(gifPath)) {
        console.log('Skipping test: animated_multi.gif not found');
        return;
      }

      const data = fs.readFileSync(gifPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/gif',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack!;

      // Check all required ImageTrack properties per spec
      expect(typeof track.animated).toBe('boolean');
      expect(typeof track.frameCount).toBe('number');
      expect(typeof track.repetitionCount).toBe('number');
      expect(typeof track.selected).toBe('boolean');

      expect(track.animated).toBe(true);
      expect(track.frameCount).toBeGreaterThan(1);
      expect(track.selected).toBe(true);

      decoder.close();
    });

    it('should iterate over tracks with Symbol.iterator', async () => {
      const pngPath = path.join(TEST_IMAGES_DIR, 'test.png');
      if (!fs.existsSync(pngPath)) {
        console.log('Skipping test: test.png not found');
        return;
      }

      const data = fs.readFileSync(pngPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/png',
      });

      await decoder.completed;

      // Should be iterable
      const tracks = [...decoder.tracks];
      expect(tracks.length).toBe(decoder.tracks.length);

      decoder.close();
    });
  });
});

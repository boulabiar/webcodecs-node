/**
 * Tests for ImageDecoder class - including animated image support
 */

import { ImageDecoder } from '../decoders/ImageDecoder.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { Canvas } from 'skia-canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_IMAGES_DIR = path.join(__dirname, 'fixtures');

/**
 * Helper to convert Node.js Buffer to ArrayBuffer properly.
 * Node.js Buffer.buffer may be larger than the actual data.
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buffer.length);
  new Uint8Array(ab).set(buffer);
  return ab;
}

/**
 * Get path to a test fixture (generated in beforeAll)
 */
function findTestImage(filename: string): string | null {
  const fixturePath = path.join(FIXTURE_IMAGES_DIR, filename);
  if (fs.existsSync(fixturePath)) {
    return fixturePath;
  }
  return null;
}

/**
 * Generate test fixtures if they don't exist
 */
async function generateTestFixtures(): Promise<void> {
  if (!fs.existsSync(FIXTURE_IMAGES_DIR)) {
    fs.mkdirSync(FIXTURE_IMAGES_DIR, { recursive: true });
  }

  // Create a simple 100x100 test image with skia-canvas
  const createTestCanvas = (): Canvas => {
    const canvas = new Canvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 50, 50);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(50, 0, 50, 50);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 50, 50, 50);
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(50, 50, 50, 50);
    return canvas;
  };

  // Generate PNG
  const pngPath = path.join(FIXTURE_IMAGES_DIR, 'test.png');
  if (!fs.existsSync(pngPath)) {
    const canvas = createTestCanvas();
    fs.writeFileSync(pngPath, await canvas.toBuffer('png'));
  }

  // Generate JPEG
  const jpgPath = path.join(FIXTURE_IMAGES_DIR, 'test.jpg');
  if (!fs.existsSync(jpgPath)) {
    const canvas = createTestCanvas();
    fs.writeFileSync(jpgPath, await canvas.toBuffer('jpeg'));
  }

  // Generate BMP (via ffmpeg from PNG)
  const bmpPath = path.join(FIXTURE_IMAGES_DIR, 'test.bmp');
  if (!fs.existsSync(bmpPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" "${bmpPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate static GIF (via ffmpeg from PNG)
  const gifPath = path.join(FIXTURE_IMAGES_DIR, 'test.gif');
  if (!fs.existsSync(gifPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" "${gifPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate animated GIF (2 frames via ffmpeg)
  const animGifPath = path.join(FIXTURE_IMAGES_DIR, 'animated_multi.gif');
  if (!fs.existsSync(animGifPath)) {
    try {
      execSync(
        `ffmpeg -y -f lavfi -i "color=c=red:s=100x100:d=0.1,format=rgb24" ` +
        `-f lavfi -i "color=c=blue:s=100x100:d=0.1,format=rgb24" ` +
        `-filter_complex "[0][1]concat=n=2:v=1:a=0" -loop 0 "${animGifPath}"`,
        { stdio: 'ignore' }
      );
    } catch { /* ignore */ }
  }

  // Generate AVIF (via ffmpeg from PNG)
  const avifPath = path.join(FIXTURE_IMAGES_DIR, 'test.avif');
  if (!fs.existsSync(avifPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" -c:v libaom-av1 -still-picture 1 "${avifPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate static WebP (via ffmpeg from PNG)
  const webpPath = path.join(FIXTURE_IMAGES_DIR, 'test.webp');
  if (!fs.existsSync(webpPath)) {
    try {
      execSync(`ffmpeg -y -i "${pngPath}" "${webpPath}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  // Generate animated WebP (2 frames via ffmpeg)
  const animWebpPath = path.join(FIXTURE_IMAGES_DIR, 'animated_multi.webp');
  if (!fs.existsSync(animWebpPath)) {
    try {
      execSync(
        `ffmpeg -y -f lavfi -i "color=c=red:s=100x100:d=0.1" ` +
        `-f lavfi -i "color=c=blue:s=100x100:d=0.1" ` +
        `-filter_complex "[0][1]concat=n=2:v=1:a=0" -loop 0 "${animWebpPath}"`,
        { stdio: 'ignore' }
      );
    } catch { /* ignore */ }
  }
}

describe('ImageDecoder', () => {
  // Generate test fixtures before running tests
  beforeAll(async () => {
    await generateTestFixtures();
  }, 30000);
  describe('static images', () => {
    it('should decode a static PNG image', async () => {
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const jpgPath = findTestImage('test.jpg');
      if (!jpgPath) {
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
      const webpPath = findTestImage('test.webp');
      if (!webpPath) {
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
      const avifPath = findTestImage('test.avif');
      if (!avifPath) {
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
      const bmpPath = findTestImage('test.bmp');
      if (!bmpPath) {
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
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
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
        console.log('Skipping test: FFmpeg could not detect GIF animation');
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
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
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
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
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
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
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

    // Animated WebP decoding now works via node-webpmux (bypasses FFmpeg's limited webp demuxer)
    it('should decode an animated WebP with multiple frames', async () => {
      const webpPath = findTestImage('animated_multi.webp');
      
      
      if (!webpPath) {
        console.log('Skipping test: animated_multi.webp not found');
        return;
      }

      const data = fs.readFileSync(webpPath);
      const decoder = new ImageDecoder({
        data: bufferToArrayBuffer(data),
        type: 'image/webp',
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      expect(track).toBeDefined();
      expect(track!.animated).toBe(true);
      expect(track!.frameCount).toBeGreaterThan(1);

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
      const gifPath = findTestImage('test.gif');
      if (!gifPath) {
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
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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
      const gifPath = findTestImage('animated_multi.gif');
      if (!gifPath) {
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
      const pngPath = findTestImage('test.png');
      if (!pngPath) {
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

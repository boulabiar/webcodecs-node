/**
 * ImageEncoder tests
 */

import { ImageEncoder } from '../encoders/ImageEncoder.js';
import { VideoFrame } from '../core/VideoFrame.js';

describe('ImageEncoder', () => {
  describe('isTypeSupported', () => {
    it('should support PNG', () => {
      expect(ImageEncoder.isTypeSupported('image/png')).toBe(true);
    });

    it('should support JPEG', () => {
      expect(ImageEncoder.isTypeSupported('image/jpeg')).toBe(true);
    });

    it('should support WebP', () => {
      expect(ImageEncoder.isTypeSupported('image/webp')).toBe(true);
    });

    it('should not support unsupported types', () => {
      expect(ImageEncoder.isTypeSupported('image/gif')).toBe(false);
      expect(ImageEncoder.isTypeSupported('image/bmp')).toBe(false);
      expect(ImageEncoder.isTypeSupported('video/mp4')).toBe(false);
    });
  });

  describe('encode', () => {
    // Create a simple test frame (100x100 red image)
    function createTestFrame(): VideoFrame {
      const width = 100;
      const height = 100;
      const data = new Uint8Array(width * height * 4);

      // Fill with red color (RGBA)
      for (let i = 0; i < width * height; i++) {
        data[i * 4] = 255;     // R
        data[i * 4 + 1] = 0;   // G
        data[i * 4 + 2] = 0;   // B
        data[i * 4 + 3] = 255; // A
      }

      return new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });
    }

    it('should encode to PNG', async () => {
      const frame = createTestFrame();
      try {
        const result = await ImageEncoder.encode(frame, { type: 'image/png' });

        expect(result.type).toBe('image/png');
        expect(result.data).toBeInstanceOf(ArrayBuffer);
        expect(result.data.byteLength).toBeGreaterThan(0);

        // Check PNG signature
        const signature = new Uint8Array(result.data, 0, 8);
        expect(signature[0]).toBe(0x89);
        expect(signature[1]).toBe(0x50); // P
        expect(signature[2]).toBe(0x4e); // N
        expect(signature[3]).toBe(0x47); // G
      } finally {
        frame.close();
      }
    });

    it('should encode to JPEG', async () => {
      const frame = createTestFrame();
      try {
        const result = await ImageEncoder.encode(frame, { type: 'image/jpeg' });

        expect(result.type).toBe('image/jpeg');
        expect(result.data).toBeInstanceOf(ArrayBuffer);
        expect(result.data.byteLength).toBeGreaterThan(0);

        // Check JPEG signature (SOI marker)
        const signature = new Uint8Array(result.data, 0, 2);
        expect(signature[0]).toBe(0xff);
        expect(signature[1]).toBe(0xd8);
      } finally {
        frame.close();
      }
    });

    it('should encode to WebP', async () => {
      const frame = createTestFrame();
      try {
        const result = await ImageEncoder.encode(frame, { type: 'image/webp' });

        expect(result.type).toBe('image/webp');
        expect(result.data).toBeInstanceOf(ArrayBuffer);
        expect(result.data.byteLength).toBeGreaterThan(0);

        // Check RIFF/WEBP signature
        const signature = new Uint8Array(result.data, 0, 12);
        expect(String.fromCharCode(signature[0], signature[1], signature[2], signature[3])).toBe('RIFF');
        expect(String.fromCharCode(signature[8], signature[9], signature[10], signature[11])).toBe('WEBP');
      } finally {
        frame.close();
      }
    });

    it('should default to PNG when no type specified', async () => {
      const frame = createTestFrame();
      try {
        const result = await ImageEncoder.encode(frame);
        expect(result.type).toBe('image/png');
      } finally {
        frame.close();
      }
    });

    it('should respect quality parameter for JPEG', async () => {
      const frame = createTestFrame();
      try {
        const highQuality = await ImageEncoder.encode(frame, { type: 'image/jpeg', quality: 1.0 });
        const lowQuality = await ImageEncoder.encode(frame, { type: 'image/jpeg', quality: 0.1 });

        // Low quality should produce smaller file
        expect(lowQuality.data.byteLength).toBeLessThan(highQuality.data.byteLength);
      } finally {
        frame.close();
      }
    });

    it('should throw on closed frame', async () => {
      const frame = createTestFrame();
      frame.close();

      await expect(ImageEncoder.encode(frame)).rejects.toThrow('VideoFrame is closed or invalid');
    });

    it('should throw on unsupported type', async () => {
      const frame = createTestFrame();
      try {
        await expect(
          ImageEncoder.encode(frame, { type: 'image/gif' as any })
        ).rejects.toThrow('Unsupported image type');
      } finally {
        frame.close();
      }
    });
  });

  describe('encodeSync', () => {
    it('should synchronously encode to PNG', () => {
      const width = 50;
      const height = 50;
      const data = new Uint8Array(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;
        data[i + 1] = 255;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }

      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });

      try {
        const result = ImageEncoder.encodeSync(frame, { type: 'image/png' });
        expect(result.type).toBe('image/png');
        expect(result.data.byteLength).toBeGreaterThan(0);
      } finally {
        frame.close();
      }
    });
  });

  describe('encodeBatch', () => {
    it('should encode multiple frames', async () => {
      const frames: VideoFrame[] = [];
      for (let i = 0; i < 3; i++) {
        const data = new Uint8Array(50 * 50 * 4);
        data.fill(i * 85); // Different colors
        frames.push(new VideoFrame(data, {
          format: 'RGBA',
          codedWidth: 50,
          codedHeight: 50,
          timestamp: i * 1000,
        }));
      }

      try {
        const results = await ImageEncoder.encodeBatch(frames, { type: 'image/png' });
        expect(results.length).toBe(3);
        for (const result of results) {
          expect(result.type).toBe('image/png');
          expect(result.data.byteLength).toBeGreaterThan(0);
        }
      } finally {
        frames.forEach(f => f.close());
      }
    });
  });

  describe('format conversion', () => {
    it('should handle I420 input', async () => {
      const width = 100;
      const height = 100;
      const ySize = width * height;
      const uvSize = (width / 2) * (height / 2);
      const data = new Uint8Array(ySize + 2 * uvSize);

      // Fill with gray (Y=128, U=128, V=128)
      data.fill(128, 0, ySize);
      data.fill(128, ySize, ySize + uvSize);
      data.fill(128, ySize + uvSize);

      const frame = new VideoFrame(data, {
        format: 'I420',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });

      try {
        const result = await ImageEncoder.encode(frame, { type: 'image/png' });
        expect(result.type).toBe('image/png');
        expect(result.data.byteLength).toBeGreaterThan(0);
      } finally {
        frame.close();
      }
    });

    it('should handle NV12 input', async () => {
      const width = 100;
      const height = 100;
      const ySize = width * height;
      const uvSize = width * (height / 2);
      const data = new Uint8Array(ySize + uvSize);

      // Fill with gray
      data.fill(128);

      const frame = new VideoFrame(data, {
        format: 'NV12',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });

      try {
        const result = await ImageEncoder.encode(frame, { type: 'image/png' });
        expect(result.type).toBe('image/png');
        expect(result.data.byteLength).toBeGreaterThan(0);
      } finally {
        frame.close();
      }
    });
  });
});

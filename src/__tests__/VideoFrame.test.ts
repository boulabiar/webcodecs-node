/**
 * Tests for VideoFrame class
 */

import { VideoFrame, VideoColorSpace, DOMRectReadOnly } from '../VideoFrame.js';

describe('VideoFrame', () => {
  describe('constructor with BufferSource', () => {
    it('should create a VideoFrame from Uint8Array', () => {
      const width = 4;
      const height = 4;
      const data = new Uint8Array(width * height * 4); // RGBA

      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 1000,
      });

      expect(frame.format).toBe('RGBA');
      expect(frame.codedWidth).toBe(width);
      expect(frame.codedHeight).toBe(height);
      expect(frame.timestamp).toBe(1000);
      expect(frame.displayWidth).toBe(width);
      expect(frame.displayHeight).toBe(height);

      frame.close();
    });

    it('should create a VideoFrame from ArrayBuffer', () => {
      const width = 4;
      const height = 4;
      const buffer = new ArrayBuffer(width * height * 4);

      const frame = new VideoFrame(buffer, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });

      expect(frame.format).toBe('RGBA');
      expect(frame.codedWidth).toBe(width);
      expect(frame.codedHeight).toBe(height);

      frame.close();
    });

    it('should set duration when provided', () => {
      const data = new Uint8Array(16 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        duration: 33333,
      });

      expect(frame.duration).toBe(33333);
      frame.close();
    });

    it('should set displayWidth and displayHeight when provided', () => {
      const data = new Uint8Array(16 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 0,
        displayWidth: 8,
        displayHeight: 8,
      });

      expect(frame.displayWidth).toBe(8);
      expect(frame.displayHeight).toBe(8);
      frame.close();
    });
  });

  describe('constructor with CanvasImageSource', () => {
    it('should create a VideoFrame from canvas-like object', () => {
      // Mock canvas-like object
      const mockCanvas = {
        width: 4,
        height: 4,
        getContext: () => ({
          getImageData: () => ({
            data: new Uint8ClampedArray(4 * 4 * 4),
          }),
        }),
      };

      const frame = new VideoFrame(mockCanvas, {
        timestamp: 1000,
      });

      expect(frame.format).toBe('RGBA');
      expect(frame.codedWidth).toBe(4);
      expect(frame.codedHeight).toBe(4);
      expect(frame.timestamp).toBe(1000);

      frame.close();
    });
  });

  describe('clone', () => {
    it('should create an independent copy', () => {
      const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 2,
        codedHeight: 2,
        timestamp: 1000,
        duration: 100,
      });

      const clone = frame.clone();

      expect(clone.format).toBe(frame.format);
      expect(clone.codedWidth).toBe(frame.codedWidth);
      expect(clone.codedHeight).toBe(frame.codedHeight);
      expect(clone.timestamp).toBe(frame.timestamp);
      expect(clone.duration).toBe(frame.duration);

      // Close original, clone should still work
      frame.close();
      expect(clone.allocationSize()).toBeGreaterThan(0);

      clone.close();
    });
  });

  describe('copyTo', () => {
    it('should copy frame data to destination buffer', async () => {
      const sourceData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const frame = new VideoFrame(sourceData, {
        format: 'RGBA',
        codedWidth: 2,
        codedHeight: 2,
        timestamp: 0,
      });

      const dest = new Uint8Array(16);
      await frame.copyTo(dest);

      expect(Array.from(dest)).toEqual(Array.from(sourceData));
      frame.close();
    });
  });

  describe('allocationSize', () => {
    it('should return the correct buffer size', () => {
      const width = 8;
      const height = 8;
      const data = new Uint8Array(width * height * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });

      expect(frame.allocationSize()).toBe(width * height * 4);
      frame.close();
    });
  });

  describe('close', () => {
    it('should throw when accessing closed frame', () => {
      const data = new Uint8Array(16);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 2,
        codedHeight: 2,
        timestamp: 0,
      });

      frame.close();

      expect(() => frame.allocationSize()).toThrow('VideoFrame is closed');
    });
  });

  describe('codedRect and visibleRect', () => {
    it('should have correct rect values', () => {
      const data = new Uint8Array(64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 8,
        codedHeight: 8,
        timestamp: 0,
      });

      expect(frame.codedRect.x).toBe(0);
      expect(frame.codedRect.y).toBe(0);
      expect(frame.codedRect.width).toBe(8);
      expect(frame.codedRect.height).toBe(8);

      expect(frame.visibleRect.x).toBe(0);
      expect(frame.visibleRect.y).toBe(0);
      expect(frame.visibleRect.width).toBe(8);
      expect(frame.visibleRect.height).toBe(8);

      frame.close();
    });

    it('should support custom visibleRect', () => {
      const data = new Uint8Array(64 * 4);
      const frame = new VideoFrame(data, {
        format: 'RGBA',
        codedWidth: 8,
        codedHeight: 8,
        timestamp: 0,
        visibleRect: { x: 1, y: 1, width: 6, height: 6 },
      });

      expect(frame.visibleRect.x).toBe(1);
      expect(frame.visibleRect.y).toBe(1);
      expect(frame.visibleRect.width).toBe(6);
      expect(frame.visibleRect.height).toBe(6);

      frame.close();
    });
  });
});

describe('VideoColorSpace', () => {
  it('should create with default values', () => {
    const colorSpace = new VideoColorSpace();

    expect(colorSpace.primaries).toBeNull();
    expect(colorSpace.transfer).toBeNull();
    expect(colorSpace.matrix).toBeNull();
    expect(colorSpace.fullRange).toBeNull();
  });

  it('should create with provided values', () => {
    const colorSpace = new VideoColorSpace({
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      fullRange: true,
    });

    expect(colorSpace.primaries).toBe('bt709');
    expect(colorSpace.transfer).toBe('bt709');
    expect(colorSpace.matrix).toBe('bt709');
    expect(colorSpace.fullRange).toBe(true);
  });

  it('should serialize to JSON', () => {
    const colorSpace = new VideoColorSpace({
      primaries: 'bt709',
      fullRange: false,
    });

    const json = colorSpace.toJSON();

    expect(json.primaries).toBe('bt709');
    expect(json.fullRange).toBe(false);
  });
});

describe('DOMRectReadOnly', () => {
  it('should create with default values', () => {
    const rect = new DOMRectReadOnly();

    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });

  it('should create with provided values', () => {
    const rect = new DOMRectReadOnly(10, 20, 100, 200);

    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(200);
  });

  it('should compute derived properties', () => {
    const rect = new DOMRectReadOnly(10, 20, 100, 200);

    expect(rect.top).toBe(20);
    expect(rect.left).toBe(10);
    expect(rect.right).toBe(110);
    expect(rect.bottom).toBe(220);
  });
});

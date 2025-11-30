/**
 * Tests for EncodedVideoChunk and EncodedAudioChunk
 */

import { EncodedVideoChunk } from '../EncodedVideoChunk.js';
import { EncodedAudioChunk } from '../EncodedAudioChunk.js';

describe('EncodedVideoChunk', () => {
  describe('constructor', () => {
    it('should create a key frame chunk', () => {
      const data = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1e]);

      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data,
      });

      expect(chunk.type).toBe('key');
      expect(chunk.timestamp).toBe(0);
      expect(chunk.byteLength).toBe(8);
    });

    it('should create a delta frame chunk', () => {
      const data = new Uint8Array([0, 0, 0, 1, 0x41, 0x9a, 0x24]);

      const chunk = new EncodedVideoChunk({
        type: 'delta',
        timestamp: 33333,
        data,
      });

      expect(chunk.type).toBe('delta');
      expect(chunk.timestamp).toBe(33333);
    });

    it('should set duration when provided', () => {
      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        duration: 33333,
        data: new Uint8Array(10),
      });

      expect(chunk.duration).toBe(33333);
    });
  });

  describe('copyTo', () => {
    it('should copy data to destination buffer', () => {
      const sourceData = new Uint8Array([1, 2, 3, 4, 5]);
      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data: sourceData,
      });

      const dest = new Uint8Array(5);
      chunk.copyTo(dest);

      expect(Array.from(dest)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should throw if destination is too small', () => {
      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data: new Uint8Array(10),
      });

      const dest = new Uint8Array(5);
      expect(() => chunk.copyTo(dest)).toThrow();
    });
  });
});

describe('EncodedAudioChunk', () => {
  describe('constructor', () => {
    it('should create an audio chunk', () => {
      const data = new Uint8Array([0xff, 0xf1, 0x50, 0x80]); // ADTS header

      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        data,
      });

      expect(chunk.type).toBe('key');
      expect(chunk.timestamp).toBe(0);
      expect(chunk.byteLength).toBe(4);
    });

    it('should set duration when provided', () => {
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        duration: 21333, // ~20ms at 48kHz
        data: new Uint8Array(100),
      });

      expect(chunk.duration).toBe(21333);
    });
  });

  describe('copyTo', () => {
    it('should copy data to destination buffer', () => {
      const sourceData = new Uint8Array([10, 20, 30, 40]);
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        data: sourceData,
      });

      const dest = new Uint8Array(4);
      chunk.copyTo(dest);

      expect(Array.from(dest)).toEqual([10, 20, 30, 40]);
    });
  });
});

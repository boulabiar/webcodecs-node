/**
 * Tests for AudioData class
 */

import { AudioData } from '../AudioData.js';

describe('AudioData', () => {
  describe('constructor', () => {
    it('should create AudioData from f32 interleaved data', () => {
      const sampleRate = 48000;
      const numberOfChannels = 2;
      const numberOfFrames = 100;
      const data = new Float32Array(numberOfFrames * numberOfChannels);

      const audioData = new AudioData({
        format: 'f32',
        sampleRate,
        numberOfChannels,
        numberOfFrames,
        timestamp: 1000,
        data,
      });

      expect(audioData.format).toBe('f32');
      expect(audioData.sampleRate).toBe(sampleRate);
      expect(audioData.numberOfChannels).toBe(numberOfChannels);
      expect(audioData.numberOfFrames).toBe(numberOfFrames);
      expect(audioData.timestamp).toBe(1000);

      audioData.close();
    });

    it('should create AudioData from f32-planar data', () => {
      const sampleRate = 44100;
      const numberOfChannels = 2;
      const numberOfFrames = 50;
      const data = new Float32Array(numberOfFrames * numberOfChannels);

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfChannels,
        numberOfFrames,
        timestamp: 0,
        data,
      });

      expect(audioData.format).toBe('f32-planar');
      audioData.close();
    });

    it('should create AudioData from s16 data', () => {
      const sampleRate = 44100;
      const numberOfChannels = 1;
      const numberOfFrames = 100;
      const data = new Int16Array(numberOfFrames);

      const audioData = new AudioData({
        format: 's16',
        sampleRate,
        numberOfChannels,
        numberOfFrames,
        timestamp: 0,
        data,
      });

      expect(audioData.format).toBe('s16');
      audioData.close();
    });

    it('should calculate duration correctly', () => {
      const sampleRate = 48000;
      const numberOfFrames = 48000; // 1 second

      const audioData = new AudioData({
        format: 'f32',
        sampleRate,
        numberOfChannels: 1,
        numberOfFrames,
        timestamp: 0,
        data: new Float32Array(numberOfFrames),
      });

      // Duration should be 1 second = 1,000,000 microseconds
      expect(audioData.duration).toBe(1000000);

      audioData.close();
    });
  });

  describe('allocationSize', () => {
    it('should return correct size for f32 format', () => {
      const numberOfFrames = 100;
      const numberOfChannels = 2;

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfChannels,
        numberOfFrames,
        timestamp: 0,
        data: new Float32Array(numberOfFrames * numberOfChannels),
      });

      // f32 interleaved: frames * channels * 4 bytes
      const expectedSize = numberOfFrames * numberOfChannels * 4;
      expect(audioData.allocationSize({ planeIndex: 0 })).toBe(expectedSize);

      audioData.close();
    });

    it('should return correct size for s16 format', () => {
      const numberOfFrames = 100;
      const numberOfChannels = 2;

      const audioData = new AudioData({
        format: 's16',
        sampleRate: 48000,
        numberOfChannels,
        numberOfFrames,
        timestamp: 0,
        data: new Int16Array(numberOfFrames * numberOfChannels),
      });

      // s16 interleaved: frames * channels * 2 bytes
      const expectedSize = numberOfFrames * numberOfChannels * 2;
      expect(audioData.allocationSize({ planeIndex: 0 })).toBe(expectedSize);

      audioData.close();
    });

    it('should return correct size for planar format', () => {
      const numberOfFrames = 100;

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfChannels: 2,
        numberOfFrames,
        timestamp: 0,
        data: new Float32Array(numberOfFrames * 2),
      });

      // f32-planar: one plane = frames * 4 bytes
      const expectedSize = numberOfFrames * 4;
      expect(audioData.allocationSize({ planeIndex: 0 })).toBe(expectedSize);
      expect(audioData.allocationSize({ planeIndex: 1 })).toBe(expectedSize);

      audioData.close();
    });
  });

  describe('copyTo', () => {
    it('should copy f32 interleaved data', () => {
      const sourceData = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfChannels: 2,
        numberOfFrames: 3,
        timestamp: 0,
        data: sourceData,
      });

      const dest = new Float32Array(6);
      audioData.copyTo(dest, { planeIndex: 0 });

      expect(Array.from(dest)).toEqual(Array.from(sourceData));

      audioData.close();
    });
  });

  describe('clone', () => {
    it('should create an independent copy', () => {
      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfChannels: 2,
        numberOfFrames: 100,
        timestamp: 1000,
        data: new Float32Array(200),
      });

      const clone = audioData.clone();

      expect(clone.format).toBe(audioData.format);
      expect(clone.sampleRate).toBe(audioData.sampleRate);
      expect(clone.numberOfChannels).toBe(audioData.numberOfChannels);
      expect(clone.numberOfFrames).toBe(audioData.numberOfFrames);
      expect(clone.timestamp).toBe(audioData.timestamp);

      audioData.close();
      // Clone should still work
      expect(clone.numberOfFrames).toBe(100);

      clone.close();
    });
  });

  describe('close', () => {
    it('should throw when accessing closed AudioData', () => {
      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfChannels: 1,
        numberOfFrames: 10,
        timestamp: 0,
        data: new Float32Array(10),
      });

      audioData.close();

      expect(() => audioData.allocationSize({ planeIndex: 0 })).toThrow();
    });
  });
});

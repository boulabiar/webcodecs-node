/**
 * Tests for HardwareAcceleration module
 */

import {
  detectHardwareAcceleration,
  getBestEncoder,
  getBestDecoder,
  parseCodecString,
  clearCapabilitiesCache,
} from '../HardwareAcceleration.js';

describe('HardwareAcceleration', () => {
  beforeEach(() => {
    clearCapabilitiesCache();
  });

  describe('detectHardwareAcceleration', () => {
    it('should detect available hardware methods', async () => {
      const capabilities = await detectHardwareAcceleration();

      expect(capabilities.detected).toBe(true);
      expect(Array.isArray(capabilities.methods)).toBe(true);
      expect(Array.isArray(capabilities.encoders)).toBe(true);
      expect(Array.isArray(capabilities.decoders)).toBe(true);
    });

    it('should cache capabilities', async () => {
      const first = await detectHardwareAcceleration();
      const second = await detectHardwareAcceleration();

      expect(first).toBe(second); // Same object reference
    });
  });

  describe('getBestEncoder', () => {
    it('should return software encoder when prefer-software', async () => {
      const result = await getBestEncoder('h264', 'prefer-software');

      expect(result.encoder).toBe('libx264');
      expect(result.isHardware).toBe(false);
      expect(result.hwaccel).toBeNull();
    });

    it('should return software encoder for unknown preference', async () => {
      const result = await getBestEncoder('h264', 'no-preference');

      // Should return either hardware or software depending on system
      expect(result.encoder).toBeDefined();
      expect(typeof result.isHardware).toBe('boolean');
    });

    it('should handle all codec types', async () => {
      const codecs = ['h264', 'hevc', 'vp8', 'vp9', 'av1'] as const;

      for (const codec of codecs) {
        const result = await getBestEncoder(codec, 'prefer-software');
        expect(result.encoder).toBeDefined();
        expect(result.isHardware).toBe(false);
      }
    });
  });

  describe('getBestDecoder', () => {
    it('should return null decoder for software decoding', async () => {
      const result = await getBestDecoder('h264', 'prefer-software');

      expect(result.decoder).toBeNull();
      expect(result.hwaccel).toBeNull();
      expect(result.isHardware).toBe(false);
    });

    it('should handle all codec types', async () => {
      const codecs = ['h264', 'hevc', 'vp8', 'vp9', 'av1'] as const;

      for (const codec of codecs) {
        const result = await getBestDecoder(codec, 'prefer-software');
        expect(result.isHardware).toBe(false);
      }
    });
  });

  describe('parseCodecString', () => {
    it('should parse H.264 codec strings', () => {
      expect(parseCodecString('avc1.42001E')).toBe('h264');
      expect(parseCodecString('avc3.4d0032')).toBe('h264');
    });

    it('should parse HEVC codec strings', () => {
      expect(parseCodecString('hev1.1.6.L93.B0')).toBe('hevc');
      expect(parseCodecString('hvc1.1.6.L120.90')).toBe('hevc');
    });

    it('should parse VP8/VP9 codec strings', () => {
      expect(parseCodecString('vp8')).toBe('vp8');
      expect(parseCodecString('vp9')).toBe('vp9');
      expect(parseCodecString('vp09.00.10.08')).toBe('vp9');
    });

    it('should parse AV1 codec strings', () => {
      expect(parseCodecString('av01.0.01M.08')).toBe('av1');
      expect(parseCodecString('av1')).toBe('av1');
    });

    it('should return null for unknown codecs', () => {
      expect(parseCodecString('unknown')).toBeNull();
      expect(parseCodecString('mp4a.40.2')).toBeNull();
    });
  });
});

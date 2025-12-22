/**
 * Tests for AudioEncoder class
 */

import { jest } from '@jest/globals';
import { AudioEncoder } from '../AudioEncoder.js';
import { AudioData } from '../AudioData.js';
import { EncodedAudioChunk } from '../EncodedAudioChunk.js';

describe('AudioEncoder', () => {
  describe('isConfigSupported', () => {
    it('should support Opus', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support AAC', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support MP3', async () => {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'mp3',
        sampleRate: 44100,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });
  });

  describe('constructor', () => {
    it('should create encoder with callbacks', () => {
      const output = jest.fn();
      const error = jest.fn();

      const encoder = new AudioEncoder({ output, error });

      expect(encoder.state).toBe('unconfigured');
      encoder.close();
    });

    it('should throw without output callback', () => {
      expect(() => new AudioEncoder({ output: null as any, error: () => {} })).toThrow();
    });
  });

  describe('configure', () => {
    it('should configure encoder', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      });

      expect(encoder.state).toBe('configured');
      encoder.close();
    });

    it('should throw on closed encoder', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow();
    });
  });

  describe('encode and flush', () => {
    it('should encode audio samples', async () => {
      const chunks: EncodedAudioChunk[] = [];

      const encoder = new AudioEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (err) => console.error(err),
      });

      encoder.configure({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
        bitrate: 128000,
      });

      // Create test audio (1 second of samples)
      const sampleRate = 44100;
      const channels = 2;
      const samplesPerChunk = 1024;
      const numChunks = 10;

      for (let i = 0; i < numChunks; i++) {
        const data = new Float32Array(samplesPerChunk * channels);
        // Generate sine wave
        for (let j = 0; j < samplesPerChunk; j++) {
          const t = (i * samplesPerChunk + j) / sampleRate;
          const sample = Math.sin(2 * Math.PI * 440 * t) * 0.5;
          for (let ch = 0; ch < channels; ch++) {
            data[j * channels + ch] = sample;
          }
        }

        const audioData = new AudioData({
          format: 'f32',
          sampleRate,
          numberOfChannels: channels,
          numberOfFrames: samplesPerChunk,
          timestamp: (i * samplesPerChunk * 1_000_000) / sampleRate,
          data,
        });

        encoder.encode(audioData);
        audioData.close();
      }

      await encoder.flush();
      encoder.close();

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('reset', () => {
    it('should reset encoder to unconfigured state', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(encoder.state).toBe('configured');

      encoder.reset();

      expect(encoder.state).toBe('unconfigured');
      encoder.close();
    });
  });

  describe('configure validation', () => {
    it('should throw TypeError for missing config', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() => encoder.configure(null as any)).toThrow(TypeError);
      expect(() => encoder.configure(undefined as any)).toThrow(TypeError);
      encoder.close();
    });

    it('should throw TypeError for invalid codec', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: '',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 123 as any,
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw TypeError for invalid sampleRate', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 0,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: -44100,
          numberOfChannels: 2,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw TypeError for invalid numberOfChannels', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 0,
        })
      ).toThrow(TypeError);

      expect(() =>
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: -1,
        })
      ).toThrow(TypeError);

      encoder.close();
    });

    it('should throw NotSupportedError for unsupported codec', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        encoder.configure({
          codec: 'unsupported-codec',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow("Codec 'unsupported-codec' is not supported");

      encoder.close();
    });
  });

  describe('reconfigure', () => {
    it('should allow calling configure multiple times', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      // First configuration
      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });
      expect(encoder.state).toBe('configured');

      // Reconfigure with different settings
      encoder.configure({
        codec: 'aac',
        sampleRate: 44100,
        numberOfChannels: 2,
      });
      expect(encoder.state).toBe('configured');

      encoder.close();
    });

    it('should throw when reconfiguring after close', () => {
      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() => {
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        });
      }).toThrow('Encoder is closed');
    });
  });
});

/**
 * Tests for AudioEncoder class
 */
import { jest } from '@jest/globals';
import { AudioEncoder } from '../encoders/AudioEncoder.js';
import { AudioData } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { Frame, Rational } from 'node-av';
import { AV_SAMPLE_FMT_FLT } from 'node-av/constants';

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

    it('should encode native node-av frames without extra copy', async () => {
      const chunks: EncodedAudioChunk[] = [];
      let err: Error | null = null;

      const encoder = new AudioEncoder({
        output: (chunk) => chunks.push(chunk),
        error: (e) => { err = e; },
      });

      const sampleRate = 48000;
      const channels = 2;
      const samples = 960;

      encoder.configure({
        codec: 'opus',
        sampleRate,
        numberOfChannels: channels,
        bitrate: 128000,
      });

      const buffer = Buffer.alloc(samples * channels * 4);
      const view = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const sample = Math.sin(2 * Math.PI * 220 * t) * 0.25;
        for (let ch = 0; ch < channels; ch++) {
          view[i * channels + ch] = sample;
        }
      }

      const frame = Frame.fromAudioBuffer(buffer, {
        sampleRate,
        channelLayout: { nbChannels: channels, order: 1, mask: BigInt((1 << channels) - 1) },
        format: AV_SAMPLE_FMT_FLT,
        nbSamples: samples,
        timeBase: new Rational(1, sampleRate),
      });

      const audioData = new AudioData({
        format: 'f32',
        sampleRate,
        numberOfChannels: channels,
        numberOfFrames: samples,
        timestamp: 0,
        data: new Uint8Array(0),
        _nativeFrame: frame,
        _nativeCleanup: () => frame.unref(),
      } as any);

      encoder.encode(audioData);
      audioData.close();

      await encoder.flush();
      encoder.close();

      if (err) {
        throw err;
      }

      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);

    it('should encode Opus from 44.1kHz input (resampling path)', async () => {
      const chunks: EncodedAudioChunk[] = [];
      let decoderConfig: { sampleRate?: number } | undefined;
      let err: Error | null = null;

      const encoder = new AudioEncoder({
        output: (chunk, metadata) => {
          chunks.push(chunk);
          if (metadata?.decoderConfig) {
            decoderConfig = metadata.decoderConfig;
          }
        },
        error: (e) => { err = e; },
      });

      // Configure Opus with 44.1kHz input - this triggers the resampling path
      const inputSampleRate = 44100;
      const channels = 2;
      const samplesPerChunk = 1024;
      const numChunks = 10;

      encoder.configure({
        codec: 'opus',
        sampleRate: inputSampleRate,
        numberOfChannels: channels,
        bitrate: 128000,
      });

      // Encode audio at 44.1kHz
      for (let i = 0; i < numChunks; i++) {
        const data = new Float32Array(samplesPerChunk * channels);
        // Generate sine wave
        for (let j = 0; j < samplesPerChunk; j++) {
          const t = (i * samplesPerChunk + j) / inputSampleRate;
          const sample = Math.sin(2 * Math.PI * 440 * t) * 0.5;
          for (let ch = 0; ch < channels; ch++) {
            data[j * channels + ch] = sample;
          }
        }

        const audioData = new AudioData({
          format: 'f32',
          sampleRate: inputSampleRate,
          numberOfChannels: channels,
          numberOfFrames: samplesPerChunk,
          timestamp: (i * samplesPerChunk * 1_000_000) / inputSampleRate,
          data,
        });

        encoder.encode(audioData);
        audioData.close();
      }

      await encoder.flush();
      encoder.close();

      if (err) {
        throw err;
      }

      // Verify encoding succeeded
      expect(chunks.length).toBeGreaterThan(0);

      // Verify decoderConfig reports 48kHz (the actual Opus encoder rate)
      expect(decoderConfig).toBeDefined();
      expect(decoderConfig?.sampleRate).toBe(48000);

      // Verify timestamps are reasonable (should be based on 48kHz output)
      // First chunk should have timestamp >= 0
      expect(chunks[0].timestamp).toBeGreaterThanOrEqual(0);

      // Last chunk timestamp should reflect ~10 chunks worth of audio
      // At 44.1kHz input, 10 * 1024 samples = ~232ms
      // Output timestamps are in microseconds
      const expectedDurationUs = (numChunks * samplesPerChunk * 1_000_000) / inputSampleRate;
      const lastChunk = chunks[chunks.length - 1];
      // Allow some tolerance for encoder delay/buffering
      expect(lastChunk.timestamp).toBeLessThan(expectedDurationUs + 100_000);
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

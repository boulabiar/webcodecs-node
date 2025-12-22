/**
 * Tests for AudioDecoder class
 */

import { jest } from '@jest/globals';
import { AudioDecoder } from '../AudioDecoder.js';
import { AudioEncoder } from '../AudioEncoder.js';
import { AudioData, AudioSampleFormat } from '../AudioData.js';
import { EncodedAudioChunk } from '../EncodedAudioChunk.js';

describe('AudioDecoder', () => {
  describe('isConfigSupported', () => {
    it('should support Opus', async () => {
      const support = await AudioDecoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support AAC', async () => {
      const support = await AudioDecoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 44100,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support MP3', async () => {
      const support = await AudioDecoder.isConfigSupported({
        codec: 'mp3',
        sampleRate: 44100,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support FLAC', async () => {
      const support = await AudioDecoder.isConfigSupported({
        codec: 'flac',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should support Vorbis', async () => {
      const support = await AudioDecoder.isConfigSupported({
        codec: 'vorbis',
        sampleRate: 44100,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(true);
    });

    it('should not support missing codec', async () => {
      const support = await AudioDecoder.isConfigSupported({
        codec: '',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(false);
    });

    it('should not support missing sampleRate', async () => {
      const support = await AudioDecoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 0,
        numberOfChannels: 2,
      });

      expect(support.supported).toBe(false);
    });
  });

  describe('constructor', () => {
    it('should create decoder with callbacks', () => {
      const output = jest.fn();
      const error = jest.fn();

      const decoder = new AudioDecoder({ output, error });

      expect(decoder.state).toBe('unconfigured');
      decoder.close();
    });

    it('should throw without output callback', () => {
      expect(() => new AudioDecoder({ output: null as any, error: () => {} })).toThrow();
    });

    it('should throw without error callback', () => {
      expect(() => new AudioDecoder({ output: () => {}, error: null as any })).toThrow();
    });
  });

  describe('configure', () => {
    it('should configure decoder', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(decoder.state).toBe('configured');
      decoder.close();
    });

    it('should throw without codec', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        decoder.configure({
          codec: '',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow();

      decoder.close();
    });

    it('should throw with invalid sampleRate', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        decoder.configure({
          codec: 'opus',
          sampleRate: 0,
          numberOfChannels: 2,
        })
      ).toThrow();

      decoder.close();
    });

    it('should throw with invalid numberOfChannels', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        decoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 0,
        })
      ).toThrow();

      decoder.close();
    });

    it('should throw on closed decoder', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(() =>
        decoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      ).toThrow();
    });

    it('should accept valid outputFormat', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        outputFormat: 's16',
      });

      expect(decoder.state).toBe('configured');
      decoder.close();
    });

    it('should throw with invalid outputFormat', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      expect(() =>
        decoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
          outputFormat: 'invalid' as AudioSampleFormat,
        })
      ).toThrow();

      decoder.close();
    });
  });

  describe('decode', () => {
    it('should throw when not configured', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        data: new Uint8Array(100),
      });

      expect(() => decoder.decode(chunk)).toThrow();
      decoder.close();
    });

    it('should throw with invalid chunk', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(() => decoder.decode('invalid' as any)).toThrow();
      decoder.close();
    });
  });

  describe('reset', () => {
    it('should reset decoder to unconfigured state', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });

      expect(decoder.state).toBe('configured');

      decoder.reset();

      expect(decoder.state).toBe('unconfigured');
      decoder.close();
    });

    it('should throw on closed decoder', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(() => decoder.reset()).toThrow();
    });
  });

  describe('close', () => {
    it('should close decoder', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(decoder.state).toBe('closed');
    });

    it('should be idempotent', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();
      decoder.close(); // Should not throw

      expect(decoder.state).toBe('closed');
    });
  });

  describe('flush', () => {
    it('should throw when not configured', async () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      await expect(decoder.flush()).rejects.toThrow();
      decoder.close();
    });
  });

  describe('decodeQueueSize', () => {
    it('should start at 0', () => {
      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      expect(decoder.decodeQueueSize).toBe(0);
      decoder.close();
    });
  });
});

describe('AudioDecoder encode-decode roundtrip', () => {
  it('should decode Opus encoded audio', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 2;
    const numberOfFrames = 960; // 20ms at 48kHz
    const chunkCount = 3;

    // Step 1: Encode audio
    const encodedChunks: EncodedAudioChunk[] = [];

    const encoder = new AudioEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
      bitrate: 64000,
    });

    // Create and encode test audio (sine waves) - use interleaved f32 format
    for (let c = 0; c < chunkCount; c++) {
      const samples = new Float32Array(numberOfFrames * numberOfChannels);
      const frequency = 440 + c * 100; // Different frequency for each chunk

      for (let i = 0; i < numberOfFrames; i++) {
        const t = (c * numberOfFrames + i) / sampleRate;
        const value = Math.sin(2 * Math.PI * frequency * t);
        for (let ch = 0; ch < numberOfChannels; ch++) {
          samples[i * numberOfChannels + ch] = value;
        }
      }

      const audioData = new AudioData({
        format: 'f32',  // Use interleaved format
        sampleRate,
        numberOfChannels,
        numberOfFrames,
        timestamp: c * (numberOfFrames * 1_000_000 / sampleRate),
        data: samples,
      });

      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);

    // Step 2: Decode audio
    const decodedAudio: AudioData[] = [];

    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    // Verify decoded audio
    expect(decodedAudio.length).toBeGreaterThan(0);

    let totalFrames = 0;
    for (const audio of decodedAudio) {
      expect(audio.sampleRate).toBe(sampleRate);
      expect(audio.numberOfChannels).toBe(numberOfChannels);
      totalFrames += audio.numberOfFrames;
      audio.close();
    }

    // Total decoded frames should be close to original
    const expectedFrames = numberOfFrames * chunkCount;
    expect(totalFrames).toBeGreaterThanOrEqual(expectedFrames * 0.9);
  }, 30000);

  it('should decode FLAC encoded audio', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 2;
    const numberOfFrames = 1024;
    const chunkCount = 2;

    // Step 1: Encode audio
    const encodedChunks: EncodedAudioChunk[] = [];

    const encoder = new AudioEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'flac',
      sampleRate,
      numberOfChannels,
    });

    for (let c = 0; c < chunkCount; c++) {
      const samples = new Float32Array(numberOfFrames * numberOfChannels);

      for (let i = 0; i < numberOfFrames; i++) {
        const t = (c * numberOfFrames + i) / sampleRate;
        const value = Math.sin(2 * Math.PI * 880 * t) * 0.5;
        for (let ch = 0; ch < numberOfChannels; ch++) {
          samples[i * numberOfChannels + ch] = value;
        }
      }

      const audioData = new AudioData({
        format: 'f32',  // Use interleaved format
        sampleRate,
        numberOfChannels,
        numberOfFrames,
        timestamp: c * (numberOfFrames * 1_000_000 / sampleRate),
        data: samples,
      });

      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);

    // Step 2: Decode audio
    const decodedAudio: AudioData[] = [];

    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'flac',
      sampleRate,
      numberOfChannels,
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    // Verify decoded audio
    expect(decodedAudio.length).toBeGreaterThan(0);

    for (const audio of decodedAudio) {
      expect(audio.sampleRate).toBe(sampleRate);
      expect(audio.numberOfChannels).toBe(numberOfChannels);
      audio.close();
    }
  }, 30000);

  it('should handle mono audio', async () => {
    const sampleRate = 44100;
    const numberOfChannels = 1;
    const numberOfFrames = 1024;

    // Encode
    const encodedChunks: EncodedAudioChunk[] = [];

    const encoder = new AudioEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
      bitrate: 32000,
    });

    const samples = new Float32Array(numberOfFrames);
    for (let i = 0; i < numberOfFrames; i++) {
      samples[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate);
    }

    const audioData = new AudioData({
      format: 'f32',  // Use interleaved format (same as planar for mono)
      sampleRate,
      numberOfChannels,
      numberOfFrames,
      timestamp: 0,
      data: samples,
    });

    encoder.encode(audioData);
    audioData.close();

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);

    // Decode
    const decodedAudio: AudioData[] = [];

    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedAudio.length).toBeGreaterThan(0);

    for (const audio of decodedAudio) {
      expect(audio.numberOfChannels).toBe(numberOfChannels);
      audio.close();
    }
  }, 30000);
});

describe('AudioDecoder output formats', () => {
  // Helper to encode test audio for format tests
  async function encodeTestAudio(): Promise<EncodedAudioChunk[]> {
    const sampleRate = 48000;
    const numberOfChannels = 2;
    const numberOfFrames = 960;

    const encodedChunks: EncodedAudioChunk[] = [];
    const encoder = new AudioEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
      bitrate: 64000,
    });

    // Create test audio - interleaved f32
    const samples = new Float32Array(numberOfFrames * numberOfChannels);
    for (let i = 0; i < numberOfFrames; i++) {
      const value = Math.sin(2 * Math.PI * 440 * i / sampleRate);
      samples[i * numberOfChannels] = value;
      samples[i * numberOfChannels + 1] = value;
    }

    const audioData = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfChannels,
      numberOfFrames,
      timestamp: 0,
      data: samples,
    });

    encoder.encode(audioData);
    audioData.close();

    await encoder.flush();
    encoder.close();

    return encodedChunks;
  }

  it('should decode to s16 format', async () => {
    const encodedChunks = await encodeTestAudio();
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedAudio: AudioData[] = [];
    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      outputFormat: 's16',
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedAudio.length).toBeGreaterThan(0);
    for (const audio of decodedAudio) {
      expect(audio.format).toBe('s16');
      expect(audio.numberOfChannels).toBe(2);
      audio.close();
    }
  }, 30000);

  it('should decode to s32 format', async () => {
    const encodedChunks = await encodeTestAudio();
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedAudio: AudioData[] = [];
    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      outputFormat: 's32',
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedAudio.length).toBeGreaterThan(0);
    for (const audio of decodedAudio) {
      expect(audio.format).toBe('s32');
      audio.close();
    }
  }, 30000);

  it('should decode to u8 format', async () => {
    const encodedChunks = await encodeTestAudio();
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedAudio: AudioData[] = [];
    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      outputFormat: 'u8',
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedAudio.length).toBeGreaterThan(0);
    for (const audio of decodedAudio) {
      expect(audio.format).toBe('u8');
      audio.close();
    }
  }, 30000);

  it('should decode to f32-planar format', async () => {
    const encodedChunks = await encodeTestAudio();
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedAudio: AudioData[] = [];
    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      outputFormat: 'f32-planar',
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedAudio.length).toBeGreaterThan(0);
    for (const audio of decodedAudio) {
      expect(audio.format).toBe('f32-planar');
      expect(audio.numberOfChannels).toBe(2);
      audio.close();
    }
  }, 30000);

  it('should decode to s16-planar format', async () => {
    const encodedChunks = await encodeTestAudio();
    expect(encodedChunks.length).toBeGreaterThan(0);

    const decodedAudio: AudioData[] = [];
    const decoder = new AudioDecoder({
      output: (audio) => decodedAudio.push(audio),
      error: (err) => { throw err; },
    });

    decoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      outputFormat: 's16-planar',
    });

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    expect(decodedAudio.length).toBeGreaterThan(0);
    for (const audio of decodedAudio) {
      expect(audio.format).toBe('s16-planar');
      audio.close();
    }
  }, 30000);
});

describe('AudioEncoder input formats', () => {
  it('should encode from s16 format', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 2;
    const numberOfFrames = 960;

    const encodedChunks: EncodedAudioChunk[] = [];
    const encoder = new AudioEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
      bitrate: 64000,
    });

    // Create s16 interleaved samples
    const samples = new Int16Array(numberOfFrames * numberOfChannels);
    for (let i = 0; i < numberOfFrames; i++) {
      const value = Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 32767);
      samples[i * numberOfChannels] = value;
      samples[i * numberOfChannels + 1] = value;
    }

    const audioData = new AudioData({
      format: 's16',
      sampleRate,
      numberOfChannels,
      numberOfFrames,
      timestamp: 0,
      data: new Uint8Array(samples.buffer),
    });

    encoder.encode(audioData);
    audioData.close();

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);
  }, 30000);

  it('should encode from f32-planar format', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 2;
    const numberOfFrames = 960;

    const encodedChunks: EncodedAudioChunk[] = [];
    const encoder = new AudioEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
      bitrate: 64000,
    });

    // Create f32-planar samples (channel 0 followed by channel 1)
    const samples = new Float32Array(numberOfFrames * numberOfChannels);
    for (let i = 0; i < numberOfFrames; i++) {
      const value = Math.sin(2 * Math.PI * 440 * i / sampleRate);
      samples[i] = value; // Channel 0
      samples[numberOfFrames + i] = value; // Channel 1
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfChannels,
      numberOfFrames,
      timestamp: 0,
      data: new Uint8Array(samples.buffer),
    });

    encoder.encode(audioData);
    audioData.close();

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);
  }, 30000);

  it('should encode from s16-planar format', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 2;
    const numberOfFrames = 960;

    const encodedChunks: EncodedAudioChunk[] = [];
    const encoder = new AudioEncoder({
      output: (chunk) => encodedChunks.push(chunk),
      error: (err) => { throw err; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels,
      bitrate: 64000,
    });

    // Create s16-planar samples
    const samples = new Int16Array(numberOfFrames * numberOfChannels);
    for (let i = 0; i < numberOfFrames; i++) {
      const value = Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 32767);
      samples[i] = value; // Channel 0
      samples[numberOfFrames + i] = value; // Channel 1
    }

    const audioData = new AudioData({
      format: 's16-planar',
      sampleRate,
      numberOfChannels,
      numberOfFrames,
      timestamp: 0,
      data: new Uint8Array(samples.buffer),
    });

    encoder.encode(audioData);
    audioData.close();

    await encoder.flush();
    encoder.close();

    expect(encodedChunks.length).toBeGreaterThan(0);
  }, 30000);
});

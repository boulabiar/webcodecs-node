/**
 * Tests for MediaCapabilities API
 */

import { MediaCapabilities, mediaCapabilities } from '../MediaCapabilities.js';

describe('MediaCapabilities', () => {
  describe('decodingInfo', () => {
    it('should return supported for H.264 in MP4', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
      expect(typeof result.smooth).toBe('boolean');
      expect(typeof result.powerEfficient).toBe('boolean');
    });

    it('should return supported for VP9 in WebM', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/webm; codecs="vp9"',
          width: 1280,
          height: 720,
          bitrate: 2000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should return supported for VP8 in WebM', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/webm; codecs="vp8"',
          width: 640,
          height: 480,
          bitrate: 1000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should return supported for AV1 in WebM', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/webm; codecs="av01"',
          width: 1920,
          height: 1080,
          bitrate: 3000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should return supported for HEVC in MP4', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="hev1.1.6.L93.B0"',
          width: 3840,
          height: 2160,
          bitrate: 15000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should return not supported for unsupported codec', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="unsupported"',
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(false);
      expect(result.smooth).toBe(false);
      expect(result.powerEfficient).toBe(false);
    });

    it('should return not supported for unsupported container', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/unsupported; codecs="avc1"',
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(false);
    });

    it('should support audio-only configuration', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        audio: {
          contentType: 'audio/mp4; codecs="mp4a.40.2"',
          channels: 2,
          bitrate: 128000,
          samplerate: 44100,
        },
      });

      expect(result.supported).toBe(true);
      expect(result.smooth).toBe(true); // Audio-only is always smooth
    });

    it('should support Opus audio in WebM', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        audio: {
          contentType: 'audio/webm; codecs="opus"',
          channels: 2,
          bitrate: 128000,
          samplerate: 48000,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should support MP3 audio', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        audio: {
          contentType: 'audio/mpeg; codecs="mp3"',
          channels: 2,
          bitrate: 320000,
          samplerate: 44100,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should support combined video and audio', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30,
        },
        audio: {
          contentType: 'audio/mp4; codecs="mp4a.40.2"',
          channels: 2,
          bitrate: 128000,
          samplerate: 44100,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should throw for missing type', async () => {
      await expect(
        mediaCapabilities.decodingInfo({
          type: '' as any,
          video: {
            contentType: 'video/mp4; codecs="avc1"',
            width: 1920,
            height: 1080,
            bitrate: 5000000,
            framerate: 30,
          },
        })
      ).rejects.toThrow(TypeError);
    });

    it('should throw for missing video and audio', async () => {
      await expect(
        mediaCapabilities.decodingInfo({
          type: 'file',
        })
      ).rejects.toThrow(TypeError);
    });

    it('should estimate smooth playback for low resolution', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 640,
          height: 480,
          bitrate: 1000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
      expect(result.smooth).toBe(true);
    });

    it('should report smooth false for extremely high resolution', async () => {
      const result = await mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 7680,
          height: 4320,
          bitrate: 80000000,
          framerate: 120,
        },
      });

      expect(result.supported).toBe(true);
      expect(result.smooth).toBe(false);
    });

    it('should include configuration in result', async () => {
      const config = {
        type: 'file' as const,
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30,
        },
      };

      const result = await mediaCapabilities.decodingInfo(config);

      expect(result.configuration).toEqual(config);
    });
  });

  describe('encodingInfo', () => {
    it('should return supported for H.264 encoding', async () => {
      const result = await mediaCapabilities.encodingInfo({
        type: 'record',
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 1280,
          height: 720,
          bitrate: 2000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
      expect(typeof result.smooth).toBe('boolean');
      expect(typeof result.powerEfficient).toBe('boolean');
    });

    it('should return supported for VP9 encoding', async () => {
      const result = await mediaCapabilities.encodingInfo({
        type: 'record',
        video: {
          contentType: 'video/webm; codecs="vp9"',
          width: 1920,
          height: 1080,
          bitrate: 4000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should return supported for audio encoding', async () => {
      const result = await mediaCapabilities.encodingInfo({
        type: 'record',
        audio: {
          contentType: 'audio/webm; codecs="opus"',
          channels: 2,
          bitrate: 128000,
          samplerate: 48000,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should return not supported for unsupported codec', async () => {
      const result = await mediaCapabilities.encodingInfo({
        type: 'record',
        video: {
          contentType: 'video/mp4; codecs="unsupported"',
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(false);
    });

    it('should throw for missing type', async () => {
      await expect(
        mediaCapabilities.encodingInfo({
          type: '' as any,
          video: {
            contentType: 'video/mp4; codecs="avc1"',
            width: 1920,
            height: 1080,
            bitrate: 5000000,
            framerate: 30,
          },
        })
      ).rejects.toThrow(TypeError);
    });

    it('should support webrtc type', async () => {
      const result = await mediaCapabilities.encodingInfo({
        type: 'webrtc',
        video: {
          contentType: 'video/webm; codecs="vp8"',
          width: 640,
          height: 480,
          bitrate: 1000000,
          framerate: 30,
        },
      });

      expect(result.supported).toBe(true);
    });

    it('should include configuration in result', async () => {
      const config = {
        type: 'record' as const,
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 1280,
          height: 720,
          bitrate: 2000000,
          framerate: 30,
        },
      };

      const result = await mediaCapabilities.encodingInfo(config);

      expect(result.configuration).toEqual(config);
    });

    it('should mark high resolution encoding as not smooth', async () => {
      const result = await mediaCapabilities.encodingInfo({
        type: 'record',
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 7680,
          height: 4320,
          bitrate: 80000000,
          framerate: 120,
        },
      });

      expect(result.supported).toBe(true);
      expect(result.smooth).toBe(false);
    });
  });

  describe('MediaCapabilities class', () => {
    it('should be instantiable', () => {
      const mc = new MediaCapabilities();
      expect(mc).toBeInstanceOf(MediaCapabilities);
    });

    it('should have decodingInfo method', () => {
      const mc = new MediaCapabilities();
      expect(typeof mc.decodingInfo).toBe('function');
    });

    it('should have encodingInfo method', () => {
      const mc = new MediaCapabilities();
      expect(typeof mc.encodingInfo).toBe('function');
    });
  });

  describe('global mediaCapabilities instance', () => {
    it('should be a MediaCapabilities instance', () => {
      expect(mediaCapabilities).toBeInstanceOf(MediaCapabilities);
    });
  });
});

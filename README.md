# webcodecs-node

WebCodecs API implementation for Node.js using FFmpeg.

This package provides a Node.js-compatible implementation of the [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), enabling video and audio encoding/decoding in server-side JavaScript applications.

## Features

- **VideoEncoder / VideoDecoder** - H.264, HEVC, VP8, VP9, AV1
- **AudioEncoder / AudioDecoder** - AAC, Opus, MP3, FLAC, Vorbis
- **ImageDecoder** - PNG, JPEG, WebP, GIF, AVIF, BMP, TIFF (including animated with frame timing)
- **VideoFrame / AudioData** - Frame-level data manipulation
- **MediaCapabilities** - Query codec support, smooth playback, and power efficiency
- **Hardware Acceleration** - VAAPI, NVENC, QSV support
- **Streaming Support** - Real-time frame-by-frame encoding/decoding
- **Latency Modes** - Configure for real-time streaming vs maximum compression
- **Bitrate Modes** - Constant, variable, and quantizer (CRF) encoding modes
- **Alpha Channel** - Preserve transparency with VP9 and AV1 codecs
- **Mediabunny Integration** - Custom encoders/decoders for file conversion

## Documentation

- [API Reference](./docs/api.md) - Detailed API documentation for all classes
- [Codec Support](./docs/codecs.md) - Supported video, audio, and image codecs
- [Configuration Guide](./docs/configuration.md) - bitrateMode, alpha, latencyMode, and more
- [Examples](./examples/) - Practical usage examples

## Requirements

- Node.js 18+
- FFmpeg with encoding libraries (libx264, libx265, libvpx, etc.)

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Check installation
ffmpeg -version
```

## Installation

```bash
npm install webcodecs-node
```

## Quick Start

### Using the Polyfill

Install the WebCodecs API globally to make it available as browser-compatible globals:

```typescript
import { installWebCodecsPolyfill } from 'webcodecs-node';

// Install globally
installWebCodecsPolyfill();

// Now use standard WebCodecs API
const encoder = new VideoEncoder({
  output: (chunk, metadata) => {
    console.log('Encoded chunk:', chunk.byteLength, 'bytes');
  },
  error: (e) => console.error(e),
});

await encoder.configure({
  codec: 'avc1.42001E', // H.264 Baseline
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
});
```

### Direct Import

```typescript
import {
  VideoEncoder,
  VideoDecoder,
  VideoFrame,
  AudioEncoder,
  AudioDecoder,
  AudioData,
  ImageDecoder,
  mediaCapabilities,
} from 'webcodecs-node';
```

## API Reference

### VideoEncoder

Encodes raw video frames to compressed video.

```typescript
const encoder = new VideoEncoder({
  output: (chunk, metadata) => {
    // chunk is EncodedVideoChunk
    // metadata contains timing info
  },
  error: (e) => console.error(e),
});

await encoder.configure({
  codec: 'avc1.42001E',  // H.264
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  framerate: 30,
  bitrateMode: 'variable',                 // Optional: 'constant', 'variable', or 'quantizer'
  latencyMode: 'realtime',                 // Optional: 'realtime' for streaming, 'quality' for best compression
  hardwareAcceleration: 'prefer-hardware', // Optional: use GPU encoding
  format: 'mp4',                           // Optional: 'annexb' (default) or 'mp4'
});

// Create a frame from raw RGBA data
const frame = new VideoFrame(rgbaBuffer, {
  format: 'RGBA',
  codedWidth: 1920,
  codedHeight: 1080,
  timestamp: 0,
});

encoder.encode(frame);
frame.close();

await encoder.flush();
encoder.close();
```

**Supported codecs:**
- `avc1.*` - H.264/AVC
- `hev1.*`, `hvc1.*` - H.265/HEVC
- `vp8` - VP8
- `vp09.*` - VP9
- `av01.*` - AV1

### VideoDecoder

Decodes compressed video to raw frames.

```typescript
const decoder = new VideoDecoder({
  output: (frame) => {
    // frame is VideoFrame with raw pixel data
    console.log(`Frame: ${frame.codedWidth}x${frame.codedHeight}`);
    frame.close();
  },
  error: (e) => console.error(e),
});

await decoder.configure({
  codec: 'avc1.42001E',
  codedWidth: 1920,
  codedHeight: 1080,
});

// Decode an encoded chunk
decoder.decode(encodedVideoChunk);
await decoder.flush();
decoder.close();
```

### AudioEncoder

Encodes raw audio samples to compressed audio.

```typescript
const encoder = new AudioEncoder({
  output: (chunk, metadata) => {
    console.log('Encoded audio:', chunk.byteLength, 'bytes');
  },
  error: (e) => console.error(e),
});

await encoder.configure({
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128000,
  format: 'aac', // Optional: 'adts' (default for AAC) or 'aac'
});

// Create audio data from raw samples
const audioData = new AudioData({
  format: 'f32',
  sampleRate: 48000,
  numberOfChannels: 2,
  numberOfFrames: 1024,
  timestamp: 0,
  data: float32Samples,
});

encoder.encode(audioData);
audioData.close();

await encoder.flush();
encoder.close();
```

**Supported codecs:**
- `opus` - Opus
- `mp4a.40.2` - AAC-LC
- `mp3` - MP3
- `flac` - FLAC
- `vorbis` - Vorbis

### ImageDecoder

Decodes images (including animated) to VideoFrames. Fully compliant with the [WebCodecs ImageDecoder API](https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder).

```typescript
import { readFileSync } from 'fs';

const imageData = readFileSync('animation.gif');

const decoder = new ImageDecoder({
  type: 'image/gif',
  data: imageData,
  // Optional: transfer ownership for zero-copy
  // transfer: [imageData.buffer],
});

// Wait for parsing to complete
await decoder.completed;

// Access track information
const track = decoder.tracks.selectedTrack;
console.log(`Type: ${decoder.type}`);
console.log(`Frames: ${track?.frameCount}`);
console.log(`Animated: ${track?.animated}`);
console.log(`Loop count: ${track?.repetitionCount}`); // Infinity = loop forever

// Decode each frame with timing info
for (let i = 0; i < track.frameCount; i++) {
  const { image, complete } = await decoder.decode({ frameIndex: i });
  console.log(`Frame ${i}: ${image.codedWidth}x${image.codedHeight}`);
  console.log(`  Timestamp: ${image.timestamp / 1000}ms`);
  console.log(`  Duration: ${image.duration / 1000}ms`);
  image.close();
}

decoder.close();
```

**Constructor options:**
- `type` - MIME type (required)
- `data` - ArrayBuffer, TypedArray, or ReadableStream (required)
- `transfer` - ArrayBuffer[] for zero-copy ownership
- `colorSpaceConversion` - 'none' | 'default'
- `desiredWidth` / `desiredHeight` - Target dimensions
- `preferAnimation` - Prefer animated track if available
- `premultiplyAlpha` - 'none' | 'premultiply' | 'default'

**Properties:**
- `type` - MIME type string
- `complete` - Boolean, true when data is buffered
- `completed` - Promise that resolves when ready
- `tracks` - ImageTrackList with track information

**Supported formats:**
- `image/png`, `image/apng`
- `image/jpeg`
- `image/webp`
- `image/gif`
- `image/avif`
- `image/bmp`
- `image/tiff`

### MediaCapabilities API

Query codec capabilities before encoding/decoding. Implements the standard [MediaCapabilities API](https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities).

```typescript
import { mediaCapabilities } from 'webcodecs-node';

// Query decoding capabilities
const decodeInfo = await mediaCapabilities.decodingInfo({
  type: 'file',
  video: {
    contentType: 'video/mp4; codecs="avc1.42E01E"',
    width: 1920,
    height: 1080,
    bitrate: 5_000_000,
    framerate: 30,
  },
  audio: {
    contentType: 'audio/mp4; codecs="mp4a.40.2"',
    channels: 2,
    bitrate: 128000,
    samplerate: 44100,
  },
});

console.log('Supported:', decodeInfo.supported);
console.log('Smooth playback:', decodeInfo.smooth);
console.log('Power efficient:', decodeInfo.powerEfficient);

// Query encoding capabilities
const encodeInfo = await mediaCapabilities.encodingInfo({
  type: 'record',
  video: {
    contentType: 'video/webm; codecs="vp9"',
    width: 1280,
    height: 720,
    bitrate: 2_000_000,
    framerate: 30,
  },
});

if (encodeInfo.supported && encodeInfo.powerEfficient) {
  console.log('Hardware-accelerated encoding available!');
}
```

**Supported containers & codecs:**
| Container | Video Codecs | Audio Codecs |
|-----------|-------------|--------------|
| video/mp4 | H.264, HEVC, AV1 | AAC |
| video/webm | VP8, VP9, AV1 | Opus, Vorbis |
| audio/mp4 | - | AAC |
| audio/webm | - | Opus, Vorbis |
| audio/ogg | - | Opus, Vorbis, FLAC |
| audio/mpeg | - | MP3 |

**Result properties:**
- `supported` - Whether the configuration can be decoded/encoded
- `smooth` - Whether playback/encoding will be smooth (no dropped frames)
- `powerEfficient` - Whether hardware acceleration is available

### MediaCapabilities Profiles

By default, capability queries use heuristics (resolution, bitrate, detected hardware). You can provide a detailed profile generated from the local FFmpeg installation:

```bash
# Generate a JSON profile alongside the repo (builds first)
npm run capabilities:generate -- ./webcodecs-capabilities.json

# Point WebCodecs at the profile
export WEBCODECS_CAPABILITIES_PROFILE=$(pwd)/webcodecs-capabilities.json
```

`decodingInfo` / `encodingInfo` will load that JSON (schema: `{ video: CapabilityProfileEntry[]; audio: CapabilityProfileEntry[] }`) and match codec/profile/level against those entries for precise limits. Without the env var the library falls back to its built-in heuristics.

### Hardware Acceleration

Detect and use hardware encoding/decoding:

```typescript
import {
  detectHardwareAcceleration,
  getHardwareAccelerationSummary,
  getBestEncoder,
} from 'webcodecs-node';

// Get a summary of available hardware acceleration
const summary = await getHardwareAccelerationSummary();
console.log(summary);

// Detect capabilities
const capabilities = await detectHardwareAcceleration();
console.log('Available methods:', capabilities.methods);
console.log('Hardware encoders:', capabilities.encoders);
console.log('Hardware decoders:', capabilities.decoders);

// Get best encoder for a codec
const best = await getBestEncoder('h264', 'prefer-hardware');
console.log(`Using: ${best.encoder} (hardware: ${best.isHardware})`);

// Use in VideoEncoder config
await encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  hardwareAcceleration: 'prefer-hardware',
});
```

**Supported acceleration methods:**
- **VAAPI** - Intel/AMD on Linux
- **NVENC/NVDEC** - NVIDIA GPUs
- **QSV** - Intel Quick Sync Video
- **VideoToolbox** - macOS (planned)

### Streaming & Latency Modes

For real-time streaming applications, use `latencyMode: 'realtime'` to minimize encoding latency:

```typescript
// Real-time streaming encoder
const encoder = new VideoEncoder({
  output: (chunk) => {
    // Send chunk immediately over network
    streamToClient(chunk);
  },
  error: console.error,
});

await encoder.configure({
  codec: 'avc1.42001E',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  framerate: 30,
  latencyMode: 'realtime', // Prioritize low latency
});

// Process frames as they arrive
camera.on('frame', (frameData) => {
  const frame = new VideoFrame(frameData, {
    format: 'RGBA',
    codedWidth: 1280,
    codedHeight: 720,
    timestamp: Date.now() * 1000,
  });

  encoder.encode(frame);
  frame.close();
});
```

**Latency mode options:**
- `'quality'` (default) - Best compression, higher latency (uses B-frames, lookahead)
- `'realtime'` - Minimum latency for live streaming (no B-frames, zero-delay)

**Codec-specific optimizations in realtime mode:**
| Codec | Quality Mode | Realtime Mode |
|-------|-------------|---------------|
| H.264 | B-frames, rc-lookahead | zerolatency tune, no B-frames |
| H.265 | B-frames, lookahead | zerolatency tune, no B-frames |
| VP8   | Default settings | deadline=realtime, cpu-used=8 |
| VP9   | row-mt, tile-columns | deadline=realtime, cpu-used=8 |
| AV1   | Default settings | usage=realtime, cpu-used=8 |

### Bitrate Modes

Control how bitrate is managed during encoding:

```typescript
await encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  bitrateMode: 'constant', // CBR for streaming
});
```

**Bitrate mode options:**
| Mode | Description | Use Case |
|------|-------------|----------|
| `'variable'` | VBR - varies bitrate for quality (default) | General purpose |
| `'constant'` | CBR - fixed bitrate throughout | Streaming, broadcast |
| `'quantizer'` | CRF/CQ - fixed quality level | Archival, quality-first |

### Alpha Channel (Transparency)

Preserve transparency when encoding with VP9 or AV1:

```typescript
// Encode video with alpha channel
await encoder.configure({
  codec: 'vp9',
  width: 1920,
  height: 1080,
  alpha: 'keep', // Preserve transparency
});

// Create RGBA frame with transparency
const frame = new VideoFrame(rgbaWithAlpha, {
  format: 'RGBA',
  codedWidth: 1920,
  codedHeight: 1080,
  timestamp: 0,
});

encoder.encode(frame);
```

**Alpha options:**
- `'discard'` (default) - Strip alpha channel (works with all codecs)
- `'keep'` - Preserve transparency (VP9 and AV1 only)

## Mediabunny Integration

For file-to-file conversion, use with [Mediabunny](https://mediabunny.dev):

```typescript
import { ReadableStream, WritableStream, TransformStream } from 'stream/web';
import { installWebCodecsPolyfill } from 'webcodecs-node';

// Polyfill Web Streams
if (typeof globalThis.WritableStream === 'undefined') {
  globalThis.WritableStream = WritableStream;
}
if (typeof globalThis.ReadableStream === 'undefined') {
  globalThis.ReadableStream = ReadableStream;
}
if (typeof globalThis.TransformStream === 'undefined') {
  globalThis.TransformStream = TransformStream;
}

// Install WebCodecs
installWebCodecsPolyfill();

import {
  Input,
  Output,
  Conversion,
  FilePathSource,
  FilePathTarget,
  Mp4OutputFormat,
  ALL_FORMATS,
  registerEncoder,
  registerDecoder,
} from 'mediabunny';

import { FFmpegVideoEncoder } from 'webcodecs-node/mediabunny/FFmpegVideoEncoder';
import { FFmpegVideoDecoder } from 'webcodecs-node/mediabunny/FFmpegVideoDecoder';
import { FFmpegAudioEncoder } from 'webcodecs-node/mediabunny/FFmpegAudioEncoder';
import { FFmpegAudioDecoder } from 'webcodecs-node/mediabunny/FFmpegAudioDecoder';

// Register FFmpeg-backed encoders/decoders
registerEncoder(FFmpegVideoEncoder);
registerEncoder(FFmpegAudioEncoder);
registerDecoder(FFmpegVideoDecoder);
registerDecoder(FFmpegAudioDecoder);

// Convert video
const input = new Input({
  formats: ALL_FORMATS,
  source: new FilePathSource('input.mkv'),
});

const output = new Output({
  format: new Mp4OutputFormat(),
  target: new FilePathTarget('output.mp4'),
});

const conversion = await Conversion.init({ input, output });
await conversion.execute();

console.log('Conversion complete!');
```

## Demos

Run the included demos to test functionality:

```bash
npm run build

# Basic WebCodecs demo
npm run demo:webcodecs

# Image decoding demo (animated GIF/PNG/WebP with frame timing)
npm run demo:image

# Streaming demo (real-time encoding with latency comparison)
npm run demo:streaming

# File conversion with Mediabunny
npm run demo:conversion

# Hardware acceleration detection
npm run demo:hwaccel

# Hardware vs software encoding comparison
npm run demo:hwaccel-conversion
```

## API Compatibility

This implementation follows the [WebCodecs specification](https://www.w3.org/TR/webcodecs/) with some Node.js-specific adaptations:

| Feature | Browser | webcodecs-node |
|---------|---------|----------------|
| VideoEncoder | ✓ | ✓ |
| VideoDecoder | ✓ | ✓ |
| AudioEncoder | ✓ | ✓ |
| AudioDecoder | ✓ | ✓ |
| ImageDecoder | ✓ | ✓ |
| VideoFrame | ✓ | ✓ |
| AudioData | ✓ | ✓ |
| EncodedVideoChunk | ✓ | ✓ |
| EncodedAudioChunk | ✓ | ✓ |
| ImageTrack/ImageTrackList | ✓ | ✓ |
| MediaCapabilities | ✓ | ✓ |
| Hardware Acceleration | Auto | Opt-in |
| latencyMode | ✓ | ✓ |
| bitrateMode | ✓ | ✓ |
| alpha (transparency) | ✓ | ✓ (VP9, AV1) |
| isConfigSupported() | ✓ | ✓ |
| isTypeSupported() | ✓ | ✓ |

**Notes:**
- Hardware acceleration defaults to software encoding for reliability. Use `hardwareAcceleration: 'prefer-hardware'` to enable GPU acceleration.
- ImageDecoder supports animated image frame timing (duration, timestamp) and loop count (repetitionCount).

## License

webcodecs-node is distributed under the GNU Affero General Public License v3.0. Files located under `src/mediabunny/` remain available under the MIT License to preserve compatibility with Mediabunny integrations. See `LICENSE` for full terms.

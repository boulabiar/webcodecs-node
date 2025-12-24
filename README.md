# webcodecs-node

WebCodecs API implementation for Node.js using node-av.

This package provides a Node.js-compatible implementation of the [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), enabling video and audio encoding/decoding in server-side JavaScript applications.

## Features

- **VideoEncoder / VideoDecoder** - H.264, HEVC, VP8, VP9, AV1
- **AudioEncoder / AudioDecoder** - AAC, Opus, MP3, FLAC, Vorbis
- **ImageDecoder** - PNG, JPEG, WebP, GIF, AVIF, BMP, TIFF (including animated with frame timing)
- **ImageEncoder** - Encode VideoFrames to PNG, JPEG, WebP
- **VideoFrame / AudioData** - Frame-level data manipulation
- **MediaCapabilities** - Query codec support, smooth playback, and power efficiency
- **Hardware Acceleration** - VAAPI, NVENC, QSV support
- **Streaming Support** - Real-time frame-by-frame encoding/decoding
- **Latency Modes** - Configure for real-time streaming vs maximum compression
- **Bitrate Modes** - Constant, variable, and quantizer (CRF) encoding modes
- **Alpha Channel** - Preserve transparency with VP9 and AV1 codecs
- **10-bit & HDR** - I420P10, P010 formats with HDR10 metadata support
- **Container Support** - MP4, WebM demuxing/muxing utilities

## Documentation

- [API Reference](./docs/api.md) - Detailed API documentation for all classes
- [Codec Support](./docs/codecs.md) - Supported video, audio, and image codecs
- [Configuration Guide](./docs/configuration.md) - bitrateMode, alpha, latencyMode, and more
- [Examples](./examples/) - Practical usage examples

## Requirements

- Node.js 18+
- The `node-av` package (automatically installed as a dependency)

```bash
# node-av provides native FFmpeg bindings - no separate FFmpeg installation required
npm install webcodecs-node
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

encoder.configure({
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
    // metadata contains decoder config info
  },
  error: (e) => console.error(e),
});

encoder.configure({
  codec: 'avc1.42001E',  // H.264
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  framerate: 30,
  bitrateMode: 'variable',                 // Optional: 'constant', 'variable', or 'quantizer'
  latencyMode: 'realtime',                 // Optional: 'realtime' for streaming, 'quality' for best compression
  hardwareAcceleration: 'prefer-hardware', // Optional: use GPU encoding
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

decoder.configure({
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

encoder.configure({
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128000,
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

**Supported formats:**
- `image/png`, `image/apng`
- `image/jpeg`
- `image/webp`
- `image/gif`
- `image/avif`
- `image/bmp`
- `image/tiff`

### ImageEncoder

Encodes VideoFrames to image formats (PNG, JPEG, WebP). This is a utility class that mirrors ImageDecoder.

```typescript
import { ImageEncoder, VideoFrame } from 'webcodecs-node';

// Check format support
ImageEncoder.isTypeSupported('image/webp'); // true

// Encode a frame to JPEG
const result = await ImageEncoder.encode(frame, {
  type: 'image/jpeg',
  quality: 0.85,
});

fs.writeFileSync('output.jpg', Buffer.from(result.data));

// Synchronous encoding
const pngResult = ImageEncoder.encodeSync(frame, { type: 'image/png' });

// Batch encode multiple frames
const results = await ImageEncoder.encodeBatch(frames, { type: 'image/webp' });
```

**Supported output formats:**
- `image/png` - Lossless, supports transparency
- `image/jpeg` - Lossy, quality 0-1 (default: 0.92)
- `image/webp` - Lossy/lossless, quality 0-1 (default: 0.8)

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
encoder.configure({
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
- **VideoToolbox** - macOS

### Container Utilities

Import container demuxing/muxing utilities for working with MP4, WebM, and MKV files:

```typescript
import { Demuxer, Muxer, muxChunks, extractVideoFrames } from 'webcodecs-node/containers';

// Demux a video file
const demuxer = new Demuxer({ path: 'input.mp4' });
await demuxer.open();

console.log('Video:', demuxer.videoConfig);
console.log('Audio:', demuxer.audioConfig);

for await (const chunk of demuxer.videoChunks()) {
  // chunk is EncodedVideoChunk ready for VideoDecoder
}
await demuxer.close();

// Mux encoded chunks to a file
const muxer = new Muxer({ path: 'output.mp4' });
await muxer.open();
await muxer.addVideoTrack({
  codec: 'avc1.42001E',
  codedWidth: 1920,
  codedHeight: 1080,
  description: spsNaluBuffer, // Optional: H.264 SPS/PPS
});

for (const chunk of encodedChunks) {
  await muxer.writeVideoChunk(chunk);
}

const result = await muxer.closeWithResult();
console.log(`Muxed with ${result.backend} in ${result.durationMs}ms`);

// Or use the convenience function
const result = await muxChunks({
  path: 'output.mp4',
  video: { config: videoTrackConfig, chunks: videoChunks },
  audio: { config: audioTrackConfig, chunks: audioChunks },
});

// Extract decoded frames directly
for await (const frame of extractVideoFrames('input.mp4')) {
  console.log(`Frame: ${frame.timestamp}us`);
  frame.close();
}
```

**Muxer Fallback Architecture:**

The `Muxer` class uses a two-tier approach for reliability:

1. **Primary: node-av** (~5ms) - Fast native muxing using node-av's FormatContext API
2. **Fallback: FFmpeg subprocess** (~130ms) - Spawns FFmpeg process if node-av fails

```typescript
const muxer = new Muxer({
  path: 'output.mp4',
  onFallback: (err) => console.warn('Using FFmpeg fallback:', err.message),
  forceBackend: 'node-av', // Optional: 'node-av' or 'ffmpeg-spawn'
});
```

You can also use the backend-specific classes directly:

```typescript
import { NodeAvMuxer, FFmpegMuxer } from 'webcodecs-node/containers';

// Fast path only
const fastMuxer = new NodeAvMuxer({ path: 'output.mp4' });

// FFmpeg subprocess only
const ffmpegMuxer = new FFmpegMuxer({ path: 'output.mp4' });
```

### Streaming & Latency Modes

For real-time streaming applications, use `latencyMode: 'realtime'` to minimize encoding latency:

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  framerate: 30,
  latencyMode: 'realtime', // Prioritize low latency
});
```

**Latency mode options:**
- `'quality'` (default) - Best compression, higher latency (uses B-frames, lookahead)
- `'realtime'` - Minimum latency for live streaming (no B-frames, zero-delay)

### Bitrate Modes

Control how bitrate is managed during encoding:

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  bitrateMode: 'constant', // CBR for streaming
});
```

| Mode | Description | Use Case |
|------|-------------|----------|
| `'variable'` | VBR - varies bitrate for quality (default) | General purpose |
| `'constant'` | CBR - fixed bitrate throughout | Streaming, broadcast |
| `'quantizer'` | CRF/CQ - fixed quality level | Archival, quality-first |

### Alpha Channel (Transparency)

Preserve transparency when encoding with VP9 or AV1:

```typescript
encoder.configure({
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

### 10-bit Pixel Formats & HDR

Support for high bit-depth content and HDR metadata:

```typescript
import {
  VideoFrame,
  VideoColorSpace,
  createHdr10MasteringMetadata,
  createContentLightLevel,
  is10BitFormat,
  getBitDepth,
} from 'webcodecs-node';

// Create a 10-bit frame
const frame = new VideoFrame(yuv10bitData, {
  format: 'I420P10',  // 10-bit YUV 4:2:0
  codedWidth: 3840,
  codedHeight: 2160,
  timestamp: 0,
  colorSpace: new VideoColorSpace({
    primaries: 'bt2020',
    transfer: 'pq',        // HDR10 PQ transfer
    matrix: 'bt2020-ncl',
  }),
});

// Check format properties
console.log(is10BitFormat('I420P10'));  // true
console.log(getBitDepth('I420P10'));    // 10

// HDR metadata for mastering display
const hdrMetadata = {
  smpteSt2086: createHdr10MasteringMetadata(1000, 0.0001), // max/min luminance
  contentLightLevel: createContentLightLevel(800, 400),    // MaxCLL, MaxFALL
};

const colorSpace = new VideoColorSpace({
  primaries: 'bt2020',
  transfer: 'pq',
  hdrMetadata,
});

console.log(colorSpace.isHdr);          // true
console.log(colorSpace.hasHdrMetadata); // true
```

**10-bit pixel formats:**
- `I420P10` - YUV 4:2:0 planar, 10-bit
- `I422P10` - YUV 4:2:2 planar, 10-bit
- `I444P10` - YUV 4:4:4 planar, 10-bit
- `P010` - YUV 4:2:0 semi-planar, 10-bit

**Pixel format utilities:**
- `is10BitFormat(format)` - Check if format is 10-bit
- `getBitDepth(format)` - Get bit depth (8 or 10)
- `get8BitEquivalent(format)` - Get 8-bit version of a 10-bit format
- `get10BitEquivalent(format)` - Get 10-bit version of an 8-bit format

### Canvas Rendering (skia-canvas)

GPU-accelerated 2D canvas rendering with automatic hardware detection:

```typescript
import {
  createCanvas,
  createFrameLoop,
  detectGpuAcceleration,
  isGpuAvailable,
  getGpuApi,
  ensureEvenDimensions,
  VideoEncoder,
} from 'webcodecs-node';

// Check GPU availability
const gpuInfo = detectGpuAcceleration();
console.log(`Renderer: ${gpuInfo.renderer}`); // 'GPU' or 'CPU'
console.log(`API: ${getGpuApi()}`);           // 'Metal', 'Vulkan', 'D3D', or null

// Create GPU-accelerated canvas
const canvas = createCanvas({
  width: 1920,
  height: 1080,
  gpu: true, // or omit for auto-detection
});

const ctx = canvas.getContext('2d');
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 1920, 1080);

// Create VideoFrame directly from canvas
const frame = new VideoFrame(canvas, { timestamp: 0 });
```

**FrameLoop helper** for animation with backpressure:

```typescript
const loop = createFrameLoop({
  width: 1920,
  height: 1080,
  frameRate: 30,
  maxQueueSize: 8, // Backpressure limit
  onFrame: (ctx, timing) => {
    // Draw each frame
    ctx.fillStyle = `hsl(${timing.frameIndex % 360}, 100%, 50%)`;
    ctx.fillRect(0, 0, 1920, 1080);
  },
});

loop.start(300); // Generate 300 frames

while (loop.getState() !== 'stopped' || loop.getQueueSize() > 0) {
  const frame = loop.takeFrame();
  if (frame) {
    encoder.encode(frame);
    frame.close(); // Always close frames!
  }
}
```

**OffscreenCanvas polyfill** for browser-compatible code:

```typescript
import { installOffscreenCanvasPolyfill } from 'webcodecs-node';

installOffscreenCanvasPolyfill();

// Now use standard OffscreenCanvas API
const canvas = new OffscreenCanvas(1920, 1080);
const ctx = canvas.getContext('2d');
const blob = await canvas.convertToBlob({ type: 'image/png' });
```

## Performance Tuning

### Memory Management

Always close VideoFrames and AudioData when done:

```typescript
const frame = new VideoFrame(buffer, { ... });
try {
  encoder.encode(frame);
} finally {
  frame.close(); // Prevent memory leaks
}
```

### Even Dimensions

Video codecs require even dimensions for YUV420 chroma subsampling:

```typescript
import { ensureEvenDimensions, validateEvenDimensions } from 'webcodecs-node';

// Auto-fix odd dimensions (rounds up)
const { width, height } = ensureEvenDimensions(1279, 719);
// Returns { width: 1280, height: 720 }

// Strict validation (throws if odd)
validateEvenDimensions(1280, 720); // OK
validateEvenDimensions(1279, 720); // Throws TypeError
```

### Backpressure Handling

Monitor encoder queue to prevent memory exhaustion:

```typescript
encoder.addEventListener('dequeue', () => {
  // Queue size decreased, safe to encode more
  if (encoder.encodeQueueSize < 10) {
    encodeNextFrame();
  }
});
```

### Raw Buffer Export

For maximum performance, use raw RGBA buffers instead of PNG/JPEG:

```typescript
import { getRawPixels } from 'webcodecs-node';

// Fast: raw RGBA buffer (no compression)
const pixels = getRawPixels(canvas); // Returns Buffer

// Slow: PNG encoding (avoid in hot paths)
const png = await canvas.toBuffer('png');
```

### GPU vs CPU Tradeoffs

| Scenario | Recommendation |
|----------|----------------|
| HD/4K encoding | `hardwareAcceleration: 'prefer-hardware'` |
| Real-time streaming | Hardware + `latencyMode: 'realtime'` |
| Maximum quality | Software + `bitrateMode: 'quantizer'` |
| Batch processing | Hardware for throughput |
| Low-end systems | Software (more compatible) |

## Debugging

Enable debug logging to troubleshoot encoding/decoding issues:

```bash
# Enable debug output
WEBCODECS_DEBUG=1 node your-script.js

# Or set programmatically
import { setDebugMode } from 'webcodecs-node';
setDebugMode(true);
```

Debug mode outputs detailed information about:
- Hardware acceleration detection and selection
- Encoder/decoder initialization
- Muxer backend selection and fallback events
- Filter chain configuration
- Error details with context

Example debug output:
```
[webcodecs:Transcode] Using hardware acceleration: vaapi
[webcodecs:Transcode] Using hardware decoder for h264
[webcodecs:Transcode] Using hardware encoder for h264
[webcodecs:Transcode] Using filter chain: scale_vaapi=format=nv12
[webcodecs:NodeAvMuxer] writeTrailer returned error code -22
```

## Demos

Run the included demos to test functionality:

```bash
npm run build

# Basic demo
npm run demo

# WebCodecs API demo
npm run demo:webcodecs

# Image decoding demo (animated GIF/PNG/WebP with frame timing)
npm run demo:image

# Hardware acceleration detection
npm run demo:hwaccel

# Streaming demo (real-time encoding)
npm run demo:streaming

# Sample-based encoding demo
npm run demo:samples

# Container demuxing/muxing demo
npm run demo:containers

# Video quadrant compositor demo (four-up render)
npm run demo:fourcorners

# 1080p transcoding demo
npm run demo:1080p

# DVD bouncing logo animation
npm run demo:dvd

# Audio visualizer with waveform and spectrum
npm run demo:visualizer
```

## Benchmarking

Compare software vs hardware encoding performance:

```bash
# Quick benchmark (30 frames, 360p)
npm run bench:quick

# Default benchmark (120 frames, 720p)
npm run bench

# Full benchmark (300 frames, 1080p)
npm run bench:full

# Custom options
node scripts/encoding-benchmark.mjs --frames 100 --resolution 1080p --codecs h264,hevc
```

**Options:**
- `--frames <n>` - Number of frames to encode (default: 120)
- `--resolution <res>` - 360p, 480p, 720p, 1080p, 4k (default: 720p)
- `--bitrate <bps>` - Target bitrate in bps
- `--framerate <fps>` - Target framerate (default: 30)
- `--codecs <list>` - Comma-separated: h264,hevc,vp9,av1
- `--skip-software` - Only test hardware encoding
- `--verbose` - Show detailed output

**Example output:**
```
════════════════════════════════════════════════════════════════════════════════
ENCODING BENCHMARK RESULTS (720p)
════════════════════════════════════════════════════════════════════════════════
Codec       Mode           FPS      Time   Latency        Size       Bitrate
────────────────────────────────────────────────────────────────────────────────
H.264/AVC   SW           213.6     562ms     391ms     2.00 MB     4.20 Mbps
H.264/AVC   HW           370.4     324ms     187ms     2.11 MB     4.43 Mbps
H.265/HEVC  SW           141.4     848ms     106ms     1.94 MB     4.06 Mbps
H.265/HEVC  HW           589.0     204ms      61ms     2.16 MB     4.54 Mbps
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

## Architecture

This library uses **node-av** as its backend, which provides native bindings to FFmpeg's libav* libraries. This approach offers:

- **Native performance** - Direct library calls instead of subprocess spawning
- **Lower latency** - No IPC overhead between Node.js and FFmpeg
- **Better resource management** - Native memory handling and cleanup
- **Simplified deployment** - No need for separate FFmpeg installation

## License

webcodecs-node is distributed under the GNU Affero General Public License v3.0. See `LICENSE` for full terms.

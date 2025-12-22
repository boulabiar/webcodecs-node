# Configuration Guide

This guide covers all configuration options for video and audio encoding in webcodecs-node.

## Table of Contents

- [Bitrate Mode](#bitrate-mode)
- [Alpha Channel Handling](#alpha-channel-handling)
- [Latency Mode](#latency-mode)
- [Hardware Acceleration](#hardware-acceleration)
- [Pixel Formats](#pixel-formats)
- [Audio Sample Formats](#audio-sample-formats)

---

## Bitrate Mode

The `bitrateMode` option controls how the encoder manages bitrate during encoding.

### Available Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `'variable'` | Variable bitrate (VBR) - default | General purpose, best quality/size ratio |
| `'constant'` | Constant bitrate (CBR) | Streaming, predictable file size |
| `'quantizer'` | Fixed quality (CRF/CQ) | Archival, consistent quality |

### Variable Bitrate (VBR)

Default mode. Allocates more bits to complex scenes and fewer to simple ones.

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000, // Target average bitrate
  bitrateMode: 'variable',
});
```

**Pros:**
- Best quality for a given file size
- Efficient encoding

**Cons:**
- Unpredictable file size
- May cause buffering issues in streaming

### Constant Bitrate (CBR)

Maintains a steady bitrate throughout the video.

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000, // Fixed bitrate
  bitrateMode: 'constant',
});
```

**Pros:**
- Predictable file size
- Smooth streaming
- Required for some broadcast standards

**Cons:**
- May waste bits on simple scenes
- May degrade quality on complex scenes

### Quantizer Mode (CRF/CQ)

Uses a fixed quality level. The encoder adjusts bitrate to maintain consistent visual quality.

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrateMode: 'quantizer',
  // bitrate is optional/ignored in this mode
});
```

**Pros:**
- Consistent visual quality
- Optimal for archival
- No need to guess bitrate

**Cons:**
- Unpredictable file size
- Not suitable for streaming

### Codec-Specific Implementation

Different codecs use different parameters for each bitrate mode:

| Codec | CBR | VBR | Quantizer |
|-------|-----|-----|-----------|
| H.264 | `-b:v` + `maxrate`/`bufsize`, CBR mode | `-b:v` only | `-crf 23` |
| H.265 | `-b:v` + `maxrate`/`bufsize`, CBR mode | `-b:v` only | `-crf 28` |
| VP8/VP9 | `-b:v` + `minrate`/`maxrate` | `-b:v` only | `-crf 31` + `-b:v 0` |
| AV1 | `-b:v` + `maxrate`/`bufsize` | `-b:v` only | `-crf 30` |

---

## Alpha Channel Handling

The `alpha` option controls how transparent pixels are handled during encoding.

### Available Options

| Option | Description |
|--------|-------------|
| `'discard'` | Drop alpha channel (default) |
| `'keep'` | Preserve transparency |

### Codec Support for Alpha

| Codec | Alpha Support |
|-------|---------------|
| H.264 | No |
| H.265 | No |
| VP8 | No |
| VP9 | **Yes** |
| AV1 | **Yes** |

---

## Output Bitstream Format

By default the encoders emit Annex B (video) and ADTS/OGG (audio) streams directly from FFmpeg. If you need MP4-style payloads (length-prefixed NAL units, raw AAC frames) you can opt-in via the `format` config field.

### VideoEncoder `format`

| Value | Description |
|-------|-------------|
| `'annexb'` (default) | Emit Annex B/IVF bitstreams (same as before). |
| `'mp4'` | Convert Annex B output into length-prefixed avcC/hvcc samples and include `decoderConfig.description`. |

When `format: 'mp4'` is set the encoder automatically extracts SPS/PPS/VPS from keyframes and exposes them in metadata so an MP4 muxer can use them.

### AudioEncoder `format`

| Value | Description |
|-------|-------------|
| `'adts'` (default) | Emit AAC frames with ADTS headers (or Ogg/MP3 for other codecs). |
| `'aac'` | Strip ADTS headers and expose raw AAC frames with the AudioSpecificConfig in `decoderConfig.description`. |

This option currently applies to `mp4a.*`/`aac` codecs; other audio codecs continue to emit their container-specific framing.

### Discarding Alpha (Default)

Strips the alpha channel. Works with all codecs.

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  alpha: 'discard', // Default behavior
});
```

When encoding RGBA frames with `alpha: 'discard'`:
- Input: RGBA → Converted to YUV420
- Transparent areas become opaque

### Keeping Alpha

Preserves transparency. Only works with VP9 and AV1.

```typescript
encoder.configure({
  codec: 'vp9',
  width: 1920,
  height: 1080,
  alpha: 'keep',
});
```

When encoding RGBA frames with `alpha: 'keep'`:
- Input: RGBA → Converted to YUVA420P
- Transparency is preserved in the encoded video

**Example with transparent overlay:**

```typescript
const encoder = new VideoEncoder({
  output: (chunk) => saveChunk(chunk),
  error: console.error,
});

encoder.configure({
  codec: 'vp9',
  width: 640,
  height: 480,
  alpha: 'keep',
  framerate: 30,
});

// Create frame with transparency
const rgba = new Uint8Array(640 * 480 * 4);
for (let i = 0; i < rgba.length; i += 4) {
  rgba[i] = 255;     // R
  rgba[i + 1] = 0;   // G
  rgba[i + 2] = 0;   // B
  rgba[i + 3] = 128; // A - 50% transparent
}

const frame = new VideoFrame(rgba, {
  format: 'RGBA',
  codedWidth: 640,
  codedHeight: 480,
  timestamp: 0,
});

encoder.encode(frame);
frame.close();
```

---

## Latency Mode

The `latencyMode` option trades off compression efficiency for encoding latency.

### Available Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `'quality'` | Best compression (default) | File encoding, VOD |
| `'realtime'` | Minimum latency | Live streaming, video calls |

### Quality Mode (Default)

Optimizes for best compression. May use B-frames and lookahead.

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  latencyMode: 'quality',
});
```

### Realtime Mode

Minimizes encoding latency. Disables B-frames and lookahead.

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 2_000_000,
  latencyMode: 'realtime',
});
```

### Codec-Specific Optimizations

| Codec | Quality Mode | Realtime Mode |
|-------|--------------|---------------|
| H.264 | Default (B-frames, lookahead) | `-tune zerolatency`, no B-frames |
| H.265 | Default settings | `-tune zerolatency`, no B-frames |
| VP8 | Default | `-deadline realtime`, `-cpu-used 8` |
| VP9 | Row multithreading, tile columns | `-deadline realtime`, `-cpu-used 8` |
| AV1 | Default | `-usage realtime`, `-cpu-used 8` |

**Example for live streaming:**

```typescript
const encoder = new VideoEncoder({
  output: (chunk) => {
    // Send immediately over WebSocket/WebRTC
    socket.send(chunk);
  },
  error: console.error,
});

encoder.configure({
  codec: 'avc1.42001E',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  framerate: 30,
  latencyMode: 'realtime',
});
```

---

## Hardware Acceleration

The `hardwareAcceleration` option controls GPU encoding/decoding.

### Available Options

| Option | Description |
|--------|-------------|
| `'no-preference'` | Let the system decide |
| `'prefer-hardware'` | Use GPU if available |
| `'prefer-software'` | Use CPU encoding |

### Using Hardware Acceleration

```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  hardwareAcceleration: 'prefer-hardware',
});
```

### Detecting Available Hardware

```typescript
import {
  detectHardwareAcceleration,
  getHardwareAccelerationSummary,
} from 'webcodecs-node';

// Get human-readable summary
const summary = await getHardwareAccelerationSummary();
console.log(summary);

// Get detailed capabilities
const caps = await detectHardwareAcceleration();
console.log('Methods:', caps.methods);
console.log('Encoders:', caps.encoders);
console.log('Decoders:', caps.decoders);
```

### Supported Hardware Methods

| Method | Platform | GPUs |
|--------|----------|------|
| VAAPI | Linux | Intel, AMD |
| NVENC/NVDEC | Linux, Windows | NVIDIA |
| QSV | Linux, Windows | Intel |
| VideoToolbox | macOS | Apple Silicon, Intel |

---

## Pixel Formats

VideoFrame supports various pixel formats for input.

### Supported Formats

| Format | Description | Bytes/Pixel |
|--------|-------------|-------------|
| `'I420'` | YUV 4:2:0 planar | 1.5 |
| `'I420A'` | YUV 4:2:0 + alpha planar | 2 |
| `'I422'` | YUV 4:2:2 planar | 2 |
| `'I444'` | YUV 4:4:4 planar | 3 |
| `'NV12'` | YUV 4:2:0 semi-planar | 1.5 |
| `'RGBA'` | 8-bit RGBA interleaved | 4 |
| `'RGBX'` | 8-bit RGB (alpha ignored) | 4 |
| `'BGRA'` | 8-bit BGRA interleaved | 4 |
| `'BGRX'` | 8-bit BGR (alpha ignored) | 4 |

### Choosing a Format

**For encoding with transparency:**
```typescript
const frame = new VideoFrame(rgbaData, {
  format: 'RGBA',
  codedWidth: 1920,
  codedHeight: 1080,
  timestamp: 0,
});
```

**For maximum efficiency (no color conversion):**
```typescript
const frame = new VideoFrame(yuvData, {
  format: 'I420',
  codedWidth: 1920,
  codedHeight: 1080,
  timestamp: 0,
});
```

---

## Audio Sample Formats

AudioData supports various sample formats.

### Interleaved Formats

Samples from all channels are interleaved: L R L R L R...

| Format | Description | Bytes/Sample |
|--------|-------------|--------------|
| `'u8'` | Unsigned 8-bit | 1 |
| `'s16'` | Signed 16-bit | 2 |
| `'s32'` | Signed 32-bit | 4 |
| `'f32'` | 32-bit float | 4 |

### Planar Formats

Samples are grouped by channel: LLLLLL RRRRRR

| Format | Description | Bytes/Sample |
|--------|-------------|--------------|
| `'u8-planar'` | Unsigned 8-bit planar | 1 |
| `'s16-planar'` | Signed 16-bit planar | 2 |
| `'s32-planar'` | Signed 32-bit planar | 4 |
| `'f32-planar'` | 32-bit float planar | 4 |

### Example

```typescript
// Interleaved stereo float samples
const audioData = new AudioData({
  format: 'f32',
  sampleRate: 48000,
  numberOfChannels: 2,
  numberOfFrames: 1024,
  timestamp: 0,
  data: float32Samples, // L R L R L R...
});

// Planar stereo float samples
const audioDataPlanar = new AudioData({
  format: 'f32-planar',
  sampleRate: 48000,
  numberOfChannels: 2,
  numberOfFrames: 1024,
  timestamp: 0,
  data: float32SamplesPlanar, // LLLL... RRRR...
});
```

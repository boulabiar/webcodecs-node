# Examples

Practical examples demonstrating webcodecs-node features.

## Prerequisites

Build the project first:
```bash
npm run build
```

## Running Examples

Use `npx tsx` to run TypeScript examples directly:

```bash
npx tsx examples/video-encoding.ts
npx tsx examples/video-decoding.ts
npx tsx examples/audio-encoding.ts
npx tsx examples/image-decoding.ts
npx tsx examples/transparent-video.ts
npx tsx examples/streaming.ts
npx tsx examples/hardware-encoding.ts
npx tsx examples/hardware-decoding.ts
```

## Examples

### video-encoding.ts

Basic video encoding with H.264. Demonstrates:
- Creating a VideoEncoder
- Configuring codec, bitrate, and framerate
- Encoding VideoFrames from raw RGBA data
- Handling keyframes

### video-decoding.ts

Video decoding back to raw frames. Demonstrates:
- Encoding frames to get sample chunks
- Creating a VideoDecoder
- Decoding EncodedVideoChunks back to VideoFrames

### audio-encoding.ts

Audio encoding with Opus. Demonstrates:
- Creating an AudioEncoder
- Configuring sample rate, channels, and bitrate
- Encoding AudioData from float32 samples
- Generating sine wave test audio

### image-decoding.ts

Image decoding including animated formats. Demonstrates:
- Checking format support with isTypeSupported
- Decoding PNG, JPEG, GIF, WebP images
- Accessing frame timing for animated images
- Using ImageTrackList for animation info

### transparent-video.ts

VP9 encoding with alpha channel. Demonstrates:
- Configuring `alpha: 'keep'` for transparency
- Creating frames with varying alpha values
- Comparing file sizes with/without alpha

### streaming.ts

Real-time vs quality encoding comparison. Demonstrates:
- Using `latencyMode: 'realtime'` for streaming
- Using `latencyMode: 'quality'` for best compression
- Measuring encode time and output size differences

### hardware-encoding.ts

GPU-accelerated encoding. Demonstrates:
- Detecting available hardware acceleration (VAAPI, NVENC, QSV)
- Using `hardwareAcceleration: 'prefer-hardware'`
- Benchmarking hardware vs software encoding
- Getting the best encoder for a codec

### hardware-decoding.ts

GPU-accelerated decoding. Demonstrates:
- Detecting available hardware decoders (VAAPI, NVDEC, QSV)
- Using `hardwareAcceleration: 'prefer-hardware'` for decoding
- Benchmarking hardware vs software decoding
- Real-time decoding capability analysis

## Additional Demos

The `demos/` folder contains more complete demos that can be run via npm scripts:

```bash
npm run demo:webcodecs      # Basic WebCodecs demo
npm run demo:image          # Image decoding demo
npm run demo:streaming      # Streaming comparison
npm run demo:conversion     # File conversion with Mediabunny
npm run demo:hwaccel        # Hardware acceleration detection
```

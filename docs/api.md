# API Reference

This document provides detailed API documentation for webcodecs-node.

## Table of Contents

- [VideoEncoder](#videoencoder)
- [VideoDecoder](#videodecoder)
- [AudioEncoder](#audioencoder)
- [AudioDecoder](#audiodecoder)
- [ImageDecoder](#imagedecoder)
- [ImageEncoder](#imageencoder)
- [VideoFrame](#videoframe)
- [VideoColorSpace](#videocolorspace)
- [AudioData](#audiodata)
- [EncodedVideoChunk](#encodedvideochunk)
- [EncodedAudioChunk](#encodedaudiochunk)
- [MediaCapabilities](#mediacapabilities)

---

## VideoEncoder

Encodes raw video frames into compressed video chunks.

### Constructor

```typescript
new VideoEncoder(init: VideoEncoderInit)
```

**VideoEncoderInit:**
- `output: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void` - Called for each encoded chunk
- `error: (error: Error) => void` - Called on encoding errors

### Static Methods

#### `isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>`

Check if a configuration is supported before encoding.

```typescript
const support = await VideoEncoder.isConfigSupported({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
});
console.log(support.supported); // true or false
```

### Instance Methods

#### `configure(config: VideoEncoderConfig): void`

Configure the encoder. Must be called before encoding.

**VideoEncoderConfig:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `codec` | string | Yes | Codec string (e.g., 'avc1.42001E', 'vp9', 'av1') |
| `width` | number | Yes | Frame width in pixels |
| `height` | number | Yes | Frame height in pixels |
| `displayWidth` | number | No | Display width (for non-square pixels) |
| `displayHeight` | number | No | Display height (for non-square pixels) |
| `bitrate` | number | No | Target bitrate in bits/second |
| `framerate` | number | No | Target framerate |
| `bitrateMode` | 'constant' \| 'variable' \| 'quantizer' | No | Bitrate control mode |
| `alpha` | 'discard' \| 'keep' | No | Alpha channel handling |
| `latencyMode` | 'quality' \| 'realtime' | No | Latency vs quality tradeoff |
| `hardwareAcceleration` | 'no-preference' \| 'prefer-hardware' \| 'prefer-software' | No | Hardware acceleration preference |
| `scalabilityMode` | string | No | SVC scalability mode (e.g., 'L1T2') |
| `format` | 'mp4' \| 'annexb' | No | Output format: 'mp4' (default) for length-prefixed, 'annexb' for raw bitstreams |
| `maxQueueSize` | number | No | Max pending frames before QuotaExceededError. Auto-calculated from resolution if not set (~300MB target memory). |

#### `encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void`

Encode a video frame.

**VideoEncoderEncodeOptions:**
- `keyFrame?: boolean` - Force this frame to be a keyframe

#### `flush(): Promise<void>`

Flush all pending frames and wait for output.

#### `reset(): void`

Reset encoder to unconfigured state.

#### `close(): void`

Close the encoder and release resources.

### Properties

- `state: 'unconfigured' | 'configured' | 'closed'` - Current encoder state
- `encodeQueueSize: number` - Number of frames pending encoding

---

## VideoDecoder

Decodes compressed video chunks into raw video frames.

### Constructor

```typescript
new VideoDecoder(init: VideoDecoderInit)
```

**VideoDecoderInit:**
- `output: (frame: VideoFrame) => void` - Called for each decoded frame
- `error: (error: Error) => void` - Called on decoding errors

### Static Methods

#### `isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport>`

Check if a configuration is supported.

### Instance Methods

#### `configure(config: VideoDecoderConfig): void`

**VideoDecoderConfig:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `codec` | string | Yes | Codec string |
| `codedWidth` | number | No | Coded frame width |
| `codedHeight` | number | No | Coded frame height |
| `displayAspectWidth` | number | No | Display aspect ratio width |
| `displayAspectHeight` | number | No | Display aspect ratio height |
| `description` | BufferSource | No | Codec-specific data (e.g., SPS/PPS for H.264) |
| `colorSpace` | VideoColorSpaceInit | No | Color space configuration |
| `hardwareAcceleration` | 'no-preference' \| 'prefer-hardware' \| 'prefer-software' | No | Hardware acceleration preference |
| `optimizeForLatency` | boolean | No | Optimize for low latency decoding |
| `outputFormat` | VideoPixelFormat | No | Preferred output pixel format |
| `maxQueueSize` | number | No | Max pending chunks before QuotaExceededError. Auto-calculated from resolution if dimensions provided (~300MB target memory). |

#### `decode(chunk: EncodedVideoChunk): void`

Decode an encoded video chunk.

#### `flush(): Promise<void>`

Flush all pending chunks.

#### `reset(): void`

Reset decoder to unconfigured state.

#### `close(): void`

Close the decoder.

### Properties

- `state: 'unconfigured' | 'configured' | 'closed'`
- `decodeQueueSize: number`

---

## AudioEncoder

Encodes raw audio data into compressed audio chunks.

### Constructor

```typescript
new AudioEncoder(init: AudioEncoderInit)
```

### Static Methods

#### `isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>`

### Instance Methods

#### `configure(config: AudioEncoderConfig): void`

**AudioEncoderConfig:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `codec` | string | Yes | Codec string (e.g., 'opus', 'mp4a.40.2') |
| `sampleRate` | number | Yes | Sample rate in Hz |
| `numberOfChannels` | number | Yes | Number of audio channels |
| `bitrate` | number | No | Target bitrate in bits/second |
| `bitrateMode` | 'constant' \| 'variable' | No | Bitrate control mode |
| `latencyMode` | 'quality' \| 'realtime' | No | Latency vs quality tradeoff |
| `format` | 'adts' \| 'aac' | No | Output format: 'adts' (default) for ADTS headers, 'aac' for raw AAC frames |

#### `encode(data: AudioData): void`

Encode audio data.

#### `flush(): Promise<void>`

#### `reset(): void`

#### `close(): void`

---

## AudioDecoder

Decodes compressed audio chunks into raw audio data.

### Constructor

```typescript
new AudioDecoder(init: AudioDecoderInit)
```

### Instance Methods

#### `configure(config: AudioDecoderConfig): void`

**AudioDecoderConfig:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `codec` | string | Yes | Codec string |
| `sampleRate` | number | Yes | Sample rate in Hz |
| `numberOfChannels` | number | Yes | Number of channels |
| `description` | BufferSource | No | Codec-specific data |
| `outputFormat` | AudioSampleFormat | No | Preferred output sample format (default: 'f32') |

#### `decode(chunk: EncodedAudioChunk): void`

#### `flush(): Promise<void>`

#### `reset(): void`

#### `close(): void`

---

## ImageDecoder

Decodes images (including animated) into VideoFrames.

### Constructor

```typescript
new ImageDecoder(init: ImageDecoderInit)
```

**ImageDecoderInit:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | string | Yes | MIME type (e.g., 'image/png') |
| `data` | BufferSource \| ReadableStream | Yes | Image data |
| `transfer` | ArrayBuffer[] | No | Buffers to transfer ownership |
| `colorSpaceConversion` | 'none' \| 'default' | No | Color space handling |
| `desiredWidth` | number | No | Target width |
| `desiredHeight` | number | No | Target height |
| `preferAnimation` | boolean | No | Prefer animated track |
| `premultiplyAlpha` | 'none' \| 'premultiply' \| 'default' | No | Alpha handling |

### Static Methods

#### `isTypeSupported(type: string): Promise<boolean>`

Check if a MIME type is supported.

```typescript
const supported = await ImageDecoder.isTypeSupported('image/webp');
```

### Instance Methods

#### `decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult>`

Decode a frame from the image.

**ImageDecodeOptions:**
- `frameIndex?: number` - Frame index to decode (for animated images)
- `completeFramesOnly?: boolean` - Only return complete frames

**ImageDecodeResult:**
- `image: VideoFrame` - The decoded frame
- `complete: boolean` - Whether decoding is complete

#### `close(): void`

Close the decoder.

### Properties

- `type: string` - MIME type
- `complete: boolean` - Whether all data is buffered
- `completed: Promise<void>` - Resolves when ready to decode
- `tracks: ImageTrackList` - Track information

### ImageTrackList

- `ready: Promise<void>` - Resolves when tracks are parsed
- `length: number` - Number of tracks
- `selectedIndex: number` - Currently selected track
- `selectedTrack: ImageTrack | null` - Selected track object

### ImageTrack

- `animated: boolean` - Whether track is animated
- `frameCount: number` - Number of frames
- `repetitionCount: number` - Loop count (Infinity = forever)
- `selected: boolean` - Whether track is selected

---

## ImageEncoder

Encodes VideoFrames to image formats (PNG, JPEG, WebP). This is a utility class (not part of WebCodecs spec) that mirrors ImageDecoder.

### Static Methods

#### `isTypeSupported(type: string): boolean`

Check if an output format is supported.

```typescript
ImageEncoder.isTypeSupported('image/webp'); // true
ImageEncoder.isTypeSupported('image/gif');  // false
```

#### `encode(frame: VideoFrame, options?: ImageEncoderOptions): Promise<ImageEncoderResult>`

Encode a VideoFrame to an image format asynchronously.

```typescript
const result = await ImageEncoder.encode(frame, {
  type: 'image/jpeg',
  quality: 0.85,
});
fs.writeFileSync('output.jpg', Buffer.from(result.data));
```

#### `encodeSync(frame: VideoFrame, options?: ImageEncoderOptions): ImageEncoderResult`

Encode a VideoFrame synchronously.

```typescript
const result = ImageEncoder.encodeSync(frame, { type: 'image/png' });
```

#### `encodeBatch(frames: VideoFrame[], options?: ImageEncoderOptions): Promise<ImageEncoderResult[]>`

Encode multiple frames in parallel.

```typescript
const results = await ImageEncoder.encodeBatch(frames, { type: 'image/webp' });
```

### Types

**ImageEncoderOptions:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `'image/png' \| 'image/jpeg' \| 'image/webp'` | `'image/png'` | Output format |
| `quality` | number | 0.92 (JPEG), 0.8 (WebP) | Quality for lossy formats (0-1) |

**ImageEncoderResult:**
- `data: ArrayBuffer` - Encoded image data
- `type: string` - MIME type of the encoded image

---

## VideoFrame

Represents a single video frame with raw pixel data.

### Constructor

```typescript
new VideoFrame(data: BufferSource, init: VideoFrameBufferInit)
```

**VideoFrameBufferInit:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `format` | VideoPixelFormat | Yes | Pixel format |
| `codedWidth` | number | Yes | Frame width |
| `codedHeight` | number | Yes | Frame height |
| `timestamp` | number | Yes | Timestamp in microseconds |
| `duration` | number | No | Duration in microseconds |
| `displayWidth` | number | No | Display width |
| `displayHeight` | number | No | Display height |

**Supported VideoPixelFormat values:**

*8-bit formats:*
- `'I420'` - YUV 4:2:0 planar
- `'I420A'` - YUV 4:2:0 planar with alpha
- `'I422'` - YUV 4:2:2 planar
- `'I444'` - YUV 4:4:4 planar
- `'NV12'` - YUV 4:2:0 semi-planar
- `'RGBA'` - 8-bit RGBA
- `'RGBX'` - 8-bit RGB (alpha ignored)
- `'BGRA'` - 8-bit BGRA
- `'BGRX'` - 8-bit BGR (alpha ignored)

*10-bit formats (HDR):*
- `'I420P10'` - YUV 4:2:0 planar, 10-bit (16-bit container)
- `'I422P10'` - YUV 4:2:2 planar, 10-bit (16-bit container)
- `'I444P10'` - YUV 4:4:4 planar, 10-bit (16-bit container)
- `'P010'` - YUV 4:2:0 semi-planar, 10-bit (16-bit container)

### Instance Methods

#### `allocationSize(options?: VideoFrameCopyToOptions): number`

Get buffer size needed for copyTo.

#### `metadata(): VideoFrameMetadata`

Returns metadata associated with this VideoFrame. Currently returns an empty object as metadata fields (like `rtpTimestamp` for WebRTC) will be added as needed per W3C spec.

#### `copyTo(destination: BufferSource, options?: VideoFrameCopyToOptions): Promise<PlaneLayout[]>`

Copy frame data to a buffer.

#### `clone(): VideoFrame`

Create a copy of the frame.

#### `close(): void`

Release frame resources. Always call this when done.

### Properties

- `format: VideoPixelFormat | null`
- `codedWidth: number`
- `codedHeight: number`
- `displayWidth: number`
- `displayHeight: number`
- `timestamp: number`
- `duration: number | null`
- `colorSpace: VideoColorSpace` - Color space information

---

## VideoColorSpace

Describes the color space of a video frame, including HDR metadata.

### Constructor

```typescript
new VideoColorSpace(init?: VideoColorSpaceInit)
```

**VideoColorSpaceInit:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `primaries` | string | null | Color primaries ('bt709', 'bt2020', 'smpte432') |
| `transfer` | string | null | Transfer function ('bt709', 'pq', 'hlg', 'srgb') |
| `matrix` | string | null | Matrix coefficients ('bt709', 'bt2020-ncl') |
| `fullRange` | boolean | null | Full vs limited range |
| `hdrMetadata` | HdrMetadata | null | HDR mastering metadata |

### Properties

- `primaries: string | null` - Color primaries
- `transfer: string | null` - Transfer function
- `matrix: string | null` - Matrix coefficients
- `fullRange: boolean | null` - Full range flag
- `hdrMetadata: HdrMetadata | null` - HDR metadata (if present)
- `isHdr: boolean` - True if PQ or HLG transfer
- `hasHdrMetadata: boolean` - True if HDR metadata is set

### Instance Methods

#### `toJSON(): VideoColorSpaceInit`

Serialize to JSON-compatible object.

### HDR Metadata Types

**HdrMetadata:**
```typescript
interface HdrMetadata {
  smpteSt2086?: SmpteSt2086Metadata;   // Mastering display metadata
  contentLightLevel?: ContentLightLevelInfo;  // Content light levels
}
```

**SmpteSt2086Metadata (Mastering Display):**
| Property | Type | Description |
|----------|------|-------------|
| `primaryRChromaticityX/Y` | number | Red primary chromaticity |
| `primaryGChromaticityX/Y` | number | Green primary chromaticity |
| `primaryBChromaticityX/Y` | number | Blue primary chromaticity |
| `whitePointChromaticityX/Y` | number | White point chromaticity |
| `maxLuminance` | number | Maximum luminance (nits) |
| `minLuminance` | number | Minimum luminance (nits) |

**ContentLightLevelInfo:**
| Property | Type | Description |
|----------|------|-------------|
| `maxCLL` | number | Maximum Content Light Level (nits) |
| `maxFALL` | number | Maximum Frame Average Light Level (nits) |

### Helper Functions

#### `createHdr10MasteringMetadata(maxLuminance, minLuminance?): SmpteSt2086Metadata`

Create HDR10 mastering metadata with BT.2020 primaries.

```typescript
const metadata = createHdr10MasteringMetadata(1000, 0.0001);
```

#### `createContentLightLevel(maxCLL, maxFALL): ContentLightLevelInfo`

Create content light level info.

```typescript
const cll = createContentLightLevel(800, 400);
```

#### `HDR10_DISPLAY_PRIMARIES`

Constant with standard BT.2020 display primaries.

---

## AudioData

Represents raw audio samples.

### Constructor

```typescript
new AudioData(init: AudioDataInit)
```

**AudioDataInit:**
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `format` | AudioSampleFormat | Yes | Sample format |
| `sampleRate` | number | Yes | Sample rate in Hz |
| `numberOfChannels` | number | Yes | Channel count |
| `numberOfFrames` | number | Yes | Number of audio frames |
| `timestamp` | number | Yes | Timestamp in microseconds |
| `data` | BufferSource | Yes | Sample data |

**Supported AudioSampleFormat values:**
- `'u8'` - Unsigned 8-bit
- `'s16'` - Signed 16-bit
- `'s32'` - Signed 32-bit
- `'f32'` - 32-bit float
- `'u8-planar'` - Unsigned 8-bit planar
- `'s16-planar'` - Signed 16-bit planar
- `'s32-planar'` - Signed 32-bit planar
- `'f32-planar'` - 32-bit float planar

### Instance Methods

#### `allocationSize(options: AudioDataCopyToOptions): number`

#### `copyTo(destination: BufferSource, options: AudioDataCopyToOptions): void`

#### `clone(): AudioData`

#### `close(): void`

### Properties

- `format: AudioSampleFormat | null`
- `sampleRate: number`
- `numberOfChannels: number`
- `numberOfFrames: number`
- `duration: number`
- `timestamp: number`

---

## EncodedVideoChunk

Represents a compressed video frame.

### Constructor

```typescript
new EncodedVideoChunk(init: EncodedVideoChunkInit)
```

**EncodedVideoChunkInit:**
- `type: 'key' | 'delta'` - Frame type
- `timestamp: number` - Timestamp in microseconds
- `duration?: number` - Duration in microseconds
- `data: BufferSource` - Encoded data

### Instance Methods

#### `copyTo(destination: BufferSource): void`

Copy chunk data to a buffer.

### Properties

- `type: 'key' | 'delta'`
- `timestamp: number`
- `duration: number | null`
- `byteLength: number`

---

## EncodedAudioChunk

Represents compressed audio data.

### Constructor

```typescript
new EncodedAudioChunk(init: EncodedAudioChunkInit)
```

### Properties

- `type: 'key' | 'delta'`
- `timestamp: number`
- `duration: number | null`
- `byteLength: number`

---

## MediaCapabilities

Query codec support and performance characteristics.

### Methods

#### `decodingInfo(config: MediaDecodingConfiguration): Promise<MediaCapabilitiesDecodingInfo>`

```typescript
const info = await mediaCapabilities.decodingInfo({
  type: 'file',
  video: {
    contentType: 'video/mp4; codecs="avc1.42E01E"',
    width: 1920,
    height: 1080,
    bitrate: 5_000_000,
    framerate: 30,
  },
});
```

#### `encodingInfo(config: MediaEncodingConfiguration): Promise<MediaCapabilitiesEncodingInfo>`

```typescript
const info = await mediaCapabilities.encodingInfo({
  type: 'record',
  video: {
    contentType: 'video/webm; codecs="vp9"',
    width: 1280,
    height: 720,
    bitrate: 2_000_000,
    framerate: 30,
  },
});
```

### Result Properties

- `supported: boolean` - Configuration is supported
- `smooth: boolean` - Smooth playback/encoding expected
- `powerEfficient: boolean` - Hardware acceleration available

### Capability Profiles

You can generate a hardware-specific capability profile to make `mediaCapabilities` match your actual system capabilities. Use the provided CLI:

```bash
npm run capabilities:generate -- ./webcodecs-capabilities.json
export WEBCODECS_CAPABILITIES_PROFILE=$(pwd)/webcodecs-capabilities.json
```

The JSON follows the `CapabilityProfile` schema (see `src/capabilities/types.ts`). If no profile is provided, `mediaCapabilities` falls back to built-in heuristics based on resolution, bitrate, and detected hardware acceleration.

---

## Known Limitations

### Encoder Frame Batching

When using `latencyMode: 'quality'` (the default), FFmpeg encoders may buffer frames for better compression. This means:

- Multiple `encode()` calls may produce fewer output chunks than input frames
- All frames are output after `flush()`, but may be batched

**Workaround:** Use `latencyMode: 'realtime'` for 1:1 frame-to-chunk output:

```typescript
encoder.configure({
  codec: 'vp8',
  width: 640,
  height: 480,
  latencyMode: 'realtime', // Disables frame buffering
});
```

### Codec String Validation

The `isConfigSupported()` method performs strict codec string validation per the WebCodecs specification:

- **Case-sensitive:** `vP8` or `VP8` returns `supported: false` (use `vp8`)
- **Fully qualified VP9/AV1:** Ambiguous `vp9` returns `supported: false` (use `vp09.00.10.08`)
- **Valid parameters:** Unknown profiles/levels return `supported: false`

Note: `configure()` is more lenient and accepts simple codec strings like `vp9` for FFmpeg compatibility.

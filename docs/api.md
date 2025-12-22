# API Reference

This document provides detailed API documentation for webcodecs-node.

## Table of Contents

- [VideoEncoder](#videoencoder)
- [VideoDecoder](#videodecoder)
- [AudioEncoder](#audioencoder)
- [AudioDecoder](#audiodecoder)
- [ImageDecoder](#imagedecoder)
- [VideoFrame](#videoframe)
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
| `codec` | string | Yes | Codec string (e.g., 'avc1.42001E', 'vp9') |
| `width` | number | Yes | Frame width in pixels |
| `height` | number | Yes | Frame height in pixels |
| `bitrate` | number | No | Target bitrate in bits/second |
| `framerate` | number | No | Target framerate |
| `bitrateMode` | 'constant' \| 'variable' \| 'quantizer' | No | Bitrate control mode |
| `alpha` | 'discard' \| 'keep' | No | Alpha channel handling |
| `latencyMode` | 'quality' \| 'realtime' | No | Latency vs quality tradeoff |
| `hardwareAcceleration` | 'no-preference' \| 'prefer-hardware' \| 'prefer-software' | No | Hardware acceleration preference |

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
| `description` | BufferSource | No | Codec-specific data (e.g., SPS/PPS for H.264) |

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
| `bitrate` | number | No | Target bitrate |

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
- `'I420'` - YUV 4:2:0 planar
- `'I420A'` - YUV 4:2:0 planar with alpha
- `'I422'` - YUV 4:2:2 planar
- `'I444'` - YUV 4:4:4 planar
- `'NV12'` - YUV 4:2:0 semi-planar
- `'RGBA'` - 8-bit RGBA
- `'RGBX'` - 8-bit RGB (alpha ignored)
- `'BGRA'` - 8-bit BGRA
- `'BGRX'` - 8-bit BGR (alpha ignored)

### Instance Methods

#### `allocationSize(options?: VideoFrameCopyToOptions): number`

Get buffer size needed for copyTo.

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

You can generate a hardware-specific capability profile to make `mediaCapabilities` match your actual FFmpeg install. Use the provided CLI:

```bash
npm run capabilities:generate -- ./webcodecs-capabilities.json
export WEBCODECS_CAPABILITIES_PROFILE=$(pwd)/webcodecs-capabilities.json
```

The JSON follows the `CapabilityProfile` schema (see `src/capabilities/types.ts`). If no profile is provided, `mediaCapabilities` falls back to built-in heuristics based on resolution, bitrate, and detected hardware acceleration.

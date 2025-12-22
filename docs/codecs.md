# Codec Support

This document details all codecs supported by webcodecs-node.

## Video Codecs

### H.264/AVC

**Codec strings:** `avc1.*`, `avc3.*`

The most widely supported video codec. Excellent for compatibility.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Hardware acceleration | VAAPI, NVENC, QSV |
| Alpha channel | No |
| Profiles | Baseline, Main, High |

**Common codec strings:**
- `avc1.42001E` - Baseline Profile, Level 3.0
- `avc1.4D401E` - Main Profile, Level 3.0
- `avc1.64001F` - High Profile, Level 3.1
- `avc1.640028` - High Profile, Level 4.0

**Example:**
```typescript
encoder.configure({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
});
```

### H.265/HEVC

**Codec strings:** `hev1.*`, `hvc1.*`

Better compression than H.264 at the same quality. Good for 4K content.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Hardware acceleration | VAAPI, NVENC, QSV |
| Alpha channel | No |
| Profiles | Main, Main10 |

**Common codec strings:**
- `hev1.1.6.L93.B0` - Main Profile
- `hvc1.1.6.L120.90` - Main Profile, Level 4.0

**Example:**
```typescript
encoder.configure({
  codec: 'hev1.1.6.L93.B0',
  width: 3840,
  height: 2160,
  bitrate: 15_000_000,
});
```

### VP8

**Codec string:** `vp8`

Open, royalty-free codec. Good compatibility in WebM containers.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Hardware acceleration | Limited |
| Alpha channel | No |

**Example:**
```typescript
encoder.configure({
  codec: 'vp8',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
});
```

### VP9

**Codec strings:** `vp9`, `vp09.*`

Successor to VP8 with better compression. Supports alpha channel.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Hardware acceleration | VAAPI, NVDEC |
| Alpha channel | **Yes** |
| Profiles | 0, 2 |

**Common codec strings:**
- `vp9` - Profile 0 (8-bit)
- `vp09.00.10.08` - Profile 0, Level 1.0, 8-bit

**Example with alpha:**
```typescript
encoder.configure({
  codec: 'vp9',
  width: 1920,
  height: 1080,
  alpha: 'keep', // Preserve transparency
});
```

### AV1

**Codec strings:** `av01.*`, `av1`

Latest generation codec with best compression efficiency.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Hardware acceleration | Limited (newer GPUs) |
| Alpha channel | **Yes** |
| Profiles | Main, High |

**Common codec strings:**
- `av01.0.04M.08` - Main Profile, Level 3.0, 8-bit
- `av01.0.08M.10` - Main Profile, Level 4.0, 10-bit

**Example:**
```typescript
encoder.configure({
  codec: 'av01.0.04M.08',
  width: 1920,
  height: 1080,
  bitrate: 3_000_000,
});
```

## Audio Codecs

### Opus

**Codec string:** `opus`

Modern, versatile codec. Excellent for voice and music.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Sample rates | 8000-48000 Hz |
| Channels | 1-2 |
| Bitrate range | 6-510 kbps |

**Example:**
```typescript
encoder.configure({
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128000,
});
```

### AAC

**Codec strings:** `mp4a.40.2` (AAC-LC), `mp4a.40.5` (HE-AAC)

Industry standard for streaming and broadcasting.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Sample rates | 8000-96000 Hz |
| Channels | 1-8 |
| Profiles | LC, HE, HEv2 |

**Example:**
```typescript
encoder.configure({
  codec: 'mp4a.40.2',
  sampleRate: 44100,
  numberOfChannels: 2,
  bitrate: 192000,
});
```

### MP3

**Codec string:** `mp3`

Legacy codec with universal support.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Sample rates | 8000-48000 Hz |
| Channels | 1-2 |
| Bitrate range | 32-320 kbps |

**Example:**
```typescript
encoder.configure({
  codec: 'mp3',
  sampleRate: 44100,
  numberOfChannels: 2,
  bitrate: 192000,
});
```

### FLAC

**Codec string:** `flac`

Lossless audio codec.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Sample rates | Up to 655350 Hz |
| Channels | 1-8 |
| Bit depths | 8, 16, 24, 32 |

**Example:**
```typescript
encoder.configure({
  codec: 'flac',
  sampleRate: 96000,
  numberOfChannels: 2,
});
```

### Vorbis

**Codec string:** `vorbis`

Open source codec commonly used in WebM/OGG containers.

| Feature | Support |
|---------|---------|
| Encoding | Yes |
| Decoding | Yes |
| Sample rates | 8000-192000 Hz |
| Channels | 1-8 |

**Example:**
```typescript
encoder.configure({
  codec: 'vorbis',
  sampleRate: 44100,
  numberOfChannels: 2,
  bitrate: 128000,
});
```

## Image Formats

### Supported MIME Types

| Format | MIME Type | Animated | Alpha |
|--------|-----------|----------|-------|
| PNG | `image/png` | No | Yes |
| APNG | `image/apng` | Yes | Yes |
| JPEG | `image/jpeg` | No | No |
| WebP | `image/webp` | Yes | Yes |
| GIF | `image/gif` | Yes | Yes (1-bit) |
| AVIF | `image/avif` | Yes | Yes |
| BMP | `image/bmp` | No | Limited |
| TIFF | `image/tiff` | No | Yes |

### Animated Image Features

For animated formats (GIF, APNG, WebP, AVIF):

- **Frame timing**: Each frame has `timestamp` and `duration` in microseconds
- **Loop count**: Available via `track.repetitionCount` (`Infinity` = loop forever)
- **Frame count**: Available via `track.frameCount`

```typescript
const decoder = new ImageDecoder({
  type: 'image/gif',
  data: gifData,
});

await decoder.completed;
const track = decoder.tracks.selectedTrack;

console.log(`Frames: ${track.frameCount}`);
console.log(`Loops: ${track.repetitionCount}`);
console.log(`Animated: ${track.animated}`);

for (let i = 0; i < track.frameCount; i++) {
  const { image } = await decoder.decode({ frameIndex: i });
  console.log(`Frame ${i}: duration=${image.duration / 1000}ms`);
  image.close();
}
```

## Container Compatibility

### Video Containers

| Container | Video Codecs | Audio Codecs |
|-----------|--------------|--------------|
| MP4 (`.mp4`) | H.264, HEVC, AV1 | AAC |
| WebM (`.webm`) | VP8, VP9, AV1 | Opus, Vorbis |
| MKV (`.mkv`) | All video codecs | All audio codecs |

### Audio Containers

| Container | Audio Codecs |
|-----------|--------------|
| MP4 (`.m4a`) | AAC |
| WebM (`.weba`) | Opus, Vorbis |
| OGG (`.ogg`) | Opus, Vorbis, FLAC |
| MP3 (`.mp3`) | MP3 |
| FLAC (`.flac`) | FLAC |

## Checking Codec Support

### VideoEncoder/VideoDecoder

```typescript
const support = await VideoEncoder.isConfigSupported({
  codec: 'avc1.42001E',
  width: 1920,
  height: 1080,
});

if (support.supported) {
  console.log('H.264 encoding supported');
}
```

### AudioEncoder/AudioDecoder

```typescript
const support = await AudioEncoder.isConfigSupported({
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 2,
});

if (support.supported) {
  console.log('Opus encoding supported');
}
```

### ImageDecoder

```typescript
const supported = await ImageDecoder.isTypeSupported('image/avif');
if (supported) {
  console.log('AVIF decoding supported');
}
```

### MediaCapabilities

```typescript
const info = await mediaCapabilities.encodingInfo({
  type: 'record',
  video: {
    contentType: 'video/mp4; codecs="avc1.42E01E"',
    width: 1920,
    height: 1080,
    bitrate: 5_000_000,
    framerate: 30,
  },
});

console.log('Supported:', info.supported);
console.log('Hardware accelerated:', info.powerEfficient);
```

/**
 * Demo: Mediabunny + FFmpeg Backend
 *
 * Shows how to use Mediabunny with FFmpeg for video encoding/decoding in Node.js.
 */

import { registerFFmpegCoders } from '../mediabunny/index.js';

// Register FFmpeg coders before using Mediabunny
registerFFmpegCoders();

// Mediabunny is now ready to use with FFmpeg backend

async function main() {
  console.log('Mediabunny + FFmpeg Demo');
  console.log('========================\n');

  // Test basic functionality
  console.log('FFmpeg coders registered successfully!');
  console.log('');
  console.log('Mediabunny will now use FFmpeg for:');
  console.log('');
  console.log('  Video codecs:');
  console.log('    - AVC (H.264) encoding/decoding');
  console.log('    - HEVC (H.265) encoding/decoding');
  console.log('    - VP8 encoding/decoding');
  console.log('    - VP9 encoding/decoding');
  console.log('    - AV1 encoding/decoding');
  console.log('');
  console.log('  Audio codecs:');
  console.log('    - AAC encoding/decoding');
  console.log('    - Opus encoding/decoding');
  console.log('    - MP3 encoding/decoding');
  console.log('    - FLAC encoding/decoding');
  console.log('    - Vorbis encoding/decoding');
  console.log('    - PCM (all variants) encoding/decoding');
  console.log('');

  // Example: Create a simple video conversion workflow
  // This demonstrates the architecture - actual file I/O would use Mediabunny's
  // demuxers and muxers

  console.log('Architecture:');
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────┐');
  console.log('  │                    Mediabunny                       │');
  console.log('  │  ┌─────────────┐              ┌─────────────┐       │');
  console.log('  │  │  Demuxer    │              │   Muxer     │       │');
  console.log('  │  │ (MP4/WebM)  │              │ (MP4/WebM)  │       │');
  console.log('  │  └──────┬──────┘              └──────▲──────┘       │');
  console.log('  │         │                           │              │');
  console.log('  │         ▼                           │              │');
  console.log('  │  ┌─────────────┐              ┌─────────────┐       │');
  console.log('  │  │  FFmpeg     │              │   FFmpeg    │       │');
  console.log('  │  │  Decoder    │─────────────▶│   Encoder   │       │');
  console.log('  │  │  (child)    │  VideoSample │   (child)   │       │');
  console.log('  │  └─────────────┘              └─────────────┘       │');
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log('');

  // Note: Full conversion example would require actual video files
  // Here's how it would look:

  console.log('Example usage:');
  console.log('');
  console.log(`
  import { registerFFmpegCoders } from 'webcodecs-node/mediabunny';
  import { MP4, WebM, convert } from 'mediabunny';

  // Register FFmpeg backend
  registerFFmpegCoders();

  // Convert MP4 to WebM
  const source = MP4.source(inputFile);
  const target = WebM.target(outputStream);

  await convert({
    source,
    target,
    video: { codec: 'vp9', bitrate: 2_000_000 },
    audio: { codec: 'opus', bitrate: 128_000 },
  });
  `);

  console.log('\nDemo complete!');
}

main().catch(console.error);

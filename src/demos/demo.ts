/**
 * Demo: WebCodecs API usage in Node.js
 *
 * This demo shows how to:
 * 1. Create VideoFrames from raw pixel data
 * 2. Encode frames to H.264
 * 3. Decode encoded chunks back to frames
 */

import {
  VideoFrame,
  VideoEncoder,
  VideoDecoder,
  EncodedVideoChunk,
} from '../index.js';

async function main() {
  console.log('WebCodecs Node.js Demo');
  console.log('======================\n');

  // Configuration
  const width = 320;
  const height = 240;
  const frameCount = 30;
  const framerate = 30;
  const codec = 'vp09'; // VP9 - uses IVF container with per-frame parsing

  // Check encoder support
  const encoderSupport = await VideoEncoder.isConfigSupported({
    codec,
    width,
    height,
    bitrate: 1_000_000,
    framerate,
  });
  console.log(`Encoder support for ${codec}: ${encoderSupport.supported}`);

  // Check decoder support
  const decoderSupport = await VideoDecoder.isConfigSupported({
    codec,
    codedWidth: width,
    codedHeight: height,
  });
  console.log(`Decoder support for ${codec}: ${decoderSupport.supported}\n`);

  // Storage for encoded chunks and decoded frames
  const encodedChunks: EncodedVideoChunk[] = [];
  const decodedFrames: VideoFrame[] = [];

  // Create encoder
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log(
        `Encoded chunk: type=${chunk.type}, timestamp=${chunk.timestamp}, bytes=${chunk.byteLength}`
      );
      if (metadata?.decoderConfig) {
        console.log(`  Decoder config: ${JSON.stringify(metadata.decoderConfig)}`);
      }
      encodedChunks.push(chunk);
    },
    error: (err) => {
      console.error('Encoder error:', err);
    },
  });

  // Configure encoder
  encoder.configure({
    codec,
    width,
    height,
    bitrate: 1_000_000,
    framerate,
  });

  console.log('Encoder state:', encoder.state);
  console.log(`\nEncoding ${frameCount} frames...`);

  // Generate and encode frames
  for (let i = 0; i < frameCount; i++) {
    // Create a simple gradient frame (RGBA)
    const frameData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Create a moving gradient pattern
        frameData[idx] = (x + i * 10) % 256;     // R
        frameData[idx + 1] = (y + i * 5) % 256;  // G
        frameData[idx + 2] = (i * 8) % 256;       // B
        frameData[idx + 3] = 255;                 // A
      }
    }

    const frame = new VideoFrame(frameData, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: (i * 1_000_000) / framerate, // microseconds
      duration: 1_000_000 / framerate,
    });

    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
  }

  // Flush encoder
  console.log('Flushing encoder...');
  await encoder.flush();
  console.log(`Encoded ${encodedChunks.length} chunks\n`);

  // Now decode the chunks
  console.log('Creating decoder...');
  const decoder = new VideoDecoder({
    output: (frame) => {
      console.log(
        `Decoded frame: ${frame.codedWidth}x${frame.codedHeight}, timestamp=${frame.timestamp}`
      );
      decodedFrames.push(frame);
    },
    error: (err) => {
      console.error('Decoder error:', err);
    },
  });

  // Configure decoder
  decoder.configure({
    codec,
    codedWidth: width,
    codedHeight: height,
  });

  console.log('Decoder state:', decoder.state);
  console.log(`\nDecoding ${encodedChunks.length} chunks...`);

  // Decode all chunks
  for (const chunk of encodedChunks) {
    decoder.decode(chunk);
  }

  // Flush decoder
  console.log('Flushing decoder...');
  await decoder.flush();

  console.log(`\nDecoded ${decodedFrames.length} frames`);

  // Cleanup
  encoder.close();
  decoder.close();
  decodedFrames.forEach((f) => f.close());

  console.log('\nDemo complete!');
}

main().catch(console.error);

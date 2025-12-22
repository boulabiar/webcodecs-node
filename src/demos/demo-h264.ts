/**
 * Demo: H.264 (AVC) encoding with WebCodecs API in Node.js
 *
 * This demo tests the H.264 Annex B parsing implementation.
 */

import {
  VideoFrame,
  VideoEncoder,
  VideoDecoder,
  EncodedVideoChunk,
} from '../index.js';

async function main() {
  console.log('H.264 WebCodecs Node.js Demo');
  console.log('============================\n');

  // Configuration
  const width = 320;
  const height = 240;
  const frameCount = 30;
  const framerate = 30;
  const codec = 'avc1.42001E'; // H.264 Baseline Profile Level 3.0

  // Check encoder support
  const encoderSupport = await VideoEncoder.isConfigSupported({
    codec,
    width,
    height,
    bitrate: 1_000_000,
    framerate,
  });
  console.log(`Encoder support for H.264: ${encoderSupport.supported}`);

  // Check decoder support
  const decoderSupport = await VideoDecoder.isConfigSupported({
    codec,
    codedWidth: width,
    codedHeight: height,
  });
  console.log(`Decoder support for H.264: ${decoderSupport.supported}\n`);

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
        console.log(`  Decoder config available`);
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

  // Verify we got the expected number of encoded frames
  if (encodedChunks.length !== frameCount) {
    console.warn(`WARNING: Expected ${frameCount} chunks, got ${encodedChunks.length}`);
  } else {
    console.log('SUCCESS: Got correct number of encoded chunks!');
  }

  // Now decode the chunks
  console.log('\nCreating decoder...');
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

  // Verify round-trip
  if (decodedFrames.length === frameCount) {
    console.log('SUCCESS: Round-trip test passed! Input frames = Output frames');
  } else {
    console.log(`MISMATCH: Input ${frameCount} frames, Output ${decodedFrames.length} frames`);
  }

  // Cleanup
  encoder.close();
  decoder.close();
  decodedFrames.forEach((f) => f.close());

  console.log('\nDemo complete!');
}

main().catch(console.error);

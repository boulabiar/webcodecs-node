/**
 * Demo: Audio encoding and decoding with WebCodecs API in Node.js
 *
 * This demo shows how to:
 * 1. Create AudioData from raw PCM samples
 * 2. Encode audio to AAC
 * 3. Decode encoded chunks back to AudioData
 */

import {
  AudioData,
  AudioEncoder,
  AudioDecoder,
  EncodedAudioChunk,
} from '../index.js';

async function main() {
  console.log('WebCodecs Audio Demo');
  console.log('====================\n');

  // Configuration
  const sampleRate = 44100;
  const numberOfChannels = 2;
  const duration = 1; // 1 second
  const numberOfFrames = sampleRate * duration;
  const codec = 'aac';

  // Check encoder support
  const encoderSupport = await AudioEncoder.isConfigSupported({
    codec,
    sampleRate,
    numberOfChannels,
    bitrate: 128000,
  });
  console.log(`Encoder support for ${codec}: ${encoderSupport.supported}`);

  // Check decoder support
  const decoderSupport = await AudioDecoder.isConfigSupported({
    codec,
    sampleRate,
    numberOfChannels,
  });
  console.log(`Decoder support for ${codec}: ${decoderSupport.supported}\n`);

  // Storage for encoded chunks and decoded data
  const encodedChunks: EncodedAudioChunk[] = [];
  const decodedSamples: AudioData[] = [];

  // Create encoder
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      console.log(
        `Encoded chunk: type=${chunk.type}, timestamp=${chunk.timestamp}, bytes=${chunk.byteLength}`
      );
      if (metadata?.decoderConfig) {
        console.log(`  Decoder config: ${metadata.decoderConfig.codec}`);
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
    sampleRate,
    numberOfChannels,
    bitrate: 128000,
  });

  console.log('Encoder state:', encoder.state);
  console.log(`\nGenerating ${duration} second of audio (${numberOfFrames} frames)...`);

  // Generate audio data (sine wave)
  const frequency = 440; // A4 note
  const audioBuffer = new Float32Array(numberOfFrames * numberOfChannels);

  for (let frame = 0; frame < numberOfFrames; frame++) {
    const t = frame / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.5;

    // Interleaved stereo
    audioBuffer[frame * 2] = sample;     // Left
    audioBuffer[frame * 2 + 1] = sample; // Right
  }

  // Create AudioData
  const audioData = new AudioData({
    format: 'f32',
    sampleRate,
    numberOfChannels,
    numberOfFrames,
    timestamp: 0,
    data: audioBuffer,
  });

  console.log(`Created AudioData: ${audioData.numberOfFrames} frames, ${audioData.duration}us duration`);

  // Encode
  console.log('\nEncoding...');
  encoder.encode(audioData);
  audioData.close();

  // Flush encoder
  console.log('Flushing encoder...');
  await encoder.flush();
  console.log(`Encoded ${encodedChunks.length} chunks\n`);

  // Now decode the chunks
  console.log('Creating decoder...');
  const decoder = new AudioDecoder({
    output: (data) => {
      console.log(
        `Decoded audio: ${data.numberOfFrames} frames, ${data.sampleRate}Hz, ${data.numberOfChannels}ch`
      );
      decodedSamples.push(data);
    },
    error: (err) => {
      console.error('Decoder error:', err);
    },
  });

  // Configure decoder
  decoder.configure({
    codec,
    sampleRate,
    numberOfChannels,
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

  // Calculate total decoded frames
  const totalDecodedFrames = decodedSamples.reduce(
    (sum, data) => sum + data.numberOfFrames,
    0
  );

  console.log(`\nDecoded ${decodedSamples.length} AudioData objects`);
  console.log(`Total decoded frames: ${totalDecodedFrames}`);

  // Compare input/output
  const inputDuration = (numberOfFrames / sampleRate) * 1000;
  const outputDuration = (totalDecodedFrames / sampleRate) * 1000;

  console.log(`\nInput duration: ${inputDuration.toFixed(2)}ms`);
  console.log(`Output duration: ${outputDuration.toFixed(2)}ms`);

  if (Math.abs(inputDuration - outputDuration) < 100) {
    console.log('\nSUCCESS: Audio round-trip completed!');
  } else {
    console.log('\nWARNING: Duration mismatch (may be due to codec padding)');
  }

  // Cleanup
  encoder.close();
  decoder.close();
  decodedSamples.forEach((d) => d.close());

  console.log('\nDemo complete!');
}

main().catch(console.error);

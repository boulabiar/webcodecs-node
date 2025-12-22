/**
 * Demo: Opus audio encoding and decoding with WebCodecs API
 */

import {
  AudioData,
  AudioEncoder,
  AudioDecoder,
  EncodedAudioChunk,
} from '../index.js';

async function main() {
  console.log('WebCodecs Opus Audio Demo');
  console.log('=========================\n');

  // Opus requires 48kHz
  const sampleRate = 48000;
  const numberOfChannels = 2;
  const duration = 1; // 1 second
  const numberOfFrames = sampleRate * duration;
  const codec = 'opus';

  // Check encoder support
  const encoderSupport = await AudioEncoder.isConfigSupported({
    codec,
    sampleRate,
    numberOfChannels,
    bitrate: 64000,
  });
  console.log(`Encoder support for ${codec}: ${encoderSupport.supported}`);

  // Check decoder support
  const decoderSupport = await AudioDecoder.isConfigSupported({
    codec,
    sampleRate,
    numberOfChannels,
  });
  console.log(`Decoder support for ${codec}: ${decoderSupport.supported}\n`);

  // Storage
  const encodedChunks: EncodedAudioChunk[] = [];
  const decodedSamples: AudioData[] = [];

  // Create encoder
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      console.log(
        `Encoded chunk: type=${chunk.type}, bytes=${chunk.byteLength}`
      );
      encodedChunks.push(chunk);
    },
    error: (err) => {
      console.error('Encoder error:', err);
    },
  });

  encoder.configure({
    codec,
    sampleRate,
    numberOfChannels,
    bitrate: 64000,
  });

  console.log(`Generating ${duration} second of audio...`);

  // Generate stereo sine wave
  const frequency = 440;
  const audioBuffer = new Float32Array(numberOfFrames * numberOfChannels);

  for (let frame = 0; frame < numberOfFrames; frame++) {
    const t = frame / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.5;
    audioBuffer[frame * 2] = sample;
    audioBuffer[frame * 2 + 1] = sample;
  }

  const audioData = new AudioData({
    format: 'f32',
    sampleRate,
    numberOfChannels,
    numberOfFrames,
    timestamp: 0,
    data: audioBuffer,
  });

  console.log(`Created AudioData: ${audioData.numberOfFrames} frames`);

  console.log('\nEncoding...');
  encoder.encode(audioData);
  audioData.close();

  await encoder.flush();
  console.log(`Encoded ${encodedChunks.length} chunks\n`);

  // Decode
  console.log('Decoding...');
  const decoder = new AudioDecoder({
    output: (data) => {
      decodedSamples.push(data);
    },
    error: (err) => {
      console.error('Decoder error:', err);
    },
  });

  decoder.configure({
    codec,
    sampleRate,
    numberOfChannels,
  });

  for (const chunk of encodedChunks) {
    decoder.decode(chunk);
  }

  await decoder.flush();

  const totalDecodedFrames = decodedSamples.reduce(
    (sum, data) => sum + data.numberOfFrames,
    0
  );

  console.log(`\nDecoded ${decodedSamples.length} AudioData objects`);
  console.log(`Total decoded frames: ${totalDecodedFrames}`);

  const inputDuration = (numberOfFrames / sampleRate) * 1000;
  const outputDuration = (totalDecodedFrames / sampleRate) * 1000;

  console.log(`\nInput: ${inputDuration.toFixed(2)}ms`);
  console.log(`Output: ${outputDuration.toFixed(2)}ms`);

  if (Math.abs(inputDuration - outputDuration) < 100) {
    console.log('\nSUCCESS: Opus audio round-trip completed!');
  }

  encoder.close();
  decoder.close();
  decodedSamples.forEach((d) => d.close());

  console.log('\nDemo complete!');
}

main().catch(console.error);

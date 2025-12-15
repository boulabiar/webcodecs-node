/**
 * Demo: Test WebCodecs implementation with real sample files
 *
 * Tests VideoDecoder and AudioDecoder with downloaded sample files:
 * - Video: H.264, VP8, VP9
 * - Audio: Opus, MP3, AAC
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { VideoDecoder, VideoDecoderConfig } from '../VideoDecoder.js';
import { AudioDecoder, AudioDecoderConfig } from '../AudioDecoder.js';
import { EncodedVideoChunk } from '../EncodedVideoChunk.js';
import { EncodedAudioChunk } from '../EncodedAudioChunk.js';
import { VideoFrame } from '../VideoFrame.js';
import { AudioData } from '../AudioData.js';

const SAMPLES_DIR = '/tmp/webcodecs-test-samples';

interface VideoSample {
  file: string;
  codec: string;
  width: number;
  height: number;
}

interface AudioSample {
  file: string;
  codec: string;
  sampleRate: number;
  channels: number;
}

const VIDEO_SAMPLES: VideoSample[] = [
  { file: 'bbb_h264_360p.mp4', codec: 'avc1.42001E', width: 640, height: 360 },
  { file: 'bbb_vp8_360p.webm', codec: 'vp8', width: 640, height: 360 },
  { file: 'bbb_vp9_360p.webm', codec: 'vp09.00.10.08', width: 640, height: 360 },
];

const AUDIO_SAMPLES: AudioSample[] = [
  { file: 'sample_opus.opus', codec: 'opus', sampleRate: 48000, channels: 1 },
  { file: 'sample_mp3.mp3', codec: 'mp3', sampleRate: 44100, channels: 1 },
  { file: 'sample_aac.aac', codec: 'mp4a.40.2', sampleRate: 44100, channels: 1 },
];

/**
 * Extract encoded video chunks from a file using FFmpeg
 */
async function extractVideoChunks(filePath: string, codec: string): Promise<{ chunks: Buffer[]; keyFrames: boolean[] }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const keyFrames: boolean[] = [];

    // Determine the output format based on codec
    let outputFormat: string;
    let codecName: string;

    const codecBase = codec.split('.')[0].toLowerCase();
    if (codecBase === 'avc1' || codecBase === 'avc3') {
      outputFormat = 'h264';
      codecName = 'h264';
    } else if (codecBase === 'vp8') {
      outputFormat = 'ivf';
      codecName = 'vp8';
    } else if (codecBase === 'vp9' || codecBase === 'vp09') {
      outputFormat = 'ivf';
      codecName = 'vp9';
    } else {
      reject(new Error(`Unsupported codec: ${codec}`));
      return;
    }

    // Use FFmpeg to extract raw encoded data
    const args = [
      '-i', filePath,
      '-c:v', 'copy',
      '-an',  // No audio
      '-f', outputFormat,
      'pipe:1'
    ];

    const ffmpeg = spawn('ffmpeg', args);
    const dataChunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (data: Buffer) => {
      dataChunks.push(data);
    });

    ffmpeg.stderr.on('data', () => {
      // Ignore stderr (progress info)
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}`));
        return;
      }

      const fullData = Buffer.concat(dataChunks);

      if (outputFormat === 'ivf') {
        // Parse IVF format
        parseIvfChunks(fullData, chunks, keyFrames, codecName);
      } else {
        // For H.264, split by NAL units (simplified)
        parseH264Chunks(fullData, chunks, keyFrames);
      }

      resolve({ chunks, keyFrames });
    });

    ffmpeg.on('error', reject);
  });
}

/**
 * Parse IVF format into individual frames
 */
function parseIvfChunks(data: Buffer, chunks: Buffer[], keyFrames: boolean[], codec: string): void {
  if (data.length < 32) return;

  // Skip 32-byte IVF header
  let offset = 32;

  while (offset + 12 <= data.length) {
    const frameSize = data.readUInt32LE(offset);
    // Skip 8-byte timestamp
    offset += 12;

    if (offset + frameSize > data.length) break;

    const frameData = data.slice(offset, offset + frameSize);
    chunks.push(frameData);

    // Detect keyframe based on codec
    let isKeyFrame = false;
    if (codec === 'vp8' && frameData.length > 0) {
      // VP8: bit 0 of first byte is 0 for keyframe
      isKeyFrame = (frameData[0] & 0x01) === 0;
    } else if (codec === 'vp9' && frameData.length > 0) {
      // VP9: frame marker and profile in first two bits
      // Simplified: check if it's a keyframe marker
      const marker = (frameData[0] >> 6) & 0x03;
      isKeyFrame = marker !== 3 && (frameData[0] & 0x04) === 0;
    }
    keyFrames.push(isKeyFrame);

    offset += frameSize;
  }
}

/**
 * Parse H.264 Annex B format into NAL units (access units)
 */
function parseH264Chunks(data: Buffer, chunks: Buffer[], keyFrames: boolean[]): void {
  let offset = 0;
  let currentAU: Buffer[] = [];
  let currentIsKey = false;

  const flushAU = () => {
    if (currentAU.length > 0) {
      chunks.push(Buffer.concat(currentAU));
      keyFrames.push(currentIsKey);
      currentAU = [];
      currentIsKey = false;
    }
  };

  while (offset < data.length - 4) {
    // Look for start code (0x00 0x00 0x00 0x01 or 0x00 0x00 0x01)
    let startCodeLen = 0;
    if (data[offset] === 0 && data[offset + 1] === 0) {
      if (data[offset + 2] === 0 && data[offset + 3] === 1) {
        startCodeLen = 4;
      } else if (data[offset + 2] === 1) {
        startCodeLen = 3;
      }
    }

    if (startCodeLen > 0) {
      // Found start code, get NAL unit type
      const nalType = data[offset + startCodeLen] & 0x1F;

      // NAL types: 5 = IDR (keyframe), 1 = non-IDR slice, 7 = SPS, 8 = PPS
      if (nalType === 5) {
        currentIsKey = true;
      }

      // Find next start code
      let nextOffset = offset + startCodeLen + 1;
      while (nextOffset < data.length - 3) {
        if (data[nextOffset] === 0 && data[nextOffset + 1] === 0) {
          if ((data[nextOffset + 2] === 0 && data[nextOffset + 3] === 1) ||
              data[nextOffset + 2] === 1) {
            break;
          }
        }
        nextOffset++;
      }

      if (nextOffset >= data.length - 3) {
        nextOffset = data.length;
      }

      const nalUnit = data.slice(offset, nextOffset);

      // Group NAL units into access units (simplified: each slice is an AU)
      if (nalType === 1 || nalType === 5) {
        currentAU.push(nalUnit);
        flushAU();
      } else {
        // SPS, PPS, etc. - add to current AU
        currentAU.push(nalUnit);
      }

      offset = nextOffset;
    } else {
      offset++;
    }
  }

  flushAU();
}

/**
 * Test VideoDecoder with a sample file
 */
async function testVideoDecoder(sample: VideoSample): Promise<void> {
  const filePath = path.join(SAMPLES_DIR, sample.file);

  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ File not found: ${sample.file}`);
    return;
  }

  console.log(`  Testing ${sample.file} (${sample.codec})...`);

  try {
    // Extract encoded chunks
    const { chunks, keyFrames } = await extractVideoChunks(filePath, sample.codec);
    console.log(`    Extracted ${chunks.length} chunks`);

    if (chunks.length === 0) {
      console.log(`    ⚠ No chunks extracted`);
      return;
    }

    // Create decoder
    const frames: VideoFrame[] = [];
    const errors: Error[] = [];

    const decoder = new VideoDecoder({
      output: (frame) => {
        frames.push(frame);
      },
      error: (err) => {
        if (!errors.find(e => e.message === err.message)) {
          errors.push(err);
        }
      },
    });

    const config: VideoDecoderConfig = {
      codec: sample.codec,
      codedWidth: sample.width,
      codedHeight: sample.height,
      outputFormat: 'I420',
    };

    decoder.configure(config);

    // Wait a bit for FFmpeg to fully start
    await new Promise(r => setTimeout(r, 100));

    // Decode chunks (limit to first 30 for speed)
    const maxChunks = Math.min(chunks.length, 30);
    let successfulDecodes = 0;

    for (let i = 0; i < maxChunks; i++) {
      const chunk = new EncodedVideoChunk({
        type: keyFrames[i] ? 'key' : 'delta',
        timestamp: i * 33333, // ~30fps
        data: new Uint8Array(chunks[i]),
      });

      try {
        decoder.decode(chunk);
        successfulDecodes++;
      } catch (err) {
        // Decode threw synchronously
        errors.push(err instanceof Error ? err : new Error(String(err)));
        break;
      }

      // Small delay to allow FFmpeg to process
      if (i % 10 === 9) {
        await new Promise(r => setTimeout(r, 50));
      }
    }


    // Flush and wait
    try {
      await decoder.flush(60000);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
    decoder.close();

    if (errors.length > 0) {
      console.log(`    ✗ Errors: ${errors.map(e => e.message).join(', ')}`);
    } else if (frames.length > 0) {
      console.log(`    ✓ Decoded ${frames.length} frames`);
      console.log(`      Format: ${frames[0].format}, Size: ${frames[0].codedWidth}x${frames[0].codedHeight}`);
    } else {
      console.log(`    ⚠ No frames decoded`);
    }

    // Clean up frames
    frames.forEach(f => f.close());

  } catch (err) {
    console.log(`    ✗ Error: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Extract audio frames from a file using FFmpeg
 * Returns raw codec data in a format suitable for the decoder
 */
async function extractAudioFrames(filePath: string, codec: string): Promise<{ frames: Buffer[]; format: string }> {
  const codecBase = codec.split('.')[0].toLowerCase();

  // For Opus, parse Ogg container directly (no FFmpeg needed)
  if (codecBase === 'opus') {
    const frames: Buffer[] = [];
    await parseOpusPackets(filePath, frames);
    return { frames, format: 'opus' };
  }

  return new Promise((resolve, reject) => {
    let outputFormat: string;
    let args: string[];

    if (codecBase === 'mp3') {
      // For MP3, use mp3 format which is self-framing
      outputFormat = 'mp3';
      args = [
        '-i', filePath,
        '-vn',  // No video
        '-c:a', 'copy',
        '-f', outputFormat,
        'pipe:1'
      ];
    } else if (codecBase === 'mp4a' || codecBase === 'aac') {
      // For AAC, use ADTS which is self-framing
      outputFormat = 'adts';
      args = [
        '-i', filePath,
        '-vn',  // No video
        '-c:a', 'copy',
        '-f', outputFormat,
        'pipe:1'
      ];
    } else {
      reject(new Error(`Unsupported audio codec: ${codec}`));
      return;
    }

    const ffmpeg = spawn('ffmpeg', args);
    const dataChunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (data: Buffer) => {
      dataChunks.push(data);
    });

    ffmpeg.stderr.on('data', () => {
      // Ignore stderr
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}`));
        return;
      }

      const fullData = Buffer.concat(dataChunks);
      const frames: Buffer[] = [];

      if (outputFormat === 'adts') {
        // Parse ADTS frames (AAC)
        parseAdtsFrames(fullData, frames);
      } else if (outputFormat === 'mp3') {
        // Parse MP3 frames
        parseMp3Frames(fullData, frames);
      }

      resolve({ frames, format: outputFormat });
    });

    ffmpeg.on('error', reject);
  });
}

/**
 * Parse Opus packets from an Ogg file
 * Reads the file directly and extracts raw Opus packets from Ogg container
 */
async function parseOpusPackets(filePath: string, frames: Buffer[]): Promise<void> {
  const fileData = fs.readFileSync(filePath);
  parseOggOpusPackets(fileData, frames);
}

/**
 * Parse Ogg container to extract Opus packets
 */
function parseOggOpusPackets(data: Buffer, frames: Buffer[]): void {
  let offset = 0;

  while (offset < data.length - 27) {
    // Check for OggS magic
    if (data[offset] !== 0x4F || data[offset + 1] !== 0x67 ||
        data[offset + 2] !== 0x67 || data[offset + 3] !== 0x53) {
      offset++;
      continue;
    }

    // Parse Ogg page header
    const version = data[offset + 4];
    if (version !== 0) {
      offset++;
      continue;
    }

    const headerType = data[offset + 5];
    const numSegments = data[offset + 26];

    if (offset + 27 + numSegments > data.length) break;

    // Read segment table
    const segmentTable = data.slice(offset + 27, offset + 27 + numSegments);
    let pageDataSize = 0;
    for (let i = 0; i < numSegments; i++) {
      pageDataSize += segmentTable[i];
    }

    const pageDataOffset = offset + 27 + numSegments;
    if (pageDataOffset + pageDataSize > data.length) break;

    // Skip header pages (first two pages are OpusHead and OpusTags)
    const isHeaderPage = (headerType & 0x02) !== 0; // Beginning of stream
    if (!isHeaderPage) {
      // Extract packets from this page
      let packetOffset = pageDataOffset;
      let packetSize = 0;

      for (let i = 0; i < numSegments; i++) {
        packetSize += segmentTable[i];

        // Segment size < 255 means end of packet
        if (segmentTable[i] < 255) {
          if (packetSize > 0) {
            const packet = data.slice(packetOffset, packetOffset + packetSize);
            // Skip if it looks like a header (OpusHead or OpusTags)
            if (packet.length > 8 &&
                !(packet[0] === 0x4F && packet[1] === 0x70)) { // Not "Op" prefix
              frames.push(packet);
            }
          }
          packetOffset += packetSize;
          packetSize = 0;
        }
      }
    }

    offset = pageDataOffset + pageDataSize;
  }
}

/**
 * Parse ADTS frames from AAC data
 */
function parseAdtsFrames(data: Buffer, frames: Buffer[]): void {
  let offset = 0;
  while (offset < data.length - 7) {
    // Check for ADTS sync word (0xFFF)
    if (data[offset] === 0xFF && (data[offset + 1] & 0xF0) === 0xF0) {
      // Get frame length from header
      const frameLength = ((data[offset + 3] & 0x03) << 11) |
                          (data[offset + 4] << 3) |
                          ((data[offset + 5] & 0xE0) >> 5);

      if (frameLength > 0 && offset + frameLength <= data.length) {
        frames.push(data.slice(offset, offset + frameLength));
        offset += frameLength;
      } else {
        offset++;
      }
    } else {
      offset++;
    }
  }
}

/**
 * Parse MP3 frames
 */
function parseMp3Frames(data: Buffer, frames: Buffer[]): void {
  let offset = 0;
  while (offset < data.length - 4) {
    // Check for MP3 sync word (0xFF followed by 0xE0 or higher)
    if (data[offset] === 0xFF && (data[offset + 1] & 0xE0) === 0xE0) {
      // Parse MP3 header to get frame size
      const header = data.readUInt32BE(offset);
      const version = (header >> 19) & 0x03;
      const layer = (header >> 17) & 0x03;
      const bitrateIndex = (header >> 12) & 0x0F;
      const sampleRateIndex = (header >> 10) & 0x03;
      const padding = (header >> 9) & 0x01;

      // Calculate frame size (simplified for Layer III)
      const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
      const sampleRates = [44100, 48000, 32000, 0];

      const bitrate = bitrates[bitrateIndex] * 1000;
      const sampleRate = sampleRates[sampleRateIndex];

      if (bitrate > 0 && sampleRate > 0 && layer === 1) {
        // Layer III frame size calculation
        const frameSize = Math.floor((144 * bitrate) / sampleRate) + padding;

        if (frameSize > 0 && offset + frameSize <= data.length) {
          frames.push(data.slice(offset, offset + frameSize));
          offset += frameSize;
          continue;
        }
      }
    }
    offset++;
  }
}

/**
 * Test AudioDecoder with a sample file
 */
async function testAudioDecoder(sample: AudioSample): Promise<void> {
  const filePath = path.join(SAMPLES_DIR, sample.file);

  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ File not found: ${sample.file}`);
    return;
  }

  console.log(`  Testing ${sample.file} (${sample.codec})...`);

  try {
    // Extract audio frames using FFmpeg
    const { frames, format } = await extractAudioFrames(filePath, sample.codec);
    console.log(`    Extracted ${frames.length} frames (${format})`);

    if (frames.length === 0) {
      console.log(`    ⚠ No frames extracted`);
      return;
    }

    // Create decoder
    const audioSamples: AudioData[] = [];
    const errors: Error[] = [];

    const decoder = new AudioDecoder({
      output: (data) => {
        audioSamples.push(data);
      },
      error: (err) => {
        errors.push(err);
      },
    });

    const config: AudioDecoderConfig = {
      codec: sample.codec,
      sampleRate: sample.sampleRate,
      numberOfChannels: sample.channels,
    };

    decoder.configure(config);

    // Decode frames
    const maxFrames = Math.min(frames.length, 100); // Limit for speed
    for (let i = 0; i < maxFrames; i++) {
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: i * 20000, // ~20ms per frame
        data: new Uint8Array(frames[i]),
      });

      try {
        decoder.decode(chunk);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        break;
      }

      // Small delay to allow processing
      if (i % 20 === 19) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    // Flush and wait
    try {
      await decoder.flush();
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
    decoder.close();

    if (errors.length > 0) {
      console.log(`    ✗ Error: ${errors[0].message}`);
    } else if (audioSamples.length > 0) {
      const totalSamples = audioSamples.reduce((sum, d) => sum + d.numberOfFrames, 0);
      console.log(`    ✓ Decoded ${audioSamples.length} audio data objects`);
      console.log(`      Total samples: ${totalSamples}, Format: ${audioSamples[0].format}`);
      console.log(`      Sample rate: ${audioSamples[0].sampleRate}Hz, Channels: ${audioSamples[0].numberOfChannels}`);
    } else {
      console.log(`    ⚠ No audio data decoded`);
    }

    // Clean up
    audioSamples.forEach(d => d.close());

  } catch (err) {
    console.log(`    ✗ Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  console.log('WebCodecs Sample File Tests');
  console.log('===========================\n');

  // Check if samples directory exists
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.log(`Error: Samples directory not found: ${SAMPLES_DIR}`);
    console.log('Please download sample files first.');
    process.exit(1);
  }

  // List available files
  const files = fs.readdirSync(SAMPLES_DIR);
  console.log(`Found ${files.length} files in ${SAMPLES_DIR}:`);
  files.forEach(f => console.log(`  - ${f}`));
  console.log('');

  // Test video samples
  console.log('Video Decoder Tests:');
  console.log('--------------------');
  for (const sample of VIDEO_SAMPLES) {
    await testVideoDecoder(sample);
  }
  console.log('');

  // Test audio samples
  console.log('Audio Decoder Tests:');
  console.log('--------------------');
  for (const sample of AUDIO_SAMPLES) {
    await testAudioDecoder(sample);
  }

  console.log('\nDone!');
}

main().catch(console.error);

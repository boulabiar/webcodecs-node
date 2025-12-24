/**
 * FFmpeg Muxer - FFmpeg subprocess-based muxer
 *
 * This muxer accumulates encoded chunks in memory and uses FFmpeg
 * to mux them when close() is called. Used as a fallback when
 * the node-av muxer fails.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

import type { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import type {
  IMuxer,
  MuxerConfig,
  VideoTrackConfig,
  AudioTrackConfig,
} from './muxer-types.js';
import { MuxerError, inferFormat } from './muxer-types.js';

/**
 * Convert AVCC format (length-prefixed NALUs) to Annex B (start code prefixed)
 * This is needed because FFmpeg expects Annex B format for raw H.264 input
 */
function avccToAnnexB(
  avccData: Uint8Array,
  nalLengthSize: number = 4
): Uint8Array {
  const START_CODE = new Uint8Array([0, 0, 0, 1]);
  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset < avccData.length) {
    // Read NAL unit length
    let nalLength = 0;
    for (let i = 0; i < nalLengthSize; i++) {
      nalLength = (nalLength << 8) | avccData[offset + i];
    }
    offset += nalLengthSize;

    if (nalLength <= 0 || offset + nalLength > avccData.length) {
      break;
    }

    // Add start code + NAL unit
    chunks.push(START_CODE);
    chunks.push(avccData.slice(offset, offset + nalLength));
    offset += nalLength;
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return result;
}

/**
 * Parse AVCC extradata (SPS/PPS) to Annex B format
 */
function parseAvccExtradata(extradata: Uint8Array): {
  annexBHeader: Uint8Array;
  nalLengthSize: number;
} {
  const START_CODE = new Uint8Array([0, 0, 0, 1]);
  const chunks: Uint8Array[] = [];

  // AVCC format:
  // configurationVersion (1 byte) = 1
  // AVCProfileIndication (1 byte)
  // profile_compatibility (1 byte)
  // AVCLevelIndication (1 byte)
  // lengthSizeMinusOne (6 bits reserved + 2 bits) -> NAL length size = (value & 0x03) + 1
  // numOfSequenceParameterSets (3 bits reserved + 5 bits)
  // SPS entries...
  // numOfPictureParameterSets (1 byte)
  // PPS entries...

  if (extradata.length < 7 || extradata[0] !== 1) {
    // Not valid AVCC, return as-is (might already be Annex B)
    return { annexBHeader: extradata, nalLengthSize: 4 };
  }

  const nalLengthSize = (extradata[4] & 0x03) + 1;
  let offset = 5;

  // Parse SPS
  const numSPS = extradata[offset] & 0x1f;
  offset++;

  for (let i = 0; i < numSPS; i++) {
    const spsLength = (extradata[offset] << 8) | extradata[offset + 1];
    offset += 2;
    chunks.push(START_CODE);
    chunks.push(extradata.slice(offset, offset + spsLength));
    offset += spsLength;
  }

  // Parse PPS
  const numPPS = extradata[offset];
  offset++;

  for (let i = 0; i < numPPS; i++) {
    const ppsLength = (extradata[offset] << 8) | extradata[offset + 1];
    offset += 2;
    chunks.push(START_CODE);
    chunks.push(extradata.slice(offset, offset + ppsLength));
    offset += ppsLength;
  }

  // Concatenate
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const annexBHeader = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    annexBHeader.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return { annexBHeader, nalLengthSize };
}

/**
 * Add ADTS header to raw AAC frame
 */
function addAdtsHeader(
  aacFrame: Uint8Array,
  sampleRate: number,
  channels: number
): Uint8Array {
  const sampleRateIndex = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
    8000, 7350,
  ].indexOf(sampleRate);

  if (sampleRateIndex === -1) {
    // Unsupported sample rate, return raw frame
    return aacFrame;
  }

  const frameLength = aacFrame.length + 7; // ADTS header is 7 bytes
  const header = new Uint8Array(7);

  // Syncword (12 bits) = 0xFFF
  header[0] = 0xff;
  header[1] = 0xf1; // MPEG-4, Layer 0, no CRC

  // Profile (2 bits) = AAC-LC (1), shifted left 6
  // Sample rate index (4 bits), shifted left 2
  // Private bit (1 bit) = 0
  // Channel config (3 bits, upper 1 bit)
  header[2] = ((1 << 6) | (sampleRateIndex << 2) | (channels >> 2)) & 0xff;

  // Channel config (lower 2 bits), shifted left 6
  // Original/copy (1 bit) = 0
  // Home (1 bit) = 0
  // Copyright ID (1 bit) = 0
  // Copyright start (1 bit) = 0
  // Frame length (13 bits, upper 2 bits)
  header[3] = (((channels & 0x03) << 6) | (frameLength >> 11)) & 0xff;

  // Frame length (middle 8 bits)
  header[4] = (frameLength >> 3) & 0xff;

  // Frame length (lower 3 bits), shifted left 5
  // Buffer fullness (11 bits, upper 5 bits) = 0x7FF (VBR)
  header[5] = (((frameLength & 0x07) << 5) | 0x1f) & 0xff;

  // Buffer fullness (lower 6 bits), shifted left 2
  // Number of AAC frames - 1 (2 bits) = 0
  header[6] = 0xfc;

  // Combine header and frame
  const result = new Uint8Array(frameLength);
  result.set(header);
  result.set(aacFrame, 7);

  return result;
}

/**
 * FFmpeg-based muxer that uses subprocess for muxing
 *
 * This muxer accumulates chunks and uses FFmpeg to create the final
 * output file. It's more battle-tested but slower (~130ms due to
 * process spawn) than the native node-av muxer (~5ms).
 */
export class FFmpegMuxer implements IMuxer {
  private config: MuxerConfig;
  private videoConfig: VideoTrackConfig | null = null;
  private audioConfig: AudioTrackConfig | null = null;
  private videoChunks: EncodedVideoChunk[] = [];
  private audioChunks: EncodedAudioChunk[] = [];
  private _videoChunkCount = 0;
  private _audioChunkCount = 0;
  private isOpen = false;
  private tempDir: string | null = null;

  constructor(config: MuxerConfig) {
    this.config = config;
  }

  async open(timeout?: number): Promise<void> {
    // Create temp directory for intermediate files
    this.tempDir = path.join(
      os.tmpdir(),
      `ffmpeg-mux-${randomBytes(8).toString('hex')}`
    );
    fs.mkdirSync(this.tempDir, { recursive: true });
    this.isOpen = true;
  }

  async addVideoTrack(config: VideoTrackConfig): Promise<number> {
    if (!this.isOpen) {
      throw new MuxerError('Muxer not opened', 'ffmpeg-spawn', 'addTrack');
    }
    this.videoConfig = config;
    return 0;
  }

  async addAudioTrack(config: AudioTrackConfig): Promise<number> {
    if (!this.isOpen) {
      throw new MuxerError('Muxer not opened', 'ffmpeg-spawn', 'addTrack');
    }
    this.audioConfig = config;
    return this.videoConfig ? 1 : 0;
  }

  async writeVideoChunk(chunk: EncodedVideoChunk): Promise<void> {
    if (!this.isOpen || !this.videoConfig) {
      throw new MuxerError(
        'Video track not configured',
        'ffmpeg-spawn',
        'write'
      );
    }
    this.videoChunks.push(chunk);
    this._videoChunkCount++;
  }

  async writeAudioChunk(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.isOpen || !this.audioConfig) {
      throw new MuxerError(
        'Audio track not configured',
        'ffmpeg-spawn',
        'write'
      );
    }
    this.audioChunks.push(chunk);
    this._audioChunkCount++;
  }

  async close(timeout?: number): Promise<void> {
    if (!this.isOpen || !this.tempDir) {
      return;
    }

    try {
      await this.muxWithFFmpeg();
    } finally {
      // Clean up temp directory
      if (this.tempDir && fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
      this.isOpen = false;
    }
  }

  private async muxWithFFmpeg(): Promise<void> {
    if (!this.tempDir) return;

    const ffmpegArgs: string[] = ['-y'];
    const inputFiles: string[] = [];

    // Write video to temp file
    if (this.videoConfig && this.videoChunks.length > 0) {
      const videoPath = path.join(this.tempDir, 'video.h264');
      await this.writeVideoToFile(videoPath);
      inputFiles.push(videoPath);

      const framerate = this.videoConfig.framerate || 30;
      ffmpegArgs.push('-f', 'h264', '-r', String(framerate), '-i', videoPath);
    }

    // Write audio to temp file
    if (this.audioConfig && this.audioChunks.length > 0) {
      const audioPath = path.join(this.tempDir, 'audio.aac');
      await this.writeAudioToFile(audioPath);
      inputFiles.push(audioPath);

      ffmpegArgs.push('-f', 'aac', '-i', audioPath);
    }

    if (inputFiles.length === 0) {
      throw new MuxerError('No tracks to mux', 'ffmpeg-spawn', 'close');
    }

    // Output options
    ffmpegArgs.push(
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      this.config.path
    );

    // Spawn FFmpeg
    await this.spawnFFmpeg(ffmpegArgs);
  }

  private async writeVideoToFile(filePath: string): Promise<void> {
    if (!this.videoConfig) return;

    const chunks: Uint8Array[] = [];

    // Parse extradata to get NAL length size and write SPS/PPS header
    let nalLengthSize = 4;
    if (this.videoConfig.description) {
      const { annexBHeader, nalLengthSize: nls } = parseAvccExtradata(
        this.videoConfig.description
      );
      nalLengthSize = nls;
      chunks.push(annexBHeader);
    }

    // Convert each chunk from AVCC to Annex B
    for (const chunk of this.videoChunks) {
      const annexBData = avccToAnnexB(chunk._buffer, nalLengthSize);
      chunks.push(annexBData);
    }

    // Write to file
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const buffer = Buffer.alloc(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      Buffer.from(chunk).copy(buffer, offset);
      offset += chunk.length;
    }
    fs.writeFileSync(filePath, buffer);
  }

  private async writeAudioToFile(filePath: string): Promise<void> {
    if (!this.audioConfig) return;

    const chunks: Uint8Array[] = [];

    // Add ADTS headers to each AAC frame
    for (const chunk of this.audioChunks) {
      const adtsFrame = addAdtsHeader(
        chunk._rawData,
        this.audioConfig.sampleRate,
        this.audioConfig.numberOfChannels
      );
      chunks.push(adtsFrame);
    }

    // Write to file
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const buffer = Buffer.alloc(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      Buffer.from(chunk).copy(buffer, offset);
      offset += chunk.length;
    }
    fs.writeFileSync(filePath, buffer);
  }

  private spawnFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('error', (err) => {
        reject(
          new MuxerError(
            `FFmpeg spawn error: ${err.message}`,
            'ffmpeg-spawn',
            'close',
            err
          )
        );
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new MuxerError(
              `FFmpeg exited with code ${code}: ${stderr.slice(-500)}`,
              'ffmpeg-spawn',
              'close'
            )
          );
        }
      });
    });
  }

  get videoChunkCount(): number {
    return this._videoChunkCount;
  }

  get audioChunkCount(): number {
    return this._audioChunkCount;
  }
}

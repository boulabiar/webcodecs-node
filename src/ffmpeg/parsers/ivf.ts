/**
 * IVF container parser
 *
 * IVF format (used for VP8, VP9, AV1):
 * - 32-byte file header
 * - Per frame: 4-byte size (LE) + 8-byte timestamp (LE) + frame data
 */

import type { EncodedFrameData } from '../types.js';

/** IVF file header size */
export const IVF_HEADER_SIZE = 32;

/** IVF frame header size (size + timestamp) */
export const IVF_FRAME_HEADER_SIZE = 12;

/** IVF file signature */
export const IVF_SIGNATURE = 'DKIF';

/**
 * IVF parser state
 */
export interface IvfParserState {
  headerParsed: boolean;
  buffer: Buffer;
}

/**
 * Create initial IVF parser state
 */
export function createIvfParserState(): IvfParserState {
  return {
    headerParsed: false,
    buffer: Buffer.alloc(0),
  };
}

/**
 * Validate IVF file signature
 */
export function validateIvfSignature(data: Buffer): boolean {
  if (data.length < 4) return false;
  return data.subarray(0, 4).toString() === IVF_SIGNATURE;
}

/**
 * Parse IVF frames from accumulated data
 *
 * @param state - Parser state (mutated)
 * @param newData - New data to append
 * @param isKeyFrame - Function to determine if frame is a keyframe
 * @returns Array of parsed frames
 */
export function parseIvfFrames(
  state: IvfParserState,
  newData: Buffer,
  isKeyFrame: (data: Buffer) => boolean
): EncodedFrameData[] {
  const frames: EncodedFrameData[] = [];

  // Append new data
  state.buffer = Buffer.concat([state.buffer, newData]);

  // Skip 32-byte IVF file header
  if (!state.headerParsed) {
    if (state.buffer.length < IVF_HEADER_SIZE) {
      return frames; // Wait for more data
    }

    // Verify IVF signature "DKIF"
    if (!validateIvfSignature(state.buffer)) {
      const signature = state.buffer.subarray(0, 4).toString();
      throw new Error(`Invalid IVF signature: ${signature}`);
    }

    state.buffer = state.buffer.subarray(IVF_HEADER_SIZE);
    state.headerParsed = true;
  }

  // Parse frames: 4-byte size + 8-byte timestamp + data
  while (state.buffer.length >= IVF_FRAME_HEADER_SIZE) {
    const frameSize = state.buffer.readUInt32LE(0);
    const timestamp = Number(state.buffer.readBigUInt64LE(4));

    const totalFrameSize = IVF_FRAME_HEADER_SIZE + frameSize;
    if (state.buffer.length < totalFrameSize) {
      break; // Wait for more data
    }

    const frameData = state.buffer.subarray(IVF_FRAME_HEADER_SIZE, totalFrameSize);
    state.buffer = state.buffer.subarray(totalFrameSize);

    frames.push({
      data: Buffer.from(frameData), // Copy the data
      timestamp,
      keyFrame: isKeyFrame(frameData),
    });
  }

  return frames;
}

/**
 * Check if VP9 frame is a keyframe
 * VP9: frame_type bit in frame header (0 = keyframe)
 */
export function isVP9KeyFrame(data: Buffer): boolean {
  if (data.length === 0) return false;
  // VP9: check frame_type bit (bit 1 of first byte)
  // frame_type = 0 means keyframe
  return (data[0] & 0x02) === 0;
}

/**
 * Check if VP8 frame is a keyframe
 * VP8: keyframe indicated by bit in frame tag
 */
export function isVP8KeyFrame(data: Buffer): boolean {
  if (data.length === 0) return false;
  // VP8: keyframe has specific frame tag
  // First bit of first byte indicates frame type (0 = key)
  return (data[0] & 0x01) === 0;
}

/**
 * Check if AV1 frame is a keyframe
 * Simplified check - real implementation would parse OBU headers
 */
export function isAV1KeyFrame(data: Buffer): boolean {
  if (data.length < 2) return false;
  // AV1 OBU header parsing - simplified
  // This is a basic heuristic; full parsing would check OBU types
  const obuType = (data[0] >> 3) & 0x0f;
  // OBU_SEQUENCE_HEADER (type 1) usually indicates keyframe area
  return obuType === 1;
}

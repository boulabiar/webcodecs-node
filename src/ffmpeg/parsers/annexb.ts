/**
 * H.264/HEVC Annex B bitstream parser
 *
 * Parses Annex B format using Access Unit Delimiter (AUD) as frame boundaries.
 */

import type { EncodedFrameData } from '../types.js';

/**
 * NAL unit types for H.264
 */
export const H264_NAL_TYPES = {
  SLICE: 1,         // Non-IDR slice
  IDR: 5,           // IDR slice (keyframe)
  SEI: 6,           // Supplemental Enhancement Information
  SPS: 7,           // Sequence Parameter Set
  PPS: 8,           // Picture Parameter Set
  AUD: 9,           // Access Unit Delimiter
} as const;

/**
 * NAL unit types for HEVC
 */
export const HEVC_NAL_TYPES = {
  TRAIL_N: 0,       // Non-reference trailing picture
  TRAIL_R: 1,       // Reference trailing picture
  IDR_W_RADL: 19,   // IDR with RADL
  IDR_N_LP: 20,     // IDR without leading pictures
  CRA: 21,          // Clean Random Access
  VPS: 32,          // Video Parameter Set
  SPS: 33,          // Sequence Parameter Set
  PPS: 34,          // Picture Parameter Set
  AUD: 35,          // Access Unit Delimiter
} as const;

/**
 * Annex B parser state
 */
export interface AnnexBParserState {
  buffer: Buffer;
  codec: 'h264' | 'hevc';
  frameIndex: number;
}

/**
 * Create initial Annex B parser state
 */
export function createAnnexBParserState(codec: 'h264' | 'hevc'): AnnexBParserState {
  return {
    buffer: Buffer.alloc(0),
    codec,
    frameIndex: 0,
  };
}

/**
 * Get NAL unit type from first byte after start code
 */
export function getNalType(firstByte: number, codec: 'h264' | 'hevc'): number {
  if (codec === 'h264') {
    // H.264: NAL type is in bits 0-4
    return firstByte & 0x1f;
  } else {
    // HEVC: NAL type is in bits 1-6
    return (firstByte >> 1) & 0x3f;
  }
}

/**
 * Check if NAL type is an Access Unit Delimiter
 */
export function isAudNal(nalType: number, codec: 'h264' | 'hevc'): boolean {
  if (codec === 'h264') {
    return nalType === H264_NAL_TYPES.AUD;
  } else {
    return nalType === HEVC_NAL_TYPES.AUD;
  }
}

/**
 * Find start code in buffer starting from offset
 * Returns { position, length } or null if not found
 */
export function findStartCode(
  data: Buffer,
  offset: number
): { position: number; length: number } | null {
  for (let i = offset; i < data.length - 2; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) {
        return { position: i, length: 3 };
      } else if (data[i + 2] === 0 && i + 3 < data.length && data[i + 3] === 1) {
        return { position: i, length: 4 };
      }
    }
  }
  return null;
}

/**
 * Find all AUD positions in buffer
 */
export function findAudPositions(data: Buffer, codec: 'h264' | 'hevc'): number[] {
  const positions: number[] = [];
  let offset = 0;

  while (offset < data.length - 4) {
    const startCode = findStartCode(data, offset);
    if (!startCode) break;

    const nalStart = startCode.position + startCode.length;
    if (nalStart < data.length) {
      const nalType = getNalType(data[nalStart], codec);
      if (isAudNal(nalType, codec)) {
        positions.push(startCode.position);
      }
    }

    offset = nalStart;
  }

  return positions;
}

/**
 * Check if H.264 frame is a keyframe
 */
export function isH264KeyFrame(data: Buffer): boolean {
  let offset = 0;

  while (offset < data.length - 4) {
    const startCode = findStartCode(data, offset);
    if (!startCode) break;

    const nalStart = startCode.position + startCode.length;
    if (nalStart < data.length) {
      const nalType = getNalType(data[nalStart], 'h264');

      // IDR slice = keyframe
      if (nalType === H264_NAL_TYPES.IDR) return true;
      // Non-IDR slice = not keyframe
      if (nalType === H264_NAL_TYPES.SLICE) return false;
    }

    offset = nalStart;
  }

  return false;
}

/**
 * Check if HEVC frame is a keyframe
 */
export function isHEVCKeyFrame(data: Buffer): boolean {
  let offset = 0;

  while (offset < data.length - 4) {
    const startCode = findStartCode(data, offset);
    if (!startCode) break;

    const nalStart = startCode.position + startCode.length;
    if (nalStart < data.length) {
      const nalType = getNalType(data[nalStart], 'hevc');

      // IDR or CRA types are keyframes (16-21)
      if (nalType >= 16 && nalType <= 21) return true;
      // Trailing picture types are not keyframes (0-9)
      if (nalType >= 0 && nalType <= 9) return false;
    }

    offset = nalStart;
  }

  return false;
}

/**
 * Check if frame is a keyframe based on codec
 */
export function isKeyFrame(data: Buffer, codec: 'h264' | 'hevc'): boolean {
  return codec === 'h264' ? isH264KeyFrame(data) : isHEVCKeyFrame(data);
}

/**
 * Parse Annex B frames from accumulated data
 *
 * @param state - Parser state (mutated)
 * @param newData - New data to append
 * @returns Array of parsed frames
 */
export function parseAnnexBFrames(
  state: AnnexBParserState,
  newData: Buffer
): EncodedFrameData[] {
  const frames: EncodedFrameData[] = [];

  // Append new data
  state.buffer = Buffer.concat([state.buffer, newData]);

  // Find all AUD positions
  const audPositions = findAudPositions(state.buffer, state.codec);

  // Need at least 2 AUDs to have a complete frame
  if (audPositions.length < 2) {
    return frames;
  }

  // Emit all complete frames
  for (let i = 0; i < audPositions.length - 1; i++) {
    const frameData = Buffer.from(
      state.buffer.subarray(audPositions[i], audPositions[i + 1])
    );

    frames.push({
      data: frameData,
      timestamp: state.frameIndex++,
      keyFrame: isKeyFrame(frameData, state.codec),
    });
  }

  // Keep the last incomplete frame
  const lastAudPos = audPositions[audPositions.length - 1];
  state.buffer = Buffer.from(state.buffer.subarray(lastAudPos));

  return frames;
}

/**
 * Flush remaining data as final frame
 */
export function flushAnnexBParser(state: AnnexBParserState): EncodedFrameData | null {
  if (state.buffer.length === 0) {
    return null;
  }

  const frameData = Buffer.from(state.buffer);
  state.buffer = Buffer.alloc(0);

  return {
    data: frameData,
    timestamp: state.frameIndex++,
    keyFrame: isKeyFrame(frameData, state.codec),
  };
}

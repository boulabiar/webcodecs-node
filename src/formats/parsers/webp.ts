/**
 * WebP format header parser
 * Parses RIFF/WEBP container to extract dimensions and detect animation
 */

export interface WebPInfo {
  width: number;
  height: number;
  isAnimated: boolean;
  frameCount: number;
}

/**
 * Parse WebP header to extract dimensions and detect animation
 * Returns null if parsing fails
 */
export function parseWebPHeader(data: Uint8Array): WebPInfo | null {
  if (data.length < 12) return null;

  // Check RIFF header
  const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
  const webp = String.fromCharCode(data[8], data[9], data[10], data[11]);
  if (riff !== 'RIFF' || webp !== 'WEBP') return null;

  let offset = 12;

  // Read first chunk
  if (offset + 8 > data.length) return null;

  const chunkFourCC = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  const chunkSize = data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24);

  if (chunkFourCC === 'VP8X') {
    return parseVP8XChunk(data, offset, chunkSize);
  } else if (chunkFourCC === 'VP8 ') {
    return parseVP8Chunk(data, offset);
  } else if (chunkFourCC === 'VP8L') {
    return parseVP8LChunk(data, offset);
  }

  return null;
}

/**
 * Parse VP8X (extended) chunk - can contain animation
 */
function parseVP8XChunk(data: Uint8Array, offset: number, chunkSize: number): WebPInfo | null {
  if (offset + 8 + 10 > data.length) return null;

  const flags = data[offset + 8];
  const hasAnimation = (flags & 0x02) !== 0;

  // Read canvas width (24-bit little-endian at offset+12) - value is width-1
  const canvasWidth = (data[offset + 12] | (data[offset + 13] << 8) | (data[offset + 14] << 16)) + 1;
  // Read canvas height (24-bit little-endian at offset+15) - value is height-1
  const canvasHeight = (data[offset + 15] | (data[offset + 16] << 8) | (data[offset + 17] << 16)) + 1;

  // Count ANMF frames if animated
  let frameCount = 1;
  if (hasAnimation) {
    frameCount = countAnimationFrames(data, offset + 8 + chunkSize + (chunkSize & 1));
    // If we found 0 frames but it has animation flag, assume at least 1
    if (frameCount === 0) frameCount = 1;
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    isAnimated: hasAnimation,
    frameCount: hasAnimation ? frameCount : 1,
  };
}

/**
 * Count ANMF (animation frame) chunks in WebP data
 */
function countAnimationFrames(data: Uint8Array, startPos: number): number {
  let frameCount = 0;
  let pos = startPos;

  while (pos + 8 <= data.length) {
    const fc = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
    const size = data[pos + 4] | (data[pos + 5] << 8) | (data[pos + 6] << 16) | (data[pos + 7] << 24);

    if (fc === 'ANMF') {
      frameCount++;
    }

    // Move to next chunk (size + padding for alignment)
    pos += 8 + size + (size & 1);
  }

  return frameCount;
}

/**
 * Parse VP8 (lossy) chunk - read dimensions from VP8 bitstream
 */
function parseVP8Chunk(data: Uint8Array, offset: number): WebPInfo | null {
  if (offset + 8 + 10 > data.length) return null;

  // VP8 frame header starts with 3-byte frame tag
  const frameTag = data[offset + 8] | (data[offset + 9] << 8) | (data[offset + 10] << 16);
  const keyFrame = (frameTag & 1) === 0;

  if (keyFrame) {
    // Skip frame tag (3 bytes) + signature (3 bytes)
    const widthCode = data[offset + 14] | (data[offset + 15] << 8);
    const heightCode = data[offset + 16] | (data[offset + 17] << 8);

    const width = widthCode & 0x3fff;
    const height = heightCode & 0x3fff;

    return { width, height, isAnimated: false, frameCount: 1 };
  }

  return null;
}

/**
 * Parse VP8L (lossless) chunk - read dimensions from VP8L header
 */
function parseVP8LChunk(data: Uint8Array, offset: number): WebPInfo | null {
  if (offset + 8 + 5 > data.length) return null;

  // Check signature byte (should be 0x2f)
  if (data[offset + 8] !== 0x2f) return null;

  // Read 4 bytes containing width and height (14 bits each)
  const b0 = data[offset + 9];
  const b1 = data[offset + 10];
  const b2 = data[offset + 11];
  const b3 = data[offset + 12];

  const bits = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >> 14) & 0x3fff) + 1;

  return { width, height, isAnimated: false, frameCount: 1 };
}

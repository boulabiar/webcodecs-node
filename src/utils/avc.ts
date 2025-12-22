/**
 * Utilities for handling AVC (H.264) configuration records and converting
 * length-prefixed NAL units (avcC format) into Annex B byte streams.
 */

export interface AvcConfig {
  lengthSize: number;
  sps: Uint8Array[];
  pps: Uint8Array[];
}

const START_CODE = Buffer.from([0x00, 0x00, 0x00, 0x01]);

/**
 * Parse an AVCDecoderConfigurationRecord (ISO/IEC 14496-15) into a structure
 * containing SPS/PPS NAL units and the NAL length size.
 */
export function parseAvcDecoderConfig(data: Uint8Array): AvcConfig {
  if (data.length < 7) {
    throw new Error('Invalid AVCDecoderConfigurationRecord: too short');
  }

  const lengthSizeMinusOne = data[4] & 0x03;
  const lengthSize = (lengthSizeMinusOne & 0x03) + 1;
  let offset = 5;

  const numOfSps = data[offset] & 0x1f;
  offset += 1;

  const sps: Uint8Array[] = [];
  for (let i = 0; i < numOfSps; i++) {
    if (offset + 2 > data.length) {
      throw new Error('Invalid AVCDecoderConfigurationRecord: truncated SPS length');
    }
    const length = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset + length > data.length) {
      throw new Error('Invalid AVCDecoderConfigurationRecord: truncated SPS data');
    }
    sps.push(data.subarray(offset, offset + length));
    offset += length;
  }

  if (offset + 1 > data.length) {
    throw new Error('Invalid AVCDecoderConfigurationRecord: missing PPS count');
  }

  const numOfPps = data[offset];
  offset += 1;

  const pps: Uint8Array[] = [];
  for (let i = 0; i < numOfPps; i++) {
    if (offset + 2 > data.length) {
      throw new Error('Invalid AVCDecoderConfigurationRecord: truncated PPS length');
    }
    const length = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset + length > data.length) {
      throw new Error('Invalid AVCDecoderConfigurationRecord: truncated PPS data');
    }
    pps.push(data.subarray(offset, offset + length));
    offset += length;
  }

  return { lengthSize, sps, pps };
}

/**
 * Convert an avcC length-prefixed chunk into Annex B byte stream and optionally
 * prepend SPS/PPS parameter sets (required for key frames).
 */
export function convertAvccToAnnexB(
  chunk: Uint8Array,
  config: AvcConfig,
  includeParameterSets: boolean
): Buffer {
  const parts: Buffer[] = [];

  if (includeParameterSets) {
    for (const nal of config.sps) {
      parts.push(START_CODE, Buffer.from(nal));
    }
    for (const nal of config.pps) {
      parts.push(START_CODE, Buffer.from(nal));
    }
  }

  let offset = 0;
  while (offset + config.lengthSize <= chunk.length) {
    let nalSize = 0;
    for (let i = 0; i < config.lengthSize; i++) {
      nalSize = (nalSize << 8) | chunk[offset + i];
    }
    offset += config.lengthSize;
    if (nalSize <= 0 || offset + nalSize > chunk.length) {
      break; // malformed
    }
    const nal = chunk.subarray(offset, offset + nalSize);
    parts.push(START_CODE, Buffer.from(nal));
    offset += nalSize;
  }

  if (parts.length === 0) {
    // Fallback to original chunk to avoid dropping data entirely.
    return Buffer.from(chunk);
  }

  return Buffer.concat(parts);
}

/**
 * Split an Annex B stream into individual NAL units (without start codes).
 */
export function splitAnnexBNals(data: Uint8Array): Uint8Array[] {
  const units: Uint8Array[] = [];
  let offset = 0;
  let unitStart = -1;

  while (offset < data.length) {
    const startCodeLength = getStartCodeLength(data, offset);
    if (startCodeLength > 0) {
      if (unitStart >= 0 && unitStart < offset) {
        const unit = data.subarray(unitStart, offset);
        if (unit.length > 0) {
          units.push(unit);
        }
      }
      offset += startCodeLength;
      unitStart = offset;
    } else {
      offset++;
    }
  }

  if (unitStart >= 0 && unitStart < data.length) {
    units.push(data.subarray(unitStart));
  }

  return units;
}

function getStartCodeLength(data: Uint8Array, offset: number): number {
  if (offset + 3 > data.length) {
    return 0;
  }

  if (data[offset] === 0 && data[offset + 1] === 0) {
    if (data[offset + 2] === 1) {
      return 3;
    }
    if (offset + 3 < data.length && data[offset + 2] === 0 && data[offset + 3] === 1) {
      return 4;
    }
  }

  return 0;
}

/**
 * Extract SPS/PPS parameter sets from an Annex B bitstream.
 */
export function extractAvcParameterSetsFromAnnexB(data: Uint8Array): { sps: Uint8Array[]; pps: Uint8Array[] } {
  const units = splitAnnexBNals(data);
  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];
  const seen = new Set<string>();

  for (const unit of units) {
    if (unit.length === 0) continue;
    const nalType = unit[0] & 0x1f;
    const key = `${nalType}:${unit.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (nalType === 7) {
      sps.push(unit);
    } else if (nalType === 8) {
      pps.push(unit);
    }
  }

  return { sps, pps };
}

/**
 * Build an AVCDecoderConfigurationRecord from SPS/PPS parameter sets.
 */
export function buildAvcDecoderConfig(
  spsList: Uint8Array[],
  ppsList: Uint8Array[],
  lengthSize: number = 4
): Uint8Array {
  if (spsList.length === 0 || ppsList.length === 0) {
    throw new Error('At least one SPS and PPS are required to build AVC config');
  }

  const sanitizedLength = Math.min(Math.max(lengthSize, 1), 4);
  const spsCount = Math.min(spsList.length, 31);
  const ppsCount = Math.min(ppsList.length, 255);

  let size = 6; // version/profile/level/length size + numOfSPS byte
  for (let i = 0; i < spsCount; i++) {
    size += 2 + spsList[i].length;
  }
  size += 1; // numOfPPS byte
  for (let i = 0; i < ppsCount; i++) {
    size += 2 + ppsList[i].length;
  }

  const buffer = Buffer.alloc(size);
  let offset = 0;

  const firstSps = spsList[0];
  buffer[offset++] = 1; // configurationVersion
  buffer[offset++] = firstSps[1] ?? 0x64; // profile indication
  buffer[offset++] = firstSps[2] ?? 0x00; // profile compatibility
  buffer[offset++] = firstSps[3] ?? 0x1f; // level indication
  buffer[offset++] = 0xfc | ((sanitizedLength - 1) & 0x03);
  buffer[offset++] = 0xe0 | spsCount;

  for (let i = 0; i < spsCount; i++) {
    const sps = spsList[i];
    buffer.writeUInt16BE(sps.length, offset);
    offset += 2;
    Buffer.from(sps).copy(buffer, offset);
    offset += sps.length;
  }

  buffer[offset++] = ppsCount;
  for (let i = 0; i < ppsCount; i++) {
    const pps = ppsList[i];
    buffer.writeUInt16BE(pps.length, offset);
    offset += 2;
    Buffer.from(pps).copy(buffer, offset);
    offset += pps.length;
  }

  return new Uint8Array(buffer);
}

/**
 * Convert Annex B frame into MP4 length-prefixed NAL units (avcC format).
 */
export function convertAnnexBToAvcc(data: Uint8Array, lengthSize: number = 4): Buffer {
  const units = splitAnnexBNals(data);
  const sanitizedLength = Math.min(Math.max(lengthSize, 1), 4);
  const parts: Buffer[] = [];

  for (const unit of units) {
    if (unit.length === 0) continue;
    const lengthBuffer = Buffer.alloc(sanitizedLength);
    if (sanitizedLength === 4) {
      lengthBuffer.writeUInt32BE(unit.length, 0);
    } else if (sanitizedLength === 2) {
      lengthBuffer.writeUInt16BE(unit.length, 0);
    } else if (sanitizedLength === 1) {
      lengthBuffer.writeUInt8(unit.length, 0);
    } else {
      // 3-byte length
      lengthBuffer.writeUIntBE(unit.length, 0, 3);
    }
    parts.push(lengthBuffer, Buffer.from(unit));
  }

  return Buffer.concat(parts);
}

/**
 * Utilities for handling HEVC (H.265) configuration records (HVCC) and
 * converting length-prefixed MP4 samples into Annex B byte streams.
 */

export interface HvccConfig {
  lengthSize: number;
  vps: Uint8Array[];
  sps: Uint8Array[];
  pps: Uint8Array[];
}

const START_CODE = Buffer.from([0x00, 0x00, 0x00, 0x01]);

/**
 * Parse an HEVCDecoderConfigurationRecord as defined in ISO/IEC 14496-15.
 */
export function parseHvccDecoderConfig(data: Uint8Array): HvccConfig {
  if (data.length < 23) {
    throw new Error('Invalid HEVCDecoderConfigurationRecord: too short');
  }

  const lengthSizeMinusOne = data[21] & 0x03;
  const lengthSize = (lengthSizeMinusOne & 0x03) + 1;

  let offset = 22;
  if (offset >= data.length) {
    throw new Error('Invalid HEVCDecoderConfigurationRecord: missing arrays');
  }

  const numOfArrays = data[offset++];
  const vps: Uint8Array[] = [];
  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];

  for (let i = 0; i < numOfArrays; i++) {
    if (offset + 3 > data.length) {
      throw new Error('Invalid HEVCDecoderConfigurationRecord: truncated array header');
    }

    const nalUnitType = data[offset] & 0x3f;
    offset += 1;

    const numNalus = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    for (let n = 0; n < numNalus; n++) {
      if (offset + 2 > data.length) {
        throw new Error('Invalid HEVCDecoderConfigurationRecord: truncated NAL length');
      }
      const nalLength = (data[offset] << 8) | data[offset + 1];
      offset += 2;

      if (offset + nalLength > data.length) {
        throw new Error('Invalid HEVCDecoderConfigurationRecord: truncated NAL data');
      }

      const nal = data.subarray(offset, offset + nalLength);
      offset += nalLength;

      if (nalUnitType === 32) {
        vps.push(nal);
      } else if (nalUnitType === 33) {
        sps.push(nal);
      } else if (nalUnitType === 34) {
        pps.push(nal);
      }
    }
  }

  return { lengthSize, vps, sps, pps };
}

/**
 * Convert HVCC (length-prefixed) samples to Annex B and optionally add VPS/SPS/PPS.
 *
 * Optimized to pre-calculate total size and use single buffer allocation.
 */
export function convertHvccToAnnexB(
  chunk: Uint8Array,
  config: HvccConfig,
  includeParameterSets: boolean
): Buffer {
  // First pass: calculate total size needed
  let totalSize = 0;

  if (includeParameterSets) {
    for (const nal of config.vps) {
      totalSize += 4 + nal.length; // START_CODE (4 bytes) + NAL data
    }
    for (const nal of config.sps) {
      totalSize += 4 + nal.length;
    }
    for (const nal of config.pps) {
      totalSize += 4 + nal.length;
    }
  }

  // Collect NAL unit offsets and sizes for the chunk
  const nalUnits: Array<{ offset: number; size: number }> = [];
  let offset = 0;
  while (offset + config.lengthSize <= chunk.length) {
    let nalSize = 0;
    for (let i = 0; i < config.lengthSize; i++) {
      nalSize = (nalSize << 8) | chunk[offset + i];
    }
    offset += config.lengthSize;

    if (nalSize <= 0 || offset + nalSize > chunk.length) {
      break;
    }

    nalUnits.push({ offset, size: nalSize });
    totalSize += 4 + nalSize; // START_CODE + NAL data
    offset += nalSize;
  }

  if (totalSize === 0) {
    return Buffer.from(chunk);
  }

  // Second pass: allocate single buffer and copy data
  const result = Buffer.allocUnsafe(totalSize);
  let writeOffset = 0;

  if (includeParameterSets) {
    for (const nal of config.vps) {
      result.set(START_CODE, writeOffset);
      writeOffset += 4;
      result.set(nal, writeOffset);
      writeOffset += nal.length;
    }
    for (const nal of config.sps) {
      result.set(START_CODE, writeOffset);
      writeOffset += 4;
      result.set(nal, writeOffset);
      writeOffset += nal.length;
    }
    for (const nal of config.pps) {
      result.set(START_CODE, writeOffset);
      writeOffset += 4;
      result.set(nal, writeOffset);
      writeOffset += nal.length;
    }
  }

  for (const unit of nalUnits) {
    result.set(START_CODE, writeOffset);
    writeOffset += 4;
    result.set(chunk.subarray(unit.offset, unit.offset + unit.size), writeOffset);
    writeOffset += unit.size;
  }

  return result;
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

export function splitHevcAnnexBNals(data: Uint8Array): Uint8Array[] {
  const units: Uint8Array[] = [];
  let offset = 0;
  let unitStart = -1;

  while (offset < data.length) {
    const scLen = getStartCodeLength(data, offset);
    if (scLen > 0) {
      if (unitStart >= 0 && unitStart < offset) {
        const unit = data.subarray(unitStart, offset);
        if (unit.length > 0) {
          units.push(unit);
        }
      }
      offset += scLen;
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

export function extractHevcParameterSetsFromAnnexB(
  data: Uint8Array
): { vps: Uint8Array[]; sps: Uint8Array[]; pps: Uint8Array[] } {
  const vps: Uint8Array[] = [];
  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];
  const seen = new Set<string>();

  const units = splitHevcAnnexBNals(data);
  for (const unit of units) {
    if (unit.length === 0) continue;
    const nalType = (unit[0] >> 1) & 0x3f;
    const key = `${nalType}:${unit.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (nalType === 32) {
      vps.push(unit);
    } else if (nalType === 33) {
      sps.push(unit);
    } else if (nalType === 34) {
      pps.push(unit);
    }
  }

  return { vps, sps, pps };
}

export function convertAnnexBToHvcc(data: Uint8Array, lengthSize: number = 4): Buffer {
  const units = splitHevcAnnexBNals(data);
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
      lengthBuffer.writeUIntBE(unit.length, 0, 3);
    }
    parts.push(lengthBuffer, Buffer.from(unit));
  }

  return Buffer.concat(parts);
}

export function buildHvccDecoderConfig(
  vpsList: Uint8Array[],
  spsList: Uint8Array[],
  ppsList: Uint8Array[],
  lengthSize: number = 4
): Uint8Array {
  if (spsList.length === 0) {
    throw new Error('At least one SPS is required to build HEVC config');
  }

  const sanitizedLength = Math.min(Math.max(lengthSize, 1), 4);
  const arrays = [
    { nalType: 32, units: vpsList },
    { nalType: 33, units: spsList },
    { nalType: 34, units: ppsList },
  ].filter(arr => arr.units.length > 0);

  let size = 23;
  for (const arr of arrays) {
    size += 3; // array header + numNalus
    for (const unit of arr.units) {
      size += 2 + unit.length;
    }
  }

  const buffer = Buffer.alloc(size);
  let offset = 0;

  const generalProfileIdc = 1; // Main profile
  const generalTierFlag = 0;
  const generalProfileSpace = 0;
  const generalLevelIdc = 120; // level 4.0

  buffer[offset++] = 1; // configurationVersion
  buffer[offset++] = (generalProfileSpace << 6) | (generalTierFlag << 5) | (generalProfileIdc & 0x1f);
  buffer.writeUInt32BE(0, offset); // general_profile_compatibility_flags
  offset += 4;
  buffer.writeUIntBE(0, offset, 6); // general_constraint_indicator_flags
  offset += 6;
  buffer[offset++] = generalLevelIdc;
  buffer[offset++] = 0xF0; // reserved + min_spatial_segmentation_idc (MSB)
  buffer[offset++] = 0x00; // min_spatial_segmentation_idc (LSB)
  buffer[offset++] = 0xFC; // reserved + parallelismType
  buffer[offset++] = 0xFC | 1; // reserved + chroma_format_idc (4:2:0)
  buffer[offset++] = 0xF8; // reserved + bit_depth_luma_minus8
  buffer[offset++] = 0xF8; // reserved + bit_depth_chroma_minus8
  buffer.writeUInt16BE(0, offset); // avgFrameRate
  offset += 2;

  const constantFrameRate = 0;
  const numTemporalLayers = 0;
  const temporalIdNested = 1;
  buffer[offset++] =
    ((constantFrameRate & 0x03) << 6) |
    ((numTemporalLayers & 0x07) << 3) |
    ((temporalIdNested ? 1 : 0) << 2) |
    ((sanitizedLength - 1) & 0x03);

  buffer[offset++] = arrays.length;

  for (const arr of arrays) {
    buffer[offset++] = 0x80 | (arr.nalType & 0x3f); // array_completeness + reserved + type
    buffer.writeUInt16BE(arr.units.length, offset);
    offset += 2;

    for (const unit of arr.units) {
      buffer.writeUInt16BE(unit.length, offset);
      offset += 2;
      Buffer.from(unit).copy(buffer, offset);
      offset += unit.length;
    }
  }

  return new Uint8Array(buffer);
}

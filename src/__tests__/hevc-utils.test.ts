import { Buffer } from 'buffer';
import {
  convertHvccToAnnexB,
  parseHvccDecoderConfig,
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
} from '../utils/hevc.js';

describe('HEVC utilities', () => {
  // Minimal HVCC record with single VPS/SPS/PPS
  const hvcc = new Uint8Array([
    0x01, 0x01, 0x60, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xFC, 0xFD, // lengthSizeMinusOne in byte 21 (0xFD & 3 = 1 => size 2)
    0x03, // numOfArrays
    // VPS array
    0x80 | 32, // completeness + nal type
    0x00, 0x01, // numNalus
    0x00, 0x04, // nal length
    0x40, 0x01, 0x02, 0x03,
    // SPS array
    0x80 | 33,
    0x00, 0x01,
    0x00, 0x05,
    0x42, 0x01, 0x02, 0x03, 0x04,
    // PPS array
    0x80 | 34,
    0x00, 0x01,
    0x00, 0x02,
    0x44, 0x55,
  ]);

  it('parses HVCC record', () => {
    const config = parseHvccDecoderConfig(hvcc);
    expect(config.lengthSize).toBe(2);
    expect(config.vps).toHaveLength(1);
    expect(config.sps).toHaveLength(1);
    expect(config.pps).toHaveLength(1);
    expect(Array.from(config.vps[0])).toEqual([0x40, 0x01, 0x02, 0x03]);
  });

  it('converts HVCC samples to Annex B', () => {
    const config = parseHvccDecoderConfig(hvcc);
    const chunk = new Uint8Array([
      0x00, 0x03, 0x26, 0x27, 0x28, // NAL length 3 + payload
      0x00, 0x02, 0x01, 0x02,       // NAL length 2 + payload
    ]);

    const annex = convertHvccToAnnexB(chunk, config, true);
    const expected = Buffer.concat([
      Buffer.from([0, 0, 0, 1, 0x40, 0x01, 0x02, 0x03]),
      Buffer.from([0, 0, 0, 1, 0x42, 0x01, 0x02, 0x03, 0x04]),
      Buffer.from([0, 0, 0, 1, 0x44, 0x55]),
      Buffer.from([0, 0, 0, 1, 0x26, 0x27, 0x28]),
      Buffer.from([0, 0, 0, 1, 0x01, 0x02]),
    ]);

    expect(annex.equals(expected)).toBe(true);
  });

  it('extracts HEVC parameter sets from Annex B', () => {
    const annex = new Uint8Array([
      0, 0, 0, 1, 0x40, 0x01, 0x02,
      0, 0, 0, 1, 0x42, 0x01, 0x02, 0x03,
      0, 0, 0, 1, 0x44, 0x55,
    ]);
    const sets = extractHevcParameterSetsFromAnnexB(annex);
    expect(sets.vps).toHaveLength(1);
    expect(sets.sps).toHaveLength(1);
    expect(sets.pps).toHaveLength(1);
    const hvcc = buildHvccDecoderConfig(sets.vps, sets.sps, sets.pps);
    const parsed = parseHvccDecoderConfig(hvcc);
    expect(parsed.vps).toHaveLength(1);
    expect(parsed.sps).toHaveLength(1);
    expect(parsed.pps).toHaveLength(1);
  });

  it('converts Annex B frames to HVCC length-prefixed payloads', () => {
    const annex = new Uint8Array([
      0, 0, 0, 1, 0x26, 0x27, 0x28,
      0, 0, 1, 0x02, 0x03,
    ]);
    const result = convertAnnexBToHvcc(annex, 4);
    expect(result.equals(Buffer.from([
      0, 0, 0, 3, 0x26, 0x27, 0x28,
      0, 0, 0, 2, 0x02, 0x03,
    ]))).toBe(true);
  });
});

import { Buffer } from 'buffer';
import {
  convertAvccToAnnexB,
  parseAvcDecoderConfig,
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
} from '../utils/avc.js';

describe('AVC utilities', () => {
  const avcConfigBytes = new Uint8Array([
    0x01,       // configurationVersion
    0x64, 0x00, 0x1F, // profile/compatibility/level
    0xFF,       // reserved + lengthSizeMinusOne (3 => 4 bytes)
    0xE1,       // numOfSequenceParameterSets (1)
    0x00, 0x04, // SPS length
    0x67, 0x64, 0x00, 0x1F, // SPS data
    0x01,       // numOfPictureParameterSets (1)
    0x00, 0x03, // PPS length
    0x68, 0xEE, 0x3C, // PPS data
  ]);

  it('parses AVC decoder configuration record', () => {
    const config = parseAvcDecoderConfig(avcConfigBytes);
    expect(config.lengthSize).toBe(4);
    expect(config.sps).toHaveLength(1);
    expect(Array.from(config.sps[0])).toEqual([0x67, 0x64, 0x00, 0x1F]);
    expect(config.pps).toHaveLength(1);
    expect(Array.from(config.pps[0])).toEqual([0x68, 0xEE, 0x3C]);
  });

  it('converts avcC samples to Annex B with parameter sets', () => {
    const config = parseAvcDecoderConfig(avcConfigBytes);
    const chunk = new Uint8Array([
      0x00, 0x00, 0x00, 0x02, 0x65, 0x88, // IDR NAL length 2 + payload
      0x00, 0x00, 0x00, 0x01, 0x06,       // SEI NAL length 1 + payload
    ]);

    const annexB = convertAvccToAnnexB(chunk, config, true);
    const expected = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1F]),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x68, 0xEE, 0x3C]),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x06]),
    ]);

    expect(annexB.equals(expected)).toBe(true);
  });

  it('extracts parameter sets from Annex B frame and rebuilds config', () => {
    const annexB = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1F,
      0x00, 0x00, 0x00, 0x01, 0x68, 0xEE, 0x3C,
    ]);
    const { sps, pps } = extractAvcParameterSetsFromAnnexB(annexB);
    expect(sps).toHaveLength(1);
    expect(pps).toHaveLength(1);
    const config = buildAvcDecoderConfig(sps, pps);
    const parsed = parseAvcDecoderConfig(config);
    expect(parsed.sps).toHaveLength(1);
    expect(parsed.pps).toHaveLength(1);
  });

  it('converts Annex B frames to AVCC', () => {
    const annexB = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x99,
      0x00, 0x00, 0x01, 0x06, 0x11,
    ]);
    const avcc = convertAnnexBToAvcc(annexB, 4);
    expect(avcc.equals(Buffer.from([
      0x00, 0x00, 0x00, 0x03, 0x65, 0x88, 0x99,
      0x00, 0x00, 0x00, 0x02, 0x06, 0x11,
    ]))).toBe(true);
  });
});

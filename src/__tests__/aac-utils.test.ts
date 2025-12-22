import { Buffer } from 'buffer';
import {
  parseAudioSpecificConfig,
  wrapAacFrameWithAdts,
  buildAudioSpecificConfig,
} from '../utils/aac.js';

describe('AAC utilities', () => {
  // Example AudioSpecificConfig: AAC LC, 44100 Hz, stereo (from mp4a.40.2)
  const asc = new Uint8Array([0x12, 0x10]);

  it('parses AudioSpecificConfig', () => {
    const config = parseAudioSpecificConfig(asc);
    expect(config.audioObjectType).toBe(2);
    expect(config.samplingFrequencyIndex).toBe(4);
    expect(config.samplingRate).toBe(44100);
    expect(config.channelConfiguration).toBe(2);
  });

  it('wraps AAC frame in ADTS header', () => {
    const config = parseAudioSpecificConfig(asc);
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const adtsFrame = wrapAacFrameWithAdts(payload, config);

    expect(adtsFrame.length).toBe(11);
    // Sync word 0xFFF
    expect(adtsFrame[0]).toBe(0xff);
    expect(adtsFrame[1] & 0xf0).toBe(0xf0);
    // Frame length field should match header length + payload
    const frameLength = ((adtsFrame[3] & 0x3) << 11) |
                        (adtsFrame[4] << 3) |
                        ((adtsFrame[5] >> 5) & 0x7);
    expect(frameLength).toBe(11);
    // Payload preserved at the end
    expect(adtsFrame.subarray(7).equals(Buffer.from(payload))).toBe(true);
  });

  it('builds AudioSpecificConfig', () => {
    const config = buildAudioSpecificConfig({
      samplingRate: 44100,
      channelConfiguration: 2,
    });
    expect(Array.from(config)).toEqual([0x12, 0x10]);
  });
});

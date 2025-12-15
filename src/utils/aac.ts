/**
 * AAC (AudioSpecificConfig) parsing and ADTS framing utilities.
 */

export interface AacConfig {
  audioObjectType: number;
  samplingFrequencyIndex: number;
  samplingRate: number;
  channelConfiguration: number;
}

export const SAMPLING_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000,
  24000, 22050, 16000, 12000, 11025, 8000,
  7350,
];

/**
 * Parse the AudioSpecificConfig (ISO/IEC 14496-3) blob passed via
 * AudioDecoderConfig.description for codecs like mp4a.40.*.
 */
export function parseAudioSpecificConfig(data: Uint8Array): AacConfig {
  if (data.length < 2) {
    throw new Error('Invalid AudioSpecificConfig: too short');
  }

  let bitOffset = 0;

  const readBits = (numBits: number): number => {
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      const byteOffset = (bitOffset + i) >> 3;
      const bitInByte = 7 - ((bitOffset + i) & 7);
      if (byteOffset >= data.length) {
        throw new Error('Invalid AudioSpecificConfig: read past end');
      }
      value = (value << 1) | ((data[byteOffset] >> bitInByte) & 1);
    }
    bitOffset += numBits;
    return value;
  };

  let audioObjectType = readBits(5);
  if (audioObjectType === 31) {
    audioObjectType = 32 + readBits(6);
  }

  let samplingFrequencyIndex = readBits(4);
  let samplingRate: number;

  if (samplingFrequencyIndex === 0xf) {
    samplingRate = readBits(24);
  } else {
    samplingRate = SAMPLING_RATES[samplingFrequencyIndex] ?? 0;
  }

  const channelConfiguration = readBits(4);

  return {
    audioObjectType,
    samplingFrequencyIndex,
    samplingRate,
    channelConfiguration,
  };
}

/**
 * Wrap a raw AAC frame with an ADTS header using the parsed config.
 */
export function wrapAacFrameWithAdts(data: Uint8Array, config: AacConfig): Buffer {
  const adtsHeader = Buffer.alloc(7);
  const frameLength = data.length + adtsHeader.length;

  const profile = (config.audioObjectType === 0 ? 1 : config.audioObjectType) - 1;
  const freqIdx = config.samplingFrequencyIndex & 0xf;
  const chanCfg = config.channelConfiguration & 0x7;

  adtsHeader[0] = 0xff;
  adtsHeader[1] = 0xf1; // Sync word, MPEG-4, layer 0, protection absent
  adtsHeader[2] = ((profile & 0x3) << 6) | ((freqIdx & 0xf) << 2) | ((chanCfg >> 2) & 0x1);
  adtsHeader[3] = ((chanCfg & 0x3) << 6) | ((frameLength >> 11) & 0x3);
  adtsHeader[4] = (frameLength >> 3) & 0xff;
  adtsHeader[5] = ((frameLength & 0x7) << 5) | 0x1f;
  adtsHeader[6] = 0xfc;

  return Buffer.concat([adtsHeader, Buffer.from(data)]);
}

export function buildAudioSpecificConfig(params: {
  audioObjectType?: number;
  samplingRate: number;
  channelConfiguration: number;
}): Uint8Array {
  const writer = new BitWriter();
  const audioObjectType = params.audioObjectType ?? 2;

  if (audioObjectType >= 32) {
    writer.write(31, 5);
    writer.write(audioObjectType - 32, 6);
  } else {
    writer.write(audioObjectType, 5);
  }

  let samplingFrequencyIndex = SAMPLING_RATES.indexOf(params.samplingRate);
  if (samplingFrequencyIndex < 0) {
    samplingFrequencyIndex = 0xf;
  }

  writer.write(samplingFrequencyIndex, 4);
  if (samplingFrequencyIndex === 0xf) {
    writer.write(params.samplingRate, 24);
  }

  writer.write(params.channelConfiguration & 0x0f, 4);
  // frameLengthFlag, dependsOnCoreCoder, extensionFlag
  writer.write(0, 3);

  return writer.toUint8Array();
}

class BitWriter {
  private buffer = 0;
  private bits = 0;
  private out: number[] = [];

  write(value: number, numBits: number): void {
    for (let i = numBits - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      this.buffer = (this.buffer << 1) | bit;
      this.bits++;
      if (this.bits === 8) {
        this.out.push(this.buffer & 0xff);
        this.buffer = 0;
        this.bits = 0;
      }
    }
  }

  toUint8Array(): Uint8Array {
    if (this.bits > 0) {
      this.buffer <<= (8 - this.bits);
      this.out.push(this.buffer & 0xff);
      this.buffer = 0;
      this.bits = 0;
    }
    return new Uint8Array(this.out);
  }
}

export function stripAdtsHeader(frame: Uint8Array): Uint8Array {
  if (frame.length < 7) {
    return frame;
  }

  // Verify ADTS sync word (0xFFF) before stripping
  // ADTS sync: first 12 bits are all 1s (0xFF followed by 0xFx)
  if (frame[0] !== 0xff || (frame[1] & 0xf0) !== 0xf0) {
    // Not ADTS format - return as-is (already raw AAC)
    return frame;
  }

  const protectionAbsent = frame[1] & 0x01;
  const headerLength = protectionAbsent ? 7 : 9;
  if (frame.length <= headerLength) {
    return new Uint8Array(0);
  }
  return frame.subarray(headerLength);
}

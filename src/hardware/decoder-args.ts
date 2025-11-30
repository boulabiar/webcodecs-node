/**
 * Hardware decoder argument building
 *
 * Functions for selecting the best decoder and building FFmpeg arguments
 * for hardware-accelerated decoding.
 */

import type {
  HardwareAccelerationMethod,
  HardwareCapabilities,
  VideoCodecName,
} from './types.js';
import {
  detectHardwareAcceleration,
  detectHardwareAccelerationSync,
} from './detection.js';

/**
 * Get the best available decoder for a codec
 */
export async function getBestDecoder(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): Promise<{ decoder: string | null; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean }> {
  const capabilities = await detectHardwareAcceleration();
  return selectBestDecoder(capabilities, codec, preference);
}

export function getBestDecoderSync(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): { decoder: string | null; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  const capabilities = detectHardwareAccelerationSync();
  return selectBestDecoder(capabilities, codec, preference);
}

function selectBestDecoder(
  capabilities: HardwareCapabilities,
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference'
): { decoder: string | null; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  if (preference === 'prefer-software') {
    return {
      decoder: null, // Use default FFmpeg decoder
      hwaccel: null,
      isHardware: false,
    };
  }

  // First check if VAAPI is available - it's the most reliable on Linux
  // VAAPI uses -hwaccel vaapi flag, not a specific decoder name
  if (capabilities.methods.includes('vaapi')) {
    return {
      decoder: null,
      hwaccel: 'vaapi',
      isHardware: true,
    };
  }

  // Find available hardware decoders for this codec, sorted by priority
  const hwDecoders = capabilities.decoders
    .filter(dec => dec.codec === codec && dec.available)
    .sort((a, b) => a.priority - b.priority);

  if (hwDecoders.length > 0) {
    const best = hwDecoders[0];
    return {
      decoder: best.name,
      hwaccel: best.hwaccel,
      isHardware: true,
    };
  }

  // Fall back to software
  return {
    decoder: null,
    hwaccel: null,
    isHardware: false,
  };
}

/**
 * Get FFmpeg arguments for hardware-accelerated decoding
 */
export function getDecoderArgs(
  decoder: string | null,
  hwaccel: HardwareAccelerationMethod | null
): string[] {
  const args: string[] = [];

  if (hwaccel === 'vaapi') {
    args.push('-hwaccel', 'vaapi');
    args.push('-vaapi_device', '/dev/dri/renderD128');
    args.push('-hwaccel_output_format', 'vaapi');
  } else if (hwaccel === 'cuda') {
    args.push('-hwaccel', 'cuda');
    args.push('-hwaccel_output_format', 'cuda');
    if (decoder) {
      args.push('-c:v', decoder);
    }
  } else if (hwaccel === 'qsv') {
    args.push('-hwaccel', 'qsv');
    args.push('-hwaccel_output_format', 'qsv');
    if (decoder) {
      args.push('-c:v', decoder);
    }
  } else if (decoder) {
    args.push('-c:v', decoder);
  }

  return args;
}

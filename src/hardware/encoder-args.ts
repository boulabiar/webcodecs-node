/**
 * Hardware encoder argument building
 *
 * Functions for selecting the best encoder and building FFmpeg arguments
 * for hardware-accelerated encoding.
 */

import { spawn } from 'child_process';
import type {
  HardwareAccelerationMethod,
  HardwareCapabilities,
  VideoCodecName,
} from './types.js';
import { SOFTWARE_ENCODERS } from './types.js';
import {
  detectHardwareAcceleration,
  detectHardwareAccelerationSync,
} from './detection.js';

/**
 * Get the best available encoder for a codec
 */
export async function getBestEncoder(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): Promise<{ encoder: string; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean }> {
  const capabilities = await detectHardwareAcceleration();
  return selectBestEncoder(capabilities, codec, preference);
}

export function getBestEncoderSync(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): { encoder: string; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  const capabilities = detectHardwareAccelerationSync();
  return selectBestEncoder(capabilities, codec, preference);
}

function selectBestEncoder(
  capabilities: HardwareCapabilities,
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference'
): { encoder: string; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  if (preference === 'prefer-software') {
    return {
      encoder: SOFTWARE_ENCODERS[codec],
      hwaccel: null,
      isHardware: false,
    };
  }

  // Find available hardware encoders for this codec, sorted by priority
  const hwEncoders = capabilities.encoders
    .filter(enc => enc.codec === codec && enc.available)
    .sort((a, b) => a.priority - b.priority);

  if (hwEncoders.length > 0) {
    const best = hwEncoders[0];
    return {
      encoder: best.name,
      hwaccel: best.hwaccel,
      isHardware: true,
    };
  }

  // Fall back to software
  return {
    encoder: SOFTWARE_ENCODERS[codec],
    hwaccel: null,
    isHardware: false,
  };
}

/**
 * Get FFmpeg arguments for hardware-accelerated encoding
 */
export function getEncoderArgs(
  encoder: string,
  hwaccel: HardwareAccelerationMethod | null,
  options: {
    bitrate?: number;
    quality?: number;
    preset?: string;
  } = {}
): string[] {
  const args: string[] = [];

  // Add hwaccel-specific input/filter options
  if (hwaccel === 'vaapi') {
    // VAAPI needs format conversion and upload
    args.push('-vaapi_device', '/dev/dri/renderD128');
    args.push('-vf', 'format=nv12,hwupload');
  } else if (hwaccel === 'cuda' || hwaccel === 'nvenc') {
    // NVENC can use CUDA for upload
    args.push('-hwaccel', 'cuda');
    args.push('-hwaccel_output_format', 'cuda');
  } else if (hwaccel === 'qsv') {
    args.push('-hwaccel', 'qsv');
    args.push('-hwaccel_output_format', 'qsv');
  }

  // Encoder selection
  args.push('-c:v', encoder);

  // Encoder-specific options
  if (encoder.includes('nvenc')) {
    if (options.preset) {
      args.push('-preset', options.preset);
    } else {
      args.push('-preset', 'p4'); // Balanced preset
    }
    if (options.bitrate) {
      args.push('-b:v', String(options.bitrate));
    }
    if (options.quality !== undefined) {
      args.push('-cq', String(options.quality));
    }
  } else if (encoder.includes('qsv')) {
    if (options.preset) {
      args.push('-preset', options.preset);
    }
    if (options.bitrate) {
      args.push('-b:v', String(options.bitrate));
    }
    if (options.quality !== undefined) {
      args.push('-global_quality', String(options.quality));
    }
  } else if (encoder.includes('vaapi')) {
    if (options.bitrate) {
      args.push('-b:v', String(options.bitrate));
    }
    if (options.quality !== undefined) {
      // VAAPI uses rc_mode and quality
      args.push('-rc_mode', 'CQP');
      args.push('-qp', String(options.quality));
    }
  } else if (encoder.includes('videotoolbox')) {
    if (options.bitrate) {
      args.push('-b:v', String(options.bitrate));
    }
    if (options.quality !== undefined) {
      args.push('-q:v', String(options.quality));
    }
  }

  return args;
}

/**
 * Test if a specific hardware encoder actually works
 * (Some systems report encoders as available but they may not function)
 */
export async function testEncoder(encoderName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const testArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=64x64:d=0.1',
      '-c:v', encoderName,
      '-frames:v', '1',
      '-f', 'null',
      '-',
    ];

    // Add VAAPI device if needed
    if (encoderName.includes('vaapi')) {
      testArgs.splice(0, 0, '-vaapi_device', '/dev/dri/renderD128');
      // Insert filter before output options
      const outputIdx = testArgs.indexOf('-c:v');
      testArgs.splice(outputIdx, 0, '-vf', 'format=nv12,hwupload');
    }

    const proc = spawn('ffmpeg', testArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let hasError = false;
    proc.stderr?.on('data', () => {
      hasError = true;
    });

    proc.on('close', (code) => {
      resolve(code === 0 && !hasError);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Map WebCodecs codec string to VideoCodecName
 */
export function parseCodecString(webCodecsCodec: string): VideoCodecName | null {
  const codecBase = webCodecsCodec.split('.')[0].toLowerCase();

  const codecMap: Record<string, VideoCodecName> = {
    'avc1': 'h264',
    'avc3': 'h264',
    'hev1': 'hevc',
    'hvc1': 'hevc',
    'vp8': 'vp8',
    'vp09': 'vp9',
    'vp9': 'vp9',
    'av01': 'av1',
    'av1': 'av1',
  };

  return codecMap[codecBase] || null;
}

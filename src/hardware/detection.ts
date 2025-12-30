/**
 * Hardware acceleration detection
 *
 * Detects available hardware acceleration methods, encoders, and decoders
 * using node-av native bindings for better performance.
 */

import { HardwareContext } from 'node-av/api';
import { createLogger } from '../utils/logger.js';
import type {
  HardwareAccelerationMethod,
  HardwareCapabilities,
} from './types.js';
import { HARDWARE_ENCODERS, HARDWARE_DECODERS } from './types.js';

const logger = createLogger('HardwareAcceleration');

// Cached capabilities
let cachedCapabilities: HardwareCapabilities | null = null;

// Map node-av device types to our HardwareAccelerationMethod
const DEVICE_TYPE_MAP: Record<string, HardwareAccelerationMethod> = {
  'vaapi': 'vaapi',
  'cuda': 'cuda',
  'qsv': 'qsv',
  'videotoolbox': 'videotoolbox',
  'drm': 'drm',
  'v4l2m2m': 'v4l2m2m',
};

// Additional methods implied by detected hardware
// When CUDA is available, NVENC (encoder) and NVDEC (decoder) are also available
const IMPLIED_METHODS: Record<HardwareAccelerationMethod, HardwareAccelerationMethod[]> = {
  'cuda': ['nvenc', 'nvdec'],
  'vaapi': [],
  'qsv': [],
  'videotoolbox': [],
  'drm': [],
  'v4l2m2m': [],
  'none': [],
  'nvenc': [],
  'nvdec': [],
};

function collectHwaccels(): HardwareAccelerationMethod[] {
  try {
    const available = HardwareContext.listAvailable();
    const methods: HardwareAccelerationMethod[] = [];

    for (const deviceType of available) {
      const mapped = DEVICE_TYPE_MAP[deviceType];
      if (mapped) {
        // Verify the hardware context can actually be created at runtime
        // listAvailable() returns compile-time support, not runtime availability
        let ctx: ReturnType<typeof HardwareContext.create> | null = null;
        try {
          ctx = HardwareContext.create(deviceType as Parameters<typeof HardwareContext.create>[0]);
          if (!ctx) continue; // Context creation failed - skip this method
          // Context created successfully - this hardware is actually available
        } catch {
          // Context creation threw - hardware not actually available
          continue;
        } finally {
          // Clean up the test context to avoid resource leaks
          if (ctx && typeof (ctx as any).dispose === 'function') {
            (ctx as any).dispose();
          }
        }

        methods.push(mapped);
        // Add implied methods (e.g., CUDA implies NVENC/NVDEC)
        const implied = IMPLIED_METHODS[mapped];
        for (const impliedMethod of implied) {
          if (!methods.includes(impliedMethod)) {
            methods.push(impliedMethod);
          }
        }
      }
    }

    return methods;
  } catch {
    return [];
  }
}

function collectEncoders(): string[] {
  try {
    const encoders: string[] = [];
    const hw = HardwareContext.auto();

    if (hw) {
      const supportedCodecs = hw.findSupportedCodecs();
      // Filter for encoder codecs (typically ending with the hwaccel suffix)
      for (const codec of supportedCodecs) {
        encoders.push(codec);
      }
      hw.dispose();
    }

    // Also include standard software encoders
    const softwareEncoders = [
      'libx264', 'libx265', 'libvpx', 'libvpx-vp9',
      'libaom-av1', 'libsvtav1', 'aac', 'libopus',
    ];
    for (const enc of softwareEncoders) {
      if (!encoders.includes(enc)) {
        encoders.push(enc);
      }
    }

    return encoders;
  } catch {
    // Return software encoders as fallback
    return ['libx264', 'libx265', 'libvpx', 'libvpx-vp9', 'libaom-av1'];
  }
}

function collectDecoders(): string[] {
  try {
    const decoders: string[] = [];
    const hw = HardwareContext.auto();

    if (hw) {
      const supportedCodecs = hw.findSupportedCodecs();
      // Hardware decoders from node-av
      for (const codec of supportedCodecs) {
        decoders.push(codec);
      }
      hw.dispose();
    }

    // Also include standard software decoders
    const softwareDecoders = [
      'h264', 'hevc', 'vp8', 'vp9', 'av1',
      'aac', 'opus', 'mp3', 'flac',
    ];
    for (const dec of softwareDecoders) {
      if (!decoders.includes(dec)) {
        decoders.push(dec);
      }
    }

    return decoders;
  } catch {
    // Return software decoders as fallback
    return ['h264', 'hevc', 'vp8', 'vp9', 'av1'];
  }
}

function buildCapabilities(): HardwareCapabilities {
  const capabilities: HardwareCapabilities = {
    methods: [],
    encoders: [],
    decoders: [],
    detected: false,
  };

  try {
    const hwaccels = collectHwaccels();
    capabilities.methods = hwaccels;

    const availableEncoders = collectEncoders();
    // Note: collectEncoders returns codec names (e.g., 'h264') not encoder names (e.g., 'h264_vaapi')
    // So we need to check if the hwaccel method is available AND the codec is supported
    capabilities.encoders = HARDWARE_ENCODERS.map(enc => ({
      ...enc,
      available: hwaccels.includes(enc.hwaccel) && availableEncoders.includes(enc.codec),
    }));

    const availableDecoders = collectDecoders();
    // Same for decoders - check hwaccel method AND codec support
    capabilities.decoders = HARDWARE_DECODERS.map(dec => ({
      ...dec,
      available: hwaccels.includes(dec.hwaccel) && availableDecoders.includes(dec.codec),
    }));

    capabilities.detected = true;
    cachedCapabilities = capabilities;
  } catch (error) {
    logger.error('Failed to detect hardware acceleration', { error });
  }

  return capabilities;
}

/**
 * Detect available hardware acceleration methods (asynchronously)
 */
export async function detectHardwareAcceleration(): Promise<HardwareCapabilities> {
  return detectHardwareAccelerationSync();
}

/**
 * Detect available hardware acceleration methods synchronously
 */
export function detectHardwareAccelerationSync(): HardwareCapabilities {
  if (cachedCapabilities?.detected) {
    return cachedCapabilities;
  }
  return buildCapabilities();
}

/**
 * Get list of hardware acceleration methods from FFmpeg
 */
export async function getFFmpegHwaccels(): Promise<HardwareAccelerationMethod[]> {
  return collectHwaccels();
}

export function getFFmpegHwaccelsSync(): HardwareAccelerationMethod[] {
  return collectHwaccels();
}

/**
 * Get list of available encoders from FFmpeg
 */
export async function getFFmpegEncoders(): Promise<string[]> {
  return collectEncoders();
}

export function getFFmpegEncodersSync(): string[] {
  return collectEncoders();
}

/**
 * Get list of available decoders from FFmpeg
 */
export async function getFFmpegDecoders(): Promise<string[]> {
  return collectDecoders();
}

export function getFFmpegDecodersSync(): string[] {
  return collectDecoders();
}

/**
 * Get a summary of available hardware acceleration
 */
export async function getHardwareAccelerationSummary(): Promise<string> {
  const capabilities = await detectHardwareAcceleration();

  const lines: string[] = [
    'Hardware Acceleration Support:',
    `  Methods: ${capabilities.methods.length > 0 ? capabilities.methods.join(', ') : 'none'}`,
    '',
    'Available Hardware Encoders:',
  ];

  const availableEncoders = capabilities.encoders.filter(e => e.available);
  if (availableEncoders.length > 0) {
    for (const enc of availableEncoders) {
      lines.push(`  ${enc.name} (${enc.codec}, ${enc.hwaccel})`);
    }
  } else {
    lines.push('  none');
  }

  lines.push('');
  lines.push('Available Hardware Decoders:');

  const availableDecoders = capabilities.decoders.filter(d => d.available);
  if (availableDecoders.length > 0) {
    for (const dec of availableDecoders) {
      lines.push(`  ${dec.name} (${dec.codec}, ${dec.hwaccel})`);
    }
  } else {
    lines.push('  none');
  }

  return lines.join('\n');
}

/**
 * Clear cached capabilities (for testing or after hardware changes)
 */
export function clearCapabilitiesCache(): void {
  cachedCapabilities = null;
}

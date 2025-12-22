/**
 * Hardware acceleration detection
 *
 * Detects available hardware acceleration methods, encoders, and decoders
 * by querying FFmpeg capabilities.
 */

import { execSync } from 'child_process';
import { createLogger } from '../utils/logger.js';
import type {
  HardwareAccelerationMethod,
  HardwareCapabilities,
} from './types.js';
import { HARDWARE_ENCODERS, HARDWARE_DECODERS } from './types.js';

const logger = createLogger('HardwareAcceleration');

// Cached capabilities
let cachedCapabilities: HardwareCapabilities | null = null;

function collectHwaccels(): HardwareAccelerationMethod[] {
  try {
    const output = execSync('ffmpeg -hwaccels 2>&1', { encoding: 'utf8' });
    const lines = output.split('\n');
    const methods: HardwareAccelerationMethod[] = [];

    let startParsing = false;
    for (const line of lines) {
      if (line.includes('Hardware acceleration methods:')) {
        startParsing = true;
        continue;
      }
      if (startParsing && line.trim()) {
        const method = line.trim() as HardwareAccelerationMethod;
        if (['vaapi', 'cuda', 'qsv', 'videotoolbox', 'drm', 'v4l2m2m'].includes(method)) {
          methods.push(method);
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
    const output = execSync('ffmpeg -encoders 2>&1', { encoding: 'utf8' });
    const encoders: string[] = [];

    for (const line of output.split('\n')) {
      const match = line.match(/^\s*V[.\w]+\s+(\S+)/);
      if (match) {
        encoders.push(match[1]);
      }
    }

    return encoders;
  } catch {
    return [];
  }
}

function collectDecoders(): string[] {
  try {
    const output = execSync('ffmpeg -decoders 2>&1', { encoding: 'utf8' });
    const decoders: string[] = [];

    for (const line of output.split('\n')) {
      const match = line.match(/^\s*V[.\w]+\s+(\S+)/);
      if (match) {
        decoders.push(match[1]);
      }
    }

    return decoders;
  } catch {
    return [];
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
    capabilities.encoders = HARDWARE_ENCODERS.map(enc => ({
      ...enc,
      available: availableEncoders.includes(enc.name),
    }));

    const availableDecoders = collectDecoders();
    capabilities.decoders = HARDWARE_DECODERS.map(dec => ({
      ...dec,
      available: availableDecoders.includes(dec.name),
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

/**
 * Codec-specific configurations and utilities
 */

import {
  getH264Args as _getH264Args,
  parseH264CodecString as _parseH264CodecString,
  type H264EncoderOptions,
} from './h264.js';

import {
  getHEVCArgs as _getHEVCArgs,
  parseHEVCCodecString as _parseHEVCCodecString,
  type HEVCEncoderOptions,
} from './hevc.js';

import {
  getVP9Args as _getVP9Args,
  parseVP9CodecString as _parseVP9CodecString,
  type VP9EncoderOptions,
} from './vp9.js';

import {
  getAV1Args as _getAV1Args,
  parseAV1CodecString as _parseAV1CodecString,
  type AV1EncoderOptions,
} from './av1.js';

// H.264/AVC
export {
  getH264Args,
  parseH264CodecString,
  generateH264CodecString,
  type H264EncoderOptions,
} from './h264.js';

// HEVC/H.265
export {
  getHEVCArgs,
  parseHEVCCodecString,
  generateHEVCCodecString,
  type HEVCEncoderOptions,
} from './hevc.js';

// VP9
export {
  getVP9Args,
  parseVP9CodecString,
  generateVP9CodecString,
  type VP9EncoderOptions,
} from './vp9.js';

// AV1
export {
  getAV1Args,
  parseAV1CodecString,
  generateAV1CodecString,
  type AV1EncoderOptions,
} from './av1.js';

/**
 * Get codec-specific FFmpeg arguments
 */
export function getCodecArgs(
  codec: string,
  isRealtime: boolean,
  options: Record<string, unknown> = {}
): string[] {
  const codecBase = codec.split('.')[0].toLowerCase();

  switch (codecBase) {
    case 'avc1':
    case 'avc3':
      return _getH264Args(options as H264EncoderOptions, isRealtime);
    case 'hev1':
    case 'hvc1':
      return _getHEVCArgs(options as HEVCEncoderOptions, isRealtime);
    case 'vp09':
    case 'vp9':
      return _getVP9Args(options as VP9EncoderOptions, isRealtime);
    case 'av01':
    case 'av1':
      return _getAV1Args(options as AV1EncoderOptions, isRealtime);
    default:
      return [];
  }
}

/**
 * Parse any codec string and return structured info
 */
export function parseCodecString(codec: string): {
  type: 'h264' | 'hevc' | 'vp9' | 'av1' | 'unknown';
  info: Record<string, unknown> | null;
} {
  const codecBase = codec.split('.')[0].toLowerCase();

  switch (codecBase) {
    case 'avc1':
    case 'avc3':
      return { type: 'h264', info: _parseH264CodecString(codec) };
    case 'hev1':
    case 'hvc1':
      return { type: 'hevc', info: _parseHEVCCodecString(codec) };
    case 'vp09':
    case 'vp9':
      return { type: 'vp9', info: _parseVP9CodecString(codec) };
    case 'av01':
    case 'av1':
      return { type: 'av1', info: _parseAV1CodecString(codec) };
    default:
      return { type: 'unknown', info: null };
  }
}

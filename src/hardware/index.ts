/**
 * Hardware acceleration utilities
 *
 * Provides hardware-accelerated video encoding/decoding support
 * for VAAPI (Linux), NVENC/NVDEC (NVIDIA), QSV (Intel), VideoToolbox (macOS)
 */

// Type definitions
export type {
  HardwareAccelerationMethod,
  VideoCodecName,
  HardwareEncoderInfo,
  HardwareDecoderInfo,
  HardwareCapabilities,
} from './types.js';

export {
  HARDWARE_ENCODERS,
  HARDWARE_DECODERS,
  SOFTWARE_ENCODERS,
} from './types.js';

// Detection functions
export {
  detectHardwareAcceleration,
  detectHardwareAccelerationSync,
  getFFmpegHwaccels,
  getFFmpegHwaccelsSync,
  getFFmpegEncoders,
  getFFmpegEncodersSync,
  getFFmpegDecoders,
  getFFmpegDecodersSync,
  getHardwareAccelerationSummary,
  clearCapabilitiesCache,
} from './detection.js';

// Encoder functions
export {
  getBestEncoder,
  getBestEncoderSync,
  getEncoderArgs,
  testEncoder,
  parseCodecString,
} from './encoder-args.js';

// Decoder functions
export {
  getBestDecoder,
  getBestDecoderSync,
  getDecoderArgs,
} from './decoder-args.js';

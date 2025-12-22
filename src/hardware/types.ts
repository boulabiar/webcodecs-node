/**
 * Hardware acceleration type definitions
 */

export type HardwareAccelerationMethod =
  | 'none'
  | 'vaapi'      // Linux (Intel/AMD/NVIDIA)
  | 'cuda'       // NVIDIA CUDA
  | 'nvenc'      // NVIDIA encoder
  | 'nvdec'      // NVIDIA decoder
  | 'qsv'        // Intel Quick Sync
  | 'videotoolbox' // macOS
  | 'v4l2m2m'    // Linux V4L2 (Raspberry Pi, etc.)
  | 'drm';       // Direct Rendering Manager

export type VideoCodecName = 'h264' | 'hevc' | 'vp8' | 'vp9' | 'av1';

export interface HardwareEncoderInfo {
  name: string;           // FFmpeg encoder name (e.g., 'h264_vaapi')
  hwaccel: HardwareAccelerationMethod;
  codec: VideoCodecName;
  available: boolean;
  priority: number;       // Lower = higher priority
}

export interface HardwareDecoderInfo {
  name: string;           // FFmpeg decoder name (e.g., 'h264_cuvid')
  hwaccel: HardwareAccelerationMethod;
  codec: VideoCodecName;
  available: boolean;
  priority: number;
}

export interface HardwareCapabilities {
  methods: HardwareAccelerationMethod[];
  encoders: HardwareEncoderInfo[];
  decoders: HardwareDecoderInfo[];
  detected: boolean;
}

// Hardware encoder definitions (ordered by priority)
// Lower priority = preferred. VAAPI is generally most reliable on Linux.
export const HARDWARE_ENCODERS: Omit<HardwareEncoderInfo, 'available'>[] = [
  // H.264 encoders (VAAPI first as it's most reliable on Linux)
  { name: 'h264_vaapi', hwaccel: 'vaapi', codec: 'h264', priority: 1 },
  { name: 'h264_nvenc', hwaccel: 'nvenc', codec: 'h264', priority: 2 },
  { name: 'h264_qsv', hwaccel: 'qsv', codec: 'h264', priority: 3 },
  { name: 'h264_videotoolbox', hwaccel: 'videotoolbox', codec: 'h264', priority: 1 }, // macOS
  { name: 'h264_v4l2m2m', hwaccel: 'v4l2m2m', codec: 'h264', priority: 5 },

  // HEVC encoders
  { name: 'hevc_vaapi', hwaccel: 'vaapi', codec: 'hevc', priority: 1 },
  { name: 'hevc_nvenc', hwaccel: 'nvenc', codec: 'hevc', priority: 2 },
  { name: 'hevc_qsv', hwaccel: 'qsv', codec: 'hevc', priority: 3 },
  { name: 'hevc_videotoolbox', hwaccel: 'videotoolbox', codec: 'hevc', priority: 1 }, // macOS
  { name: 'hevc_v4l2m2m', hwaccel: 'v4l2m2m', codec: 'hevc', priority: 5 },

  // VP8 encoders
  { name: 'vp8_vaapi', hwaccel: 'vaapi', codec: 'vp8', priority: 1 },
  { name: 'vp8_v4l2m2m', hwaccel: 'v4l2m2m', codec: 'vp8', priority: 5 },

  // VP9 encoders
  { name: 'vp9_vaapi', hwaccel: 'vaapi', codec: 'vp9', priority: 1 },
  { name: 'vp9_qsv', hwaccel: 'qsv', codec: 'vp9', priority: 3 },

  // AV1 encoders (newer hardware only)
  { name: 'av1_vaapi', hwaccel: 'vaapi', codec: 'av1', priority: 1 },
  { name: 'av1_nvenc', hwaccel: 'nvenc', codec: 'av1', priority: 2 },
  { name: 'av1_qsv', hwaccel: 'qsv', codec: 'av1', priority: 3 },
];

// Hardware decoder definitions
// VAAPI is preferred on Linux as it's most reliable without requiring specific GPU drivers
// Note: VAAPI decoding uses -hwaccel vaapi, not a specific decoder name
export const HARDWARE_DECODERS: Omit<HardwareDecoderInfo, 'available'>[] = [
  // H.264 decoders - QSV tends to be more reliable than CUDA
  { name: 'h264_qsv', hwaccel: 'qsv', codec: 'h264', priority: 1 },
  { name: 'h264_cuvid', hwaccel: 'cuda', codec: 'h264', priority: 3 },

  // HEVC decoders
  { name: 'hevc_qsv', hwaccel: 'qsv', codec: 'hevc', priority: 1 },
  { name: 'hevc_cuvid', hwaccel: 'cuda', codec: 'hevc', priority: 3 },

  // VP8 decoders
  { name: 'vp8_qsv', hwaccel: 'qsv', codec: 'vp8', priority: 1 },
  { name: 'vp8_cuvid', hwaccel: 'cuda', codec: 'vp8', priority: 3 },

  // VP9 decoders
  { name: 'vp9_qsv', hwaccel: 'qsv', codec: 'vp9', priority: 1 },
  { name: 'vp9_cuvid', hwaccel: 'cuda', codec: 'vp9', priority: 3 },

  // AV1 decoders
  { name: 'av1_qsv', hwaccel: 'qsv', codec: 'av1', priority: 1 },
  { name: 'av1_cuvid', hwaccel: 'cuda', codec: 'av1', priority: 3 },
];

// Software encoder fallbacks
export const SOFTWARE_ENCODERS: Record<VideoCodecName, string> = {
  h264: 'libx264',
  hevc: 'libx265',
  vp8: 'libvpx',
  vp9: 'libvpx-vp9',
  av1: 'libaom-av1',
};

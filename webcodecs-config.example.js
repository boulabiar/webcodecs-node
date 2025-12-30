/**
 * WebCodecs Configuration Example
 *
 * Copy this file to webcodecs-config.js and uncomment the options you want.
 * All settings are optional - commented lines use built-in defaults.
 *
 * You can also set WEBCODECS_CONFIG environment variable to specify a custom path.
 *
 * NOTE: Use CommonJS syntax (module.exports) since the config is loaded synchronously.
 */

module.exports = {
  // ============================================================================
  // Quality Settings
  // ============================================================================

  // Global CRF value for quality-based encoding (lower = better quality, bigger file)
  // Typical values: 18-28 for H.264/HEVC, 30-40 for VP9/AV1
  // crf: 23,

  // Global encoder preset (speed vs compression tradeoff)
  // Options: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
  // preset: 'medium',

  // ============================================================================
  // Hardware Acceleration Priority
  // ============================================================================

  // Global hardware acceleration priority order.
  // First available method in the list wins.
  // Options: 'cuda', 'nvenc', 'nvdec', 'vaapi', 'qsv', 'videotoolbox', 'v4l2m2m'
  //
  // Example: Prefer NVIDIA CUDA, then Intel QuickSync, then VAAPI
  // hwaccel: ['cuda', 'nvenc', 'qsv', 'vaapi'],
  //
  // Example: Force VAAPI only
  // hwaccel: ['vaapi'],

  // ============================================================================
  // Per-Codec Overrides
  // ============================================================================

  // Override settings for specific codecs.
  // Codec names: h264, hevc, vp8, vp9, av1

  // perCodec: {
  //   h264: {
  //     crf: 20,
  //     preset: 'fast',
  //     hwaccel: ['nvenc', 'qsv', 'vaapi'],
  //   },
  //   hevc: {
  //     crf: 24,
  //     hwaccel: ['nvenc', 'vaapi'],
  //   },
  //   vp9: {
  //     // VP9 has no NVENC support, use VAAPI or software
  //     hwaccel: ['vaapi'],
  //   },
  //   av1: {
  //     crf: 30,
  //     preset: '6',  // SVT-AV1 preset (0-13, lower = slower/better)
  //     hwaccel: ['nvenc', 'qsv', 'vaapi'],
  //   },
  // },
};

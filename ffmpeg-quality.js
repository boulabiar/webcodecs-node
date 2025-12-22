// Global FFmpeg quality overrides (non-standard).
// Edit this file to control CRF/preset without changing encoder configs.
// If left empty, the defaults based on bitrateMode/latencyMode are used.

export default {
  // Global overrides:
  // crf: 28,
  // preset: 'veryfast',

  // Per-codec overrides:
  // perCodec: {
  //   h264: { crf: 30, preset: 'veryfast' },
  //   hevc: { crf: 28, preset: 'medium' },
  //   vp9: { crf: 32 },
  //   av1: { crf: 35, preset: '6' },
  // },
};

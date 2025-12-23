/**
 * Codec string validation according to WebCodecs specification
 *
 * The WebCodecs spec requires strict validation of codec strings:
 * - Case-sensitive matching
 * - Fully qualified codec strings (no ambiguous "vp9", must be "vp09.xx.xx.xx")
 * - Valid profile/level parameters
 *
 * @see https://www.w3.org/TR/webcodecs-codec-registry/
 */

export interface CodecValidationResult {
  valid: boolean;
  supported: boolean;
  error?: string;
}

/**
 * Validate a video codec string according to WebCodecs spec
 *
 * Returns { valid: true, supported: true } for valid, supported codecs
 * Returns { valid: true, supported: false } for valid but unsupported codecs
 * Returns { valid: false, supported: false } for invalid codec strings
 */
export function validateVideoCodec(codec: string): CodecValidationResult {
  // Check for whitespace (invalid)
  if (codec !== codec.trim()) {
    return { valid: true, supported: false, error: 'Codec string contains whitespace' };
  }

  // Check for MIME type format (invalid for WebCodecs)
  if (codec.includes('/') || codec.includes(';')) {
    return { valid: true, supported: false, error: 'MIME type format not accepted' };
  }

  // AVC/H.264: avc1.PPCCLL or avc3.PPCCLL
  if (codec.startsWith('avc1.') || codec.startsWith('avc3.')) {
    return validateAvcCodec(codec);
  }

  // HEVC/H.265: hvc1.P.T.Lxx or hev1.P.T.Lxx
  if (codec.startsWith('hvc1.') || codec.startsWith('hev1.')) {
    return validateHevcCodec(codec);
  }

  // VP8: exactly "vp8"
  if (codec === 'vp8') {
    return { valid: true, supported: true };
  }

  // VP8 with wrong casing
  if (codec.toLowerCase() === 'vp8' && codec !== 'vp8') {
    return { valid: true, supported: false, error: 'VP8 codec must be lowercase "vp8"' };
  }

  // VP9: must be fully qualified vp09.PP.LL.DD
  if (codec.startsWith('vp09.')) {
    return validateVp9Codec(codec);
  }

  // Ambiguous "vp9" without profile - not accepted per WebCodecs spec
  if (codec.toLowerCase() === 'vp9') {
    return { valid: true, supported: false, error: 'Ambiguous VP9 codec, use vp09.PP.LL.DD format' };
  }

  // AV1: av01.P.LLT.DD
  if (codec.startsWith('av01.')) {
    return validateAv1Codec(codec);
  }

  // Ambiguous "av1" without profile is not accepted
  if (codec === 'av1' || codec.toLowerCase() === 'av1') {
    return { valid: true, supported: false, error: 'Ambiguous AV1 codec, use av01.P.LLT.DD format' };
  }

  // Unknown codec
  return { valid: true, supported: false, error: `Unrecognized codec: ${codec}` };
}

/**
 * Validate AVC/H.264 codec string
 * Format: avc1.PPCCLL or avc3.PPCCLL
 * PP = Profile (hex), CC = Constraints (hex), LL = Level (hex)
 */
function validateAvcCodec(codec: string): CodecValidationResult {
  // avc1.XXXXXX or avc3.XXXXXX (6 hex digits)
  const match = codec.match(/^(avc[13])\.([0-9A-Fa-f]{6})$/);
  if (!match) {
    return { valid: true, supported: false, error: 'Invalid AVC codec format' };
  }

  const [, prefix, params] = match;

  // Check case sensitivity of prefix
  if (prefix !== prefix.toLowerCase()) {
    return { valid: true, supported: false, error: 'AVC codec prefix must be lowercase' };
  }

  // Parse profile, constraints, level
  const profile = parseInt(params.substring(0, 2), 16);
  const constraints = parseInt(params.substring(2, 4), 16);
  const level = parseInt(params.substring(4, 6), 16);

  // Valid profiles: 66 (Baseline), 77 (Main), 88 (Extended), 100 (High), etc.
  const validProfiles = [66, 77, 88, 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134];
  if (!validProfiles.includes(profile)) {
    // Future/unknown profile - mark as unsupported
    return { valid: true, supported: false, error: `Unknown AVC profile: ${profile}` };
  }

  // Valid levels: 10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62
  const validLevels = [10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62];
  if (!validLevels.includes(level)) {
    // Note: level 29 (0x1D) is not a valid H.264 level
    return { valid: true, supported: false, error: `Unknown AVC level: ${level}` };
  }

  return { valid: true, supported: true };
}

/**
 * Validate HEVC/H.265 codec string
 * Format: hvc1.P.C.Lxx[.XX] or hev1.P.C.Lxx[.XX]
 * Where P = profile, C = compatibility, Lxx = level, XX = optional constraints
 * Example: hev1.1.6.L93.B0
 */
function validateHevcCodec(codec: string): CodecValidationResult {
  // HEVC codec format: prefix.profile.compatibility.level[.constraints]
  // Examples: hev1.1.6.L93.B0, hvc1.1.6.L120, hev1.2.4.L153.90
  const match = codec.match(/^(hvc1|hev1)\.(\d+)\.([0-9A-Fa-f]+)\.L(\d+)(?:\.([A-Za-z0-9]+))?$/);
  if (!match) {
    return { valid: true, supported: false, error: 'Invalid HEVC codec format' };
  }

  const [, prefix, profileStr, , levelStr] = match;

  // Check case sensitivity of prefix
  if (prefix !== prefix.toLowerCase()) {
    return { valid: true, supported: false, error: 'HEVC codec prefix must be lowercase' };
  }

  const profile = parseInt(profileStr, 10);
  const level = parseInt(levelStr, 10);

  // Valid HEVC profiles: 1 (Main), 2 (Main 10), 3 (Main Still Picture), etc.
  if (profile < 1 || profile > 11) {
    return { valid: true, supported: false, error: `Unknown HEVC profile: ${profile}` };
  }

  // Valid HEVC levels (level * 30): 30, 60, 63, 90, 93, 120, 123, 150, 153, 156, 180, 183, 186
  const validLevels = [30, 60, 63, 90, 93, 120, 123, 150, 153, 156, 180, 183, 186];
  if (!validLevels.includes(level)) {
    return { valid: true, supported: false, error: `Unknown HEVC level: ${level}` };
  }

  return { valid: true, supported: true };
}

/**
 * Validate VP9 codec string
 * Format: vp09.PP.LL.DD
 * PP = Profile (00-03), LL = Level (10-62), DD = Bit depth (08, 10, 12)
 */
function validateVp9Codec(codec: string): CodecValidationResult {
  const match = codec.match(/^vp09\.(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) {
    return { valid: true, supported: false, error: 'Invalid VP9 codec format, expected vp09.PP.LL.DD' };
  }

  const [, profileStr, levelStr, bitDepthStr] = match;
  const profile = parseInt(profileStr, 10);
  const level = parseInt(levelStr, 10);
  const bitDepth = parseInt(bitDepthStr, 10);

  // Valid profiles: 0, 1, 2, 3
  if (profile < 0 || profile > 3) {
    return { valid: true, supported: false, error: `Unknown VP9 profile: ${profile}` };
  }

  // Valid levels: 10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 52, 60, 61, 62
  const validLevels = [10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 52, 60, 61, 62];
  if (!validLevels.includes(level)) {
    return { valid: true, supported: false, error: `Unknown VP9 level: ${level}` };
  }

  // Valid bit depths: 8, 10, 12
  if (bitDepth !== 8 && bitDepth !== 10 && bitDepth !== 12) {
    return { valid: true, supported: false, error: `Unknown VP9 bit depth: ${bitDepth}` };
  }

  return { valid: true, supported: true };
}

/**
 * Validate AV1 codec string
 * Format: av01.P.LLT.DD
 * P = Profile (0=Main, 1=High, 2=Professional)
 * LL = Level (00-23)
 * T = Tier (M=Main, H=High)
 * DD = Bit depth (08, 10, 12)
 */
function validateAv1Codec(codec: string): CodecValidationResult {
  const match = codec.match(/^av01\.(\d)\.(\d{2})([MH])\.(\d{2})$/);
  if (!match) {
    return { valid: true, supported: false, error: 'Invalid AV1 codec format, expected av01.P.LLT.DD' };
  }

  const [, profileStr, levelStr, tier, bitDepthStr] = match;
  const profile = parseInt(profileStr, 10);
  const level = parseInt(levelStr, 10);
  const bitDepth = parseInt(bitDepthStr, 10);

  // Valid profiles: 0 (Main), 1 (High), 2 (Professional)
  if (profile < 0 || profile > 2) {
    return { valid: true, supported: false, error: `Unknown AV1 profile: ${profile}` };
  }

  // Valid levels: 0-23 (0=2.0, 1=2.1, ..., 23=7.3)
  if (level < 0 || level > 23) {
    return { valid: true, supported: false, error: `Unknown AV1 level: ${level}` };
  }

  // Valid bit depths: 8, 10, 12
  if (bitDepth !== 8 && bitDepth !== 10 && bitDepth !== 12) {
    return { valid: true, supported: false, error: `Unknown AV1 bit depth: ${bitDepth}` };
  }

  return { valid: true, supported: true };
}

/**
 * Check if a codec config is valid (should throw TypeError if invalid)
 * This checks for missing/empty required fields
 */
export function validateVideoDecoderConfig(config: unknown): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.codec === undefined || cfg.codec === null) {
    throw new TypeError('codec is required');
  }

  if (typeof cfg.codec !== 'string' || cfg.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }
}

/**
 * Check if an encoder config is valid (should throw TypeError if invalid)
 */
export function validateVideoEncoderConfig(config: unknown): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.codec === undefined || cfg.codec === null) {
    throw new TypeError('codec is required');
  }

  if (typeof cfg.codec !== 'string' || cfg.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }

  if (cfg.width === undefined || cfg.width === null) {
    throw new TypeError('width is required');
  }

  if (typeof cfg.width !== 'number' || cfg.width <= 0 || !Number.isFinite(cfg.width)) {
    throw new TypeError('width must be a positive number');
  }

  if (cfg.height === undefined || cfg.height === null) {
    throw new TypeError('height is required');
  }

  if (typeof cfg.height !== 'number' || cfg.height <= 0 || !Number.isFinite(cfg.height)) {
    throw new TypeError('height must be a positive number');
  }

  // Optional field validations
  if (cfg.displayWidth !== undefined && (typeof cfg.displayWidth !== 'number' || cfg.displayWidth <= 0)) {
    throw new TypeError('displayWidth must be a positive number');
  }

  if (cfg.displayHeight !== undefined && (typeof cfg.displayHeight !== 'number' || cfg.displayHeight <= 0)) {
    throw new TypeError('displayHeight must be a positive number');
  }

  if (cfg.bitrate !== undefined && (typeof cfg.bitrate !== 'number' || cfg.bitrate <= 0)) {
    throw new TypeError('bitrate must be a positive number');
  }

  if (cfg.framerate !== undefined && (typeof cfg.framerate !== 'number' || cfg.framerate <= 0)) {
    throw new TypeError('framerate must be a positive number');
  }
}

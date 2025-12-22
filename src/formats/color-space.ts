/**
 * Color space conversion utilities
 * Provides YUV <-> RGB conversions using BT.709 coefficients
 */

/**
 * Convert RGBA pixel to YUV (BT.709)
 * @returns [Y, U, V] values in range 0-255
 */
export function rgbaToYuv(r: number, g: number, b: number): [number, number, number] {
  // BT.709 coefficients
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const u = -0.1146 * r - 0.3854 * g + 0.5 * b + 128;
  const v = 0.5 * r - 0.4542 * g - 0.0458 * b + 128;
  return [
    Math.max(0, Math.min(255, Math.round(y))),
    Math.max(0, Math.min(255, Math.round(u))),
    Math.max(0, Math.min(255, Math.round(v))),
  ];
}

/**
 * Convert YUV to RGBA (BT.709)
 * @returns [R, G, B, A] values in range 0-255
 */
export function yuvToRgba(y: number, u: number, v: number): [number, number, number, number] {
  // BT.709 inverse coefficients
  const c = y;
  const d = u - 128;
  const e = v - 128;

  const r = c + 1.5748 * e;
  const g = c - 0.1873 * d - 0.4681 * e;
  const b = c + 1.8556 * d;

  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
    255,
  ];
}

/**
 * SMPTE ST 2086 Mastering Display Metadata
 * Describes the color volume of the mastering display
 */
export interface SmpteSt2086Metadata {
  /**
   * CIE 1931 xy chromaticity coordinates of the display primaries
   * Values are in range [0, 1] with 0.00002 precision
   */
  primaryRChromaticityX: number;
  primaryRChromaticityY: number;
  primaryGChromaticityX: number;
  primaryGChromaticityY: number;
  primaryBChromaticityX: number;
  primaryBChromaticityY: number;

  /**
   * CIE 1931 xy chromaticity coordinates of the white point
   */
  whitePointChromaticityX: number;
  whitePointChromaticityY: number;

  /**
   * Maximum luminance of the display in cd/m² (nits)
   */
  maxLuminance: number;

  /**
   * Minimum luminance of the display in cd/m² (nits)
   */
  minLuminance: number;
}

/**
 * Content Light Level Information
 * Describes the light level of the content itself
 */
export interface ContentLightLevelInfo {
  /**
   * Maximum Content Light Level in cd/m² (nits)
   * The maximum light level of any single pixel in the content
   */
  maxCLL: number;

  /**
   * Maximum Frame-Average Light Level in cd/m² (nits)
   * The maximum average light level of any frame in the content
   */
  maxFALL: number;
}

/**
 * HDR Metadata combining mastering display and content light level info
 */
export interface HdrMetadata {
  /**
   * SMPTE ST 2086 mastering display metadata
   */
  smpteSt2086?: SmpteSt2086Metadata;

  /**
   * Content light level information
   */
  contentLightLevel?: ContentLightLevelInfo;
}

/**
 * Video color space initialization options
 */
export interface VideoColorSpaceInit {
  primaries?: 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'smpte432';
  transfer?: 'bt709' | 'smpte170m' | 'iec61966-2-1' | 'linear' | 'pq' | 'hlg';
  matrix?: 'rgb' | 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020-ncl';
  fullRange?: boolean;
  /**
   * HDR metadata (SMPTE ST 2086 and/or Content Light Level)
   * Only meaningful when transfer is 'pq' or 'hlg'
   */
  hdrMetadata?: HdrMetadata;
}

/**
 * VideoColorSpace - describes the color space of video content
 */
export class VideoColorSpace {
  readonly primaries: string | null;
  readonly transfer: string | null;
  readonly matrix: string | null;
  readonly fullRange: boolean | null;
  readonly hdrMetadata: HdrMetadata | null;

  constructor(init?: VideoColorSpaceInit) {
    this.primaries = init?.primaries ?? null;
    this.transfer = init?.transfer ?? null;
    this.matrix = init?.matrix ?? null;
    this.fullRange = init?.fullRange ?? null;
    this.hdrMetadata = init?.hdrMetadata ?? null;
  }

  /**
   * Check if this color space represents HDR content
   */
  get isHdr(): boolean {
    return this.transfer === 'pq' || this.transfer === 'hlg';
  }

  /**
   * Check if HDR metadata is available
   */
  get hasHdrMetadata(): boolean {
    return this.hdrMetadata !== null && (
      this.hdrMetadata.smpteSt2086 !== undefined ||
      this.hdrMetadata.contentLightLevel !== undefined
    );
  }

  toJSON(): VideoColorSpaceInit {
    const result: VideoColorSpaceInit = {
      primaries: this.primaries as VideoColorSpaceInit['primaries'],
      transfer: this.transfer as VideoColorSpaceInit['transfer'],
      matrix: this.matrix as VideoColorSpaceInit['matrix'],
      fullRange: this.fullRange ?? undefined,
    };
    if (this.hdrMetadata) {
      result.hdrMetadata = this.hdrMetadata;
    }
    return result;
  }
}

/**
 * Common HDR10 display primaries (DCI-P3 D65)
 */
export const HDR10_DISPLAY_PRIMARIES: Pick<
  SmpteSt2086Metadata,
  'primaryRChromaticityX' | 'primaryRChromaticityY' |
  'primaryGChromaticityX' | 'primaryGChromaticityY' |
  'primaryBChromaticityX' | 'primaryBChromaticityY' |
  'whitePointChromaticityX' | 'whitePointChromaticityY'
> = {
  // BT.2020 / Rec. 2020 primaries
  primaryRChromaticityX: 0.708,
  primaryRChromaticityY: 0.292,
  primaryGChromaticityX: 0.170,
  primaryGChromaticityY: 0.797,
  primaryBChromaticityX: 0.131,
  primaryBChromaticityY: 0.046,
  // D65 white point
  whitePointChromaticityX: 0.3127,
  whitePointChromaticityY: 0.3290,
};

/**
 * Create a typical HDR10 mastering display metadata
 * @param maxLuminance Maximum luminance in nits (typical: 1000-10000)
 * @param minLuminance Minimum luminance in nits (typical: 0.0001-0.05)
 */
export function createHdr10MasteringMetadata(
  maxLuminance: number,
  minLuminance: number = 0.0001
): SmpteSt2086Metadata {
  return {
    ...HDR10_DISPLAY_PRIMARIES,
    maxLuminance,
    minLuminance,
  };
}

/**
 * Create content light level info
 * @param maxCLL Maximum Content Light Level in nits
 * @param maxFALL Maximum Frame-Average Light Level in nits
 */
export function createContentLightLevel(
  maxCLL: number,
  maxFALL: number
): ContentLightLevelInfo {
  return { maxCLL, maxFALL };
}

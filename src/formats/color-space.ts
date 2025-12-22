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
 * Video color space initialization options
 */
export interface VideoColorSpaceInit {
  primaries?: 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'smpte432';
  transfer?: 'bt709' | 'smpte170m' | 'iec61966-2-1' | 'linear' | 'pq' | 'hlg';
  matrix?: 'rgb' | 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020-ncl';
  fullRange?: boolean;
}

/**
 * VideoColorSpace - describes the color space of video content
 */
export class VideoColorSpace {
  readonly primaries: string | null;
  readonly transfer: string | null;
  readonly matrix: string | null;
  readonly fullRange: boolean | null;

  constructor(init?: VideoColorSpaceInit) {
    this.primaries = init?.primaries ?? null;
    this.transfer = init?.transfer ?? null;
    this.matrix = init?.matrix ?? null;
    this.fullRange = init?.fullRange ?? null;
  }

  toJSON(): VideoColorSpaceInit {
    return {
      primaries: this.primaries as VideoColorSpaceInit['primaries'],
      transfer: this.transfer as VideoColorSpaceInit['transfer'],
      matrix: this.matrix as VideoColorSpaceInit['matrix'],
      fullRange: this.fullRange ?? undefined,
    };
  }
}

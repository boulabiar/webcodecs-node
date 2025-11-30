/**
 * HEVC/H.265 codec configuration
 */

export interface HEVCEncoderOptions {
  profile?: 'main' | 'main10' | 'main444-8' | 'main444-10';
  tier?: 'main' | 'high';
  level?: string;
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo';
  tune?: 'psnr' | 'ssim' | 'grain' | 'fastdecode' | 'zerolatency';
  bframes?: number;
}

/**
 * Get FFmpeg arguments for HEVC encoding
 */
export function getHEVCArgs(options: HEVCEncoderOptions, isRealtime: boolean): string[] {
  const args: string[] = [];

  if (isRealtime) {
    args.push('-preset', options.preset ?? 'ultrafast');
    if (options.tune ?? 'zerolatency') {
      args.push('-tune', options.tune ?? 'zerolatency');
    }
    args.push('-x265-params', 'aud=1:bframes=0:rc-lookahead=0');
  } else {
    args.push('-preset', options.preset ?? 'medium');
    if (options.tune) {
      args.push('-tune', options.tune);
    }
    const params = ['aud=1'];
    if (options.bframes !== undefined) {
      params.push(`bframes=${options.bframes}`);
    } else {
      params.push('bframes=2');
    }
    params.push('rc-lookahead=20');
    args.push('-x265-params', params.join(':'));
  }

  if (options.profile) {
    args.push('-profile:v', options.profile);
  }
  if (options.tier) {
    args.push('-tier', options.tier);
  }
  if (options.level) {
    args.push('-level', options.level);
  }

  return args;
}

/**
 * Parse HEVC codec string (e.g., "hev1.1.6.L93.B0")
 */
export function parseHEVCCodecString(codec: string): {
  profile: string;
  tier: string;
  level: number;
} | null {
  const match = codec.match(/^hev1\.(\d)\.[\dA-F]+\.L(\d+)\.([BH])(\d+)?/i);
  if (!match) return null;

  const profileMap: Record<string, string> = {
    '1': 'main',
    '2': 'main10',
    '4': 'main444-8',
  };

  return {
    profile: profileMap[match[1]] ?? 'main',
    tier: match[3] === 'H' ? 'high' : 'main',
    level: parseInt(match[2], 10) / 30,
  };
}

/**
 * Generate HEVC codec string
 */
export function generateHEVCCodecString(
  profile: 'main' | 'main10' = 'main',
  level: number = 4.0,
  tier: 'main' | 'high' = 'main'
): string {
  const profileMap: Record<string, number> = {
    main: 1,
    main10: 2,
  };

  const profileId = profileMap[profile] ?? 1;
  const levelId = Math.round(level * 30);
  const tierChar = tier === 'high' ? 'H' : 'B';

  return `hev1.${profileId}.4.L${levelId}.${tierChar}0`;
}

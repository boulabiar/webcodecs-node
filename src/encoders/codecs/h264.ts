/**
 * H.264/AVC codec configuration
 */

export interface H264EncoderOptions {
  profile?: 'baseline' | 'main' | 'high';
  level?: string;
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
  tune?: 'film' | 'animation' | 'grain' | 'stillimage' | 'fastdecode' | 'zerolatency';
  bframes?: number;
  refs?: number;
}

/**
 * Get FFmpeg arguments for H.264 encoding
 */
export function getH264Args(options: H264EncoderOptions, isRealtime: boolean): string[] {
  const args: string[] = [];

  if (isRealtime) {
    // Realtime mode: minimum latency, immediate output
    args.push('-preset', options.preset ?? 'ultrafast');
    args.push('-tune', options.tune ?? 'zerolatency');
    args.push('-x264-params', 'aud=1:bframes=0:rc-lookahead=0:threads=1:sliced-threads=0:sync-lookahead=0:intra-refresh=1');
  } else {
    // Quality mode: better compression, some latency
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
    if (options.refs !== undefined) {
      params.push(`ref=${options.refs}`);
    }
    args.push('-x264-params', params.join(':'));
  }

  if (options.profile) {
    args.push('-profile:v', options.profile);
  }
  if (options.level) {
    args.push('-level', options.level);
  }

  return args;
}

/**
 * Parse H.264 codec string (e.g., "avc1.42001E")
 */
export function parseH264CodecString(codec: string): {
  profile: string;
  level: number;
  constraint: number;
} | null {
  const match = codec.match(/^avc[13]\.([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!match) return null;

  const profileIdc = parseInt(match[1], 16);
  const constraint = parseInt(match[2], 16);
  const levelIdc = parseInt(match[3], 16);

  let profile = 'unknown';
  switch (profileIdc) {
    case 66: profile = 'baseline'; break;
    case 77: profile = 'main'; break;
    case 88: profile = 'extended'; break;
    case 100: profile = 'high'; break;
    case 110: profile = 'high10'; break;
    case 122: profile = 'high422'; break;
    case 244: profile = 'high444'; break;
  }

  return {
    profile,
    level: levelIdc / 10,
    constraint,
  };
}

/**
 * Generate H.264 codec string
 */
export function generateH264CodecString(
  profile: 'baseline' | 'main' | 'high' = 'high',
  level: number = 4.0
): string {
  const profileMap: Record<string, number> = {
    baseline: 66,
    main: 77,
    high: 100,
  };

  const profileIdc = profileMap[profile] ?? 100;
  const levelIdc = Math.round(level * 10);

  return `avc1.${profileIdc.toString(16).padStart(2, '0')}00${levelIdc.toString(16).padStart(2, '0')}`;
}

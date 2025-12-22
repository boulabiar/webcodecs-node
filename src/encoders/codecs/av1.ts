/**
 * AV1 codec configuration
 */

export interface AV1EncoderOptions {
  profile?: 'main' | 'high' | 'professional';
  level?: number;  // 2.0 - 7.3
  tier?: 'main' | 'high';
  usage?: 'good' | 'realtime' | 'allintra';
  cpuUsed?: number;  // 0-8, higher = faster
  rowMt?: boolean;
  tileColumns?: number;
  tileRows?: number;
}

/**
 * Get FFmpeg arguments for AV1 encoding (libaom-av1)
 */
export function getAV1Args(options: AV1EncoderOptions, isRealtime: boolean): string[] {
  const args: string[] = [];

  if (isRealtime) {
    args.push('-cpu-used', String(options.cpuUsed ?? 8));
    args.push('-usage', 'realtime');
    args.push('-row-mt', '1');
  } else {
    args.push('-cpu-used', String(options.cpuUsed ?? 4));
    args.push('-usage', options.usage ?? 'good');
    if (options.rowMt !== false) {
      args.push('-row-mt', '1');
    }
  }

  if (options.tileColumns !== undefined) {
    args.push('-tiles', `${1 << options.tileColumns}x${1 << (options.tileRows ?? 0)}`);
  }

  return args;
}

/**
 * Parse AV1 codec string (e.g., "av01.0.04M.08")
 */
export function parseAV1CodecString(codec: string): {
  profile: string;
  level: number;
  tier: string;
  bitDepth: number;
} | null {
  const match = codec.match(/^av01\.(\d)\.(\d{2})([MH])\.(\d{2})/);
  if (!match) return null;

  const profileMap: Record<string, string> = {
    '0': 'main',
    '1': 'high',
    '2': 'professional',
  };

  // Level mapping: https://aomedia.org/av1/specification/annex-a/
  const levelIdx = parseInt(match[2], 10);
  const levels = [2.0, 2.1, 2.2, 2.3, 3.0, 3.1, 3.2, 3.3, 4.0, 4.1, 4.2, 4.3, 5.0, 5.1, 5.2, 5.3, 6.0, 6.1, 6.2, 6.3, 7.0, 7.1, 7.2, 7.3];

  return {
    profile: profileMap[match[1]] ?? 'main',
    level: levels[levelIdx] ?? 4.0,
    tier: match[3] === 'H' ? 'high' : 'main',
    bitDepth: parseInt(match[4], 10),
  };
}

/**
 * Generate AV1 codec string
 */
export function generateAV1CodecString(
  profile: 'main' | 'high' | 'professional' = 'main',
  level: number = 4.0,
  tier: 'main' | 'high' = 'main',
  bitDepth: number = 8
): string {
  const profileMap: Record<string, number> = {
    main: 0,
    high: 1,
    professional: 2,
  };

  // Level to index mapping
  const levels = [2.0, 2.1, 2.2, 2.3, 3.0, 3.1, 3.2, 3.3, 4.0, 4.1, 4.2, 4.3, 5.0, 5.1, 5.2, 5.3, 6.0, 6.1, 6.2, 6.3, 7.0, 7.1, 7.2, 7.3];
  let levelIdx = levels.findIndex(l => l >= level);
  if (levelIdx === -1) levelIdx = levels.length - 1;

  const profileId = profileMap[profile] ?? 0;
  const tierChar = tier === 'high' ? 'H' : 'M';

  return `av01.${profileId}.${levelIdx.toString().padStart(2, '0')}${tierChar}.${bitDepth.toString().padStart(2, '0')}`;
}

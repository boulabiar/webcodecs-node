/**
 * VP9 codec configuration
 */

export interface VP9EncoderOptions {
  profile?: 0 | 1 | 2 | 3;
  deadline?: 'best' | 'good' | 'realtime';
  cpuUsed?: number;  // 0-8, higher = faster
  lagInFrames?: number;
  rowMt?: boolean;   // Row-based multithreading
  tileColumns?: number;
  tileRows?: number;
}

/**
 * Get FFmpeg arguments for VP9 encoding
 */
export function getVP9Args(options: VP9EncoderOptions, isRealtime: boolean): string[] {
  const args: string[] = [];

  if (isRealtime) {
    args.push('-deadline', 'realtime');
    args.push('-cpu-used', String(options.cpuUsed ?? 8));
    args.push('-lag-in-frames', '0');
    args.push('-row-mt', '1');
  } else {
    args.push('-deadline', options.deadline ?? 'good');
    args.push('-cpu-used', String(options.cpuUsed ?? 2));
    if (options.lagInFrames !== undefined) {
      args.push('-lag-in-frames', String(options.lagInFrames));
    } else {
      args.push('-lag-in-frames', '25');
    }
    if (options.rowMt !== false) {
      args.push('-row-mt', '1');
    }
  }

  if (options.profile !== undefined) {
    args.push('-profile:v', String(options.profile));
  }

  if (options.tileColumns !== undefined) {
    args.push('-tile-columns', String(options.tileColumns));
  }
  if (options.tileRows !== undefined) {
    args.push('-tile-rows', String(options.tileRows));
  }

  return args;
}

/**
 * Parse VP9 codec string (e.g., "vp09.00.10.08")
 */
export function parseVP9CodecString(codec: string): {
  profile: number;
  level: number;
  bitDepth: number;
} | null {
  const match = codec.match(/^vp09\.(\d{2})\.(\d{2})\.(\d{2})/);
  if (!match) return null;

  return {
    profile: parseInt(match[1], 10),
    level: parseInt(match[2], 10),
    bitDepth: parseInt(match[3], 10),
  };
}

/**
 * Generate VP9 codec string
 */
export function generateVP9CodecString(
  profile: number = 0,
  level: number = 10,
  bitDepth: number = 8
): string {
  return `vp09.${profile.toString().padStart(2, '0')}.${level.toString().padStart(2, '0')}.${bitDepth.toString().padStart(2, '0')}`;
}

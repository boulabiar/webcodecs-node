import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

export type FfmpegQualityOverrides = {
  crf?: number;
  preset?: string;
  perCodec?: Record<string, { crf?: number; preset?: string }>;
};

const DEFAULT_OVERRIDES: FfmpegQualityOverrides = {};

function sanitizeOverrides(raw: unknown): FfmpegQualityOverrides {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_OVERRIDES;
  }

  const src = raw as FfmpegQualityOverrides;
  const perCodec = src.perCodec && typeof src.perCodec === 'object' ? src.perCodec : undefined;

  return {
    crf: typeof src.crf === 'number' ? src.crf : undefined,
    preset: typeof src.preset === 'string' ? src.preset : undefined,
    perCodec,
  };
}

async function loadOverrides(): Promise<FfmpegQualityOverrides> {
  const configPath = process.env.WEB_CODECS_FFMPEG_QUALITY
    ?? path.join(process.cwd(), 'ffmpeg-quality.js');

  if (!fs.existsSync(configPath)) {
    return DEFAULT_OVERRIDES;
  }

  try {
    const mod = await import(pathToFileURL(configPath).href);
    const raw = mod?.default ?? mod?.ffmpegQuality ?? mod;
    return sanitizeOverrides(raw);
  } catch {
    return DEFAULT_OVERRIDES;
  }
}

export const ffmpegQualityOverrides = await loadOverrides();

export function getFfmpegQualityOverrides(codecName: string): { crf?: number; preset?: string } {
  const key = codecName.toLowerCase();
  const perCodec = ffmpegQualityOverrides.perCodec?.[key];
  return {
    crf: typeof perCodec?.crf === 'number' ? perCodec.crf : ffmpegQualityOverrides.crf,
    preset: typeof perCodec?.preset === 'string' ? perCodec.preset : ffmpegQualityOverrides.preset,
  };
}

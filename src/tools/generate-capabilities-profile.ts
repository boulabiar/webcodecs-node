import fs from 'fs';
import path from 'path';
import type { CapabilityProfile, CapabilityProfileEntry } from '../capabilities/types.js';
import { SMOOTH_THRESHOLDS } from '../capabilities/codecs.js';
import {
  detectHardwareAcceleration,
  parseCodecString,
} from '../hardware/index.js';

const VIDEO_PRESETS: Array<{
  codec: string;
  profile?: string;
  level?: string;
}> = [
  { codec: 'avc1.42E01E', profile: 'baseline', level: '4.0' },
  { codec: 'hev1.1.6.L93.B0', profile: 'main', level: '5.1' },
  { codec: 'vp8', profile: 'main' },
  { codec: 'vp09.00.10.08', profile: 'profile0', level: '4' },
  { codec: 'av01.0.01M.08', profile: 'main', level: '4.0' },
];

const AUDIO_PRESETS: Array<{
  codec: string;
  maxBitrate: number;
}> = [
  { codec: 'mp4a.40.2', maxBitrate: 320000 },
  { codec: 'opus', maxBitrate: 320000 },
  { codec: 'mp3', maxBitrate: 320000 },
  { codec: 'vorbis', maxBitrate: 320000 },
  { codec: 'flac', maxBitrate: 5000000 },
];

async function main(): Promise<void> {
  const outputArg = process.argv[2];
  const targetPath = path.resolve(outputArg || path.join(process.cwd(), 'webcodecs-capabilities.json'));

  const hw = await detectHardwareAcceleration();
  const videoProfile = buildVideoProfile(hw);
  const audioProfile = buildAudioProfile();

  const profile: CapabilityProfile = {
    video: videoProfile,
    audio: audioProfile,
  };

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, JSON.stringify(profile, null, 2), 'utf-8');
  console.log(`Capability profile written to ${targetPath}`);
}

function buildVideoProfile(hw: Awaited<ReturnType<typeof detectHardwareAcceleration>>): CapabilityProfileEntry[] {
  return VIDEO_PRESETS.map((preset) => {
    const codecName = parseCodecString(preset.codec);
    const hardwareAvailable = codecName
      ? hw.encoders.some((entry) => entry.codec === codecName && entry.available) ||
        hw.decoders.some((entry) => entry.codec === codecName && entry.available)
      : false;

    const thresholds = hardwareAvailable ? SMOOTH_THRESHOLDS.hardware : SMOOTH_THRESHOLDS.software;

    return {
      codec: preset.codec,
      profile: preset.profile,
      level: preset.level,
      maxWidth: thresholds.maxWidth,
      maxHeight: thresholds.maxHeight,
      maxFramerate: thresholds.maxFramerate,
      maxBitrate: thresholds.maxBitrate,
      hardwareAccelerated: hardwareAvailable,
    };
  });
}

function buildAudioProfile(): CapabilityProfileEntry[] {
  return AUDIO_PRESETS.map((preset) => ({
    codec: preset.codec,
    maxBitrate: preset.maxBitrate,
  }));
}

main().catch((err) => {
  console.error('Failed to generate capability profile:', err);
  process.exitCode = 1;
});

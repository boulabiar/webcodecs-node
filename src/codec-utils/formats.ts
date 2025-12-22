/**
 * Codec format mappings
 *
 * Converts between WebCodecs formats and libav formats used by node-av.
 */

/**
 * Map WebCodecs pixel format to libav pixel format
 */
export function pixelFormatToFFmpeg(format: string): string {
  const formatMap: Record<string, string> = {
    'I420': 'yuv420p',
    'I420A': 'yuva420p',
    'I422': 'yuv422p',
    'I444': 'yuv444p',
    'NV12': 'nv12',
    'RGBA': 'rgba',
    'RGBX': 'rgb0',
    'BGRA': 'bgra',
    'BGRX': 'bgr0',
    // 10-bit formats
    'I420P10': 'yuv420p10le',
    'I422P10': 'yuv422p10le',
    'I444P10': 'yuv444p10le',
    'P010': 'p010le',
  };
  return formatMap[format] || format.toLowerCase();
}

/**
 * Map libav pixel format to WebCodecs pixel format
 */
export function ffmpegToPixelFormat(format: string): string {
  const formatMap: Record<string, string> = {
    'yuv420p': 'I420',
    'yuva420p': 'I420A',
    'yuv422p': 'I422',
    'yuv444p': 'I444',
    'nv12': 'NV12',
    'rgba': 'RGBA',
    'rgb0': 'RGBX',
    'bgra': 'BGRA',
    'bgr0': 'BGRX',
    // 10-bit formats
    'yuv420p10le': 'I420P10',
    'yuv420p10be': 'I420P10',
    'yuv422p10le': 'I422P10',
    'yuv422p10be': 'I422P10',
    'yuv444p10le': 'I444P10',
    'yuv444p10be': 'I444P10',
    'p010le': 'P010',
    'p010be': 'P010',
  };
  return formatMap[format] || format.toUpperCase();
}

/**
 * Map WebCodecs codec string to libav encoder codec
 */
export function webCodecToFFmpegCodec(webCodec: string): string {
  const codecBase = webCodec.split('.')[0].toLowerCase();

  const codecMap: Record<string, string> = {
    'avc1': 'libx264',
    'avc3': 'libx264',
    'hev1': 'libx265',
    'hvc1': 'libx265',
    'vp8': 'libvpx',
    'vp09': 'libvpx-vp9',
    'vp9': 'libvpx-vp9',
    'av01': 'libaom-av1',
    'av1': 'libaom-av1',
  };

  return codecMap[codecBase] || codecBase;
}

/**
 * Map WebCodecs codec to container format
 */
export function webCodecToContainerFormat(webCodec: string): string {
  const codecBase = webCodec.split('.')[0].toLowerCase();

  const formatMap: Record<string, string> = {
    'avc1': 'h264',
    'avc3': 'h264',
    'hev1': 'hevc',
    'hvc1': 'hevc',
    'vp8': 'ivf',
    'vp09': 'ivf',
    'vp9': 'ivf',
    'av01': 'ivf',
    'av1': 'ivf',
  };

  return formatMap[codecBase] || 'rawvideo';
}

/**
 * Calculate frame size in bytes for a given pixel format and dimensions
 */
export function calculateFrameSize(format: string, width: number, height: number): number {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format.toUpperCase()) {
    case 'I420':
    case 'YUV420P':
      // Y: width * height, U: chromaW * chromaH, V: chromaW * chromaH
      return width * height + 2 * chromaW * chromaH;
    case 'I420A':
    case 'YUVA420P':
      // I420 + Alpha plane
      return width * height * 2 + 2 * chromaW * chromaH;
    case 'I422':
    case 'YUV422P':
      // Y: width * height, U: chromaW * height, V: chromaW * height
      return width * height + 2 * chromaW * height;
    case 'I444':
    case 'YUV444P':
      // Y, U, V all full size
      return width * height * 3;
    case 'NV12':
      // Y: width * height, UV interleaved: width * chromaH
      return width * height + width * chromaH;
    // 10-bit formats: 2 bytes per sample
    case 'I420P10':
    case 'YUV420P10LE':
    case 'YUV420P10BE':
      return (width * height + 2 * chromaW * chromaH) * 2;
    case 'I422P10':
    case 'YUV422P10LE':
    case 'YUV422P10BE':
      return (width * height + 2 * chromaW * height) * 2;
    case 'I444P10':
    case 'YUV444P10LE':
    case 'YUV444P10BE':
      return width * height * 3 * 2;
    case 'P010':
    case 'P010LE':
    case 'P010BE':
      return (width * height + width * chromaH) * 2;
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
    case 'RGB0':
    case 'BGR0':
      return width * height * 4;
    default:
      return width * height * 4; // Assume RGBA as fallback
  }
}

/**
 * MIME type to format mapping for ImageDecoder
 */
export const IMAGE_MIME_TO_FFMPEG: Record<string, { format: string; decoder?: string; autoDetect?: boolean }> = {
  'image/png': { format: 'png_pipe' },
  'image/apng': { format: 'apng' },
  'image/jpeg': { format: 'jpeg_pipe' },
  'image/jpg': { format: 'jpeg_pipe' },
  'image/webp': { format: 'webp_pipe', autoDetect: true },
  'image/gif': { format: 'gif' },
  'image/bmp': { format: 'bmp_pipe' },
  'image/avif': { format: 'avif', autoDetect: true },
  'image/tiff': { format: 'tiff_pipe' },
};

/**
 * Audio codec mappings
 */
export const AUDIO_CODEC_MAP: Record<string, string> = {
  'opus': 'libopus',
  'aac': 'aac',
  'mp3': 'libmp3lame',
  'flac': 'flac',
  'vorbis': 'libvorbis',
  'pcm-s16': 'pcm_s16le',
  'pcm-s32': 'pcm_s32le',
  'pcm-f32': 'pcm_f32le',
};

/**
 * Get libav audio codec from WebCodecs codec string
 */
export function webCodecToFFmpegAudioCodec(codec: string): string {
  const codecLower = codec.toLowerCase();
  return AUDIO_CODEC_MAP[codecLower] || codecLower;
}

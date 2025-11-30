/**
 * FFmpegProcess - Manages FFmpeg child process for encoding/decoding
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

import {
  type FFmpegConfig,
  type FFmpegInputConfig,
  type FFmpegOutputConfig,
  type EncodedFrameData,
  type DecoderConfig,
  type EncoderConfig,
  type BitrateMode,
  type AlphaOption,
  DEFAULT_SHUTDOWN_TIMEOUT,
} from './types.js';

import {
  createIvfParserState,
  parseIvfFrames,
  isVP9KeyFrame,
  type IvfParserState,
} from './parsers/ivf.js';

import {
  createAnnexBParserState,
  parseAnnexBFrames,
  flushAnnexBParser,
  isKeyFrame as isAnnexBKeyFrame,
  type AnnexBParserState,
} from './parsers/annexb.js';

import { calculateFrameSize } from './formats.js';

// Re-export types for backwards compatibility
export type { FFmpegConfig, FFmpegInputConfig, FFmpegOutputConfig };

export class FFmpegProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private _isRunning = false;
  private _isShuttingDown = false;
  private outputBuffer: Buffer[] = [];
  private frameSize: number = 0;
  private accumulatedData: Buffer = Buffer.alloc(0);
  private _useIvf = false;
  private _useAnnexB = false;
  private _codec = '';

  // Parser states
  private _ivfState: IvfParserState | null = null;
  private _annexBState: AnnexBParserState | null = null;

  constructor(private ffmpegPath: string = 'ffmpeg') {
    super();
  }

  get isRunning(): boolean {
    return this._isRunning && !this._isShuttingDown;
  }

  /**
   * Check if the process is healthy and can accept data
   */
  get isHealthy(): boolean {
    return this._isRunning &&
           !this._isShuttingDown &&
           this.process !== null &&
           this.process.stdin?.writable === true;
  }

  /**
   * Start FFmpeg process for decoding (encoded data -> raw frames)
   */
  startDecoder(config: DecoderConfig): void {
    const outputFormat = config.outputPixelFormat || 'rgba';

    // Calculate frame size based on output pixel format
    this.frameSize = calculateFrameSize(outputFormat, config.width, config.height);

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      ...(config.hardwareDecoderArgs ?? []),
      // Input from pipe
      '-f', this._getContainerFormat(config.codec),
      '-i', 'pipe:0',
    ];

    if (config.hardwareDownloadFilter) {
      args.push('-vf', config.hardwareDownloadFilter);
    }

    args.push(
      '-vsync', 'passthrough', // Don't duplicate or drop frames
      '-f', 'rawvideo',
      '-pix_fmt', outputFormat,
      'pipe:1'
    );

    this._startProcess(args);
  }

  /**
   * Start FFmpeg process for encoding (raw frames -> encoded data)
   */
  startEncoder(config: EncoderConfig): void {
    const inputFormat = config.inputPixelFormat || 'rgba';
    const framerate = config.framerate || 30;
    const containerFormat = this._getContainerFormat(config.codec);
    const codecBase = config.codec.split('.')[0].toLowerCase();
    const isRealtime = config.latencyMode === 'realtime';
    const alphaOption = config.alpha || 'discard';

    // Track codec for frame parsing
    this._codec = codecBase;

    // Use IVF for VP8/VP9/AV1 - it has per-frame headers we can parse
    this._useIvf = containerFormat === 'ivf';
    // Use Annex B parsing for H.264/HEVC
    this._useAnnexB = containerFormat === 'h264' || containerFormat === 'hevc';

    // Check if codec supports alpha
    const codecSupportsAlpha = this._codecSupportsAlpha(codecBase);
    const inputHasAlpha = this._formatHasAlpha(inputFormat);
    const keepAlpha = alphaOption === 'keep' && codecSupportsAlpha && inputHasAlpha;

    // Initialize parser state
    if (this._useIvf) {
      this._ivfState = createIvfParserState();
    } else if (this._useAnnexB) {
      const annexBCodec = (codecBase === 'hev1' || codecBase === 'hvc1') ? 'hevc' : 'h264';
      this._annexBState = createAnnexBParserState(annexBCodec);
    }

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      // Input raw video from pipe
      '-f', 'rawvideo',
      '-pix_fmt', inputFormat,
      '-s', `${config.width}x${config.height}`,
      '-r', String(framerate),
      '-i', 'pipe:0',
    ];

    // Handle alpha channel
    if (inputHasAlpha && !keepAlpha) {
      // Strip alpha channel using video filter
      args.push('-vf', 'format=yuv420p');
    } else if (keepAlpha) {
      // Keep alpha - use yuva420p for encoding
      args.push('-pix_fmt', 'yuva420p');
    }

    const hasHardwareArgs = Array.isArray(config.hardwareEncoderArgs) && config.hardwareEncoderArgs.length > 0;

    if (hasHardwareArgs) {
      args.push(...(config.hardwareEncoderArgs ?? []));
    } else {
      // Output encoded video
      args.push('-c:v', this._getFFmpegCodec(config.codec));

      // Codec-specific options based on latency mode and bitrate mode
      const bitrateMode = config.bitrateMode || 'variable';
      this._addCodecOptions(args, codecBase, isRealtime, bitrateMode, config.bitrate);
    }

    // Output format
    args.push('-f', containerFormat);
    args.push('pipe:1');

    this._startProcess(args);
  }

  /**
   * Check if a codec supports alpha channel
   */
  private _codecSupportsAlpha(codecBase: string): boolean {
    // VP9 and AV1 support alpha via yuva420p
    return ['vp9', 'vp09', 'av01', 'av1'].includes(codecBase);
  }

  /**
   * Check if a pixel format has alpha channel
   */
  private _formatHasAlpha(format: string): boolean {
    const alphaFormats = ['rgba', 'bgra', 'yuva420p', 'argb', 'abgr'];
    return alphaFormats.includes(format.toLowerCase());
  }

  /**
   * Add codec-specific FFmpeg options
   */
  private _addCodecOptions(
    args: string[],
    codecBase: string,
    isRealtime: boolean,
    bitrateMode: BitrateMode,
    bitrate?: number
  ): void {
    // Add bitrate control based on mode
    this._addBitrateOptions(args, codecBase, bitrateMode, bitrate);

    // Add latency/quality options per codec
    if (codecBase === 'avc1' || codecBase === 'avc3') {
      if (isRealtime) {
        args.push('-preset', 'ultrafast');
        args.push('-tune', 'zerolatency');
        args.push('-x264-params', 'aud=1:bframes=0:rc-lookahead=0:threads=1:sliced-threads=0:sync-lookahead=0:intra-refresh=1');
      } else {
        args.push('-preset', 'medium');
        args.push('-x264-params', 'aud=1:bframes=2:rc-lookahead=20');
      }
    } else if (codecBase === 'hev1' || codecBase === 'hvc1') {
      if (isRealtime) {
        args.push('-preset', 'ultrafast');
        args.push('-x265-params', 'aud=1:bframes=0:rc-lookahead=0');
      } else {
        args.push('-preset', 'medium');
        args.push('-x265-params', 'aud=1:bframes=2:rc-lookahead=20');
      }
    } else if (codecBase === 'vp8') {
      if (isRealtime) {
        args.push('-deadline', 'realtime');
        args.push('-cpu-used', '8');
        args.push('-lag-in-frames', '0');
      } else {
        args.push('-deadline', 'good');
        args.push('-cpu-used', '2');
      }
    } else if (codecBase === 'vp09' || codecBase === 'vp9') {
      if (isRealtime) {
        args.push('-deadline', 'realtime');
        args.push('-cpu-used', '8');
        args.push('-lag-in-frames', '0');
        args.push('-row-mt', '1');
      } else {
        args.push('-deadline', 'good');
        args.push('-cpu-used', '2');
        args.push('-lag-in-frames', '25');
      }
    } else if (codecBase === 'av01' || codecBase === 'av1') {
      if (isRealtime) {
        args.push('-cpu-used', '8');
        args.push('-usage', 'realtime');
      } else {
        args.push('-cpu-used', '4');
        args.push('-usage', 'good');
      }
    }
  }

  /**
   * Add bitrate control options based on bitrateMode
   */
  private _addBitrateOptions(
    args: string[],
    codecBase: string,
    bitrateMode: BitrateMode,
    bitrate?: number
  ): void {
    const isH264 = codecBase === 'avc1' || codecBase === 'avc3';
    const isHEVC = codecBase === 'hev1' || codecBase === 'hvc1';
    const isVP = codecBase === 'vp8' || codecBase === 'vp9' || codecBase === 'vp09';
    const isAV1 = codecBase === 'av01' || codecBase === 'av1';

    switch (bitrateMode) {
      case 'constant':
        // CBR - Constant Bitrate
        if (bitrate) {
          args.push('-b:v', String(bitrate));
          if (isH264 || isHEVC) {
            // Force CBR by setting maxrate and bufsize
            args.push('-maxrate', String(bitrate));
            args.push('-bufsize', String(bitrate * 2));
          } else if (isVP) {
            // VP8/VP9 CBR
            args.push('-minrate', String(bitrate));
            args.push('-maxrate', String(bitrate));
          } else if (isAV1) {
            // AV1 CBR mode
            args.push('-strict', 'experimental');
          }
        }
        break;

      case 'quantizer':
        // CRF/CQ - Constant Quality mode
        if (isH264 || isHEVC) {
          // Use CRF for x264/x265 (23 is default, lower = better quality)
          args.push('-crf', '23');
          if (bitrate) {
            // Use bitrate as max if specified
            args.push('-maxrate', String(bitrate));
            args.push('-bufsize', String(bitrate * 2));
          }
        } else if (isVP) {
          // VP8/VP9 CQ mode
          args.push('-crf', '31');
          args.push('-b:v', '0'); // Required for pure CRF mode in VP9
        } else if (isAV1) {
          // AV1 CQ mode
          args.push('-crf', '30');
        }
        break;

      case 'variable':
      default:
        // VBR - Variable Bitrate (default behavior)
        if (bitrate) {
          args.push('-b:v', String(bitrate));
          if (isH264 || isHEVC) {
            // Allow variation around target
            args.push('-maxrate', String(Math.floor(bitrate * 1.5)));
            args.push('-bufsize', String(bitrate * 2));
          }
        }
        break;
    }
  }

  private _startProcess(args: string[]): void {
    if (this.process) {
      throw new Error('FFmpeg process already running');
    }

    this.process = spawn(this.ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this._isRunning = true;

    this.process.stdout?.on('data', (data: Buffer) => {
      this._handleStdoutData(data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('error', new Error(`FFmpeg: ${data.toString()}`));
    });

    this.process.on('close', (code) => {
      this._handleProcessClose(code);
    });

    this.process.on('error', (err) => {
      this._isRunning = false;
      this.emit('error', err);
    });
  }

  /**
   * Handle stdout data from FFmpeg
   */
  private _handleStdoutData(data: Buffer): void {
    this.accumulatedData = Buffer.concat([this.accumulatedData, data]);

    // Emit complete frames when we have enough data (for decoder - raw frames)
    while (this.frameSize > 0 && this.accumulatedData.length >= this.frameSize) {
      const frame = this.accumulatedData.subarray(0, this.frameSize);
      this.accumulatedData = this.accumulatedData.subarray(this.frameSize);
      this.emit('frame', frame);
    }

    // For encoded output, parse container format
    if (this.frameSize === 0 && this._useIvf && this._ivfState) {
      this._parseIvfOutput(data);
    } else if (this.frameSize === 0 && this._useAnnexB && this._annexBState) {
      this._parseAnnexBOutput(data);
    } else if (this.frameSize === 0) {
      // For other formats, emit raw data
      this.emit('data', data);
    }
  }

  /**
   * Parse IVF output and emit encoded frames
   */
  private _parseIvfOutput(data: Buffer): void {
    if (!this._ivfState) return;

    try {
      // Reset accumulated data since IVF parser manages its own buffer
      this.accumulatedData = Buffer.alloc(0);

      const frames = parseIvfFrames(this._ivfState, data, isVP9KeyFrame);
      for (const frame of frames) {
        this.emit('encodedFrame', frame);
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * Parse Annex B output and emit encoded frames
   */
  private _parseAnnexBOutput(data: Buffer): void {
    if (!this._annexBState) return;

    // Reset accumulated data since Annex B parser manages its own buffer
    this.accumulatedData = Buffer.alloc(0);

    const frames = parseAnnexBFrames(this._annexBState, data);
    for (const frame of frames) {
      this.emit('encodedFrame', frame);
    }
  }

  /**
   * Handle process close event
   */
  private _handleProcessClose(code: number | null): void {
    this._isRunning = false;
    this.process = null;

    // Emit any remaining Annex B frame
    if (this._useAnnexB && this._annexBState) {
      const finalFrame = flushAnnexBParser(this._annexBState);
      if (finalFrame) {
        this.emit('encodedFrame', finalFrame);
      }
    } else if (this.accumulatedData.length > 0) {
      // Emit any remaining raw data
      this.emit('data', this.accumulatedData);
      this.accumulatedData = Buffer.alloc(0);
    }

    this.emit('close', code);
  }

  /**
   * Write data to FFmpeg stdin
   * @returns true if write was queued successfully, false if process is not healthy
   */
  write(data: Buffer | Uint8Array): boolean {
    if (!this.isHealthy) {
      return false;
    }
    try {
      this.process!.stdin!.write(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal end of input data
   */
  end(): void {
    if (this.process?.stdin && !this._isShuttingDown) {
      try {
        this.process.stdin.end();
      } catch {
        // Ignore errors when ending stdin
      }
    }
  }

  /**
   * Gracefully shutdown the FFmpeg process with timeout
   */
  async shutdown(timeout: number = DEFAULT_SHUTDOWN_TIMEOUT): Promise<void> {
    if (!this.process || this._isShuttingDown) {
      return;
    }

    this._isShuttingDown = true;

    return new Promise((resolve) => {
      const forceKillTimeout = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        this._cleanup();
        resolve();
      }, timeout);

      const onExit = () => {
        clearTimeout(forceKillTimeout);
        this._cleanup();
        resolve();
      };

      if (this.process) {
        this.process.once('exit', onExit);
        this.process.once('error', onExit);

        try {
          this.process.stdin?.destroy();
        } catch {
          // Ignore stdin destroy errors
        }

        this.process.kill('SIGTERM');
      } else {
        clearTimeout(forceKillTimeout);
        this._cleanup();
        resolve();
      }
    });
  }

  /**
   * Kill the FFmpeg process immediately
   */
  kill(): void {
    if (this.process) {
      this._isShuttingDown = true;
      try {
        this.process.stdin?.destroy();
      } catch {
        // Ignore stdin destroy errors
      }
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
          this._cleanup();
        }
      }, 1000);
    }
    this._cleanup();
  }

  /**
   * Clean up internal state
   */
  private _cleanup(): void {
    this.process = null;
    this._isRunning = false;
    this._isShuttingDown = false;
    this.accumulatedData = Buffer.alloc(0);
    this.outputBuffer = [];
    this._ivfState = null;
    this._annexBState = null;
  }

  /**
   * Map WebCodecs codec string to FFmpeg codec
   */
  private _getFFmpegCodec(webCodec: string): string {
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
  private _getContainerFormat(webCodec: string): string {
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
   * Map pixel format names
   * @deprecated Use pixelFormatToFFmpeg from './formats.js' instead
   */
  static pixelFormatToFFmpeg(format: string): string {
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
    };
    return formatMap[format] || format.toLowerCase();
  }

  /**
   * @deprecated Use ffmpegToPixelFormat from './formats.js' instead
   */
  static ffmpegToPixelFormat(format: string): string {
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
    };
    return formatMap[format] || format.toUpperCase();
  }

  /**
   * Calculate frame size in bytes
   * @deprecated Use calculateFrameSize from './formats.js' instead
   */
  static calculateFrameSize(format: string, width: number, height: number): number {
    return calculateFrameSize(format, width, height);
  }
}

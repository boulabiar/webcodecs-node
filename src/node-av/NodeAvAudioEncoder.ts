/**
 * NodeAvAudioEncoder - Audio encoder using node-av native bindings
 *
 * Implements the AudioEncoderBackend interface for encoding audio samples
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Encoder, FilterAPI } from 'node-av/api';
import { Frame, Rational } from 'node-av/lib';
import {
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16P,
  AV_SAMPLE_FMT_S16,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_U8,
  AV_SAMPLE_FMT_S32,
  AV_PKT_FLAG_KEY,
  AV_CHANNEL_ORDER_NATIVE,
  AV_CH_LAYOUT_MONO,
  AV_CH_LAYOUT_STEREO,
  AV_CH_LAYOUT_5POINT1,
  AV_CH_LAYOUT_7POINT1,
  type AVSampleFormat,
  type FFEncoderCodec,
} from 'node-av/constants';

import type {
  AudioEncoderBackend,
  AudioEncoderBackendConfig,
  EncodedFrame,
} from '../backends/types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('NodeAvAudioEncoder');

/** Default sample rate for Opus codec */
const OPUS_SAMPLE_RATE = 48000;

/**
 * NodeAV-backed audio encoder implementing AudioEncoderBackend interface
 */
export class NodeAvAudioEncoder extends EventEmitter implements AudioEncoderBackend {
  private encoder: Encoder | null = null;
  private config: AudioEncoderBackendConfig | null = null;
  private frameIndex = 0;
  private queue: Array<{ buffer?: Buffer; frame?: Frame; owned?: boolean }> = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private sampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLT;
  private encoderSampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLTP;
  private timeBase: Rational = new Rational(1, OPUS_SAMPLE_RATE);
  private codecDescription: Buffer | null = null;
  private firstFrame = true;
  // Resampling support for Opus with non-48kHz input
  private resampler: FilterAPI | null = null;
  private needsResampling = false;
  private inputSampleRate = 0;
  private encoderSampleRate = 0;

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startEncoder(config: AudioEncoderBackendConfig): void {
    this.config = { ...config };

    const codecName = this.getEncoderName(config.codec);
    const isOpus = codecName === 'libopus';

    // Store sample rates
    this.inputSampleRate = config.sampleRate;
    this.encoderSampleRate = isOpus ? OPUS_SAMPLE_RATE : config.sampleRate;

    // For Opus with non-48kHz input, we need to resample
    this.needsResampling = isOpus && config.sampleRate !== OPUS_SAMPLE_RATE;
    if (this.needsResampling) {
      logger.info(`Opus requires 48kHz, will resample from ${config.sampleRate}Hz`);
    }

    // Set timeBase to match the ENCODER's sample rate (48kHz for Opus)
    // This ensures correct timestamp calculations for encoded output
    this.timeBase = new Rational(1, this.encoderSampleRate);

    // Input is always float32 interleaved from AudioData conversion
    this.sampleFormat = AV_SAMPLE_FMT_FLT;
  }

  private getEncoderName(codec: string): string {
    const codecLower = codec.toLowerCase();
    if (codecLower.startsWith('mp4a') || codecLower === 'aac') {
      return 'aac';
    } else if (codecLower === 'opus') {
      return 'libopus';
    } else if (codecLower === 'vorbis') {
      return 'libvorbis';
    } else if (codecLower === 'flac') {
      return 'flac';
    } else if (codecLower === 'mp3') {
      return 'libmp3lame';
    }
    return 'aac';
  }

  write(data: Buffer | Uint8Array): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ buffer: Buffer.from(data), owned: true });
    void this.processQueue();
    return true;
  }

  writeFrame(frame: Frame, owned: boolean = true): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    try {
      const buf = frame.toBuffer();
      if (owned) {
        try { frame.unref(); } catch { /* ignore */ }
      }
      this.queue.push({ buffer: Buffer.from(buf), owned: true });
      void this.processQueue();
      return true;
    } catch (err) {
      if (owned) {
        try { frame.unref(); } catch { /* ignore */ }
      }
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  end(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void this.finish().catch((err) => this.emit('error', err));
  }

  kill(): void {
    this.shuttingDown = true;
    this.cleanup();
    this.emit('close', null);
  }

  async shutdown(): Promise<void> {
    this.end();
  }

  private async processQueue(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      if (this.processing) return;
      this.processing = true;

      try {
        while (this.queue.length > 0) {
          const item = this.queue.shift()!;
          // Emit frameAccepted when frame starts processing (for dequeue event)
          setImmediate(() => this.emit('frameAccepted'));
          if (item.frame) {
            await this.encodeFrame(item.frame, item.owned ?? true);
          } else if (item.buffer) {
            await this.encodeBuffer(item.buffer);
          }
        }
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      } finally {
        this.processing = false;
        this.processingPromise = null;
      }
    })();

    return this.processingPromise;
  }

  private async ensureEncoder(): Promise<void> {
    if (this.encoder || !this.config) {
      return;
    }

    const encoderCodec = this.getEncoderCodec(this.config.codec);
    const options = this.buildEncoderOptions();

    // Store the encoder's required sample format
    this.encoderSampleFormat = options.sampleFormat;

    logger.info(`Using encoder: ${encoderCodec}, format: ${options.sampleFormat}`);

    this.encoder = await Encoder.create(encoderCodec as FFEncoderCodec, options);

    // Create resampler if needed (e.g., Opus with non-48kHz input)
    if (this.needsResampling && !this.resampler) {
      // Use aresample filter to convert sample rate
      // The filter handles high-quality resampling via libswresample
      const filterDesc = `aresample=${this.encoderSampleRate}:first_pts=0`;
      this.resampler = FilterAPI.create(filterDesc, {} as any);
      logger.info(`Created resampler: ${this.inputSampleRate}Hz -> ${this.encoderSampleRate}Hz`);
    }

    // Extract codec description (extradata) for codecs that require it
    this.extractCodecDescription();
  }

  private async encodeFrame(inputFrame: Frame, owned: boolean): Promise<void> {
    try {
      await this.ensureEncoder();
      if (!this.encoder || !this.config) {
        throw new Error('Encoder not initialized');
      }

      const matchesFormat = inputFrame.format === this.encoderSampleFormat;
      const matchesRate = Number(inputFrame.sampleRate ?? this.config.sampleRate) === this.config.sampleRate;

      if (matchesFormat && matchesRate) {
        inputFrame.pts = BigInt(this.frameIndex);
        const nbSamples = inputFrame.nbSamples ?? 0;
        try {
          await this.encoder.encode(inputFrame);
          if (owned) {
            inputFrame.unref();
          }
          await this.drainPackets();
          this.frameIndex += nbSamples;
          return;
        } catch (err) {
          // Fallback to buffer path if direct encode fails
          logger.debug(`Direct frame encode failed, falling back to buffer: ${err instanceof Error ? err.message : err}`);
        }
      }

      const buffer = inputFrame.toBuffer();
      if (owned) {
        inputFrame.unref();
      }
      await this.encodeBuffer(buffer);
    } catch (err) {
      if (owned) {
        try { inputFrame.unref(); } catch { /* ignore */ }
      }
      throw err;
    }
  }

  private extractCodecDescription(): void {
    if (!this.encoder || !this.config) return;
    if (this.codecDescription) return; // Already extracted

    const codecBase = this.config.codec.split('.')[0].toLowerCase();

    try {
      const ctx = this.encoder.getCodecContext();
      if (!ctx) return;

      const extraData = ctx.extraData;
      if (!extraData || extraData.length === 0) return;

      if (codecBase === 'mp4a' || codecBase === 'aac') {
        // AAC: extradata contains AudioSpecificConfig (including PCE if needed)
        // This is the proper description for MP4 muxing and decoding
        this.codecDescription = Buffer.from(extraData);
        logger.debug(`AAC description from extradata: ${this.codecDescription.length} bytes`);
      } else if (codecBase === 'opus') {
        // Opus: extradata contains OpusHead structure
        // Required for multi-channel Opus decoding
        this.codecDescription = Buffer.from(extraData);
        logger.debug(`Opus description from extradata: ${this.codecDescription.length} bytes`);
      } else if (codecBase === 'flac') {
        // FLAC description: 'fLaC' magic + STREAMINFO block
        // The extradata from FFmpeg is just the STREAMINFO, we need to prepend magic
        const magic = Buffer.from('fLaC');
        // STREAMINFO block header: type (0x00 for STREAMINFO) | last-block flag (0x80 if last)
        // followed by 3-byte length
        const blockHeader = Buffer.from([0x80, 0x00, 0x00, extraData.length]);
        this.codecDescription = Buffer.concat([magic, blockHeader, extraData]);
        logger.debug(`FLAC description: ${this.codecDescription.length} bytes`);
      } else if (codecBase === 'vorbis') {
        // Vorbis description is the identification + comment + setup headers
        // The extradata from FFmpeg should contain all three headers
        this.codecDescription = Buffer.from(extraData);
        logger.debug(`Vorbis description: ${this.codecDescription.length} bytes`);
      }
    } catch (err) {
      logger.debug(`Failed to extract codec description: ${err}`);
    }
  }

  private getEncoderCodec(codec: string): string {
    const codecBase = codec.split('.')[0].toLowerCase();

    switch (codecBase) {
      case 'opus':
        return 'libopus';
      case 'mp3':
        return 'libmp3lame';
      case 'flac':
        return 'flac';
      case 'mp4a':
      case 'aac':
        return 'aac';
      case 'vorbis':
        return 'libvorbis';
      case 'pcm-s16':
        return 'pcm_s16le';
      case 'pcm-s24':
        return 'pcm_s24le';
      case 'pcm-s32':
        return 'pcm_s32le';
      case 'pcm-u8':
        return 'pcm_u8';
      case 'ulaw':
        return 'pcm_mulaw';
      case 'alaw':
        return 'pcm_alaw';
      case 'pcm-f32':
        return 'pcm_f32le';
      default:
        return 'aac';
    }
  }

  private buildEncoderOptions() {
    if (!this.config) {
      throw new Error('Config not set');
    }

    const codecBase = this.config.codec.split('.')[0].toLowerCase();
    const isOpus = codecBase === 'opus';
    const isVorbis = codecBase === 'vorbis';
    const isFlac = codecBase === 'flac';
    const isRealtime = this.config.latencyMode === 'realtime';

    // Determine output sample format based on codec requirements
    // Each codec has specific format requirements:
    // - libopus: s16 or flt (interleaved only)
    // - libvorbis: fltp (planar float)
    // - aac: fltp (planar float)
    // - flac: s16, s32 (interleaved signed)
    let sampleFormat: AVSampleFormat;
    if (isOpus) {
      // libopus only supports s16 or flt (interleaved)
      sampleFormat = AV_SAMPLE_FMT_FLT;
    } else if (isVorbis) {
      sampleFormat = AV_SAMPLE_FMT_FLTP;
    } else if (isFlac || codecBase === 'pcm-s16') {
      // flac encoder requires interleaved s16 or s32
      sampleFormat = AV_SAMPLE_FMT_S16;
    } else if (codecBase === 'pcm-s24' || codecBase === 'pcm-s32') {
      sampleFormat = AV_SAMPLE_FMT_S32;
    } else if (codecBase === 'pcm-u8') {
      sampleFormat = AV_SAMPLE_FMT_U8;
    } else if (codecBase === 'ulaw' || codecBase === 'alaw') {
      sampleFormat = AV_SAMPLE_FMT_S16;
    } else {
      // Most codecs work with float planar (aac, etc.)
      sampleFormat = AV_SAMPLE_FMT_FLTP;
    }

    const options: Record<string, string | number> = {};

    // Codec-specific options
    if (isOpus) {
      options.application = isRealtime ? 'voip' : 'audio';
      if (isRealtime) {
        options.frame_duration = '10';
      }
    }

    // Frame size configuration for specific codecs
    if (isFlac) {
      // FLAC default block size is 4608 samples, which is too large for small inputs
      // Use a smaller frame size to allow encoding of smaller buffers
      options.frame_size = '1024';
    }

    return {
      type: 'audio' as const,
      sampleRate: isOpus ? OPUS_SAMPLE_RATE : this.config.sampleRate,
      channelLayout: this.getChannelLayout(this.config.numberOfChannels),
      sampleFormat,
      timeBase: this.timeBase,
      bitrate: this.config.bitrate,
      options,
    };
  }

  private getChannelLayout(numChannels: number): { nbChannels: number; order: number; mask: bigint } {
    // Standard channel layouts as ChannelLayout objects
    // Order 1 = AV_CHANNEL_ORDER_NATIVE (required for FFmpeg)
    switch (numChannels) {
      case 1:
        return { nbChannels: 1, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_MONO };
      case 2:
        return { nbChannels: 2, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_STEREO };
      case 6:
        return { nbChannels: 6, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_5POINT1 };
      case 8:
        return { nbChannels: 8, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_7POINT1 };
      default:
        return { nbChannels: numChannels, order: AV_CHANNEL_ORDER_NATIVE, mask: BigInt((1 << numChannels) - 1) };
    }
  }

  private async encodeBuffer(buffer: Buffer): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    // Buffer is f32le interleaved, we need to convert to the encoder's expected format
    // Calculate number of samples (each sample is 4 bytes for f32)
    const bytesPerSample = 4;
    const totalSamples = buffer.length / bytesPerSample;
    const samplesPerChannel = Math.floor(totalSamples / this.config.numberOfChannels);

    if (samplesPerChannel === 0) {
      return;
    }

    // Prepare audio data based on encoder's expected format
    let audioData: Buffer;
    let frameFormat: AVSampleFormat;

    if (this.encoderSampleFormat === AV_SAMPLE_FMT_FLT) {
      // Encoder needs interleaved float - use input buffer directly
      audioData = buffer;
      frameFormat = AV_SAMPLE_FMT_FLT;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S16) {
      // Encoder needs interleaved s16 - convert from f32 interleaved to s16 interleaved
      audioData = Buffer.from(this.convertToS16Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S16;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S16P) {
      // Encoder needs planar s16 - convert from f32 interleaved to s16 planar
      audioData = Buffer.from(this.convertToS16Planar(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S16P;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S32) {
      // Encoder needs interleaved s32 - convert from f32 interleaved to s32 interleaved
      audioData = Buffer.from(this.convertToS32Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S32;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_U8) {
      audioData = Buffer.from(this.convertToU8Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_U8;
    } else {
      // Default: encoder needs planar float - convert from f32 interleaved to f32 planar
      audioData = Buffer.from(this.convertToPlanar(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_FLTP;
    }

    // Create input frame at INPUT sample rate
    const inputFrame = Frame.fromAudioBuffer(audioData, {
      sampleRate: this.inputSampleRate,
      channelLayout: this.getChannelLayout(this.config.numberOfChannels),
      format: frameFormat,
      nbSamples: samplesPerChannel,
      timeBase: new Rational(1, this.inputSampleRate),
    });

    // If resampling is needed, process through resampler
    if (this.needsResampling && this.resampler) {
      // Set input PTS for correct resampler timing
      // Use input sample count (not output) for input frame timing
      inputFrame.pts = BigInt(this.frameIndex);

      await this.resampler.process(inputFrame);
      inputFrame.unref();

      // Drain all resampled frames and encode them
      // Note: receive() returns null when no output is ready yet, undefined/false when done
      let resampledFrame = await this.resampler.receive();
      while (resampledFrame) {
        const outputSamples = resampledFrame.nbSamples ?? 0;
        // PTS comes from resampler, but we track output sample count for our index
        resampledFrame.pts = BigInt(this.frameIndex);

        await this.encoder.encode(resampledFrame);
        resampledFrame.unref();

        this.frameIndex += outputSamples;

        // Get next frame
        resampledFrame = await this.resampler.receive();
      }
    } else {
      // No resampling - encode directly
      inputFrame.pts = BigInt(this.frameIndex);
      await this.encoder.encode(inputFrame);
      inputFrame.unref();
      this.frameIndex += samplesPerChannel;
    }

    // Try to extract codec description after first encode (some codecs like FLAC
    // don't populate extradata until after encoding starts)
    this.extractCodecDescription();

    await this.drainPackets();
  }

  private convertToPlanar(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
    const bytesPerSample = 4; // f32
    const planeSize = samplesPerChannel * bytesPerSample;
    const result = new Uint8Array(planeSize * numChannels);

    const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const output = new Float32Array(result.buffer);

    for (let s = 0; s < samplesPerChannel; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const srcIdx = s * numChannels + ch;
        const dstIdx = ch * samplesPerChannel + s;
        output[dstIdx] = input[srcIdx];
      }
    }

    return result;
  }

  private convertToS16Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
    const totalSamples = samplesPerChannel * numChannels;
    const result = new Uint8Array(totalSamples * 2); // 2 bytes per s16 sample

    const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const output = new Int16Array(result.buffer);

    for (let i = 0; i < totalSamples; i++) {
      // Convert f32 [-1.0, 1.0] to s16 [-32768, 32767]
      const clamped = Math.max(-1.0, Math.min(1.0, input[i]));
      output[i] = Math.round(clamped * 32767);
    }

    return result;
  }

  private convertToS32Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
    const totalSamples = samplesPerChannel * numChannels;
    const result = new Uint8Array(totalSamples * 4); // 4 bytes per s32 sample

    const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const output = new Int32Array(result.buffer);

    for (let i = 0; i < totalSamples; i++) {
      const clamped = Math.max(-1.0, Math.min(1.0, input[i]));
      output[i] = Math.round(clamped * 2147483647);
    }

    return result;
  }

  private convertToS16Planar(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
    const bytesPerSample = 2; // s16
    const planeSize = samplesPerChannel * bytesPerSample;
    const result = new Uint8Array(planeSize * numChannels);

    const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const output = new Int16Array(result.buffer);

    for (let s = 0; s < samplesPerChannel; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const srcIdx = s * numChannels + ch;
        const dstIdx = ch * samplesPerChannel + s;
        // Convert f32 [-1.0, 1.0] to s16 [-32768, 32767]
        const clamped = Math.max(-1.0, Math.min(1.0, input[srcIdx]));
        output[dstIdx] = Math.round(clamped * 32767);
      }
    }

    return result;
  }

  private convertToU8Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
    const totalSamples = samplesPerChannel * numChannels;
    const result = new Uint8Array(totalSamples);

    const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);

    for (let i = 0; i < totalSamples; i++) {
      const clamped = Math.max(-1.0, Math.min(1.0, input[i]));
      const u8 = Math.round((clamped + 1) * 127.5); // map [-1,1] to [0,255]
      result[i] = u8;
    }

    return result;
  }

  private async finish(): Promise<void> {
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
    }

    // Flush resampler if present - encode any remaining buffered samples
    if (this.resampler && this.encoder) {
      try {
        // Signal EOF to resampler to flush its internal buffers
        await this.resampler.process(null as any);

        // Drain remaining frames
        let resampledFrame = await this.resampler.receive();
        while (resampledFrame) {
          const outputSamples = resampledFrame.nbSamples ?? 0;
          resampledFrame.pts = BigInt(this.frameIndex);
          await this.encoder.encode(resampledFrame);
          resampledFrame.unref();
          this.frameIndex += outputSamples;

          resampledFrame = await this.resampler.receive();
        }
        await this.drainPackets();
      } catch (err) {
        // Resampler flush errors are non-fatal
        logger.debug(`Resampler flush error: ${err}`);
      }
    }

    if (this.encoder) {
      try {
        await this.encoder.flush();
        await this.drainPackets();
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.emit('close', 0);
    this.cleanup();
  }

  private async drainPackets(): Promise<void> {
    if (!this.encoder) return;

    let packet = await this.encoder.receive();
    while (packet) {
      if (packet.data) {
        const timestamp = packet.pts !== undefined ? Number(packet.pts) : this.frameIndex;
        const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || (packet as any).isKeyframe;
        const frameData: any = {
          data: Buffer.from(packet.data),
          timestamp,
          keyFrame,
        };
        // Include codec description on the first frame
        if (this.firstFrame && this.codecDescription) {
          frameData.description = this.codecDescription;
          this.firstFrame = false;
        }
        this.emit('encodedFrame', frameData);
      }
      packet.unref();
      packet = await this.encoder.receive();
    }
  }

  private cleanup(): void {
    this.resampler?.close();
    this.resampler = null;
    this.encoder?.close();
    this.encoder = null;
    this.queue = [];
  }
}

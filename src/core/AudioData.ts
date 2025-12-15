/**
 * AudioData - Represents an audio sample
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioData
 */

import { DOMException } from '../types/index.js';
import {
  type AudioSampleFormat,
  type AudioDataInit,
  type AudioDataCopyToOptions,
} from '../types/audio.js';
import {
  BYTES_PER_SAMPLE,
  isPlanarFormat,
} from '../formats/audio-formats.js';

// Re-export types for backwards compatibility
export type { AudioSampleFormat, AudioDataInit, AudioDataCopyToOptions };

export class AudioData {
  private _format: AudioSampleFormat;
  private _sampleRate: number;
  private _numberOfFrames: number;
  private _numberOfChannels: number;
  private _timestamp: number;
  private _duration: number;
  private _buffer: ArrayBuffer;
  private _closed = false;

  constructor(init: AudioDataInit) {
    if (!init) {
      throw new TypeError('AudioDataInit is required');
    }

    if (!init.format || !BYTES_PER_SAMPLE[init.format]) {
      throw new TypeError(`Invalid audio format: ${init.format}`);
    }

    if (!init.sampleRate || init.sampleRate <= 0) {
      throw new TypeError('sampleRate must be positive');
    }

    if (!init.numberOfFrames || init.numberOfFrames <= 0) {
      throw new TypeError('numberOfFrames must be positive');
    }

    if (!init.numberOfChannels || init.numberOfChannels <= 0) {
      throw new TypeError('numberOfChannels must be positive');
    }

    if (typeof init.timestamp !== 'number') {
      throw new TypeError('timestamp is required');
    }

    if (!init.data) {
      throw new TypeError('data is required');
    }

    this._format = init.format;
    this._sampleRate = init.sampleRate;
    this._numberOfFrames = init.numberOfFrames;
    this._numberOfChannels = init.numberOfChannels;
    this._timestamp = init.timestamp;

    // Duration in microseconds (must be an integer per spec)
    this._duration = Math.floor((init.numberOfFrames / init.sampleRate) * 1_000_000);

    // Copy or transfer the data
    if (init.data instanceof ArrayBuffer) {
      if (init.transfer?.includes(init.data)) {
        this._buffer = init.data;
      } else {
        this._buffer = init.data.slice(0);
      }
    } else {
      // ArrayBufferView
      const view = init.data;
      const srcBuffer = view.buffer as ArrayBuffer;
      if (init.transfer?.includes(srcBuffer)) {
        this._buffer = srcBuffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      } else {
        this._buffer = srcBuffer.slice(
          view.byteOffset,
          view.byteOffset + view.byteLength
        );
      }
    }

    // Validate data size
    const expectedSize = this._calculateTotalSize();
    if (this._buffer.byteLength < expectedSize) {
      throw new TypeError(
        `Data buffer too small: ${this._buffer.byteLength} < ${expectedSize}`
      );
    }
  }

  get format(): AudioSampleFormat | null { return this._closed ? null : this._format; }
  get sampleRate(): number { return this._closed ? 0 : this._sampleRate; }
  get numberOfFrames(): number { return this._closed ? 0 : this._numberOfFrames; }
  get numberOfChannels(): number { return this._closed ? 0 : this._numberOfChannels; }
  get timestamp(): number { return this._closed ? 0 : this._timestamp; }
  get duration(): number { return this._closed ? 0 : this._duration; }

  allocationSize(options: AudioDataCopyToOptions): number {
    this._checkClosed();

    const frameCount = options.frameCount ?? this._numberOfFrames;
    const format = options.format ?? this._format;
    const bytesPerSample = BYTES_PER_SAMPLE[format];

    if (this._isPlanar(format)) {
      return frameCount * bytesPerSample;
    } else {
      return frameCount * this._numberOfChannels * bytesPerSample;
    }
  }

  copyTo(destination: ArrayBufferView, options: AudioDataCopyToOptions): void {
    this._checkClosed();

    const planeIndex = options.planeIndex;
    const frameOffset = options.frameOffset ?? 0;
    const frameCount = options.frameCount ?? (this._numberOfFrames - frameOffset);
    const destFormat = options.format ?? this._format;

    // When converting to planar format, validate planeIndex against destination planes
    // When copying same format, validate against source format
    const destIsPlanar = this._isPlanar(destFormat);
    const srcIsPlanar = this._isPlanar(this._format);
    const numPlanes = destIsPlanar ? this._numberOfChannels : (srcIsPlanar ? this._numberOfChannels : 1);
    if (planeIndex < 0 || planeIndex >= numPlanes) {
      throw new RangeError(`Invalid planeIndex: ${planeIndex}`);
    }

    if (frameOffset < 0 || frameOffset + frameCount > this._numberOfFrames) {
      throw new RangeError('Frame range out of bounds');
    }

    const srcBytesPerSample = BYTES_PER_SAMPLE[this._format];
    const dstBytesPerSample = BYTES_PER_SAMPLE[destFormat];

    const srcView = new DataView(this._buffer);
    const dstArray = new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength);
    const dstView = new DataView(dstArray.buffer, dstArray.byteOffset, dstArray.byteLength);

    if (this._format === destFormat) {
      this._copyDirect(srcView, dstView, planeIndex, frameOffset, frameCount);
    } else {
      this._copyWithConversion(srcView, dstView, planeIndex, frameOffset, frameCount, destFormat);
    }
  }

  clone(): AudioData {
    this._checkClosed();
    const dataCopy = new Uint8Array(this._buffer.slice(0));
    return new AudioData({
      format: this._format,
      sampleRate: this._sampleRate,
      numberOfFrames: this._numberOfFrames,
      numberOfChannels: this._numberOfChannels,
      timestamp: this._timestamp,
      data: dataCopy,
    });
  }

  close(): void {
    this._closed = true;
    (this as any)._buffer = null;
  }

  get _rawBuffer(): ArrayBuffer {
    this._checkClosed();
    return this._buffer;
  }

  private _checkClosed(): void {
    if (this._closed) {
      throw new DOMException('AudioData is closed', 'InvalidStateError');
    }
  }

  private _isPlanar(format: AudioSampleFormat): boolean {
    return isPlanarFormat(format);
  }

  private _calculateTotalSize(): number {
    const bytesPerSample = BYTES_PER_SAMPLE[this._format];
    return this._numberOfFrames * this._numberOfChannels * bytesPerSample;
  }

  private _copyDirect(
    src: DataView, dst: DataView,
    planeIndex: number, frameOffset: number, frameCount: number
  ): void {
    const bytesPerSample = BYTES_PER_SAMPLE[this._format];

    if (this._isPlanar(this._format)) {
      const planeSize = this._numberOfFrames * bytesPerSample;
      const srcOffset = planeIndex * planeSize + frameOffset * bytesPerSample;
      const byteCount = frameCount * bytesPerSample;

      const srcArray = new Uint8Array(src.buffer, src.byteOffset + srcOffset, byteCount);
      const dstArray = new Uint8Array(dst.buffer, dst.byteOffset, byteCount);
      dstArray.set(srcArray);
    } else {
      const frameSize = this._numberOfChannels * bytesPerSample;
      const srcOffset = frameOffset * frameSize;
      const byteCount = frameCount * frameSize;

      const srcArray = new Uint8Array(src.buffer, src.byteOffset + srcOffset, byteCount);
      const dstArray = new Uint8Array(dst.buffer, dst.byteOffset, byteCount);
      dstArray.set(srcArray);
    }
  }

  private _copyWithConversion(
    src: DataView, dst: DataView,
    planeIndex: number, frameOffset: number, frameCount: number,
    destFormat: AudioSampleFormat
  ): void {
    const srcIsPlanar = this._isPlanar(this._format);
    const dstIsPlanar = this._isPlanar(destFormat);
    const srcBytesPerSample = BYTES_PER_SAMPLE[this._format];
    const dstBytesPerSample = BYTES_PER_SAMPLE[destFormat];

    for (let frame = 0; frame < frameCount; frame++) {
      const srcFrame = frameOffset + frame;

      if (srcIsPlanar && dstIsPlanar) {
        const srcOffset = planeIndex * this._numberOfFrames * srcBytesPerSample + srcFrame * srcBytesPerSample;
        const dstOffset = frame * dstBytesPerSample;
        const sample = this._readSample(src, srcOffset, this._format);
        this._writeSample(dst, dstOffset, sample, destFormat);
      } else if (!srcIsPlanar && !dstIsPlanar) {
        for (let ch = 0; ch < this._numberOfChannels; ch++) {
          const srcOffset = (srcFrame * this._numberOfChannels + ch) * srcBytesPerSample;
          const dstOffset = (frame * this._numberOfChannels + ch) * dstBytesPerSample;
          const sample = this._readSample(src, srcOffset, this._format);
          this._writeSample(dst, dstOffset, sample, destFormat);
        }
      } else if (srcIsPlanar && !dstIsPlanar) {
        const srcOffset = planeIndex * this._numberOfFrames * srcBytesPerSample + srcFrame * srcBytesPerSample;
        const dstOffset = frame * dstBytesPerSample;
        const sample = this._readSample(src, srcOffset, this._format);
        this._writeSample(dst, dstOffset, sample, destFormat);
      } else {
        const srcOffset = (srcFrame * this._numberOfChannels + planeIndex) * srcBytesPerSample;
        const dstOffset = frame * dstBytesPerSample;
        const sample = this._readSample(src, srcOffset, this._format);
        this._writeSample(dst, dstOffset, sample, destFormat);
      }
    }
  }

  private _readSample(view: DataView, offset: number, format: AudioSampleFormat): number {
    const baseFormat = format.replace('-planar', '') as 'u8' | 's16' | 's32' | 'f32';
    switch (baseFormat) {
      case 'u8': return (view.getUint8(offset) - 128) / 128;
      case 's16': return view.getInt16(offset, true) / 32768;
      case 's32': return view.getInt32(offset, true) / 2147483648;
      case 'f32': return view.getFloat32(offset, true);
      default: return 0;
    }
  }

  private _writeSample(view: DataView, offset: number, sample: number, format: AudioSampleFormat): void {
    const baseFormat = format.replace('-planar', '') as 'u8' | 's16' | 's32' | 'f32';
    sample = Math.max(-1, Math.min(1, sample));
    switch (baseFormat) {
      case 'u8': view.setUint8(offset, Math.round(sample * 127 + 128)); break;
      case 's16': view.setInt16(offset, Math.round(sample * 32767), true); break;
      case 's32': view.setInt32(offset, Math.round(sample * 2147483647), true); break;
      case 'f32': view.setFloat32(offset, sample, true); break;
    }
  }
}

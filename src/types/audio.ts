/**
 * Audio-related type definitions
 */

// Re-export audio sample format from formats module
export type { AudioSampleFormat } from '../formats/audio-formats.js';

/**
 * Initialization options for creating AudioData
 */
export interface AudioDataInit {
  format: import('../formats/audio-formats.js').AudioSampleFormat;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: ArrayBufferView | ArrayBuffer;
  transfer?: ArrayBuffer[];
}

/**
 * Options for AudioData.copyTo()
 */
export interface AudioDataCopyToOptions {
  planeIndex: number;
  frameOffset?: number;
  frameCount?: number;
  format?: import('../formats/audio-formats.js').AudioSampleFormat;
}

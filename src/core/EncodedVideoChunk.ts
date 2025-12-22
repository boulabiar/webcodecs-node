/**
 * EncodedVideoChunk - Represents a chunk of encoded video data
 * https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk
 */

import type { BufferSource } from '../types/index.js';

export type EncodedVideoChunkType = 'key' | 'delta';

export interface EncodedVideoChunkInit {
  type: EncodedVideoChunkType;
  timestamp: number;
  duration?: number;
  data: BufferSource;
}

export class EncodedVideoChunk {
  private _data: Uint8Array;

  readonly type: EncodedVideoChunkType;
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;

  constructor(init: EncodedVideoChunkInit) {
    if (!init.type || (init.type !== 'key' && init.type !== 'delta')) {
      throw new TypeError("type must be 'key' or 'delta'");
    }
    if (typeof init.timestamp !== 'number') {
      throw new TypeError('timestamp must be a number');
    }
    if (!init.data) {
      throw new TypeError('data is required');
    }

    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? null;

    if (init.data instanceof ArrayBuffer) {
      this._data = new Uint8Array(init.data);
    } else if (ArrayBuffer.isView(init.data)) {
      this._data = new Uint8Array(init.data.buffer, init.data.byteOffset, init.data.byteLength);
    } else {
      throw new TypeError('data must be an ArrayBuffer or ArrayBufferView');
    }

    this.byteLength = this._data.byteLength;
  }

  copyTo(destination: BufferSource): void {
    let destArray: Uint8Array;
    if (destination instanceof ArrayBuffer) {
      destArray = new Uint8Array(destination);
    } else if (ArrayBuffer.isView(destination)) {
      destArray = new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength);
    } else {
      throw new TypeError('destination must be an ArrayBuffer or ArrayBufferView');
    }

    if (destArray.byteLength < this._data.byteLength) {
      throw new TypeError('destination buffer is too small');
    }

    destArray.set(this._data);
  }

  get _buffer(): Uint8Array {
    return this._data;
  }
}

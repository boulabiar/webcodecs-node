/**
 * EncodedAudioChunk - Represents a chunk of encoded audio data
 * https://developer.mozilla.org/en-US/docs/Web/API/EncodedAudioChunk
 */

export type EncodedAudioChunkType = 'key' | 'delta';

export interface EncodedAudioChunkInit {
  type: EncodedAudioChunkType;
  timestamp: number;
  duration?: number;
  data: ArrayBufferView | ArrayBuffer;
  transfer?: ArrayBuffer[];
}

export class EncodedAudioChunk {
  private _type: EncodedAudioChunkType;
  private _timestamp: number;
  private _duration: number | undefined;
  private _data: ArrayBuffer;

  constructor(init: EncodedAudioChunkInit) {
    if (!init) {
      throw new TypeError('EncodedAudioChunkInit is required');
    }

    if (init.type !== 'key' && init.type !== 'delta') {
      throw new TypeError('type must be "key" or "delta"');
    }

    if (typeof init.timestamp !== 'number') {
      throw new TypeError('timestamp is required');
    }

    if (!init.data) {
      throw new TypeError('data is required');
    }

    this._type = init.type;
    this._timestamp = init.timestamp;
    this._duration = init.duration;

    if (init.data instanceof ArrayBuffer) {
      if (init.transfer?.includes(init.data)) {
        this._data = init.data;
      } else {
        this._data = init.data.slice(0);
      }
    } else {
      const view = init.data;
      const srcBuffer = view.buffer as ArrayBuffer;
      this._data = srcBuffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
  }

  get type(): EncodedAudioChunkType { return this._type; }
  get timestamp(): number { return this._timestamp; }
  get duration(): number | undefined { return this._duration; }
  get byteLength(): number { return this._data.byteLength; }

  copyTo(destination: ArrayBufferView): void {
    if (!destination) {
      throw new TypeError('destination is required');
    }

    const destArray = new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength);

    if (destArray.byteLength < this._data.byteLength) {
      throw new TypeError(`Destination buffer too small: ${destArray.byteLength} < ${this._data.byteLength}`);
    }

    destArray.set(new Uint8Array(this._data));
  }

  get _rawData(): Uint8Array {
    return new Uint8Array(this._data);
  }
}

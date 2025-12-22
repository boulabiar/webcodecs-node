/**
 * Buffer and ArrayBuffer utilities
 */

import { BufferSource } from '../types/index.js';

/**
 * Convert any BufferSource to Uint8Array
 */
export function toUint8Array(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  } else if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  throw new TypeError('source must be an ArrayBuffer or ArrayBufferView');
}

/**
 * Copy BufferSource to a new Uint8Array
 */
export function copyToUint8Array(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source.slice(0));
  } else if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return copy;
  }
  throw new TypeError('source must be an ArrayBuffer or ArrayBufferView');
}

/**
 * Concatenate multiple Uint8Arrays into one
 */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Check if an object is a ReadableStream
 */
export function isReadableStream(obj: unknown): obj is ReadableStream {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as ReadableStream).getReader === 'function'
  );
}

/**
 * Read a ReadableStream completely into a Uint8Array
 */
export async function readStreamToUint8Array(stream: ReadableStream<ArrayBufferView>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        chunks.push(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return concatUint8Arrays(chunks);
}

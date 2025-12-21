/**
 * EncodedVideoChunk Tests - Adapted from WPT
 */

import {
  test,
  assert_equals,
  assert_throws_js,
  makeDetachedArrayBuffer,
  printSummary,
} from './wpt-adapter.mjs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           EncodedVideoChunk Tests (WPT Adapted)            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Test 1: Basic construction
test(t => {
  let chunk = new EncodedVideoChunk({
    type: 'key',
    timestamp: 10,
    duration: 300,
    data: new Uint8Array([0x0A, 0x0B, 0x0C])
  });
  assert_equals(chunk.type, 'key', 'type');
  assert_equals(chunk.timestamp, 10, 'timestamp');
  assert_equals(chunk.duration, 300, 'duration');
  assert_equals(chunk.byteLength, 3, 'byteLength');
  let copyDest = new Uint8Array(3);
  chunk.copyTo(copyDest);
  assert_equals(copyDest[0], 0x0A, 'copyDest[0]');
  assert_equals(copyDest[1], 0x0B, 'copyDest[1]');
  assert_equals(copyDest[2], 0x0C, 'copyDest[2]');

  // Make another chunk with different values for good measure.
  chunk = new EncodedVideoChunk({
    type: 'delta',
    timestamp: 100,
    data: new Uint8Array([0x00, 0x01])
  });
  assert_equals(chunk.type, 'delta', 'type');
  assert_equals(chunk.timestamp, 100, 'timestamp');
  assert_equals(chunk.duration, null, 'duration');
  assert_equals(chunk.byteLength, 2, 'byteLength');
  copyDest = new Uint8Array(2);
  chunk.copyTo(copyDest);
  assert_equals(copyDest[0], 0x00, 'copyDest[0]');
  assert_equals(copyDest[1], 0x01, 'copyDest[1]');
}, 'Test we can construct an EncodedVideoChunk.');

// Test 2: copyTo exception if destination invalid (matches original WPT)
test(t => {
  let chunk = new EncodedVideoChunk({
    type: 'delta',
    timestamp: 100,
    data: new Uint8Array([0x00, 0x01, 0x02])
  });
  assert_throws_js(
    TypeError,
    () => chunk.copyTo(new Uint8Array(2)),
    'destination is not large enough'
  );

  const detached = makeDetachedArrayBuffer();
  assert_throws_js(
    TypeError,
    () => chunk.copyTo(detached),
    'destination is detached'
  );
}, 'Test copyTo() exception if destination invalid');

// Test 3: Zero-sized chunk
test(t => {
  let chunk = new EncodedVideoChunk({
    type: 'key',
    timestamp: 10,
    duration: 300,
    data: new Uint8Array()
  });
  assert_equals(chunk.byteLength, 0, 'byteLength');
  let copyDest = new Uint8Array();
  chunk.copyTo(copyDest);
  assert_equals(copyDest.length, 0, 'copyDest.length');
}, 'Test we can construct a zero-sized EncodedVideoChunk.');

// Test 4: Construction with ArrayBuffer
test(t => {
  const data = new ArrayBuffer(3);
  const view = new Uint8Array(data);
  view[0] = 0xAA;
  view[1] = 0xBB;
  view[2] = 0xCC;

  let chunk = new EncodedVideoChunk({
    type: 'key',
    timestamp: 42,
    data: data
  });
  assert_equals(chunk.byteLength, 3, 'byteLength');
  let copyDest = new Uint8Array(3);
  chunk.copyTo(copyDest);
  assert_equals(copyDest[0], 0xAA, 'copyDest[0]');
  assert_equals(copyDest[1], 0xBB, 'copyDest[1]');
  assert_equals(copyDest[2], 0xCC, 'copyDest[2]');
}, 'Test EncodedVideoChunk with ArrayBuffer data');

// Test 5: Large timestamp values
test(t => {
  let chunk = new EncodedVideoChunk({
    type: 'key',
    timestamp: Number.MAX_SAFE_INTEGER,
    data: new Uint8Array([0x00])
  });
  assert_equals(chunk.timestamp, Number.MAX_SAFE_INTEGER, 'large timestamp');
}, 'Test EncodedVideoChunk with large timestamp');

// Test 6: Negative timestamp
test(t => {
  let chunk = new EncodedVideoChunk({
    type: 'key',
    timestamp: -1000,
    data: new Uint8Array([0x00])
  });
  assert_equals(chunk.timestamp, -1000, 'negative timestamp');
}, 'Test EncodedVideoChunk with negative timestamp');

// Test 7: Missing required parameters
test(t => {
  assert_throws_js(TypeError, () => {
    new EncodedVideoChunk({
      type: 'key',
      // missing timestamp and data
    });
  }, 'missing timestamp and data');

  assert_throws_js(TypeError, () => {
    new EncodedVideoChunk({
      type: 'key',
      timestamp: 0,
      // missing data
    });
  }, 'missing data');
}, 'Test EncodedVideoChunk throws on missing required parameters');

// Test 8: Invalid type
test(t => {
  assert_throws_js(TypeError, () => {
    new EncodedVideoChunk({
      type: 'invalid',
      timestamp: 0,
      data: new Uint8Array([0x00])
    });
  }, 'invalid type');
}, 'Test EncodedVideoChunk throws on invalid type');

printSummary();

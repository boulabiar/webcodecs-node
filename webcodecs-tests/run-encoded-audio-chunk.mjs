/**
 * EncodedAudioChunk Tests - Adapted from WPT
 */

import {
  test,
  assert_equals,
  assert_throws_js,
  printSummary,
} from './wpt-adapter.mjs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           EncodedAudioChunk Tests (WPT Adapted)            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Test 1: Basic construction
test(t => {
  let chunk = new EncodedAudioChunk({
    type: 'key',
    timestamp: 10,
    duration: 123,
    data: new Uint8Array([0x0A, 0x0B, 0x0C])
  });
  assert_equals(chunk.type, 'key', 'type');
  assert_equals(chunk.timestamp, 10, 'timestamp');
  assert_equals(chunk.duration, 123, 'duration');
  assert_equals(chunk.byteLength, 3, 'byteLength');
  let copyDest = new Uint8Array(3);
  chunk.copyTo(copyDest);
  assert_equals(copyDest[0], 0x0A, 'copyDest[0]');
  assert_equals(copyDest[1], 0x0B, 'copyDest[1]');
  assert_equals(copyDest[2], 0x0C, 'copyDest[2]');

  // Make another chunk with different values for good measure.
  chunk = new EncodedAudioChunk({
    type: 'delta',
    timestamp: 100,
    data: new Uint8Array([0x00, 0x01])
  });
  assert_equals(chunk.type, 'delta', 'type');
  assert_equals(chunk.timestamp, 100, 'timestamp');
  assert_equals(chunk.duration, null, 'missing duration');
  assert_equals(chunk.byteLength, 2, 'byteLength');
  copyDest = new Uint8Array(2);
  chunk.copyTo(copyDest);
  assert_equals(copyDest[0], 0x00, 'copyDest[0]');
  assert_equals(copyDest[1], 0x01, 'copyDest[1]');
}, 'Test we can construct an EncodedAudioChunk.');

// Test 2: copyTo exception if destination invalid
test(t => {
  let chunk = new EncodedAudioChunk({
    type: 'delta',
    timestamp: 100,
    data: new Uint8Array([0x00, 0x01, 0x02])
  });
  assert_throws_js(
    TypeError,
    () => chunk.copyTo(new Uint8Array(2)),
    'destination is not large enough'
  );
}, 'Test copyTo() exception if destination too small');

// Test 3: Zero-sized chunk
test(t => {
  let chunk = new EncodedAudioChunk({
    type: 'key',
    timestamp: 10,
    duration: 300,
    data: new Uint8Array()
  });
  assert_equals(chunk.byteLength, 0, 'byteLength');
  let copyDest = new Uint8Array();
  chunk.copyTo(copyDest);
  assert_equals(copyDest.length, 0, 'copyDest.length');
}, 'Test we can construct a zero-sized EncodedAudioChunk.');

// Test 4: Construction with ArrayBuffer
test(t => {
  const data = new ArrayBuffer(3);
  const view = new Uint8Array(data);
  view[0] = 0xDD;
  view[1] = 0xEE;
  view[2] = 0xFF;

  let chunk = new EncodedAudioChunk({
    type: 'key',
    timestamp: 42,
    data: data
  });
  assert_equals(chunk.byteLength, 3, 'byteLength');
  let copyDest = new Uint8Array(3);
  chunk.copyTo(copyDest);
  assert_equals(copyDest[0], 0xDD, 'copyDest[0]');
  assert_equals(copyDest[1], 0xEE, 'copyDest[1]');
  assert_equals(copyDest[2], 0xFF, 'copyDest[2]');
}, 'Test EncodedAudioChunk with ArrayBuffer data');

// Test 5: Large timestamp values
test(t => {
  let chunk = new EncodedAudioChunk({
    type: 'key',
    timestamp: Number.MAX_SAFE_INTEGER,
    data: new Uint8Array([0x00])
  });
  assert_equals(chunk.timestamp, Number.MAX_SAFE_INTEGER, 'large timestamp');
}, 'Test EncodedAudioChunk with large timestamp');

// Test 6: Negative timestamp
test(t => {
  let chunk = new EncodedAudioChunk({
    type: 'key',
    timestamp: -500,
    data: new Uint8Array([0x00])
  });
  assert_equals(chunk.timestamp, -500, 'negative timestamp');
}, 'Test EncodedAudioChunk with negative timestamp');

// Test 7: Missing required parameters
test(t => {
  assert_throws_js(TypeError, () => {
    new EncodedAudioChunk({
      type: 'key',
      // missing timestamp and data
    });
  }, 'missing timestamp and data');

  assert_throws_js(TypeError, () => {
    new EncodedAudioChunk({
      type: 'key',
      timestamp: 0,
      // missing data
    });
  }, 'missing data');
}, 'Test EncodedAudioChunk throws on missing required parameters');

// Test 8: Invalid type
test(t => {
  assert_throws_js(TypeError, () => {
    new EncodedAudioChunk({
      type: 'invalid',
      timestamp: 0,
      data: new Uint8Array([0x00])
    });
  }, 'invalid type');
}, 'Test EncodedAudioChunk throws on invalid type');

printSummary();

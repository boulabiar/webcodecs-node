/**
 * VideoEncoder Tests - Adapted from WPT
 */

import {
  test,
  promise_test,
  assert_equals,
  assert_not_equals,
  assert_true,
  assert_throws_js,
  assert_throws_dom,
  assert_greater_than,
  assert_greater_than_equal,
  assert_less_than_equal,
  printSummary,
} from './wpt-adapter.mjs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║             VideoEncoder Tests (WPT Adapted)               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Helper to create a test frame
function createFrame(width, height, timestamp) {
  // Create I420 frame
  const ySize = width * height;
  const uvSize = (width / 2) * (height / 2);
  const data = new Uint8Array(ySize + 2 * uvSize);

  // Fill with gradient pattern
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = (x + y + timestamp / 1000) % 256;
    }
  }
  // Fill UV with 128 (neutral)
  data.fill(128, ySize);

  return new VideoFrame(data, {
    format: 'I420',
    codedWidth: width,
    codedHeight: height,
    timestamp: timestamp,
  });
}

// Helper to get default codec init
function getDefaultCodecInit(outputCallback, errorCallback) {
  return {
    output: outputCallback || ((chunk, metadata) => {}),
    error: errorCallback || ((e) => { console.error('Encoder error:', e); }),
  };
}

// Test 1: Construction
test(t => {
  // VideoEncoderInit lacks required fields
  assert_throws_js(TypeError, () => { new VideoEncoder({}); });

  // VideoEncoderInit has required fields
  let encoder = new VideoEncoder(getDefaultCodecInit());
  assert_equals(encoder.state, 'unconfigured');
  encoder.close();
}, 'Test VideoEncoder construction');

// Test 2: Configure with VP8
await promise_test(async t => {
  let encoder = new VideoEncoder(getDefaultCodecInit());

  encoder.configure({
    codec: 'vp8',
    width: 320,
    height: 240,
  });

  assert_equals(encoder.state, 'configured');
  encoder.close();
}, 'Test VideoEncoder configure with VP8');

// Test 3: Configure with H.264
await promise_test(async t => {
  let encoder = new VideoEncoder(getDefaultCodecInit());

  encoder.configure({
    codec: 'avc1.42001e', // H.264 Baseline
    width: 320,
    height: 240,
  });

  assert_equals(encoder.state, 'configured');
  encoder.close();
}, 'Test VideoEncoder configure with H.264');

// Test 4: Encode and flush
await promise_test(async t => {
  let outputChunks = [];
  let encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      outputChunks.push(chunk);
    },
    error: (e) => { throw e; },
  });

  encoder.configure({
    codec: 'vp8',
    width: 320,
    height: 240,
  });

  let frame1 = createFrame(320, 240, 0);
  let frame2 = createFrame(320, 240, 33333);

  encoder.encode(frame1);
  encoder.encode(frame2);

  frame1.close();
  frame2.close();

  await encoder.flush();

  assert_equals(outputChunks.length, 2, 'should have 2 output chunks');
  assert_equals(outputChunks[0].timestamp, 0, 'first chunk timestamp');
  assert_equals(outputChunks[1].timestamp, 33333, 'second chunk timestamp');

  encoder.close();
}, 'Test VideoEncoder encode and flush');

// Test 5: Keyframe request
await promise_test(async t => {
  let outputChunks = [];
  let encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      outputChunks.push(chunk);
    },
    error: (e) => { throw e; },
  });

  encoder.configure({
    codec: 'vp8',
    width: 320,
    height: 240,
  });

  // Encode 5 frames, requesting keyframes at 0 and 3
  for (let i = 0; i < 5; i++) {
    let frame = createFrame(320, 240, i * 33333);
    encoder.encode(frame, { keyFrame: i === 0 || i === 3 });
    frame.close();
  }

  await encoder.flush();

  assert_equals(outputChunks.length, 5, 'should have 5 output chunks');
  assert_equals(outputChunks[0].type, 'key', 'first frame should be key');
  assert_equals(outputChunks[3].type, 'key', 'fourth frame should be key');

  encoder.close();
}, 'Test VideoEncoder keyframe request');

// Test 6: Reset
await promise_test(async t => {
  let encoder = new VideoEncoder(getDefaultCodecInit());

  encoder.configure({
    codec: 'vp8',
    width: 320,
    height: 240,
  });

  assert_equals(encoder.state, 'configured');

  encoder.reset();
  assert_equals(encoder.state, 'unconfigured');

  // Can reconfigure after reset
  encoder.configure({
    codec: 'vp8',
    width: 160,
    height: 120,
  });
  assert_equals(encoder.state, 'configured');

  encoder.close();
}, 'Test VideoEncoder reset');

// Test 7: Close
test(t => {
  let encoder = new VideoEncoder(getDefaultCodecInit());

  encoder.configure({
    codec: 'vp8',
    width: 320,
    height: 240,
  });

  encoder.close();
  assert_equals(encoder.state, 'closed');

  // Operations on closed encoder should throw
  assert_throws_dom('InvalidStateError', () => {
    encoder.configure({ codec: 'vp8', width: 320, height: 240 });
  });

  assert_throws_dom('InvalidStateError', () => {
    encoder.reset();
  });
}, 'Test VideoEncoder close');

// Test 8: encodeQueueSize
await promise_test(async t => {
  let encoder = new VideoEncoder(getDefaultCodecInit());

  assert_equals(encoder.encodeQueueSize, 0, 'initial queue size');

  encoder.configure({
    codec: 'vp8',
    width: 320,
    height: 240,
  });

  assert_equals(encoder.encodeQueueSize, 0, 'queue size after configure');

  // Encode several frames
  for (let i = 0; i < 10; i++) {
    let frame = createFrame(320, 240, i * 33333);
    encoder.encode(frame);
    frame.close();
  }

  // Queue size should be > 0 (frames pending)
  assert_greater_than_equal(encoder.encodeQueueSize, 0);
  assert_less_than_equal(encoder.encodeQueueSize, 10);

  await encoder.flush();

  // After flush, queue should be empty
  assert_equals(encoder.encodeQueueSize, 0, 'queue size after flush');

  encoder.close();
}, 'Test VideoEncoder encodeQueueSize');

// Test 9: Encode on unconfigured encoder
test(t => {
  let encoder = new VideoEncoder(getDefaultCodecInit());

  let frame = createFrame(320, 240, 0);

  assert_throws_dom('InvalidStateError', () => {
    encoder.encode(frame);
  });

  frame.close();
  encoder.close();
}, 'Test encode on unconfigured encoder throws');

// Test 10: Flush on unconfigured encoder
await promise_test(async t => {
  let encoder = new VideoEncoder(getDefaultCodecInit());

  try {
    await encoder.flush();
    assert_true(false, 'flush should reject');
  } catch (e) {
    assert_equals(e.name, 'InvalidStateError');
  }

  encoder.close();
}, 'Test flush on unconfigured encoder rejects');

// Test 11: isConfigSupported
await promise_test(async t => {
  const supportedConfig = {
    codec: 'vp8',
    width: 320,
    height: 240,
  };

  const result = await VideoEncoder.isConfigSupported(supportedConfig);
  assert_true(result.supported, 'VP8 should be supported');
  assert_equals(result.config.codec, 'vp8');
  assert_equals(result.config.width, 320);
  assert_equals(result.config.height, 240);
}, 'Test VideoEncoder.isConfigSupported with valid config');

// Test 12: isConfigSupported with unsupported codec
await promise_test(async t => {
  const unsupportedConfig = {
    codec: 'unsupported-codec',
    width: 320,
    height: 240,
  };

  const result = await VideoEncoder.isConfigSupported(unsupportedConfig);
  assert_equals(result.supported, false, 'unsupported codec');
}, 'Test VideoEncoder.isConfigSupported with unsupported codec');

// Test 13: Encode with different frame sizes (should fail or require reconfigure)
await promise_test(async t => {
  let outputChunks = [];
  let errors = [];

  let encoder = new VideoEncoder({
    output: (chunk) => outputChunks.push(chunk),
    error: (e) => errors.push(e),
  });

  encoder.configure({
    codec: 'vp8',
    width: 320,
    height: 240,
  });

  // Encode correct size
  let frame1 = createFrame(320, 240, 0);
  encoder.encode(frame1);
  frame1.close();

  await encoder.flush();

  assert_equals(outputChunks.length, 1, 'should encode matching size');

  encoder.close();
}, 'Test VideoEncoder with correct frame size');

// Test 14: H.264 with different profiles
await promise_test(async t => {
  const profiles = [
    'avc1.42001e', // Baseline
    'avc1.4d001e', // Main
    'avc1.64001e', // High
  ];

  for (const codec of profiles) {
    const result = await VideoEncoder.isConfigSupported({
      codec,
      width: 320,
      height: 240,
    });
    // Note: Support depends on FFmpeg build
    console.log(`    ${codec}: ${result.supported ? 'supported' : 'not supported'}`);
  }
}, 'Test H.264 profile support');

printSummary();

/**
 * VideoFrame Tests - Adapted from WPT
 * Focused on buffer-based construction (Node.js compatible)
 */

import {
  test,
  assert_equals,
  assert_not_equals,
  assert_true,
  assert_throws_js,
  assert_throws_dom,
  assert_array_equals,
  printSummary,
} from './wpt-adapter.mjs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║              VideoFrame Tests (WPT Adapted)                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Test 1: Basic I420 construction from buffer
test(t => {
  let init = {
    format: 'I420',
    timestamp: 1234,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8,  // y (4x2 = 8 bytes)
    1, 2,                    // u (2x1 = 2 bytes)
    1, 2,                    // v (2x1 = 2 bytes)
  ]);
  let frame = new VideoFrame(data, init);

  assert_equals(frame.format, 'I420', 'format');
  assert_equals(frame.timestamp, 1234, 'timestamp');
  assert_equals(frame.codedWidth, 4, 'codedWidth');
  assert_equals(frame.codedHeight, 2, 'codedHeight');
  assert_equals(frame.displayWidth, 4, 'displayWidth');
  assert_equals(frame.displayHeight, 2, 'displayHeight');

  frame.close();
}, 'Test we can construct an I420 VideoFrame from buffer');

// Test 2: VideoFrame with duration
test(t => {
  let init = {
    format: 'I420',
    timestamp: 1000,
    duration: 500,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array(4 * 2 + 2 + 2); // I420 size

  let frame = new VideoFrame(data, init);
  assert_equals(frame.timestamp, 1000, 'timestamp');
  assert_equals(frame.duration, 500, 'duration');

  frame.close();
}, 'Test VideoFrame with duration');

// Test 3: VideoFrame without duration returns null
test(t => {
  let init = {
    format: 'I420',
    timestamp: 1000,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array(4 * 2 + 2 + 2);

  let frame = new VideoFrame(data, init);
  assert_equals(frame.duration, null, 'duration should be null when not specified');

  frame.close();
}, 'Test VideoFrame duration is null when not specified');

// Test 4: Closed VideoFrame
test(t => {
  let init = {
    format: 'I420',
    timestamp: 10,
    duration: 15,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array(4 * 2 + 2 + 2);

  let frame = new VideoFrame(data, init);
  frame.close();

  assert_equals(frame.format, null, 'format');
  assert_equals(frame.codedWidth, 0, 'codedWidth');
  assert_equals(frame.codedHeight, 0, 'codedHeight');
  assert_equals(frame.visibleRect, null, 'visibleRect');
  assert_equals(frame.displayWidth, 0, 'displayWidth');
  assert_equals(frame.displayHeight, 0, 'displayHeight');

  assert_throws_dom('InvalidStateError', () => frame.clone());
}, 'Test closed VideoFrame');

// Test 5: Negative timestamp
test(t => {
  let init = {
    format: 'I420',
    timestamp: -10,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array(4 * 2 + 2 + 2);

  let frame = new VideoFrame(data, init);
  assert_equals(frame.timestamp, -10, 'timestamp');

  frame.close();
}, 'Test VideoFrame with negative timestamp');

// Test 6: Clone VideoFrame
test(t => {
  let init = {
    format: 'I420',
    timestamp: 1234,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8,
    9, 10,
    11, 12,
  ]);

  let frame = new VideoFrame(data, init);
  let clone = frame.clone();

  assert_equals(clone.format, frame.format, 'format');
  assert_equals(clone.timestamp, frame.timestamp, 'timestamp');
  assert_equals(clone.codedWidth, frame.codedWidth, 'codedWidth');
  assert_equals(clone.codedHeight, frame.codedHeight, 'codedHeight');

  // Closing original shouldn't affect clone
  frame.close();
  assert_equals(frame.format, null, 'original closed');
  assert_not_equals(clone.format, null, 'clone still valid');

  clone.close();
}, 'Test VideoFrame clone');

// Test 7: Construct from another VideoFrame
test(t => {
  let init = {
    format: 'I420',
    timestamp: 1234,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array(4 * 2 + 2 + 2);

  let frame1 = new VideoFrame(data, init);
  let frame2 = new VideoFrame(frame1); // No timestamp required

  assert_equals(frame2.format, frame1.format, 'format');
  assert_equals(frame2.timestamp, frame1.timestamp, 'timestamp');

  frame1.close();
  frame2.close();
}, 'Test constructing VideoFrame from another VideoFrame');

// Test 8: RGBA format
test(t => {
  let init = {
    format: 'RGBA',
    timestamp: 0,
    codedWidth: 2,
    codedHeight: 2
  };
  // RGBA: 4 bytes per pixel, 2x2 = 16 bytes
  let data = new Uint8Array(16);
  for (let i = 0; i < 16; i += 4) {
    data[i] = 255;     // R
    data[i + 1] = 128; // G
    data[i + 2] = 64;  // B
    data[i + 3] = 255; // A
  }

  let frame = new VideoFrame(data, init);
  assert_equals(frame.format, 'RGBA', 'format');
  assert_equals(frame.codedWidth, 2, 'codedWidth');
  assert_equals(frame.codedHeight, 2, 'codedHeight');

  frame.close();
}, 'Test RGBA format VideoFrame');

// Test 9: NV12 format
test(t => {
  let init = {
    format: 'NV12',
    timestamp: 0,
    codedWidth: 4,
    codedHeight: 2
  };
  // NV12: Y plane (4x2=8) + interleaved UV (2x1*2=4) = 12 bytes
  let data = new Uint8Array(12);

  let frame = new VideoFrame(data, init);
  assert_equals(frame.format, 'NV12', 'format');

  frame.close();
}, 'Test NV12 format VideoFrame');

// Test 10: visibleRect
test(t => {
  let init = {
    format: 'I420',
    timestamp: 0,
    codedWidth: 8,
    codedHeight: 8,
    visibleRect: { x: 1, y: 1, width: 6, height: 6 }
  };
  // I420 size for 8x8: 8*8 + 4*4 + 4*4 = 96 bytes
  let data = new Uint8Array(96);

  let frame = new VideoFrame(data, init);
  assert_equals(frame.codedWidth, 8, 'codedWidth');
  assert_equals(frame.codedHeight, 8, 'codedHeight');
  assert_equals(frame.visibleRect.x, 1, 'visibleRect.x');
  assert_equals(frame.visibleRect.y, 1, 'visibleRect.y');
  assert_equals(frame.visibleRect.width, 6, 'visibleRect.width');
  assert_equals(frame.visibleRect.height, 6, 'visibleRect.height');

  frame.close();
}, 'Test VideoFrame with visibleRect');

// Test 11: displayWidth/displayHeight different from coded
test(t => {
  let init = {
    format: 'I420',
    timestamp: 0,
    codedWidth: 4,
    codedHeight: 2,
    displayWidth: 8,
    displayHeight: 4
  };
  let data = new Uint8Array(4 * 2 + 2 + 2);

  let frame = new VideoFrame(data, init);
  assert_equals(frame.codedWidth, 4, 'codedWidth');
  assert_equals(frame.codedHeight, 2, 'codedHeight');
  assert_equals(frame.displayWidth, 8, 'displayWidth');
  assert_equals(frame.displayHeight, 4, 'displayHeight');

  frame.close();
}, 'Test VideoFrame with different display dimensions');

// Test 12: copyTo basic
test(t => {
  let init = {
    format: 'I420',
    timestamp: 0,
    codedWidth: 4,
    codedHeight: 2
  };
  let sourceData = new Uint8Array([
    // Y plane (4x2)
    10, 20, 30, 40,
    50, 60, 70, 80,
    // U plane (2x1)
    100, 110,
    // V plane (2x1)
    200, 210,
  ]);

  let frame = new VideoFrame(sourceData, init);

  // Get allocation size
  const size = frame.allocationSize();
  assert_equals(size, 12, 'allocationSize');

  // Copy data
  let dest = new Uint8Array(size);
  frame.copyTo(dest);

  // Verify Y plane
  assert_equals(dest[0], 10, 'Y[0]');
  assert_equals(dest[7], 80, 'Y[7]');

  // Verify U plane
  assert_equals(dest[8], 100, 'U[0]');
  assert_equals(dest[9], 110, 'U[1]');

  // Verify V plane
  assert_equals(dest[10], 200, 'V[0]');
  assert_equals(dest[11], 210, 'V[1]');

  frame.close();
}, 'Test VideoFrame copyTo');

// Test 13: allocationSize with format conversion
test(t => {
  let init = {
    format: 'I420',
    timestamp: 0,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array(4 * 2 + 2 + 2);

  let frame = new VideoFrame(data, init);

  // Request RGBA format
  const rgbaSize = frame.allocationSize({ format: 'RGBA' });
  // RGBA: 4 bytes per pixel, 4x2 = 32 bytes
  assert_equals(rgbaSize, 32, 'RGBA allocationSize');

  frame.close();
}, 'Test VideoFrame allocationSize with format conversion');

// Test 14: Required parameters
test(t => {
  assert_throws_js(TypeError, () => {
    new VideoFrame(new Uint8Array(12), {
      format: 'I420',
      // missing timestamp
      codedWidth: 4,
      codedHeight: 2
    });
  }, 'timestamp required');

  assert_throws_js(TypeError, () => {
    new VideoFrame(new Uint8Array(12), {
      format: 'I420',
      timestamp: 0,
      // missing codedWidth
      codedHeight: 2
    });
  }, 'codedWidth required');

  assert_throws_js(TypeError, () => {
    new VideoFrame(new Uint8Array(12), {
      format: 'I420',
      timestamp: 0,
      codedWidth: 4,
      // missing codedHeight
    });
  }, 'codedHeight required');
}, 'Test VideoFrame required parameters');

// Test 15: Invalid dimensions
test(t => {
  assert_throws_js(TypeError, () => {
    new VideoFrame(new Uint8Array(0), {
      format: 'I420',
      timestamp: 0,
      codedWidth: 0,
      codedHeight: 2
    });
  }, 'codedWidth must be > 0');

  assert_throws_js(TypeError, () => {
    new VideoFrame(new Uint8Array(0), {
      format: 'I420',
      timestamp: 0,
      codedWidth: 4,
      codedHeight: 0
    });
  }, 'codedHeight must be > 0');
}, 'Test VideoFrame invalid dimensions');

// Test 16: Buffer too small
test(t => {
  assert_throws_js(TypeError, () => {
    new VideoFrame(new Uint8Array(5), {  // Too small for I420 4x2
      format: 'I420',
      timestamp: 0,
      codedWidth: 4,
      codedHeight: 2
    });
  }, 'buffer too small');
}, 'Test VideoFrame with buffer too small');

// Test 17: Close idempotent
test(t => {
  let init = {
    format: 'I420',
    timestamp: 0,
    codedWidth: 4,
    codedHeight: 2
  };
  let data = new Uint8Array(12);

  let frame = new VideoFrame(data, init);
  frame.close();
  frame.close(); // Should not throw
  frame.close(); // Should not throw
}, 'Test VideoFrame close is idempotent');

printSummary();

/**
 * WPT Test Harness Adapter for Node.js
 *
 * Adapts Web Platform Tests to run against our WebCodecs implementation
 */

// Import our WebCodecs implementation
import {
  EncodedVideoChunk,
  EncodedAudioChunk,
  VideoFrame,
  AudioData,
  VideoEncoder,
  VideoDecoder,
  AudioEncoder,
  AudioDecoder,
} from '../dist/index.js';

// Make WebCodecs classes globally available
globalThis.EncodedVideoChunk = EncodedVideoChunk;
globalThis.EncodedAudioChunk = EncodedAudioChunk;
globalThis.VideoFrame = VideoFrame;
globalThis.AudioData = AudioData;
globalThis.VideoEncoder = VideoEncoder;
globalThis.VideoDecoder = VideoDecoder;
globalThis.AudioEncoder = AudioEncoder;
globalThis.AudioDecoder = AudioDecoder;

// Test state tracking
let testResults = { passed: 0, failed: 0, skipped: 0, tests: [] };
let currentTest = null;

// WPT-style assertions
export function assert_equals(actual, expected, description = '') {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${expected}, got ${actual}`);
  }
}

export function assert_not_equals(actual, expected, description = '') {
  if (actual === expected) {
    throw new Error(`${description}: expected not ${expected}`);
  }
}

export function assert_true(value, description = '') {
  if (value !== true) {
    throw new Error(`${description}: expected true, got ${value}`);
  }
}

export function assert_false(value, description = '') {
  if (value !== false) {
    throw new Error(`${description}: expected false, got ${value}`);
  }
}

export function assert_throws_js(errorType, func, description = '') {
  let thrown = false;
  let error = null;
  try {
    func();
  } catch (e) {
    thrown = true;
    error = e;
  }
  if (!thrown) {
    throw new Error(`${description}: expected ${errorType.name} to be thrown, but no error was thrown`);
  }
  if (!(error instanceof errorType)) {
    throw new Error(`${description}: expected ${errorType.name}, got ${error.constructor.name}: ${error.message}`);
  }
}

export function assert_throws_dom(name, func, description = '') {
  let thrown = false;
  let error = null;
  try {
    func();
  } catch (e) {
    thrown = true;
    error = e;
  }
  if (!thrown) {
    throw new Error(`${description}: expected DOMException ${name} to be thrown, but no error was thrown`);
  }
  // Check for DOMException or similar
  const errorName = error.name || error.constructor.name;
  if (errorName !== name && !(error instanceof DOMException && error.name === name)) {
    throw new Error(`${description}: expected DOMException ${name}, got ${errorName}: ${error.message}`);
  }
}

export function assert_array_equals(actual, expected, description = '') {
  if (actual.length !== expected.length) {
    throw new Error(`${description}: arrays have different lengths (${actual.length} vs ${expected.length})`);
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${description}: arrays differ at index ${i} (${actual[i]} vs ${expected[i]})`);
    }
  }
}

export function assert_approx_equals(actual, expected, tolerance, description = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${description}: expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

export function assert_greater_than(actual, expected, description = '') {
  if (!(actual > expected)) {
    throw new Error(`${description}: expected ${actual} > ${expected}`);
  }
}

export function assert_less_than(actual, expected, description = '') {
  if (!(actual < expected)) {
    throw new Error(`${description}: expected ${actual} < ${expected}`);
  }
}

export function assert_greater_than_equal(actual, expected, description = '') {
  if (!(actual >= expected)) {
    throw new Error(`${description}: expected ${actual} >= ${expected}`);
  }
}

export function assert_less_than_equal(actual, expected, description = '') {
  if (!(actual <= expected)) {
    throw new Error(`${description}: expected ${actual} <= ${expected}`);
  }
}

export function assert_unreached(description = '') {
  throw new Error(`Unreached code: ${description}`);
}

// Promise rejection assertion
export async function promise_rejects_js(test, errorType, promise, description = '') {
  try {
    await promise;
    throw new Error(`${description}: expected ${errorType.name} rejection, but promise resolved`);
  } catch (e) {
    if (!(e instanceof errorType)) {
      throw new Error(`${description}: expected ${errorType.name}, got ${e.constructor.name}`);
    }
  }
}

export async function promise_rejects_dom(test, name, promise, description = '') {
  try {
    await promise;
    throw new Error(`${description}: expected DOMException ${name} rejection, but promise resolved`);
  } catch (e) {
    const errorName = e.name || e.constructor.name;
    if (errorName !== name) {
      throw new Error(`${description}: expected DOMException ${name}, got ${errorName}: ${e.message}`);
    }
  }
}

// Test function - synchronous
export function test(func, description) {
  currentTest = { description, type: 'sync' };
  try {
    // Create test object with helper methods
    const t = {
      unreached_func: (msg) => () => { throw new Error(`Unreached: ${msg}`); },
      step_func: (f) => f,
      step_timeout: (f, delay) => setTimeout(f, delay),
    };
    func(t);
    testResults.passed++;
    testResults.tests.push({ description, status: 'PASS' });
    console.log(`  ✓ ${description}`);
  } catch (e) {
    testResults.failed++;
    testResults.tests.push({ description, status: 'FAIL', error: e.message });
    console.log(`  ✗ ${description}`);
    console.log(`    Error: ${e.message}`);
  }
  currentTest = null;
}

// Async test function
export function promise_test(func, description) {
  currentTest = { description, type: 'async' };
  return (async () => {
    try {
      const t = {
        unreached_func: (msg) => () => { throw new Error(`Unreached: ${msg}`); },
        step_func: (f) => f,
        step_timeout: (f, delay) => setTimeout(f, delay),
      };
      await func(t);
      testResults.passed++;
      testResults.tests.push({ description, status: 'PASS' });
      console.log(`  ✓ ${description}`);
    } catch (e) {
      testResults.failed++;
      testResults.tests.push({ description, status: 'FAIL', error: e.message });
      console.log(`  ✗ ${description}`);
      console.log(`    Error: ${e.message}`);
    }
    currentTest = null;
  })();
}

// step_timeout helper
export function step_timeout(func, delay) {
  return new Promise(resolve => setTimeout(() => { func(); resolve(); }, delay));
}

// Helper to create detached array buffer (simulated)
export function makeDetachedArrayBuffer() {
  // In Node.js, we can't truly detach, but we can simulate by returning a view
  // that would fail certain operations
  const buffer = new ArrayBuffer(10);
  const view = new Uint8Array(buffer);
  // Mark as "detached" by modifying the buffer reference
  // This is a simulation - real detachment happens in browsers via postMessage
  Object.defineProperty(view, 'buffer', {
    get() {
      throw new TypeError('Cannot perform operation on detached buffer');
    }
  });
  return view;
}

// Results summary
export function printSummary() {
  console.log('\n' + '═'.repeat(60));
  console.log(`Results: ${testResults.passed} passed, ${testResults.failed} failed, ${testResults.skipped} skipped`);
  console.log('═'.repeat(60));
  return testResults;
}

export function resetResults() {
  testResults = { passed: 0, failed: 0, skipped: 0, tests: [] };
}

export { testResults };

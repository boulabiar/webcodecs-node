/**
 * AudioData Tests - Adapted from WPT
 */

import {
  test,
  assert_equals,
  assert_not_equals,
  assert_true,
  assert_throws_js,
  assert_array_equals,
  printSummary,
} from './wpt-adapter.mjs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║              AudioData Tests (WPT Adapted)                 ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const defaultInit = {
  timestamp: 1234,
  channels: 2,
  sampleRate: 8000,
  frames: 100,
};

function make_audio_data(timestamp, channels, sampleRate, frames) {
  let data = new Float32Array(frames * channels);
  // Generate samples in planar format
  for (let channel = 0; channel < channels; channel++) {
    let hz = 100 + channel * 50;
    let base_index = channel * frames;
    for (let i = 0; i < frames; i++) {
      let t = (i / sampleRate) * hz * (Math.PI * 2);
      data[base_index + i] = Math.sin(t);
    }
  }
  return new AudioData({
    timestamp: timestamp,
    data: data,
    numberOfChannels: channels,
    numberOfFrames: frames,
    sampleRate: sampleRate,
    format: 'f32-planar',
  });
}

function createDefaultAudioData() {
  return make_audio_data(
    defaultInit.timestamp,
    defaultInit.channels,
    defaultInit.sampleRate,
    defaultInit.frames
  );
}

// Test 1: Verify AudioData constructors
test(t => {
  let local_data = new Float32Array(defaultInit.channels * defaultInit.frames);

  let audio_data_init = {
    timestamp: defaultInit.timestamp,
    data: local_data,
    numberOfFrames: defaultInit.frames,
    numberOfChannels: defaultInit.channels,
    sampleRate: defaultInit.sampleRate,
    format: 'f32-planar',
  };

  let data = new AudioData(audio_data_init);

  assert_equals(data.timestamp, defaultInit.timestamp, 'timestamp');
  assert_equals(data.numberOfFrames, defaultInit.frames, 'frames');
  assert_equals(data.numberOfChannels, defaultInit.channels, 'channels');
  assert_equals(data.sampleRate, defaultInit.sampleRate, 'sampleRate');
  assert_equals(
    data.duration,
    defaultInit.frames / defaultInit.sampleRate * 1_000_000,
    'duration'
  );
  assert_equals(data.format, 'f32-planar', 'format');

  // Create an Int16 array of the right length
  let small_data = new Int16Array(defaultInit.channels * defaultInit.frames);

  let wrong_format_init = { ...audio_data_init };
  wrong_format_init.data = small_data;

  // Creating f32-planar AudioData from Int16 should throw
  assert_throws_js(TypeError, () => {
    new AudioData(wrong_format_init);
  }, 'AudioDataInit.data needs to be big enough');

  data.close();
}, 'Verify AudioData constructors');

// Test 2: Required members
test(t => {
  let local_data = new Float32Array(defaultInit.channels * defaultInit.frames);

  let audio_data_init = {
    timestamp: defaultInit.timestamp,
    data: local_data,
    numberOfFrames: defaultInit.frames,
    numberOfChannels: defaultInit.channels,
    sampleRate: defaultInit.sampleRate,
    format: 'f32-planar',
  };

  const members = [
    'timestamp',
    'data',
    'numberOfFrames',
    'numberOfChannels',
    'sampleRate',
    'format',
  ];

  for (const member of members) {
    let incomplete_init = { ...audio_data_init };
    delete incomplete_init[member];

    assert_throws_js(TypeError, () => {
      new AudioData(incomplete_init);
    }, `AudioData requires '${member}'`);
  }
}, 'Verify AudioData required members');

// Test 3: Invalid values
test(t => {
  let local_data = new Float32Array(defaultInit.channels * defaultInit.frames);

  let audio_data_init = {
    timestamp: defaultInit.timestamp,
    data: local_data,
    numberOfFrames: defaultInit.frames,
    numberOfChannels: defaultInit.channels,
    sampleRate: defaultInit.sampleRate,
    format: 'f32-planar',
  };

  let invalid_init = { ...audio_data_init };
  invalid_init.numberOfFrames = 0;

  assert_throws_js(TypeError, () => {
    new AudioData(invalid_init);
  }, 'AudioData requires numberOfFrames > 0');

  invalid_init = { ...audio_data_init };
  invalid_init.numberOfChannels = 0;

  assert_throws_js(TypeError, () => {
    new AudioData(invalid_init);
  }, 'AudioData requires numberOfChannels > 0');
}, 'Verify AudioData invalid values throw');

// Test 4: Close
test(t => {
  let data = createDefaultAudioData();
  data.close();
  assert_equals(data.sampleRate, 0, 'sampleRate after close');
  assert_equals(data.numberOfFrames, 0, 'numberOfFrames after close');
  assert_equals(data.numberOfChannels, 0, 'numberOfChannels after close');
  assert_equals(data.format, null, 'format after close');
}, 'AudioData close');

// Test 5: Clone
test(t => {
  let data = createDefaultAudioData();

  let clone = data.clone();

  // Verify the parameters match
  assert_equals(data.timestamp, clone.timestamp, 'timestamp');
  assert_equals(data.numberOfFrames, clone.numberOfFrames, 'frames');
  assert_equals(data.numberOfChannels, clone.numberOfChannels, 'channels');
  assert_equals(data.sampleRate, clone.sampleRate, 'sampleRate');
  assert_equals(data.format, clone.format, 'format');

  const data_copyDest = new Float32Array(defaultInit.frames);
  const clone_copyDest = new Float32Array(defaultInit.frames);

  // Verify the data matches
  for (let channel = 0; channel < defaultInit.channels; channel++) {
    data.copyTo(data_copyDest, { planeIndex: channel });
    clone.copyTo(clone_copyDest, { planeIndex: channel });

    assert_array_equals(data_copyDest, clone_copyDest, `Cloned data ch=${channel}`);
  }

  // Verify closing the original doesn't close the clone
  data.close();
  assert_equals(data.numberOfFrames, 0, 'data.numberOfFrames (closed)');
  assert_not_equals(clone.numberOfFrames, 0, 'clone.numberOfFrames (not closed)');

  clone.close();
  assert_equals(clone.numberOfFrames, 0, 'clone.numberOfFrames (closed)');

  // Verify closing a closed AudioData does not throw
  data.close();
}, 'Verify closing and cloning AudioData');

// Test 6: Negative timestamp
test(t => {
  let data = make_audio_data(-10, defaultInit.channels, defaultInit.sampleRate, defaultInit.frames);
  assert_equals(data.timestamp, -10, 'timestamp');
  data.close();
}, 'Test we can construct AudioData with a negative timestamp');

// Test 7: Interleaved format (f32)
test(t => {
  const frames = 10;
  const channels = 2;
  const sampleRate = 44100;
  let data = new Float32Array(frames * channels);
  // Fill with test data
  for (let i = 0; i < data.length; i++) {
    data[i] = i / data.length;
  }

  let audioData = new AudioData({
    timestamp: 0,
    data: data,
    numberOfFrames: frames,
    numberOfChannels: channels,
    sampleRate: sampleRate,
    format: 'f32',
  });

  assert_equals(audioData.format, 'f32', 'format');
  assert_equals(audioData.numberOfFrames, frames, 'numberOfFrames');
  assert_equals(audioData.numberOfChannels, channels, 'numberOfChannels');

  audioData.close();
}, 'Test interleaved f32 format');

// Test 8: s16 format
test(t => {
  const frames = 10;
  const channels = 2;
  const sampleRate = 44100;
  let data = new Int16Array(frames * channels);
  // Fill with test data
  for (let i = 0; i < data.length; i++) {
    data[i] = (i * 1000) % 32767;
  }

  let audioData = new AudioData({
    timestamp: 0,
    data: data,
    numberOfFrames: frames,
    numberOfChannels: channels,
    sampleRate: sampleRate,
    format: 's16',
  });

  assert_equals(audioData.format, 's16', 'format');
  assert_equals(audioData.numberOfFrames, frames, 'numberOfFrames');

  audioData.close();
}, 'Test interleaved s16 format');

// Test 9: s16-planar format
test(t => {
  const frames = 10;
  const channels = 2;
  const sampleRate = 44100;
  let data = new Int16Array(frames * channels);

  let audioData = new AudioData({
    timestamp: 0,
    data: data,
    numberOfFrames: frames,
    numberOfChannels: channels,
    sampleRate: sampleRate,
    format: 's16-planar',
  });

  assert_equals(audioData.format, 's16-planar', 'format');

  audioData.close();
}, 'Test planar s16 format');

// Test 10: allocationSize
test(t => {
  let data = createDefaultAudioData();

  // For f32-planar, each plane is numberOfFrames * 4 bytes
  const expectedPlaneSize = defaultInit.frames * 4;
  const size = data.allocationSize({ planeIndex: 0 });
  assert_equals(size, expectedPlaneSize, 'allocationSize for plane 0');

  data.close();
}, 'Test allocationSize');

// Test 11: copyTo basic
test(t => {
  const frames = 4;
  const channels = 2;
  const sampleRate = 8000;

  // Create known data pattern
  let inputData = new Float32Array(frames * channels);
  // Plane 0 (channel 0): 0.1, 0.2, 0.3, 0.4
  // Plane 1 (channel 1): 0.5, 0.6, 0.7, 0.8
  for (let i = 0; i < frames; i++) {
    inputData[i] = (i + 1) * 0.1;
    inputData[frames + i] = (i + 5) * 0.1;
  }

  let audioData = new AudioData({
    timestamp: 0,
    data: inputData,
    numberOfFrames: frames,
    numberOfChannels: channels,
    sampleRate: sampleRate,
    format: 'f32-planar',
  });

  // Copy channel 0
  let dest0 = new Float32Array(frames);
  audioData.copyTo(dest0, { planeIndex: 0 });

  // Copy channel 1
  let dest1 = new Float32Array(frames);
  audioData.copyTo(dest1, { planeIndex: 1 });

  // Verify channel 0
  for (let i = 0; i < frames; i++) {
    const expected = (i + 1) * 0.1;
    const actual = dest0[i];
    assert_true(Math.abs(actual - expected) < 0.001, `Channel 0, frame ${i}: expected ${expected}, got ${actual}`);
  }

  // Verify channel 1
  for (let i = 0; i < frames; i++) {
    const expected = (i + 5) * 0.1;
    const actual = dest1[i];
    assert_true(Math.abs(actual - expected) < 0.001, `Channel 1, frame ${i}: expected ${expected}, got ${actual}`);
  }

  audioData.close();
}, 'Test copyTo basic functionality');

// Test 12: copyTo with frameOffset and frameCount
test(t => {
  const frames = 10;
  const channels = 1;
  const sampleRate = 8000;

  let inputData = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    inputData[i] = i;
  }

  let audioData = new AudioData({
    timestamp: 0,
    data: inputData,
    numberOfFrames: frames,
    numberOfChannels: channels,
    sampleRate: sampleRate,
    format: 'f32-planar',
  });

  // Copy frames 3-6 (4 frames starting at offset 3)
  let dest = new Float32Array(4);
  audioData.copyTo(dest, { planeIndex: 0, frameOffset: 3, frameCount: 4 });

  assert_equals(dest[0], 3, 'frame 0');
  assert_equals(dest[1], 4, 'frame 1');
  assert_equals(dest[2], 5, 'frame 2');
  assert_equals(dest[3], 6, 'frame 3');

  audioData.close();
}, 'Test copyTo with frameOffset and frameCount');

// Test 13: duration calculation
test(t => {
  const frames = 48000; // 1 second at 48kHz
  const channels = 2;
  const sampleRate = 48000;

  let data = new Float32Array(frames * channels);

  let audioData = new AudioData({
    timestamp: 0,
    data: data,
    numberOfFrames: frames,
    numberOfChannels: channels,
    sampleRate: sampleRate,
    format: 'f32-planar',
  });

  // Duration should be 1 second = 1,000,000 microseconds
  assert_equals(audioData.duration, 1_000_000, 'duration is 1 second in microseconds');

  audioData.close();
}, 'Test duration calculation');

printSummary();

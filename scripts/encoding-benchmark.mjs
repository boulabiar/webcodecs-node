#!/usr/bin/env node
/**
 * Encoding Performance Benchmark
 *
 * Tests software vs hardware encoding performance across multiple codecs
 * and resolutions using the WebCodecs implementation.
 *
 * Usage:
 *   node scripts/encoding-benchmark.mjs [options]
 *
 * Options:
 *   --frames <n>       Number of frames to encode (default: 120)
 *   --resolution <r>   Resolution preset: 360p, 480p, 720p, 1080p, 4k (default: 720p)
 *   --codecs <list>    Comma-separated codecs: h264,hevc,vp9,av1 (default: all)
 *   --skip-hardware    Skip hardware encoding tests
 *   --skip-software    Skip software encoding tests
 *   --bitrate <bps>    Target bitrate in bps (default: auto based on resolution)
 *   --json             Output results as JSON
 *   --verbose          Show detailed progress
 */

import { performance } from 'perf_hooks';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

// Resolution presets
const RESOLUTIONS = {
  '360p':  { width: 640,  height: 360,  bitrate: 1_000_000 },
  '480p':  { width: 854,  height: 480,  bitrate: 2_500_000 },
  '720p':  { width: 1280, height: 720,  bitrate: 5_000_000 },
  '1080p': { width: 1920, height: 1080, bitrate: 8_000_000 },
  '4k':    { width: 3840, height: 2160, bitrate: 25_000_000 },
};

// Codec configurations
const CODECS = {
  h264: {
    name: 'H.264/AVC',
    codec: 'avc1.640028',
    profile: 'high',
  },
  hevc: {
    name: 'H.265/HEVC',
    codec: 'hev1.1.6.L93.B0',
    profile: 'main',
  },
  vp9: {
    name: 'VP9',
    codec: 'vp09.00.10.08',
    profile: 'profile0',
  },
  av1: {
    name: 'AV1',
    codec: 'av01.0.04M.08',
    profile: 'main',
  },
};

function parseArgs(argv) {
  const opts = {
    frames: 120,
    resolution: '720p',
    codecs: Object.keys(CODECS),
    skipHardware: false,
    skipSoftware: false,
    bitrate: null,
    json: false,
    verbose: false,
    framerate: 30,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--frames') opts.frames = Number(argv[++i]);
    else if (arg === '--resolution') opts.resolution = argv[++i];
    else if (arg === '--codecs') opts.codecs = argv[++i].split(',');
    else if (arg === '--skip-hardware') opts.skipHardware = true;
    else if (arg === '--skip-software') opts.skipSoftware = true;
    else if (arg === '--bitrate') opts.bitrate = Number(argv[++i]);
    else if (arg === '--json') opts.json = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--framerate') opts.framerate = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Encoding Performance Benchmark

Usage: node scripts/encoding-benchmark.mjs [options]

Options:
  --frames <n>       Number of frames to encode (default: 120)
  --resolution <r>   Resolution: 360p, 480p, 720p, 1080p, 4k (default: 720p)
  --codecs <list>    Comma-separated: h264,hevc,vp9,av1 (default: all)
  --skip-hardware    Skip hardware encoding tests
  --skip-software    Skip software encoding tests
  --bitrate <bps>    Target bitrate in bps (default: auto)
  --framerate <fps>  Frame rate (default: 30)
  --json             Output results as JSON
  --verbose          Show detailed progress
  --help             Show this help
`);
      process.exit(0);
    }
  }

  return opts;
}

// Generate test frame with varying content
function generateFrame(index, width, height) {
  const data = new Uint8Array(width * height * 4);
  const time = index / 30;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Create moving gradient pattern
      const r = Math.floor(128 + 127 * Math.sin(x / 50 + time * 2));
      const g = Math.floor(128 + 127 * Math.sin(y / 50 + time * 3));
      const b = Math.floor(128 + 127 * Math.sin((x + y) / 70 + time));

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  return data;
}

async function runEncodingBenchmark(VideoEncoder, VideoFrame, codecKey, config, opts, hwAccel) {
  const { width, height, bitrate, framerate, frames, verbose } = config;
  const codecConfig = CODECS[codecKey];

  const chunks = [];
  let totalBytes = 0;
  let keyFrames = 0;
  let firstChunkTime = null;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (firstChunkTime === null) {
        firstChunkTime = performance.now();
      }
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (chunk.type === 'key') keyFrames++;
    },
    error: (e) => {
      throw e;
    },
  });

  // Check if config is supported
  const support = await VideoEncoder.isConfigSupported({
    codec: codecConfig.codec,
    width,
    height,
    framerate,
    bitrate,
    hardwareAcceleration: hwAccel,
  });

  if (!support.supported) {
    return {
      codec: codecKey,
      hwAccel,
      supported: false,
      error: 'Configuration not supported',
    };
  }

  try {
    encoder.configure({
      codec: codecConfig.codec,
      width,
      height,
      framerate,
      bitrate,
      hardwareAcceleration: hwAccel,
      latencyMode: 'realtime',
    });
  } catch (e) {
    return {
      codec: codecKey,
      hwAccel,
      supported: false,
      error: e.message,
    };
  }

  // Pre-generate frames to avoid including generation time
  if (verbose) {
    process.stdout.write(`  Generating ${frames} test frames...`);
  }
  const frameData = [];
  for (let i = 0; i < frames; i++) {
    frameData.push(generateFrame(i, width, height));
  }
  if (verbose) {
    console.log(' done');
  }

  // Measure encoding time
  const encodeStart = performance.now();

  for (let i = 0; i < frames; i++) {
    const frame = new VideoFrame(frameData[i], {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: Math.round((i * 1_000_000) / framerate),
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();

    if (verbose && i > 0 && i % 30 === 0) {
      process.stdout.write(`\r  Encoding: ${i}/${frames} frames`);
    }
  }

  await encoder.flush();
  const encodeEnd = performance.now();
  encoder.close();

  if (verbose) {
    process.stdout.write(`\r  Encoding: ${frames}/${frames} frames\n`);
  }

  const encodeMs = encodeEnd - encodeStart;
  const latencyMs = firstChunkTime ? firstChunkTime - encodeStart : 0;
  const fps = (frames * 1000) / encodeMs;
  const bitsPerSecond = (totalBytes * 8 * framerate) / frames;
  const compressionRatio = (width * height * 4 * frames) / totalBytes;

  return {
    codec: codecKey,
    codecName: codecConfig.name,
    hwAccel,
    supported: true,
    frames,
    encodeMs: Math.round(encodeMs),
    fps: Number(fps.toFixed(2)),
    latencyMs: Math.round(latencyMs),
    totalBytes,
    avgBytesPerFrame: Math.round(totalBytes / frames),
    keyFrames,
    actualBitrate: Math.round(bitsPerSecond),
    targetBitrate: bitrate,
    compressionRatio: Number(compressionRatio.toFixed(1)),
  };
}

async function detectHardwareCapabilities(detectHardwareAcceleration) {
  try {
    const caps = await detectHardwareAcceleration();
    // Check if any hardware encoders are actually available
    const availableEncoders = (caps.encoders || []).filter(e => e.available);
    const methods = caps.methods || [];

    return {
      available: methods.length > 0,
      methods,
      encoders: caps.encoders || [],
      availableEncoders,
      hasWorkingHardware: availableEncoders.length > 0,
    };
  } catch {
    return { available: false, methods: [], encoders: [], availableEncoders: [], hasWorkingHardware: false };
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatBitrate(bps) {
  if (bps < 1000) return `${bps} bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(0)} Kbps`;
  return `${(bps / 1_000_000).toFixed(2)} Mbps`;
}

function printTable(results, resolution) {
  console.log('\n' + '═'.repeat(100));
  console.log(`ENCODING BENCHMARK RESULTS (${resolution})`);
  console.log('═'.repeat(100));

  // Header
  console.log(
    'Codec'.padEnd(12) +
    'Mode'.padEnd(10) +
    'FPS'.padStart(8) +
    'Time'.padStart(10) +
    'Latency'.padStart(10) +
    'Size'.padStart(12) +
    'Bitrate'.padStart(14) +
    'Ratio'.padStart(8) +
    'Status'.padStart(12)
  );
  console.log('─'.repeat(100));

  for (const r of results) {
    const mode = r.hwAccel === 'prefer-hardware' ? 'HW' : 'SW';
    if (!r.supported) {
      console.log(
        (CODECS[r.codec]?.name || r.codec).padEnd(12) +
        mode.padEnd(10) +
        '-'.padStart(8) +
        '-'.padStart(10) +
        '-'.padStart(10) +
        '-'.padStart(12) +
        '-'.padStart(14) +
        '-'.padStart(8) +
        'unsupported'.padStart(12)
      );
      continue;
    }

    const status = r.fps >= 30 ? '✓ realtime' : r.fps >= 15 ? '~ slow' : '✗ too slow';

    console.log(
      r.codecName.padEnd(12) +
      mode.padEnd(10) +
      r.fps.toFixed(1).padStart(8) +
      `${r.encodeMs}ms`.padStart(10) +
      `${r.latencyMs}ms`.padStart(10) +
      formatBytes(r.totalBytes).padStart(12) +
      formatBitrate(r.actualBitrate).padStart(14) +
      `${r.compressionRatio}x`.padStart(8) +
      status.padStart(12)
    );
  }

  console.log('─'.repeat(100));
}

async function runDecodingBenchmark(VideoDecoder, EncodedVideoChunk, chunks, codecKey, config, hwAccel, description) {
  const { width, height, frames, verbose } = config;
  const codecConfig = CODECS[codecKey];

  let decoded = 0;
  let firstFrameTime = null;

  const decoder = new VideoDecoder({
    output: (frame) => {
      if (firstFrameTime === null) {
        firstFrameTime = performance.now();
      }
      decoded++;
      frame.close();
    },
    error: (e) => {
      throw e;
    },
  });

  try {
    decoder.configure({
      codec: codecConfig.codec,
      codedWidth: width,
      codedHeight: height,
      hardwareAcceleration: hwAccel,
      description,
    });
  } catch (e) {
    return {
      codec: codecKey,
      hwAccel,
      supported: false,
      error: e.message,
    };
  }

  const decodeStart = performance.now();

  for (const chunk of chunks) {
    decoder.decode(chunk);
  }

  await decoder.flush();
  const decodeEnd = performance.now();
  decoder.close();

  const decodeMs = decodeEnd - decodeStart;
  const latencyMs = firstFrameTime ? firstFrameTime - decodeStart : 0;
  const fps = (decoded * 1000) / decodeMs;

  return {
    codec: codecKey,
    codecName: codecConfig.name,
    hwAccel,
    supported: true,
    frames: decoded,
    decodeMs: Math.round(decodeMs),
    fps: Number(fps.toFixed(2)),
    latencyMs: Math.round(latencyMs),
  };
}

function printSummary(results, hwCaps) {
  console.log('\nSUMMARY');
  console.log('─'.repeat(50));

  // Hardware info
  if (hwCaps.available) {
    console.log(`Hardware acceleration: ${hwCaps.methods.join(', ')}`);
  } else {
    console.log('Hardware acceleration: not available');
  }

  // Best performers
  const supported = results.filter(r => r.supported);
  if (supported.length === 0) {
    console.log('No codecs were successfully tested.');
    return;
  }

  const fastest = supported.reduce((a, b) => a.fps > b.fps ? a : b);
  const smallest = supported.reduce((a, b) => a.avgBytesPerFrame < b.avgBytesPerFrame ? a : b);
  const lowestLatency = supported.reduce((a, b) => a.latencyMs < b.latencyMs ? a : b);

  console.log(`Fastest encoder: ${fastest.codecName} (${fastest.hwAccel === 'prefer-hardware' ? 'HW' : 'SW'}) @ ${fastest.fps} fps`);
  console.log(`Best compression: ${smallest.codecName} @ ${formatBytes(smallest.avgBytesPerFrame)}/frame`);
  console.log(`Lowest latency: ${lowestLatency.codecName} @ ${lowestLatency.latencyMs}ms`);

  // Realtime capable
  const realtime = supported.filter(r => r.fps >= 30);
  if (realtime.length > 0) {
    console.log(`\nRealtime capable (≥30fps):`);
    for (const r of realtime) {
      const mode = r.hwAccel === 'prefer-hardware' ? 'HW' : 'SW';
      console.log(`  • ${r.codecName} (${mode}): ${r.fps} fps`);
    }
  }
}

// Main
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Check for dist build
  const distIndex = path.join(process.cwd(), 'dist', 'index.js');
  if (!fs.existsSync(distIndex)) {
    console.error('Missing dist build. Run `npm run build` first.');
    process.exit(1);
  }

  // Import our implementation
  const indexUrl = pathToFileURL(distIndex).href;
  const { VideoEncoder, VideoFrame, detectHardwareAcceleration } = await import(indexUrl);

  // Get resolution config
  const res = RESOLUTIONS[opts.resolution];
  if (!res) {
    console.error(`Unknown resolution: ${opts.resolution}. Use: ${Object.keys(RESOLUTIONS).join(', ')}`);
    process.exit(1);
  }

  const config = {
    width: res.width,
    height: res.height,
    bitrate: opts.bitrate || res.bitrate,
    framerate: opts.framerate,
    frames: opts.frames,
    verbose: opts.verbose,
  };

  console.log(`\nEncoding Benchmark`);
  console.log(`─────────────────────────────────`);
  console.log(`Resolution: ${config.width}x${config.height} (${opts.resolution})`);
  console.log(`Frames: ${config.frames} @ ${config.framerate} fps`);
  console.log(`Target bitrate: ${formatBitrate(config.bitrate)}`);
  console.log(`Codecs: ${opts.codecs.join(', ')}`);

  // Detect hardware capabilities
  const hwCaps = await detectHardwareCapabilities(detectHardwareAcceleration);
  if (hwCaps.methods.length > 0) {
    console.log(`Hardware APIs: ${hwCaps.methods.join(', ')}`);
    if (hwCaps.availableEncoders.length > 0) {
      const hwEncoders = hwCaps.availableEncoders.map(e => e.name).join(', ');
      console.log(`HW Encoders: ${hwEncoders}`);
    } else {
      console.log(`HW Encoders: none working (will test anyway)`);
    }
  } else {
    console.log(`Hardware: not available`);
  }

  const results = [];
  const accelerations = [];

  if (!opts.skipSoftware) {
    accelerations.push('prefer-software');
  }
  // Always try hardware if methods are detected (even if encoders show unavailable)
  if (!opts.skipHardware && hwCaps.methods.length > 0) {
    accelerations.push('prefer-hardware');
  }

  // Run benchmarks
  for (const codecKey of opts.codecs) {
    if (!CODECS[codecKey]) {
      console.warn(`Unknown codec: ${codecKey}, skipping`);
      continue;
    }

    for (const hwAccel of accelerations) {
      const mode = hwAccel === 'prefer-hardware' ? 'HW' : 'SW';
      console.log(`\nTesting ${CODECS[codecKey].name} (${mode})...`);

      try {
        const result = await runEncodingBenchmark(
          VideoEncoder,
          VideoFrame,
          codecKey,
          config,
          opts,
          hwAccel
        );
        results.push(result);

        if (result.supported) {
          console.log(`  ${result.fps} fps, ${formatBytes(result.totalBytes)}, latency: ${result.latencyMs}ms`);
        } else {
          console.log(`  Not supported: ${result.error || 'unknown'}`);
        }
      } catch (e) {
        console.log(`  Error: ${e.message}`);
        results.push({
          codec: codecKey,
          codecName: CODECS[codecKey].name,
          hwAccel,
          supported: false,
          error: e.message,
        });
      }
    }
  }

  // Output results
  if (opts.json) {
    console.log(JSON.stringify({ config, hwCaps, results }, null, 2));
  } else {
    printTable(results, opts.resolution);
    printSummary(results, hwCaps);
  }
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});

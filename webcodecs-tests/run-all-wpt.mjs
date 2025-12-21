/**
 * Run All WPT-Adapted Tests
 *
 * Comprehensive test runner for WebCodecs implementation compliance
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const testFiles = [
  'run-encoded-video-chunk.mjs',
  'run-encoded-audio-chunk.mjs',
  'run-audio-data.mjs',
  'run-video-frame.mjs',
  'run-video-encoder.mjs',
];

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║        WebCodecs WPT Compliance Test Suite                     ║');
console.log('║        Testing against Web Platform Test specifications        ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const results = [];

async function runTest(file) {
  return new Promise((resolve) => {
    const testPath = join(__dirname, file);
    const child = spawn('node', [testPath], {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: dirname(__dirname),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      // Filter out libvpx/libx264 info messages
      const filtered = data.toString().split('\n')
        .filter(line => !line.includes('[lib') && !line.includes('Svt['))
        .join('\n');
      if (filtered.trim()) {
        process.stderr.write(filtered);
      }
    });

    child.on('close', (code) => {
      // Parse results from output
      const resultsMatch = stdout.match(/Results: (\d+) passed, (\d+) failed, (\d+) skipped/);
      if (resultsMatch) {
        const passed = parseInt(resultsMatch[1]);
        const failed = parseInt(resultsMatch[2]);
        const skipped = parseInt(resultsMatch[3]);
        totalPassed += passed;
        totalFailed += failed;
        totalSkipped += skipped;
        results.push({ file, passed, failed, skipped });
      }
      resolve(code);
    });
  });
}

// Run all tests sequentially
for (const file of testFiles) {
  console.log('\n' + '─'.repeat(66) + '\n');
  await runTest(file);
}

// Print summary
console.log('\n');
console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║                    OVERALL TEST SUMMARY                        ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log();

console.log('┌─────────────────────────────────┬────────┬────────┬─────────┐');
console.log('│ Test Suite                      │ Passed │ Failed │ Skipped │');
console.log('├─────────────────────────────────┼────────┼────────┼─────────┤');

for (const r of results) {
  const name = r.file.replace('run-', '').replace('.mjs', '').padEnd(31);
  const passed = String(r.passed).padStart(6);
  const failed = String(r.failed).padStart(6);
  const skipped = String(r.skipped).padStart(7);
  console.log(`│ ${name} │${passed} │${failed} │${skipped} │`);
}

console.log('├─────────────────────────────────┼────────┼────────┼─────────┤');
const totalName = 'TOTAL'.padEnd(31);
const totalPassedStr = String(totalPassed).padStart(6);
const totalFailedStr = String(totalFailed).padStart(6);
const totalSkippedStr = String(totalSkipped).padStart(7);
console.log(`│ ${totalName} │${totalPassedStr} │${totalFailedStr} │${totalSkippedStr} │`);
console.log('└─────────────────────────────────┴────────┴────────┴─────────┘');

const totalTests = totalPassed + totalFailed + totalSkipped;
const passRate = ((totalPassed / totalTests) * 100).toFixed(1);
console.log();
console.log(`Pass Rate: ${passRate}% (${totalPassed}/${totalTests})`);
console.log();

if (totalFailed > 0) {
  console.log('Known Issues:');
  console.log('  - VideoFrame: construction from another frame without init');
  console.log('  - VideoFrame: buffer size validation');
  console.log('  - VideoEncoder: timestamp floating-point precision');
  console.log('  - VideoEncoder: keyframe request timing');
}

console.log();
process.exit(totalFailed > 0 ? 1 : 0);

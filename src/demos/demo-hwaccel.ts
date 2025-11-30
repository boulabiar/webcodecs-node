/**
 * Hardware Acceleration Demo
 *
 * Demonstrates hardware-accelerated video encoding using the WebCodecs polyfill.
 */

import {
  detectHardwareAcceleration,
  getHardwareAccelerationSummary,
  getBestEncoder,
  getBestDecoder,
  testEncoder,
} from '../HardwareAcceleration.js';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           Hardware Acceleration Detection Demo                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Get detailed summary
  const summary = await getHardwareAccelerationSummary();
  console.log(summary);
  console.log('');

  // Get capabilities
  const capabilities = await detectHardwareAcceleration();

  // Test best encoders for each codec
  console.log('\n=== Best Available Encoders ===\n');

  const codecs = ['h264', 'hevc', 'vp8', 'vp9', 'av1'] as const;

  for (const codec of codecs) {
    const best = await getBestEncoder(codec, 'prefer-hardware');
    const status = best.isHardware ? '✓ HW' : '○ SW';
    console.log(`  ${codec.toUpperCase().padEnd(5)} : ${status} ${best.encoder}`);

    // Test if encoder actually works (for hardware encoders)
    if (best.isHardware) {
      const works = await testEncoder(best.encoder);
      if (!works) {
        console.log(`         ⚠ (encoder reported available but test failed)`);
      }
    }
  }

  // Test best decoders
  console.log('\n=== Best Available Decoders ===\n');

  for (const codec of codecs) {
    const best = await getBestDecoder(codec, 'prefer-hardware');
    const status = best.isHardware ? '✓ HW' : '○ SW';
    const name = best.decoder || best.hwaccel || 'default';
    console.log(`  ${codec.toUpperCase().padEnd(5)} : ${status} ${name}`);
  }

  // Show software fallback comparison
  console.log('\n=== Software Encoder Fallbacks ===\n');

  for (const codec of codecs) {
    const best = await getBestEncoder(codec, 'prefer-software');
    console.log(`  ${codec.toUpperCase().padEnd(5)} : ${best.encoder}`);
  }

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Demo Complete!                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
}

main().catch(console.error);

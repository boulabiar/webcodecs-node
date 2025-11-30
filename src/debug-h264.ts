/**
 * Debug H.264 encoding - examine NAL units in FFmpeg output
 */

import { spawn } from 'child_process';

async function main() {
  console.log('Debug H.264 NAL parsing');
  console.log('=======================\n');

  const width = 320;
  const height = 240;
  const frameCount = 5;

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', '30',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-x264-params', 'aud=1',
    '-f', 'h264',
    'pipe:1',
  ];

  console.log('FFmpeg command:', 'ffmpeg', args.join(' '));
  console.log('');

  const process = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let accumulatedData = Buffer.alloc(0);

  process.stdout?.on('data', (data: Buffer) => {
    accumulatedData = Buffer.concat([accumulatedData, data]);
    console.log(`Received ${data.length} bytes (total: ${accumulatedData.length})`);
  });

  process.stderr?.on('data', (data: Buffer) => {
    console.error('FFmpeg:', data.toString());
  });

  // Generate frames
  for (let i = 0; i < frameCount; i++) {
    const frameData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        frameData[idx] = (x + i * 10) % 256;
        frameData[idx + 1] = (y + i * 5) % 256;
        frameData[idx + 2] = (i * 8) % 256;
        frameData[idx + 3] = 255;
      }
    }
    process.stdin?.write(Buffer.from(frameData));
    console.log(`Sent frame ${i + 1}`);
  }

  process.stdin?.end();

  await new Promise((resolve) => process.on('close', resolve));

  console.log('\n--- Analysis ---');
  console.log(`Total bytes: ${accumulatedData.length}`);

  // Find and analyze start codes
  const startCodes = findStartCodes(accumulatedData);
  console.log(`\nFound ${startCodes.length} start codes:`);

  for (let i = 0; i < startCodes.length; i++) {
    const sc = startCodes[i];
    const nalStart = sc.pos + sc.len;
    if (nalStart >= accumulatedData.length) continue;

    const nalByte = accumulatedData[nalStart];
    const nalType = nalByte & 0x1f;
    const nalNames: Record<number, string> = {
      1: 'Non-IDR slice',
      5: 'IDR slice',
      6: 'SEI',
      7: 'SPS',
      8: 'PPS',
      9: 'AUD',
    };

    const nextSc = i + 1 < startCodes.length ? startCodes[i + 1] : null;
    const nalSize = nextSc ? nextSc.pos - sc.pos : accumulatedData.length - sc.pos;

    console.log(
      `  [${i}] pos=${sc.pos}, len=${sc.len}, type=${nalType} (${nalNames[nalType] || 'unknown'}), size=${nalSize}`
    );
  }
}

function findStartCodes(buf: Buffer): Array<{ pos: number; len: number }> {
  const codes: Array<{ pos: number; len: number }> = [];
  let i = 0;

  while (i < buf.length - 2) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) {
        codes.push({ pos: i, len: 3 });
        i += 3;
      } else if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) {
        codes.push({ pos: i, len: 4 });
        i += 4;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return codes;
}

main().catch(console.error);

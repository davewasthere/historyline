// A minimal PNG writer (8-bit RGBA, no interlace), enough to save a surface.

import { crc32, deflateSync } from 'node:zlib';
import { rgbaBytes, type Surface } from '../src/gfx/surface.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Encodes a surface as PNG, each pixel enlarged to `scale` x `scale`. */
export function encodePng(surface: Surface, scale = 1): Buffer {
  const width = surface.width * scale;
  const height = surface.height * scale;
  const source = rgbaBytes(surface);

  // Each scanline is a filter byte (0 = none) followed by the pixels.
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const sourceRow = Math.floor(y / scale) * surface.width * 4;
    let at = y * stride + 1;
    for (let x = 0; x < width; x++) {
      const from = sourceRow + Math.floor(x / scale) * 4;
      raw[at++] = source[from]!;
      raw[at++] = source[from + 1]!;
      raw[at++] = source[from + 2]!;
      raw[at++] = source[from + 3]!;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type: string, body: Buffer): Buffer {
  const typeAndBody = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const out = Buffer.alloc(8 + body.length + 4);
  out.writeUInt32BE(body.length, 0);
  typeAndBody.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndBody), 8 + body.length);
  return out;
}

// Sprites inside the library archives.
//
//   char id[8]        "INFOILBM" or "ILBM    "
//   u8   background   colour index that is not drawn
//   u8   type         0x50 = 4 bits per pixel, 0x55 = 8 bits per pixel
//   u16le, u16le      always 0
//   u16le width, u16le height
//   pixels
//
// Pixels are stored the way VGA "Mode X" wants them: four planes, where plane p
// holds the pixels whose x is p, p+4, p+8, ... row by row. In the 4-bit type a
// byte holds two such pixels, the left one in its high nibble.
//
// Header as documented on the ModdingWiki ("Battle Isle / History Line library
// format"); the nibble order was settled by looking at the result.

import { text, u16le } from './bytes.ts';

const HEADER_SIZE = 18;
const TYPE_4BPP = 0x50;
const TYPE_8BPP = 0x55;

export interface Bitmap {
  width: number;
  height: number;
  /** One palette index per pixel, row by row. */
  pixels: Uint8Array;
  /** Palette index that stands for "no pixel". */
  transparent: number;
  bitsPerPixel: 4 | 8;
}

export function decodeBitmap(data: Uint8Array): Bitmap {
  const id = text(data, 0, 8);
  if (id !== 'INFOILBM' && id !== 'ILBM    ') throw new Error(`unknown bitmap id "${id}"`);
  const transparent = data[8]!;
  const type = data[9]!;
  const width = u16le(data, 14);
  const height = u16le(data, 16);
  if (type !== TYPE_4BPP && type !== TYPE_8BPP) {
    throw new Error(`unknown bitmap type 0x${type.toString(16)}`);
  }
  const bitsPerPixel = type === TYPE_4BPP ? 4 : 8;

  const planeColumns = Math.ceil(width / 4);
  const rowBytes = bitsPerPixel === 8 ? planeColumns : Math.ceil(planeColumns / 2);
  const planeBytes = rowBytes * height;
  if (data.length < HEADER_SIZE + 4 * planeBytes) {
    throw new Error(`bitmap ${width}x${height} needs ${HEADER_SIZE + 4 * planeBytes} bytes, has ${data.length}`);
  }

  const pixels = new Uint8Array(width * height).fill(transparent);
  for (let plane = 0; plane < 4; plane++) {
    const planeStart = HEADER_SIZE + plane * planeBytes;
    for (let y = 0; y < height; y++) {
      const rowStart = planeStart + y * rowBytes;
      for (let column = 0; column < planeColumns; column++) {
        const x = column * 4 + plane;
        if (x >= width) break;
        let value: number;
        if (bitsPerPixel === 8) {
          value = data[rowStart + column]!;
        } else {
          const packed = data[rowStart + (column >> 1)]!;
          value = column & 1 ? packed & 0x0f : packed >> 4;
        }
        pixels[y * width + x] = value;
      }
    }
  }
  return { width, height, pixels, transparent, bitsPerPixel };
}

// Sprites inside the library archives.
//
//   char id[8]        "INFOILBM" or "ILBM    "; in Battle Isle also "INFO"
//                     followed by the start of the entry's own name
//   u8   background   colour index that is not drawn
//   u8   type         0x50 = 4 bits per pixel, 0x55 = 8 bits per pixel
//   u16le, u16le      0, except in Battle Isle's large unit pictures
//   u16le width, u16le height
//   pixels
//
// Pixels are stored the way VGA "Mode X" wants them: four planes, where plane p
// holds the pixels whose x is p, p+4, p+8, ... row by row. In the 4-bit type a
// byte holds two such pixels, the left one in its high nibble.
//
// The width is in pixels, except in Battle Isle's 4-bit bitmaps, where it is
// the bytes of one row over all four planes: half the pixels. The Moon of
// Chromos adds 2 to some of those (14 for a unit's 12 bytes), which four
// planes cannot hold and is dropped here. Which of the two a bitmap has is
// told by which one accounts for its length.
//
// Header as documented on the ModdingWiki ("Battle Isle / History Line library
// format"); the nibble order and the width in bytes were settled by looking
// at the result.

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
  if (id !== 'ILBM    ' && !id.startsWith('INFO')) throw new Error(`unknown bitmap id "${id}"`);
  const transparent = data[8]!;
  const type = data[9]!;
  const storedWidth = u16le(data, 14);
  const height = u16le(data, 16);
  if (type !== TYPE_4BPP && type !== TYPE_8BPP) {
    throw new Error(`unknown bitmap type 0x${type.toString(16)}`);
  }
  const bitsPerPixel = type === TYPE_4BPP ? 4 : 8;

  const rowBytesFor = (pixels: number) => {
    const columns = Math.ceil(pixels / 4);
    return bitsPerPixel === 8 ? columns : Math.ceil(columns / 2);
  };
  // Battle Isle's 4-bit bitmaps give their width as the bytes of a row.
  const widthFromBytes = 2 * (storedWidth & ~3);
  const fits = (pixels: number) => data.length === HEADER_SIZE + 4 * rowBytesFor(pixels) * height;
  const width = bitsPerPixel === 4 && !fits(storedWidth) && fits(widthFromBytes) ? widthFromBytes : storedWidth;

  const planeColumns = Math.ceil(width / 4);
  const rowBytes = rowBytesFor(width);
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

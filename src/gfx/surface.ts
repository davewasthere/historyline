// A plain RGBA pixel buffer. Everything is drawn in software into one of these
// and then handed to a canvas (browser) or a PNG encoder (tools), so both show
// exactly the same pixels.

import type { Bitmap } from '../formats/bitmap.ts';
import type { Palette } from '../formats/palette.ts';

export interface Surface {
  width: number;
  height: number;
  /** One packed RGBA value per pixel; see Palette for the byte order. */
  pixels: Uint32Array<ArrayBuffer>;
}

export function createSurface(width: number, height: number, fill = 0): Surface {
  const pixels = new Uint32Array(width * height);
  if (fill !== 0) pixels.fill(fill);
  return { width, height, pixels };
}

/**
 * Draws an indexed bitmap with its top-left corner at (left, top), skipping
 * its transparent colour. `colourOffset` is added to every drawn index, which
 * is how the game gives each side's units their own colours.
 */
export function blit(
  target: Surface,
  bitmap: Bitmap,
  left: number,
  top: number,
  palette: Palette,
  colourOffset = 0,
): void {
  const x0 = Math.max(0, -left);
  const y0 = Math.max(0, -top);
  const x1 = Math.min(bitmap.width, target.width - left);
  const y1 = Math.min(bitmap.height, target.height - top);
  for (let y = y0; y < y1; y++) {
    const sourceRow = y * bitmap.width;
    const targetRow = (top + y) * target.width + left;
    for (let x = x0; x < x1; x++) {
      const index = bitmap.pixels[sourceRow + x]!;
      if (index === bitmap.transparent) continue;
      target.pixels[targetRow + x] = palette[(index + colourOffset) & 0xff]!;
    }
  }
}

/** The surface's pixels as R,G,B,A bytes, sharing the same memory. */
export function rgbaBytes(surface: Surface): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(surface.pixels.buffer, surface.pixels.byteOffset, surface.pixels.byteLength);
}

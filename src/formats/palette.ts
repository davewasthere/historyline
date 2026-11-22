// *.PAL: 256 colours, three bytes each (red, green, blue), 8 bits per channel.

import { unpackIfPacked } from './tpwm.ts';

/** 256 colours, each packed so that a little-endian Uint32 write gives R,G,B,A bytes. */
export type Palette = Uint32Array;

export function decodePalette(file: Uint8Array): Palette {
  const data = unpackIfPacked(file);
  if (data.length !== 768) throw new Error(`palette is ${data.length} bytes, expected 768`);
  const palette = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    palette[i] = rgba(data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!);
  }
  return palette;
}

export function rgba(red: number, green: number, blue: number, alpha = 255): number {
  return ((alpha << 24) | (blue << 16) | (green << 8) | red) >>> 0;
}

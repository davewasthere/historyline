// MAP\nn.FIN: the hex fields of a map.
//
//   u16be columns, u16be rows
//   { u8 terrain; u8 unit } per field, row by row
//
// The stored grid's last column and last row are filled with the "end" terrain
// 0xAE; they mark the map's edge and are never shown. This decoder drops them.
//
// Layout as documented on the ModdingWiki ("Battle Isle / History Line map
// format").

import { u16be } from './bytes.ts';
import { unpackIfPacked } from './tpwm.ts';

export const END_TERRAIN = 0xae;
export const NO_UNIT = 0xff;

export interface GameMap {
  columns: number;
  rows: number;
  /** Terrain number per field, row by row. Indexes the terrain tile list. */
  terrain: Uint8Array;
  /** Unit code per field, row by row; NO_UNIT where the field is empty. */
  units: Uint8Array;
}

export function decodeMap(file: Uint8Array): GameMap {
  const data = unpackIfPacked(file);
  const storedColumns = u16be(data, 0);
  const storedRows = u16be(data, 2);
  const expected = 4 + 2 * storedColumns * storedRows;
  if (data.length !== expected) {
    throw new Error(`map ${storedColumns}x${storedRows} needs ${expected} bytes, has ${data.length}`);
  }
  if (storedColumns < 2 || storedRows < 2) {
    throw new Error(`map ${storedColumns}x${storedRows} has no room for fields`);
  }
  // The extra column and row are dropped by position, not by content: map 21
  // has two stray forest tiles in its extra row.
  const columns = storedColumns - 1;
  const rows = storedRows - 1;

  const terrain = new Uint8Array(columns * rows);
  const units = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const at = 4 + 2 * (row * storedColumns + column);
      terrain[row * columns + column] = data[at]!;
      units[row * columns + column] = data[at + 1]!;
    }
  }
  return { columns, rows, terrain, units };
}

export type Side = 0 | 1;

/** A unit code on the map is the unit type doubled, plus the owning side. */
export function splitUnitCode(code: number): { type: number; side: Side } {
  return { type: code >> 1, side: (code & 1) as Side };
}

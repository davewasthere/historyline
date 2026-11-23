// Battle Isle 2's files, as far as drawing a mission's map needs them.
//
// Worked out by reading the files of an installed copy; nothing here comes
// from documentation, and none of it was checked against the running game.
// All numbers are little-endian. "Checked" below means that drawing the
// result gives a sound picture, or that a size adds up in every file.
//
// Tiles (checked): terrain parts, road pieces and unit pictures are bare
// 24x24 pictures of 576 bytes with no header, in the plane order History
// Line's bitmaps have: plane p holds the pixels whose x is p, p+4, p+8, ...
// row by row. Colour 0 is not drawn in parts and road pieces, 0x8F in units.
//
// MISSnnn.DAT, a mission (checked for the map; the other sections are not
// read):
//
//   "MSSN"
//   u32 offset of the "MISS" section
//   u32 offset of the "MAP\0" section
//   u32 offset of the "SHOP" section
//   u32 offset of the "ACTN" section
//   ...
//   "ACTN" u16 columns, u16 rows
//   u16 ground[columns * rows]    a part number
//   u16 objects[columns * rows]   a part number, 0xFFFF = nothing
//   u16 units[columns * rows]     0xFFFF = none; else the unit kind in the
//                                 low byte and one bit for its owner in the
//                                 high byte
//
// Fields are laid out as History Line's: flat-topped hexagons in 24x24
// tiles, columns 16 pixels apart, odd columns half a field lower. There is no
// spare column and row at the edge.
//
// PART000.DAT: 46 bytes for each part.
//
//   +6   u32     what the part is, as bits: 1 road, 2 path, 4 trench, 8 rail
//                (checked); the other bits are not read here
//   +20  u16[5]  five part numbers, mostly the part itself. Where they differ
//                they are the same ground under snow, so they are taken to be
//                the picture for each of five kinds of weather. A guess.
//
// Roads, paths, trenches and rails are not pictures on the map (checked). A
// field of them holds a part that only says which of them it has, and the
// program draws one of 24 pieces from the matching library by which of the
// six fields around it have the same. The 24 are every set of joined sides
// there is, up to mirroring left to right and top to bottom; which piece is
// which was read off the pieces' pictures. That a neighbour joins when it has
// the same kind is a guess: roads drawn so stop one field short of some
// buildings, so the program probably joins them to more.
//
// Texts (checked): TPWM-packed, one "#nnnn:llll{TEXT}" to a line.

import type { Bitmap } from '../formats/bitmap.ts';
import { text, u16le, u32le } from '../formats/bytes.ts';
import { unpackIfPacked } from '../formats/tpwm.ts';

export const TILE_SIZE = 24;
const TILE_BYTES = TILE_SIZE * TILE_SIZE;

/** The colour that is not drawn in terrain parts and road pieces, and in unit pictures. */
export const PART_TRANSPARENT = 0;
export const UNIT_TRANSPARENT = 0x8f;

/** A bare 24x24 tile. */
export function decodeTile(data: Uint8Array, transparent: number): Bitmap {
  if (data.length < TILE_BYTES) throw new Error(`a tile needs ${TILE_BYTES} bytes, has ${data.length}`);
  const pixels = new Uint8Array(TILE_BYTES);
  let at = 0;
  for (let plane = 0; plane < 4; plane++) {
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = plane; x < TILE_SIZE; x += 4) pixels[y * TILE_SIZE + x] = data[at++]!;
    }
  }
  return { width: TILE_SIZE, height: TILE_SIZE, pixels, transparent, bitsPerPixel: 8 };
}

export const NOTHING = 0xffff;

export interface Mission {
  columns: number;
  rows: number;
  /** The part number of each field's ground, row by row. */
  ground: Uint16Array;
  /** The part number of what stands on each field; NOTHING where nothing does. */
  objects: Uint16Array;
  /** The unit on each field as the file has it; NOTHING where there is none. See splitUnit. */
  units: Uint16Array;
}

const ACTN_POINTER = 16;

export function decodeMission(file: Uint8Array): Mission {
  if (file.length < 20 || text(file, 0, 4) !== 'MSSN') throw new Error('not a mission file');
  const at = u32le(file, ACTN_POINTER);
  if (at + 8 > file.length || text(file, at, 4) !== 'ACTN') throw new Error('the mission has no map');
  const columns = u16le(file, at + 4);
  const rows = u16le(file, at + 6);
  const fields = columns * rows;
  if (fields === 0 || at + 8 + 6 * fields > file.length) {
    throw new Error(`a map of ${columns} by ${rows} fields does not fit the file`);
  }
  const layer = (number: number) =>
    Uint16Array.from({ length: fields }, (_, field) => u16le(file, at + 8 + 2 * (number * fields + field)));
  return { columns, rows, ground: layer(0), objects: layer(1), units: layer(2) };
}

/** A unit's kind, and its owner as a number from 0: the file has one bit for each of up to seven players. */
export function splitUnit(code: number): { type: number; player: number } {
  return { type: code & 0xff, player: Math.max(0, 31 - Math.clz32(code >> 8)) };
}

const PART_RECORD = 46;
/** How many pictures a part has: one for each kind of weather, it is taken. */
export const WEATHERS = 5;

/** The kinds of way a field can have, in the order of their bits and of their libraries of pieces. */
export const WAYS = ['road', 'path', 'trench', 'rail'] as const;
const WAY_BITS = 0x0f;

export interface Part {
  /** What the part is, as bits; the lowest four are the WAYS. */
  kinds: number;
  /** The part to draw for each kind of weather. */
  pictures: number[];
}

export function decodePartTable(file: Uint8Array): Part[] {
  if (file.length % PART_RECORD !== 0) {
    throw new Error(`part table length ${file.length} is not a multiple of ${PART_RECORD}`);
  }
  const parts: Part[] = [];
  for (let at = 0; at < file.length; at += PART_RECORD) {
    parts.push({
      kinds: u32le(file, at + 6),
      pictures: Array.from({ length: WEATHERS }, (_, weather) => u16le(file, at + 20 + 2 * weather)),
    });
  }
  return parts;
}

/**
 * The 24 pieces of a library of ways, as the sides each joins: bit 0 the
 * side above, the rest clockwise.
 */
export const WAY_PIECES: readonly number[] = [
  0b000000, 0b000001, 0b000010, 0b000011, 0b000101, 0b000111, 0b001001, 0b001011,
  0b001111, 0b010010, 0b010011, 0b010100, 0b010101, 0b010110, 0b010111, 0b011011,
  0b011100, 0b011101, 0b011110, 0b011111, 0b110110, 0b110111, 0b111111, 0b000110,
];

const side = (sides: number, number: number) => (sides >> number) & 1;
/** A set of sides mirrored left to right, and top to bottom. */
const mirrorAcross = (sides: number) =>
  side(sides, 0) | (side(sides, 5) << 1) | (side(sides, 4) << 2) | (side(sides, 3) << 3) | (side(sides, 2) << 4) | (side(sides, 1) << 5);
const mirrorDown = (sides: number) =>
  side(sides, 3) | (side(sides, 2) << 1) | (side(sides, 1) << 2) | (side(sides, 0) << 3) | (side(sides, 5) << 4) | (side(sides, 4) << 5);

export interface WayPiece {
  /** Which of the 24 pieces. */
  piece: number;
  /** Whether it is drawn mirrored left to right, and top to bottom. */
  across: boolean;
  down: boolean;
}

/** The piece that joins a set of sides; every set has one. */
export function wayPiece(sides: number): WayPiece {
  for (const [across, down] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    let wanted = sides & 0x3f;
    if (across) wanted = mirrorAcross(wanted);
    if (down) wanted = mirrorDown(wanted);
    const piece = WAY_PIECES.indexOf(wanted);
    if (piece >= 0) return { piece, across, down };
  }
  throw new Error(`no piece joins the sides ${sides.toString(2)}`);
}

/** A tile mirrored left to right, top to bottom, or both. */
export function mirrored(tile: Bitmap, across: boolean, down: boolean): Bitmap {
  if (!across && !down) return tile;
  const pixels = new Uint8Array(tile.pixels.length);
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      const from = (down ? tile.height - 1 - y : y) * tile.width + (across ? tile.width - 1 - x : x);
      pixels[y * tile.width + x] = tile.pixels[from]!;
    }
  }
  return { ...tile, pixels };
}

/** The ways a part has, as indexes into WAYS; none for a part that is a picture of its own. */
export function waysOf(part: Part | undefined): number[] {
  const bits = (part?.kinds ?? 0) & WAY_BITS;
  return WAYS.flatMap((_, way) => (bits & (1 << way) ? [way] : []));
}

/**
 * The parts that stand for ways: a field of them is drawn from pieces, not
 * from the part's own picture.
 */
export function isWayMarker(part: number): boolean {
  return (part >= 0x5a && part <= 0x5d) || (part >= 0x4f0 && part <= 0x4fb);
}

/** The lines of a text file by their numbers. */
export function decodeTextLines(file: Uint8Array): Map<number, string> {
  const data = unpackIfPacked(file);
  const lines = new Map<number, string>();
  for (const match of text(data, 0, data.length).matchAll(/#(\d{4}):\d{4}\{([^}]*)\}/g)) {
    lines.set(Number(match[1]), match[2]!);
  }
  return lines;
}

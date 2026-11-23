// Draws a whole map into a surface, and converts between pixels and hex fields.
//
// Fields are flat-topped hexagons in 24x24 tiles. Columns are 16 pixels apart,
// so neighbouring columns interlock, and odd columns sit half a field lower.

import { NO_UNIT, splitUnitCode, type GameMap, type Side } from '../formats/map.ts';
import { START_FACING } from '../game/state.ts';
import type { Bitmap } from '../formats/bitmap.ts';
import { blit, createSurface, rgbaBytes, type Surface } from '../gfx/surface.ts';
import { FACINGS, type GameAssets, type Season } from './assets.ts';

export const TILE_SIZE = 24;
const COLUMN_STEP = 16;
const ROW_STEP = 24;
const ODD_COLUMN_DROP = 12;

/** Added to a unit sprite's colour indexes to give each side its own colours. */
const SIDE_COLOUR_OFFSET: Record<Side, number> = { 0: 32, 1: 48 };


export interface RenderOptions {
  season: Season;
  /** Which of the game's palettes to draw with: an index into the assets' palettes. */
  palette: number;
  showUnits: boolean;
  /**
   * The way the unit on each field faces, row by row: 0 is up the map, the
   * rest follow clockwise. Without it, units face the way their side starts.
   */
  facings?: Uint8Array;
}

/** Top-left pixel of a field's tile. */
export function fieldOrigin(column: number, row: number): { x: number; y: number } {
  return { x: column * COLUMN_STEP, y: row * ROW_STEP + (column & 1 ? ODD_COLUMN_DROP : 0) };
}

export function mapPixelSize(map: GameMap): { width: number; height: number } {
  return {
    width: (map.columns - 1) * COLUMN_STEP + TILE_SIZE,
    height: map.rows * ROW_STEP + (map.columns > 1 ? ODD_COLUMN_DROP : 0),
  };
}

export function renderMap(map: GameMap, assets: GameAssets, options: RenderOptions): Surface {
  const { width, height } = mapPixelSize(map);
  const surface = createSurface(width, height);
  const tileset = assets.tilesets[options.season];
  const palette = assets.palettes[options.palette];
  if (!palette) throw new Error(`no palette ${options.palette}`);

  for (let row = 0; row < map.rows; row++) {
    for (let column = 0; column < map.columns; column++) {
      const tile = tileset.tiles[map.terrain[row * map.columns + column]!];
      if (!tile) continue;
      const { x, y } = fieldOrigin(column, row);
      blit(surface, tile, x, y, palette);
    }
  }
  if (!options.showUnits) return surface;

  for (let row = 0; row < map.rows; row++) {
    for (let column = 0; column < map.columns; column++) {
      const code = map.units[row * map.columns + column]!;
      if (code === NO_UNIT) continue;
      const { type, side } = splitUnitCode(code);
      const facing = options.facings?.[row * map.columns + column] ?? START_FACING[side];
      const sprite = assets.unitSprites[type * FACINGS + facing];
      if (!sprite) continue;
      const { x, y } = fieldOrigin(column, row);
      blit(surface, sprite, x, y, palette, SIDE_COLOUR_OFFSET[side]);
    }
  }
  return surface;
}

/**
 * One unit on a transparent tile, in its side's colours; a unit of neither
 * side is drawn grey. Null if there is no such sprite or palette.
 */
export function renderUnit(
  assets: GameAssets,
  type: number,
  side: Side | null,
  facing: number,
  paletteIndex: number,
): Surface | null {
  const sprite = assets.unitSprites[type * FACINGS + facing];
  const palette = assets.palettes[paletteIndex];
  if (!sprite || !palette) return null;
  const surface = createSurface(TILE_SIZE, TILE_SIZE);
  blit(surface, sprite, 0, 0, palette, SIDE_COLOUR_OFFSET[side ?? 0]);
  if (side === null) {
    const bytes = rgbaBytes(surface);
    for (let at = 0; at < bytes.length; at += 4) {
      const grey = Math.round(bytes[at]! * 0.3 + bytes[at + 1]! * 0.59 + bytes[at + 2]! * 0.11);
      bytes[at] = bytes[at + 1] = bytes[at + 2] = grey;
    }
  }
  return surface;
}

/**
 * A field's outline as a tile-sized mask: 1 inside the hexagon, 0 outside.
 * Taken from a terrain tile, whose transparent corners are exactly the parts
 * that belong to neighbouring fields.
 */
export function hexMask(tile: Bitmap): Uint8Array {
  const mask = new Uint8Array(tile.pixels.length);
  for (let i = 0; i < mask.length; i++) mask[i] = tile.pixels[i] === tile.transparent ? 0 : 1;
  return mask;
}

/** The field under a map pixel, or null if the pixel is outside every field. */
export function fieldAt(
  x: number,
  y: number,
  map: Pick<GameMap, 'columns' | 'rows'>,
  mask: Uint8Array,
): { column: number; row: number } | null {
  // A pixel can only belong to the column it falls in by COLUMN_STEP or to the
  // one before it, whose tile overlaps this far.
  const nearest = Math.floor(x / COLUMN_STEP);
  for (const column of [nearest, nearest - 1]) {
    if (column < 0 || column >= map.columns) continue;
    const row = Math.floor((y - (column & 1 ? ODD_COLUMN_DROP : 0)) / ROW_STEP);
    if (row < 0 || row >= map.rows) continue;
    const origin = fieldOrigin(column, row);
    const localX = x - origin.x;
    const localY = y - origin.y;
    if (localX < 0 || localX >= TILE_SIZE || localY < 0 || localY >= TILE_SIZE) continue;
    if (mask[localY * TILE_SIZE + localX]) return { column, row };
  }
  return null;
}

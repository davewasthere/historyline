// Draws a Battle Isle 2 mission's map. The fields are laid out as History
// Line's, so the geometry is the one in src/viewer/render.ts.

import type { Bitmap } from '../formats/bitmap.ts';
import { DIRECTIONS, fieldTowards } from '../game/movement.ts';
import { blit, createSurface, type Surface } from '../gfx/surface.ts';
import { fieldOrigin, TILE_SIZE } from '../viewer/render.ts';
import { UNIT_PICTURES, type Bi2Assets } from './assets.ts';
import { isWayMarker, mirrored, NOTHING, splitUnit, wayPiece, waysOf, WEATHERS, type Mission } from './formats.ts';

export interface Bi2RenderOptions {
  showUnits: boolean;
  /** Which of a part's pictures to draw, 0 to WEATHERS - 1; 0 is the ground as the maps show it. */
  weather?: number;
}

/**
 * The order two kinds of way on one field are drawn in: trench, path, road,
 * rail. A guess.
 */
const WAY_ORDER = [2, 1, 0, 3];

/**
 * How many colours a unit's picture has for its owner, and where each
 * player's set of them starts: the pictures use the first eight, the first
 * player's, and the palette has a like set every eight colours after it.
 * That the sets go by player in this order is a guess.
 */
const PLAYER_COLOURS = 8;

export function missionPixelSize(mission: Mission): { width: number; height: number } {
  return {
    width: (mission.columns - 1) * 16 + TILE_SIZE,
    height: mission.rows * TILE_SIZE + (mission.columns > 1 ? TILE_SIZE / 2 : 0),
  };
}

/** A unit's picture in a player's colours. */
function inColoursOf(sprite: Bitmap, player: number): Bitmap {
  if (player === 0) return sprite;
  const pixels = sprite.pixels.map((colour) =>
    colour < PLAYER_COLOURS && colour !== sprite.transparent ? colour + PLAYER_COLOURS * player : colour,
  );
  return { ...sprite, pixels };
}

export function renderMission(mission: Mission, assets: Bi2Assets, options: Bi2RenderOptions): Surface {
  const { columns, rows } = mission;
  const { width, height } = missionPixelSize(mission);
  const surface = createSurface(width, height);
  const weather = Math.min(Math.max(options.weather ?? 0, 0), WEATHERS - 1);
  const picture = (part: number) => assets.parts[assets.partTable[part]?.pictures[weather] ?? part] ?? assets.parts[part];
  const each = (draw: (field: number, x: number, y: number, column: number, row: number) => void) => {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const { x, y } = fieldOrigin(column, row);
        draw(row * columns + column, x, y, column, row);
      }
    }
  };

  each((field, x, y) => {
    const tile = picture(mission.ground[field]!);
    if (tile) blit(surface, tile, x, y, assets.palette);
  });

  const mirroredPieces = new Map<string, Bitmap>();
  each((field, x, y, column, row) => {
    const part = mission.objects[field]!;
    if (part === NOTHING) return;
    if (!isWayMarker(part)) {
      const tile = picture(part);
      if (tile) blit(surface, tile, x, y, assets.palette);
      return;
    }
    // A way: for each kind the field has, the piece that joins the fields around it that have the same.
    const ways = waysOf(assets.partTable[part]);
    for (const way of WAY_ORDER.filter((one) => ways.includes(one))) {
      let sides = 0;
      for (let direction = 0; direction < DIRECTIONS; direction++) {
        const near = fieldTowards({ column, row }, direction);
        if (near.column < 0 || near.column >= columns || near.row < 0 || near.row >= rows) continue;
        const other = mission.objects[near.row * columns + near.column]!;
        if (other !== NOTHING && waysOf(assets.partTable[other]).includes(way)) sides |= 1 << direction;
      }
      const { piece, across, down } = wayPiece(sides);
      const key = `${way}:${piece}:${across}:${down}`;
      let tile = mirroredPieces.get(key);
      if (!tile) {
        const plain = assets.wayPieces[way]?.[piece];
        if (!plain) continue;
        tile = mirrored(plain, across, down);
        mirroredPieces.set(key, tile);
      }
      blit(surface, tile, x, y, assets.palette);
    }
  });
  if (!options.showUnits) return surface;

  const coloured = new Map<number, Bitmap>();
  each((field, x, y) => {
    const code = mission.units[field]!;
    if (code === NOTHING) return;
    const { type, player } = splitUnit(code);
    // Every unit is drawn facing up the map: which way each faces is not known.
    const plain = assets.unitSprites[type * UNIT_PICTURES];
    if (!plain) return;
    let sprite = coloured.get(code);
    if (!sprite) coloured.set(code, (sprite = inColoursOf(plain, player)));
    blit(surface, sprite, x, y, assets.palette);
  });
  return surface;
}

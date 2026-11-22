// Tests of the hex geometry and the software blitter.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bitmap } from '../src/formats/bitmap.ts';
import type { GameMap } from '../src/formats/map.ts';
import { rgba } from '../src/formats/palette.ts';
import { blit, createSurface } from '../src/gfx/surface.ts';
import { fieldAt, fieldOrigin, hexMask, mapPixelSize, TILE_SIZE } from '../src/viewer/render.ts';

/** A tile shaped like the game's: an 8-pixel flat top widening to the full width. */
function hexTile(): Bitmap {
  const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    const inset = Math.max(0, y < 12 ? 8 - Math.floor((y * 8) / 11) : 8 - Math.floor(((23 - y) * 8) / 11));
    for (let x = 0; x < TILE_SIZE; x++) {
      pixels[y * TILE_SIZE + x] = x >= inset && x < TILE_SIZE - inset ? 1 : 0;
    }
  }
  return { width: TILE_SIZE, height: TILE_SIZE, pixels, transparent: 0, bitsPerPixel: 8 };
}

const map: GameMap = { columns: 4, rows: 3, terrain: new Uint8Array(12), units: new Uint8Array(12) };

test('odd columns sit half a field lower', () => {
  assert.deepEqual(fieldOrigin(0, 0), { x: 0, y: 0 });
  assert.deepEqual(fieldOrigin(1, 0), { x: 16, y: 12 });
  assert.deepEqual(fieldOrigin(2, 1), { x: 32, y: 24 });
  assert.deepEqual(mapPixelSize(map), { width: 72, height: 84 });
});

test('every pixel of a field maps back to that field', () => {
  const tile = hexTile();
  const mask = hexMask(tile);
  for (let row = 0; row < map.rows; row++) {
    for (let column = 0; column < map.columns; column++) {
      const origin = fieldOrigin(column, row);
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          if (!mask[y * TILE_SIZE + x]) continue;
          assert.deepEqual(fieldAt(origin.x + x, origin.y + y, map, mask), { column, row });
        }
      }
    }
  }
});

test('pixels outside every field map to nothing', () => {
  const mask = hexMask(hexTile());
  assert.equal(fieldAt(0, 0, map, mask), null); // cut-off corner of field 0,0
  assert.equal(fieldAt(20, 2, map, mask), null); // above the lowered column 1
  assert.equal(fieldAt(-1, 10, map, mask), null);
  assert.equal(fieldAt(10, 500, map, mask), null);
});

test('blit skips the transparent colour, adds the colour offset and clips', () => {
  const palette = new Uint32Array(256);
  palette[5] = rgba(10, 20, 30);
  palette[37] = rgba(40, 50, 60);
  const bitmap: Bitmap = {
    width: 2,
    height: 2,
    pixels: new Uint8Array([5, 9, 9, 5]),
    transparent: 9,
    bitsPerPixel: 8,
  };
  const surface = createSurface(3, 3);
  blit(surface, bitmap, 0, 0, palette);
  assert.deepEqual([...surface.pixels.subarray(0, 5)], [palette[5], 0, 0, 0, palette[5]]);

  blit(surface, bitmap, 2, 2, palette, 32); // only its top-left pixel is inside
  assert.equal(surface.pixels[8], palette[37]);
  blit(surface, bitmap, -1, -1, palette, 32); // only its bottom-right pixel is inside
  assert.equal(surface.pixels[0], palette[37]);
});

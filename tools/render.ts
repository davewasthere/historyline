// Renders game graphics to PNG files, to check the decoders without a browser.
//
//   node tools/render.ts map <id> [--summer | --winter] [--no-units] [options]
//   node tools/render.ts tiles [--winter] [options]
//   node tools/render.ts units [options]
//
// Options: --game G (historyline, isle, desert or moon; default historyline),
// --palette N (0-2, default 0), --scale N (default 2), --out file.
// A map is drawn in its own season unless --summer or --winter is given; the
// Battle Isle games have one set of tiles and no seasons.
// Output goes to out/ unless --out is given.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Bitmap } from '../src/formats/bitmap.ts';
import { rgba, type Palette } from '../src/formats/palette.ts';
import { blit, createSurface, type Surface } from '../src/gfx/surface.ts';
import { seasonsOf } from '../src/games.ts';
import { FACINGS, listMaps, loadAssets, loadMap, type Season } from '../src/viewer/assets.ts';
import { renderMap } from '../src/viewer/render.ts';
import { diskFiles, gameNamed } from './gameFiles.ts';
import { encodePng } from './png.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    game: { type: 'string' },
    summer: { type: 'boolean', default: false },
    winter: { type: 'boolean', default: false },
    palette: { type: 'string', default: '0' },
    'no-units': { type: 'boolean', default: false },
    scale: { type: 'string', default: '2' },
    out: { type: 'string' },
  },
});

const [command, argument] = positionals;
const forcedSeason: Season | null = values.winter ? 'winter' : values.summer ? 'summer' : null;
const scale = Number(values.scale);
if (!Number.isInteger(scale) || scale < 1) throw new Error('--scale must be a positive whole number');

const profile = gameNamed(values.game);
if (forcedSeason && !seasonsOf(profile).includes(forcedSeason)) {
  throw new Error(`${profile.title} has no ${forcedSeason} tiles`);
}
const source = diskFiles(profile);
const assets = await loadAssets(source, profile);
// History Line's pictures keep their names; another game's start with the game's.
const prefix = profile.id === 'historyline' ? '' : `${profile.id}-`;
const hasSeasons = seasonsOf(profile).length > 1;
const paletteIndex = Number(values.palette);
const palette = assets.palettes[paletteIndex];
if (!palette) throw new Error(`--palette must be 0 to ${assets.palettes.length - 1}`);

// A background no tile uses, so transparent pixels stand out.
const BACKDROP = rgba(255, 0, 255);

/** Lays bitmaps out in a grid; each cell is drawn by `draw`. */
function sheet(count: number, perRow: number, cell: number, draw: (index: number, x: number, y: number, into: Surface) => void): Surface {
  const gap = 2;
  const pitch = cell + gap;
  const surface = createSurface(perRow * pitch + gap, Math.ceil(count / perRow) * pitch + gap, BACKDROP);
  for (let i = 0; i < count; i++) {
    draw(i, gap + (i % perRow) * pitch, gap + Math.floor(i / perRow) * pitch, surface);
  }
  return surface;
}

function bitmapSheet(bitmaps: Bitmap[], perRow: number, palette: Palette): Surface {
  const cell = Math.max(...bitmaps.map((bitmap) => Math.max(bitmap.width, bitmap.height)));
  return sheet(bitmaps.length, perRow, cell, (i, x, y, into) => blit(into, bitmaps[i]!, x, y, palette));
}

let surface: Surface;
let name: string;
switch (command) {
  case 'map': {
    if (!argument) throw new Error('usage: render.ts map <id>');
    const id = argument.padStart(2, '0');
    const info = (await listMaps(source)).find((entry) => entry.id === id);
    if (!info) throw new Error(`there is no map ${id}`);
    const season = forcedSeason ?? info.season;
    const { map } = await loadMap(source, id, profile);
    surface = renderMap(map, assets, { season, palette: paletteIndex, showUnits: !values['no-units'] });
    name = hasSeasons ? `${prefix}map-${id}-${season}.png` : `${prefix}map-${id}.png`;
    console.log(
      `map ${id}: ${map.columns} x ${map.rows} fields` +
        (hasSeasons ? `, a ${info.season} map drawn in ${season}` : `, ${profile.title}`),
    );
    break;
  }
  case 'tiles': {
    const season = forcedSeason ?? 'summer';
    const tileset = assets.tilesets[season];
    surface = bitmapSheet(tileset.tiles, 16, palette);
    name = hasSeasons ? `${prefix}tiles-${season}.png` : `${prefix}tiles.png`;
    console.log(`${tileset.tiles.length} terrain tiles, 16 per row, in terrain-number order`);
    break;
  }
  case 'units': {
    // Two unit types per row; each shows its six facings in the first side's
    // colours, then in the second's.
    const sprites = assets.unitSprites;
    const types = sprites.length / FACINGS;
    surface = sheet(types * FACINGS * 2, FACINGS * 4, 24, (i, x, y, into) => {
      const type = Math.floor(i / (FACINGS * 2));
      const slot = i % (FACINGS * 2);
      const sprite = sprites[type * FACINGS + (slot % FACINGS)]!;
      blit(into, sprite, x, y, palette, slot < FACINGS ? 32 : 48);
    });
    name = `${prefix}units.png`;
    const [first, second] = profile.sides;
    console.log(`${types} unit types, two per row: facings 0-5 ${first}, then 0-5 ${second}`);
    break;
  }
  default:
    throw new Error('usage: render.ts map <id> | tiles | units');
}

const target = resolve(values.out ?? join(import.meta.dirname, '..', 'out', name));
await mkdir(dirname(target), { recursive: true });
await writeFile(target, encodePng(surface, scale));
console.log(`wrote ${target} (${surface.width * scale} x ${surface.height * scale})`);

// The Battle Isle 2 half of tools/render.ts: draws a mission's map, the
// terrain parts or the unit pictures to a surface.

import { loadBi2Game, UNIT_PICTURES } from '../src/bi2/assets.ts';
import { TILE_SIZE } from '../src/bi2/formats.ts';
import { BI2_GAME_ID, BI2_TITLE } from '../src/bi2/games.ts';
import { renderMission } from '../src/bi2/render.ts';
import type { Bitmap } from '../src/formats/bitmap.ts';
import { rgba } from '../src/formats/palette.ts';
import { blit, createSurface, type Surface } from '../src/gfx/surface.ts';
import { bi2Files, installedBi2Disks } from './gameFiles.ts';

/** A background no tile uses, so transparent pixels stand out. */
const BACKDROP = rgba(255, 0, 255);

export interface Bi2Picture {
  surface: Surface;
  /** The file name the picture gets in out/. */
  name: string;
  /** What it shows, in a line. */
  about: string;
}

export async function renderBi2(
  command: string | undefined,
  argument: string | undefined,
  showUnits: boolean,
): Promise<Bi2Picture> {
  const game = await loadBi2Game(installedBi2Disks().map((disk) => ({ disk, source: bi2Files(disk) })));
  const { assets } = game;
  const sheet = (bitmaps: Bitmap[], perRow: number): Surface => {
    const pitch = TILE_SIZE + 2;
    const surface = createSurface(perRow * pitch + 2, Math.ceil(bitmaps.length / perRow) * pitch + 2, BACKDROP);
    bitmaps.forEach((bitmap, i) => {
      blit(surface, bitmap, 2 + (i % perRow) * pitch, 2 + Math.floor(i / perRow) * pitch, assets.palette);
    });
    return surface;
  };
  switch (command) {
    case 'map': {
      if (!argument) throw new Error('usage: render.ts --game bi2 map <number>');
      const id = argument.padStart(3, '0');
      const info = game.missions.find((entry) => entry.id === id);
      if (!info) throw new Error(`there is no mission ${id}`);
      const mission = await game.loadMission(info);
      return {
        surface: renderMission(mission, assets, { showUnits }),
        name: `${BI2_GAME_ID}-map-${id}.png`,
        about:
          `mission ${id}${info.title ? ` "${info.title}"` : ''}: ${mission.columns} x ${mission.rows} fields, ` +
          `${BI2_TITLE} (${info.disk.title.toLowerCase()})`,
      };
    }
    case 'tiles':
      return {
        surface: sheet(assets.parts, 32),
        name: `${BI2_GAME_ID}-tiles.png`,
        about: `${assets.parts.length} terrain parts, 32 per row, in part-number order`,
      };
    case 'units':
      return {
        surface: sheet(assets.unitSprites, UNIT_PICTURES * 6),
        name: `${BI2_GAME_ID}-units.png`,
        about: `${assets.unitSprites.length / UNIT_PICTURES} unit kinds, six per row: each facing up, then to the upper right`,
      };
    default:
      throw new Error('usage: render.ts --game bi2 map <number> | tiles | units');
  }
}

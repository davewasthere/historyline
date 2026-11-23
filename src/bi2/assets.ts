// Loads what drawing a Battle Isle 2 mission needs from the game's files.

import { readPlainArchive } from '../formats/archive.ts';
import type { Bitmap } from '../formats/bitmap.ts';
import { decodePalette, type Palette } from '../formats/palette.ts';
import type { FileSource } from '../viewer/assets.ts';
import {
  decodeMission,
  decodePartTable,
  decodeTextLines,
  decodeTile,
  PART_TRANSPARENT,
  UNIT_TRANSPARENT,
  WAYS,
  type Mission,
  type Part,
} from './formats.ts';
import type { Bi2Disk } from './games.ts';

/** Pictures a unit kind has: facing up the map, and facing to the upper right. */
export const UNIT_PICTURES = 2;

export interface Bi2Assets {
  /** The terrain parts' pictures, by part number. */
  parts: Bitmap[];
  /** What each part is. */
  partTable: Part[];
  /** The 24 pieces of each kind of way, in the order of WAYS. */
  wayPieces: Bitmap[][];
  /** Unit pictures, UNIT_PICTURES for each kind. */
  unitSprites: Bitmap[];
  /** The name of each unit kind. */
  unitNames: string[];
  palette: Palette;
}

async function tiles(source: FileSource, path: string, transparent: number): Promise<Bitmap[]> {
  return readPlainArchive(await source.read(path)).map((entry) => decodeTile(entry.data, transparent));
}

/** Loads a disk's tiles and tables. */
export async function loadBi2Assets(source: FileSource): Promise<Bi2Assets> {
  const [parts, partTable, unitSprites, unitNames, palette, ...wayPieces] = await Promise.all([
    tiles(source, 'LIB/PART000.LIB', PART_TRANSPARENT),
    source.read('LIB/PART000.DAT').then(decodePartTable),
    tiles(source, 'LIB/UNIT000.LIB', UNIT_TRANSPARENT),
    source.read('ENG/UNIT000.TXT').then(decodeTextLines),
    source.read('LBM/GAME.PAL').then(decodePalette),
    ...WAYS.map((_, way) => tiles(source, `LIB/LAYR00${way}.LIB`, PART_TRANSPARENT)),
  ]);
  const kinds = unitSprites.length / UNIT_PICTURES;
  return {
    parts,
    partTable,
    wayPieces,
    unitSprites,
    // The first lines of the unit texts are the kinds' names, in the unit table's order.
    unitNames: Array.from({ length: kinds }, (_, kind) => unitNames.get(kind) ?? `unit kind ${kind}`),
    palette,
  };
}

export interface MissionInfo {
  /** The mission's number as in its file's name, for example "004". The two disks share no number. */
  id: string;
  /** The disk it is on. */
  disk: Bi2Disk;
  /** The name of its map, and what is to be done there, from its text file; empty if it has none. */
  title: string;
  about: string;
  /** The word that starts it in the game; empty if the disk's list has none for it. */
  password: string;
}

/** The first line of MAPNAME.TXT and MAPNAME.DAT that names a mission; those before it are other texts. */
const FIRST_PASSWORD_LINE = 16;

/** The missions on a disk, in the order of their numbers. */
export async function listMissions(source: FileSource, disk: Bi2Disk): Promise<MissionInfo[]> {
  const [missionFiles, textFiles, passwords, numbers] = await Promise.all([
    source.list('MIS'),
    source.list('ENG'),
    source.read('MIS/MAPNAME.TXT').then(decodeTextLines),
    source.read('MIS/MAPNAME.DAT').then(decodeTextLines),
  ]);
  const passwordOf = new Map<string, string>();
  for (const [line, number] of numbers) {
    if (line >= FIRST_PASSWORD_LINE) passwordOf.set(number, passwords.get(line) ?? '');
  }
  const ids = missionFiles
    .map((name) => /^MISS(\d{3})\.DAT$/i.exec(name)?.[1])
    .filter((id) => id !== undefined)
    .sort();
  const withText = new Set(textFiles.map((name) => name.toUpperCase()));
  return Promise.all(
    ids.map(async (id) => {
      const lines = withText.has(`MISS${id}.TXT`) ? decodeTextLines(await source.read(`ENG/MISS${id}.TXT`)) : null;
      return { id, disk, title: lines?.get(1) ?? '', about: lines?.get(0) ?? '', password: passwordOf.get(id) ?? '' };
    }),
  );
}

export async function loadMission(source: FileSource, id: string): Promise<Mission> {
  return decodeMission(await source.read(`MIS/MISS${id}.DAT`));
}

/** Battle Isle 2 as installed: the missions of every disk that is there, and one set of tiles for all of them. */
export interface Bi2Game {
  assets: Bi2Assets;
  /** The missions of every disk in one list, in the order of their numbers. */
  missions: MissionInfo[];
  /** Reads a mission's map from the disk it is on. */
  loadMission(info: MissionInfo): Promise<Mission>;
}

/**
 * Loads Battle Isle 2 from its disks, given with where each one's files come
 * from. A disk that cannot be read is taken not to be installed and left
 * out. The tiles and names come from the last disk that is there: the add-on
 * has the game's and six unit kinds more.
 */
export async function loadBi2Game(disks: readonly { disk: Bi2Disk; source: FileSource }[]): Promise<Bi2Game> {
  const listed = await Promise.all(
    disks.map(async ({ disk, source }) => {
      try {
        return { source, missions: await listMissions(source, disk) };
      } catch {
        return null;
      }
    }),
  );
  const found = listed.filter((entry) => entry !== null);
  const last = found.at(-1);
  if (!last) throw new Error('no Battle Isle 2 disk could be read');
  const sources = new Map(found.flatMap(({ source, missions }) => missions.map((info) => [info, source] as const)));
  return {
    assets: await loadBi2Assets(last.source),
    missions: found.flatMap((entry) => entry.missions).sort((a, b) => Number(a.id) - Number(b.id)),
    loadMission: (info) => {
      const source = sources.get(info);
      if (!source) throw new Error(`mission ${info.id} is not one of this game's`);
      return loadMission(source, info.id);
    },
  };
}

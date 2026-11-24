// Loads what the map viewer needs from the original game's files: History
// Line's, or those of one of the Battle Isle games (see src/games.ts).

import { decodeWorkGround } from '../formats/amok.ts';
import { readArchive, readNameList } from '../formats/archive.ts';
import { decodeBitmap, type Bitmap } from '../formats/bitmap.ts';
import { decodeComputerTable, type ComputerTable } from '../formats/computerTable.ts';
import { decodeMap, type GameMap, type Side } from '../formats/map.ts';
import { decodeMapRecords } from '../formats/mapRecords.ts';
import { decodePalette, type Palette } from '../formats/palette.ts';
import { decodeShops, type MapShops } from '../formats/shops.ts';
import { decodeTerrainTypes, type TerrainType } from '../formats/terrain.ts';
import { decodeUnitTypes, type UnitType } from '../formats/unitTypes.ts';
import type { Rules } from '../game/rules.ts';
import { GAMES, type GameId, type GameProfile, type Season, type TilesetFiles } from '../games.ts';

export type { Season } from '../games.ts';

/** Where a game's files come from: the disk in tools, HTTP in the browser. */
export interface FileSource {
  /** Reads a file by its path inside the game's own folder, with forward slashes. */
  read(path: string): Promise<Uint8Array>;
  /** Lists the file names in a folder of the game. */
  list(directory: string): Promise<string[]>;
}

export interface Tileset {
  /** Terrain tiles, indexed by the terrain number used in map files. */
  tiles: Bitmap[];
  /** The game's own name for each tile's graphic, in the same order. */
  tileNames: string[];
  /** Properties of each terrain number in this season. */
  terrainTypes: TerrainType[];
}

/** Directions a unit sprite can face; each unit type has one sprite per direction. */
export const FACINGS = 6;

/**
 * The game's palette files. Which one is used is a setting in the game's
 * menu, not a property of the map: they share the terrain colours and differ
 * in the colours of the two sides' units.
 */
export const PALETTE_FILES = ['00.PAL', '01.PAL', '02.PAL'] as const;

export interface GameAssets {
  /** The game these are the files of. */
  profile: GameProfile;
  /** The tiles of each season. A game with one set of tiles has it under both. */
  tilesets: Record<Season, Tileset>;
  /** One palette per entry of PALETTE_FILES. */
  palettes: Palette[];
  /** Unit sprites, FACINGS per unit type: index = type * FACINGS + facing. */
  unitSprites: Bitmap[];
  unitTypes: UnitType[];
  /**
   * The computer's table for each side it can play, for maps that have none
   * of their own: that of the first map on which the original's computer
   * plays that side. Null if the file is not there.
   */
  computerTables: Record<Side, ComputerTable | null>;
  /** The numbers the rules need that differ between the games. */
  rules: Rules;
}

async function readComputerTable(source: FileSource, mapId: string, profile: GameProfile): Promise<ComputerTable | null> {
  try {
    return decodeComputerTable(await source.read(`MAP/${mapId}.COM`), profile.computerFlags);
  } catch {
    // Two-player maps have no such file.
    return null;
  }
}

/** The numbers of the maps that have a file with an extension, in order. */
function mapIdsWith(fileNames: readonly string[], extension: string): string[] {
  const ending = `.${extension}`;
  return fileNames
    .map((name) => name.toUpperCase())
    .filter((name) => name.endsWith(ending) && /^\d+$/.test(name.slice(0, -ending.length)))
    .map((name) => name.slice(0, -ending.length))
    .sort();
}

/** Loads a game's files; `source` reads from that game's own folder. */
export async function loadAssets(source: FileSource, profile: GameProfile = GAMES.historyline): Promise<GameAssets> {
  const [summer, winter, unitSprites, unitTable, amok, mapFiles, ...palettes] = await Promise.all([
    loadTileset(source, profile.tilesets.summer, profile),
    profile.tilesets.winter ? loadTileset(source, profile.tilesets.winter, profile) : null,
    loadNumberedBitmaps(source, profile.unitSprites.library, profile.unitSprites.names),
    source.read('UNIT.DAT'),
    source.read('AMOK.DAT'),
    source.list('MAP'),
    ...PALETTE_FILES.map((file) => source.read(file)),
  ]);
  // The first single-player map on which the original's computer plays each side.
  const withTable = mapIdsWith(mapFiles, 'COM');
  const tableFor = (side: Side) => {
    const mapId = withTable.find((id) => profile.computerSide(id) === side);
    return mapId === undefined ? null : readComputerTable(source, mapId, profile);
  };
  const [first, second] = await Promise.all([tableFor(0), tableFor(1)]);
  return {
    profile,
    tilesets: { summer, winter: winter ?? summer },
    palettes: palettes.map(decodePalette),
    unitSprites: unitSprites.bitmaps,
    unitTypes: decodeUnitTypes(unitTable, profile.unitLayout),
    computerTables: { 0: first, 1: second },
    rules: { ...profile.rules, ...decodeWorkGround(amok) },
  };
}

async function loadTileset(source: FileSource, files: TilesetFiles, profile: GameProfile): Promise<Tileset> {
  const [tiles, terrain] = await Promise.all([
    loadNumberedBitmaps(source, files.library, files.names),
    source.read(files.terrain),
  ]);
  // A tile's corners lie outside its field, so its first pixel has the colour
  // that is not drawn. The tiles' headers say the same, except The Desert's,
  // which all say 0.
  for (const tile of tiles.bitmaps) tile.transparent = tile.pixels[0] ?? tile.transparent;
  return {
    tiles: tiles.bitmaps,
    tileNames: tiles.names,
    terrainTypes: decodeTerrainTypes(terrain, profile.combatGrounds ?? undefined),
  };
}

/**
 * Loads a library's bitmaps in the order its companion name list gives
 * them, or, for a library without one, in the order of its entries' names,
 * which then start with their numbers.
 */
async function loadNumberedBitmaps(
  source: FileSource,
  libraryPath: string,
  namesPath: string | null,
): Promise<{ bitmaps: Bitmap[]; names: string[] }> {
  const [library, nameList] = await Promise.all([
    source.read(libraryPath),
    namesPath === null ? null : source.read(namesPath),
  ]);
  const entries = readArchive(library);
  if (nameList === null) {
    const sorted = entries.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { bitmaps: sorted.map((entry) => decodeBitmap(entry.data)), names: sorted.map((entry) => entry.name) };
  }
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  const names = readNameList(nameList);
  const bitmaps = names.map((name) => {
    const data = byName.get(name);
    if (!data) throw new Error(`${libraryPath} has no entry "${name}" named in ${namesPath}`);
    return decodeBitmap(data);
  });
  return { bitmaps, names };
}

export interface MapInfo {
  /** Two-digit map number as used in the file names, for example "07". */
  id: string;
  /**
   * True if the map has a .COM file, which holds the computer opponent's data:
   * these are the single-player maps. The rest are for two players.
   */
  singlePlayer: boolean;
  /** The season the game plays this map in. */
  season: Season;
  /** The word a player types in the game to start this map. */
  code: string;
  /** For a map that is not the game's but made from a sketch in maps/: its name. */
  title?: string;
  /** For such a map, what its sketch says the battle is about. */
  about?: string;
  /**
   * For a map of another game rebuilt as one of this game's (see
   * src/maps/battleIsle.ts): that game's id, and the map's number there.
   */
  from?: { game: GameId; mapId: string };
}

export async function listMaps(source: FileSource): Promise<MapInfo[]> {
  const [fileNames, recordFile] = await Promise.all([source.list('MAP'), source.read('CODES.DAT')]);
  const records = decodeMapRecords(recordFile);
  const computerFiles = new Set(mapIdsWith(fileNames, 'COM'));
  return mapIdsWith(fileNames, 'FIN')
    .map((id) => {
      const record = records[Number(id)];
      return {
        id,
        singlePlayer: computerFiles.has(id),
        season: record?.winter ? 'winter' : 'summer',
        code: record?.code ?? '',
      };
    });
}

export interface LoadedMap {
  map: GameMap;
  shops: MapShops;
  /** The map's own table for the computer's player; null for a two-player map. */
  computerTable: ComputerTable | null;
}

export async function loadMap(
  source: FileSource,
  id: string,
  profile: GameProfile = GAMES.historyline,
): Promise<LoadedMap> {
  const [fields, shops, computerTable] = await Promise.all([
    source.read(`MAP/${id}.FIN`),
    source.read(`MAP/${id}.SHP`),
    readComputerTable(source, id, profile),
  ]);
  return { map: decodeMap(fields), shops: decodeShops(shops, profile.unitKinds), computerTable };
}

/**
 * The table the computer plays a side of a map by: the map's own if the
 * original's computer plays that side there, else the one kept for that side.
 */
export function computerTableFor(assets: GameAssets, loaded: LoadedMap, mapId: string, side: Side): ComputerTable | null {
  return (assets.profile.computerSide(mapId) === side ? loaded.computerTable : null) ?? assets.computerTables[side];
}

// Loads what the map viewer needs from the original game's files.

import { readArchive, readNameList } from '../formats/archive.ts';
import { decodeBitmap, type Bitmap } from '../formats/bitmap.ts';
import { decodeComputerTable, type ComputerTable } from '../formats/computerTable.ts';
import { decodeMap, type GameMap, type Side } from '../formats/map.ts';
import { decodeMapRecords } from '../formats/mapRecords.ts';
import { decodePalette, type Palette } from '../formats/palette.ts';
import { decodeShops, type MapShops } from '../formats/shops.ts';
import { decodeTerrainTypes, type TerrainType } from '../formats/terrain.ts';
import { decodeUnitTypes, type UnitType } from '../formats/unitTypes.ts';

/** Where the game's files come from: the disk in tools, HTTP in the browser. */
export interface FileSource {
  /** Reads a file by its path inside the game folder, with forward slashes. */
  read(path: string): Promise<Uint8Array>;
  /** Lists the file names in a folder of the game. */
  list(directory: string): Promise<string[]>;
}

export type Season = 'summer' | 'winter';

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
}

/** The first map on which the original's computer plays the German side; on those before it, it plays the French. */
export const FIRST_MAP_OF_GERMAN_COMPUTER = 24;

/** The side the original's computer plays on a single-player map. */
export function computerSideOf(mapId: string): Side {
  return Number(mapId) < FIRST_MAP_OF_GERMAN_COMPUTER ? 1 : 0;
}

async function readComputerTable(source: FileSource, mapId: string): Promise<ComputerTable | null> {
  try {
    return decodeComputerTable(await source.read(`MAP/${mapId}.COM`));
  } catch {
    // Two-player maps have no such file.
    return null;
  }
}

const SEASON_FILES: Record<Season, { library: string; names: string; terrain: string }> = {
  summer: { library: 'LIB/PARTS.LIB', names: 'LIB/PARTS.DAT', terrain: 'WW1GNDS.DAT' },
  winter: { library: 'LIB/PARTW.LIB', names: 'LIB/PARTW.DAT', terrain: 'WW1GNDW.DAT' },
};

export async function loadAssets(source: FileSource): Promise<GameAssets> {
  const [summer, winter, unitSprites, unitTable, german, french, ...palettes] = await Promise.all([
    loadTileset(source, 'summer'),
    loadTileset(source, 'winter'),
    loadNumberedBitmaps(source, 'LIB/UNIT.LIB', 'LIB/UNIT.DAT'),
    source.read('UNIT.DAT'),
    readComputerTable(source, String(FIRST_MAP_OF_GERMAN_COMPUTER)),
    readComputerTable(source, '00'),
    ...PALETTE_FILES.map((file) => source.read(file)),
  ]);
  return {
    tilesets: { summer, winter },
    palettes: palettes.map(decodePalette),
    unitSprites: unitSprites.bitmaps,
    unitTypes: decodeUnitTypes(unitTable),
    computerTables: { 0: german, 1: french },
  };
}

async function loadTileset(source: FileSource, season: Season): Promise<Tileset> {
  const files = SEASON_FILES[season];
  const [tiles, terrain] = await Promise.all([
    loadNumberedBitmaps(source, files.library, files.names),
    source.read(files.terrain),
  ]);
  return { tiles: tiles.bitmaps, tileNames: tiles.names, terrainTypes: decodeTerrainTypes(terrain) };
}

/** Loads a library's bitmaps in the order its companion name list gives them. */
async function loadNumberedBitmaps(
  source: FileSource,
  libraryPath: string,
  namesPath: string,
): Promise<{ bitmaps: Bitmap[]; names: string[] }> {
  const [library, nameList] = await Promise.all([source.read(libraryPath), source.read(namesPath)]);
  const byName = new Map(readArchive(library).map((entry) => [entry.name, entry.data]));
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
}

export async function listMaps(source: FileSource): Promise<MapInfo[]> {
  const [fileNames, recordFile] = await Promise.all([source.list('MAP'), source.read('CODES.DAT')]);
  const names = fileNames.map((name) => name.toUpperCase());
  const records = decodeMapRecords(recordFile);
  const computerFiles = new Set(names.filter((name) => name.endsWith('.COM')).map((name) => name.slice(0, -4)));
  return names
    .filter((name) => /^\d+\.FIN$/.test(name))
    .map((name) => name.slice(0, -4))
    .sort()
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

export async function loadMap(source: FileSource, id: string): Promise<LoadedMap> {
  const [fields, shops, computerTable] = await Promise.all([
    source.read(`MAP/${id}.FIN`),
    source.read(`MAP/${id}.SHP`),
    readComputerTable(source, id),
  ]);
  return { map: decodeMap(fields), shops: decodeShops(shops), computerTable };
}

/**
 * The table the computer plays a side of a map by: the map's own if the
 * original's computer plays that side there, else the one kept for that side.
 */
export function computerTableFor(assets: GameAssets, loaded: LoadedMap, mapId: string, side: Side): ComputerTable | null {
  return (computerSideOf(mapId) === side ? loaded.computerTable : null) ?? assets.computerTables[side];
}

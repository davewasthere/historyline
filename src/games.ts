// The games this project reads, and what differs between their files.
//
// History Line 1914-1918 came out of Battle Isle: the same program a version
// on, with the same kinds of data files. Battle Isle itself is three games
// that are installed side by side, each in a folder of its own with its own
// maps, tiles and unit table: Battle Isle (ISLE), its first data disk The
// Desert (DESERT) and its second, The Moon of Chromos (MOON). The Moon came
// out after History Line and has some of its file forms.
//
// What differs, by file:
//
//   - Terrain: History Line has a summer and a winter set of tiles, each with
//     a terrain table; Battle Isle has one set (LIB\PART.LIB, GROUND.DAT).
//     The Moon has no list of tile names: its library's entries are numbered
//     by name, and so are its unit pictures.
//   - UNIT.DAT: 51 kinds of 69 bytes against 27 kinds of 68 (see
//     formats/unitTypes.ts). Battle Isle's two armies have the same kinds.
//   - MAP\nn.SHP: its list of kinds is as long as the unit table.
//   - MAP\nn.COM: the first Battle Isle and The Desert store the bits the
//     other way round (see formats/computerTable.ts).
//   - The terrain classes: the same seven bits, for other kinds of ground.
//     Battle Isle's names below were read off which tiles have which bit;
//     its manual was not at hand to check them against.
//   - The number a terrain record gives for the ground in a fight: History
//     Line's index its table of bonuses, Battle Isle's name the picture the
//     fight is shown on (1 mountains, 2 bridge, 3 road, 4 wall, 5 water,
//     6 plain, 7 forest; read off which tiles have which). Battle Isle's
//     table of bonuses was not found in its program, so each kind of ground
//     gets History Line's bonus for it, and walls and plains none. That is an
//     assumption.

import type { FlagOrder } from './formats/computerTable.ts';
import type { Side } from './formats/map.ts';
import { TERRAIN_CLASSES, type TerrainClass } from './formats/terrain.ts';
import type { UnitLayout } from './formats/unitTypes.ts';
import { BATTLE_ISLE_RULES, HISTORYLINE_RULES, type Rules, type WorkGround } from './game/rules.ts';

export type GameId = 'historyline' | 'isle' | 'desert' | 'moon';

/** A copy of a game as installed: History Line's folder, or Battle Isle's, which holds its three games. */
export type InstallId = 'historyline' | 'battleisle';

export type Season = 'summer' | 'winter';

/** The files of one set of terrain tiles. */
export interface TilesetFiles {
  library: string;
  /** The list that puts the library's entries in terrain-number order; null if their names do. */
  names: string | null;
  /** The terrain table. */
  terrain: string;
}

export interface GameProfile {
  id: GameId;
  title: string;
  install: InstallId;
  /** The game's folder inside its install, with a slash after it; empty if it is the install's own. */
  folder: string;
  /** What the two sides are called. */
  sides: readonly [string, string];
  /** The sets of tiles: History Line's two seasons, or the one set every map of the game is drawn with. */
  tilesets: { summer: TilesetFiles; winter?: TilesetFiles };
  /** The unit pictures, six for each kind. */
  unitSprites: { library: string; names: string | null };
  unitLayout: UnitLayout;
  /** How many unit kinds the game has. */
  unitKinds: number;
  computerFlags: FlagOrder;
  /** What ground each terrain class is in this game. */
  terrainClasses: readonly TerrainClass[];
  /** History Line's number for each of the game's kinds of ground in a fight; null for History Line itself. */
  combatGrounds: readonly number[] | null;
  /** What the game's three palettes look like, for the viewer's list. */
  palettes: readonly [string, string, string];
  /** The side the original's computer plays on a single-player map. */
  computerSide(mapId: string): Side;
  /** The rules' numbers that do not come from the game's files. */
  rules: Omit<Rules, keyof WorkGround>;
  /** Whether new maps can be made from the sketches in maps/: only with the tiles those were worked out for. */
  sketches: boolean;
}

/** The first History Line map on which the original's computer plays the German side; on those before it, it plays the French. */
export const FIRST_MAP_OF_GERMAN_COMPUTER = 24;

/** Battle Isle's kinds of ground in a fight (1 to 7) as History Line's: mountains, bridges, roads, water and forest. */
const BATTLE_ISLE_COMBAT_GROUNDS = [8, 0, 3, 4, 8, 7, 8, 1] as const;

/** The terrain classes of Battle Isle and The Desert. */
const ISLAND_TERRAIN_CLASSES: readonly TerrainClass[] = [
  { bit: 1, name: 'deep water' },
  { bit: 2, name: 'water' },
  { bit: 4, name: 'shallow water' },
  { bit: 8, name: 'roads, bridges' },
  { bit: 16, name: 'open ground' },
  { bit: 32, name: 'forest' },
  { bit: 64, name: 'mountains' },
];

/** The terrain classes of The Moon of Chromos. */
const MOON_TERRAIN_CLASSES: readonly TerrainClass[] = [
  { bit: 1, name: 'open ground, roads' },
  { bit: 2, name: 'craters' },
  { bit: 4, name: 'plants' },
  { bit: 8, name: 'clefts' },
  { bit: 16, name: 'ridges, wrecks' },
  { bit: 32, name: 'lava' },
  { bit: 64, name: 'dust' },
];

const battleIsle = {
  install: 'battleisle',
  // The games do not name the sides; the first is the one on the left of the original's split screen.
  sides: ['Player 1', 'Player 2'],
  unitLayout: 'battleisle',
  unitKinds: 27,
  combatGrounds: BATTLE_ISLE_COMBAT_GROUNDS,
  // Which side the original's computer plays there has not been checked.
  computerSide: () => 1,
  rules: BATTLE_ISLE_RULES,
  sketches: false,
} satisfies Partial<GameProfile>;

export const GAMES: Record<GameId, GameProfile> = {
  historyline: {
    id: 'historyline',
    title: 'Historyline 1914-1918',
    install: 'historyline',
    folder: '',
    sides: ['German', 'French'],
    tilesets: {
      summer: { library: 'LIB/PARTS.LIB', names: 'LIB/PARTS.DAT', terrain: 'WW1GNDS.DAT' },
      winter: { library: 'LIB/PARTW.LIB', names: 'LIB/PARTW.DAT', terrain: 'WW1GNDW.DAT' },
    },
    unitSprites: { library: 'LIB/UNIT.LIB', names: 'LIB/UNIT.DAT' },
    unitLayout: 'historyline',
    unitKinds: 51,
    computerFlags: 'low-first',
    terrainClasses: TERRAIN_CLASSES,
    combatGrounds: null,
    palettes: ['Green and tan', 'Blue and yellow', 'Grey'],
    computerSide: (mapId) => (Number(mapId) < FIRST_MAP_OF_GERMAN_COMPUTER ? 1 : 0),
    rules: HISTORYLINE_RULES,
    sketches: true,
  },
  isle: {
    ...battleIsle,
    id: 'isle',
    title: 'Battle Isle',
    folder: 'ISLE/',
    tilesets: { summer: { library: 'LIB/PART.LIB', names: 'LIB/PART.DAT', terrain: 'GROUND.DAT' } },
    unitSprites: { library: 'LIB/UNIT.LIB', names: 'LIB/UNIT.DAT' },
    computerFlags: 'high-first',
    terrainClasses: ISLAND_TERRAIN_CLASSES,
    palettes: ['Red and yellow', 'Green and blue', 'Grey'],
  },
  desert: {
    ...battleIsle,
    id: 'desert',
    title: 'Battle Isle: The Desert',
    folder: 'DESERT/',
    tilesets: { summer: { library: 'LIB/PART.LIB', names: 'LIB/PART.DAT', terrain: 'GROUND.DAT' } },
    unitSprites: { library: 'LIB/UNIT.LIB', names: 'LIB/UNIT.DAT' },
    computerFlags: 'high-first',
    terrainClasses: ISLAND_TERRAIN_CLASSES,
    palettes: ['Red and green', 'Tan and olive', 'Black and white'],
  },
  moon: {
    ...battleIsle,
    id: 'moon',
    title: 'Battle Isle: The Moon of Chromos',
    folder: 'MOON/',
    tilesets: { summer: { library: 'LIB/PART.LIB', names: null, terrain: 'GROUND.DAT' } },
    unitSprites: { library: 'LIB/UNIT.LIB', names: null },
    computerFlags: 'low-first',
    terrainClasses: MOON_TERRAIN_CLASSES,
    palettes: ['Blue and green', 'Orange and teal', 'White and grey'],
  },
};

export const GAME_IDS = Object.keys(GAMES) as GameId[];

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && Object.hasOwn(GAMES, value);
}

/** The seasons a game has tiles for. */
export function seasonsOf(profile: GameProfile): Season[] {
  return profile.tilesets.winter ? ['summer', 'winter'] : ['summer'];
}

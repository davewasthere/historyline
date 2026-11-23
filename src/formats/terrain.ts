// WW1GNDS.DAT (summer) and WW1GNDW.DAT (winter): six bytes of properties for
// each of the 175 terrain numbers. Battle Isle's GROUND.DAT is the same table
// for its one set of tiles.
//
//   offset  field
//    0      bits 0-2: a building entrance, and whose (see ENTRANCE_*);
//           bit 5: part of a headquarters; bit 6: its entrance;
//           bit 7: part of a depot
//    1      bit 0: the entrance of a depot; bit 1: part of a factory;
//           bit 2: its entrance; bit 6: aircraft cannot end a move here
//           (every field of a building but its entrance, and ground prepared
//           for a depot); bit 7: ground a depot can be built on (open plains
//           and trenches)
//    2      terrain class, a single bit; 128 for fields nothing can enter
//    3      cost for ground units and ships to enter the field
//    4      cost for aircraft to fly onto it
//    5      which entry of the ground bonus table applies in a fight here
//           (see src/game/combat.ts). Battle Isle numbers its kinds of
//           ground differently and its table has not been found: its numbers
//           are turned into History Line's for the same kind of ground (see
//           src/games.ts)
//
// The other bits of bytes 0 and 1 are unknown.
//
// The class is the bit a unit type's terrain mask is tested against, and its
// seven values are the seven kinds of terrain the manual's data sheets list.
// The costs and the entrance bits are as the hl1914-18 project's notes
// describe the game using them; see src/game/movement.ts.

import type { Side } from './map.ts';
import { unpackIfPacked } from './tpwm.ts';

const RECORD_SIZE = 6;

/** A terrain class: the bit a unit's terrain mask is tested against, and what ground has it. */
export interface TerrainClass {
  bit: number;
  name: string;
}

/**
 * History Line's terrain classes, in the order the manual lists them. The
 * Battle Isle games use the same bits for other ground; see src/games.ts.
 */
export const TERRAIN_CLASSES = [
  { bit: 1, name: 'deep water' },
  { bit: 4, name: 'shallow water' },
  { bit: 16, name: 'open ground, roads' },
  { bit: 32, name: 'forest, houses' },
  { bit: 64, name: 'mountains, narrow bridges' },
  { bit: 8, name: 'trenches' },
  { bit: 2, name: 'rail' },
] as const;

export const ENTRANCE_FRENCH = 1;
export const ENTRANCE_NEUTRAL = 2;
export const ENTRANCE_GERMAN = 4;

export interface TerrainType {
  /** One of the TERRAIN_CLASSES bits, or 128 for fields nothing can enter. */
  terrainClass: number;
  /** What entering the field costs a ground unit or ship. */
  surfaceCost: number;
  /** What entering the field costs an aircraft. */
  airCost: number;
  /** For a building's entrance, whose building it is (ENTRANCE_*); otherwise 0. */
  entrance: number;
  /** For a building's entrance, the kind of building; otherwise null. */
  site: Site | null;
  /** For any field of a building, its entrance included, the kind of building; otherwise null. */
  sitePart: Site | null;
  /** Ground a depot can be built on. */
  buildable: boolean;
  /**
   * Ground an aircraft cannot end a move on. In the game's tables it is also
   * of the class nothing can enter, so no unit gets there in the first place.
   */
  noLanding: boolean;
  /** Index into the table of what the ground adds to attack and defence in a fight. */
  combatGround: number;
  raw: Uint8Array;
}

export type Site = 'headquarters' | 'factory' | 'depot';

/** Bits of a terrain record's first two bytes, read as a little-endian word, that mark an entrance. */
const SITE_BITS: [number, Site][] = [
  [0x0040, 'headquarters'],
  [0x0400, 'factory'],
  [0x0100, 'depot'],
];

/** The bits that mark every field of a building, not only its entrance. */
const SITE_PART_BITS: [number, Site][] = [
  [0x0020, 'headquarters'],
  [0x0200, 'factory'],
  [0x0080, 'depot'],
];

/**
 * Reads a terrain table. `combatGrounds`, for a game that numbers its kinds
 * of ground differently from History Line, gives History Line's number for
 * each of the game's own.
 */
export function decodeTerrainTypes(file: Uint8Array, combatGrounds?: readonly number[]): TerrainType[] {
  const data = unpackIfPacked(file);
  if (data.length % RECORD_SIZE !== 0) {
    throw new Error(`terrain table length ${data.length} is not a multiple of ${RECORD_SIZE}`);
  }
  const types: TerrainType[] = [];
  for (let at = 0; at < data.length; at += RECORD_SIZE) {
    const raw = data.subarray(at, at + RECORD_SIZE);
    const word = raw[0]! | (raw[1]! << 8);
    types.push({
      terrainClass: raw[2]!,
      surfaceCost: raw[3]!,
      airCost: raw[4]!,
      entrance: raw[0]! & 7,
      site: SITE_BITS.find(([bit]) => word & bit)?.[1] ?? null,
      sitePart: SITE_PART_BITS.find(([bit]) => word & bit)?.[1] ?? null,
      buildable: (word & 0x8000) !== 0,
      noLanding: (word & 0x4000) !== 0,
      combatGround: combatGrounds ? (combatGrounds[raw[5]!] ?? OPEN_COMBAT_GROUND) : raw[5]!,
      raw,
    });
  }
  return types;
}

/** The entry of the ground bonus table for open ground, which adds nothing. */
export const OPEN_COMBAT_GROUND = 8;

export function terrainClassName(terrainClass: number, classes: readonly TerrainClass[] = TERRAIN_CLASSES): string {
  return classes.find((entry) => entry.bit === terrainClass)?.name ?? 'closed';
}

/** The names of the terrain classes a terrain mask allows. */
export function terrainMaskNames(mask: number, classes: readonly TerrainClass[] = TERRAIN_CLASSES): string[] {
  return classes.filter((entry) => mask & entry.bit).map((entry) => entry.name);
}

/**
 * Whether a unit with this terrain mask can move onto this terrain. A mask of
 * 0 belongs to units that never move, such as bunkers.
 */
export function canEnter(terrainMask: number, terrain: TerrainType): boolean {
  return (terrainMask & terrain.terrainClass) !== 0;
}

/** History Line's terrain numbers from this one on are trenches. */
export const FIRST_TRENCH_GROUND = 0xa5;

/** History Line's terrain number of the open ground a filled-in trench becomes. */
export const FILLED_GROUND = 0x51;

/** Whose building an entrance belongs to: a side, or null for nobody's. */
export function entranceOwner(terrain: TerrainType): Side | null {
  if (terrain.entrance & ENTRANCE_NEUTRAL) return null;
  return terrain.entrance & ENTRANCE_FRENCH ? 1 : 0;
}

/**
 * The terrain number of the entrance of a building of this kind and owner, or
 * -1 if the table has none. A building that changes hands gets it, which is
 * what changes the colour of its gate on the map.
 */
export function entranceTerrain(types: readonly TerrainType[], site: Site, owner: Side | null): number {
  return types.findIndex((type) => type.site === site && type.entrance !== 0 && entranceOwner(type) === owner);
}

/** Whether a building entrance is closed to ordinary units of this side. */
export function entranceClosedTo(side: Side, terrain: TerrainType): boolean {
  const others = side === 0 ? ENTRANCE_FRENCH | ENTRANCE_NEUTRAL : ENTRANCE_GERMAN | ENTRANCE_NEUTRAL;
  return (terrain.entrance & others) !== 0;
}

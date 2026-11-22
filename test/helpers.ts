// Small hand-made maps, terrain and unit types for the rule tests.

import assert from 'node:assert/strict';
import { NO_UNIT, type GameMap, type Side } from '../src/formats/map.ts';
import {
  ENTRANCE_FRENCH,
  ENTRANCE_GERMAN,
  ENTRANCE_NEUTRAL,
  type Site,
  type TerrainType,
} from '../src/formats/terrain.ts';
import type { RuleType } from '../src/game/state.ts';

export const OPEN = 16;
export const FOREST = 32;
export const DEEP_WATER = 1;

function terrain(terrainClass: number, surfaceCost: number, entrance = 0, combatGround = 8): TerrainType {
  const site = entrance ? 'depot' : null;
  return {
    terrainClass,
    surfaceCost,
    airCost: 2,
    entrance,
    site,
    sitePart: site,
    buildable: false,
    noLanding: false,
    combatGround,
    raw: new Uint8Array(6),
  };
}

/** The entrance of a building of a kind, or with no entrance bits one of its other fields. */
function building(kind: Site, entrance: number): TerrainType {
  const body = entrance === 0;
  return {
    ...terrain(body ? 128 : OPEN, body ? 255 : 4),
    entrance,
    site: body ? null : kind,
    sitePart: kind,
    noLanding: body,
  };
}

// Terrain used by the test maps, written as one letter per field.
const TERRAIN: Record<string, TerrainType> = {
  r: terrain(OPEN, 4), // road
  p: { ...terrain(OPEN, 6), buildable: true }, // plain: a depot can be built on it
  f: terrain(FOREST, 7, 0, 1),
  w: terrain(DEEP_WATER, 6),
  x: terrain(128, 255), // building
  // Depot entrances: German, nobody's, French.
  G: terrain(OPEN, 4, ENTRANCE_GERMAN),
  N: terrain(OPEN, 4, ENTRANCE_NEUTRAL),
  F: terrain(OPEN, 4, ENTRANCE_FRENCH),
  // Headquarters entrances, German and French, and a field of a headquarters.
  H: building('headquarters', ENTRANCE_GERMAN),
  K: building('headquarters', ENTRANCE_FRENCH),
  h: building('headquarters', 0),
  // A factory's entrance (nobody's, German, French) and one of its other fields.
  Y: building('factory', ENTRANCE_NEUTRAL),
  Z: building('factory', ENTRANCE_GERMAN),
  Q: building('factory', ENTRANCE_FRENCH),
  y: building('factory', 0),
  s: terrain(2, 5), // rail
  // Marked as no place for aircraft to land, but, unlike in the game's own
  // table, of a class units can enter.
  l: { ...terrain(OPEN, 4), noLanding: true },
};
const LETTERS = Object.keys(TERRAIN);
export const terrainTypes = LETTERS.map((letter) => TERRAIN[letter]!);
// Ground prepared for a depot and a depot's other fields have fixed terrain
// numbers in the game (see PREPARED_GROUND and DEPOT_GROUND); the table is
// filled out so that those numbers mean the same here.
while (terrainTypes.length < 0x12) terrainTypes.push(terrain(128, 255));
for (let number = 0x12; number <= 0x14; number++) terrainTypes[number] = building('depot', 0);
for (let number = 0x15; number <= 0x18; number++) terrainTypes[number] = { ...terrain(128, 255), noLanding: true };
// The same for the open ground a filled-in trench becomes (0x51) and for the
// trenches (0xA5 on): slow to cross, and ground that can be worked on.
while (terrainTypes.length <= 0xad) terrainTypes.push(terrain(128, 255));
terrainTypes[0x51] = TERRAIN.p!;
export const TRENCH = 8;
for (let number = 0xa5; number <= 0xad; number++) {
  terrainTypes[number] = { ...terrain(TRENCH, 11, 0, 6), buildable: true };
}
export const terrainOf = (letter: string) => TERRAIN[letter]!;

const GROUND = 0x04;
const WATER = 0x08;
const AIR = 0x10;

/** Load classes as the game's unit table has them: what a truck, a train and a ship carry. */
export const BY_TRUCK = 0x040;
export const BY_TRAIN = 0x100;
export const BY_SHIP = 0x200;

/** A unit type; by default a ground unit with a short-range gun. */
export function mover(overrides: Partial<RuleType>): RuleType {
  return {
    movementBudget: 16,
    terrainMask: OPEN,
    isAircraft: false,
    isTransport: false,
    isShipHalf: false,
    isShipBack: false,
    entersAnyBuilding: false,
    flatMoveCost: false,
    groupSize: 6,
    armour: 30,
    weapons: { air: null, ground: { range: 1, power: 35 }, water: { range: 1, power: 35 } },
    attackMask: GROUND | WATER,
    classBits: GROUND,
    capacity: 0,
    weight: 3,
    loadClasses: BY_TRAIN | BY_SHIP,
    carries: 0,
    price: 60,
    buildsDepots: false,
    digsTrenches: false,
    slowToFire: false,
    ...overrides,
  };
}

const unarmed = { air: null, ground: null, water: null };

export const TANK = 0;
export const INFANTRY = 1;
export const PLANE = 2;
export const TRUCK = 3;
export const SHIP = 4;
/** The second half of the ship: as in the game's table, the kind after it. */
export const SHIP_BACK = 5;
export const BALLOON = 6;
export const BUNKER = 7;
export const ARTILLERY = 8;
export const AA_GUN = 9;
export const TRAIN = 10;
export const HEAVY_GUN = 11;
export const unitTypes: RuleType[] = [
  mover({}),
  mover({
    movementBudget: 12,
    terrainMask: OPEN | FOREST,
    entersAnyBuilding: true,
    armour: 20,
    weapons: { air: null, ground: { range: 1, power: 30 }, water: { range: 1, power: 30 } },
    weight: 1,
    loadClasses: BY_TRUCK | BY_TRAIN | BY_SHIP,
  }),
  mover({
    movementBudget: 14,
    terrainMask: 127,
    isAircraft: true,
    armour: 15,
    weapons: { air: { range: 1, power: 20 }, ground: { range: 1, power: 11 }, water: { range: 1, power: 13 } },
    attackMask: GROUND | WATER | AIR,
    classBits: AIR,
  }),
  mover({
    movementBudget: 18,
    isTransport: true,
    armour: 20,
    weapons: unarmed,
    attackMask: 0,
    capacity: 9,
    weight: 4,
    carries: BY_TRUCK,
  }),
  mover({ movementBudget: 30, terrainMask: DEEP_WATER, isShipHalf: true, classBits: WATER | 0xc0 }),
  mover({ movementBudget: 30, terrainMask: DEEP_WATER, isShipHalf: true, isShipBack: true, classBits: WATER | 0x40 }),
  mover({ movementBudget: 2, flatMoveCost: true, groupSize: 3, armour: 15, weapons: unarmed, attackMask: 0x80 }),
  mover({ movementBudget: 0, terrainMask: 0, groupSize: 3, armour: 85 }),
  // An indirect-fire gun: long range, but not at the fields next to it.
  mover({
    movementBudget: 6,
    armour: 27,
    weapons: { air: null, ground: { range: 5, power: 55 }, water: { range: 5, power: 55 } },
    attackMask: GROUND | WATER | 0x40,
  }),
  // Reaches aircraft; has power against ground units only to fire back.
  mover({
    movementBudget: 8,
    armour: 25,
    weapons: { air: { range: 2, power: 30 }, ground: { range: 0, power: 25 }, water: { range: 0, power: 25 } },
    attackMask: GROUND | WATER | AIR,
  }),
  // A train: it runs on rail only and carries nearly everything.
  mover({
    movementBudget: 28,
    terrainMask: 2,
    isTransport: true,
    armour: 30,
    weapons: unarmed,
    attackMask: 0,
    capacity: 15,
    weight: 0,
    loadClasses: 0,
    carries: BY_TRAIN,
  }),
  // A heavy gun: like the artillery above, but it cannot fire in the half after it moved.
  mover({
    movementBudget: 6,
    armour: 27,
    weapons: { air: null, ground: { range: 5, power: 55 }, water: { range: 5, power: 55 } },
    attackMask: GROUND | WATER | 0x40,
    slowToFire: true,
  }),
];

export type Placement = [column: number, row: number, type: number, side: Side];

/** Builds a map from rows of terrain letters and a list of units. */
export function makeMap(rows: string[], units: Placement[]): GameMap {
  const columns = rows[0]!.length;
  const map: GameMap = {
    columns,
    rows: rows.length,
    terrain: new Uint8Array(columns * rows.length),
    units: new Uint8Array(columns * rows.length).fill(NO_UNIT),
  };
  rows.forEach((line, row) => {
    [...line].forEach((letter, column) => {
      const number = LETTERS.indexOf(letter);
      assert.ok(number >= 0, `unknown terrain letter ${letter}`);
      map.terrain[row * columns + column] = number;
    });
  });
  for (const [column, row, type, side] of units) map.units[row * columns + column] = type * 2 + side;
  return map;
}

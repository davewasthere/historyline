// Battle Isle's maps as History Line maps: the same battlefield, laid with
// History Line's tiles and held by History Line's units.
//
// A Battle Isle map is turned into a sketch (see sketch.ts), which names no
// tiles, and the sketch is built like any other. So the ground comes out as
// History Line can draw it: its shores where Battle Isle's coast runs, its
// road pieces where Battle Isle's roads go, its buildings on the same
// fields. Where its tiles cannot follow (a coast that runs level, a fork it
// has no piece for) the builder says so and the map is made all the same.
//
// This is done for Battle Isle and The Desert, whose ground is an island's
// and whose 27 unit kinds are the same. The Moon of Chromos has another
// world and other units, and is not.
//
// What becomes what is this file's choice, by what each thing is for:
//
//   - Ground goes by its terrain class, with the tile's name telling apart
//     what one class holds (reefs, walls, ruins and craters are all of the
//     mountains' class). Medium-deep water is deep water. A river is shallow
//     water, since Battle Isle draws its rivers as water with banks.
//   - A road field gets a road to each neighbour its tile leads to. Which
//     sides a tile leads out by is not in the files; ROAD_SIDES was worked
//     out from the maps, where the field on such a side nearly always is a
//     road too (test/battleisle.test.ts checks it against the installed
//     game). Bridges are roads over water.
//   - Buildings keep their fields, owners, earnings and what is inside. The
//     two games lay a headquarters, a factory and a depot the same way. One
//     Battle Isle map has a headquarters cut off by the map's lower edge;
//     such a map gets as many rows more as the building needs, of the ground
//     its last row has.
//   - Each unit kind becomes the History Line kind that does its job, the
//     German one for the first side and the French one for the second.
//     Aldinium and mines have no counterpart and are left out. What a
//     transport plane or an aircraft carrier holds is left out too: History
//     Line has nothing that flies or sails with aircraft aboard. A hovercraft
//     is a transport ship on water and a supply car on land.

import { NO_UNIT, splitUnitCode, type GameMap, type Side } from '../formats/map.ts';
import type { MapShops } from '../formats/shops.ts';
import { entranceOwner, type TerrainType } from '../formats/terrain.ts';
import { fieldTowards } from '../game/movement.ts';
import type { GameId } from '../games.ts';
import { buildingPiece } from './pieces.ts';
import { LARGEST_MAP, type MapSketch, type Path, type SketchBuilding, type SketchUnit } from './sketch.ts';

/** The Battle Isle games whose maps can be rebuilt. */
export const REBUILT_GAMES = ['isle', 'desert'] as const satisfies readonly GameId[];
export type RebuiltGame = (typeof REBUILT_GAMES)[number];

/**
 * The sides each road tile leads out by, as bits: 1 the side above, then
 * clockwise 2, 4, 8, 16, 32. By the tiles' names in each game's PART.DAT.
 */
export const ROAD_SIDES: Record<RebuiltGame, Record<string, number>> = {
  isle: {
    BRIDGE00: 0b001001, BRIDGE01: 0b100100, BRIDGE02: 0b010010,
    STREET00: 0b001001, STREET01: 0b100100, STREET02: 0b010010,
    STREET03: 0b001101, STREET04: 0b011001, STREET05: 0b110110,
    STREET06: 0b101100, STREET07: 0b011010, STREET08: 0b101000,
    STREET09: 0b001010, STREET10: 0b010001, STREET11: 0b000101,
    STREET12: 0b100010, STREET13: 0b010100, STREET14: 0b100101,
    STREET15: 0b010011, STREET16: 0b101001, STREET17: 0b001011,
  },
  desert: {
    BRUECKE1: 0b001001, BRUECKE2: 0b100100, BRUECKE4: 0b001001,
    BRUECKE5: 0b100100, BRUECKE6: 0b010010,
    DOCKS1: 0b011001, DOCKS3: 0b011001, DOCKS4: 0b001111, STEG: 0b001000,
    STREET00: 0b001001, STREET01: 0b100100, STREET02: 0b010010,
    STREET03: 0b000101, STREET04: 0b010001, STREET05: 0b101000,
    STREET06: 0b001010, STREET07: 0b010100, STREET08: 0b100010,
    STREET09: 0b110100, STREET11: 0b110010, STREET12: 0b100110,
    STREET13: 0b101001, STREET14: 0b001011, STREET15: 0b011001,
    STREET17: 0b110110, ZSTRET18: 0b101010,
  },
};

// Battle Isle's terrain classes.
const DEEP_WATER = 1;
const WATER = 2;
const SHALLOW_WATER = 4;
const ROADS = 8;
const FOREST = 32;
const MOUNTAINS = 64;
const CLOSED = 128;

/** The road tiles that stand in water. */
const OVER_WATER = /^(BRIDGE|BRUECKE|DOCKS|STEG)/;

/** The sketch's letter for a field of ground that is neither road nor building. */
function groundLetter(terrain: TerrainType, name: string): string {
  switch (terrain.terrainClass) {
    case DEEP_WATER:
    case WATER:
      return '~';
    case SHALLOW_WATER:
      // A pond, or a crater full of water: water that is a field of its own.
      return /^(TEICH|KRATER)/.test(name) ? 'p' : '-';
    case FOREST:
      return 'f';
    case MOUNTAINS:
      if (/^(RIFF|WEBRECH)/.test(name)) return '*';
      if (/^WALL/.test(name)) return '#';
      if (/^RUINE/.test(name)) return 'h';
      if (/^KRATER/.test(name)) return 'o';
      // The Desert's mountains cannot be crossed; its dunes and Battle Isle's mountains can.
      return /^BERG\d$/.test(name) ? 'r' : '^';
    default:
      // Scrub and broken ground against plain.
      return /^(GEBUSCH|EBENE[34])/.test(name) ? ',' : '.';
  }
}

type Names = readonly [german: string | null, french: string | null];
const both = (name: string): Names => [name, name];

/**
 * What each of Battle Isle's unit kinds becomes, for the first side and the
 * second. Null for what has no counterpart, and for the second halves of
 * ships, which the first halves bring along.
 */
export const UNIT_KINDS: readonly Names[] = [
  both('STAT AA-EMPLACEM'), // AD-9 Sphinx, air defence missiles
  both('INFANTRY'), // R-1 Demon
  ['A7V TANK', 'MARK I.'], // T-4 Gladiator
  ['A7V TANK', 'MARK IV.'], // T-7 Crusader
  both('MOB AA-EMPLACEM.'), // AD-5 Blitz
  ['ARMOURED CAR', 'CHARRON'], // FAV Buster, reconnaissance
  both('SUPPLY CAR'), // SC-T Provider
  both('HEAVY ARTILLERY'), // HG-12 Angel
  both('CONSTR. UNIT'), // SC-P Merlin
  ['FOKKER D VII', 'SPAD XIII'], // XF-7 Mosquito, fighters
  ['GOTHA BOMBER', 'HANDLEY PAGE'], // XA-7 Raven, bombers
  ['JUNKERS J4-10', 'D.H.4'], // CAS Firebird, ground attack
  ['ZEPPELIN STAAKEN', 'HANDLEY PAGE'], // G-2 Giant, a transport aircraft
  both('TORPEDO BOAT'), // TB-X Marauder
  both('TRANSPORT SHIP'), // TLAV Invader, a hovercraft; see HOVERCRAFT
  both('TRANSPORT SHIP'), // CV Amazon
  [null, null],
  both('SUBMARINE'), // U-7C Barracuda
  [null, null],
  both('DESTROYER'), // Z-1 Pegasus, an aircraft carrier
  [null, null],
  both('BATTLESHIP'), // W-1 Fortress
  [null, null],
  both('PATROL BOAT'), // MB-A Buccaneer
  ['ARMOURED CAR', 'RENAULT FT 17'], // T-3 Scorpion
  [null, null], // Aldinium
  [null, null], // M-17 Brick, a mine
];

/** The hovercraft, and what it is on land. */
const HOVERCRAFT = 14;
const HOVERCRAFT_ON_LAND = 'SUPPLY CAR';
/** History Line's kinds that carry units; what any other kind held is left out. */
const CARRIERS = new Set(['SUPPLY CAR', 'TRANSPORT SHIP']);

function kindFor(type: number, side: Side): string | null {
  return UNIT_KINDS[type]?.[side] ?? null;
}

const SIDE_NAMES = ['german', 'french'] as const;
const SHOP_KINDS = { headquarters: 0, factory: 1, depot: 2 } as const;
const TRANSPORT_SHOP = 3;

export interface BattleIsleMap {
  game: RebuiltGame;
  /** What to call the map. */
  title: string;
  about?: string;
  map: GameMap;
  shops: MapShops;
  /** The Battle Isle game's terrain table and its tiles' names, by terrain number. */
  terrainTypes: readonly TerrainType[];
  tileNames: readonly string[];
  /** Which of Battle Isle's unit kinds carry units. */
  isTransport: readonly boolean[];
}

/** The sketch of a Battle Isle map: what buildMap makes a History Line map from. */
export function sketchFromBattleIsle(source: BattleIsleMap): MapSketch {
  const { map, shops, terrainTypes, tileNames } = source;
  const sides = ROAD_SIDES[source.game];
  const at = (column: number, row: number) => row * map.columns + column;
  const terrainAt = (column: number, row: number) => terrainTypes[map.terrain[at(column, row)]!];
  const nameAt = (column: number, row: number) => tileNames[map.terrain[at(column, row)]!] ?? '';
  const onMap = (column: number, row: number) => column >= 0 && column < map.columns && row >= 0 && row < map.rows;
  const isRoad = (column: number, row: number) => {
    const terrain = terrainAt(column, row);
    return terrain !== undefined && terrain.terrainClass === ROADS && !terrain.site;
  };
  /** A road, or an entrance a road can lead up to. */
  const takesRoad = (column: number, row: number) => isRoad(column, row) || terrainAt(column, row)?.site != null;
  const isWater = (column: number, row: number) =>
    !isRoad(column, row) && [DEEP_WATER, WATER, SHALLOW_WATER].includes(terrainAt(column, row)?.terrainClass ?? 0);

  const ground: string[] = [];
  const roads: Path[] = [];
  const buildings: SketchBuilding[] = [];
  const units: SketchUnit[] = [];
  /** The map's transports in the order its records number them, each with the sketch's unit if it still carries. */
  const transports: (SketchUnit | null)[] = [];
  const numbered = { factory: 0, depot: 0 };

  for (let row = 0; row < map.rows; row++) {
    let line = '';
    for (let column = 0; column < map.columns; column++) {
      const terrain = terrainAt(column, row);
      const name = nameAt(column, row);
      let letter = '.';
      if (terrain?.site) {
        // A building: the sketch puts it down whole from its entrance.
        const owner = entranceOwner(terrain);
        const index = terrain.site === 'headquarters' ? (owner ?? 0) : numbered[terrain.site]++;
        const record = shops.shops.find((shop) => shop.kind === SHOP_KINDS[terrain.site!] && shop.index === index);
        // What is inside a building that is nobody's belongs to the side its record names, or to neither.
        const side: Side = owner ?? (record?.owner === 1 ? 1 : 0);
        const holds = (record?.contents ?? []).flatMap((type) => kindFor(type, side) ?? []);
        buildings.push({
          kind: terrain.site,
          owner: owner === null ? 'neutral' : SIDE_NAMES[owner],
          at: [column, row],
          ...(record ? { income: record.resources } : {}),
          ...(record?.worth != null ? { worth: record.worth } : {}),
          ...(holds.length > 0 ? { holds } : {}),
        });
      } else if (!terrain || terrain.sitePart || terrain.terrainClass === CLOSED) {
        // The rest of a building, which its piece covers, and the map's edge.
        letter = '.';
      } else if (isRoad(column, row)) {
        let wet = 0;
        (sides[name] ?? 0)
          .toString(2)
          .split('')
          .reverse()
          .forEach((open, direction) => {
            const near = fieldTowards({ column, row }, direction);
            if (open === '1' && onMap(near.column, near.row) && takesRoad(near.column, near.row)) {
              roads.push([[column, row], [near.column, near.row]]);
            }
          });
        for (let direction = 0; direction < 6; direction++) {
          const near = fieldTowards({ column, row }, direction);
          if (onMap(near.column, near.row) && isWater(near.column, near.row)) wet++;
        }
        // A bridge stands in the water it crosses.
        letter = OVER_WATER.test(name) && wet >= 2 ? '-' : '.';
      } else {
        letter = groundLetter(terrain, name);
      }
      line += letter;

      const code = map.units[at(column, row)]!;
      if (code === NO_UNIT) continue;
      const { type, side } = splitUnitCode(code);
      let kind = kindFor(type, side);
      if (type === HOVERCRAFT && !isWater(column, row)) kind = HOVERCRAFT_ON_LAND;
      const unit: SketchUnit | null = kind ? { kind, side: SIDE_NAMES[side], at: [column, row] } : null;
      if (unit) units.push(unit);
      if (source.isTransport[type]) transports.push(unit && CARRIERS.has(unit.kind as string) ? unit : null);
    }
    ground.push(line);
  }

  // A building that reaches below the map gets the rows it needs, as far as a map may go.
  const lowest = buildings.flatMap((building) =>
    (buildingPiece(building.kind, building.owner) ?? []).map(
      ({ steps }) => steps.reduce(fieldTowards, { column: building.at[0], row: building.at[1] }).row,
    ),
  );
  const rowsNeeded = Math.min(LARGEST_MAP, Math.max(map.rows, ...lowest.map((row) => row + 1)));
  while (ground.length < rowsNeeded) ground.push(ground.at(-1)!);

  // What the map's transports carry.
  for (const shop of shops.shops) {
    if (shop.kind !== TRANSPORT_SHOP) continue;
    const unit = transports[shop.index];
    if (!unit) continue;
    const holds = shop.contents.flatMap((type) => kindFor(type, unit.side === 'german' ? 0 : 1) ?? []);
    if (holds.length > 0) unit.holds = holds;
  }

  // What the factories build: every History Line kind one of the map's kinds becomes.
  const buildable = new Set<string>();
  for (const type of shops.buildable) {
    for (const name of UNIT_KINDS[type] ?? []) if (name) buildable.add(name);
  }

  return {
    title: source.title,
    ...(source.about ? { about: source.about } : {}),
    season: 'summer',
    ground,
    roads,
    buildings,
    units,
    buildable: [...buildable],
  };
}

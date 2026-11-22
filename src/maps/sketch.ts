// Makes a map out of a sketch of one.
//
// A sketch says what a map is like without naming tiles: the kind of ground
// on each field, where the roads, tracks, railways and rivers run, where the
// buildings and the larger pieces of scenery stand, and which units start
// where. buildMap picks the tiles: for a road the piece that leaves the field
// by the right sides, for shallow water beside land the shore that fits, for
// plain ground one of its looks.
//
// What it makes is what the game's own map files decode to (a GameMap and
// its MapShops), so createGame and the viewer take it like any other map.
//
// Fields are given as [column, row], counted from 0 at the top left. Odd
// columns sit half a field lower than even ones.

import { NO_UNIT, type GameMap, type Side } from '../formats/map.ts';
import { UNIT_TYPE_COUNT, type MapShops, type Shop } from '../formats/shops.ts';
import { canEnter, type TerrainType } from '../formats/terrain.ts';
import type { UnitType } from '../formats/unitTypes.ts';
import { DIRECTIONS, directionTo, fieldTowards, type Field } from '../game/movement.ts';
import {
  buildingPiece,
  DEEP_WATER,
  GROUND,
  OPEN_SHALLOW_WATER,
  SCENERY,
  SHALLOW_TILES,
  SHALLOW_WATER,
  sidesAgree,
  TILE_SIDES,
  WATER_GROUND,
  type BuildingKind,
  type Link,
  type Owner,
  type Piece,
} from './pieces.ts';

export type Point = readonly [column: number, row: number];
/** Fields a line runs through. Fields that are not neighbours are joined by the straightest run between them. */
export type Path = readonly Point[];
/** A unit kind by the game's name for it, or by its number in the game's unit table. */
export type KindName = string | number;

export interface SketchBuilding {
  kind: BuildingKind;
  owner: Owner;
  /** The field of its entrance. */
  at: Point;
  /** Points it earns its owner each round. */
  income?: number;
  /** What it is worth to the computer's player as something to take. */
  worth?: number;
  /** Units inside it at the start. */
  holds?: readonly KindName[];
}

export interface SketchUnit {
  kind: KindName;
  side: 'german' | 'french';
  /** Where it stands; several fields put one such unit on each. */
  at: Point | readonly Point[];
  /** For a transport, the units it carries at the start. */
  holds?: readonly KindName[];
}

export interface MapSketch {
  title: string;
  /** What the battle is about, for whoever picks the map. */
  about?: string;
  season?: 'summer' | 'winter';
  /** Changes which look each field of plain ground gets. */
  seed?: number;
  /**
   * One string for each row and one letter for each field; see GROUND in
   * pieces.ts. In short: . grass , bare ground o craters f forest h houses
   * ^ hill r rocks # barbed wire, which only troops on foot cross t trench
   * p pond - shallow water ~ deep water * rocks in water.
   */
  ground: readonly string[];
  roads?: readonly Path[];
  tracks?: readonly Path[];
  rails?: readonly Path[];
  rivers?: readonly Path[];
  /** Larger pieces of scenery by name (see SCENERY in pieces.ts), each placed by its topmost field. */
  scenery?: readonly { piece: string; at: Point }[];
  /** Single tiles by terrain number, for what the sketch has no word for. */
  tiles?: readonly { tile: number; at: Point }[];
  buildings?: readonly SketchBuilding[];
  units?: readonly SketchUnit[];
  /** The kinds factories can build on this map; all of them if left out. */
  buildable?: readonly KindName[];
}

/** What buildMap needs to know of the game's unit kinds. */
export type SketchUnitType = Pick<UnitType, 'terrainMask' | 'isTransport' | 'isShipHalf' | 'isShipBack'> & {
  name?: string;
};

export interface SketchRules {
  unitTypes: readonly SketchUnitType[];
  /** The game's terrain table. With it, units are checked to stand on ground they can enter. */
  terrainTypes?: readonly TerrainType[];
}

export interface BuiltMap {
  map: GameMap;
  shops: MapShops;
  season: 'summer' | 'winter';
  /** What is wrong with the map, in words, each with its field. Empty for a sound map. */
  problems: string[];
}

/** The sizes the engine and the original maps keep to. */
export const SMALLEST_MAP = 4;
export const LARGEST_MAP = 63;

/** What the originals' buildings typically earn, and are worth to the computer. */
const INCOME: Record<BuildingKind, number> = { headquarters: 10, factory: 15, depot: 10 };
const WORTH: Record<BuildingKind, number> = { headquarters: 45, factory: 35, depot: 35 };
const SHOP_KIND: Record<BuildingKind, number> = { headquarters: 0, factory: 1, depot: 2 };
const TRANSPORT_SHOP = 3;
const OWNER_NUMBER: Record<Owner, number> = { german: 0, french: 1, neutral: 2 };
const PLACES = 7;

const DIRECTION_NAMES = ['above', 'upper right', 'lower right', 'below', 'lower left', 'upper left'];
const LINE_NAMES: Record<Link, string> = { R: 'road', T: 'track', L: 'railway', V: 'river' };

/** The tiles a line through a field can become, by their sides. */
const LINE_TILES = new Map<string, number>();
for (const [first, last] of [[0x24, 0x2e], [0x55, 0x68], [0x6c, 0x6c], [0x6e, 0x6e], [0x72, 0x72], [0x74, 0x76], [0x79, 0x7a], [0x7f, 0xa4]] as const) {
  for (let tile = first; tile <= last; tile++) LINE_TILES.set(TILE_SIDES[tile]!, tile);
}

const opposite = (direction: number) => (direction + 3) % DIRECTIONS;

/** The fields from one to another, both included, as straight as a hex map allows. */
export function lineBetween(from: Point, to: Point): Point[] {
  // In cube coordinates a straight line is a plain interpolation.
  const cube = ([column, row]: Point) => {
    const z = row - (column - (column & 1)) / 2;
    return { x: column, y: -column - z, z };
  };
  const a = cube(from);
  const b = cube(to);
  const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
  const fields: Point[] = [];
  for (let step = 0; step <= steps; step++) {
    const t = steps === 0 ? 0 : step / steps;
    // The small offsets keep a point that falls between two fields from being rounded either way.
    const x = a.x + (b.x - a.x) * t + 1e-6;
    const y = a.y + (b.y - a.y) * t + 2e-6;
    const z = a.z + (b.z - a.z) * t - 3e-6;
    let rx = Math.round(x);
    const ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy <= dz) rz = -rx - ry;
    fields.push([rx, rz + (rx - (rx & 1)) / 2]);
  }
  return fields;
}

/** A number from 0 up to but not including 1 that depends only on the seed and the field. */
function chance(seed: number, at: number): number {
  let value = (seed ^ Math.imul(at + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

export function buildMap(sketch: MapSketch, rules: SketchRules): BuiltMap {
  const rows = sketch.ground.length;
  const columns = sketch.ground[0]?.length ?? 0;
  if (rows < SMALLEST_MAP || columns < SMALLEST_MAP || rows > LARGEST_MAP || columns > LARGEST_MAP) {
    throw new Error(`a map is ${SMALLEST_MAP} to ${LARGEST_MAP} fields each way; this one is ${columns} by ${rows}`);
  }
  sketch.ground.forEach((line, row) => {
    if (line.length !== columns) throw new Error(`row ${row} has ${line.length} fields, the first row has ${columns}`);
    for (const letter of line) if (!GROUND[letter]) throw new Error(`row ${row} has the letter "${letter}", which is no kind of ground`);
  });

  const problems: string[] = [];
  const count = columns * rows;
  const index = (field: Field) => field.row * columns + field.column;
  const fieldOf = (at: number): Field => ({ column: at % columns, row: Math.floor(at / columns) });
  const onMap = (field: Field) => field.column >= 0 && field.column < columns && field.row >= 0 && field.row < rows;
  const where = (field: Field) => `${field.column}, ${field.row}`;
  const toField = ([column, row]: Point): Field => ({ column, row });
  const letterAt = (at: number) => sketch.ground[Math.floor(at / columns)]![at % columns]!;
  const isWater = (at: number) => WATER_GROUND.includes(letterAt(at));

  // --- pieces that are put down whole ------------------------------------------

  const terrain = new Int16Array(count).fill(-1);
  /** Fields whose tile is settled: nothing later changes it or runs a line through it. */
  const settled = new Uint8Array(count);
  const place = (what: string, piece: Piece, anchor: Point): boolean => {
    const fields = piece.map(({ steps }) => steps.reduce(fieldTowards, toField(anchor)));
    const off = fields.find((field) => !onMap(field));
    if (off) {
      problems.push(`the ${what} at ${where(toField(anchor))} reaches off the map`);
      return false;
    }
    const taken = fields.find((field) => settled[index(field)]);
    if (taken) {
      problems.push(`the ${what} at ${where(toField(anchor))} lies over something else at ${where(taken)}`);
      return false;
    }
    fields.forEach((field, part) => {
      terrain[index(field)] = piece[part]!.tile;
      settled[index(field)] = 1;
    });
    return true;
  };

  /** The entrances of the buildings that were placed, with what the sketch says of each. */
  const entrances = new Map<number, SketchBuilding>();
  for (const building of sketch.buildings ?? []) {
    const piece = buildingPiece(building.kind, building.owner);
    if (!piece) {
      problems.push(`there is no ${building.owner} ${building.kind}, asked for at ${where(toField(building.at))}`);
      continue;
    }
    if (place(building.kind, piece, building.at)) entrances.set(index(toField(building.at)), building);
  }
  for (const { piece: name, at } of sketch.scenery ?? []) {
    const piece = SCENERY[name];
    if (piece) place(name, piece, at);
    else problems.push(`there is no piece of scenery called "${name}", asked for at ${where(toField(at))}`);
  }
  for (const { tile, at } of sketch.tiles ?? []) {
    if (TILE_SIDES[tile] === undefined) problems.push(`there is no tile ${tile}, asked for at ${where(toField(at))}`);
    else place('tile', [{ steps: [], tile }], at);
  }

  // --- lines ---------------------------------------------------------------

  /** For each field and each of its sides, the line that crosses that side. */
  const links: (Link | null)[] = new Array<Link | null>(count * DIRECTIONS).fill(null);
  const linksOf = (at: number) => links.slice(at * DIRECTIONS, (at + 1) * DIRECTIONS);
  const link = (field: Field, direction: number, kind: Link): void => {
    if (!onMap(field)) return;
    const at = index(field);
    if (settled[at]) return;
    if (isWater(at)) {
      // A river runs out into open water; nothing shows of it there.
      if (kind === 'V') return;
      if (kind === 'L') {
        problems.push(`the railway at ${where(field)} runs into water, and there is no railway bridge over open water`);
        return;
      }
    }
    const there = links[at * DIRECTIONS + direction];
    const roads = (one: Link) => one === 'R' || one === 'T';
    if (there && there !== kind && !(roads(there) && roads(kind))) {
      problems.push(`a ${LINE_NAMES[there]} and a ${LINE_NAMES[kind]} leave ${where(field)} by the same side`);
      return;
    }
    // Where a paved road and a track share a side, it is paved.
    links[at * DIRECTIONS + direction] = there === 'R' ? 'R' : kind;
  };
  const lay = (paths: readonly Path[] | undefined, kind: Link): void => {
    for (const path of paths ?? []) {
      const fields: Point[] = [];
      path.forEach((point, number) => {
        if (number === 0) fields.push(point);
        else fields.push(...lineBetween(path[number - 1]!, point).slice(1));
      });
      for (let number = 1; number < fields.length; number++) {
        const from = toField(fields[number - 1]!);
        const to = toField(fields[number]!);
        const direction = directionTo(from, to);
        if (direction < 0) continue;
        link(from, direction, kind);
        link(to, opposite(direction), kind);
      }
    }
  };
  lay(sketch.rivers, 'V');
  lay(sketch.rails, 'L');
  lay(sketch.tracks, 'T');
  lay(sketch.roads, 'R');

  for (let at = 0; at < count; at++) {
    const own = linksOf(at);
    // There are no pieces that are half road and half track: a field with both is paved.
    if (own.includes('R') || (isWater(at) && own.includes('T'))) {
      own.forEach((kind, direction) => {
        if (kind === 'T') links[at * DIRECTIONS + direction] = 'R';
      });
    }
    // Nor are there pieces a line stops on: where one ends, it runs to the far side of its last field.
    const used = own.flatMap((kind, direction) => (kind ? [direction] : []));
    if (used.length === 1) {
      links[at * DIRECTIONS + opposite(used[0]!)] = links[at * DIRECTIONS + used[0]!]!;
    }
  }

  // --- tiles ---------------------------------------------------------------

  const seed = sketch.seed ?? 1;
  const look = (letter: string, at: number): number => {
    const looks = GROUND[letter]!;
    return looks[Math.floor(chance(seed, at) * looks.length)]!;
  };
  const describe = (own: readonly (Link | null)[]) =>
    own
      .flatMap((kind, direction) => (kind ? [`a ${LINE_NAMES[kind]} ${DIRECTION_NAMES[direction]}`] : []))
      .join(', ');

  /** Fields of shallow water whose tile depends on what lies around them. */
  const shores: number[] = [];
  for (let at = 0; at < count; at++) {
    if (settled[at]) continue;
    const letter = letterAt(at);
    const own = linksOf(at);
    const linked = own.some(Boolean);
    if (letter === '-') {
      shores.push(at);
      continue;
    }
    if (!linked) {
      terrain[at] = look(letter, at);
      continue;
    }
    const filler = isWater(at) ? 'w' : 'g';
    const tile = LINE_TILES.get(own.map((kind) => kind ?? filler).join(''));
    if (tile === undefined) {
      problems.push(`no tile has ${describe(own)} and nothing else, wanted at ${where(fieldOf(at))}`);
      terrain[at] = look(letter, at);
    } else {
      terrain[at] = tile;
    }
  }

  // Shallow water: each field takes the shore that agrees best with the land,
  // the deep water and the shores around it. Fields are gone over in turn
  // until none changes, since each depends on its neighbours' choice.
  const choices = new Map<number, number[]>();
  for (const at of shores) {
    const own = linksOf(at);
    const fitting = SHALLOW_TILES.filter((tile) =>
      [...TILE_SIDES[tile]!].every((side, direction) => (side === 'R') === (own[direction] !== null)),
    );
    if (fitting.length === 0) {
      problems.push(`no tile has ${describe(own)} over shallow water, wanted at ${where(fieldOf(at))}`);
      fitting.push(SHALLOW_WATER);
    }
    choices.set(at, fitting);
    terrain[at] = fitting[0]!;
  }
  const open = new Set(shores);
  const misfit = (at: number, tile: number): number => {
    const sides = TILE_SIDES[tile]!;
    let total = 0;
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const side = sides[direction]!;
      const near = fieldTowards(fieldOf(at), direction);
      if (side === 'R' || !onMap(near)) continue;
      const facing = TILE_SIDES[terrain[index(near)]!]![opposite(direction)]!;
      if (facing === '?') continue;
      const wanted = facing === 'w' || facing === 'V' ? 'w' : 'g';
      // Land and deep water are as they are; another shore may yet change.
      if (side !== wanted) total += open.has(index(near)) ? 1 : 2;
    }
    return total;
  };
  for (let pass = 0, changed = true; changed && pass < 50; pass++) {
    changed = false;
    for (const at of shores) {
      let best = terrain[at]!;
      let least = misfit(at, best);
      for (const tile of choices.get(at)!) {
        const cost = misfit(at, tile);
        if (cost < least) [best, least] = [tile, cost];
      }
      if (best !== terrain[at]) {
        terrain[at] = best;
        changed = true;
      }
    }
  }
  for (const at of shores) {
    if (terrain[at] !== SHALLOW_WATER) continue;
    const besideDeep = Array.from({ length: DIRECTIONS }, (_, direction) => fieldTowards(fieldOf(at), direction)).some(
      (near) => onMap(near) && terrain[index(near)] === DEEP_WATER,
    );
    if (besideDeep) terrain[at] = OPEN_SHALLOW_WATER;
  }

  // Every pair of neighbours, once: do their facing sides go together?
  for (let at = 0; at < count; at++) {
    for (let direction = 0; direction < 3; direction++) {
      const near = fieldTowards(fieldOf(at), direction);
      if (!onMap(near)) continue;
      const side = TILE_SIDES[terrain[at]!]![direction]!;
      const facing = TILE_SIDES[terrain[index(near)]!]![opposite(direction)]!;
      if (sidesAgree(side, facing)) continue;
      const names: Record<string, string> = { g: 'land', w: 'water', R: 'a road', T: 'a track', L: 'a railway', V: 'a river' };
      problems.push(`${where(fieldOf(at))} and ${where(near)} do not join: ${names[side]} against ${names[facing]}`);
    }
  }

  // --- units and what is inside things -----------------------------------------

  const kindNumber = (kind: KindName, what: string): number | null => {
    const number =
      typeof kind === 'number'
        ? kind
        : rules.unitTypes.findIndex((type) => type.name?.toLowerCase() === kind.trim().toLowerCase());
    if (rules.unitTypes[number] && !rules.unitTypes[number]!.isShipBack) return number;
    problems.push(`there is no unit kind "${kind}", named for ${what}`);
    return null;
  };
  const kindNumbers = (kinds: readonly KindName[] | undefined, what: string): number[] => {
    const numbers = (kinds ?? []).flatMap((kind) => kindNumber(kind, what) ?? []);
    if (numbers.length > PLACES) problems.push(`${what} holds ${numbers.length} units; there is room for ${PLACES}`);
    return numbers.slice(0, PLACES);
  };

  const units = new Uint8Array(count).fill(NO_UNIT);
  /** For each field a transport stands on, what the sketch has it carry. */
  const cargoes = new Map<number, { side: Side; holds: number[] }>();
  for (const unit of sketch.units ?? []) {
    const side: Side = unit.side === 'german' ? 0 : 1;
    const places = (typeof unit.at[0] === 'number' ? [unit.at] : unit.at) as readonly Point[];
    for (const point of places) {
      const field = toField(point);
      const what = `the ${unit.side} ${unit.kind} at ${where(field)}`;
      const type = kindNumber(unit.kind, what);
      if (type === null) continue;
      if (!onMap(field)) {
        problems.push(`${what} is off the map`);
        continue;
      }
      const kind = rules.unitTypes[type]!;
      // A ship fills a second field: a German one the field above, a French one the field below.
      const fields = kind.isShipHalf ? [field, { column: field.column, row: field.row + (side === 0 ? -1 : 1) }] : [field];
      if (fields.some((part) => !onMap(part))) {
        problems.push(`${what} has no room for its second half`);
        continue;
      }
      if (fields.some((part) => units[index(part)] !== NO_UNIT)) {
        problems.push(`${what} stands where another unit already is`);
        continue;
      }
      const ground = fields.map((part) => rules.terrainTypes?.[terrain[index(part)]!]);
      // A kind that enters no terrain at all never moves, and stands wherever it is put.
      if (kind.terrainMask !== 0 && ground.some((type) => type && !canEnter(kind.terrainMask, type))) {
        problems.push(`${what} stands on ground it cannot enter`);
        continue;
      }
      if (kind.terrainMask === 0 && ground.some((type) => type?.terrainClass === 128 || type?.site)) {
        problems.push(`${what} stands on a building or on ground nothing can enter`);
        continue;
      }
      units[index(field)] = type * 2 + side;
      // The second half is marked as taken here; the game puts it there itself.
      if (fields[1]) units[index(fields[1])] = (type + 1) * 2 + side;
      if (unit.holds?.length) {
        if (kind.isTransport) cargoes.set(index(field), { side, holds: kindNumbers(unit.holds, what) });
        else problems.push(`${what} carries nothing: it is no transport`);
      }
    }
  }

  // The records name a building by its number among those of its kind, and a
  // transport by its number among the transports, as the map is read row by row.
  const shops: Shop[] = [];
  const seen: Record<BuildingKind, number> = { headquarters: 0, factory: 0, depot: 0 };
  let transports = 0;
  const headquarters: Record<Owner, number> = { german: 0, french: 0, neutral: 0 };
  for (let at = 0; at < count; at++) {
    const building = entrances.get(at);
    if (building) {
      if (building.kind === 'headquarters') headquarters[building.owner]++;
      shops.push({
        owner: OWNER_NUMBER[building.owner],
        kind: SHOP_KIND[building.kind],
        index: building.kind === 'headquarters' ? OWNER_NUMBER[building.owner] : seen[building.kind],
        resources: building.income ?? INCOME[building.kind],
        worth: building.worth ?? WORTH[building.kind],
        contents: kindNumbers(building.holds, `the ${building.kind} at ${where(fieldOf(at))}`),
      });
      seen[building.kind]++;
    }
    const code = units[at]!;
    const kind = code === NO_UNIT ? undefined : rules.unitTypes[code >> 1];
    if (!kind?.isTransport) continue;
    const cargo = cargoes.get(at);
    if (cargo) {
      shops.push({ owner: cargo.side, kind: TRANSPORT_SHOP, index: transports, resources: 0, worth: 0, contents: cargo.holds });
    }
    transports++;
  }
  // The game's map files hold only the first half of a ship; so does this one.
  for (let at = 0; at < count; at++) {
    if (units[at] !== NO_UNIT && rules.unitTypes[units[at]! >> 1]?.isShipBack) units[at] = NO_UNIT;
  }
  for (const side of ['german', 'french'] as const) {
    if (headquarters[side] !== 1) {
      problems.push(`the ${side} side has ${headquarters[side]} headquarters; a battle needs each side to have one`);
    }
  }

  const everyKind = Array.from({ length: Math.min(UNIT_TYPE_COUNT, rules.unitTypes.length) }, (_, type) => type);
  const named = (sketch.buildable ?? []).flatMap((kind) => kindNumber(kind, 'the kinds that can be built') ?? []);
  const buildable = sketch.buildable ? [...new Set(named)].sort((a, b) => a - b) : everyKind;

  return {
    map: { columns, rows, terrain: Uint8Array.from(terrain), units },
    shops: { buildable, shops },
    season: sketch.season ?? 'summer',
    problems,
  };
}

// A game in progress: the units on a map, in its buildings and aboard its
// transports, whose half of the round it is, and what the players can do.
//
// A round has two halves. In the first the German side moves while the French
// side orders attacks; in the second they swap. Moves happen at once. Attack
// orders are carried out when the half ends, in the order they were given,
// against whatever then stands on the field aimed at. A unit moves once and
// attacks once per round. The heavier guns (medium, heavy and train
// artillery) cannot attack in the half after one in which they moved, which
// is the half their side attacks in: they move or fire in a round, not both.
//
// That split follows the original, where the two players act at the same time
// on a split screen. Which side moves first there has not been checked, and
// here both sides' actions are visible to whoever is at the screen.
//
// Buildings and transports, as the hl1914-18 project's notes and port describe
// the original (not checked against the running game from this project):
//
//   - A map's buildings are its headquarters, factories and depots. Each has
//     one entrance field, an owner (a side or nobody) and seven places for
//     units. A transport has seven places too.
//   - A move that ends on the entrance of the unit's own side's building puts
//     the unit inside, if a place is free.
//   - A move that ends on a friendly transport loads the unit, if the
//     transport carries units of its kind, has not moved yet in this half,
//     has a free place, and the weights of all it would then carry do not
//     exceed its capacity. A transport that enters a transport or a building
//     hands over what it carries and needs places for those units too.
//   - A unit inside can leave in its side's moving half, unless it went in
//     during the same half. It starts from the entrance or the transport's
//     field with a small budget (see movement.ts) and cannot go straight into
//     a building that is not its side's.
//   - Only some units (infantry, cavalry and the like) can move onto the
//     entrance of a building that is not their side's. A unit that does and
//     is still there when the half ends, after the attacks, takes the
//     building: every unit inside goes over to its side, the building becomes
//     its side's and the unit goes in. If all seven places were taken, the
//     unit in the first is lost. Taking the headquarters wins the battle.
//   - When a transport loses vehicles in a fight, each unit it carries loses
//     as many, and what a destroyed transport carries is lost with it.
//   - A side with no units left, on the map or inside, has lost.
//   - An aircraft cannot end a move on a field of a building other than its
//     entrance, nor on ground prepared for a depot. The terrain table marks
//     those fields, and also closes them to every unit, so in the game's own
//     maps the question never comes up.
//
// Points, building and repairing, from the same source:
//
//   - Both sides start a battle with no points. When a half ends, the side
//     that moved in it is paid: the "resources" of its headquarters and of
//     every factory and depot it owns, those it took in that half included.
//     It is the side that attacks in the next half, which is when it can
//     spend them.
//   - In its attacking half a side can build a unit on a free place of a
//     factory it owns: a kind the map allows, of its own army (the first ten
//     kinds are German only, those after the 36th French only), for the
//     kind's price. The game holds 241 units and 70 transports at most.
//   - In its attacking half a side can have a unit of its own that is inside
//     a building brought back to full strength for 15 points, 50 for a
//     construction unit.
//
// Ships that fill two fields (submarines, destroyers, battleships), from the
// same source:
//
//   - Such a ship is one unit. A map names both halves; the second lies a row
//     above a German ship's first and a row below a French one's.
//   - When it moves, its second half follows onto the field the first has
//     just left, and both face the way of the last step.
//   - It attacks from its first half's field: that is where its range and the
//     distance to its target are counted from.
//   - It can be attacked on either field. The ground of the field aimed at
//     counts for its defence, and it fires back if that field is next to the
//     attacker. Units around a fight only add to it if the two units' first
//     fields are next to each other.
//
// Depots built by construction units, from the same source:
//
//   - A construction unit carries enough for two pieces of work. In the half
//     its side attacks it can be ordered to work on one of ten fields near
//     it: the three below it and seven two fields away above and beside it.
//   - On a field whose four fields (it, and the three below it) are open
//     ground with no unit on them, the work is preparing the ground. On a
//     field already prepared, by anyone, it is building the depot, unless
//     the map has ten depots already.
//   - The work is done when the half ends, after the attacks and the
//     buildings taken, if the ground is still as it has to be. A new depot
//     is its builder's side's, earns nothing and is empty.
//   - A repair in a building gives a construction unit its two pieces of
//     work back, also when it has lost nothing.
//
// Trenches dug by sappers, from the same source:
//
//   - Sappers do not start attacks; their weapons only fire back. In the half
//     their side attacks they can be ordered to work on a field next to them
//     whose ground is open or a trench.
//   - When the half ends, three fields in a row across the line from the
//     sappers to that field are worked on, the field itself in the middle:
//     each of them that is open ground or trench becomes trench. If the field
//     aimed at is a trench already, the three become open ground instead.
//     Units standing there stay where they are.
//
// All of this is History Line's. Battle Isle's battles are played by the same
// rules with the numbers in rules.ts; it has no sappers and no trenches.

import { NO_UNIT, splitUnitCode, type GameMap, type Side } from '../formats/map.ts';
import type { MapShops } from '../formats/shops.ts';
import {
  entranceOwner,
  entranceTerrain,
  FILLED_GROUND,
  FIRST_TRENCH_GROUND,
  type Site,
  type TerrainType,
} from '../formats/terrain.ts';
import type { UnitType } from '../formats/unitTypes.ts';
import {
  canAttack,
  CLASS_AIR,
  CLASS_GROUND,
  CLASS_WATER,
  distance,
  MAX_EXPERIENCE,
  resolveFight,
  supportFor,
  type CombatType,
} from './combat.ts';
import {
  directionTo,
  fieldTowards,
  moveRange,
  neighbours,
  pathTo,
  type Field,
  type MoveRange,
  type MoverType,
} from './movement.ts';
import { HISTORYLINE_RULES, type Rules } from './rules.ts';

/**
 * The way each side's units face when a map starts: German units down the
 * map, French units up (from the notes of the hl1914-18 project).
 */
export const START_FACING: Record<Side, number> = { 0: 3, 1: 0 };

/** How many units a building or a transport holds at most. */
export const PLACES = 7;

/** What a repair costs: any unit, and the construction unit. */
export const REPAIR_COST = 15;
export const REPAIR_COST_BUILDER = 50;
/** No side is shown or left with more points than this. */
export const MAX_POINTS = 10000;
/** How many units, and how many transports among them, a battle holds at most. */
export const MAX_UNITS = 241;
export const MAX_TRANSPORTS = 70;
/** How many pieces of work a construction unit can do before it has to be restocked by a repair. */
export const BUILDER_SUPPLIES = 2;
/** How many depots a map holds at most, those it starts with included. */
export const MAX_DEPOTS = 10;
/**
 * Where a construction unit can work: column and row steps from its field
 * to the ten fields a depot's entrance can be on, for a unit in an even and
 * in an odd column. From HL.EXE, 40 signed bytes at file offset 0x39211
 * (there as ten column steps, then ten row steps, for each).
 */
export const DEPOT_PLACE_STEPS: Record<'even' | 'odd', readonly (readonly [column: number, row: number])[]> = {
  even: [[0, -2], [1, -2], [2, -1], [2, 0], [1, 0], [0, 1], [-1, 0], [-2, 0], [-2, -1], [-1, -2]],
  odd: [[0, -2], [1, -1], [2, -1], [2, 0], [1, 1], [0, 1], [-1, 1], [-2, 0], [-2, -1], [-1, -1]],
};
/**
 * The trench sappers dig towards each of the six fields around them, for
 * sappers in an even and in an odd column: three fields as column and row
 * steps from the sappers, each with the terrain number it gets. The middle
 * one is the field aimed at. From HL.EXE, two tables of 108 bytes at file
 * offsets 0x39249 (the steps) and 0x392B5 (the terrain numbers), which are
 * indexed by the aim's column and row steps and not by direction.
 */
export const TRENCH_STEPS: Record<
  'even' | 'odd',
  readonly (readonly (readonly [column: number, row: number, ground: number])[])[]
> = {
  even: [
    [[-1, -1, 0xaa], [0, -1, 0xa7], [1, -1, 0xab]],
    [[0, -1, 0xab], [1, -1, 0xa7], [2, 0, 0xab]],
    [[2, 0, 0xaa], [1, 0, 0xa7], [0, 1, 0xaa]],
    [[1, 0, 0xaa], [0, 1, 0xa7], [-1, 0, 0xab]],
    [[0, 1, 0xab], [-1, 0, 0xa7], [-2, 0, 0xab]],
    [[-2, 0, 0xaa], [-1, -1, 0xa7], [0, -1, 0xaa]],
  ],
  odd: [
    [[-1, 0, 0xaa], [0, -1, 0xa7], [1, 0, 0xab]],
    [[0, -1, 0xab], [1, 0, 0xa7], [2, 0, 0xab]],
    [[2, 0, 0xaa], [1, 1, 0xa7], [0, 1, 0xaa]],
    [[1, 1, 0xaa], [0, 1, 0xa7], [-1, 1, 0xab]],
    [[0, 1, 0xab], [-1, 1, 0xa7], [-2, 0, 0xab]],
    [[-2, 0, 0xaa], [-1, 0, 0xa7], [0, -1, 0xaa]],
  ],
};
/** What a headquarters earns when the map's records say nothing about it. */
const HEADQUARTERS_RESOURCES = 50;
/**
 * What a building of each kind is worth to the computer's player when the
 * map's records say nothing about it, and what any building is worth once it
 * has been taken.
 */
export const BUILDING_WORTH: Record<Site, number> = { headquarters: 20, factory: 15, depot: 10 };
export const TAKEN_BUILDING_WORTH = 5;

/** The parts of a unit type the rules depend on. */
export type RuleType = MoverType &
  CombatType &
  Pick<
    UnitType,
    | 'groupSize'
    | 'capacity'
    | 'weight'
    | 'loadClasses'
    | 'carries'
    | 'price'
    | 'buildsDepots'
    | 'digsTrenches'
    | 'slowToFire'
    | 'isShipBack'
  >;

export interface Unit {
  /** Index into the unit type table. */
  type: number;
  /** Null for a unit of neither side, which only exists inside a building until that is taken. */
  side: Side | null;
  /**
   * Where the unit stands, or where the transport or building it is in
   * stands. For a ship that fills two fields, where its first half is.
   */
  column: number;
  row: number;
  /** The field of the second half of a ship that fills two fields; null for every other unit. */
  tail: Field | null;
  /** For a construction unit, how many pieces of work it can still do; 0 for every other unit. */
  supplies: number;
  /** Direction the unit faces: 0 is up the map, the rest follow clockwise. */
  facing: number;
  /** Vehicles, guns or men left; the unit is destroyed at 0. */
  count: number;
  /** 0 to MAX_EXPERIENCE; rises with every fight in which the unit does damage. */
  experience: number;
  /** True once the unit has moved in the current round. */
  moved: boolean;
  /** True for a gun that is slow to fire, in the half after one in which it moved: it cannot attack. */
  settling: boolean;
  /** True once the unit has been destroyed and taken out of the game. */
  destroyed: boolean;
  /** The transport or building the unit is in; null while it stands on the map. */
  inside: Holder | null;
  /** The units a transport carries. */
  cargo: Unit[];
}

export interface Building {
  kind: Site;
  /** Null for a building that is nobody's yet. */
  owner: Side | null;
  /** The field units go in and out by. */
  entrance: Field;
  /** All the fields the building covers, the entrance first. */
  fields: Field[];
  /** The units inside, PLACES at most. */
  units: Unit[];
  /** What the building earns its owner each round: the "resources" of its record in the map's .SHP file. */
  resources: number;
  /** How much the computer's player wants to take it; see computer.ts. */
  worth: number;
}

/** What a unit can be inside. */
export type Holder = Building | Unit;

export interface AttackOrder {
  attacker: Unit;
  /** The field aimed at. */
  target: Field;
  /**
   * The unit that stood on that field when the order was given. The attack
   * is on that unit, as it stood there: if it moves away before the half
   * ends, the attack came first and still strikes it.
   */
  victim: Unit;
}

/**
 * What a unit does to a field in place of an attack. A construction unit
 * prepares its ground for a depot, or builds the depot on ground prepared;
 * sappers dig a trench across it, or fill in the trench that is there.
 */
export type Work = 'prepare' | 'build' | 'dig' | 'fill';

export interface WorkOrder {
  unit: Unit;
  /** The field a depot's entrance is to be on, or the middle field of a trench. */
  target: Field;
  work: Work;
}

export interface GameState {
  /** The map, with its unit layer kept in step with the units that stand on it. */
  map: GameMap;
  /** Every unit, wherever it is. */
  units: Unit[];
  /** For every field, the index in `units` of the unit standing there, or -1. */
  unitIndex: Int16Array;
  buildings: Building[];
  /** For every field, the index in `buildings` of the building covering it, or -1. */
  buildingIndex: Int16Array;
  /** Counts from 1. */
  round: number;
  /** The side that moves in this half of the round; the other side attacks. */
  mover: Side;
  /** The attacks ordered in this half, in the order they will be carried out. */
  orders: AttackOrder[];
  /** The work on depots and trenches ordered in this half. */
  works: WorkOrder[];
  /** The side that has won, once one has. */
  winner: Side | null;
  /** How it won: by taking the headquarters or by leaving the other side no units. */
  wonBy: 'headquarters' | 'units' | null;
  /** What each side has to spend on building and repairing units. */
  points: [number, number];
  /** The unit kinds this map lets factories build. */
  buildable: readonly number[];
  unitTypes: readonly RuleType[];
  /** The terrain table of the season the map is played in. */
  terrainTypes: readonly TerrainType[];
  /** The numbers that differ between the games; see rules.ts. */
  rules: Rules;
}

export function isBuilding(holder: Holder): holder is Building {
  return 'entrance' in holder;
}

/** The units inside a building or aboard a transport. */
export function contentsOf(holder: Holder): Unit[] {
  return isBuilding(holder) ? holder.units : holder.cargo;
}

/** The field units enter and leave a building or transport by. */
export function fieldOf(holder: Holder): Field {
  return isBuilding(holder) ? holder.entrance : { column: holder.column, row: holder.row };
}

/** The fields a building covers besides its entrance, as the original lays buildings out. */
function buildingFields(map: GameMap, terrainTypes: readonly TerrainType[], kind: Site, entrance: Field): Field[] {
  const onMap = (f: Field) => f.column >= 0 && f.column < map.columns && f.row >= 0 && f.row < map.rows;
  if (kind === 'factory') {
    // The two fields to the left of the entrance and the one beyond them.
    const others = [fieldTowards(entrance, 5), fieldTowards(entrance, 4), { column: entrance.column - 2, row: entrance.row }];
    return [entrance, ...others.filter(onMap)];
  }
  if (kind === 'depot') {
    // The three fields below the entrance.
    return [entrance, ...[4, 3, 2].map((direction) => fieldTowards(entrance, direction)).filter(onMap)];
  }
  // A headquarters: the fields marked as part of one that join up with the entrance.
  const fields = [entrance];
  for (let next = 0; next < fields.length; next++) {
    for (const near of neighbours(fields[next]!, map)) {
      const terrain = terrainTypes[map.terrain[near.row * map.columns + near.column]!];
      if (terrain?.sitePart !== kind || terrain.site) continue;
      if (!fields.some((f) => f.column === near.column && f.row === near.row)) fields.push(near);
    }
  }
  return fields;
}

/**
 * Starts a game on a copy of `map`; the map passed in is left untouched.
 * `records` is the map's .SHP file: what its buildings and transports hold
 * and which unit kinds can be built. Without it nothing is inside anything
 * and every kind can be built. `rules` are History Line's unless given.
 */
export function createGame(
  map: GameMap,
  unitTypes: readonly RuleType[],
  terrainTypes: readonly TerrainType[],
  records: Partial<MapShops> = {},
  rules: Rules = HISTORYLINE_RULES,
): GameState {
  const shops = records.shops ?? [];
  const game: GameMap = { ...map, terrain: map.terrain.slice(), units: map.units.slice() };
  const fieldCount = map.units.length;
  const units: Unit[] = [];
  const unitIndex = new Int16Array(fieldCount).fill(-1);
  const buildings: Building[] = [];
  const buildingIndex = new Int16Array(fieldCount).fill(-1);
  // Transports in the order the original numbers them: as the map is read,
  // then as the .SHP records make them.
  const transports: Unit[] = [];
  const newUnit = (type: number, side: Side | null, field: Field): Unit => {
    const unit: Unit = {
      type,
      side,
      column: field.column,
      row: field.row,
      tail: null,
      supplies: unitTypes[type]?.buildsDepots ? BUILDER_SUPPLIES : 0,
      facing: START_FACING[side ?? 0],
      count: unitTypes[type]?.groupSize || 1,
      experience: 0,
      moved: false,
      settling: false,
      destroyed: false,
      inside: null,
      cargo: [],
    };
    units.push(unit);
    if (unitTypes[type]?.isTransport) transports.push(unit);
    return unit;
  };

  for (let at = 0; at < fieldCount; at++) {
    const field = { column: at % map.columns, row: Math.floor(at / map.columns) };
    const terrain = terrainTypes[map.terrain[at]!];
    if (terrain?.site) {
      buildings.push({
        kind: terrain.site,
        owner: entranceOwner(terrain),
        entrance: field,
        fields: buildingFields(map, terrainTypes, terrain.site, field),
        units: [],
        resources: terrain.site === 'headquarters' ? HEADQUARTERS_RESOURCES : 0,
        worth: BUILDING_WORTH[terrain.site],
      });
    }
    const code = map.units[at]!;
    if (code === NO_UNIT) continue;
    const { type, side } = splitUnitCode(code);
    // The second half of a ship is no unit of its own: its first half brings it along.
    if (unitTypes[type]?.isShipBack) continue;
    unitIndex[at] = units.length;
    const unit = newUnit(type, side, field);
    if (!unitTypes[type]?.isShipHalf) continue;
    // A German ship's second half lies a row above its first, a French one's a row below.
    const tail = { column: field.column, row: field.row + (side === 0 ? -1 : 1) };
    if (tail.row < 0 || tail.row >= map.rows) continue;
    unit.tail = tail;
    const tailAt = tail.row * map.columns + tail.column;
    unitIndex[tailAt] = unitIndex[at]!;
    game.units[tailAt] = (type + 1) * 2 + side;
  }
  // A second half the map names without a first half beside it is nothing.
  game.units.forEach((code, at) => {
    if (code !== NO_UNIT && unitIndex[at] === -1) game.units[at] = NO_UNIT;
  });
  buildings.forEach((building, number) => {
    for (const field of building.fields) {
      const at = field.row * map.columns + field.column;
      if (buildingIndex[at] === -1) buildingIndex[at] = number;
    }
  });

  // A record names its building by its number among those of its kind as the
  // map is read; a headquarters by its side.
  const ofKind = (kind: Site) => buildings.filter((building) => building.kind === kind);
  for (const shop of shops) {
    const holder: Holder | undefined =
      shop.kind === 0
        ? ofKind('headquarters').find((building) => building.owner === shop.index)
        : shop.kind === 1
          ? ofKind('factory')[shop.index]
          : shop.kind === 2
            ? ofKind('depot')[shop.index]
            : transports[shop.index];
    if (!holder) continue;
    if (isBuilding(holder)) {
      holder.resources = shop.resources;
      holder.worth = shop.worth ?? holder.worth;
    }
    const side = shop.owner === 0 || shop.owner === 1 ? shop.owner : null;
    for (const type of shop.contents) {
      const inside = contentsOf(holder);
      if (inside.length >= PLACES || !unitTypes[type]) continue;
      const unit = newUnit(type, side, fieldOf(holder));
      unit.inside = holder;
      inside.push(unit);
    }
  }

  return {
    map: game,
    units,
    unitIndex,
    buildings,
    buildingIndex,
    round: 1,
    mover: 0,
    orders: [],
    works: [],
    winner: null,
    wonBy: null,
    points: [0, 0],
    buildable: records.buildable ?? unitTypes.map((_, type) => type),
    unitTypes,
    terrainTypes,
    rules,
  };
}

function fieldIndex(state: GameState, field: Field): number {
  return field.row * state.map.columns + field.column;
}

function onMap(state: GameState, field: Field): boolean {
  return field.column >= 0 && field.column < state.map.columns && field.row >= 0 && field.row < state.map.rows;
}

const sameField = (a: Field, b: Field) => a.column === b.column && a.row === b.row;

/**
 * The unit standing on a field: for a ship that fills two fields, on either
 * of them. Units inside a transport or building stand on none.
 */
export function unitAt(state: GameState, field: Field): Unit | null {
  if (!onMap(state, field)) return null;
  return state.units[state.unitIndex[fieldIndex(state, field)] ?? -1] ?? null;
}

/** The building that covers a field, if one does. */
export function buildingAt(state: GameState, field: Field): Building | null {
  if (!onMap(state, field)) return null;
  return state.buildings[state.buildingIndex[fieldIndex(state, field)] ?? -1] ?? null;
}

/** The building whose entrance a field is, if it is one. */
function entranceAt(state: GameState, field: Field): Building | null {
  const building = buildingAt(state, field);
  return building && sameField(building.entrance, field) ? building : null;
}

/** The side that orders attacks in this half of the round. */
export function attackerSide(state: GameState): Side {
  return state.mover === 0 ? 1 : 0;
}

/** Puts a unit, and whatever it carries, at a field. */
function place(unit: Unit, field: Field): void {
  unit.column = field.column;
  unit.row = field.row;
  for (const carried of unit.cargo) place(carried, field);
}

/** Takes a unit off the field it stands on, or out of what it is inside. */
function lift(state: GameState, unit: Unit): void {
  if (unit.inside) {
    const inside = contentsOf(unit.inside);
    inside.splice(inside.indexOf(unit), 1);
    unit.inside = null;
    return;
  }
  for (const field of fieldsOf(unit)) {
    const at = fieldIndex(state, field);
    if (state.units[state.unitIndex[at]!] !== unit) continue;
    state.unitIndex[at] = -1;
    state.map.units[at] = NO_UNIT;
  }
}

/** The fields a unit on the map covers: one, or two for a ship that fills two. */
export function fieldsOf(unit: Unit): Field[] {
  const head = { column: unit.column, row: unit.row };
  return unit.tail ? [head, unit.tail] : [head];
}

/** Stands a unit of a side on a field, and its second half, if it has one, on another. */
function stand(state: GameState, unit: Unit, side: Side, head: Field, tail: Field | null): void {
  const number = state.units.indexOf(unit);
  place(unit, head);
  unit.tail = tail;
  state.unitIndex[fieldIndex(state, head)] = number;
  state.map.units[fieldIndex(state, head)] = unit.type * 2 + side;
  if (!tail) return;
  state.unitIndex[fieldIndex(state, tail)] = number;
  // The next kind in the table is the picture of the ship's rear.
  state.map.units[fieldIndex(state, tail)] = (unit.type + 1) * 2 + side;
}

/** Puts a unit into a transport or building, with what it carries beside it. */
function putInside(unit: Unit, holder: Holder): void {
  const inside = contentsOf(holder);
  for (const one of [unit, ...unit.cargo]) {
    one.inside = holder;
    inside.push(one);
  }
  unit.cargo = [];
  place(unit, fieldOf(holder));
  for (const one of inside) place(one, fieldOf(holder));
}

// --- moving ------------------------------------------------------------------

/** Why a unit cannot be moved at all right now, or null if it can. */
export function cannotMoveReason(state: GameState, unit: Unit): string | null {
  if (state.winner !== null) return 'The battle is over.';
  if (unit.side === null) return 'This unit belongs to neither side until its building is taken.';
  if (unit.side !== state.mover) return 'This side attacks in this half of the round; it moves in the other.';
  if (unit.moved) return 'This unit has already moved this round.';
  const type = state.unitTypes[unit.type];
  if (!type || type.movementBudget === 0) return 'This unit does not move.';
  if (unit.inside) {
    if (!isBuilding(unit.inside) && unit.inside.inside) {
      return 'Its transport is inside something itself; move the transport out first.';
    }
    const blocker = unitAt(state, fieldOf(unit.inside));
    if (isBuilding(unit.inside) && blocker) return 'A unit stands in the entrance.';
  }
  return null;
}

/** Where a unit could move: with a full budget from where it stands, or out of what it is inside. */
export function rangeOf(state: GameState, unit: Unit): MoveRange | null {
  if (!unit.inside) return moveRange(state.map, unit, state.unitTypes, state.terrainTypes);
  const type = state.unitTypes[unit.type];
  if (!type || unit.side === null) return null;
  return moveRange(state.map, fieldOf(unit.inside), state.unitTypes, state.terrainTypes, {
    mover: { type: unit.type, side: unit.side },
    budget: type.flatMoveCost ? state.rules.leavingBudgetFlat : state.rules.leavingBudget,
    ownEntrancesOnly: true,
  });
}

/** Whether a transport or building has places for a unit and for what the unit carries. */
function hasPlaces(holder: Holder, unit: Unit): boolean {
  return PLACES - contentsOf(holder).length >= 1 + unit.cargo.length;
}

/** Why a unit cannot be loaded onto the unit standing on a field in its range, or null if it can. */
function cannotBoardReason(state: GameState, unit: Unit, carrier: Unit): string | null {
  const type = state.unitTypes[unit.type];
  const carrierType = state.unitTypes[carrier.type];
  if (!type || !carrierType || carrier.side !== unit.side) return 'That field is occupied.';
  if (!carrierType.isTransport) return 'That field is occupied.';
  if (!(type.loadClasses & carrierType.carries)) return 'That transport does not carry units of this kind.';
  if (carrier.moved) return 'That transport has already moved this round; units board before it moves.';
  const weight = (one: Unit) => state.unitTypes[one.type]?.weight ?? 0;
  const load = [unit, ...unit.cargo, ...carrier.cargo].reduce((sum, one) => sum + weight(one), 0);
  if (!hasPlaces(carrier, unit) || load > carrierType.capacity) return 'That transport has no room for this unit.';
  return null;
}

/** Why a unit's move cannot end on a field in its range, or null if it can. */
export function cannotStopReason(state: GameState, unit: Unit, range: MoveRange, target: Field): string | null {
  const at = fieldIndex(state, target);
  if (fieldsOf(unit).some((field) => sameField(field, target))) return 'The unit is already there.';
  if ((range.remaining[at] ?? -1) < 0) return 'That field is out of reach.';
  // The original asks this of every move. With the game's own tables it never
  // comes to it: such ground is of the class no unit can enter.
  if (state.unitTypes[unit.type]?.isAircraft && state.terrainTypes[state.map.terrain[at]!]?.noLanding) {
    return 'Aircraft cannot land on a building.';
  }
  const other = unitAt(state, target);
  if (other) return cannotBoardReason(state, unit, other);
  const building = entranceAt(state, target);
  // A building that is not the unit's side's is taken when the half ends; its own it goes into.
  if (building && building.owner === unit.side && !hasPlaces(building, unit)) return 'That building is full.';
  return null;
}

/** What a move ended in: on a field, aboard a transport, inside a building, or on an entrance to take it. */
export type Arrival = 'field' | 'loaded' | 'entered' | 'taking';

export type MoveResult = { ok: true; path: Field[]; arrival: Arrival } | { ok: false; reason: string };

/** Moves a unit to a field, if the rules allow it. */
export function moveUnit(state: GameState, unit: Unit, target: Field): MoveResult {
  const range = rangeOf(state, unit);
  const reason = cannotMoveReason(state, unit) ?? (range ? cannotStopReason(state, unit, range, target) : 'No such unit.');
  if (reason || !range || unit.side === null) return { ok: false, reason: reason ?? 'No such unit.' };

  const path = pathTo(range, state.map, target);
  // The unit ends up facing the way it took its last step.
  const lastFrom = path.length > 1 ? path[path.length - 2]! : { column: unit.column, row: unit.row };
  const facing = directionTo(lastFrom, target);
  if (facing >= 0) unit.facing = facing;
  unit.moved = true;

  const carrier = unitAt(state, target);
  const building = entranceAt(state, target);
  lift(state, unit);
  if (carrier) {
    putInside(unit, carrier);
    return { ok: true, path, arrival: 'loaded' };
  }
  if (building && building.owner === unit.side) {
    putInside(unit, building);
    return { ok: true, path, arrival: 'entered' };
  }
  // A ship's second half follows onto the field the first has just left.
  stand(state, unit, unit.side, target, unit.tail ? lastFrom : null);
  return { ok: true, path, arrival: building ? 'taking' : 'field' };
}

// --- attacking ---------------------------------------------------------------

/** Why a unit cannot order an attack at all right now, or null if it can. */
export function cannotAttackReason(state: GameState, unit: Unit): string | null {
  if (state.winner !== null) return 'The battle is over.';
  if (unit.side !== attackerSide(state)) return 'This side moves in this half of the round; it attacks in the other.';
  if (unit.inside) return 'A unit inside a transport or building cannot attack.';
  const type = state.unitTypes[unit.type];
  if (!type) return 'No such unit.';
  if (unit.settling) return 'This gun moved in the last half and cannot fire in this one.';
  if (type.digsTrenches) return 'Sappers dig trenches; they do not start attacks, they only fire back.';
  if (!type.weapons.air?.range && !type.weapons.ground?.range && !type.weapons.water?.range) {
    return 'This unit has no weapon it can attack with.';
  }
  return null;
}

/**
 * Whether `unit` could attack the unit `other` on `field`, one of the fields
 * `other` covers, from where it stands.
 */
function canTarget(state: GameState, unit: Unit, other: Unit, field: Field): boolean {
  const type = state.unitTypes[unit.type];
  const otherType = state.unitTypes[other.type];
  if (!type || !otherType || other.side === unit.side || other.destroyed) return false;
  // Units inside a transport or building are out of every fight.
  if (unit.inside || other.inside) return false;
  return canAttack(type, otherType.classBits, distance(unit, field));
}

/**
 * The fields a unit's weapons reach from where it stands, whatever is on
 * them: every field on which it could start an attack on a unit in the air,
 * on the ground or on water. A gun that fires from afar does not reach the
 * fields beside it. Empty for a unit that starts no attacks, and for one
 * inside a transport or building.
 */
export function fieldsInRange(state: GameState, unit: Unit): Field[] {
  const type = state.unitTypes[unit.type];
  if (!type || unit.inside || unit.destroyed || type.digsTrenches) return [];
  const kinds = [CLASS_AIR, CLASS_GROUND, CLASS_WATER];
  const farthest = Math.max(0, ...[type.weapons.air, type.weapons.ground, type.weapons.water].map((weapon) => weapon?.range ?? 0));
  const fields: Field[] = [];
  for (let row = Math.max(0, unit.row - farthest); row <= Math.min(state.map.rows - 1, unit.row + farthest); row++) {
    for (let column = Math.max(0, unit.column - farthest); column <= Math.min(state.map.columns - 1, unit.column + farthest); column++) {
      const field = { column, row };
      const away = distance(unit, field);
      if (kinds.some((kind) => canAttack(type, kind, away))) fields.push(field);
    }
  }
  return fields;
}

/**
 * The fields holding enemy units that a unit could attack from where it
 * stands. A ship that fills two fields can be in range on one and not the
 * other.
 */
export function attackTargets(state: GameState, unit: Unit): Field[] {
  return state.units.flatMap((other) =>
    other.inside || other.destroyed ? [] : fieldsOf(other).filter((field) => canTarget(state, unit, other, field)),
  );
}

/** The field a unit has been ordered to attack in this half, or null. */
export function orderOf(state: GameState, unit: Unit): Field | null {
  return state.orders.find((order) => order.attacker === unit)?.target ?? null;
}

export type OrderResult = { ok: true } | { ok: false; reason: string };

/** Orders a unit to attack a field when the half ends, replacing any earlier order it had. */
export function orderAttack(state: GameState, unit: Unit, target: Field): OrderResult {
  const reason = cannotAttackReason(state, unit);
  if (reason) return { ok: false, reason };
  const victim = unitAt(state, target);
  if (!victim || victim.side === unit.side) return { ok: false, reason: 'There is no enemy unit on that field.' };
  if (!canTarget(state, unit, victim, target)) {
    return { ok: false, reason: 'This unit cannot attack that unit from here.' };
  }
  cancelAttack(state, unit);
  state.orders.push({ attacker: unit, target: { column: target.column, row: target.row }, victim });
  return { ok: true };
}

export function cancelAttack(state: GameState, unit: Unit): void {
  state.orders = state.orders.filter((order) => order.attacker !== unit);
}

export interface FightReport {
  attacker: Unit;
  targetField: Field;
  /** The unit that was hit; null if nothing attackable stood on the field any more. */
  target: Unit | null;
  attackerLosses: number;
  targetLosses: number;
  /** What each unit had left right after this fight; 0 means it was destroyed. */
  attackerLeft: number;
  targetLeft: number;
  /** Each unit's experience right after this fight, and how much of it this fight gave. */
  attackerExperience: number;
  targetExperience: number;
  attackerGained: number;
  targetGained: number;
  /** Per cent added to the attack by the attacker's side around the target. */
  flank: number;
  /** Per cent added to the target's armour by its side beside both fighters. */
  support: number;
  /** Units aboard either fighter that were destroyed with it or by its losses. */
  cargoDestroyed: Unit[];
}

/** Takes a destroyed unit out of the game, with whatever it carries. */
function removeUnit(state: GameState, unit: Unit): void {
  if (unit.destroyed) return;
  lift(state, unit);
  unit.destroyed = true;
  unit.count = 0;
  for (const carried of [...unit.cargo]) removeUnit(state, carried);
}

function gainExperience(unit: Unit, points: number): void {
  unit.experience = Math.min(MAX_EXPERIENCE, unit.experience + points);
}

export interface Foreseen {
  /** The unit that would be hit. */
  target: Unit;
  attackerLosses: number;
  targetLosses: number;
  flank: number;
  support: number;
}

/**
 * What an attack by a unit on a field would cost both sides as things stand
 * now, or null if the unit could not attack what is on the field. Nothing is
 * changed.
 *
 * With `victim`, the unit an order was given on, the attack is on that unit
 * as it stood on the field, wherever it has gone since, into a transport or
 * building too: the attack came before its move. Null then only if either
 * unit has been destroyed in the meantime.
 */
export function foreseeFight(state: GameState, attacker: Unit, targetField: Field, victim?: Unit): Foreseen | null {
  const target = victim ?? unitAt(state, targetField);
  if (attacker.destroyed || !target || target.destroyed) return null;
  // Whether the victim of an order still stands where it was aimed at.
  const stayed = !target.inside && fieldsOf(target).some((field) => sameField(field, targetField));
  if (victim && !stayed) {
    const type = state.unitTypes[attacker.type];
    const victimType = state.unitTypes[victim.type];
    if (!type || !victimType || attacker.inside || victim.side === attacker.side) return null;
    if (!canAttack(type, victimType.classBits, distance(attacker, targetField))) return null;
  } else if (!canTarget(state, attacker, target, targetField)) {
    return null;
  }
  if (attacker.side === null || target.side === null) return null;

  const attackerType = state.unitTypes[attacker.type]!;
  const targetType = state.unitTypes[target.type]!;
  const terrainOn = (field: Field) => state.terrainTypes[state.map.terrain[fieldIndex(state, field)]!] ?? { combatGround: 8 };
  const { flank, support } = supportFor(
    { field: attacker, side: attacker.side, classBits: attackerType.classBits },
    // A unit that has moved away is fought where it was aimed at.
    { field: stayed ? target : targetField, side: target.side, classBits: targetType.classBits },
    (field) => {
      const unit = unitAt(state, field);
      const type = unit ? state.unitTypes[unit.type] : undefined;
      return unit && type && unit.side !== null ? { side: unit.side, type } : null;
    },
  );
  const result = resolveFight({
    attacker: { type: attackerType, count: attacker.count, experience: attacker.experience, terrain: terrainOn(attacker) },
    // The target stands, for this fight, on the field aimed at.
    target: { type: targetType, count: target.count, experience: target.experience, terrain: terrainOn(targetField) },
    distance: distance(attacker, targetField),
    flank,
    support,
  });
  return { target, attackerLosses: result.attackerLosses, targetLosses: result.targetLosses, flank, support };
}

/** Carries out one attack order. */
function fight(state: GameState, order: AttackOrder): FightReport {
  const { attacker, target: targetField } = order;
  const report: FightReport = {
    attacker,
    targetField,
    target: null,
    attackerLosses: 0,
    targetLosses: 0,
    attackerLeft: attacker.count,
    targetLeft: 0,
    attackerExperience: attacker.experience,
    targetExperience: 0,
    attackerGained: 0,
    targetGained: 0,
    flank: 0,
    support: 0,
    cargoDestroyed: [],
  };
  // The unit aimed at may have moved away since: the attack came first, and
  // strikes it as it stood there. Only one destroyed by an earlier attack of
  // this half is missed.
  const result = foreseeFight(state, attacker, targetField, order.victim);
  if (!result) return report;
  const { target, flank, support } = result;

  attacker.count -= result.attackerLosses;
  target.count -= result.targetLosses;
  // What a transport carries shares its losses and its end.
  const cargoDestroyed: Unit[] = [];
  for (const [carrier, losses] of [[attacker, result.attackerLosses], [target, result.targetLosses]] as const) {
    for (const carried of [...carrier.cargo]) {
      if (carrier.count <= 0 || carried.count <= losses) {
        removeUnit(state, carried);
        cargoDestroyed.push(carried);
      } else {
        carried.count -= losses;
      }
    }
  }
  // One point for doing damage, one more for destroying the other unit.
  let attackerGain = result.targetLosses > 0 ? 1 : 0;
  let targetGain = result.attackerLosses > 0 ? 1 : 0;
  if (target.count <= 0) {
    removeUnit(state, target);
    attackerGain++;
  }
  if (attacker.count <= 0) {
    removeUnit(state, attacker);
    targetGain++;
  }
  // What a unit gains may be less than its points: experience has an end.
  const had = [attacker.experience, target.experience] as const;
  gainExperience(attacker, attackerGain);
  gainExperience(target, targetGain);
  return {
    ...report,
    target,
    attackerLosses: result.attackerLosses,
    targetLosses: result.targetLosses,
    attackerLeft: attacker.count,
    targetLeft: target.count,
    attackerExperience: attacker.experience,
    targetExperience: target.experience,
    attackerGained: attacker.experience - had[0],
    targetGained: target.experience - had[1],
    flank,
    support,
    cargoDestroyed,
  };
}

// --- taking buildings --------------------------------------------------------

export interface CaptureReport {
  /** The unit that took the building and is now inside it. */
  unit: Unit;
  building: Building;
  previousOwner: Side | null;
  /** The units inside that went over to the taker's side. */
  captured: Unit[];
  /** The unit lost because all places were taken, if one was. */
  displaced: Unit | null;
}

/** Gives a unit, and what it carries, to a side. */
function handOver(unit: Unit, side: Side): void {
  unit.side = side;
  for (const carried of unit.cargo) handOver(carried, side);
}

/** A unit of the moving side that stands on the entrance of a building not its side's takes it. */
function takeBuilding(state: GameState, building: Building): CaptureReport | null {
  const unit = unitAt(state, building.entrance);
  if (!unit || unit.side === null || unit.side !== state.mover || unit.side === building.owner) return null;
  const side = unit.side;
  const previousOwner = building.owner;

  let displaced: Unit | null = null;
  if (building.units.length >= PLACES) {
    displaced = building.units[0]!;
    removeUnit(state, displaced);
  }
  const captured = building.units.filter((inside) => inside.side !== side);
  for (const inside of building.units) handOver(inside, side);

  building.owner = side;
  building.worth = TAKEN_BUILDING_WORTH;
  const terrain = entranceTerrain(state.terrainTypes, building.kind, side);
  if (terrain >= 0) state.map.terrain[fieldIndex(state, building.entrance)] = terrain;

  // The taker goes inside, keeping what it carries aboard.
  lift(state, unit);
  unit.inside = building;
  if (displaced) building.units.unshift(unit);
  else building.units.push(unit);

  if (building.kind === 'headquarters' && state.winner === null) {
    state.winner = side;
    state.wonBy = 'headquarters';
  }
  return { unit, building, previousOwner, captured, displaced };
}

// --- points, building and repairing ------------------------------------------

/** What a side's buildings earn it each round. */
export function incomeOf(state: GameState, side: Side): number {
  return state.buildings
    .filter((building) => building.owner === side)
    .reduce((sum, building) => sum + building.resources, 0);
}

/** Whether a side's factories may build a unit kind on this map at all, whatever it costs. */
function mayBuild(state: GameState, side: Side, type: number): boolean {
  if (!state.unitTypes[type] || !state.buildable.includes(type)) return false;
  const shared = state.rules.sharedKinds;
  // Kinds before the shared ones are the first side's only, kinds after them the second's.
  return !shared || (side === 0 ? type <= shared.last : type >= shared.first);
}

/** The unit kinds a building's owner could build there on this map, with their prices, cheapest first. */
export function buildChoices(state: GameState, building: Building): { type: number; price: number }[] {
  const { owner } = building;
  if (building.kind !== 'factory' || owner === null) return [];
  return state.unitTypes
    .map((unitType, type) => ({ type, price: unitType.price }))
    .filter(({ type }) => mayBuild(state, owner, type))
    .sort((a, b) => a.price - b.price || a.type - b.type);
}

/** Why a unit of a kind cannot be built in a building right now, or null if it can. */
export function cannotBuildReason(state: GameState, building: Building, type: number): string | null {
  if (state.winner !== null) return 'The battle is over.';
  if (building.kind !== 'factory') return 'Only factories build units.';
  const side = attackerSide(state);
  if (building.owner !== side) {
    return 'A side builds in its own factories, in the half in which it attacks.';
  }
  const unitType = state.unitTypes[type];
  if (!unitType || !mayBuild(state, side, type)) return 'That kind of unit cannot be built here.';
  if (building.units.length >= PLACES) return 'The factory has no free place.';
  if (unitType.price > state.points[side]) {
    return `That costs ${unitType.price} points; the side has ${state.points[side]}.`;
  }
  const inUse = state.units.filter((unit) => !unit.destroyed);
  if (inUse.length >= MAX_UNITS) return 'The battle holds no more units.';
  const transports = inUse.filter((unit) => state.unitTypes[unit.type]?.isTransport).length;
  if (unitType.isTransport && transports >= MAX_TRANSPORTS) return 'The battle holds no more transports.';
  return null;
}

export type BuildResult = { ok: true; unit: Unit } | { ok: false; reason: string };

/** Builds a unit of a kind in a factory for its owner, who pays the kind's price. */
export function buildUnit(state: GameState, building: Building, type: number): BuildResult {
  const reason = cannotBuildReason(state, building, type);
  const side = building.owner;
  if (reason || side === null) return { ok: false, reason: reason ?? 'This factory is nobody\'s.' };
  const unitType = state.unitTypes[type]!;
  const unit: Unit = {
    type,
    side,
    column: building.entrance.column,
    row: building.entrance.row,
    facing: START_FACING[side],
    count: unitType.groupSize || 1,
    tail: null,
    supplies: unitType.buildsDepots ? BUILDER_SUPPLIES : 0,
    experience: 0,
    moved: false,
    settling: false,
    destroyed: false,
    inside: building,
    cargo: [],
  };
  state.units.push(unit);
  building.units.push(unit);
  state.points[side] -= unitType.price;
  return { ok: true, unit };
}

/** What bringing a unit back to full strength costs. */
export function repairCost(state: GameState, unit: Unit): number {
  return state.unitTypes[unit.type]?.buildsDepots ? REPAIR_COST_BUILDER : REPAIR_COST;
}

/** Why a unit cannot be repaired right now, or null if it can. */
export function cannotRepairReason(state: GameState, unit: Unit): string | null {
  if (state.winner !== null) return 'The battle is over.';
  const type = state.unitTypes[unit.type];
  if (!type || unit.destroyed) return 'No such unit.';
  if (!unit.inside || !isBuilding(unit.inside)) return 'Units are repaired inside a building.';
  if (unit.side === null) return 'This unit belongs to neither side.';
  if (unit.side !== attackerSide(state)) return 'A side repairs in the half in which it attacks.';
  // A construction unit that has done work is restocked by a repair even at full strength.
  const restock = type.buildsDepots && unit.supplies < BUILDER_SUPPLIES;
  if (unit.count >= type.groupSize && !restock) return 'This unit is at full strength.';
  const cost = repairCost(state, unit);
  if (cost > state.points[unit.side]) return `That costs ${cost} points; the side has ${state.points[unit.side]}.`;
  return null;
}

export type RepairResult = { ok: true; cost: number } | { ok: false; reason: string };

/** Brings a unit inside a building back to full strength; its side pays. */
export function repairUnit(state: GameState, unit: Unit): RepairResult {
  const reason = cannotRepairReason(state, unit);
  if (reason || unit.side === null) return { ok: false, reason: reason ?? 'This unit belongs to neither side.' };
  const cost = repairCost(state, unit);
  state.points[unit.side] -= cost;
  const type = state.unitTypes[unit.type]!;
  unit.count = type.groupSize;
  if (type.buildsDepots) unit.supplies = BUILDER_SUPPLIES;
  return { ok: true, cost };
}

// --- building depots ---------------------------------------------------------

/** The four fields of a depot with its entrance on a field: it, then its lower right, below and lower left. */
function depotFields(entrance: Field): Field[] {
  return [entrance, fieldTowards(entrance, 2), fieldTowards(entrance, 3), fieldTowards(entrance, 4)];
}

/** Whether the ground for a depot with its entrance on a field can be prepared: four free fields of open ground. */
function canPrepare(state: GameState, entrance: Field): boolean {
  return depotFields(entrance).every((field) => {
    if (!onMap(state, field) || unitAt(state, field)) return false;
    return state.terrainTypes[state.map.terrain[fieldIndex(state, field)]!]?.buildable ?? false;
  });
}

/** Whether a field is the entrance field of ground prepared for a depot. */
function isPrepared(state: GameState, field: Field): boolean {
  return onMap(state, field) && state.map.terrain[fieldIndex(state, field)] === state.rules.preparedGround[0];
}

function depotCount(state: GameState): number {
  return state.buildings.filter((building) => building.kind === 'depot').length;
}

/** Whether sappers can work on a field: it is open ground or a trench. */
function canDig(state: GameState, field: Field): boolean {
  return onMap(state, field) && (state.terrainTypes[state.map.terrain[fieldIndex(state, field)]!]?.buildable ?? false);
}

function isTrench(state: GameState, field: Field): boolean {
  return state.map.terrain[fieldIndex(state, field)]! >= FIRST_TRENCH_GROUND;
}

/** Why a unit cannot be ordered to work on a depot or a trench at all right now, or null if it can. */
export function cannotWorkReason(state: GameState, unit: Unit): string | null {
  if (state.winner !== null) return 'The battle is over.';
  const type = state.unitTypes[unit.type];
  if (!type?.buildsDepots && !type?.digsTrenches) return 'This unit neither builds depots nor digs trenches.';
  if (unit.side !== attackerSide(state)) return 'A side builds and digs in the half in which it attacks.';
  if (unit.inside) return 'A unit inside a transport or building cannot build or dig.';
  if (type.buildsDepots && unit.supplies <= 0) {
    return 'This unit has nothing left to build with; a repair in a building restocks it.';
  }
  return null;
}

/**
 * The fields a construction unit or sappers could work on from where they
 * stand, and what the work would be.
 */
export function workPlaces(state: GameState, unit: Unit): { field: Field; work: Work }[] {
  const type = state.unitTypes[unit.type];
  const places: { field: Field; work: Work }[] = [];
  if (type?.buildsDepots) {
    for (const [column, row] of DEPOT_PLACE_STEPS[unit.column & 1 ? 'odd' : 'even']) {
      const field = { column: unit.column + column, row: unit.row + row };
      if (isPrepared(state, field)) places.push({ field, work: 'build' });
      else if (canPrepare(state, field)) places.push({ field, work: 'prepare' });
    }
  } else if (type?.digsTrenches) {
    for (const field of neighbours(unit, state.map)) {
      if (canDig(state, field)) places.push({ field, work: isTrench(state, field) ? 'fill' : 'dig' });
    }
  }
  return places;
}

/** The work a unit has been ordered to do in this half, or null. */
export function workOf(state: GameState, unit: Unit): WorkOrder | null {
  return state.works.find((order) => order.unit === unit) ?? null;
}

export type WorkResult = { ok: true; work: Work } | { ok: false; reason: string };

/** Orders a construction unit or sappers to work on a field when the half ends, replacing any earlier order. */
export function orderWork(state: GameState, unit: Unit, target: Field): WorkResult {
  const reason = cannotWorkReason(state, unit);
  if (reason) return { ok: false, reason };
  const place = workPlaces(state, unit).find(({ field }) => sameField(field, target));
  if (!place) {
    const digs = state.unitTypes[unit.type]?.digsTrenches;
    return { ok: false, reason: digs ? 'Sappers cannot dig there.' : 'A depot cannot be built there.' };
  }
  if (place.work === 'build' && depotCount(state) >= MAX_DEPOTS) {
    return { ok: false, reason: 'The map holds no more depots.' };
  }
  cancelWork(state, unit);
  state.works.push({ unit, target: { column: target.column, row: target.row }, work: place.work });
  return { ok: true, work: place.work };
}

export function cancelWork(state: GameState, unit: Unit): void {
  state.works = state.works.filter((order) => order.unit !== unit);
}

export interface WorkReport extends WorkOrder {
  /** False if the ground was no longer as the work needs it, or the unit was gone. */
  done: boolean;
}

/** Digs the trench an order names, or fills it in if the field aimed at is a trench by now. */
function digTrench(state: GameState, order: WorkOrder): WorkReport {
  const { unit, target } = order;
  const trench = TRENCH_STEPS[unit.column & 1 ? 'odd' : 'even'][directionTo(unit, target)];
  if (!trench || !canDig(state, target)) return { ...order, done: false };
  const fill = isTrench(state, target);
  for (const [column, row, ground] of trench) {
    const field = { column: unit.column + column, row: unit.row + row };
    if (canDig(state, field)) state.map.terrain[fieldIndex(state, field)] = fill ? FILLED_GROUND : ground;
  }
  return { ...order, work: fill ? 'fill' : 'dig', done: true };
}

/** Carries out one order to work on a depot or a trench. */
function carryOutWork(state: GameState, order: WorkOrder): WorkReport {
  const { unit, target, work } = order;
  const failed = { ...order, done: false };
  if (unit.destroyed || unit.inside || unit.side === null) return failed;
  if (work === 'dig' || work === 'fill') return digTrench(state, order);
  if (unit.supplies <= 0) return failed;
  const fields = depotFields(target);
  if (work === 'prepare') {
    if (!canPrepare(state, target)) return failed;
    fields.forEach((field, part) => {
      state.map.terrain[fieldIndex(state, field)] = state.rules.preparedGround[part]!;
    });
  } else {
    const entrance = entranceTerrain(state.terrainTypes, 'depot', unit.side);
    if (!isPrepared(state, target) || depotCount(state) >= MAX_DEPOTS || entrance < 0) return failed;
    fields.forEach((field, part) => {
      if (!onMap(state, field)) return;
      state.map.terrain[fieldIndex(state, field)] = part === 0 ? entrance : state.rules.depotGround[part - 1]!;
      state.buildingIndex[fieldIndex(state, field)] = state.buildings.length;
    });
    state.buildings.push({
      kind: 'depot',
      owner: unit.side,
      entrance: target,
      fields: fields.filter((field) => onMap(state, field)),
      units: [],
      resources: 0,
      worth: BUILDING_WORTH.depot,
    });
  }
  unit.supplies--;
  return { ...order, done: true };
}

export interface HalfReport {
  /** What happened in each attack, in the order they were carried out. */
  fights: FightReport[];
  /** The buildings taken afterwards by units that had moved onto their entrances. */
  captures: CaptureReport[];
  /** The work on depots and trenches ordered in this half, and whether each piece was done. */
  works: WorkReport[];
  /** The side that was paid, the one that moved in this half, and what it got. */
  paid: { side: Side; points: number };
}

/**
 * Ends this half of the round: carries out the attacks ordered in it, lets
 * the moving side's units take the buildings whose entrances they stand on,
 * has the construction units and sappers do the work ordered, pays the side that moved
 * what its buildings earn, then swaps the sides' roles.
 */
/**
 * Carries out the attacks ordered in this half, in the order they were
 * given, and nothing else of the half's end. They come before the moves:
 * whoever shows a half's end can show them first and then have units move
 * that have waited. `endHalf` does this itself if it has not been done.
 */
export function resolveAttacks(state: GameState): FightReport[] {
  const fights = state.orders.map((order) => fight(state, order));
  state.orders = [];
  return fights;
}

export function endHalf(state: GameState): HalfReport {
  const fights = resolveAttacks(state);

  const captures: CaptureReport[] = [];
  for (const building of state.buildings) {
    const capture = takeBuilding(state, building);
    if (capture) captures.push(capture);
  }

  const works = state.works.map((order) => carryOutWork(state, order));
  state.works = [];

  for (const side of [0, 1] as const) {
    const other = side === 0 ? 1 : 0;
    const alive = (s: Side) => state.units.some((unit) => unit.side === s && !unit.destroyed);
    if (state.winner === null && alive(side) && !alive(other)) {
      state.winner = side;
      state.wonBy = 'units';
    }
  }

  // A gun that is slow to fire and moved in this half, and still stands on
  // the map, sits out the next one, in which its side attacks.
  for (const unit of state.units) {
    unit.settling =
      unit.side === state.mover &&
      unit.moved &&
      !unit.inside &&
      !unit.destroyed &&
      (state.unitTypes[unit.type]?.slowToFire ?? false);
  }

  // The side that moved is paid, and attacks next: that is when it can spend.
  const paid = { side: state.mover, points: incomeOf(state, state.mover) };
  state.points[paid.side] = Math.min(MAX_POINTS, state.points[paid.side] + paid.points);

  if (state.mover === 0) {
    state.mover = 1;
  } else {
    state.mover = 0;
    state.round++;
    for (const unit of state.units) unit.moved = false;
  }
  return { fights, captures, works, paid };
}

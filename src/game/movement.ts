// Where a unit can move in one turn.
//
// The rule, as the hl1914-18 project's notes and port describe the original
// game applying it (not checked against the running game from this project):
//
//   - A unit starts its move with its type's movement budget.
//   - Entering a field costs the terrain's surface cost, or its air cost for
//     aircraft. A field can be entered if the budget left covers its cost.
//   - A field is closed if its terrain class is not in the unit's terrain
//     mask, if an enemy unit stands on it, or if it is a building entrance of
//     another side (unless the unit may use any entrance).
//   - A field next to an enemy unit can be entered whatever it costs, but the
//     move ends there.
//   - Friendly units can be passed through. A friendly transport's field
//     costs 2 whatever it stands on, which is how a unit reaches a train on
//     its rails or a ship on the water to be loaded.
//   - A ship that fills two fields cannot enter a field holding any unit, its
//     own second half included, so it cannot turn round on the spot. Its
//     second half follows on the field the first has just left.
//   - A unit leaving a transport or a building starts from that field with a
//     budget of 8 (4 for a unit that pays 2 for every field), and the
//     entrances of buildings that are not its side's are closed to it
//     whatever it is.
//
// Whether a move may end on a field is another matter: see cannotStopReason
// in state.ts.

import { NO_UNIT, splitUnitCode, type GameMap, type Side } from '../formats/map.ts';
import { canEnter, entranceClosedTo, type TerrainType } from '../formats/terrain.ts';
import type { UnitType } from '../formats/unitTypes.ts';

export interface Field {
  column: number;
  row: number;
}

/** The parts of a unit type that movement depends on. */
export type MoverType = Pick<
  UnitType,
  | 'movementBudget'
  | 'terrainMask'
  | 'isAircraft'
  | 'isTransport'
  | 'isShipHalf'
  | 'entersAnyBuilding'
  | 'flatMoveCost'
>;

const FLAT_COST = 2;
const TRANSPORT_FIELD_COST = 2;

/** The budget of a unit that leaves a transport or building, and of one that pays the flat cost. */
export const LEAVING_BUDGET = 8;
export const LEAVING_BUDGET_FLAT = 4;

export interface MoveOptions {
  /**
   * The unit that moves, when it is not the one standing on the start field:
   * a unit leaving the transport that stands there, or leaving a building.
   */
  mover?: { type: number; side: Side };
  /** The budget to start with instead of the unit type's. */
  budget?: number;
  /** Closes other sides' and nobody's building entrances even to units that may use them. */
  ownEntrancesOnly?: boolean;
}

/** Number of directions out of a field. Direction 0 is up the map; the rest follow clockwise. */
export const DIRECTIONS = 6;

/** The field one step in each direction, whether or not it is on the map. */
function around(field: Field): Field[] {
  const { column, row } = field;
  // Odd columns sit half a field lower, so their side neighbours are a row further down.
  const down = column & 1;
  return [
    { column, row: row - 1 },
    { column: column + 1, row: row - 1 + down },
    { column: column + 1, row: row + down },
    { column, row: row + 1 },
    { column: column - 1, row: row + down },
    { column: column - 1, row: row - 1 + down },
  ];
}

/** The field one step from a field in a direction; it may lie off the map. */
export function fieldTowards(field: Field, direction: number): Field {
  return around(field)[direction]!;
}

/** The fields around a field, clockwise from the one above; fewer at the map's edge. */
export function neighbours(field: Field, map: GameMap): Field[] {
  return around(field).filter((f) => f.column >= 0 && f.column < map.columns && f.row >= 0 && f.row < map.rows);
}

/** The direction of a step between two neighbouring fields, or -1 if they are not neighbours. */
export function directionTo(from: Field, to: Field): number {
  return around(from).findIndex((f) => f.column === to.column && f.row === to.row);
}

export interface MoveRange {
  /**
   * For every field, row by row: the budget the unit has left on arriving
   * there, or -1 if it cannot get there. The start field holds the full budget.
   */
  remaining: Int16Array;
  /** For every reached field, the field it was reached from; -1 for the start and unreached fields. */
  previous: Int32Array;
}

/**
 * Works out where the unit standing on `start` can move this turn, or with
 * `options.mover` where that unit can move from `start`. Returns null if
 * there is no such unit.
 */
export function moveRange(
  map: GameMap,
  start: Field,
  unitTypes: readonly MoverType[],
  terrainTypes: readonly TerrainType[],
  options: MoveOptions = {},
): MoveRange | null {
  const index = (field: Field) => field.row * map.columns + field.column;
  const startCode = map.units[index(start)];
  if (startCode === undefined) return null;
  if (!options.mover && startCode === NO_UNIT) return null;
  const mover = options.mover ?? splitUnitCode(startCode);
  const type = unitTypes[mover.type];
  if (!type) return null;
  const anyEntrance = type.entersAnyBuilding && !options.ownEntrancesOnly;

  const fieldCount = map.columns * map.rows;
  // What entering each field costs, or -1 where the unit cannot go at all.
  const cost = new Int16Array(fieldCount).fill(-1);
  for (let at = 0; at < fieldCount; at++) {
    const terrain = terrainTypes[map.terrain[at]!];
    if (!terrain || !canEnter(type.terrainMask, terrain)) continue;
    if (!anyEntrance && entranceClosedTo(mover.side, terrain)) continue;
    cost[at] = type.flatMoveCost ? FLAT_COST : type.isAircraft ? terrain.airCost : terrain.surfaceCost;
  }

  // Fields beside an enemy: entering one is always possible and ends the move.
  const besideEnemy = new Uint8Array(fieldCount);
  for (let row = 0; row < map.rows; row++) {
    for (let column = 0; column < map.columns; column++) {
      const at = index({ column, row });
      const code = map.units[at]!;
      if (code === NO_UNIT || at === index(start)) continue;
      const other = splitUnitCode(code);
      if (other.side !== mover.side) {
        cost[at] = -1;
        for (const near of neighbours({ column, row }, map)) besideEnemy[index(near)] = 1;
      } else if (type.isShipHalf) {
        cost[at] = -1;
      } else if (unitTypes[other.type]?.isTransport) {
        // Even on terrain the unit cannot enter: that is how it boards a train or a ship.
        cost[at] = TRANSPORT_FIELD_COST;
      }
    }
  }

  // Spread outwards from the fields with the most budget left, so each field
  // is first reached by the best way there.
  const remaining = new Int16Array(fieldCount).fill(-1);
  const previous = new Int32Array(fieldCount).fill(-1);
  const budget = options.budget ?? type.movementBudget;
  const byBudget: Field[][] = Array.from({ length: budget + 1 }, () => []);
  remaining[index(start)] = budget;
  byBudget[budget]!.push(start);
  for (let left = budget; left > 0; left--) {
    for (const field of byBudget[left]!) {
      for (const near of neighbours(field, map)) {
        const at = index(near);
        if (remaining[at] !== -1 || cost[at] === -1) continue;
        const after = besideEnemy[at] ? 0 : left - cost[at]!;
        if (after < 0) continue;
        remaining[at] = after;
        previous[at] = index(field);
        byBudget[after]!.push(near);
      }
    }
  }
  return { remaining, previous };
}

/**
 * The fields a move to `target` passes over, from the first step to the
 * target itself. Empty if the target is the start or was not reached.
 */
export function pathTo(range: MoveRange, map: GameMap, target: Field): Field[] {
  const path: Field[] = [];
  let at = target.row * map.columns + target.column;
  while (range.previous[at] !== undefined && range.previous[at] !== -1) {
    path.unshift({ column: at % map.columns, row: Math.floor(at / map.columns) });
    at = range.previous[at]!;
  }
  return path;
}

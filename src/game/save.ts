// Saving a battle and taking it up again.
//
// A saved battle is plain data that can be written as JSON. It holds what the
// rules depend on: the ground as it is now (buildings change hands, depots
// are built, trenches dug), every unit that is left with what it is inside,
// every building, the round and whose half it is, the orders given in this
// half, and both sides' points.
//
// It does not hold the unit and terrain tables, nor the numbers that differ
// between the games. Those come from the game's files again when the battle
// is taken up, so a saved battle is only good with the game it was played on. Destroyed units are left out.

import { NO_UNIT, type GameMap, type Side } from '../formats/map.ts';
import type { Site, TerrainType } from '../formats/terrain.ts';
import type { Field } from './movement.ts';
import { HISTORYLINE_RULES, type Rules } from './rules.ts';
import {
  BUILDING_WORTH,
  fieldsOf,
  type Building,
  type GameState,
  type RuleType,
  type Unit,
  type Work,
} from './state.ts';

/** Changes whenever saved battles of an earlier kind can no longer be read. */
export const SAVE_VERSION = 1;

export interface SavedUnit {
  type: number;
  side: Side | null;
  column: number;
  row: number;
  tail: Field | null;
  supplies: number;
  facing: number;
  count: number;
  experience: number;
  moved: boolean;
  settling: boolean;
  /** The units it carries, by their numbers in the saved list, in the order of their places. */
  cargo: number[];
}

export interface SavedBuilding {
  kind: Site;
  owner: Side | null;
  entrance: Field;
  fields: Field[];
  resources: number;
  /** Missing in saves made before the computer's player was there. */
  worth?: number;
  /** The units inside, by their numbers in the saved list, in the order of their places. */
  units: number[];
}

export interface SavedGame {
  version: number;
  columns: number;
  rows: number;
  /** Terrain number per field, row by row. */
  terrain: number[];
  units: SavedUnit[];
  buildings: SavedBuilding[];
  round: number;
  mover: Side;
  winner: Side | null;
  wonBy: GameState['wonBy'];
  points: [number, number];
  buildable: number[];
  /** `victim` is the unit the order was given on; missing in saves made when an attack hit whatever stood on its field. */
  orders: { attacker: number; target: Field; victim?: number }[];
  works: { unit: number; target: Field; work: Work }[];
}

const copy = (field: Field): Field => ({ column: field.column, row: field.row });

/** Everything about a battle that taking it up again needs, as plain data. */
export function saveGame(state: GameState): SavedGame {
  const kept = state.units.filter((unit) => !unit.destroyed);
  const numberOf = new Map(kept.map((unit, number) => [unit, number]));
  const numbers = (units: readonly Unit[]) => units.flatMap((unit) => numberOf.get(unit) ?? []);
  return {
    version: SAVE_VERSION,
    columns: state.map.columns,
    rows: state.map.rows,
    terrain: [...state.map.terrain],
    units: kept.map((unit) => ({
      type: unit.type,
      side: unit.side,
      column: unit.column,
      row: unit.row,
      tail: unit.tail ? copy(unit.tail) : null,
      supplies: unit.supplies,
      facing: unit.facing,
      count: unit.count,
      experience: unit.experience,
      moved: unit.moved,
      settling: unit.settling,
      cargo: numbers(unit.cargo),
    })),
    buildings: state.buildings.map((building) => ({
      kind: building.kind,
      owner: building.owner,
      entrance: copy(building.entrance),
      fields: building.fields.map(copy),
      resources: building.resources,
      worth: building.worth,
      units: numbers(building.units),
    })),
    round: state.round,
    mover: state.mover,
    winner: state.winner,
    wonBy: state.wonBy,
    points: [state.points[0], state.points[1]],
    buildable: [...state.buildable],
    orders: state.orders.flatMap((order) => {
      const attacker = numberOf.get(order.attacker);
      const victim = numberOf.get(order.victim);
      return attacker === undefined || victim === undefined ? [] : [{ attacker, target: copy(order.target), victim }];
    }),
    works: state.works.flatMap((order) => {
      const unit = numberOf.get(order.unit);
      return unit === undefined ? [] : [{ unit, target: copy(order.target), work: order.work }];
    }),
  };
}

/**
 * The battle a save holds, ready to be played on. Throws an Error that says
 * what is wrong if the save is of another version or does not fit together
 * or with the unit table.
 */
export function restoreGame(
  saved: SavedGame,
  unitTypes: readonly RuleType[],
  terrainTypes: readonly TerrainType[],
  rules: Rules = HISTORYLINE_RULES,
): GameState {
  if (saved.version !== SAVE_VERSION) {
    throw new Error(`it is of version ${saved.version}, and this program reads version ${SAVE_VERSION}`);
  }
  const { columns, rows } = saved;
  const fieldCount = columns * rows;
  if (!(columns > 0 && rows > 0) || saved.terrain.length !== fieldCount) {
    throw new Error(`its ground does not fit a map of ${columns} by ${rows} fields`);
  }
  const map: GameMap = {
    columns,
    rows,
    terrain: Uint8Array.from(saved.terrain),
    units: new Uint8Array(fieldCount).fill(NO_UNIT),
  };
  const indexOf = (field: Field): number => {
    if (!(field.column >= 0 && field.column < columns && field.row >= 0 && field.row < rows)) {
      throw new Error(`it names field ${field.column}, ${field.row}, which is not on its map`);
    }
    return field.row * columns + field.column;
  };

  const units: Unit[] = saved.units.map((one) => {
    if (!unitTypes[one.type]) throw new Error(`it has a unit of kind ${one.type}, which the game does not have`);
    return {
      type: one.type,
      side: one.side,
      column: one.column,
      row: one.row,
      tail: one.tail ? copy(one.tail) : null,
      supplies: one.supplies,
      facing: one.facing,
      count: one.count,
      experience: one.experience,
      moved: one.moved,
      settling: one.settling,
      destroyed: false,
      inside: null,
      cargo: [],
    };
  });
  const unitNumbered = (number: number): Unit => {
    const unit = units[number];
    if (!unit) throw new Error(`it names unit ${number}, and has ${units.length} units`);
    return unit;
  };
  const putInto = (holder: Building | Unit, inside: Unit[], numbers: readonly number[]) => {
    for (const number of numbers) {
      const unit = unitNumbered(number);
      if (unit.inside || unit === holder) throw new Error(`its unit ${number} is inside two things at once`);
      unit.inside = holder;
      inside.push(unit);
    }
  };
  saved.units.forEach((one, number) => putInto(units[number]!, units[number]!.cargo, one.cargo));
  const buildings: Building[] = saved.buildings.map((one) => {
    const building: Building = {
      kind: one.kind,
      owner: one.owner,
      entrance: copy(one.entrance),
      fields: one.fields.map(copy),
      units: [],
      resources: one.resources,
      worth: one.worth ?? BUILDING_WORTH[one.kind],
    };
    putInto(building, building.units, one.units);
    return building;
  });

  // The fields' unit and building numbers, and the map's unit layer, follow
  // from where the units and buildings are.
  const unitIndex = new Int16Array(fieldCount).fill(-1);
  units.forEach((unit, number) => {
    if (unit.inside) return;
    const side = unit.side;
    if (side === null) throw new Error(`its unit ${number} stands on the map and belongs to neither side`);
    fieldsOf(unit).forEach((field, half) => {
      const at = indexOf(field);
      if (unitIndex[at] !== -1) throw new Error(`two of its units stand on field ${field.column}, ${field.row}`);
      unitIndex[at] = number;
      // A ship's second half is the next kind in the table: the picture of its rear.
      map.units[at] = (unit.type + half) * 2 + side;
    });
  });
  const buildingIndex = new Int16Array(fieldCount).fill(-1);
  buildings.forEach((building, number) => {
    for (const field of building.fields) {
      const at = indexOf(field);
      if (buildingIndex[at] === -1) buildingIndex[at] = number;
    }
  });

  return {
    map,
    units,
    unitIndex,
    buildings,
    buildingIndex,
    round: saved.round,
    mover: saved.mover,
    orders: saved.orders.flatMap((order) => {
      // An order saved without its unit was on whatever stood on its field.
      const victim =
        order.victim === undefined ? units[unitIndex[indexOf(order.target)] ?? -1] : unitNumbered(order.victim);
      return victim ? [{ attacker: unitNumbered(order.attacker), target: copy(order.target), victim }] : [];
    }),
    works: saved.works.map((order) => ({
      unit: unitNumbered(order.unit),
      target: copy(order.target),
      work: order.work,
    })),
    winner: saved.winner,
    wonBy: saved.wonBy,
    points: [saved.points[0], saved.points[1]],
    buildable: [...saved.buildable],
    unitTypes,
    terrainTypes,
    rules,
  };
}

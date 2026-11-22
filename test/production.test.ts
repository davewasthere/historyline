// Tests of points: what buildings earn, and building and repairing units with it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Shop } from '../src/formats/shops.ts';
import {
  buildChoices,
  buildUnit,
  cannotBuildReason,
  cannotMoveReason,
  cannotRepairReason,
  createGame,
  endHalf,
  incomeOf,
  moveUnit,
  repairCost,
  repairUnit,
  unitAt,
  type GameState,
} from '../src/game/state.ts';
import {
  BUNKER,
  HEAVY_GUN,
  INFANTRY,
  makeMap,
  TANK,
  terrainTypes,
  TRAIN,
  TRUCK,
  unitTypes,
  type Placement,
} from './helpers.ts';

const HEADQUARTERS = 0;
const FACTORY = 1;
const DEPOT = 2;
const TRANSPORT = 3;

function shop(owner: number, kind: number, index: number, contents: number[], resources = 0): Shop {
  return { owner, kind, index, resources, worth: 0, contents };
}

function game(rows: string[], units: Placement[], shops: Shop[] = [], buildable?: number[], types = unitTypes) {
  return createGame(makeMap(rows, units), types, terrainTypes, buildable ? { shops, buildable } : { shops });
}

function refusedBuild(state: GameState, building: number, type: number): string {
  const result = buildUnit(state, state.buildings[building]!, type);
  assert.ok(!result.ok, 'the unit was built');
  return result.reason;
}

test('a side is paid what its buildings earn when the half it moved in ends', () => {
  const state = game(
    ['rrrrrrrrr', 'rHrGrNrFK'],
    [[4, 0, INFANTRY, 0], [8, 0, BUNKER, 1]],
    [shop(0, DEPOT, 0, [], 7), shop(2, DEPOT, 1, [], 9), shop(1, DEPOT, 2, [], 4), shop(1, HEADQUARTERS, 1, [], 20)],
  );
  // A headquarters no record speaks of earns 50.
  assert.deepEqual(state.buildings.map((building) => building.resources), [50, 7, 9, 4, 20]);
  assert.deepEqual([state.points, incomeOf(state, 0), incomeOf(state, 1)], [[0, 0], 57, 24]);

  // The German side moves, takes the depot that is nobody's, and is paid for it at once.
  assert.ok(moveUnit(state, unitAt(state, { column: 4, row: 0 })!, { column: 5, row: 1 }).ok);
  assert.deepEqual(endHalf(state).paid, { side: 0, points: 66 });
  assert.deepEqual(state.points, [66, 0]);
  assert.deepEqual(endHalf(state).paid, { side: 1, points: 24 });
  assert.deepEqual(state.points, [66, 24]);
  endHalf(state);
  assert.deepEqual(state.points, [132, 24]);
});

test('a factory builds for its owner in the half that side attacks, for the price', () => {
  const state = game(
    ['rrrrrrrrr', 'rrZrrGrQr'],
    [[0, 0, TANK, 0], [8, 0, BUNKER, 1]],
    [shop(0, FACTORY, 0, [], 30)],
    [INFANTRY, TANK],
  );
  const factory = state.buildings[0]!;
  assert.deepEqual(buildChoices(state, factory), [
    { type: TANK, price: 60 },
    { type: INFANTRY, price: 60 },
  ]);
  assert.deepEqual(buildChoices(state, state.buildings[1]!), []);

  // The German side moves first, so it cannot build yet, and it has nothing to build with.
  assert.match(refusedBuild(state, 0, INFANTRY), /half in which it attacks/);
  endHalf(state);
  assert.match(refusedBuild(state, 0, INFANTRY), /costs 60 points; the side has 30/);

  state.points[0] = 130;
  assert.match(refusedBuild(state, 0, TRUCK), /cannot be built here/);
  assert.match(refusedBuild(state, 1, INFANTRY), /Only factories/);
  assert.match(refusedBuild(state, 2, INFANTRY), /its own factories/);
  const before = state.units.length;
  const built = buildUnit(state, factory, INFANTRY);
  assert.ok(built.ok);
  const { unit } = built;
  assert.deepEqual(
    [unit.type, unit.side, unit.count, unit.experience, unit.inside === factory, unit.column, unit.row],
    [INFANTRY, 0, 6, 0, true, 2, 1],
  );
  assert.deepEqual([state.units.length, factory.units, state.points[0]], [before + 1, [unit], 70]);
  assert.ok(buildUnit(state, factory, TANK).ok);
  assert.match(cannotBuildReason(state, factory, TANK)!, /costs 60 points; the side has 10/);

  // What was built moves out when its side next moves.
  assert.match(cannotMoveReason(state, unit)!, /attacks in this half/);
  endHalf(state);
  assert.equal(cannotMoveReason(state, unit), null);
  assert.ok(moveUnit(state, unit, { column: 3, row: 1 }).ok);
  assert.equal(unitAt(state, { column: 3, row: 1 }), unit);
});

test('each army builds its own kinds only, and a full factory builds nothing', () => {
  // The first ten kinds are the German army's alone; of the tests' kinds only the last two are not among them.
  const french = game(['rrrrr', 'rrQrr'], [[0, 0, TANK, 0], [4, 0, BUNKER, 1]]);
  french.points[1] = 500;
  assert.deepEqual(buildChoices(french, french.buildings[0]!), [
    { type: TRAIN, price: 60 },
    { type: HEAVY_GUN, price: 60 },
  ]);
  assert.match(refusedBuild(french, 0, INFANTRY), /cannot be built here/);
  assert.ok(buildUnit(french, french.buildings[0]!, HEAVY_GUN).ok);

  const full = game(
    ['rrrrr', 'rrZrr'],
    [[0, 0, TANK, 0], [4, 0, BUNKER, 1]],
    [shop(0, FACTORY, 0, Array(7).fill(INFANTRY))],
  );
  endHalf(full);
  full.points[0] = 500;
  assert.match(refusedBuild(full, 0, INFANTRY), /no free place/);
});

test('a damaged unit inside a building is made whole again for points', () => {
  const types = [...unitTypes];
  types[TANK] = { ...types[TANK]!, buildsDepots: true };
  const state = game(
    ['rrrrrr', 'rrGrrr'],
    [[0, 0, TRUCK, 0], [5, 0, BUNKER, 1]],
    [shop(0, DEPOT, 0, [INFANTRY, INFANTRY, TANK]), shop(0, TRANSPORT, 0, [INFANTRY])],
    undefined,
    types,
  );
  const [first, second, builder] = state.buildings[0]!.units;
  const aboard = state.units[0]!.cargo[0]!;
  for (const unit of [first!, builder!, aboard]) unit.count = 2;
  first!.experience = 3;
  state.points[0] = 70;
  assert.deepEqual([repairCost(state, first!), repairCost(state, builder!)], [15, 50]);

  // Repairs wait for the half in which the side attacks.
  assert.match(cannotRepairReason(state, first!)!, /half in which it attacks/);
  endHalf(state);
  assert.match(cannotRepairReason(state, second!)!, /full strength/);
  assert.match(cannotRepairReason(state, aboard)!, /inside a building/);

  assert.deepEqual(repairUnit(state, first!), { ok: true, cost: 15 });
  assert.deepEqual([first!.count, first!.experience, state.points[0]], [6, 3, 55]);
  assert.deepEqual(repairUnit(state, builder!), { ok: true, cost: 50 });
  assert.deepEqual([builder!.count, state.points[0]], [6, 5]);

  second!.count = 1;
  const short = repairUnit(state, second!);
  assert.ok(!short.ok);
  assert.match(short.reason, /costs 15 points; the side has 5/);
  assert.equal(second!.count, 1);
});

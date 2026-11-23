// Tests of construction units: preparing ground for a depot and building one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HISTORYLINE_RULES } from '../src/game/rules.ts';
import {
  buildingAt,
  BUILDER_SUPPLIES,
  cannotRepairReason,
  cannotWorkReason,
  createGame,
  endHalf,
  MAX_DEPOTS,
  moveUnit,
  orderWork,
  repairUnit,
  unitAt,
  workOf,
  workPlaces,
  type GameState,
  type Unit,
} from '../src/game/state.ts';
import { BUNKER, INFANTRY, makeMap, TANK, terrainOf, terrainTypes, unitTypes, type Placement } from './helpers.ts';

const { preparedGround: PREPARED_GROUND, depotGround: DEPOT_GROUND } = HISTORYLINE_RULES;

/** In these tests a tank is the construction unit. */
const BUILDER = TANK;
const types = [...unitTypes];
types[BUILDER] = { ...types[BUILDER]!, buildsDepots: true };

// Plains all over but for a road along the bottom, where nothing can be built.
const FIELD = ['ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'rrrrrrr'];

function game(units: Placement[], rows = FIELD) {
  return createGame(makeMap(rows, units), types, terrainTypes);
}

const at = (state: GameState, column: number, row: number) => row * state.map.columns + column;

function on(state: GameState, column: number, row: number): Unit {
  const unit = unitAt(state, { column, row });
  assert.ok(unit, `no unit on ${column}, ${row}`);
  return unit;
}

/** Plays on to the next half in which the German side attacks. */
function toGermanAttack(state: GameState): void {
  do endHalf(state);
  while (state.mover !== 1);
}

test('a construction unit can work on the ten fields near it that have room for a depot', () => {
  const state = game([[3, 2, BUILDER, 0], [6, 5, BUNKER, 1]]);
  const builder = on(state, 3, 2);
  assert.equal(builder.supplies, BUILDER_SUPPLIES);
  // It builds in the half its side attacks.
  assert.match(cannotWorkReason(state, builder)!, /half in which it attacks/);
  toGermanAttack(state);
  assert.equal(cannotWorkReason(state, builder), null);

  // The ten fields, clockwise from the one two above: none of them puts a
  // depot's four fields (its entrance and the three below it) on the unit.
  const places = (s: GameState, unit: Unit) =>
    workPlaces(s, unit).map(({ field, work }) => `${field.column},${field.row} ${work}`);
  assert.deepEqual(places(state, builder), [
    '3,0 prepare',
    '4,1 prepare',
    '5,1 prepare',
    '5,2 prepare',
    '4,3 prepare',
    '3,3 prepare',
    '2,3 prepare',
    '1,2 prepare',
    '1,1 prepare',
    '2,1 prepare',
  ]);
  // The field right above it is not one of them.
  const refused = orderWork(state, builder, { column: 3, row: 1 });
  assert.ok(!refused.ok);
  assert.match(refused.reason, /cannot be built there/);
  assert.match(cannotWorkReason(state, on(state, 6, 5))!, /neither builds depots nor digs/);

  // Another unit beside it takes away the places whose depot would cover its
  // field, and near the road at the bottom there is no open ground to build on.
  const crowded = game([[3, 2, BUILDER, 0], [4, 2, INFANTRY, 0], [3, 4, BUILDER, 0], [6, 5, BUNKER, 1]]);
  toGermanAttack(crowded);
  assert.deepEqual(places(crowded, on(crowded, 3, 2)), [
    '3,0 prepare',
    '5,2 prepare',
    '4,3 prepare',
    '2,3 prepare',
    '1,2 prepare',
    '1,1 prepare',
    '2,1 prepare',
  ]);
  assert.deepEqual(places(crowded, on(crowded, 3, 4)), ['4,3 prepare', '5,3 prepare', '1,3 prepare', '2,3 prepare']);
});

test('ground is prepared in one round and the depot built in another', () => {
  const state = game([[3, 1, BUILDER, 0], [6, 5, BUNKER, 1]]);
  const builder = on(state, 3, 1);
  toGermanAttack(state);
  const order = orderWork(state, builder, { column: 3, row: 2 });
  assert.deepEqual(order, { ok: true, work: 'prepare' });
  assert.deepEqual(workOf(state, builder)!.target, { column: 3, row: 2 });

  const [prepared] = endHalf(state).works;
  assert.deepEqual([prepared!.unit, prepared!.work, prepared!.done], [builder, 'prepare', true]);
  // The entrance field, then its lower right, below and lower left (the entrance is in an odd column).
  const fields = [at(state, 3, 2), at(state, 4, 3), at(state, 3, 3), at(state, 2, 3)];
  assert.deepEqual(fields.map((field) => state.map.terrain[field]), [...PREPARED_GROUND]);
  assert.equal(builder.supplies, 1);
  assert.equal(state.buildings.length, 0);
  assert.deepEqual(state.works, []);

  toGermanAttack(state);
  assert.deepEqual(workPlaces(state, builder).filter((place) => place.work === 'build'), [
    { field: { column: 3, row: 2 }, work: 'build' },
  ]);
  assert.deepEqual(orderWork(state, builder, { column: 3, row: 2 }), { ok: true, work: 'build' });
  const [built] = endHalf(state).works;
  assert.deepEqual([built!.work, built!.done], ['build', true]);
  assert.deepEqual(
    fields.map((field) => state.map.terrain[field]),
    [terrainTypes.indexOf(terrainOf('G')), ...DEPOT_GROUND],
  );
  const depot = state.buildings[0]!;
  assert.deepEqual(
    [depot.kind, depot.owner, depot.entrance, depot.units, depot.resources],
    ['depot', 0, { column: 3, row: 2 }, [], 0],
  );
  for (const [column, row] of [[3, 2], [4, 3], [3, 3], [2, 3]] as const) {
    assert.equal(buildingAt(state, { column, row }), depot);
  }
  assert.equal(builder.supplies, 0);

  // The depot works like any other: the next time its side moves, a unit goes in.
  toGermanAttack(state);
  assert.match(cannotWorkReason(state, builder)!, /nothing left to build with/);
  endHalf(state);
  const entering = moveUnit(state, builder, { column: 3, row: 2 });
  assert.ok(entering.ok);
  assert.equal(entering.arrival, 'entered');

  // Inside, a repair gives it its two pieces of work back, though it has lost nothing.
  endHalf(state);
  state.points[0] = 60;
  assert.equal(cannotRepairReason(state, builder), null);
  assert.deepEqual(repairUnit(state, builder), { ok: true, cost: 50 });
  assert.deepEqual([builder.supplies, state.points[0]], [BUILDER_SUPPLIES, 10]);
  assert.match(cannotRepairReason(state, builder)!, /full strength/);
});

test('work is not done on ground that is no longer free, and costs nothing then', () => {
  const state = game([[3, 1, BUILDER, 0], [2, 5, INFANTRY, 1], [6, 5, BUNKER, 1]]);
  const builder = on(state, 3, 1);
  const infantry = on(state, 2, 5);
  toGermanAttack(state);
  assert.ok(orderWork(state, builder, { column: 3, row: 2 }).ok);
  // In the same half the French side moves a unit onto one of the four fields.
  assert.ok(moveUnit(state, infantry, { column: 2, row: 3 }).ok);
  const [report] = endHalf(state).works;
  assert.equal(report!.done, false);
  assert.equal(builder.supplies, BUILDER_SUPPLIES);
  assert.ok(state.map.terrain.every((terrain) => !PREPARED_GROUND.includes(terrain)));
});

test('a map holds ten depots at most', () => {
  // Ten depots already; ground prepared beside the construction unit.
  const rows = ['GpGpGpGpGpGpGpGpGpG', 'ppppppppppppppppppp', 'ppppppppppppppppppp', 'ppppppppppppppppppp', 'ppppppppppppppppppp'];
  const state = game([[3, 2, BUILDER, 0], [18, 4, BUNKER, 1]], rows);
  assert.equal(state.buildings.length, MAX_DEPOTS);
  state.map.terrain[at(state, 3, 3)] = PREPARED_GROUND[0]!;
  toGermanAttack(state);
  const refused = orderWork(state, on(state, 3, 2), { column: 3, row: 3 });
  assert.ok(!refused.ok);
  assert.match(refused.reason, /no more depots/);
});

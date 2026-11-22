// Tests of sappers: digging trenches and filling them in, in place of attacking.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILLED_GROUND } from '../src/formats/terrain.ts';
import {
  cannotAttackReason,
  cannotWorkReason,
  createGame,
  endHalf,
  orderAttack,
  orderWork,
  rangeOf,
  unitAt,
  workPlaces,
  type GameState,
  type Unit,
} from '../src/game/state.ts';
import { BUNKER, INFANTRY, makeMap, TANK, terrainTypes, unitTypes, type Placement } from './helpers.ts';

/** In these tests the infantry are sappers. */
const SAPPERS = INFANTRY;
const types = [...unitTypes];
types[SAPPERS] = { ...types[SAPPERS]!, digsTrenches: true };

const PLAIN = ['ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp'];

function game(units: Placement[], rows = PLAIN) {
  return createGame(makeMap(rows, units), types, terrainTypes);
}

function on(state: GameState, column: number, row: number): Unit {
  const unit = unitAt(state, { column, row });
  assert.ok(unit, `no unit on ${column}, ${row}`);
  return unit;
}

const ground = (state: GameState, column: number, row: number) => state.map.terrain[row * state.map.columns + column]!;

/** Plays on to the next half in which the German side attacks. */
function toGermanAttack(state: GameState): void {
  do endHalf(state);
  while (state.mover !== 1);
}

test('sappers do not start attacks, but fire back', () => {
  const state = game([[2, 2, SAPPERS, 0], [2, 3, TANK, 1], [6, 4, BUNKER, 1]]);
  const sappers = on(state, 2, 2);
  const tank = on(state, 2, 3);
  // The French side attacks first: the sappers are hit and hit back.
  assert.ok(orderAttack(state, tank, { column: 2, row: 2 }).ok);
  const [fight] = endHalf(state).fights;
  assert.ok(fight!.targetLosses >= 1 && fight!.attackerLosses >= 1, 'both sides lose something');
  // In their own side's attacking half they have no attack to order.
  assert.match(cannotAttackReason(state, sappers)!, /do not start attacks/);
  assert.ok(!orderAttack(state, sappers, { column: 2, row: 3 }).ok);
  assert.equal(cannotWorkReason(state, sappers), null);
});

test('sappers dig a trench three fields long across the way to the field picked', () => {
  const state = game([[2, 2, SAPPERS, 0], [6, 4, BUNKER, 1]]);
  const sappers = on(state, 2, 2);
  assert.match(cannotWorkReason(state, sappers)!, /half in which it attacks/);
  toGermanAttack(state);
  // All six fields around them are open ground.
  assert.deepEqual(
    workPlaces(state, sappers).map(({ field, work }) => `${field.column},${field.row} ${work}`),
    ['2,1 dig', '3,1 dig', '3,2 dig', '2,3 dig', '1,2 dig', '1,1 dig'],
  );
  const refused = orderWork(state, sappers, { column: 2, row: 0 });
  assert.ok(!refused.ok);
  assert.match(refused.reason, /cannot dig there/);

  // Upwards from an even column: the field above, and those to its lower left and right.
  assert.deepEqual(orderWork(state, sappers, { column: 2, row: 1 }), { ok: true, work: 'dig' });
  const [dug] = endHalf(state).works;
  assert.deepEqual([dug!.work, dug!.done], ['dig', true]);
  assert.deepEqual([ground(state, 1, 1), ground(state, 2, 1), ground(state, 3, 1)], [0xaa, 0xa7, 0xab]);
  // Nothing else changed.
  assert.equal(state.map.terrain.filter((terrain) => terrain >= 0xa5).length, 3);

  // A tank cannot cross a trench.
  const tank = game([[2, 2, TANK, 0], [6, 4, BUNKER, 1]]);
  tank.map.terrain.set(state.map.terrain);
  assert.equal(rangeOf(tank, on(tank, 2, 2))!.remaining[1 * 7 + 2], -1);
});

test('aimed at a trench, sappers fill it in', () => {
  const state = game([[2, 2, SAPPERS, 0], [6, 4, BUNKER, 1]]);
  const sappers = on(state, 2, 2);
  toGermanAttack(state);
  assert.ok(orderWork(state, sappers, { column: 2, row: 1 }).ok);
  toGermanAttack(state);
  assert.deepEqual(
    workPlaces(state, sappers).filter((place) => place.work === 'fill').map(({ field }) => `${field.column},${field.row}`),
    ['2,1', '3,1', '1,1'],
  );
  assert.deepEqual(orderWork(state, sappers, { column: 2, row: 1 }), { ok: true, work: 'fill' });
  const [filled] = endHalf(state).works;
  assert.deepEqual([filled!.work, filled!.done], ['fill', true]);
  assert.deepEqual([ground(state, 1, 1), ground(state, 2, 1), ground(state, 3, 1)], Array(3).fill(FILLED_GROUND));
  assert.equal(state.map.terrain.filter((terrain) => terrain >= 0xa5).length, 0);
});

test('a trench leaves out ground that cannot be dug, and its line depends on the column', () => {
  // A road where one end of the trench would be.
  const road = game([[2, 2, SAPPERS, 0], [6, 4, BUNKER, 1]], ['ppppppp', 'ppprppp', 'ppppppp', 'ppppppp', 'ppppppp']);
  toGermanAttack(road);
  const before = ground(road, 3, 1);
  // The road is no place to dig towards either.
  assert.ok(!workPlaces(road, on(road, 2, 2)).some(({ field }) => field.column === 3 && field.row === 1));
  assert.ok(orderWork(road, on(road, 2, 2), { column: 2, row: 1 }).ok);
  endHalf(road);
  assert.deepEqual([ground(road, 1, 1), ground(road, 2, 1), ground(road, 3, 1)], [0xaa, 0xa7, before]);

  // From an odd column, down and to the right: the field aimed at, the one
  // beyond it to the right and the one below the sappers.
  const odd = game([[3, 2, SAPPERS, 0], [6, 0, BUNKER, 1]]);
  toGermanAttack(odd);
  assert.ok(orderWork(odd, on(odd, 3, 2), { column: 4, row: 3 }).ok);
  endHalf(odd);
  assert.deepEqual([ground(odd, 5, 2), ground(odd, 4, 3), ground(odd, 3, 3)], [0xaa, 0xa7, 0xaa]);
  assert.equal(odd.map.terrain.filter((terrain) => terrain >= 0xa5).length, 3);
});

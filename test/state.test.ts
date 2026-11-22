// Tests of a game in progress: moving, ordering attacks and ending turns.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_UNIT } from '../src/formats/map.ts';
import {
  attackerSide,
  attackTargets,
  cannotAttackReason,
  cannotMoveReason,
  createGame,
  endHalf,
  moveUnit,
  orderAttack,
  orderOf,
  rangeOf,
  START_FACING,
  unitAt,
} from '../src/game/state.ts';
import {
  ARTILLERY,
  BUNKER,
  HEAVY_GUN,
  INFANTRY,
  makeMap,
  PLANE,
  TANK,
  terrainTypes,
  TRUCK,
  unitTypes,
  type Placement,
} from './helpers.ts';

function game(rows: string[], units: Placement[]) {
  const map = makeMap(rows, units);
  return { map, state: createGame(map, unitTypes, terrainTypes) };
}

test("a game starts with the map's units at full strength, facing the way their side starts", () => {
  const { state } = game(['rrr'], [[0, 0, TANK, 0], [2, 0, BUNKER, 1]]);
  assert.deepEqual([state.round, state.mover, attackerSide(state), state.winner], [1, 0, 1, null]);
  assert.deepEqual(
    state.units.map(({ type, side, column, facing, count, experience, moved }) => ({
      type, side, column, facing, count, experience, moved,
    })),
    [
      { type: TANK, side: 0, column: 0, facing: START_FACING[0], count: 6, experience: 0, moved: false },
      { type: BUNKER, side: 1, column: 2, facing: START_FACING[1], count: 3, experience: 0, moved: false },
    ],
  );
  assert.equal(unitAt(state, { column: 2, row: 0 }), state.units[1]);
  assert.equal(unitAt(state, { column: 1, row: 0 }), null);
  assert.equal(unitAt(state, { column: 9, row: 0 }), null);
});

test('a move takes the unit to the field and turns it the way it went', () => {
  const { map, state } = game(['rrrr', 'pppp'], [[0, 0, TANK, 0]]);
  const tank = state.units[0]!;
  const result = moveUnit(state, tank, { column: 2, row: 0 });
  assert.ok(result.ok);
  assert.deepEqual(result.path.map((f) => f.column), [1, 2]);
  assert.deepEqual([tank.column, tank.row, tank.moved], [2, 0, true]);
  // The last step went from an odd column to the even one on its right: up and right.
  assert.equal(tank.facing, 1);
  assert.equal(unitAt(state, { column: 2, row: 0 }), tank);
  assert.equal(unitAt(state, { column: 0, row: 0 }), null);
  assert.equal(state.map.units[2], TANK * 2);
  assert.equal(state.map.units[0], NO_UNIT);
  // The map the game was started from is left as it was.
  assert.equal(map.units[0], TANK * 2);
});

test('moves the rules do not allow are refused and change nothing', () => {
  const { state } = game(
    ['rrrrrrrrr', 'wwwGppppp'],
    [[0, 0, TANK, 0], [1, 0, TRUCK, 0], [8, 0, TANK, 1], [4, 1, BUNKER, 0]],
  );
  const [tank, , enemy, bunker] = state.units;
  const refused = (unit: typeof tank, column: number, row: number) => {
    const result = moveUnit(state, unit!, { column, row });
    assert.ok(!result.ok);
    return result.reason;
  };
  assert.match(refused(tank, 0, 0), /already there/);
  assert.match(refused(tank, 6, 0), /out of reach/);
  assert.match(refused(tank, 1, 0), /does not carry/);
  assert.match(refused(tank, 4, 1), /occupied/);
  assert.match(refused(enemy, 7, 0), /attacks in this half/);
  assert.match(refused(bunker, 5, 1), /does not move/);
  assert.deepEqual([tank!.column, tank!.moved], [0, false]);

  assert.ok(moveUnit(state, tank!, { column: 2, row: 0 }).ok);
  assert.match(refused(tank, 3, 0), /already moved/);
});

test('an aircraft passes over ground marked as no place to land, but cannot end its move there', () => {
  const { state } = game(['rlrr'], [[0, 0, PLANE, 0], [3, 0, TANK, 0]]);
  const [plane, tank] = state.units;
  // The field is within its reach, and it costs what any field costs to fly over.
  assert.equal(rangeOf(state, plane!)!.remaining[1], 12);
  const refused = moveUnit(state, plane!, { column: 1, row: 0 });
  assert.ok(!refused.ok);
  assert.match(refused.reason, /cannot land/);
  assert.deepEqual([plane!.column, plane!.moved], [0, false]);

  const beyond = moveUnit(state, plane!, { column: 2, row: 0 });
  assert.ok(beyond.ok);
  assert.deepEqual(beyond.path.map((f) => f.column), [1, 2]);
  // The mark is for aircraft only.
  assert.ok(moveUnit(state, tank!, { column: 1, row: 0 }).ok);
});

test('one side moves while the other attacks, then they swap', () => {
  const { state } = game(['rrrrrrrrr'], [[0, 0, TANK, 0], [8, 0, TANK, 1]]);
  const [german, french] = state.units;
  assert.equal(cannotMoveReason(state, german!), null);
  assert.equal(cannotAttackReason(state, french!), null);
  assert.match(cannotMoveReason(state, french!)!, /attacks in this half/);
  assert.match(cannotAttackReason(state, german!)!, /moves in this half/);
  assert.ok(moveUnit(state, german!, { column: 1, row: 0 }).ok);

  assert.deepEqual(endHalf(state), { fights: [], captures: [], works: [], paid: { side: 0, points: 0 } });
  assert.deepEqual([state.round, state.mover, attackerSide(state)], [1, 1, 0]);
  assert.equal(cannotMoveReason(state, french!), null);
  assert.equal(cannotAttackReason(state, german!), null);
  assert.ok(moveUnit(state, french!, { column: 7, row: 0 }).ok);

  endHalf(state);
  assert.deepEqual([state.round, state.mover], [2, 0]);
  assert.deepEqual([german!.moved, french!.moved], [false, false]);
});

test('a unit can be ordered to attack an enemy in range, and the order can be changed', () => {
  const { state } = game(
    ['ppppppp'],
    [[1, 0, INFANTRY, 0], [2, 0, INFANTRY, 1], [4, 0, TANK, 0], [6, 0, ARTILLERY, 1]],
  );
  const [, french, , gun] = state.units;
  assert.deepEqual(attackTargets(state, french!), [{ column: 1, row: 0 }]);
  // The gun reaches columns 1 and 4 but nothing on the field next to it.
  assert.deepEqual(attackTargets(state, gun!), [{ column: 1, row: 0 }, { column: 4, row: 0 }]);

  const refused = (unit: typeof french, column: number) => {
    const result = orderAttack(state, unit!, { column, row: 0 });
    assert.ok(!result.ok);
    return result.reason;
  };
  assert.match(refused(french, 3), /no enemy unit/);
  assert.match(refused(french, 6), /no enemy unit/);
  assert.match(refused(french, 4), /cannot attack that unit/);
  assert.match(refused(state.units[0], 2), /moves in this half/);

  assert.ok(orderAttack(state, gun!, { column: 1, row: 0 }).ok);
  assert.ok(orderAttack(state, gun!, { column: 4, row: 0 }).ok);
  assert.deepEqual(orderOf(state, gun!), { column: 4, row: 0 });
  assert.equal(state.orders.length, 1);
  assert.equal(orderOf(state, french!), null);
});

test('a heavy gun that moved cannot fire in the next half, on either side', () => {
  const { state } = game(
    ['rrrrrrrrr', 'rrrrrrrrr'],
    [[0, 0, HEAVY_GUN, 0], [0, 1, HEAVY_GUN, 0], [1, 1, ARTILLERY, 0], [5, 0, HEAVY_GUN, 1], [5, 1, HEAVY_GUN, 1]],
  );
  const [moving, french, still, light, frenchStill] = state.units;
  const target = { column: 5, row: 0 };

  // The German side moves two guns; in the next half, when it attacks, only the heavy one must hold its fire.
  assert.ok(moveUnit(state, moving!, { column: 1, row: 0 }).ok);
  assert.ok(moveUnit(state, light!, { column: 2, row: 1 }).ok);
  endHalf(state);
  assert.match(cannotAttackReason(state, moving!)!, /moved in the last half/);
  assert.ok(!orderAttack(state, moving!, target).ok);
  assert.equal(cannotAttackReason(state, still!), null);
  assert.equal(cannotAttackReason(state, light!), null);

  // The French side moves a gun in the second half; the round ends, and it too sits out its side's attacks.
  assert.ok(moveUnit(state, french!, { column: 6, row: 0 }).ok);
  endHalf(state);
  assert.equal(state.round, 2);
  assert.match(cannotAttackReason(state, french!)!, /moved in the last half/);
  assert.equal(cannotAttackReason(state, frenchStill!), null);

  // A gun that stood still for a half fires again.
  endHalf(state);
  assert.equal(cannotAttackReason(state, moving!), null);
  endHalf(state);
  assert.equal(cannotAttackReason(state, french!), null);
});

test('attacks are carried out when the half ends, and both units learn from them', () => {
  const { state } = game(['ppp'], [[1, 0, INFANTRY, 0], [2, 0, INFANTRY, 1]]);
  const [german, french] = state.units;
  assert.ok(orderAttack(state, french!, { column: 1, row: 0 }).ok);
  const [report] = endHalf(state).fights;
  assert.deepEqual(
    [report!.attacker, report!.target, report!.attackerLosses, report!.targetLosses],
    [french, german, 1, 1],
  );
  assert.deepEqual([report!.targetLeft, report!.attackerLeft], [5, 5]);
  assert.deepEqual([german!.count, french!.count], [5, 5]);
  assert.deepEqual([german!.experience, french!.experience], [1, 1]);
  assert.deepEqual(state.orders, []);
});

test('an attack hits whatever enemy stands on the field by then, or nothing', () => {
  const { state } = game(['ppppp'], [[1, 0, INFANTRY, 0], [2, 0, INFANTRY, 1], [3, 0, TANK, 0]]);
  const [german, french, tank] = state.units;
  assert.ok(orderAttack(state, french!, { column: 1, row: 0 }).ok);
  // The German infantry steps away before the half ends.
  assert.ok(moveUnit(state, german!, { column: 0, row: 0 }).ok);
  const [missed] = endHalf(state).fights;
  assert.equal(missed!.target, null);
  assert.deepEqual([german!.count, french!.count], [6, 6]);

  // Next round: the same order, but this time the tank moves onto the field.
  endHalf(state);
  assert.ok(orderAttack(state, french!, { column: 3, row: 0 }).ok);
  assert.ok(moveUnit(state, tank!, { column: 4, row: 0 }).ok);
  assert.ok(moveUnit(state, german!, { column: 1, row: 0 }).ok);
  const [again] = endHalf(state).fights;
  assert.equal(again!.target, null);
});

test('a destroyed unit leaves the map, and a side with none left has lost', () => {
  const { state } = game(['ppp'], [[1, 0, INFANTRY, 0], [2, 0, INFANTRY, 1]]);
  const [german, french] = state.units;
  french!.experience = 6;
  german!.count = 2;
  assert.ok(orderAttack(state, french!, { column: 1, row: 0 }).ok);
  const [report] = endHalf(state).fights;
  assert.deepEqual([report!.targetLosses, report!.targetLeft], [2, 0]);
  assert.ok(german!.destroyed);
  assert.equal(unitAt(state, { column: 1, row: 0 }), null);
  assert.equal(state.map.units[1], NO_UNIT);
  assert.equal(state.winner, 1);
  assert.match(cannotMoveReason(state, french!)!, /over/);
});

// Tests of the ships that fill two fields: one unit that moves with its second
// half behind it and can be attacked on either field.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_UNIT } from '../src/formats/map.ts';
import {
  attackTargets,
  createGame,
  endHalf,
  moveUnit,
  orderAttack,
  rangeOf,
  unitAt,
  type GameState,
  type Unit,
} from '../src/game/state.ts';
import { makeMap, SHIP, SHIP_BACK, terrainTypes, unitTypes, type Placement } from './helpers.ts';

const SEA = ['wwwwww', 'wwwwww', 'wwwwww', 'wwwwww', 'wwwwww'];

function game(units: Placement[]) {
  return createGame(makeMap(SEA, units), unitTypes, terrainTypes);
}

const at = (state: GameState, column: number, row: number) => row * state.map.columns + column;

function on(state: GameState, column: number, row: number): Unit {
  const unit = unitAt(state, { column, row });
  assert.ok(unit, `no unit on ${column}, ${row}`);
  return unit;
}

test("a map's two halves make one ship, its second half behind the way its side faces", () => {
  // As the game's maps have them: both halves named, and a second half that belongs to no ship.
  const state = game([
    [1, 0, SHIP_BACK, 0],
    [1, 1, SHIP, 0],
    [4, 2, SHIP, 1],
    [4, 3, SHIP_BACK, 1],
    [0, 4, SHIP_BACK, 0],
  ]);
  assert.equal(state.units.length, 2);
  const [german, french] = state.units;
  assert.deepEqual([german!.type, german!.column, german!.row, german!.tail], [SHIP, 1, 1, { column: 1, row: 0 }]);
  assert.deepEqual([french!.type, french!.column, french!.row, french!.tail], [SHIP, 4, 2, { column: 4, row: 3 }]);
  assert.equal(unitAt(state, { column: 1, row: 0 }), german);
  assert.equal(unitAt(state, { column: 4, row: 3 }), french);
  assert.equal(unitAt(state, { column: 0, row: 4 }), null);
  assert.equal(state.map.units[at(state, 0, 4)], NO_UNIT);

  // A map that names only the first half gets the second one all the same.
  const bare = game([[1, 1, SHIP, 0], [4, 2, SHIP, 1]]);
  assert.deepEqual([...bare.map.units], [...state.map.units]);
  assert.equal(bare.map.units[at(bare, 1, 0)], SHIP_BACK * 2);
  assert.equal(bare.map.units[at(bare, 4, 3)], SHIP_BACK * 2 + 1);
});

test('a ship moves with its second half following, and cannot turn round on the spot', () => {
  const state = game([[1, 1, SHIP, 0], [5, 0, SHIP, 1]]);
  const ship = on(state, 1, 1);
  // Its own second half is in its way like any other unit.
  assert.equal(rangeOf(state, ship)!.remaining[at(state, 1, 0)], -1);
  const refused = moveUnit(state, ship, { column: 1, row: 0 });
  assert.ok(!refused.ok);
  assert.match(refused.reason, /already there/);

  // Two fields down the map: the second half ends on the field in between.
  const south = moveUnit(state, ship, { column: 1, row: 3 });
  assert.ok(south.ok);
  assert.deepEqual([ship.column, ship.row, ship.tail, ship.facing], [1, 3, { column: 1, row: 2 }, 3]);
  assert.equal(unitAt(state, { column: 1, row: 3 }), ship);
  assert.equal(unitAt(state, { column: 1, row: 2 }), ship);
  for (const row of [0, 1]) {
    assert.equal(unitAt(state, { column: 1, row }), null);
    assert.equal(state.map.units[at(state, 1, row)], NO_UNIT);
  }
  assert.equal(state.map.units[at(state, 1, 3)], SHIP * 2);
  assert.equal(state.map.units[at(state, 1, 2)], SHIP_BACK * 2);

  // One field to the side: the second half takes the field the first was on.
  endHalf(state);
  endHalf(state);
  assert.ok(moveUnit(state, ship, { column: 2, row: 3 }).ok);
  assert.deepEqual([ship.column, ship.row, ship.tail, ship.facing], [2, 3, { column: 1, row: 3 }, 1]);
  assert.equal(unitAt(state, { column: 1, row: 2 }), null);
});

test('a ship is attacked on either of its fields, and attacks from its first', () => {
  // The German ship has its first half on 1, 1 and its second on 1, 0. One
  // French ship's first half touches only the second; the other's touches the first.
  const state = game([[2, 0, SHIP, 1], [1, 1, SHIP, 0], [2, 2, SHIP, 1]]);
  const german = on(state, 1, 1);
  const behind = on(state, 2, 0);
  const beside = on(state, 2, 2);
  assert.deepEqual(behind.tail, { column: 2, row: 1 });
  assert.deepEqual(attackTargets(state, behind), [{ column: 1, row: 0 }]);
  assert.deepEqual(attackTargets(state, beside), [{ column: 1, row: 1 }]);
  // The German ship's reach is counted from its first half: it takes in the
  // second half of the ship behind it, but not that ship's first.
  assert.deepEqual(attackTargets(state, german), [
    { column: 2, row: 1 },
    { column: 2, row: 2 },
  ]);

  assert.ok(orderAttack(state, behind, { column: 1, row: 0 }).ok);
  assert.ok(orderAttack(state, beside, { column: 1, row: 1 }).ok);
  const [onTail, onHead] = endHalf(state).fights;
  assert.equal(onTail!.target, german);
  assert.ok(onTail!.targetLosses >= 1 && onTail!.attackerLosses >= 1, 'both ships are hit: the field aimed at is next door');
  // Units around a fight count only when the two first halves are neighbours.
  assert.equal(onTail!.flank, 0);
  assert.equal(onHead!.target, german);
  assert.equal(onHead!.flank, 25);
  assert.equal(german.count, 6 - onTail!.targetLosses - onHead!.targetLosses);
});

test('a ship that is destroyed leaves both its fields', () => {
  const state = game([[1, 1, SHIP, 0], [2, 2, SHIP, 1], [5, 4, SHIP, 0]]);
  const german = on(state, 1, 1);
  const french = on(state, 2, 2);
  german.count = 1;
  french.experience = 6;
  assert.ok(orderAttack(state, french, { column: 1, row: 1 }).ok);
  endHalf(state);
  assert.ok(german.destroyed);
  for (const row of [0, 1]) {
    assert.equal(unitAt(state, { column: 1, row }), null);
    assert.equal(state.map.units[at(state, 1, row)], NO_UNIT);
  }
  assert.equal(state.winner, null);
});

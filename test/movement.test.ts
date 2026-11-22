// Tests of the movement rule on small hand-made maps.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directionTo, moveRange, neighbours, pathTo } from '../src/game/movement.ts';
import {
  BALLOON,
  INFANTRY,
  makeMap,
  mover,
  PLANE,
  SHIP,
  TANK,
  terrainTypes,
  TRUCK,
  unitTypes,
  type Placement,
} from './helpers.ts';

/** The range of the unit at column 0 of a one-row map, as a plain list. */
function rangeAlong(row: string, units: Placement[]): number[] {
  const map = makeMap([row], units);
  return [...moveRange(map, { column: 0, row: 0 }, unitTypes, terrainTypes)!.remaining];
}

test('neighbours go clockwise from above and odd columns reach a row further down', () => {
  const map = makeMap(['ppppp', 'ppppp', 'ppppp', 'ppppp', 'ppppp'], []);
  const list = (column: number, row: number) => neighbours({ column, row }, map).map((f) => [f.column, f.row]);
  assert.deepEqual(list(2, 2), [[2, 1], [3, 1], [3, 2], [2, 3], [1, 2], [1, 1]]);
  assert.deepEqual(list(1, 2), [[1, 1], [2, 2], [2, 3], [1, 3], [0, 3], [0, 2]]);
  assert.deepEqual(list(0, 0), [[1, 0], [0, 1]]);
});

test('the direction of a step is its place in that clockwise order', () => {
  assert.equal(directionTo({ column: 2, row: 2 }, { column: 2, row: 1 }), 0);
  assert.equal(directionTo({ column: 2, row: 2 }, { column: 3, row: 2 }), 2);
  assert.equal(directionTo({ column: 1, row: 2 }, { column: 0, row: 3 }), 4);
  assert.equal(directionTo({ column: 2, row: 2 }, { column: 4, row: 2 }), -1);
});

test('a unit moves until its budget no longer covers the next field', () => {
  assert.deepEqual(rangeAlong('rrrrrrr', [[0, 0, TANK, 0]]), [16, 12, 8, 4, 0, -1, -1]);
  assert.deepEqual(rangeAlong('rrppppp', [[0, 0, TANK, 0]]), [16, 12, 6, 0, -1, -1, -1]);
});

test("terrain outside the unit's mask stops it", () => {
  assert.deepEqual(rangeAlong('rrfrr', [[0, 0, TANK, 0]]), [16, 12, -1, -1, -1]);
  assert.deepEqual(rangeAlong('rrfrr', [[0, 0, INFANTRY, 0]]), [12, 8, 1, -1, -1]);
  assert.deepEqual(rangeAlong('rxr', [[0, 0, PLANE, 0]]), [14, -1, -1]);
});

test('aircraft pay the air cost', () => {
  assert.deepEqual(rangeAlong('pfwpfwpfw', [[0, 0, PLANE, 0]]), [14, 12, 10, 8, 6, 4, 2, 0, -1]);
});

test('an enemy closes its field, and the fields beside it end the move', () => {
  // Column 3 is beside the enemy on column 4: reached with nothing left.
  assert.deepEqual(
    rangeAlong('rrrrrrr', [[0, 0, TANK, 0], [4, 0, TANK, 1]]),
    [16, 12, 8, 0, -1, -1, -1],
  );
  // Such a field can be entered even when the budget does not cover it.
  const slow = [...unitTypes];
  slow[TANK] = mover({ movementBudget: 5 });
  const map = makeMap(['ppp'], [[0, 0, TANK, 0], [2, 0, TANK, 1]]);
  assert.deepEqual([...moveRange(map, { column: 0, row: 0 }, slow, terrainTypes)!.remaining], [5, 0, -1]);
});

test('friendly units can be passed, and a friendly transport is cheap to reach', () => {
  assert.deepEqual(rangeAlong('pppp', [[0, 0, TANK, 0], [1, 0, TANK, 0]]), [16, 10, 4, -1]);
  assert.deepEqual(rangeAlong('pppp', [[0, 0, TANK, 0], [1, 0, TRUCK, 0]]), [16, 14, 8, 2]);
});

test('a two-field ship cannot pass through any unit', () => {
  assert.deepEqual(rangeAlong('wwwwww', [[0, 0, SHIP, 0]]), [30, 24, 18, 12, 6, 0]);
  assert.deepEqual(rangeAlong('wwwwww', [[0, 0, SHIP, 0], [2, 0, SHIP, 0]]), [30, 24, -1, -1, -1, -1]);
});

test('building entrances are closed to the other side unless the unit may use any', () => {
  assert.deepEqual(rangeAlong('rGr', [[0, 0, TANK, 0]]), [16, 12, 8]);
  assert.deepEqual(rangeAlong('rGr', [[0, 0, TANK, 1]]), [16, -1, -1]);
  assert.deepEqual(rangeAlong('rNr', [[0, 0, TANK, 0]]), [16, -1, -1]);
  assert.deepEqual(rangeAlong('rNr', [[0, 0, INFANTRY, 1]]), [12, 8, 4]);
});

test('a unit with a flat cost pays 2 for any field', () => {
  assert.deepEqual(rangeAlong('ppp', [[0, 0, BALLOON, 0]]), [2, 0, -1]);
});

test('an empty field has no range', () => {
  const map = makeMap(['pp'], []);
  assert.equal(moveRange(map, { column: 0, row: 0 }, unitTypes, terrainTypes), null);
});

test('the path to a field takes the cheaper way round', () => {
  // A road runs along the top row; the way along the bottom is forest the
  // tank cannot enter. From an even column, the next column's upper field is
  // a neighbour, so the tank steps straight onto the road.
  const map = makeMap(['rrrr', 'pffp'], [[0, 1, TANK, 0]]);
  const range = moveRange(map, { column: 0, row: 1 }, unitTypes, terrainTypes)!;
  const path = pathTo(range, map, { column: 3, row: 0 }).map((f) => [f.column, f.row]);
  assert.deepEqual(path, [[1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(pathTo(range, map, { column: 0, row: 1 }), []);
  assert.deepEqual(pathTo(range, map, { column: 1, row: 1 }), []);
});

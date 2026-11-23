// Tests of saving a battle and taking it up again.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Shop } from '../src/formats/shops.ts';
import { HISTORYLINE_RULES } from '../src/game/rules.ts';
import { restoreGame, SAVE_VERSION, saveGame, type SavedGame } from '../src/game/save.ts';
import {
  buildingAt,
  createGame,
  endHalf,
  moveUnit,
  orderAttack,
  orderWork,
  unitAt,
  workOf,
  type GameState,
  type Unit,
} from '../src/game/state.ts';
import {
  BUNKER,
  INFANTRY,
  makeMap,
  SHIP,
  SHIP_BACK,
  TANK,
  terrainTypes,
  TRUCK,
  unitTypes,
  type Placement,
} from './helpers.ts';

const PREPARED_GROUND = HISTORYLINE_RULES.preparedGround;
const DEPOT = 2;

function on(state: GameState, column: number, row: number): Unit {
  const unit = unitAt(state, { column, row });
  assert.ok(unit, `no unit on ${column}, ${row}`);
  return unit;
}

/** A save as it comes back from being written out as text. */
function written(state: GameState): SavedGame {
  return JSON.parse(JSON.stringify(saveGame(state))) as SavedGame;
}

function restored(state: GameState, types = unitTypes): GameState {
  return restoreGame(written(state), types, terrainTypes);
}

test('a battle saved in the middle of a half is taken up as it was left', () => {
  const units: Placement[] = [
    [0, 0, INFANTRY, 0],
    [1, 0, TRUCK, 0],
    [7, 0, INFANTRY, 0],
    [8, 0, TANK, 1],
    [1, 4, SHIP, 0],
    [8, 4, SHIP, 1],
  ];
  const depot: Shop = { owner: 0, kind: DEPOT, index: 0, resources: 7, worth: 12, contents: [TANK, INFANTRY] };
  const rows = ['rrrrrrrrrr', 'rrrrGrrrrr', 'pppppppppp', 'wwwwwwwwww', 'wwwwwwwwww', 'wwwwwwwwww'];
  const state = createGame(makeMap(rows, units), unitTypes, terrainTypes, { shops: [depot], buildable: [TANK] });
  // The German side moves: infantry into the truck, the truck on, the ship down the map.
  assert.ok(moveUnit(state, on(state, 0, 0), { column: 1, row: 0 }).ok);
  assert.ok(moveUnit(state, on(state, 1, 0), { column: 3, row: 0 }).ok);
  assert.ok(moveUnit(state, on(state, 1, 4), { column: 2, row: 4 }).ok);
  // The French side orders an attack.
  assert.ok(orderAttack(state, on(state, 8, 0), { column: 7, row: 0 }).ok);
  state.points = [40, 15];

  const saved = written(state);
  assert.equal(saved.version, SAVE_VERSION);
  const again = restoreGame(saved, unitTypes, terrainTypes);
  // Nothing of the one is part of the other.
  assert.notEqual(again.map.terrain, state.map.terrain);
  assert.ok(again.units.every((unit) => !state.units.includes(unit)));

  assert.deepEqual(saveGame(again), saved);
  assert.deepEqual([...again.map.units], [...state.map.units]);
  assert.deepEqual([...again.unitIndex], [...state.unitIndex]);
  assert.deepEqual([...again.buildingIndex], [...state.buildingIndex]);
  assert.deepEqual([again.round, again.mover, again.points, again.buildable], [1, 0, [40, 15], [TANK]]);

  // The truck with its load, the ship in two halves, the depot with its units.
  const truck = on(again, 3, 0);
  assert.deepEqual([truck.type, truck.moved, truck.cargo.length], [TRUCK, true, 1]);
  assert.deepEqual([truck.cargo[0]!.type, truck.cargo[0]!.inside === truck], [INFANTRY, true]);
  const ship = on(again, 2, 4);
  assert.equal(unitAt(again, ship.tail!), ship);
  assert.equal(again.map.units[ship.tail!.row * 10 + ship.tail!.column], SHIP_BACK * 2);
  const building = buildingAt(again, { column: 4, row: 2 })!;
  assert.deepEqual([building.kind, building.owner, building.resources], ['depot', 0, 7]);
  assert.deepEqual(building.units.map((unit) => [unit.type, unit.inside === building]), [[TANK, true], [INFANTRY, true]]);
  assert.equal(again.orders[0]!.attacker, on(again, 8, 0));

  // Played on, the two stay the same battle.
  for (let half = 0; half < 3; half++) {
    const [here, there] = [endHalf(state), endHalf(again)];
    assert.equal(there.fights.length, here.fights.length);
    assert.deepEqual(there.fights.map((fight) => fight.targetLosses), here.fights.map((fight) => fight.targetLosses));
    assert.deepEqual(there.paid, here.paid);
    assert.deepEqual(saveGame(again), saveGame(state));
  }
});

test('work ordered on the ground is saved with the battle', () => {
  // Here a tank is the construction unit.
  const types = [...unitTypes];
  types[TANK] = { ...types[TANK]!, buildsDepots: true };
  const rows = ['ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'rrrrrrr'];
  const state = createGame(makeMap(rows, [[3, 1, TANK, 0], [6, 5, BUNKER, 1]]), types, terrainTypes);
  endHalf(state);
  assert.ok(orderWork(state, on(state, 3, 1), { column: 3, row: 2 }).ok);

  const again = restored(state, types);
  const builder = on(again, 3, 1);
  assert.deepEqual(workOf(again, builder), { unit: builder, target: { column: 3, row: 2 }, work: 'prepare' });
  const [report] = endHalf(again).works;
  assert.ok(report!.done);
  assert.equal(again.map.terrain[2 * 7 + 3], PREPARED_GROUND[0]);
  assert.equal(builder.supplies, 1);
  // The battle it was saved from has not moved on.
  assert.equal(state.map.terrain[2 * 7 + 3], state.map.terrain[0]);

  // Ground that has changed is saved as it is.
  const later = restored(again, types);
  assert.deepEqual([...later.map.terrain], [...again.map.terrain]);
  assert.equal(on(later, 3, 1).supplies, 1);
});

test('destroyed units are left out of a save, and the others keep what they hold', () => {
  const state = createGame(
    makeMap(['pppppp'], [[0, 0, BUNKER, 0], [1, 0, INFANTRY, 0], [2, 0, INFANTRY, 1], [4, 0, TRUCK, 1], [5, 0, INFANTRY, 1]]),
    unitTypes,
    terrainTypes,
  );
  const victim = on(state, 1, 0);
  victim.count = 2;
  on(state, 2, 0).experience = 6;
  assert.ok(orderAttack(state, on(state, 2, 0), { column: 1, row: 0 }).ok);
  endHalf(state);
  assert.ok(victim.destroyed);
  // The French side moves: infantry into the truck.
  assert.ok(moveUnit(state, on(state, 5, 0), { column: 4, row: 0 }).ok);

  const saved = written(state);
  assert.deepEqual(saved.units.map((unit) => unit.type), [BUNKER, INFANTRY, TRUCK, INFANTRY]);
  assert.deepEqual(saved.units[2]!.cargo, [3]);
  const again = restoreGame(saved, unitTypes, terrainTypes);
  assert.equal(again.units.length, 4);
  assert.equal(unitAt(again, { column: 1, row: 0 }), null);
  const truck = on(again, 4, 0);
  assert.deepEqual(truck.cargo.map((unit) => [unit.type, unit.side, unit.moved]), [[INFANTRY, 1, true]]);
  assert.deepEqual([again.round, again.mover, again.winner], [1, 1, null]);

  // A battle that is over is saved as over.
  const over = createGame(makeMap(['ppp'], [[1, 0, INFANTRY, 0], [2, 0, INFANTRY, 1]]), unitTypes, terrainTypes);
  on(over, 1, 0).count = 2;
  on(over, 2, 0).experience = 6;
  assert.ok(orderAttack(over, on(over, 2, 0), { column: 1, row: 0 }).ok);
  endHalf(over);
  const ended = restored(over);
  assert.deepEqual([ended.winner, ended.wonBy, ended.units.length], [1, 'units', 1]);
});

test('a save that does not fit is refused with the reason', () => {
  const state = createGame(
    makeMap(['rrr', 'www', 'www'], [[0, 0, TRUCK, 0], [1, 1, SHIP, 1]]),
    unitTypes,
    terrainTypes,
  );
  const refused = (change: (saved: SavedGame) => unknown): Error => {
    const saved = written(state);
    change(saved);
    try {
      restoreGame(saved, unitTypes, terrainTypes);
    } catch (error) {
      return error as Error;
    }
    return assert.fail('the save was taken');
  };
  assert.match(refused((saved) => (saved.version = 2)).message, /version 2/);
  assert.match(refused((saved) => saved.terrain.pop()).message, /does not fit a map of 3 by 3/);
  assert.match(refused((saved) => (saved.units[0]!.type = 99)).message, /kind 99/);
  assert.match(refused((saved) => saved.units[0]!.cargo.push(50)).message, /names unit 50/);
  assert.match(refused((saved) => saved.units[0]!.cargo.push(0)).message, /inside two things/);
  assert.match(refused((saved) => (saved.units[1]!.tail = { column: 1, row: 3 })).message, /not on its map/);
  // The ship put on the truck's field.
  assert.match(refused((saved) => Object.assign(saved.units[1]!, { column: 0, row: 0 })).message, /two of its units/);
  // Unchanged, it is taken.
  assert.equal(restored(state).units.length, 2);
});

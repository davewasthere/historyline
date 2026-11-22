// Tests of the computer's player.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeComputerTable,
  FIRES_FROM_AFAR,
  IS_BUILT,
  IS_CARRIER,
  TAKES_BUILDINGS,
} from '../src/formats/computerTable.ts';
import type { Shop } from '../src/formats/shops.ts';
import { distance } from '../src/game/combat.ts';
import { BUILD_RESERVE, computerPlay, derivedKind, REPAIR_RESERVE } from '../src/game/computer.ts';
import {
  buildingAt,
  createGame,
  endHalf,
  TAKEN_BUILDING_WORTH,
  unitAt,
  type GameState,
  type Unit,
} from '../src/game/state.ts';
import {
  ARTILLERY,
  BALLOON,
  BUNKER,
  INFANTRY,
  makeMap,
  TANK,
  terrainTypes,
  TRUCK,
  unitTypes,
  type Placement,
} from './helpers.ts';

const ROADS = (columns: number, rows = 5) => Array<string>(rows).fill('r'.repeat(columns));

function game(rows: string[], units: Placement[], shops: Shop[] = []) {
  return createGame(makeMap(rows, units), unitTypes, terrainTypes, { shops });
}

function on(state: GameState, column: number, row: number): Unit {
  const unit = unitAt(state, { column, row });
  assert.ok(unit, `no unit on ${column}, ${row}`);
  return unit;
}

test('the computer table gives each kind a worth and its uses', () => {
  const table = decodeComputerTable(new Uint8Array([70, 1, 0x01, 0x04, 0, 0, 0xf6, 5, 0x00, 0x02, 2, 0]));
  assert.deepEqual(table, [
    { worth: 70, flags: 0x401, escorts: 0 },
    { worth: -10, flags: 0x200, escorts: 2 },
  ]);
  assert.ok(table[0]!.flags & TAKES_BUILDINGS && table[0]!.flags & IS_BUILT && table[1]!.flags & IS_CARRIER);
  assert.throws(() => decodeComputerTable(new Uint8Array(7)), /multiple of 6/);
});

test('without a table, what a kind is to the computer is read off the unit table', () => {
  const flags = (type: number) => derivedKind(unitTypes[type]!).flags;
  assert.equal(flags(INFANTRY), TAKES_BUILDINGS | IS_BUILT);
  assert.equal(flags(TANK), IS_BUILT);
  assert.equal(flags(ARTILLERY), FIRES_FROM_AFAR | IS_BUILT);
  assert.equal(flags(TRUCK), IS_CARRIER);
  assert.equal(flags(BALLOON), 0);
});

test('the nearest unit that takes buildings goes for a building, and the others march on the enemy', () => {
  const state = game(
    ['rrrrrrrrr', 'rrrrNrrrr', 'rrrrrrrrr'],
    [[0, 0, INFANTRY, 0], [1, 1, INFANTRY, 0], [8, 2, BUNKER, 1]],
  );
  const [far, near, bunker] = [on(state, 0, 0), on(state, 1, 1), on(state, 8, 2)];
  const before = distance(far, bunker);
  const turn = computerPlay(state, 0);
  assert.deepEqual([turn.side, turn.attacks, turn.built, turn.repaired], [0, [], [], []]);
  assert.deepEqual(
    turn.moves.map(({ unit, to, arrival }) => [unit, to, arrival]),
    [
      [near, { column: 4, row: 1 }, 'taking'],
      [far, { column: far.column, row: far.row }, 'field'],
    ],
  );
  assert.ok(distance(far, bunker) < before, 'the other infantry did not come nearer');
  // Every unit has had its move: a second call finds nothing to do.
  assert.deepEqual(computerPlay(state, 0).moves, []);

  const depot = buildingAt(state, { column: 4, row: 1 })!;
  const { captures } = endHalf(state);
  assert.equal(captures.length, 1);
  assert.deepEqual([depot.owner, depot.worth, near.inside === depot], [0, TAKEN_BUILDING_WORTH, true]);
});

test('a unit is sent beside the enemy unit it can fight, and attacks it in the next half', () => {
  const state = game(ROADS(7), [[0, 2, TANK, 0], [4, 2, TANK, 1]]);
  const [german, french] = [on(state, 0, 2), on(state, 4, 2)];
  // In the half its side attacks the computer moves nothing, and has nothing in range yet.
  assert.deepEqual(computerPlay(state, 1), { side: 1, moves: [], attacks: [], repaired: [], built: [] });
  const moving = computerPlay(state, 0);
  assert.equal(moving.moves.length, 1);
  assert.equal(distance(german, french), 1);
  endHalf(state);

  // Now the German side attacks. The French tank, beside its enemy already, stays to fight.
  const orders = computerPlay(state, 0);
  assert.deepEqual(orders.moves, []);
  assert.deepEqual(orders.attacks, [{ unit: german, target: { column: 4, row: 2 } }]);
  assert.equal(state.orders.length, 1);
  assert.deepEqual(computerPlay(state, 1).moves, []);
  const [fight] = endHalf(state).fights;
  assert.equal(fight!.target, french);
  assert.ok(fight!.targetLosses > 0);
});

test('a unit that fires from afar stops when its target is in range, and stays there', () => {
  const state = game(ROADS(9), [[0, 2, ARTILLERY, 0], [6, 2, BUNKER, 1]]);
  const [gun, bunker] = [on(state, 0, 2), on(state, 6, 2)];
  assert.equal(distance(gun, bunker), 6);
  assert.equal(computerPlay(state, 0).moves.length, 1);
  assert.equal(distance(gun, bunker), 5);
  endHalf(state);
  assert.deepEqual(computerPlay(state, 0).attacks, [{ unit: gun, target: { column: 6, row: 2 } }]);
  endHalf(state);
  // The next round it has something in range and does not move.
  assert.deepEqual(computerPlay(state, 0).moves, []);
});

test('each unit attacks what is worth most in its range, the guns giving their orders first', () => {
  // A French tank and a French supply car beside the German tank; the tank is in the gun's range.
  const state = game(ROADS(8), [[0, 2, ARTILLERY, 0], [4, 2, TANK, 0], [5, 2, TANK, 1], [5, 1, TRUCK, 1]]);
  endHalf(state);
  const { attacks } = computerPlay(state, 0);
  assert.deepEqual(attacks.map(({ unit }) => unit.type), [ARTILLERY, TANK]);
  // The supply car has no weapon at all, which makes it worth more than the tank.
  assert.deepEqual(attacks[1]!.target, { column: 5, row: 1 });
  assert.deepEqual(state.orders.map((order) => order.attacker.type), [ARTILLERY, TANK]);
});

test('in the half it attacks the computer repairs what is inside its buildings and fills its factories', () => {
  const depot: Shop = { owner: 0, kind: 2, index: 0, resources: 0, worth: 10, contents: [TANK] };
  const state = game(
    ['rrrrrrrrr', 'rZrrGrrrr', 'rrrrrrrrr', 'rrrrrrrrr', 'rrrrrrrrr'],
    [[8, 4, BUNKER, 1]],
    [depot],
  );
  const [factory, shelter] = state.buildings;
  const tank = shelter!.units[0]!;
  tank.count = 3;
  state.points = [200, 0];
  // A unit short of vehicles waits inside for its repair.
  assert.deepEqual(computerPlay(state, 0).moves, []);
  endHalf(state);

  const turn = computerPlay(state, 0, { random: () => 0 });
  assert.deepEqual(turn.repaired, [tank]);
  assert.equal(tank.count, 6);
  // 185 points after the repair: two tanks at 60 each leave 65, and a third would leave less than the reserve.
  assert.deepEqual(turn.built.map((unit) => [unit.type, unit.side, unit.inside === factory]), [
    [TANK, 0, true],
    [TANK, 0, true],
  ]);
  assert.equal(state.points[0], 65);
  assert.ok(state.points[0] > BUILD_RESERVE && BUILD_RESERVE > REPAIR_RESERVE);

  // Repaired, the tank comes out when its side next moves.
  endHalf(state);
  const out = computerPlay(state, 0).moves.map(({ unit }) => unit);
  assert.ok(out.includes(tank));
  assert.equal(tank.inside, null);
});

test('the computer does nothing once the battle is over', () => {
  const state = game(ROADS(5), [[0, 2, TANK, 0], [4, 2, TANK, 1]]);
  state.winner = 1;
  assert.deepEqual(computerPlay(state, 0).moves, []);
  assert.deepEqual(computerPlay(state, 1).attacks, []);
});

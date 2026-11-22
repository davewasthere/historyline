// Tests of buildings and transports: what they hold when a map starts, units
// going in and out, and buildings changing hands.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_UNIT } from '../src/formats/map.ts';
import type { Shop } from '../src/formats/shops.ts';
import { moveRange } from '../src/game/movement.ts';
import {
  attackTargets,
  buildingAt,
  cannotAttackReason,
  cannotMoveReason,
  createGame,
  endHalf,
  moveUnit,
  orderAttack,
  rangeOf,
  unitAt,
  type GameState,
  type Unit,
} from '../src/game/state.ts';
import {
  ARTILLERY,
  BUNKER,
  BY_TRUCK,
  INFANTRY,
  makeMap,
  TANK,
  terrainOf,
  terrainTypes,
  TRAIN,
  TRUCK,
  unitTypes,
  type Placement,
} from './helpers.ts';

const HEADQUARTERS = 0;
const DEPOT = 2;
const TRANSPORT = 3;
const NOBODY = 2;

function shop(owner: number, kind: number, index: number, contents: number[], resources = 0): Shop {
  return { owner, kind, index, resources, worth: 0, contents };
}

function game(rows: string[], units: Placement[], shops: Shop[] = [], types = unitTypes) {
  return createGame(makeMap(rows, units), types, terrainTypes, { shops });
}

const at = (state: GameState, column: number, row: number) => row * state.map.columns + column;

function refused(state: GameState, unit: Unit, column: number, row: number): string {
  const result = moveUnit(state, unit, { column, row });
  assert.ok(!result.ok, 'the move was allowed');
  return result.reason;
}

/** The unit standing on a field. Units are made as the map is read, row by row, so this is the sure way to name one. */
function on(state: GameState, column: number, row: number): Unit {
  const unit = unitAt(state, { column, row });
  assert.ok(unit, `no unit on ${column}, ${row}`);
  return unit;
}

/** Plays on to the start of the next round. */
function nextRound(state: GameState): void {
  const round = state.round;
  while (state.round === round) endHalf(state);
}

test("a map's records put units into its buildings and transports", () => {
  const state = game(
    ['rrrrrrr', 'rNrrGrr', 'rrrrrKh'],
    [[0, 0, TRUCK, 0]],
    [
      shop(NOBODY, DEPOT, 0, [INFANTRY, TANK], 5),
      shop(0, DEPOT, 1, [TRUCK], 7),
      // Transports are numbered as the map is read, then as the records make them.
      shop(0, TRANSPORT, 1, [INFANTRY]),
      shop(1, HEADQUARTERS, 1, [TANK]),
      shop(0, DEPOT, 9, [TANK]),
    ],
  );
  const [nobodys, german, french] = state.buildings;
  assert.deepEqual(
    state.buildings.map(({ kind, owner, entrance, resources }) => ({ kind, owner, entrance, resources })),
    [
      { kind: 'depot', owner: null, entrance: { column: 1, row: 1 }, resources: 5 },
      { kind: 'depot', owner: 0, entrance: { column: 4, row: 1 }, resources: 7 },
      { kind: 'headquarters', owner: 1, entrance: { column: 5, row: 2 }, resources: 0 },
    ],
  );
  assert.deepEqual(nobodys!.units.map((unit) => [unit.type, unit.side, unit.column, unit.row]), [
    [INFANTRY, null, 1, 1],
    [TANK, null, 1, 1],
  ]);
  const truck = german!.units[0]!;
  assert.deepEqual([truck.type, truck.side, truck.inside === german], [TRUCK, 0, true]);
  assert.deepEqual(truck.cargo.map((unit) => [unit.type, unit.side, unit.inside === truck]), [[INFANTRY, 0, true]]);
  assert.deepEqual(french!.units.map((unit) => [unit.type, unit.side]), [[TANK, 1]]);
  // The record for a depot the map does not have is passed over.
  assert.equal(state.units.length, 6);

  // Units inside stand on no field.
  assert.equal(unitAt(state, { column: 1, row: 1 }), null);
  assert.equal(state.map.units[at(state, 1, 1)], NO_UNIT);
  // A depot covers its entrance and the three fields below it; a headquarters the fields marked as its own.
  for (const [column, row] of [[1, 1], [0, 2], [1, 2], [2, 2]] as const) {
    assert.equal(buildingAt(state, { column, row }), nobodys, `field ${column}, ${row}`);
  }
  assert.equal(buildingAt(state, { column: 6, row: 2 }), french);
  assert.equal(buildingAt(state, { column: 3, row: 0 }), null);
});

test('a unit boards a transport, rides along and gets out with a short move', () => {
  const state = game(
    ['rrrrrrrrrrrr', 'pppppppppppp'],
    [[0, 0, INFANTRY, 0], [1, 0, TRUCK, 0], [6, 1, INFANTRY, 0], [11, 1, BUNKER, 1]],
  );
  const [infantry, truck, late] = state.units;
  const boarding = moveUnit(state, infantry!, { column: 1, row: 0 });
  assert.ok(boarding.ok);
  assert.equal(boarding.arrival, 'loaded');
  assert.deepEqual([infantry!.inside === truck, truck!.cargo.length, infantry!.column], [true, 1, 1]);
  assert.equal(unitAt(state, { column: 0, row: 0 }), null);
  assert.equal(unitAt(state, { column: 1, row: 0 }), truck);
  assert.equal(state.map.units[at(state, 0, 0)], NO_UNIT);
  // It cannot get out again in the half it went in.
  assert.match(cannotMoveReason(state, infantry!)!, /already moved/);

  // The transport takes it along, and takes on nobody once it has moved.
  assert.ok(moveUnit(state, truck!, { column: 5, row: 0 }).ok);
  assert.deepEqual([infantry!.column, infantry!.row], [5, 0]);
  assert.match(refused(state, late!, 5, 0), /already moved this round; units board before/);

  // Next round the transport moves first and the unit gets out afterwards: two roads at most.
  nextRound(state);
  assert.ok(moveUnit(state, truck!, { column: 3, row: 0 }).ok);
  const range = rangeOf(state, infantry!)!;
  assert.deepEqual([...range.remaining.subarray(0, 6)], [-1, 0, 4, 8, 4, 0]);
  assert.match(refused(state, infantry!, 0, 0), /out of reach/);
  assert.match(refused(state, infantry!, 3, 0), /already there/);
  const leaving = moveUnit(state, infantry!, { column: 1, row: 0 });
  assert.ok(leaving.ok);
  assert.equal(leaving.arrival, 'field');
  assert.deepEqual([infantry!.inside, truck!.cargo.length, infantry!.moved], [null, 0, true]);
  assert.equal(unitAt(state, { column: 1, row: 0 }), infantry);
  assert.equal(unitAt(state, { column: 3, row: 0 }), truck);
  assert.equal(state.map.units[at(state, 1, 0)], INFANTRY * 2);
});

test('a transport takes only what it carries, up to its capacity and seven units', () => {
  // Guns a truck carries, four to the load; a truck holds nine.
  const types = [...unitTypes];
  types[ARTILLERY] = { ...types[ARTILLERY]!, weight: 4, loadClasses: BY_TRUCK };
  const loaded = game(
    ['rrrrrrrrr'],
    [[0, 0, ARTILLERY, 0], [1, 0, ARTILLERY, 0], [2, 0, TRUCK, 0], [3, 0, ARTILLERY, 0], [4, 0, TANK, 0], [8, 0, BUNKER, 1]],
    [],
    types,
  );
  const [far, near, truck, other, tank] = loaded.units;
  assert.match(refused(loaded, tank!, 2, 0), /does not carry/);
  assert.ok(moveUnit(loaded, near!, { column: 2, row: 0 }).ok);
  assert.ok(moveUnit(loaded, other!, { column: 2, row: 0 }).ok);
  assert.match(refused(loaded, far!, 2, 0), /no room/);
  assert.deepEqual(truck!.cargo, [near, other]);

  const full = game(
    ['rrrrrrrrr'],
    [[1, 0, INFANTRY, 0], [2, 0, TRUCK, 0], [8, 0, BUNKER, 1]],
    [shop(0, TRANSPORT, 0, Array(7).fill(INFANTRY))],
  );
  assert.equal(full.units[1]!.cargo.length, 7);
  assert.match(refused(full, full.units[0]!, 2, 0), /no room/);
});

test('a unit reaches a train on rails it cannot walk on, and a loaded truck hands its load over', () => {
  const rows = ['rrsrrrrrr'];
  // Without the train the rails stop the infantry.
  const bare = makeMap(rows, [[0, 0, INFANTRY, 0]]);
  assert.equal(moveRange(bare, { column: 0, row: 0 }, unitTypes, terrainTypes)!.remaining[2], -1);

  const state = game(
    rows,
    [[0, 0, INFANTRY, 0], [1, 0, TRUCK, 0], [2, 0, TRAIN, 0], [8, 0, BUNKER, 1]],
    [shop(0, TRANSPORT, 0, [INFANTRY])],
  );
  const [walker, truck, train] = state.units;
  const rider = truck!.cargo[0]!;
  assert.ok(moveUnit(state, walker!, { column: 2, row: 0 }).ok);
  assert.ok(moveUnit(state, truck!, { column: 2, row: 0 }).ok);
  assert.deepEqual(train!.cargo, [walker, truck, rider]);
  assert.deepEqual([truck!.cargo.length, rider.inside === train], [0, true]);
  assert.equal(unitAt(state, { column: 1, row: 0 }), null);
});

test("a unit goes into its own side's building and comes out by the entrance", () => {
  const state = game(['rrrrrrrrr', 'rrGrrrrrr', 'rrrrrrrrr'], [[0, 1, TANK, 0], [8, 0, BUNKER, 1]]);
  const tank = on(state, 0, 1);
  const depot = state.buildings[0]!;
  const entering = moveUnit(state, tank, { column: 2, row: 1 });
  assert.ok(entering.ok);
  assert.equal(entering.arrival, 'entered');
  assert.deepEqual([depot.units, tank.inside === depot], [[tank], true]);
  assert.equal(unitAt(state, { column: 2, row: 1 }), null);
  assert.match(cannotMoveReason(state, tank)!, /already moved/);

  nextRound(state);
  assert.match(refused(state, tank, 5, 1), /out of reach/);
  assert.ok(moveUnit(state, tank, { column: 4, row: 1 }).ok);
  assert.deepEqual([depot.units.length, tank.inside], [0, null]);
  assert.equal(unitAt(state, { column: 4, row: 1 }), tank);
});

test('a full building takes no more, and a unit leaving one cannot go straight into a building not its own', () => {
  const full = game(
    ['rrrrrrrrr', 'rrGrrrrrr'],
    [[0, 1, TANK, 0], [8, 0, BUNKER, 1]],
    [shop(0, DEPOT, 0, Array(7).fill(INFANTRY))],
  );
  assert.match(refused(full, on(full, 0, 1), 2, 1), /full/);

  const state = game(
    ['rrrrr', 'rGNrr'],
    [[3, 1, INFANTRY, 0], [4, 0, BUNKER, 1]],
    [shop(0, DEPOT, 0, [INFANTRY])],
  );
  const outside = on(state, 3, 1);
  const inside = state.buildings[0]!.units[0]!;
  const nobodys = at(state, 2, 1);
  assert.equal(rangeOf(state, outside)!.remaining[nobodys], 8);
  assert.equal(rangeOf(state, inside)!.remaining[nobodys], -1);
});

test('a unit that may use any entrance takes a building when the half ends', () => {
  const state = game(
    ['rrrrrrrrr', 'rrrNrrrrr', 'rrrrrrrrr'],
    [[1, 0, TANK, 0], [1, 1, INFANTRY, 0], [8, 0, BUNKER, 1]],
    [shop(NOBODY, DEPOT, 0, [TANK, INFANTRY])],
  );
  const tank = on(state, 1, 0);
  const infantry = on(state, 1, 1);
  const depot = state.buildings[0]!;
  const entrance = at(state, 3, 1);
  // A tank cannot use an entrance that is not its side's.
  assert.equal(rangeOf(state, tank)!.remaining[entrance], -1);
  assert.match(cannotMoveReason(state, depot.units[0]!)!, /neither side/);

  const move = moveUnit(state, infantry, { column: 3, row: 1 });
  assert.ok(move.ok);
  assert.equal(move.arrival, 'taking');
  // Until the half ends it stands on the entrance and the building is as it was.
  assert.equal(unitAt(state, { column: 3, row: 1 }), infantry);
  assert.equal(depot.owner, null);

  const { captures } = endHalf(state);
  assert.equal(captures.length, 1);
  const [capture] = captures;
  assert.deepEqual(
    [capture!.unit, capture!.building, capture!.previousOwner, capture!.captured.length, capture!.displaced],
    [infantry, depot, null, 2, null],
  );
  assert.equal(depot.owner, 0);
  assert.equal(state.map.terrain[entrance], terrainTypes.indexOf(terrainOf('G')));
  assert.equal(unitAt(state, { column: 3, row: 1 }), null);
  assert.deepEqual(depot.units.map((unit) => [unit.type, unit.side]), [[TANK, 0], [INFANTRY, 0], [INFANTRY, 0]]);
  assert.equal(depot.units[2], infantry);
  assert.equal(state.winner, null);
  // What went over with the building can move like any other unit next round.
  nextRound(state);
  assert.equal(cannotMoveReason(state, depot.units[0]!), null);
});

test('a unit destroyed on the entrance takes nothing', () => {
  const state = game(
    ['rrrrrrrrr', 'rrrNrrrrr'],
    [[0, 0, TANK, 0], [1, 1, INFANTRY, 0], [4, 1, INFANTRY, 1]],
  );
  const [, german, french] = state.units;
  german!.count = 1;
  french!.experience = 6;
  assert.ok(moveUnit(state, german!, { column: 3, row: 1 }).ok);
  assert.ok(orderAttack(state, french!, { column: 3, row: 1 }).ok);
  const { fights, captures } = endHalf(state);
  assert.ok(german!.destroyed);
  assert.equal(fights[0]!.target, german);
  assert.deepEqual(captures, []);
  assert.equal(state.buildings[0]!.owner, null);
});

test('taking a building with every place taken costs the first unit inside', () => {
  const state = game(
    ['rrrrrrrrr', 'rrrFrrrrr'],
    [[1, 1, INFANTRY, 0], [8, 0, BUNKER, 1]],
    [shop(1, DEPOT, 0, Array(7).fill(TANK))],
  );
  const taker = on(state, 1, 1);
  const depot = state.buildings[0]!;
  const first = depot.units[0]!;
  assert.ok(moveUnit(state, taker, { column: 3, row: 1 }).ok);
  const [capture] = endHalf(state).captures;
  assert.deepEqual([capture!.previousOwner, capture!.displaced, capture!.captured.length], [1, first, 6]);
  assert.ok(first.destroyed);
  assert.deepEqual([depot.units.length, depot.units[0], depot.owner], [7, taker, 0]);
  assert.ok(depot.units.every((unit) => unit.side === 0));
  assert.equal(state.map.terrain[at(state, 3, 1)], terrainTypes.indexOf(terrainOf('G')));
});

test('taking the headquarters wins the battle', () => {
  const state = game(['rrrrr', 'rrKhr'], [[0, 1, INFANTRY, 0], [4, 0, BUNKER, 1]]);
  const bunker = on(state, 4, 0);
  assert.ok(moveUnit(state, on(state, 0, 1), { column: 2, row: 1 }).ok);
  assert.equal(state.winner, null);
  const { captures } = endHalf(state);
  assert.equal(captures[0]!.building.kind, 'headquarters');
  assert.deepEqual([state.winner, state.wonBy], [0, 'headquarters']);
  assert.match(cannotMoveReason(state, bunker)!, /over/);
});

test('what a transport carries shares its losses and is lost with it', () => {
  const setUp = () => {
    const state = game(['ppp'], [[1, 0, TRUCK, 0], [2, 0, INFANTRY, 1]], [shop(0, TRANSPORT, 0, [INFANTRY, INFANTRY])]);
    const [truck, french] = state.units;
    return { state, truck: truck!, french: french!, aboard: truck!.cargo.slice() };
  };

  const hit = setUp();
  hit.aboard[1]!.count = 1;
  assert.ok(orderAttack(hit.state, hit.french, { column: 1, row: 0 }).ok);
  const [report] = endHalf(hit.state).fights;
  const losses = report!.targetLosses;
  assert.ok(losses >= 1 && losses < 6, `the truck lost ${losses}`);
  assert.equal(hit.aboard[0]!.count, 6 - losses);
  // The unit that had only one left is gone.
  assert.ok(hit.aboard[1]!.destroyed);
  assert.deepEqual(report!.cargoDestroyed, [hit.aboard[1]]);
  assert.deepEqual(hit.truck.cargo, [hit.aboard[0]]);

  const sunk = setUp();
  sunk.truck.count = 1;
  sunk.french.experience = 6;
  assert.ok(orderAttack(sunk.state, sunk.french, { column: 1, row: 0 }).ok);
  const [end] = endHalf(sunk.state).fights;
  assert.ok(sunk.truck.destroyed && sunk.aboard.every((unit) => unit.destroyed));
  assert.deepEqual(end!.cargoDestroyed, sunk.aboard);
  assert.deepEqual([sunk.state.winner, sunk.state.wonBy], [1, 'units']);
});

test('units inside are out of every fight, and still count as their side', () => {
  const state = game(['rrrrr', 'rGrrr'], [[2, 1, INFANTRY, 1]], [shop(0, DEPOT, 0, [INFANTRY])]);
  const [french, inside] = state.units;
  assert.deepEqual(attackTargets(state, french!), []);
  endHalf(state);
  assert.equal(state.winner, null);
  assert.match(cannotAttackReason(state, inside!)!, /inside/);
  // It can come out when its side next moves.
  nextRound(state);
  assert.equal(cannotMoveReason(state, inside!), null);
});

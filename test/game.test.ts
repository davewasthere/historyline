// Checks the decoders against the installed game. Skipped when the game's
// folder is not there, so the other tests still run anywhere.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { IS_BUILT, IS_CARRIER, TAKES_BUILDINGS, type ComputerTable } from '../src/formats/computerTable.ts';
import { END_TERRAIN, NO_UNIT, splitUnitCode } from '../src/formats/map.ts';
import { decodeMapRecords } from '../src/formats/mapRecords.ts';
import { UNIT_TYPE_COUNT } from '../src/formats/shops.ts';
import {
  canEnter,
  entranceTerrain,
  FILLED_GROUND,
  FIRST_TRENCH_GROUND,
} from '../src/formats/terrain.ts';
import { FLANK_PERCENT, GROUND_BONUS } from '../src/game/combat.ts';
import { computerPlay } from '../src/game/computer.ts';
import { fieldTowards, moveRange } from '../src/game/movement.ts';
import { HISTORYLINE_RULES } from '../src/game/rules.ts';
import { restoreGame, saveGame, type SavedGame } from '../src/game/save.ts';
import {
  attackerSide,
  attackTargets,
  buildChoices,
  buildUnit,
  cannotAttackReason,
  cannotMoveReason,
  cannotStopReason,
  contentsOf,
  createGame,
  DEPOT_PLACE_STEPS,
  endHalf,
  fieldsOf,
  incomeOf,
  moveUnit,
  orderAttack,
  orderWork,
  PLACES,
  rangeOf,
  TRENCH_STEPS,
  workPlaces,
} from '../src/game/state.ts';
import { computerTableFor, FACINGS, listMaps, loadAssets, loadMap } from '../src/viewer/assets.ts';
import { mapPixelSize, renderMap } from '../src/viewer/render.ts';
import { diskFiles, gameDir } from '../tools/gameFiles.ts';

const skip = existsSync(gameDir()) ? false : `game not found at ${gameDir()}`;
const files = diskFiles();
const { preparedGround: PREPARED_GROUND, depotGround: DEPOT_GROUND } = HISTORYLINE_RULES;

test('the game assets load', { skip }, async () => {
  const assets = await loadAssets(files);
  assert.equal(assets.unitTypes.length, UNIT_TYPE_COUNT);
  assert.equal(assets.unitSprites.length, UNIT_TYPE_COUNT * FACINGS);
  assert.equal(assets.unitTypes[1]!.name, 'A7V TANK');
  for (const season of ['summer', 'winter'] as const) {
    const { tiles, tileNames } = assets.tilesets[season];
    assert.equal(tiles.length, END_TERRAIN + 1);
    assert.equal(tileNames.length, tiles.length);
    for (const tile of tiles) assert.deepEqual([tile.width, tile.height], [24, 24]);
  }
});

test('map records give each map its season and player count', { skip }, async () => {
  const maps = await listMaps(files);
  const winter = maps.filter((map) => map.season === 'winter').map((map) => Number(map.id));
  // Both single-player sets have the same eight winter battlefields.
  const single = [1, 2, 8, 9, 13, 14, 19, 20];
  const twoPlayer = [49, 50, 55, 56, 61, 62, 67, 68];
  assert.deepEqual(winter, [...single, ...single.map((n) => n + 24), ...twoPlayer]);
  for (const map of maps) assert.match(map.code, /^[A-Z]{5}$/, `map ${map.id}`);
  assert.equal(new Set(maps.map((map) => map.code)).size, maps.length);

  const records = decodeMapRecords(await files.read('CODES.DAT'));
  for (const map of maps) {
    assert.equal(records[Number(map.id)]!.players, map.singlePlayer ? 1 : 2, `map ${map.id}`);
  }
});

test('unit statistics match the manual', { skip }, async () => {
  const { unitTypes } = await loadAssets(files);
  const byName = (name: string) => {
    const type = unitTypes.find((candidate) => candidate.name === name);
    assert.ok(type, `no unit type named ${name}`);
    return type;
  };

  const infantry = byName('INFANTRY');
  assert.deepEqual(
    [infantry.speed, infantry.armour, infantry.groupSize, infantry.cost, infantry.weight],
    [4, 20, 6, 35, 1],
  );
  assert.deepEqual(infantry.weapons, { air: null, ground: { range: 1, power: 30 }, water: { range: 1, power: 30 } });

  const heavyArtillery = byName('HEAVY ARTILLERY');
  assert.deepEqual(heavyArtillery.weapons.ground, { range: 6, power: 70 });
  assert.deepEqual([heavyArtillery.speed, heavyArtillery.weight, heavyArtillery.cost], [1, 5, 85]);

  // Anti-aircraft guns reach aircraft but only fire back at ground units.
  const mobileAa = byName('MOB AA-EMPLACEM.');
  assert.deepEqual(mobileAa.weapons.air, { range: 4, power: 35 });
  assert.deepEqual(mobileAa.weapons.ground, { range: 0, power: 40 });

  // The St. Chamond is the one tank that is stronger against ground than water targets.
  const stChamond = byName('ST. CHAMMOND');
  assert.deepEqual([stChamond.weapons.ground?.power, stChamond.weapons.water?.power], [60, 55]);

  const battleship = byName('BATTLESHIP');
  assert.deepEqual(battleship.weapons, {
    air: { range: 2, power: 35 },
    ground: { range: 7, power: 70 },
    water: { range: 7, power: 95 },
  });
  assert.equal(battleship.cost, null);

  assert.deepEqual([byName('SUPPLY CAR').capacity, byName('SUPPLY CAR').weight], [9, 4]);
  assert.equal(byName('TRANSPORT SHIP').capacity, 30);
});

test('trains start on rail and ships on water on every map', { skip }, async () => {
  const assets = await loadAssets(files);
  const { terrainTypes } = assets.tilesets.summer;
  const RAIL = 2;
  const WATER = 1 | 4;
  let checked = 0;
  for (const { id } of await listMaps(files)) {
    const { map } = await loadMap(files, id);
    map.units.forEach((code, at) => {
      if (code === NO_UNIT) return;
      const type = assets.unitTypes[splitUnitCode(code).type]!;
      const railOnly = type.terrainMask === RAIL;
      const waterOnly = type.terrainMask !== 0 && (type.terrainMask & ~WATER) === 0;
      if (!railOnly && !waterOnly) return;
      const terrain = terrainTypes[map.terrain[at]!]!;
      assert.ok(canEnter(type.terrainMask, terrain), `map ${id}: ${type.name} on terrain ${map.terrain[at]}`);
      checked++;
    });
  }
  assert.ok(checked > 500, `only ${checked} trains and ships found`);
});

test('the combat tables are the ones in HL.EXE, and every terrain has an entry', { skip }, async () => {
  const exe = await files.read('HL.EXE');
  const signed = (bytes: Uint8Array) => [...bytes].map((b) => (b > 127 ? b - 256 : b));
  assert.deepEqual([...exe.subarray(0x391f9, 0x391f9 + FLANK_PERCENT.length)], [...FLANK_PERCENT]);
  assert.deepEqual(signed(exe.subarray(0x40ed0, 0x40ed0 + GROUND_BONUS.length * 2)), GROUND_BONUS.flat());

  const assets = await loadAssets(files);
  for (const season of ['summer', 'winter'] as const) {
    for (const terrain of assets.tilesets[season].terrainTypes) {
      assert.ok(terrain.combatGround < GROUND_BONUS.length, `combat ground ${terrain.combatGround}`);
    }
  }
});

test('a whole round of attacks can be played on every map', { skip }, async () => {
  const assets = await loadAssets(files);
  let fights = 0;
  for (const info of await listMaps(files)) {
    const { map, shops } = await loadMap(files, info.id);
    const state = createGame(map, assets.unitTypes, assets.tilesets[info.season].terrainTypes, shops);
    // Each half: every unit of the attacking side attacks the first enemy in its range.
    for (let half = 0; half < 2; half++) {
      for (const unit of state.units) {
        if (cannotAttackReason(state, unit) !== null) continue;
        const [target] = attackTargets(state, unit);
        if (target) assert.ok(orderAttack(state, unit, target).ok);
      }
      for (const report of endHalf(state).fights) {
        if (!report.target) continue;
        fights++;
        assert.ok(report.targetLosses >= 0 && report.attackerLosses >= 0, `map ${info.id}`);
        assert.ok(report.target.count >= 0 && report.attacker.count >= 0, `map ${info.id}`);
        assert.equal(report.target.destroyed, report.target.count === 0);
      }
    }
    assert.equal(state.round, 2);
  }
  // Most units start out of each other's range, so the opening round has few fights.
  assert.ok(fights > 20, `only ${fights} fights`);
});

test('a battle on every map can be saved in mid-half and taken up the same', { skip }, async () => {
  const assets = await loadAssets(files);
  let largest = 0;
  for (const info of await listMaps(files)) {
    const { map, shops } = await loadMap(files, info.id);
    const { terrainTypes } = assets.tilesets[info.season];
    const state = createGame(map, assets.unitTypes, terrainTypes, shops);
    // Half a turn's worth: the side that moves takes each unit to the first
    // field it can stop on, the other orders what attacks it can.
    for (const unit of [...state.units]) {
      if (cannotMoveReason(state, unit) !== null) continue;
      const range = rangeOf(state, unit);
      if (!range) continue;
      const to = range.remaining.findIndex(
        (left, at) =>
          left >= 0 && cannotStopReason(state, unit, range, { column: at % map.columns, row: Math.floor(at / map.columns) }) === null,
      );
      if (to >= 0) assert.ok(moveUnit(state, unit, { column: to % map.columns, row: Math.floor(to / map.columns) }).ok);
    }
    for (const unit of state.units) {
      if (cannotAttackReason(state, unit) !== null) continue;
      const [target] = attackTargets(state, unit);
      if (target) assert.ok(orderAttack(state, unit, target).ok);
    }

    const text = JSON.stringify(saveGame(state));
    largest = Math.max(largest, text.length);
    const again = restoreGame(JSON.parse(text) as SavedGame, assets.unitTypes, terrainTypes);
    assert.deepEqual(saveGame(again), saveGame(state), `map ${info.id}`);
    assert.deepEqual([...again.map.units], [...state.map.units], `map ${info.id}`);
    assert.deepEqual([...again.unitIndex], [...state.unitIndex], `map ${info.id}`);
    assert.deepEqual([...again.buildingIndex], [...state.buildingIndex], `map ${info.id}`);
    // Played on to the end of the round, the two are still the same battle.
    for (let half = 0; half < 2; half++) {
      assert.equal(endHalf(again).fights.length, endHalf(state).fights.length, `map ${info.id}`);
      assert.deepEqual(saveGame(again), saveGame(state), `map ${info.id}`);
    }
  }
  // A browser keeps about five million characters for a site; every map's save has to fit many times over.
  assert.ok(largest < 100_000, `a save of ${largest} characters`);
});

test('the computer plays both sides of every map by the tables in the game files', { skip }, async () => {
  const assets = await loadAssets(files);
  const named = (table: ComputerTable, flags: number) =>
    table.flatMap((kind, type) => (kind.flags & flags ? [assets.unitTypes[type]!.name] : []));
  for (const side of [0, 1] as const) {
    const table = assets.computerTables[side];
    assert.ok(table, `no table for side ${side}`);
    assert.equal(table.length, UNIT_TYPE_COUNT);
    // The kinds the table sends to take buildings are ones the rules let do it.
    assert.deepEqual(named(table, TAKES_BUILDINGS), ['ELITE INFANTRY', 'INFANTRY', 'ANTI-TANK GUNS', 'SAPPERS', 'CAVALRY']);
    assert.ok(table.every((kind, type) => !(kind.flags & TAKES_BUILDINGS) || assets.unitTypes[type]!.entersAnyBuilding));
    assert.deepEqual(named(table, IS_CARRIER), ['SUPPLY CAR', 'TRANSPORT SHIP']);
    // Each table has its side build kinds of its own army only.
    const built = table.flatMap((kind, type) => (kind.flags & IS_BUILT ? [type] : []));
    assert.ok(built.length >= 15 && built.every((type) => (side === 0 ? type <= 35 : type >= 10)), `side ${side}`);
  }

  let seed = 1914;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  const totals = { hits: 0, captures: 0, built: 0, repaired: 0, won: 0 };
  for (const info of await listMaps(files)) {
    const loaded = await loadMap(files, info.id);
    // A map has a table of its own if it is one for a single player.
    assert.equal(loaded.computerTable !== null, info.singlePlayer, `map ${info.id}`);
    const state = createGame(loaded.map, assets.unitTypes, assets.tilesets[info.season].terrainTypes, loaded.shops);
    const tables = ([0, 1] as const).map((side) => computerTableFor(assets, loaded, info.id, side));
    let moves = 0;
    while (state.round <= 12 && state.winner === null) {
      // The side that attacks gives its orders before the other side's units move.
      for (const side of [attackerSide(state), state.mover]) {
        const turn = computerPlay(state, side, { table: tables[side], random });
        moves += turn.moves.length;
        totals.built += turn.built.length;
        totals.repaired += turn.repaired.length;
        // It plays the part of the half that is its side's, and no other.
        assert.ok(side === state.mover ? turn.attacks.length + turn.built.length === 0 : turn.moves.length === 0);
        for (const { unit } of turn.moves) assert.ok(unit.side === side && unit.moved, `map ${info.id}`);
        assert.ok(state.points[side] >= 0, `map ${info.id}`);
      }
      const report = endHalf(state);
      totals.hits += report.fights.filter((fight) => fight.targetLosses > 0).length;
      totals.captures += report.captures.length;
    }
    assert.ok(moves >= 20, `map ${info.id}: only ${moves} moves`);
    if (state.winner !== null) totals.won++;
    // What it left behind is a battle that holds together: it can be saved and taken up.
    const saved = saveGame(state);
    assert.deepEqual(saveGame(restoreGame(saved, assets.unitTypes, state.terrainTypes)), saved, `map ${info.id}`);
  }
  assert.ok(totals.hits > 4000, `only ${totals.hits} attacks hit`);
  assert.ok(totals.captures > 120, `only ${totals.captures} buildings taken`);
  assert.ok(totals.built > 400 && totals.repaired > 150, `built ${totals.built}, repaired ${totals.repaired}`);
  assert.ok(totals.won >= 5, `only ${totals.won} battles won in twelve rounds`);
});

test('the buildings and transports of every map hold what its records say', { skip }, async () => {
  const assets = await loadAssets(files);
  // AMOK.DAT starts with the entrance terrain of a factory, a depot and a
  // headquarters for the German side, the French side and (but for the
  // headquarters) nobody: what a building's entrance becomes when it is taken.
  const owners = [0, 1, null] as const;
  const amok = await files.read('AMOK.DAT');
  for (const season of ['summer', 'winter'] as const) {
    const { terrainTypes } = assets.tilesets[season];
    const found = (['factory', 'depot', 'headquarters'] as const).flatMap((kind) =>
      owners.map((owner) => entranceTerrain(terrainTypes, kind, owner)),
    );
    assert.deepEqual(found.slice(0, 8), [...amok.subarray(0, 8)], season);
  }

  let inside = 0;
  let aboard = 0;
  let movedOut = 0;
  for (const info of await listMaps(files)) {
    const { map, shops } = await loadMap(files, info.id);
    const { terrainTypes } = assets.tilesets[info.season];
    const state = createGame(map, assets.unitTypes, terrainTypes, shops);

    // One headquarters for each side, and every field of a building is marked as part of one of its kind.
    const headquarters = state.buildings.filter((building) => building.kind === 'headquarters');
    assert.deepEqual(headquarters.map((building) => building.owner).sort(), [0, 1], `map ${info.id}`);
    for (const building of state.buildings) {
      for (const field of building.fields) {
        const terrain = terrainTypes[map.terrain[field.row * map.columns + field.column]!]!;
        assert.equal(terrain.sitePart, building.kind, `map ${info.id}: field ${field.column}, ${field.row}`);
      }
      assert.ok(building.units.length <= PLACES);
      inside += building.units.length;
    }

    // What the transports carry is within the rules for loading them.
    for (const unit of state.units) {
      const type = assets.unitTypes[unit.type]!;
      if (unit.cargo.length === 0) continue;
      assert.ok(type.isTransport && unit.cargo.length <= PLACES, `map ${info.id}: ${type.name}`);
      const load = unit.cargo.reduce((sum, carried) => sum + assets.unitTypes[carried.type]!.weight, 0);
      assert.ok(load <= type.capacity, `map ${info.id}: ${type.name} carries ${load}`);
      for (const carried of unit.cargo) {
        const carriedType = assets.unitTypes[carried.type]!;
        assert.ok(carriedType.loadClasses & type.carries, `map ${info.id}: ${carriedType.name} in ${type.name}`);
        assert.equal(carried.side, unit.side);
      }
      aboard += unit.cargo.length;
    }

    // Every record's units are in the game, but for records naming a building or transport the map lacks.
    // (The second half of a ship is on the map but is no unit of its own.)
    const onMap = [...map.units].filter(
      (code) => code !== NO_UNIT && !assets.unitTypes[splitUnitCode(code).type]!.isShipBack,
    );
    const made = state.units.length - onMap.length;
    const listed = shops.shops.reduce((sum, shop) => sum + shop.contents.length, 0);
    assert.ok(made <= listed && listed - made <= 7, `map ${info.id}: ${made} of ${listed} units made`);

    // Each unit inside that can move this half gets out, if anywhere is in reach.
    for (const unit of [...state.units]) {
      if (!unit.inside || cannotMoveReason(state, unit) !== null) continue;
      const holder = unit.inside;
      const range = rangeOf(state, unit)!;
      const stop = [...range.remaining].findIndex(
        (left, at) =>
          left >= 0 && moveUnit(state, unit, { column: at % map.columns, row: Math.floor(at / map.columns) }).ok,
      );
      if (stop === -1) continue;
      assert.ok(!contentsOf(holder).includes(unit) && unit.moved);
      movedOut++;
    }
  }
  // Most units inside are in buildings that are nobody's yet; only the German side moves in the first half.
  assert.ok(inside > 800 && aboard >= 10 && movedOut >= 40, `${inside} inside, ${aboard} aboard, ${movedOut} moved out`);
});

test('the ships that fill two fields are whole on every map, and move with their second half behind', { skip }, async () => {
  const assets = await loadAssets(files);
  const DEEP_WATER = 1;
  let ships = 0;
  let moved = 0;
  for (const info of await listMaps(files)) {
    const { map, shops } = await loadMap(files, info.id);
    const { terrainTypes } = assets.tilesets[info.season];
    const state = createGame(map, assets.unitTypes, terrainTypes, shops);
    // Making the ships whole changes nothing on the map: both halves were there already.
    assert.deepEqual([...state.map.units], [...map.units], `map ${info.id}`);
    assert.ok(state.units.every((unit) => !assets.unitTypes[unit.type]!.isShipBack));

    const check = (unit: (typeof state.units)[number]) => {
      const [head, tail] = fieldsOf(unit);
      assert.ok(tail, `map ${info.id}: a ship without its second half`);
      const columns = state.map.columns;
      assert.equal(state.map.units[head!.row * columns + head!.column], unit.type * 2 + unit.side!);
      assert.equal(state.map.units[tail.row * columns + tail.column], (unit.type + 1) * 2 + unit.side!);
      for (const field of [head!, tail]) {
        assert.equal(terrainTypes[state.map.terrain[field.row * columns + field.column]!]!.terrainClass, DEEP_WATER);
      }
      return { head: head!, tail };
    };

    // Two halves, so that both sides' ships get to move: each goes to the last field it can reach.
    for (let half = 0; half < 2; half++) {
      for (const unit of state.units) {
        if (!assets.unitTypes[unit.type]!.isShipHalf || unit.destroyed) continue;
        if (half === 0) {
          check(unit);
          ships++;
        }
        if (cannotMoveReason(state, unit) !== null) continue;
        const range = rangeOf(state, unit)!;
        const before = { column: unit.column, row: unit.row };
        const targets = [...range.remaining].map((left, at) => (left >= 0 ? at : -1)).filter((at) => at >= 0);
        const result = targets
          .reverse()
          .map((at) => moveUnit(state, unit, { column: at % map.columns, row: Math.floor(at / map.columns) }))
          .find((made) => made.ok);
        if (!result?.ok) continue;
        const { head, tail } = check(unit);
        // The second half is on the field the first came from last, which is next to where it is now.
        const from = result.path.length > 1 ? result.path[result.path.length - 2]! : before;
        assert.deepEqual(tail, from, `map ${info.id}`);
        assert.ok(Math.abs(head.column - tail.column) <= 1 && Math.abs(head.row - tail.row) <= 1);
        moved++;
      }
      endHalf(state);
    }
  }
  assert.ok(ships > 100 && moved > 80, `${ships} ships, ${moved} moved`);
});

test('depots are laid out and built as the game files have them', { skip }, async () => {
  const assets = await loadAssets(files);
  // The ten places a construction unit can work on, from HL.EXE: column steps, then row steps.
  const exe = await files.read('HL.EXE');
  const signed = (bytes: Uint8Array) => [...bytes].map((b) => (b > 127 ? b - 256 : b));
  for (const [parity, offset] of [['even', 0x39211], ['odd', 0x39225]] as const) {
    const steps = DEPOT_PLACE_STEPS[parity];
    assert.deepEqual(signed(exe.subarray(offset, offset + 10)), steps.map(([column]) => column), parity);
    assert.deepEqual(signed(exe.subarray(offset + 10, offset + 20)), steps.map(([, row]) => row), parity);
  }
  // The grounds of a prepared site and of a depot's other fields, from AMOK.DAT.
  const amok = await files.read('AMOK.DAT');
  assert.deepEqual([...amok.subarray(24, 28)], [...PREPARED_GROUND]);
  assert.deepEqual([...amok.subarray(29, 32)], [...DEPOT_GROUND]);

  let depots = 0;
  let prepared = 0;
  let worked = 0;
  for (const info of await listMaps(files)) {
    const { map, shops } = await loadMap(files, info.id);
    const state = createGame(map, assets.unitTypes, assets.tilesets[info.season].terrainTypes, shops);
    const terrainOn = (field: { column: number; row: number }) =>
      field.column >= 0 && field.column < map.columns && field.row < map.rows
        ? state.map.terrain[field.row * map.columns + field.column]
        : undefined;
    const below = (entrance: { column: number; row: number }) =>
      [2, 3, 4].map((direction) => terrainOn(fieldTowards(entrance, direction)));

    // Every depot on the map, and every site prepared for one, lies as the rule lays them.
    for (const depot of state.buildings.filter((building) => building.kind === 'depot')) {
      assert.deepEqual(below(depot.entrance), [...DEPOT_GROUND], `map ${info.id}: depot`);
      depots++;
    }
    map.terrain.forEach((terrain, at) => {
      if (terrain !== PREPARED_GROUND[0]) return;
      const entrance = { column: at % map.columns, row: Math.floor(at / map.columns) };
      assert.deepEqual(below(entrance), PREPARED_GROUND.slice(1), `map ${info.id}: prepared site`);
      prepared++;
    });

    // A round: in each half the construction units of the side that attacks work on the
    // first place they can, and when the half ends the ground there is as the work leaves it.
    for (let half = 0; half < 2; half++) {
      for (const unit of state.units) {
        if (!assets.unitTypes[unit.type]!.buildsDepots || unit.inside || unit.side === state.mover) continue;
        const [place] = workPlaces(state, unit);
        if (place) assert.ok(orderWork(state, unit, place.field).ok, `map ${info.id}`);
      }
      for (const work of endHalf(state).works) {
        assert.ok(work.done, `map ${info.id}`);
        const laid = [terrainOn(work.target), ...below(work.target)];
        if (work.work === 'prepare') assert.deepEqual(laid, [...PREPARED_GROUND], `map ${info.id}`);
        else assert.deepEqual(laid.slice(1), [...DEPOT_GROUND], `map ${info.id}`);
        assert.equal(work.unit.supplies, 1);
        worked++;
      }
    }
  }
  // Nearly every construction unit starts inside a building, so few can work in the first round.
  assert.ok(depots > 150 && prepared > 15 && worked >= 1, `${depots} depots, ${prepared} prepared sites, ${worked} worked`);
});

test('sappers dig the trenches HL.EXE lays out, on every map', { skip }, async () => {
  const assets = await loadAssets(files);
  // HL.EXE keeps the trench by the aim's column and row steps from the sappers, each
  // from -1 to 1: three pairs of steps, and with the same index three terrain numbers
  // (each followed by a byte that is not used). Aims that are no neighbour have zeros.
  const exe = await files.read('HL.EXE');
  const signed = (byte: number) => (byte > 127 ? byte - 256 : byte);
  const around = {
    even: [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]],
    odd: [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]],
  } as const;
  for (const [parity, base] of [['even', 0], ['odd', 0x36]] as const) {
    for (let column = -1; column <= 1; column++) {
      for (let row = -1; row <= 1; row++) {
        const at = base + (column + 1) * 0x12 + (row + 1) * 6;
        const steps = [...exe.subarray(0x39249 + at, 0x39249 + at + 6)].map(signed);
        const grounds = [0, 2, 4].map((i) => exe[0x392b5 + at + i]!);
        const direction = around[parity].findIndex(([c, r]) => c === column && r === row);
        const trench = TRENCH_STEPS[parity][direction] ?? [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        assert.deepEqual(steps, trench.flatMap(([c, r]) => [c, r]), `${parity} ${column} ${row}`);
        assert.deepEqual(grounds, trench.map(([, , ground]) => ground), `${parity} ${column} ${row}`);
      }
    }
  }
  const sapperNames = assets.unitTypes.filter((type) => type.digsTrenches).map((type) => type.name);
  assert.deepEqual(sapperNames, ['SAPPERS']);
  // What the trench is made of is trench, and what it is filled in with is open ground.
  const { terrainTypes: summer } = assets.tilesets.summer;
  for (const trench of [...TRENCH_STEPS.even, ...TRENCH_STEPS.odd]) {
    for (const [, , ground] of trench) {
      assert.ok(ground >= FIRST_TRENCH_GROUND && summer[ground]!.buildable, `ground ${ground}`);
    }
  }
  assert.ok(summer[FILLED_GROUND]!.buildable && summer[FILLED_GROUND]!.terrainClass === 16);

  // A round on every map: the sappers of the side that attacks work on the first field they can.
  let dug = 0;
  let filled = 0;
  for (const info of await listMaps(files)) {
    const { map, shops } = await loadMap(files, info.id);
    const state = createGame(map, assets.unitTypes, assets.tilesets[info.season].terrainTypes, shops);
    for (let half = 0; half < 2; half++) {
      for (const unit of state.units) {
        if (!assets.unitTypes[unit.type]!.digsTrenches || unit.inside || unit.side === state.mover) continue;
        assert.match(cannotAttackReason(state, unit)!, /do not start attacks/);
        const [place] = workPlaces(state, unit);
        if (place) assert.ok(orderWork(state, unit, place.field).ok, `map ${info.id}`);
      }
      for (const work of endHalf(state).works) {
        if (work.work !== 'dig' && work.work !== 'fill') continue;
        assert.ok(work.done, `map ${info.id}`);
        const ground = state.map.terrain[work.target.row * map.columns + work.target.column]!;
        if (work.work === 'dig') assert.ok(ground >= FIRST_TRENCH_GROUND, `map ${info.id}: ground ${ground}`);
        else assert.equal(ground, FILLED_GROUND, `map ${info.id}`);
        if (work.work === 'dig') dug++;
        else filled++;
      }
    }
  }
  assert.ok(dug + filled > 20, `${dug} dug, ${filled} filled`);
});

test('both sides earn points on every map, and their factories build what the map allows', { skip }, async () => {
  const assets = await loadAssets(files);
  let built = 0;
  for (const info of await listMaps(files)) {
    const { map, shops } = await loadMap(files, info.id);
    const state = createGame(map, assets.unitTypes, assets.tilesets[info.season].terrainTypes, shops);
    assert.deepEqual(state.points, [0, 0]);
    for (const side of [0, 1] as const) {
      assert.ok(incomeOf(state, side) > 0, `map ${info.id}: side ${side} earns nothing`);
    }

    // Two halves, each ending with the side that moved being paid what it earns.
    for (const side of [0, 1] as const) {
      const income = incomeOf(state, side);
      assert.deepEqual(endHalf(state).paid, { side, points: income }, `map ${info.id}`);
      assert.equal(state.points[side], income);

      // That side attacks now: with points to spare, each of its factories builds the kinds on offer while it has room.
      state.points[side] = 5000;
      for (const factory of state.buildings.filter((building) => building.kind === 'factory' && building.owner === side)) {
        for (const { type, price } of buildChoices(state, factory)) {
          assert.ok(shops.buildable.includes(type), `map ${info.id}: kind ${type} is not on offer`);
          assert.ok(side === 0 ? type <= 35 : type >= 10, `map ${info.id}: side ${side} builds kind ${type}`);
          const before = state.points[side];
          const result = buildUnit(state, factory, type);
          if (!result.ok) continue;
          assert.deepEqual([state.points[side], result.unit.side], [before - price, side]);
          built++;
        }
        assert.ok(factory.units.length <= PLACES);
      }
      state.points[side] = income;
    }
  }
  assert.ok(built > 200, `only ${built} units built`);
});

test('movement ranges on the real maps stay on terrain the unit can enter', { skip }, async () => {
  const assets = await loadAssets(files);
  // Budgets and costs as the unit and terrain tables give them.
  const byName = (name: string) => assets.unitTypes.find((type) => type.name === name)!;
  assert.deepEqual(
    ['ARMOURED CAR', 'INFANTRY', 'HEAVY ARTILLERY', 'GOTHA BOMBER', 'BATTLESHIP', 'BUNKER'].map(
      (name) => byName(name).movementBudget,
    ),
    [16, 12, 4, 14, 30, 0],
  );
  assert.ok(byName('GOTHA BOMBER').isAircraft && !byName('ARMOURED CAR').isAircraft);
  assert.ok(byName('SUPPLY CAR').isTransport && byName('INFANTRY').entersAnyBuilding);
  assert.ok(byName('BATTLESHIP').isShipHalf && byName('STATIC BALLOON').flatMoveCost);
  assert.deepEqual(
    assets.unitTypes.filter((type) => type.slowToFire).map((type) => type.name),
    ['MEDIUM ARTILLERY', 'HEAVY ARTILLERY', 'TRAIN ARTILLERY'],
  );
  assert.deepEqual(
    assets.unitTypes.filter((type) => type.buildsDepots).map((type) => type.name),
    ['CONSTR. UNIT'],
  );

  // Where aircraft cannot land: every field of a building but its entrance,
  // and ground prepared for a depot. All of it is of the class nothing can
  // enter, and no kind's mask has that class, so no range below gets there.
  for (const season of ['summer', 'winter'] as const) {
    const { terrainTypes } = assets.tilesets[season];
    const numbers = (wanted: (number: number) => unknown) => terrainTypes.flatMap((_, number) => (wanted(number) ? [number] : []));
    const marked = numbers((number) => terrainTypes[number]!.noLanding);
    assert.equal(marked.length, 16);
    assert.deepEqual(
      marked,
      numbers((number) => {
        const terrain = terrainTypes[number]!;
        return (terrain.sitePart && !terrain.site) || PREPARED_GROUND.includes(number);
      }),
    );
    assert.ok(marked.every((number) => terrainTypes[number]!.terrainClass === 128));
  }
  assert.ok(assets.unitTypes.every((type) => !(type.terrainMask & 128)));

  let moved = 0;
  for (const info of await listMaps(files)) {
    const { map } = await loadMap(files, info.id);
    const { terrainTypes } = assets.tilesets[info.season];
    map.units.forEach((code, at) => {
      if (code === NO_UNIT) return;
      const type = assets.unitTypes[splitUnitCode(code).type]!;
      const start = { column: at % map.columns, row: Math.floor(at / map.columns) };
      const range = moveRange(map, start, assets.unitTypes, terrainTypes);
      assert.ok(range, `map ${info.id}: no range for ${type.name}`);
      assert.equal(range.remaining[at], type.movementBudget);
      range.remaining.forEach((left, field) => {
        if (left < 0 || field === at) return;
        assert.ok(left <= type.movementBudget);
        // A field holding a transport of its side can be reached whatever it is: to board.
        const onField = map.units[field]!;
        const transport = onField !== NO_UNIT && assets.unitTypes[splitUnitCode(onField).type]!.isTransport;
        assert.ok(
          transport || canEnter(type.terrainMask, terrainTypes[map.terrain[field]!]!),
          `map ${info.id}: ${type.name} reaches terrain ${map.terrain[field]}`,
        );
        assert.ok(!terrainTypes[map.terrain[field]!]!.noLanding, `map ${info.id}: ${type.name} reaches a building`);
        assert.ok(map.units[field] === NO_UNIT || (map.units[field]! & 1) === (code & 1), 'reaches an enemy field');
        moved++;
      });
    });
  }
  assert.ok(moved > 10000, `only ${moved} reachable fields found`);
});

test('every map decodes, uses only known terrain and units, and renders', { skip }, async () => {
  const assets = await loadAssets(files);
  const maps = await listMaps(files);
  assert.equal(maps.length, 72);
  for (const { id } of maps) {
    const { map, shops } = await loadMap(files, id);
    for (const terrain of map.terrain) {
      assert.ok(terrain < END_TERRAIN, `map ${id}: terrain ${terrain} inside the map`);
    }
    for (const code of map.units) {
      if (code === NO_UNIT) continue;
      assert.ok(splitUnitCode(code).type < UNIT_TYPE_COUNT, `map ${id}: unit code ${code}`);
    }
    for (const shop of shops.shops) {
      assert.ok(shop.owner <= 2 && shop.kind <= 3, `map ${id}: shop ${JSON.stringify(shop)}`);
      for (const type of shop.contents) assert.ok(type < UNIT_TYPE_COUNT, `map ${id}: shop holds ${type}`);
    }
    const surface = renderMap(map, assets, { season: 'summer', palette: 0, showUnits: true });
    assert.deepEqual({ width: surface.width, height: surface.height }, mapPixelSize(map));
  }
});

// Tests of what Battle Isle's files have that History Line's do not, and of
// the three Battle Isle games' own files. The second kind need the game and
// are skipped where it is not installed.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { decodeWorkGround } from '../src/formats/amok.ts';
import { decodeBitmap } from '../src/formats/bitmap.ts';
import { decodeComputerTable, IS_CARRIER, TAKES_BUILDINGS } from '../src/formats/computerTable.ts';
import { NO_UNIT, splitUnitCode } from '../src/formats/map.ts';
import { decodeShops } from '../src/formats/shops.ts';
import { canEnter, decodeTerrainTypes, entranceTerrain } from '../src/formats/terrain.ts';
import { decodeUnitTypes } from '../src/formats/unitTypes.ts';
import { computerPlay } from '../src/game/computer.ts';
import { fieldTowards } from '../src/game/movement.ts';
import { BATTLE_ISLE_RULES } from '../src/game/rules.ts';
import { restoreGame, saveGame } from '../src/game/save.ts';
import { attackerSide, buildChoices, createGame, endHalf, rangeOf } from '../src/game/state.ts';
import { GAMES, seasonsOf, type GameId } from '../src/games.ts';
import { REBUILT_GAMES, ROAD_SIDES, sketchFromBattleIsle } from '../src/maps/battleIsle.ts';
import { buildMap } from '../src/maps/sketch.ts';
import { computerTableFor, FACINGS, listMaps, loadAssets, loadMap } from '../src/viewer/assets.ts';
import { mapPixelSize, renderMap, TILE_SIZE } from '../src/viewer/render.ts';
import { diskFiles, gameDir } from '../tools/gameFiles.ts';
import { INFANTRY, makeMap, mover, TANK, terrainTypes, unitTypes } from './helpers.ts';

// --- the file forms, on data made up here ----------------------------------

/** A bitmap of the 4-bit type: `width` as its header is to give it, and bytes for `rowBytes` a plane row. */
function fourBitBitmap(id: string, width: number, height: number, rowBytes: number, fill: (plane: number, at: number) => number): Uint8Array {
  const data = new Uint8Array(18 + 4 * rowBytes * height);
  for (let i = 0; i < 8; i++) data[i] = id.charCodeAt(i);
  data[8] = 0;
  data[9] = 0x50;
  data[14] = width;
  data[16] = height;
  for (let plane = 0; plane < 4; plane++) {
    for (let at = 0; at < rowBytes * height; at++) data[18 + plane * rowBytes * height + at] = fill(plane, at);
  }
  return data;
}

test("a Battle Isle bitmap is known by its entry's name and gives its width in bytes", () => {
  // 24 pixels a row: 12 bytes over the four planes, 3 in each.
  const bitmap = decodeBitmap(fourBitBitmap('INFOENGY', 12, 2, 3, (plane, at) => ((plane + 1) << 4) | (at + 1)));
  assert.equal(bitmap.width, 24);
  assert.equal(bitmap.height, 2);
  // Plane p holds the pixels at x = p, p + 4, p + 8...; a byte's high half comes first.
  assert.deepEqual([...bitmap.pixels.subarray(0, 8)], [1, 2, 3, 4, 1, 1, 1, 1]);
  assert.equal(bitmap.pixels[24 + 20], 6);
  // The Moon of Chromos writes 14 for the same 12 bytes.
  assert.equal(decodeBitmap(fourBitBitmap('ILBM    ', 14, 2, 3, () => 0x11)).width, 24);
  // History Line gives the width in pixels, for the same bytes.
  assert.equal(decodeBitmap(fourBitBitmap('ILBM    ', 24, 2, 3, () => 0x11)).width, 24);
  assert.throws(() => decodeBitmap(fourBitBitmap('NOPE    ', 12, 2, 3, () => 0)), /unknown bitmap id/);
});

/** A Battle Isle unit record: History Line's without the byte in front. */
function battleIsleRecord(name: string, kind: string, bytes: Record<number, number>): Uint8Array {
  const record = new Uint8Array(68);
  for (const [at, value] of Object.entries(bytes)) record[Number(at)] = value;
  for (let i = 0; i < name.length; i++) record[26 + i] = name.charCodeAt(i);
  record.fill(0x20, 43, 59);
  for (let i = 0; i < kind.length; i++) record[44 + i] = kind.charCodeAt(i);
  return record;
}

test('a Battle Isle unit record is read as History Line\'s, moving on its speed', () => {
  const table = new Uint8Array(2 * 68);
  // An infantry unit: speed 8, armour 25, six men, a gun against ground and water.
  table.set(battleIsleRecord('R-1 DEMON', 'MECHFUSILIERS', { 0: 8, 1: 25, 2: 6, 4: 0x78, 5: 0x2c, 7: 1, 8: 2, 10: 32, 11: 32, 12: 4, 16: 0xc1, 17: 0x0a, 62: 7, 64: 1 }), 0);
  // A transport with the bit that marks sappers in History Line.
  table.set(battleIsleRecord('SC-T PROVIDER', 'SUPPORT REG.', { 0: 14, 1: 25, 2: 6, 4: 0x18, 12: 4, 13: 0x10, 16: 0x80, 17: 0x2a, 18: 0x40, 62: 9, 63: 7, 64: 2 }), 68);
  const [infantry, transport] = decodeUnitTypes(table, 'battleisle');
  assert.ok(infantry && transport);
  assert.equal(infantry.name, 'R-1 DEMON');
  assert.equal(infantry.className, 'MECHFUSILIERS');
  assert.equal(infantry.speed, 8);
  assert.equal(infantry.movementBudget, 8);
  assert.equal(infantry.armour, 25);
  assert.equal(infantry.groupSize, 6);
  assert.equal(infantry.terrainMask, 0x78);
  assert.deepEqual(infantry.weapons, { air: null, ground: { range: 1, power: 32 }, water: { range: 1, power: 32 } });
  assert.ok(infantry.entersAnyBuilding);
  assert.equal(infantry.cost, 7);
  assert.equal(infantry.weight, 1);
  assert.equal(infantry.raw.length, 68);
  assert.ok(transport.isTransport);
  assert.equal(transport.capacity, 7);
  assert.equal(transport.carries, 0x040);
  assert.ok(infantry.loadClasses & transport.carries);
  // Battle Isle has no trenches, whatever that bit means there.
  assert.equal(transport.digsTrenches, false);
  assert.throws(() => decodeUnitTypes(table, 'historyline'), /not a multiple of 69/);
});

test('a shop file lists as many kinds as the game has, and an older one leaves out the worth', () => {
  const kinds = new Uint8Array(27).fill(1);
  kinds[1] = kinds[2] = 0;
  const now = Uint8Array.of(...kinds, 1, 2, 1, 0, 35, 9, 24, 255, 255, 255, 255, 255, 255);
  assert.deepEqual(decodeShops(now, 27), {
    buildable: [1, 2],
    shops: [{ owner: 2, kind: 1, index: 0, resources: 35, worth: 9, contents: [24] }],
  });
  const older = Uint8Array.of(...kinds, 2, 0, 0, 0, 10, 8, 255, 255, 255, 255, 255, 255, 2, 1, 1, 35, 255, 255, 255, 255, 255, 255, 255);
  assert.deepEqual(decodeShops(older, 27).shops, [
    { owner: 0, kind: 0, index: 0, resources: 10, worth: null, contents: [8] },
    { owner: 2, kind: 1, index: 1, resources: 35, worth: null, contents: [] },
  ]);
  assert.throws(() => decodeShops(now.subarray(0, now.length - 3), 27), /needs 40 bytes/);
});

test('a building keeps its usual worth when its record does not give one', () => {
  const map = makeMap(['rrGrr'], []);
  const shop = { owner: 0, kind: 2, index: 0, resources: 12, contents: [INFANTRY] };
  const told = createGame(map, unitTypes, terrainTypes, { shops: [{ ...shop, worth: 3 }] });
  const untold = createGame(map, unitTypes, terrainTypes, { shops: [{ ...shop, worth: null }] });
  assert.equal(told.buildings[0]!.worth, 3);
  assert.equal(untold.buildings[0]!.worth, 10);
  assert.equal(untold.buildings[0]!.resources, 12);
  assert.equal(untold.buildings[0]!.units.length, 1);
});

test("the first Battle Isle's computer table has its bits the other way round", () => {
  // Infantry that takes buildings, and a transport, as Battle Isle writes them.
  const file = Uint8Array.of(90, 1, 0x00, 0x21, 2, 0, 40, 2, 0x02, 0x44, 0, 0);
  const [infantry, transport] = decodeComputerTable(file, 'high-first');
  assert.deepEqual(infantry, { worth: 90, flags: 0x0021, escorts: 2 });
  assert.ok(infantry!.flags & TAKES_BUILDINGS);
  assert.ok(transport!.flags & IS_CARRIER);
  assert.equal(decodeComputerTable(file)[0]!.flags, 0x2100);
});

test("a terrain table can have its kinds of ground in a fight turned into History Line's", () => {
  const file = Uint8Array.of(0x08, 0x00, 0x40, 4, 4, 1, 0x08, 0x00, 0x20, 4, 2, 7, 0x08, 0x80, 0x10, 3, 2, 6, 0x08, 0, 0x10, 3, 2, 9);
  assert.deepEqual(decodeTerrainTypes(file).map((type) => type.combatGround), [1, 7, 6, 9]);
  // Mountains, forest and open ground; a number the list does not have is open ground.
  assert.deepEqual(decodeTerrainTypes(file, GAMES.isle.combatGrounds!).map((type) => type.combatGround), [0, 1, 8, 8]);
});

test('AMOK.DAT gives the ground a construction unit leaves behind', () => {
  const file = Uint8Array.from({ length: 36 }, (_, at) => 100 + at);
  assert.deepEqual(decodeWorkGround(file), { preparedGround: [124, 125, 126, 127], depotGround: [129, 130, 131] });
  assert.throws(() => decodeWorkGround(file.subarray(1)), /35 bytes/);
});

test("with Battle Isle's rules either side builds every kind, and a unit leaves a building on half the budget", () => {
  const rules = { ...BATTLE_ISLE_RULES, preparedGround: [0x15, 0x18, 0x16, 0x17], depotGround: [0x14, 0x12, 0x13] };
  // A factory of each side: its entrance with the factory's other fields to its left.
  const map = makeMap(['yyyZrrrr', 'rrrrrrrr', 'yyyQrrrr'], []);
  const types = Array.from({ length: 40 }, (_, kind) => mover({ price: 10 + kind }));
  const everyKind = types.map((_, kind) => kind);
  const battleIsle = createGame(map, types, terrainTypes, {}, rules);
  const historyLine = createGame(map, types, terrainTypes);
  const kindsOf = (state: typeof battleIsle, side: number) =>
    buildChoices(state, state.buildings.find((building) => building.owner === side)!).map((choice) => choice.type);
  assert.deepEqual(kindsOf(battleIsle, 0), everyKind);
  assert.deepEqual(kindsOf(battleIsle, 1), everyKind);
  assert.deepEqual(kindsOf(historyLine, 0), everyKind.slice(0, 36));
  assert.deepEqual(kindsOf(historyLine, 1), everyKind.slice(10));

  // A unit inside a depot on a road (4 a field): one field with Battle Isle's budget, two with History Line's.
  const depot = makeMap(['rrrGrrr'], []);
  const shops = [{ owner: 0, kind: 2, index: 0, resources: 0, worth: 10, contents: [TANK] }];
  const reach = (state: typeof battleIsle) => {
    const range = rangeOf(state, state.buildings[0]!.units[0]!)!;
    return [...range.remaining].filter((left) => left >= 0).length - 1;
  };
  assert.equal(reach(createGame(depot, unitTypes, terrainTypes, { shops }, rules)), 2);
  assert.equal(reach(createGame(depot, unitTypes, terrainTypes, { shops })), 4);
});

// --- the games' own files ---------------------------------------------------

const BATTLE_ISLE_GAMES: GameId[] = ['isle', 'desert', 'moon'];

for (const id of BATTLE_ISLE_GAMES) {
  const profile = GAMES[id];
  const skip = existsSync(gameDir(profile)) ? false : `${profile.title} not found at ${gameDir(profile)}`;
  const files = diskFiles(profile);

  test(`${profile.title}: the assets load`, { skip }, async () => {
    const assets = await loadAssets(files, profile);
    assert.equal(assets.profile, profile);
    assert.equal(assets.unitTypes.length, profile.unitKinds);
    assert.equal(assets.unitSprites.length, profile.unitKinds * FACINGS);
    for (const sprite of assets.unitSprites) assert.deepEqual([sprite.width, sprite.height], [TILE_SIZE, TILE_SIZE]);
    assert.equal(assets.palettes.length, 3);
    // One set of tiles, whatever the season asked for.
    assert.deepEqual(seasonsOf(profile), ['summer']);
    assert.equal(assets.tilesets.winter, assets.tilesets.summer);
    const { tiles, tileNames, terrainTypes: table } = assets.tilesets.summer;
    assert.equal(tileNames.length, tiles.length);
    assert.ok(table.length >= tiles.length, `${table.length} terrain records for ${tiles.length} tiles`);
    for (const tile of tiles) {
      assert.deepEqual([tile.width, tile.height], [TILE_SIZE, TILE_SIZE]);
      // The four corners of a tile lie outside its field.
      for (const corner of [0, TILE_SIZE - 1, TILE_SIZE * (TILE_SIZE - 1), TILE_SIZE * TILE_SIZE - 1]) {
        assert.equal(tile.pixels[corner], tile.transparent);
      }
    }
    // A library without a list of names has its entries' numbers in their names.
    if (profile.tilesets.summer.names === null) {
      tileNames.forEach((name, number) => assert.equal(Number(name.slice(0, 3)), number, name));
    }
    // Every kind has a name, and the two halves of a ship follow each other.
    assets.unitTypes.forEach((type, kind) => {
      assert.ok(type.name.length > 0 && type.className.length > 0, `kind ${kind}`);
      assert.equal(type.movementBudget, type.speed);
      assert.equal(type.digsTrenches, false);
      if (type.isShipHalf && !type.isShipBack) assert.ok(assets.unitTypes[kind + 1]?.isShipBack, type.name);
    });
    assert.ok(assets.unitTypes.some((type) => type.entersAnyBuilding));
    assert.ok(assets.unitTypes.some((type) => type.buildsDepots));
    assert.ok(assets.unitTypes.some((type) => type.isTransport));
  });

  test(`${profile.title}: the terrain table has the entrances and the depot ground AMOK.DAT names`, { skip }, async () => {
    const assets = await loadAssets(files, profile);
    const table = assets.tilesets.summer.terrainTypes;
    const amok = await files.read('AMOK.DAT').then((file) => (file.length === 36 ? file : null));
    const owners = [0, 1, null] as const;
    const found = (['factory', 'depot', 'headquarters'] as const).flatMap((kind) =>
      owners.map((owner) => entranceTerrain(table, kind, owner)),
    );
    assert.ok(found.slice(0, 8).every((number) => number >= 0));
    // The Moon's file is packed; the other two can be compared as they are.
    if (amok) assert.deepEqual(found.slice(0, 8), [...amok.subarray(0, 8)]);
    const { preparedGround, depotGround } = assets.rules;
    assert.equal(preparedGround.length, 4);
    assert.equal(depotGround.length, 3);
    for (const number of preparedGround) {
      assert.ok(table[number]!.noLanding && table[number]!.sitePart === null, `prepared ground ${number}`);
      assert.equal(table[number]!.terrainClass, 128);
    }
    for (const number of depotGround) {
      assert.ok(table[number]!.sitePart === 'depot' && table[number]!.site === null, `depot ground ${number}`);
    }
    assert.equal(assets.rules.sharedKinds, null);
  });

  test(`${profile.title}: every map loads, draws and starts a battle`, { skip }, async () => {
    const assets = await loadAssets(files, profile);
    const { tiles, terrainTypes: table } = assets.tilesets.summer;
    const maps = await listMaps(files);
    assert.equal(maps.length, 34);
    assert.ok(maps.every((map) => /^[A-Z]{5}$/.test(map.code) && map.season === 'summer'));
    let units = 0;
    let misplaced = 0;
    let ships = 0;
    let changed = 0;
    for (const info of maps) {
      const { map, shops, computerTable } = await loadMap(files, info.id, profile);
      assert.equal(computerTable !== null, info.singlePlayer, `map ${info.id}`);
      if (computerTable) assert.equal(computerTable.length, profile.unitKinds);
      map.terrain.forEach((terrain) => assert.ok(tiles[terrain] && table[terrain], `map ${info.id}: terrain ${terrain}`));
      map.units.forEach((code, at) => {
        if (code === NO_UNIT) return;
        const type = assets.unitTypes[splitUnitCode(code).type];
        assert.ok(type, `map ${info.id}: unit code ${code}`);
        units++;
        if (type.movementBudget > 0 && !canEnter(type.terrainMask, table[map.terrain[at]!]!)) misplaced++;
      });
      for (const type of shops.buildable) assert.ok(assets.unitTypes[type], `map ${info.id}: buildable kind ${type}`);

      const state = createGame(map, assets.unitTypes, table, shops, assets.rules);
      // Both sides have a headquarters, and nobody else.
      const headquarters = state.buildings.filter((building) => building.kind === 'headquarters');
      assert.deepEqual(headquarters.map((building) => building.owner).sort(), [0, 1], `map ${info.id}`);
      // A ship's second half lies where the battle puts it: a row above the first side's first half, a row below the second's.
      changed += state.map.units.filter((code, at) => code !== map.units[at]).length;
      ships += state.units.filter((unit) => unit.tail).length;

      const { width, height } = mapPixelSize(map);
      const surface = renderMap(map, assets, { season: 'summer', palette: 0, showUnits: true });
      assert.deepEqual([surface.width, surface.height], [width, height]);
    }
    assert.ok(units > 1000, `${units} units`);
    assert.ok(ships > 40, `${ships} ships`);
    // One unit in all three games is laid out otherwise: on map 16 of The Moon the
    // rear of one kind lies above the front of another.
    assert.ok(changed <= 1, `${changed} fields of second halves are not where the maps have them`);
    // Units start on ground their kind can enter, a handful aside: the terrain classes are read rightly.
    assert.ok(misplaced * 100 < units, `${misplaced} of ${units} units start on ground they cannot enter`);
  });

  test(`${profile.title}: the computer plays both sides of every map, and a battle can be saved`, { skip }, async () => {
    const assets = await loadAssets(files, profile);
    const table = assets.tilesets.summer.terrainTypes;
    const totals = { fights: 0, captures: 0, built: 0, moved: 0 };
    for (const info of await listMaps(files)) {
      const loaded = await loadMap(files, info.id, profile);
      let state = createGame(loaded.map, assets.unitTypes, table, loaded.shops, assets.rules);
      let seed = Number(info.id) + 1;
      const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
      for (let half = 0; half < 12 && state.winner === null; half++) {
        for (const side of [attackerSide(state), state.mover]) {
          const turn = computerPlay(state, side, { table: computerTableFor(assets, loaded, info.id, side), random });
          totals.built += turn.built.length;
          totals.moved += turn.moves.length;
        }
        const report = endHalf(state);
        totals.fights += report.fights.length;
        totals.captures += report.captures.length;
        // Half way, the battle is saved and taken up again, and goes on as it was.
        if (half === 5) {
          const again = restoreGame(JSON.parse(JSON.stringify(saveGame(state))), assets.unitTypes, table, assets.rules);
          assert.deepEqual(saveGame(again), saveGame(state), `map ${info.id}`);
          state = again;
        }
      }
      for (const unit of state.units) {
        if (unit.destroyed) continue;
        assert.ok(unit.count > 0 && unit.count <= (assets.unitTypes[unit.type]!.groupSize || 1), `map ${info.id}`);
      }
    }
    assert.ok(totals.moved > 1000 && totals.fights > 500, JSON.stringify(totals));
    assert.ok(totals.captures > 10 && totals.built > 100, JSON.stringify(totals));
  });
}

// --- Battle Isle's maps rebuilt as History Line maps ---------------------------

for (const id of REBUILT_GAMES) {
  const profile = GAMES[id];
  const missing = [profile, GAMES.historyline].find((game) => !existsSync(gameDir(game)));
  const skip = missing ? `${missing.title} not found at ${gameDir(missing)}` : false;
  const files = diskFiles(profile);

  test(`${profile.title}: the sides its road tiles lead out by are the ones its maps use`, { skip }, async () => {
    const assets = await loadAssets(files, profile);
    const { terrainTypes: table, tileNames } = assets.tilesets.summer;
    const isRoad = (terrain: number) => table[terrain]!.terrainClass === 8 && !table[terrain]!.site;
    const takesRoad = (terrain: number) => isRoad(terrain) || table[terrain]!.site !== null;
    // For every road tile and side: how often the field on that side is a road too.
    const seen = new Map<string, [joined: number, all: number][]>();
    for (const info of await listMaps(files)) {
      const { map } = await loadMap(files, info.id, profile);
      map.terrain.forEach((terrain, at) => {
        if (!isRoad(terrain)) return;
        const name = tileNames[terrain]!;
        const counts = seen.get(name) ?? Array.from({ length: 6 }, (): [number, number] => [0, 0]);
        seen.set(name, counts);
        for (let direction = 0; direction < 6; direction++) {
          const near = fieldTowards({ column: at % map.columns, row: Math.floor(at / map.columns) }, direction);
          if (near.column < 0 || near.column >= map.columns || near.row < 0 || near.row >= map.rows) continue;
          counts[direction]![1]++;
          if (takesRoad(map.terrain[near.row * map.columns + near.column]!)) counts[direction]![0]++;
        }
      });
    }
    assert.deepEqual([...seen.keys()].sort(), Object.keys(ROAD_SIDES[id]).sort());
    for (const [name, counts] of seen) {
      const sides = counts.reduce((bits, [joined, all], direction) => bits | (all > 0 && joined / all >= 0.4 ? 1 << direction : 0), 0);
      // A side counts as one the tile leads out by if a road lies beyond it on two maps' fields in five:
      // for most tiles it is nearly always or hardly ever, for the docks and one crossing in between.
      assert.equal(sides, ROAD_SIDES[id][name], name);
    }
  });

  test(`${profile.title}: every map is rebuilt as a History Line map that can be played`, { skip }, async () => {
    const [theirs, ours] = await Promise.all([loadAssets(files, profile), loadAssets(diskFiles(), GAMES.historyline)]);
    const table = ours.tilesets.summer.terrainTypes;
    const totals = { units: 0, kept: 0, problems: 0, fields: 0, fights: 0 };
    for (const info of await listMaps(files)) {
      const loaded = await loadMap(files, info.id, profile);
      const sketch = sketchFromBattleIsle({
        game: id,
        title: `${profile.title} ${info.id}`,
        map: loaded.map,
        shops: loaded.shops,
        terrainTypes: theirs.tilesets.summer.terrainTypes,
        tileNames: theirs.tilesets.summer.tileNames,
        isTransport: theirs.unitTypes.map((type) => type.isTransport),
      });
      const built = buildMap(sketch, { unitTypes: ours.unitTypes, terrainTypes: table });
      // The same size, but for a row more where a building reaches below Battle Isle's map.
      assert.equal(built.map.columns, loaded.map.columns, `map ${info.id}`);
      assert.ok(built.map.rows >= loaded.map.rows && built.map.rows <= loaded.map.rows + 2, `map ${info.id}`);
      // What the builder could not do is of a few known kinds: a coast or a road History Line has no tile for,
      // and a unit whose History Line kind cannot stand where Battle Isle's stood.
      for (const problem of built.problems) {
        assert.match(problem, /do not join|^no tile has|stands on ground it cannot enter|stands on a building|has no room|already is/, `map ${info.id}`);
      }
      totals.problems += built.problems.length;
      totals.fields += loaded.map.columns * loaded.map.rows;

      const state = createGame(built.map, ours.unitTypes, table, built.shops, ours.rules);
      // The same buildings on the same fields, with the same owners.
      const original = createGame(loaded.map, theirs.unitTypes, theirs.tilesets.summer.terrainTypes, loaded.shops, theirs.rules);
      const buildingsOf = (game: typeof state) =>
        game.buildings.map((building) => `${building.kind} ${building.owner} ${building.entrance.column},${building.entrance.row} ${building.resources}`).sort();
      assert.deepEqual(buildingsOf(state), buildingsOf(original), `map ${info.id}`);
      // Every unit but Aldinium, mines and what flies or sails inside something History Line has no like of.
      const their = original.units.filter((unit) => !unit.inside).length;
      const kept = state.units.filter((unit) => !unit.inside).length;
      assert.ok(kept <= their, `map ${info.id}: ${kept} of ${their} units`);
      totals.units += their;
      totals.kept += kept;
      for (const unit of state.units) {
        // German kinds for the first side, French for the second.
        if (unit.side === 0) assert.ok(unit.type <= 35, `map ${info.id}: ${ours.unitTypes[unit.type]!.name}`);
        if (unit.side === 1) assert.ok(unit.type >= 10, `map ${info.id}: ${ours.unitTypes[unit.type]!.name}`);
      }
      let seed = Number(info.id) + 1;
      const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
      for (let half = 0; half < 4 && state.winner === null; half++) {
        for (const side of [attackerSide(state), state.mover]) computerPlay(state, side, { table: ours.computerTables[side], random });
        totals.fights += endHalf(state).fights.length;
      }
    }
    assert.ok(totals.kept > totals.units * 0.85, JSON.stringify(totals));
    // The tiles follow the maps on most fields. A coast History Line cannot draw is told twice, once from
    // each of the two fields that do not join.
    assert.ok(totals.problems < totals.fields * 0.25, JSON.stringify(totals));
    assert.ok(totals.fights > 50, JSON.stringify(totals));
  });
}

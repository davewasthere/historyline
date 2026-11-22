// Making maps from sketches: the tile choices, and the table of what the
// tiles show. The checks against the installed game are skipped when the
// game's folder is not there.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { NO_UNIT } from '../src/formats/map.ts';
import { entranceTerrain, TERRAIN_CLASSES } from '../src/formats/terrain.ts';
import { computerPlay } from '../src/game/computer.ts';
import { directionTo, fieldTowards } from '../src/game/movement.ts';
import { attackerSide, createGame, endHalf } from '../src/game/state.ts';
import {
  buildingPiece,
  DEEP_WATER,
  GROUND,
  SCENERY,
  SHALLOW_TILES,
  sidesAgree,
  TILE_COUNT,
  TILE_SIDES,
  type Piece,
} from '../src/maps/pieces.ts';
import { buildMap, lineBetween, type MapSketch, type SketchUnitType } from '../src/maps/sketch.ts';
import { listMaps, loadAssets, loadMap } from '../src/viewer/assets.ts';
import { diskFiles, gameDir } from '../tools/gameFiles.ts';

const skip = existsSync(gameDir()) ? false : `game not found at ${gameDir()}`;
const files = diskFiles();

// Unit kinds for the sketches below: a soldier, a truck, a ship of two fields and its second half.
const kind = (overrides: Partial<SketchUnitType>): SketchUnitType => ({
  terrainMask: 16,
  isTransport: false,
  isShipHalf: false,
  isShipBack: false,
  ...overrides,
});
const unitTypes: SketchUnitType[] = [
  kind({ name: 'SOLDIER' }),
  kind({ name: 'TRUCK', isTransport: true }),
  kind({ name: 'SHIP', isShipHalf: true, terrainMask: 1 }),
  kind({ name: 'SHIP', isShipHalf: true, isShipBack: true, terrainMask: 1 }),
];
const rules = { unitTypes };

/** A sketch of open grass of a size, with whatever else is given. */
function grass(columns: number, rows: number, rest: Partial<MapSketch> = {}): MapSketch {
  return { title: 'test', ground: Array.from({ length: rows }, () => '.'.repeat(columns)), ...rest };
}

/** The headquarters every battle needs, out of the way in a map at least 12 by 8. */
const BOTH_HEADQUARTERS: MapSketch['buildings'] = [
  { kind: 'headquarters', owner: 'german', at: [9, 1] },
  { kind: 'headquarters', owner: 'french', at: [9, 4] },
];

function tileAt(built: ReturnType<typeof buildMap>, column: number, row: number): number {
  return built.map.terrain[row * built.map.columns + column]!;
}

test('a line between two fields steps from neighbour to neighbour', () => {
  for (const [from, to] of [[[0, 0], [7, 5]], [[6, 6], [1, 0]], [[3, 1], [3, 6]], [[2, 2], [2, 2]]] as const) {
    const line = lineBetween(from, to);
    assert.deepEqual(line[0], from);
    assert.deepEqual(line.at(-1), to);
    for (let i = 1; i < line.length; i++) {
      const step = directionTo({ column: line[i - 1]![0], row: line[i - 1]![1] }, { column: line[i]![0], row: line[i]![1] });
      assert.ok(step >= 0, `${line[i - 1]} and ${line[i]} are neighbours`);
    }
  }
  assert.deepEqual(lineBetween([3, 1], [3, 4]), [[3, 1], [3, 2], [3, 3], [3, 4]]);
});

test('a road takes the piece that leaves each field by the right sides', () => {
  // Down column 2, then off to the lower right.
  const built = buildMap(grass(12, 8, { roads: [[[2, 0], [2, 3], [3, 3], [4, 4]]], buildings: BOTH_HEADQUARTERS }), rules);
  assert.deepEqual(built.problems, []);
  assert.equal(tileAt(built, 2, 1), 0x7f, 'straight down');
  assert.equal(tileAt(built, 2, 3), 0x83, 'in from above, out to the lower right');
  assert.equal(tileAt(built, 3, 3), 0x81, 'straight from upper left to lower right');
  // The road ends on 4, 4, and no piece is an end: it runs to the far side of the field.
  assert.equal(tileAt(built, 4, 4), 0x81);
  assert.equal(tileAt(built, 2, 0), 0x7f);
});

test('a track that meets a paved road joins it at a paved fork', () => {
  const built = buildMap(
    grass(12, 8, { roads: [[[3, 0], [3, 6]]], tracks: [[[0, 3], [3, 3]]], buildings: BOTH_HEADQUARTERS }),
    rules,
  );
  assert.deepEqual(built.problems, []);
  // Odd columns sit lower: the field to the upper left of 3, 3 is 2, 3.
  assert.equal(tileAt(built, 3, 3), 0x8d, 'the road above and below, and a branch to the upper left');
  assert.equal(TILE_SIDES[tileAt(built, 2, 3)]![2], 'T', 'the track runs up to it');
});

test('a turn too sharp for any piece is a problem, and the field stays plain', () => {
  const built = buildMap(grass(12, 8, { roads: [[[2, 0], [2, 3], [3, 2]]], buildings: BOTH_HEADQUARTERS }), rules);
  assert.equal(built.problems.length, 1);
  assert.match(built.problems[0]!, /no tile has a road above, a road upper right and nothing else, wanted at 2, 3/);
  assert.ok(GROUND['.']!.includes(tileAt(built, 2, 3)));
});

test('a road crosses a river on a bridge, and the river runs out into water', () => {
  // A bay in the lower left, with the river coming down into the head of it.
  const ground = [
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '...-.-......',
    '.-------....',
    '---------...',
    '---------...',
    '---------...',
    '---------...',
  ];
  const built = buildMap(
    {
      title: 'test',
      ground,
      // Slantwise across column 6, then straight down column 4 into the water.
      rivers: [[[7, 3], [5, 4], [4, 5], [4, 7]]],
      roads: [[[6, 0], [6, 5]]],
      buildings: BOTH_HEADQUARTERS,
    },
    rules,
  );
  assert.deepEqual(built.problems, []);
  assert.equal(tileAt(built, 6, 4), 0x75, 'the road above and below, the river from upper right to lower left');
  assert.equal(tileAt(built, 4, 5), 0x29, 'the river turns to run straight down');
  assert.equal(tileAt(built, 4, 6), 0x26);
  assert.equal(tileAt(built, 4, 7), 0x19, 'open water at the head of the bay, where the river runs out');
  assert.deepEqual([tileAt(built, 3, 6), tileAt(built, 5, 6)], [0x1f, 0x1f], 'the shore on either side of the river mouth');
});

test('shallow water beside land becomes the shore that fits', () => {
  const ground = Array.from({ length: 8 }, () => '~-..........');
  const built = buildMap({ title: 'test', ground, buildings: BOTH_HEADQUARTERS }, rules);
  assert.deepEqual(built.problems, []);
  for (let row = 0; row < 7; row++) {
    assert.equal(tileAt(built, 0, row), DEEP_WATER);
    assert.equal(tileAt(built, 1, row), 0x21, 'land to the upper and lower right, water to the left');
  }
  // In the last row the field to the lower right is off the map, and two shores fit.
  assert.ok([0x21, 0x1d].includes(tileAt(built, 1, 7)));
});

test('deep water against land is a shore nothing can draw', () => {
  const ground = Array.from({ length: 8 }, () => '~...........');
  const built = buildMap({ title: 'test', ground, buildings: BOTH_HEADQUARTERS }, rules);
  assert.ok(built.problems.length > 0);
  assert.match(built.problems[0]!, /do not join: (land against water|water against land)/);
});

test('buildings are put down whole and recorded in the order the map is read', () => {
  const built = buildMap(
    grass(14, 10, {
      buildings: [
        { kind: 'factory', owner: 'french', at: [4, 7], income: 12, holds: ['SOLDIER'] },
        { kind: 'headquarters', owner: 'german', at: [9, 1], holds: ['soldier', 0] },
        { kind: 'factory', owner: 'neutral', at: [4, 2] },
        { kind: 'headquarters', owner: 'french', at: [9, 5] },
        { kind: 'depot', owner: 'german', at: [12, 6] },
      ],
    }),
    rules,
  );
  assert.deepEqual(built.problems, []);
  // The German headquarters: its entrance, the field in its middle, and the ring around that.
  assert.equal(tileAt(built, 9, 1), 0x01);
  assert.equal(tileAt(built, 9, 2), 0x03);
  assert.equal(tileAt(built, 9, 3), 0x04);
  assert.deepEqual([tileAt(built, 10, 2), tileAt(built, 10, 3), tileAt(built, 8, 3), tileAt(built, 8, 2)], [0x07, 0x08, 0x06, 0x05]);
  // The factory lies to the left of its entrance.
  assert.deepEqual([tileAt(built, 4, 2), tileAt(built, 3, 1), tileAt(built, 3, 2), tileAt(built, 2, 2)], [0x0c, 0x09, 0x0a, 0x0b]);
  const records = built.shops.shops.map((shop) => [shop.owner, shop.kind, shop.index, shop.resources, shop.contents]);
  assert.deepEqual(records, [
    [0, 0, 0, 10, [0, 0]],
    [2, 1, 0, 15, []],
    [1, 0, 1, 10, []],
    [0, 2, 0, 10, []],
    [1, 1, 1, 12, [0]],
  ]);
});

test('units go on the map, a transport with what it carries', () => {
  const sketch = grass(12, 8, {
    buildings: BOTH_HEADQUARTERS,
    units: [
      { kind: 'TRUCK', side: 'french', at: [1, 6], holds: ['SOLDIER', 'SOLDIER'] },
      { kind: 'SOLDIER', side: 'german', at: [[1, 1], [2, 1]] },
      { kind: 'TRUCK', side: 'german', at: [3, 1] },
    ],
  });
  const built = buildMap(sketch, rules);
  assert.deepEqual(built.problems, []);
  const code = (column: number, row: number) => built.map.units[row * built.map.columns + column];
  assert.deepEqual([code(1, 1), code(2, 1), code(3, 1), code(1, 6), code(0, 0)], [0, 0, 2, 3, NO_UNIT]);
  // The French truck is the second transport as the map is read.
  const cargo = built.shops.shops.find((shop) => shop.kind === 3);
  assert.deepEqual(cargo, { owner: 1, kind: 3, index: 1, resources: 0, worth: 0, contents: [0, 0] });
});

test('what cannot be is said, with its field', () => {
  const built = buildMap(
    grass(12, 8, {
      buildings: [{ kind: 'headquarters', owner: 'german', at: [9, 1] }, { kind: 'depot', owner: 'neutral', at: [9, 2] }],
      scenery: [{ piece: 'mountain', at: [0, 7] }, { piece: 'volcano', at: [5, 5] }],
      units: [
        { kind: 'DRAGON', side: 'german', at: [1, 1] },
        { kind: 'SOLDIER', side: 'german', at: [[2, 2], [2, 2]] },
        { kind: 'SHIP', side: 'german', at: [4, 0] },
      ],
    }),
    rules,
  );
  const said = (pattern: RegExp) => assert.ok(built.problems.some((problem) => pattern.test(problem)), `${pattern} in ${built.problems.join(' | ')}`);
  said(/the depot at 9, 2 lies over something else at 9, 2/);
  said(/the mountain at 0, 7 reaches off the map/);
  said(/no piece of scenery called "volcano"/);
  said(/no unit kind "DRAGON"/);
  said(/the german SOLDIER at 2, 2 stands where another unit already is/);
  said(/the german SHIP at 4, 0 has no room for its second half/);
  said(/the french side has 0 headquarters/);
  assert.throws(() => buildMap({ title: 'test', ground: ['....', '...', '....', '....'] }, rules), /row 1 has 3 fields/);
  assert.throws(() => buildMap({ title: 'test', ground: ['....', '..x.', '....', '....'] }, rules), /the letter "x"/);
});

test('the same sketch always makes the same map, and the seed changes its looks', () => {
  const one = buildMap(grass(12, 8, { buildings: BOTH_HEADQUARTERS }), rules);
  const again = buildMap(grass(12, 8, { buildings: BOTH_HEADQUARTERS }), rules);
  const other = buildMap(grass(12, 8, { buildings: BOTH_HEADQUARTERS, seed: 99 }), rules);
  assert.deepEqual(one.map.terrain, again.map.terrain);
  assert.notDeepEqual(one.map.terrain, other.map.terrain);
});

test('sides that face each other: what goes together', () => {
  assert.ok(sidesAgree('R', 'R') && sidesAgree('R', 'T') && sidesAgree('T', 'g') && sidesAgree('V', 'w') && sidesAgree('?', 'w'));
  assert.ok(!sidesAgree('g', 'w') && !sidesAgree('R', 'L') && !sidesAgree('R', 'w') && !sidesAgree('L', 'V'));
  assert.equal(TILE_SIDES.length, TILE_COUNT);
  for (const sides of TILE_SIDES) assert.match(sides, /^[gwRTLV?]{6}$/);
});

// --- against the installed game ----------------------------------------------

test('the table of sides agrees with how the original maps put tiles together', { skip }, async () => {
  let pairs = 0;
  let disagreeing = 0;
  for (const info of await listMaps(files)) {
    const { map } = await loadMap(files, info.id);
    let here = 0;
    let wrong = 0;
    for (let row = 0; row < map.rows; row++) {
      for (let column = 0; column < map.columns; column++) {
        for (let direction = 0; direction < 3; direction++) {
          const near = fieldTowards({ column, row }, direction);
          if (near.column < 0 || near.row < 0 || near.column >= map.columns || near.row >= map.rows) continue;
          const side = TILE_SIDES[map.terrain[row * map.columns + column]!]![direction]!;
          const facing = TILE_SIDES[map.terrain[near.row * map.columns + near.column]!]![direction + 3]!;
          here++;
          if (!sidesAgree(side, facing)) wrong++;
        }
      }
    }
    // The originals have a few shores no tile fits, mostly shallow water straight above or below land.
    assert.ok(wrong / here < 0.02, `map ${info.id}: ${wrong} of ${here} joins disagree`);
    pairs += here;
    disagreeing += wrong;
  }
  assert.ok(pairs > 190000);
  assert.ok(disagreeing / pairs < 0.005, `${disagreeing} of ${pairs} joins disagree`);
});

test('the larger pieces are how the original maps lay those tiles', { skip }, async () => {
  const pieces: [string, Piece][] = [
    ...Object.entries(SCENERY).filter(([name]) => name !== 'town'),
    ['german headquarters', buildingPiece('headquarters', 'german')!],
    ['french headquarters', buildingPiece('headquarters', 'french')!],
    ['neutral factory', buildingPiece('factory', 'neutral')!],
    ['german depot', buildingPiece('depot', 'german')!],
  ];
  const found = new Map<string, { whole: number; broken: number }>(pieces.map(([name]) => [name, { whole: 0, broken: 0 }]));
  for (const info of await listMaps(files)) {
    const { map } = await loadMap(files, info.id);
    for (let at = 0; at < map.terrain.length; at++) {
      for (const [name, piece] of pieces) {
        if (map.terrain[at] !== piece[0]!.tile) continue;
        const anchor = { column: at % map.columns, row: Math.floor(at / map.columns) };
        const fields = piece.map(({ steps }) => steps.reduce(fieldTowards, anchor));
        // A piece cut off by the map's edge says nothing either way.
        if (fields.some((f) => f.column < 0 || f.row < 0 || f.column >= map.columns || f.row >= map.rows)) continue;
        const whole = fields.every((f, part) => map.terrain[f.row * map.columns + f.column] === piece[part]!.tile);
        found.get(name)![whole ? 'whole' : 'broken']++;
      }
    }
  }
  for (const [name, { whole, broken }] of found) {
    assert.ok(whole >= 20, `${name}: found whole ${whole} times`);
    // Only the two-field ridge is ever found apart: a few maps use one half alone.
    assert.ok(broken <= (name === 'ridge' ? whole * 0.15 : 0), `${name}: ${broken} broken, ${whole} whole`);
  }
});

test('the table names the terrain the game means', { skip }, async () => {
  const assets = await loadAssets(files);
  const classBit = (name: string) => TERRAIN_CLASSES.find((entry) => entry.name === name)!.bit;
  for (const season of ['summer', 'winter'] as const) {
    const { terrainTypes } = assets.tilesets[season];
    assert.equal(terrainTypes.length, TILE_COUNT);
    for (const owner of ['german', 'french', 'neutral'] as const) {
      for (const kind of ['headquarters', 'factory', 'depot'] as const) {
        const side = owner === 'german' ? 0 : owner === 'french' ? 1 : null;
        assert.equal(buildingPiece(kind, owner)?.[0]!.tile ?? -1, entranceTerrain(terrainTypes, kind, side), `${owner} ${kind}`);
      }
    }
    const classes = (letter: string) => new Set(GROUND[letter]!.map((tile) => terrainTypes[tile]!.terrainClass));
    assert.deepEqual([...classes('.')], [classBit('open ground, roads')]);
    assert.deepEqual([...classes('f')], [classBit('forest, houses')]);
    assert.deepEqual([...classes('h')], [classBit('forest, houses')]);
    assert.deepEqual([...classes('t')], [classBit('trenches')]);
    assert.deepEqual([...classes('-')], [classBit('shallow water')]);
    assert.deepEqual([...classes('~')], [classBit('deep water')]);
    assert.deepEqual([...classes('^'), ...classes('r')], [classBit('mountains, narrow bridges'), classBit('mountains, narrow bridges')]);
    // Wire is open to what can climb, and to nothing that needs open ground.
    const [wire] = [...classes('#')];
    assert.ok(wire! & classBit('mountains, narrow bridges'));
    assert.equal(wire! & classBit('open ground, roads'), 0);
    for (const tile of SHALLOW_TILES) {
      // A shore is shallow water; a bridge over it, or the end of one, is road.
      const expected = TILE_SIDES[tile]!.includes('R') ? classBit('open ground, roads') : classBit('shallow water');
      assert.equal(terrainTypes[tile]!.terrainClass, expected, `tile ${tile}`);
    }
    TILE_SIDES.forEach((sides, tile) => {
      // Rails are rail wherever a railway is all that crosses the tile.
      if (/^[Lg]+$/.test(sides) && sides.includes('L')) assert.equal(terrainTypes[tile]!.terrainClass, classBit('rail'), `tile ${tile}`);
    });
  }
});

test('every sketch in maps/ makes a sound map the computer can fight on', { skip }, async () => {
  const assets = await loadAssets(files);
  const folder = join(import.meta.dirname, '..', 'maps');
  const names = readdirSync(folder).filter((name) => name.endsWith('.json'));
  assert.ok(names.length > 0);
  for (const name of names) {
    const sketch = JSON.parse(readFileSync(join(folder, name), 'utf8')) as MapSketch;
    const terrainTypes = assets.tilesets[sketch.season ?? 'summer'].terrainTypes;
    const built = buildMap(sketch, { unitTypes: assets.unitTypes, terrainTypes });
    assert.deepEqual(built.problems, [], name);
    const state = createGame(built.map, assets.unitTypes, terrainTypes, built.shops);
    for (const side of [0, 1] as const) {
      assert.equal(state.buildings.filter((b) => b.kind === 'headquarters' && b.owner === side).length, 1, name);
      assert.ok(state.units.some((unit) => unit.side === side && unit.inside === null), `${name}: side ${side} has units on the map`);
    }
    // Every building the sketch asks for is one, and holds what the sketch put in it.
    assert.equal(state.buildings.length, sketch.buildings?.length ?? 0, name);
    const inside = state.buildings.reduce((sum, building) => sum + building.units.length, 0);
    assert.equal(inside, (sketch.buildings ?? []).reduce((sum, building) => sum + (building.holds?.length ?? 0), 0), name);
    let moves = 0;
    while (state.round <= 6 && state.winner === null) {
      for (const side of [attackerSide(state), state.mover]) {
        moves += computerPlay(state, side, { table: assets.computerTables[side], random: () => 0.5 }).moves.length;
      }
      endHalf(state);
    }
    assert.ok(moves > 10, `${name}: the computer moved ${moves} times`);
  }
});

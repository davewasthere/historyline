// Tests of reading Battle Isle 2's files and drawing its missions. Those of
// the game's own files need its CD image and are skipped where it is not
// installed.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listMissions, loadBi2Assets, loadBi2Game, loadMission, UNIT_PICTURES } from '../src/bi2/assets.ts';
import {
  decodeMission,
  decodePartTable,
  decodeTextLines,
  decodeTile,
  isWayMarker,
  mirrored,
  NOTHING,
  splitUnit,
  TILE_SIZE,
  WAY_PIECES,
  wayPiece,
  waysOf,
} from '../src/bi2/formats.ts';
import { BI2_DISKS } from '../src/bi2/games.ts';
import { missionPixelSize, renderMission } from '../src/bi2/render.ts';
import { readPlainArchive } from '../src/formats/archive.ts';
import { openCdImage } from '../tools/cdImage.ts';
import { bi2Files, bi2ImagePath, installedBi2Disks } from '../tools/gameFiles.ts';

const bytes = (text: string) => [...text].map((letter) => letter.charCodeAt(0));
const u16 = (value: number) => [value & 0xff, value >> 8];
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)];

// --- the file forms, on data made up here ----------------------------------

test('a library with a TCT header has its entries after it, unpacked', () => {
  const name = (text: string) => bytes(text.padEnd(8, '\0'));
  // Two entries of four bytes; the first starts with the letters a packed block would, and is left as it is.
  const file = Uint8Array.of(...u32(20), ...bytes('TCT '), ...u16(2), ...u16(0x49), ...bytes('TPWM'), 5, 6, 7, 8, ...name('PART0000'), ...u32(12), ...name('PART0001'), ...u32(16));
  assert.deepEqual(readPlainArchive(file), [
    { name: 'PART0000', data: Uint8Array.from(bytes('TPWM')) },
    { name: 'PART0001', data: Uint8Array.of(5, 6, 7, 8) },
  ]);
  // Without the header the first entry starts at 4, as in History Line.
  const plain = Uint8Array.of(...u32(8), 1, 2, 3, 4, ...name('UNIT000O'), ...u32(4));
  assert.deepEqual(readPlainArchive(plain), [{ name: 'UNIT000O', data: Uint8Array.of(1, 2, 3, 4) }]);
});

test('a tile is 24 by 24 pixels in four planes, with no header', () => {
  // Each byte says which plane it is in and where: plane p's nth byte is 16 p + n mod 16.
  const data = Uint8Array.from({ length: 576 }, (_, at) => (Math.floor(at / 144) << 4) | (at % 144 % 16));
  const tile = decodeTile(data, 0x8f);
  assert.deepEqual([tile.width, tile.height, tile.transparent], [TILE_SIZE, TILE_SIZE, 0x8f]);
  // Plane p holds the pixels at x = p, p + 4, ...: six to a row.
  assert.deepEqual([...tile.pixels.subarray(0, 8)], [0x00, 0x10, 0x20, 0x30, 0x01, 0x11, 0x21, 0x31]);
  assert.equal(tile.pixels[TILE_SIZE], 0x06);
  assert.throws(() => decodeTile(data.subarray(1), 0), /576 bytes/);
});

/** A mission file with a map of 3 by 2 fields. */
function missionFile(): Uint8Array {
  const map = [...bytes('ACTN'), ...u16(3), ...u16(2)];
  const ground = [10, 11, 12, 13, 14, 15];
  const objects = [NOTHING, 0x5a, NOTHING, 300, NOTHING, NOTHING];
  const units = [NOTHING, NOTHING, 0x0107, NOTHING, 0x4002, NOTHING];
  for (const value of [...ground, ...objects, ...units]) map.push(...u16(value));
  return Uint8Array.of(...bytes('MSSN'), ...u32(0), ...u32(0), ...u32(0), ...u32(24), ...u32(0), ...map);
}

test('a mission file gives the map as ground, what stands on it, and units', () => {
  const mission = decodeMission(missionFile());
  assert.deepEqual([mission.columns, mission.rows], [3, 2]);
  assert.deepEqual([...mission.ground], [10, 11, 12, 13, 14, 15]);
  assert.deepEqual([...mission.objects], [NOTHING, 0x5a, NOTHING, 300, NOTHING, NOTHING]);
  // A unit is its kind and one bit for its owner.
  assert.deepEqual(splitUnit(mission.units[2]!), { type: 7, player: 0 });
  assert.deepEqual(splitUnit(mission.units[4]!), { type: 2, player: 6 });
  assert.throws(() => decodeMission(Uint8Array.from(bytes('NOPE'))), /not a mission/);
  assert.throws(() => decodeMission(missionFile().subarray(0, 40)), /does not fit/);
});

test('the part table says which parts are ways and which picture each weather has', () => {
  const record = (kinds: number, pictures: number[]) => {
    const data = new Uint8Array(46);
    data.set(u32(kinds), 6);
    pictures.forEach((picture, weather) => data.set(u16(picture), 20 + 2 * weather));
    return data;
  };
  const table = decodePartTable(Uint8Array.of(...record(0x200, [0, 0, 7, 7, 0]), ...record(0x9, [1, 1, 1, 1, 1])));
  assert.deepEqual(table[0], { kinds: 0x200, pictures: [0, 0, 7, 7, 0] });
  assert.deepEqual(waysOf(table[0]), []);
  // A road and a rail on one field.
  assert.deepEqual(waysOf(table[1]), [0, 3]);
  assert.ok(isWayMarker(0x5a) && isWayMarker(0x4fb) && !isWayMarker(0x59) && !isWayMarker(300));
  assert.throws(() => decodePartTable(new Uint8Array(47)), /multiple of 46/);
});

test('every set of joined sides has a piece, mirrored if need be', () => {
  // A tile whose pixels tell where they came from.
  const tile = decodeTile(Uint8Array.from({ length: 576 }, (_, at) => at % 251), 0);
  const mirrorAcross = (sides: number) => [0, 5, 4, 3, 2, 1].reduce((out, from, to) => out | (((sides >> from) & 1) << to), 0);
  const mirrorDown = (sides: number) => [3, 2, 1, 0, 5, 4].reduce((out, from, to) => out | (((sides >> from) & 1) << to), 0);
  for (let sides = 0; sides < 64; sides++) {
    const { piece, across, down } = wayPiece(sides);
    // The piece, mirrored as told, joins exactly those sides.
    let joined = WAY_PIECES[piece]!;
    if (across) joined = mirrorAcross(joined);
    if (down) joined = mirrorDown(joined);
    assert.equal(joined, sides, sides.toString(2));
  }
  assert.equal(new Set(WAY_PIECES).size, 24);
  assert.equal(mirrored(tile, false, false), tile);
  assert.equal(mirrored(tile, true, false).pixels[0], tile.pixels[TILE_SIZE - 1]);
  assert.equal(mirrored(tile, false, true).pixels[0], tile.pixels[TILE_SIZE * (TILE_SIZE - 1)]);
  assert.deepEqual(mirrored(mirrored(tile, true, true), true, true).pixels, tile.pixels);
});

test('a text file is numbered lines in braces', () => {
  const lines = decodeTextLines(Uint8Array.from(bytes('\r\n#0000:0000{THE DELTA}\r\n#0001:0016{}\r\n\r\n#0016:0007{AMPORGE}\r\n')));
  assert.deepEqual([...lines], [[0, 'THE DELTA'], [1, ''], [16, 'AMPORGE']]);
});

/** A CD image with a folder GAME holding HELLO.TXT, as 2048-byte sectors. */
function cdImage(): Uint8Array {
  const sector = 2048;
  const image = new Uint8Array(22 * sector);
  const both = (value: number) => [...u32(value), ...u32(value).reverse()];
  const record = (name: string, at: number, length: number, directory: boolean) => {
    const size = 33 + name.length + ((33 + name.length) % 2);
    return [size, 0, ...both(at), ...both(length), 0, 0, 0, 0, 0, 0, 0, directory ? 2 : 0, 0, 0, 1, 0, 0, 1, name.length, ...bytes(name), ...(size > 33 + name.length ? [0] : [])];
  };
  const self = (at: number) => [...record('\0', at, sector, true), ...record('\x01', 18, sector, true)];
  image.set([1, ...bytes('CD001'), 1], 16 * sector);
  image.set(record('\0', 18, sector, true), 16 * sector + 156);
  image.set([...self(18), ...record('GAME', 19, sector, true)], 18 * sector);
  image.set([...self(19), ...record('HELLO.TXT;1', 20, 5, false)], 19 * sector);
  image.set(bytes('hello'), 20 * sector);
  return image;
}

test('files are read out of a CD image, in plain and in raw sectors', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cd-image-'));
  try {
    const plain = cdImage();
    // The same image as a raw MODE1 track: every sector with a header before it and padding after.
    const raw = new Uint8Array((plain.length / 2048) * 2352);
    for (let sector = 0; sector < plain.length / 2048; sector++) {
      raw.set([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 2, 0, 1], sector * 2352);
      raw.set(plain.subarray(sector * 2048, (sector + 1) * 2048), sector * 2352 + 16);
    }
    for (const [name, data] of [['plain.iso', plain], ['raw.gog', raw]] as const) {
      await writeFile(join(folder, name), data);
      const cd = await openCdImage(join(folder, name));
      assert.deepEqual(await cd.list('GAME'), ['HELLO.TXT'], name);
      assert.deepEqual(await cd.list(''), [], name);
      // Names are found whatever their case.
      assert.equal(Buffer.from(await cd.read('game/hello.txt')).toString(), 'hello', name);
      await assert.rejects(cd.read('GAME/NONE.TXT'), /not on the CD/);
      await assert.rejects(cd.read('GAME'), /is a folder/);
    }
    await writeFile(join(folder, 'not.iso'), new Uint8Array(20 * 2048));
    await assert.rejects(openCdImage(join(folder, 'not.iso')), /not an ISO 9660/);
  } finally {
    // The images stay open while the test runs; on Windows they cannot be removed until it ends.
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
});

// --- the games' own files ---------------------------------------------------

const EXPECTED = { bi2: { missions: 24, kinds: 54 }, bi2scenery: { missions: 26, kinds: 60 } } as const;

for (const disk of BI2_DISKS) {
  const id = disk.id;
  const skip = existsSync(bi2ImagePath(disk)) ? false : `Battle Isle 2's ${disk.folder} not found at ${bi2ImagePath(disk)}`;

  test(`Battle Isle 2, ${disk.title.toLowerCase()}: every mission loads and draws`, { skip }, async () => {
    const files = bi2Files(disk);
    const assets = await loadBi2Assets(files);
    assert.equal(assets.parts.length, 1335);
    assert.equal(assets.partTable.length, assets.parts.length);
    assert.equal(assets.unitSprites.length, EXPECTED[id].kinds * UNIT_PICTURES);
    assert.equal(assets.unitNames.length, EXPECTED[id].kinds);
    assert.equal(assets.unitNames[0], 'CONTR.VEH. ROAD');
    assert.ok(assets.wayPieces.length === 4 && assets.wayPieces.every((pieces) => pieces.length === 24));
    // A part's pictures are parts themselves.
    for (const part of assets.partTable) for (const picture of part.pictures) assert.ok(assets.parts[picture]);

    const missions = await listMissions(files, disk);
    assert.equal(missions.length, EXPECTED[id].missions);
    // Every mission has a name, a task and a password of seven letters.
    for (const info of missions) {
      assert.ok(info.title.length > 0 && info.about.length > 0, `mission ${info.id}`);
      assert.match(info.password, /^[A-Z]{7}$/, `mission ${info.id}`);
    }
    let units = 0;
    let ways = 0;
    for (const info of missions) {
      const mission = await loadMission(files, info.id);
      const fields = mission.columns * mission.rows;
      assert.ok(mission.columns >= 16 && mission.columns <= 64 && mission.rows >= 16 && mission.rows <= 64, `mission ${info.id}`);
      for (let field = 0; field < fields; field++) {
        assert.ok(assets.parts[mission.ground[field]!], `mission ${info.id}: ground part`);
        const object = mission.objects[field]!;
        if (object !== NOTHING) {
          assert.ok(assets.parts[object], `mission ${info.id}: object part ${object}`);
          // A part that stands for a way has a kind of way to draw.
          if (isWayMarker(object)) {
            ways++;
            assert.ok(waysOf(assets.partTable[object]).length > 0, `mission ${info.id}: part ${object}`);
          }
        }
        const unit = mission.units[field]!;
        if (unit === NOTHING) continue;
        units++;
        const { type, player } = splitUnit(unit);
        assert.ok(type < EXPECTED[id].kinds && player < 7, `mission ${info.id}: unit ${unit}`);
        // The owner is one bit, never two.
        assert.equal(unit >> 8, 1 << player, `mission ${info.id}`);
      }
      const surface = renderMission(mission, assets, { showUnits: true });
      const { width, height } = missionPixelSize(mission);
      assert.deepEqual([surface.width, surface.height], [width, height]);
      // The middle of the map is drawn: no field there is left empty.
      assert.notEqual(surface.pixels[Math.floor(height / 2) * width + Math.floor(width / 2)], 0, `mission ${info.id}`);
    }
    assert.ok(units > 1000 && ways > 1000, `${units} units, ${ways} fields of ways`);
  });
}

test('the two disks make one game: the missions of both, drawn with one set of tiles', { skip: installedBi2Disks().length < 2 ? 'both Battle Isle 2 disks are needed' : false }, async () => {
  const game = await loadBi2Game(BI2_DISKS.map((disk) => ({ disk, source: bi2Files(disk) })));
  assert.equal(game.missions.length, EXPECTED.bi2.missions + EXPECTED.bi2scenery.missions);
  // No two missions share a number, so a number names one whichever disk it is on.
  assert.equal(new Set(game.missions.map((info) => info.id)).size, game.missions.length);
  // They are in one list by number, the add-on's among the game's own: 017 is the add-on's, 016 and 021 the game's.
  const ids = game.missions.map((info) => info.id);
  assert.deepEqual(ids, ids.toSorted((a, b) => Number(a) - Number(b)));
  const around = game.missions.slice(ids.indexOf('016'), ids.indexOf('021') + 1);
  assert.deepEqual(around.map((info) => `${info.id} ${info.disk.id}`), ['016 bi2', '017 bi2scenery', '019 bi2scenery', '021 bi2']);
  assert.equal(game.missions.filter((info) => info.disk === BI2_DISKS[0]).length, EXPECTED.bi2.missions);
  // The tiles are the add-on's, which has the game's unit kinds unchanged and six more.
  assert.equal(game.assets.unitNames.length, EXPECTED.bi2scenery.kinds);
  const own = await loadBi2Assets(bi2Files(BI2_DISKS[0]!));
  assert.deepEqual(game.assets.unitNames.slice(0, EXPECTED.bi2.kinds), own.unitNames);
  own.unitSprites.forEach((sprite, number) => assert.deepEqual(game.assets.unitSprites[number]!.pixels, sprite.pixels));
  own.parts.forEach((part, number) => assert.deepEqual(game.assets.parts[number]!.pixels, part.pixels));
  assert.deepEqual(game.assets.partTable, own.partTable);
  // A mission is read from the disk it is on.
  for (const info of [game.missions[0]!, around[1]!, game.missions.at(-1)!]) {
    assert.deepEqual(await game.loadMission(info), await loadMission(bi2Files(info.disk), info.id));
  }
});

test('a disk that cannot be read is left out, and with none there is no game', async () => {
  const missing = { read: () => Promise.reject(new Error('gone')), list: () => Promise.reject(new Error('gone')) };
  await assert.rejects(loadBi2Game(BI2_DISKS.map((disk) => ({ disk, source: missing }))), /no Battle Isle 2 disk/);
});

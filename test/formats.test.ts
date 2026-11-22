// Decoder tests on hand-made data, so they run without the game installed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readArchive, readArchiveDirectory, readNameList } from '../src/formats/archive.ts';
import { decodeBitmap } from '../src/formats/bitmap.ts';
import { decodeMap, END_TERRAIN, NO_UNIT, splitUnitCode } from '../src/formats/map.ts';
import { decodePalette, rgba } from '../src/formats/palette.ts';
import { decodeShops } from '../src/formats/shops.ts';
import { isTpwm, unpackIfPacked, unpackTpwm } from '../src/formats/tpwm.ts';

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const u32le = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const tpwm = (size: number, stream: number[]) => new Uint8Array([...ascii('TPWM'), ...u32le(size), ...stream]);

test('TPWM copies literals', () => {
  const packed = tpwm(3, [0x00, 0x41, 0x42, 0x43]);
  assert.ok(isTpwm(packed));
  assert.deepEqual([...unpackTpwm(packed).data], ascii('ABC'));
});

test('TPWM back-references may overlap their own output', () => {
  // Literal "A", then copy 3 bytes from 1 back: the copy reads what it writes.
  const packed = tpwm(4, [0b0100_0000, 0x41, 0x00, 0x01]);
  assert.deepEqual([...unpackTpwm(packed).data], ascii('AAAA'));
});

test('TPWM distance takes its high bits from the first byte', () => {
  const literals = Array.from({ length: 300 }, (_, i) => i & 0xff);
  const stream: number[] = [];
  for (let i = 0; i < literals.length; i += 8) stream.push(0x00, ...literals.slice(i, i + 8));
  // 300 literals fill 37 full groups and 4 items of the 38th, so the
  // back-reference is that group's fifth item. Length 5, distance 0x12C (300).
  stream[37 * 9] = 0b0000_1000;
  stream.push(0x12, 0x2c);
  const { data, used } = unpackTpwm(tpwm(305, stream));
  assert.deepEqual([...data.subarray(300)], [0, 1, 2, 3, 4]);
  assert.equal(used, 8 + stream.length);
});

test('TPWM reports truncated and corrupt input', () => {
  assert.throws(() => unpackTpwm(tpwm(4, [0x00, 0x41])), /ran out/);
  assert.throws(() => unpackTpwm(tpwm(4, [0x80, 0x00, 0x05])), /back-reference/);
  assert.throws(() => unpackTpwm(new Uint8Array(8)), /not a TPWM/);
});

test('unpackIfPacked leaves other data alone', () => {
  const plain = new Uint8Array([1, 2, 3]);
  assert.equal(unpackIfPacked(plain), plain);
});

function archive(entries: [string, number[]][]): Uint8Array {
  const bodies: number[] = [];
  const directory: number[] = [];
  for (const [name, body] of entries) {
    directory.push(...ascii(name.padEnd(8, ' ')), ...u32le(4 + bodies.length));
    bodies.push(...body);
  }
  return new Uint8Array([...u32le(4 + bodies.length), ...bodies, ...directory]);
}

test('archives list entries in directory order and unpack them', () => {
  const packedEntry = [...tpwm(4, [0b0100_0000, 0x5a, 0x00, 0x01])];
  const file = archive([
    ['FIRST', [1, 2, 3]],
    ['SECOND01', packedEntry],
  ]);
  const entries = readArchive(file);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['FIRST', 'SECOND01'],
  );
  assert.deepEqual([...entries[0]!.data], [1, 2, 3]);
  assert.deepEqual([...entries[1]!.data], ascii('ZZZZ'));
});

test('data that is not an archive is rejected', () => {
  assert.equal(readArchiveDirectory(new Uint8Array(64)), null);
  assert.throws(() => readArchive(new Uint8Array(64)), /not a library archive/);
});

test('name lists are split into 8-character names', () => {
  assert.deepEqual(readNameList(new Uint8Array(ascii('SPLAI152AB      '))), ['SPLAI152', 'AB']);
  assert.throws(() => readNameList(new Uint8Array(5)), /multiple of 8/);
});

function bitmapHeader(id: string, transparent: number, type: number, width: number, height: number): number[] {
  return [...ascii(id), transparent, type, 0, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8];
}

test('8-bit bitmaps are stored as four interleaved column planes', () => {
  // 8x2 image whose pixel value is y*8 + x.
  const planes: number[] = [];
  for (let plane = 0; plane < 4; plane++) {
    for (let y = 0; y < 2; y++) planes.push(y * 8 + plane, y * 8 + plane + 4);
  }
  const bitmap = decodeBitmap(new Uint8Array([...bitmapHeader('INFOILBM', 0x20, 0x55, 8, 2), ...planes]));
  assert.equal(bitmap.bitsPerPixel, 8);
  assert.equal(bitmap.transparent, 0x20);
  assert.deepEqual([...bitmap.pixels], Array.from({ length: 16 }, (_, i) => i));
});

test('4-bit bitmaps pack two plane pixels per byte, left one high', () => {
  // 8x1 image with pixel value x: plane p holds x = p and p + 4.
  const planes = [0x04, 0x15, 0x26, 0x37];
  const bitmap = decodeBitmap(new Uint8Array([...bitmapHeader('ILBM    ', 9, 0x50, 8, 1), ...planes]));
  assert.equal(bitmap.bitsPerPixel, 4);
  assert.deepEqual([...bitmap.pixels], [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('bitmaps with an unknown id, type or short data are rejected', () => {
  assert.throws(() => decodeBitmap(new Uint8Array(bitmapHeader('NOPENOPE', 0, 0x55, 4, 1))), /unknown bitmap id/);
  assert.throws(() => decodeBitmap(new Uint8Array(bitmapHeader('INFOILBM', 0, 0x99, 4, 1))), /unknown bitmap type/);
  assert.throws(() => decodeBitmap(new Uint8Array(bitmapHeader('INFOILBM', 0, 0x55, 8, 8))), /needs/);
});

test('palettes are 256 RGB triples', () => {
  const data = new Uint8Array(768);
  data.set([0x12, 0x34, 0x56], 3);
  const palette = decodePalette(data);
  assert.equal(palette[1], rgba(0x12, 0x34, 0x56));
  assert.deepEqual([...new Uint8Array(palette.buffer, 4, 4)], [0x12, 0x34, 0x56, 0xff]);
  assert.throws(() => decodePalette(new Uint8Array(767)), /expected 768/);
});

test('maps drop the end-marker column and row', () => {
  const E = [END_TERRAIN, NO_UNIT];
  const file = new Uint8Array([
    0, 3, 0, 3, // stored size 3 x 3, big-endian
    0x10, NO_UNIT, 0x11, 0x14, ...E,
    0x12, 0x2b, 0x13, NO_UNIT, ...E,
    ...E, ...E, ...E,
  ]);
  const map = decodeMap(file);
  assert.equal(map.columns, 2);
  assert.equal(map.rows, 2);
  assert.deepEqual([...map.terrain], [0x10, 0x11, 0x12, 0x13]);
  assert.deepEqual([...map.units], [NO_UNIT, 0x14, 0x2b, NO_UNIT]);
  assert.throws(() => decodeMap(file.subarray(0, 10)), /needs/);
});

test('unit codes split into type and side', () => {
  assert.deepEqual(splitUnitCode(0x14), { type: 10, side: 0 });
  assert.deepEqual(splitUnitCode(0x2b), { type: 21, side: 1 });
});

test('shop files give buildable units and building contents', () => {
  const unavailable = new Array<number>(51).fill(1);
  unavailable[0] = 0;
  unavailable[10] = 0;
  const file = new Uint8Array([
    ...unavailable,
    2,
    0, 0, 0, 5, 50, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    2, 2, 1, 15, 25, 12, 3, 0xff, 0xff, 0xff, 0xff, 0xff,
  ]);
  const { buildable, shops } = decodeShops(file);
  assert.deepEqual(buildable, [0, 10]);
  assert.equal(shops.length, 2);
  assert.deepEqual(shops[0], { owner: 0, kind: 0, index: 0, resources: 5, worth: 50, contents: [] });
  assert.deepEqual(shops[1], { owner: 2, kind: 2, index: 1, resources: 15, worth: 25, contents: [12, 3] });
  assert.throws(() => decodeShops(file.subarray(0, 60)), /needs/);
});

// Tests of the unit and terrain tables on hand-made records.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeMapRecords } from '../src/formats/mapRecords.ts';
import { canEnter, decodeTerrainTypes, terrainClassName, terrainMaskNames } from '../src/formats/terrain.ts';
import { decodeUnitTypes } from '../src/formats/unitTypes.ts';

function unitRecord(fields: Record<number, number>, className: string, name: string): number[] {
  const record = new Array<number>(69).fill(0);
  for (const [offset, value] of Object.entries(fields)) record[Number(offset)] = value;
  [...className].forEach((c, i) => (record[27 + i] = c.charCodeAt(0)));
  [...name].forEach((c, i) => (record[44 + i] = c.charCodeAt(0)));
  return record;
}

test('unit records give speed, armour, weapons, cost and weight', () => {
  const [gun, boat] = decodeUnitTypes(
    new Uint8Array([
      // Stored ranges are one more than the range in fields.
      ...unitRecord({ 1: 2, 2: 25, 3: 6, 5: 18, 8: 3, 9: 1, 10: 30, 11: 25, 12: 25, 63: 50, 65: 2 }, 'AA', 'STATIC GUN'),
      ...unitRecord({ 1: 5, 2: 65, 3: 6, 5: 5, 8: 1, 9: 1, 63: 255, 64: 30 }, 'TRANSPORTER', 'TRANSPORT SHIP'),
    ]),
  );
  assert.equal(gun!.className, 'AA');
  assert.equal(gun!.name, 'STATIC GUN');
  assert.equal(gun!.speed, 2);
  assert.equal(gun!.armour, 25);
  assert.equal(gun!.groupSize, 6);
  assert.deepEqual(gun!.weapons.air, { range: 2, power: 30 });
  // Power without range: it fires back but cannot start an attack.
  assert.deepEqual(gun!.weapons.ground, { range: 0, power: 25 });
  assert.equal(gun!.cost, 50);
  assert.equal(gun!.weight, 2);
  assert.equal(gun!.capacity, 0);

  assert.deepEqual(boat!.weapons, { air: null, ground: null, water: null });
  assert.equal(boat!.cost, null);
  assert.equal(boat!.capacity, 30);
  assert.equal(boat!.terrainMask, 5);
  assert.throws(() => decodeUnitTypes(new Uint8Array(70)), /multiple of 69/);
});

test('map records give a code word, the player count and the winter bit', () => {
  const letters = (word: string) => [...word].map((c) => c.charCodeAt(0) - 64 + 16);
  const records = decodeMapRecords(
    new Uint8Array([
      ...letters('ABCDE'), 2, 1, 1, 0, 0,
      ...letters('VWXYZ'), 2, 2, 1, 2, 0,
      // Byte 8 can be 1 without the winter bit.
      ...letters('HELLO'), 2, 1, 0, 1, 0,
    ]),
  );
  assert.deepEqual(
    records.map(({ code, players, winter }) => ({ code, players, winter })),
    [
      { code: 'ABCDE', players: 1, winter: false },
      { code: 'VWXYZ', players: 2, winter: true },
      { code: 'HELLO', players: 1, winter: false },
    ],
  );
  assert.throws(() => decodeMapRecords(new Uint8Array(11)), /multiple of 10/);
});

test('terrain masks are tested against a terrain class', () => {
  const [rail, deepWater, building] = decodeTerrainTypes(
    new Uint8Array([8, 0, 2, 5, 2, 5, 16, 0, 1, 6, 2, 7, 40, 64, 128, 255, 2, 8]),
  );
  assert.equal(terrainClassName(rail!.terrainClass), 'rail');
  assert.equal(terrainClassName(deepWater!.terrainClass), 'deep water');
  assert.equal(terrainClassName(building!.terrainClass), 'closed');

  const train = 2;
  const boat = 5;
  const aircraft = 127;
  assert.ok(canEnter(train, rail!));
  assert.ok(!canEnter(train, deepWater!));
  assert.ok(canEnter(boat, deepWater!));
  assert.ok(!canEnter(boat, rail!));
  assert.ok(!canEnter(aircraft, building!));
  assert.ok(!canEnter(0, rail!));
  assert.deepEqual(terrainMaskNames(boat), ['deep water', 'shallow water']);
  assert.throws(() => decodeTerrainTypes(new Uint8Array(7)), /multiple of 6/);
});

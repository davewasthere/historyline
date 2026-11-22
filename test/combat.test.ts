// Tests of the combat rule. The expected losses were worked out by hand from
// the formula in src/game/combat.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAttack,
  distance,
  resolveFight,
  supportFor,
  type Bystander,
  type Fighter,
} from '../src/game/combat.ts';
import { AA_GUN, ARTILLERY, BALLOON, INFANTRY, PLANE, TANK, terrainOf, TRUCK, unitTypes } from './helpers.ts';

const GROUND = 0x04;
const WATER = 0x08;
const AIR = 0x10;

function fighter(type: number, overrides: Partial<Fighter> = {}): Fighter {
  return { type: unitTypes[type]!, count: 6, experience: 0, terrain: terrainOf('p'), ...overrides };
}

const plainFight = { distance: 1, flank: 0, support: 0 };

test('distance counts fields the shortest way', () => {
  const d = (c1: number, r1: number, c2: number, r2: number) => distance({ column: c1, row: r1 }, { column: c2, row: r2 });
  assert.equal(d(2, 2, 2, 2), 0);
  // The six fields around an even and an odd column's field.
  for (const [c, r] of [[2, 1], [3, 1], [3, 2], [2, 3], [1, 2], [1, 1]]) assert.equal(d(2, 2, c!, r!), 1);
  for (const [c, r] of [[1, 1], [2, 2], [2, 3], [1, 3], [0, 3], [0, 2]]) assert.equal(d(1, 2, c!, r!), 1);
  assert.equal(d(0, 0, 4, 0), 4);
  assert.equal(d(0, 0, 0, 5), 5);
  assert.equal(d(0, 0, 1, 2), 3);
  assert.equal(d(5, 5, 1, 2), d(1, 2, 5, 5));
});

test('a unit can attack what its mask names, within its weapon\'s range', () => {
  const type = (index: number) => unitTypes[index]!;
  assert.ok(canAttack(type(INFANTRY), GROUND, 1));
  assert.ok(!canAttack(type(INFANTRY), GROUND, 2));
  assert.ok(!canAttack(type(INFANTRY), AIR, 1));
  assert.ok(canAttack(type(PLANE), AIR, 1) && canAttack(type(PLANE), WATER, 1));
  // An indirect-fire gun reaches far but not the next field.
  assert.ok(canAttack(type(ARTILLERY), GROUND, 5) && canAttack(type(ARTILLERY), GROUND, 2));
  assert.ok(!canAttack(type(ARTILLERY), GROUND, 1) && !canAttack(type(ARTILLERY), GROUND, 6));
  // The anti-aircraft gun attacks aircraft only; its ground weapon has no range.
  assert.ok(canAttack(type(AA_GUN), AIR, 2) && !canAttack(type(AA_GUN), GROUND, 1));
  assert.ok(!canAttack(type(TRUCK), GROUND, 1));
});

test('two equal units cost each other one', () => {
  assert.deepEqual(resolveFight({ attacker: fighter(INFANTRY), target: fighter(INFANTRY), ...plainFight }), {
    attackerLosses: 1,
    targetLosses: 1,
    returnFire: true,
  });
});

test('units around the target raise the attack', () => {
  const fight = { attacker: fighter(INFANTRY), target: fighter(INFANTRY), ...plainFight };
  assert.equal(resolveFight({ ...fight, flank: 100 }).targetLosses, 4);
  assert.equal(resolveFight({ ...fight, flank: 100 }).attackerLosses, 1);
});

test('support raises the target\'s armour, but a clear hit still costs one', () => {
  const fight = { attacker: fighter(INFANTRY), target: fighter(INFANTRY), ...plainFight };
  assert.equal(resolveFight({ ...fight, support: 80 }).targetLosses, 1);
});

test('a long-range weapon weakens with distance and draws no return fire', () => {
  const fight = { attacker: fighter(ARTILLERY), target: fighter(INFANTRY), flank: 0, support: 0 };
  assert.deepEqual(resolveFight({ ...fight, distance: 3 }), { attackerLosses: 0, targetLosses: 2, returnFire: false });
  // At full range the gun has lost half its power: 28 of 55.
  assert.equal(resolveFight({ ...fight, distance: 5 }).targetLosses, 1);
});

test('a target that cannot fight the attacker does not fire back', () => {
  const versus = (target: number, attacker = INFANTRY) =>
    resolveFight({ attacker: fighter(attacker), target: fighter(target), ...plainFight });
  assert.equal(versus(TRUCK).returnFire, false);
  assert.equal(versus(BALLOON).returnFire, false);
  // An indirect-fire gun cannot fire at the next field, so not back either.
  assert.equal(versus(ARTILLERY).returnFire, false);
  // Infantry has nothing against aircraft; the anti-aircraft gun fires back at ground units.
  assert.equal(versus(INFANTRY, PLANE).returnFire, false);
  assert.equal(versus(AA_GUN).returnFire, true);
});

test('experience makes an attack much heavier, up to the whole unit', () => {
  const result = resolveFight({
    attacker: fighter(INFANTRY, { experience: 6 }),
    target: fighter(INFANTRY),
    ...plainFight,
  });
  assert.equal(result.targetLosses, 6);
});

test('the ground adds to attack and defence', () => {
  // Forest: -1 attack, +2 defence, each times half the value it applies to.
  // A flanked tank attack (35 raised to 69) brings 483 to bear in the open
  // against the infantry's cover of 130.
  const flanked = { distance: 1, flank: 100, support: 0 };
  const open = resolveFight({ attacker: fighter(TANK), target: fighter(INFANTRY), ...flanked });
  // From the forest the attack loses 34.
  const fromForest = resolveFight({
    attacker: fighter(TANK, { terrain: terrainOf('f') }),
    target: fighter(INFANTRY),
    ...flanked,
  });
  // In the forest the infantry's cover gains 20.
  const intoForest = resolveFight({
    attacker: fighter(TANK),
    target: fighter(INFANTRY, { terrain: terrainOf('f') }),
    ...flanked,
  });
  assert.deepEqual([open.targetLosses, fromForest.targetLosses, intoForest.targetLosses], [5, 4, 4]);
});

test('losses never exceed what is there', () => {
  const result = resolveFight({
    attacker: fighter(INFANTRY, { experience: 6 }),
    target: fighter(INFANTRY, { count: 2 }),
    ...plainFight,
  });
  assert.equal(result.targetLosses, 2);
  const weak = resolveFight({ attacker: fighter(INFANTRY, { count: 1 }), target: fighter(TANK), ...plainFight });
  assert.ok(weak.attackerLosses <= 1 && weak.targetLosses <= 2);
});

test('who stands around a fight decides flank and support', () => {
  const type = unitTypes[INFANTRY]!;
  const attacker = { field: { column: 2, row: 1 }, side: 1, classBits: GROUND };
  const target = { field: { column: 2, row: 2 }, side: 0, classBits: GROUND };
  const around = (units: Record<string, Bystander>) => (field: { column: number; row: number }) =>
    units[`${field.column},${field.row}`] ?? null;
  const ally: Bystander = { side: 1, type };
  const enemy: Bystander = { side: 0, type };

  assert.deepEqual(supportFor(attacker, target, around({})), { flank: 0, support: 0 });
  // Opposite the attacker, across the target: the full 100.
  assert.equal(supportFor(attacker, target, around({ '2,3': ally })).flank, 100);
  // One step round from the attacker 25, two steps 50; they add up.
  assert.equal(supportFor(attacker, target, around({ '3,1': ally })).flank, 25);
  assert.equal(supportFor(attacker, target, around({ '3,2': ally, '1,2': ally, '2,3': ally })).flank, 200);
  // An ally that could not attack the target adds nothing, nor does a long-range gun.
  assert.equal(supportFor(attacker, target, around({ '2,3': { side: 1, type: unitTypes[TRUCK]! } })).flank, 0);
  assert.equal(supportFor(attacker, target, around({ '2,3': { side: 1, type: unitTypes[ARTILLERY]! } })).flank, 0);

  // The target's side on the two fields that touch both fighters.
  assert.equal(supportFor(attacker, target, around({ '1,1': enemy })).support, 80);
  assert.equal(supportFor(attacker, target, around({ '1,1': enemy, '3,1': enemy })).support, 150);
  assert.equal(supportFor(attacker, target, around({ '2,3': enemy })).support, 0);

  // Nothing counts unless the two are neighbours.
  const far = { ...attacker, field: { column: 2, row: 0 } };
  assert.deepEqual(supportFor(far, target, around({ '2,3': ally, '1,1': enemy })), { flank: 0, support: 0 });
});

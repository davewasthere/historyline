// What a fight costs each side, and who a unit can attack.
//
// The rules are as the hl1914-18 project's notes and port describe the
// original game applying them (not checked against the running game from this
// project). The outcome of a fight is worked out, not rolled: the same fight
// always ends the same way.
//
//   - A unit attacks with its weapon for the kind of target: air, water or
//     ground. A weapon that reaches further than the next field loses power
//     with distance, up to three quarters of it at full range.
//   - Other units of the attacker's side on the fields around the target add
//     to the attack: 100% from the field opposite the attacker, 50% from the
//     two beside that, 25% from the two next to the attacker. They must be
//     able to attack the target and must not be indirect-fire guns.
//   - Units of the target's side on the two fields that touch both fighters
//     add 80% each to the target's armour, 150% at most, if they could attack
//     the attacker.
//   - Each side's strength is its number of vehicles times the weapon or
//     armour value, raised by experience, plus a bonus for the ground it
//     stands on.
//   - The target fires back only if the attacker is on the next field, the
//     target can attack that kind of unit, and it is not an indirect-fire gun.
//
// One point is uncertain: the port's distance routine is called with rows and
// columns the other way round from what gives the ordinary distance between
// fields. This file uses the ordinary distance.

import type { TerrainType } from '../formats/terrain.ts';
import type { UnitType, Weapon } from '../formats/unitTypes.ts';
import { DIRECTIONS, directionTo, type Field } from './movement.ts';

// Bits shared by a unit type's attackMask (what it can attack) and classBits
// (what it is).
export const CLASS_GROUND = 0x04;
export const CLASS_WATER = 0x08;
export const CLASS_AIR = 0x10;
const CLASS_BITS = 0x3c;
/** attackMask: cannot fire at the fields next to it. */
export const ATTACKS_INDIRECTLY = 0x40;
/** attackMask: does not fire back when attacked. */
export const ATTACKS_NEVER_BACK = 0x80;

/**
 * What units of the attacker's side add to an attack, in per cent, by how
 * many fields round the target they stand from the attacker (1 to 5).
 * From HL.EXE, 6 bytes at file offset 0x391F9.
 */
export const FLANK_PERCENT = [0, 25, 50, 100, 50, 25] as const;

/** What one supporting unit adds to the target's armour, and the most support can add. */
const SUPPORT_PERCENT = 80;
const SUPPORT_LIMIT = 150;

/**
 * What the ground adds to attack and to defence, by a terrain type's
 * combatGround. In order: mountains, forest, houses, bridges and coast,
 * roads, rail, trenches, water, open ground.
 * From HL.EXE, 18 signed bytes at file offset 0x40ED0.
 */
export const GROUND_BONUS: readonly (readonly [attack: number, defence: number])[] = [
  [2, 3],
  [-1, 2],
  [-2, 2],
  [-1, -1],
  [0, -1],
  [0, -1],
  [2, 4],
  [0, 0],
  [0, 0],
];

export const MAX_EXPERIENCE = 6;

/** The parts of a unit type that combat depends on. */
export type CombatType = Pick<UnitType, 'armour' | 'weapons' | 'attackMask' | 'classBits'>;

export interface Fighter {
  type: CombatType;
  /** Vehicles, guns or men left in the unit. */
  count: number;
  experience: number;
  /** The ground the unit stands on. */
  terrain: Pick<TerrainType, 'combatGround'>;
}

/** The number of fields from one field to another, going the shortest way. */
export function distance(a: Field, b: Field): number {
  // Columns are a straight axis; a column's rows slide down half a field for
  // every column further right.
  const slideA = a.row - (a.column - (a.column & 1)) / 2;
  const slideB = b.row - (b.column - (b.column & 1)) / 2;
  const columns = b.column - a.column;
  const rows = slideB - slideA;
  return Math.max(Math.abs(columns), Math.abs(rows), Math.abs(columns + rows));
}

/** The weapon a unit type uses on a target of this kind; null if it has none. */
export function weaponAgainst(type: CombatType, targetClassBits: number): Weapon | null {
  if (targetClassBits & CLASS_AIR) return type.weapons.air;
  return targetClassBits & CLASS_WATER ? type.weapons.water : type.weapons.ground;
}

/** Whether a unit type can start an attack on a target of this kind at this distance. */
export function canAttack(type: CombatType, targetClassBits: number, fields: number): boolean {
  if (!(type.attackMask & targetClassBits & CLASS_BITS)) return false;
  const weapon = weaponAgainst(type, targetClassBits);
  if (!weapon || fields < 1 || fields > weapon.range) return false;
  return !(type.attackMask & ATTACKS_INDIRECTLY && fields === 1);
}

/** Whether a unit type adds to a neighbour's fight against a target of this kind. */
function canJoinAgainst(type: CombatType, targetClassBits: number): boolean {
  return (type.attackMask & targetClassBits & CLASS_BITS) !== 0 && !(type.attackMask & ATTACKS_INDIRECTLY);
}

export interface Bystander {
  side: number;
  type: CombatType;
}

/** The field one step from `field` in a direction. */
function step(field: Field, direction: number): Field {
  const down = field.column & 1;
  const d = ((direction % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
  const offsets: [number, number][] = [
    [0, -1],
    [1, -1 + down],
    [1, down],
    [0, 1],
    [-1, down],
    [-1, -1 + down],
  ];
  const [column, row] = offsets[d]!;
  return { column: field.column + column, row: field.row + row };
}

export interface Support {
  /** Per cent added to the attack by the attacker's side around the target. */
  flank: number;
  /** Per cent added to the target's armour by its side beside both fighters. */
  support: number;
}

/**
 * What the units around a fight add to it. Both are 0 unless the fighters
 * stand on neighbouring fields. `unitOn` tells what stands on a field.
 */
export function supportFor(
  attacker: { field: Field; side: number; classBits: number },
  target: { field: Field; side: number; classBits: number },
  unitOn: (field: Field) => Bystander | null,
): Support {
  const fromTarget = directionTo(target.field, attacker.field);
  if (fromTarget < 0) return { flank: 0, support: 0 };

  let flank = 0;
  for (let i = 1; i < DIRECTIONS; i++) {
    const unit = unitOn(step(target.field, fromTarget + i));
    if (unit && unit.side === attacker.side && canJoinAgainst(unit.type, target.classBits)) {
      flank += FLANK_PERCENT[i]!;
    }
  }

  const fromAttacker = directionTo(attacker.field, target.field);
  let support = 0;
  for (const turn of [1, 5]) {
    const unit = unitOn(step(attacker.field, fromAttacker + turn));
    if (unit && unit.side === target.side && canJoinAgainst(unit.type, attacker.classBits)) {
      support += SUPPORT_PERCENT;
    }
  }
  return { flank, support: Math.min(support, SUPPORT_LIMIT) };
}

export interface FightInput {
  attacker: Fighter;
  target: Fighter;
  /** Fields between the two; 1 if they are neighbours. */
  distance: number;
  flank: number;
  support: number;
}

export interface FightResult {
  attackerLosses: number;
  targetLosses: number;
  /** Whether the target fired back at all. */
  returnFire: boolean;
}

/** Whole-number division that rounds towards zero; 0 when dividing by 0. */
function div(a: number, b: number): number {
  return b === 0 ? 0 : Math.trunc(a / b);
}

/** A value raised by a number of per cent, in the game's 16.16 arithmetic. */
function raise(value: number, percent: number): number {
  const fixed = value * 0x10000;
  return Math.floor((fixed + percent * div(fixed, 100)) / 0x10000);
}

/** What a unit brings to bear with a weapon or armour value. */
function strength(count: number, value: number, experience: number, ground: number, scale: number): number {
  const skill = div((experience + 1) * 256, 6) + 1;
  return count * value + div(count * value * skill, scale) + ground * div(value, 2);
}

function clampCount(count: number): number {
  return count <= 0 ? 1 : Math.min(count, 6);
}

/** Works out both sides' losses in one fight. */
export function resolveFight(input: FightInput): FightResult {
  const { attacker, target } = input;
  const adjacent = input.distance === 1;
  const returnFire =
    adjacent &&
    !(target.type.attackMask & (ATTACKS_NEVER_BACK | ATTACKS_INDIRECTLY)) &&
    (attacker.type.classBits & target.type.attackMask & CLASS_BITS) !== 0;

  const attackerCount = clampCount(attacker.count);
  const targetCount = clampCount(target.count);

  const weapon = weaponAgainst(attacker.type, target.type.classBits);
  let attack = weapon?.power ?? 0;
  // The stored reach is one more than the range in fields.
  const reach = (weapon?.range ?? 0) + 1;
  if (reach > 1) attack -= div(3 * attack * (input.distance - 1), reach * 4);
  attack = raise(attack, input.flank);
  const targetArmour = raise(target.type.armour, input.support);
  const attackerArmour = attacker.type.armour;
  const reply = weaponAgainst(target.type, attacker.type.classBits)?.power ?? 0;

  const [attackerGroundAttack, attackerGroundDefence] = GROUND_BONUS[attacker.terrain.combatGround] ?? [0, 0];
  const [targetGroundAttack, targetGroundDefence] = GROUND_BONUS[target.terrain.combatGround] ?? [0, 0];
  const hit = strength(attackerCount, attack, attacker.experience, attackerGroundAttack, 0x100);
  const attackerCover = strength(attackerCount, attackerArmour, attacker.experience, attackerGroundDefence, 0x100);
  const hitBack = strength(targetCount, reply, target.experience, targetGroundAttack, 0x100);
  const targetCover = strength(targetCount, targetArmour, target.experience, targetGroundDefence, 0x200);

  // Experience makes each loss cheaper to inflict. The two sides' limits
  // differ by one step, as in the original.
  const attackerSkill = attacker.experience + 1 > 7 ? 6 : attacker.experience + 1;
  const targetSkill = target.experience + 1 <= 1 ? 2 : Math.min(target.experience + 1, 6);
  let targetLosses = div(hit - targetCover, div(targetArmour * (8 - attackerSkill), 2));
  let attackerLosses = div(hitBack - attackerCover, div(attackerArmour * (8 - targetSkill), 2));

  // A blow that clearly beats one vehicle's cover always costs at least one.
  if (targetLosses <= 0 && div(targetCover, targetCount) + div(targetArmour, 2) < hit) targetLosses = 1;
  if (attackerLosses <= 0 && div(attackerCover, attackerCount) + div(attackerArmour, 2) < hitBack) attackerLosses = 1;
  if (targetLosses > 6 && targetLosses < 12) targetLosses = 6;
  if (attackerLosses > 6 && attackerLosses < 12) attackerLosses = 6;
  // A unit cannot destroy more than twice its own number.
  targetLosses = Math.min(targetLosses, 2 * attackerCount);
  attackerLosses = Math.min(attackerLosses, 2 * targetCount);
  targetLosses = Math.max(0, Math.min(targetLosses, targetCount));
  attackerLosses = Math.max(0, Math.min(attackerLosses, attackerCount));

  return { attackerLosses: returnFire ? attackerLosses : 0, targetLosses, returnFire };
}

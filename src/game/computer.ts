// The computer's player: it makes one side's moves in the half that side
// moves, and gives its orders in the half it attacks.
//
// It works the way the hl1914-18 project's port shows the original's computer
// working, in outline; the code and the simplifications are this project's.
// The original has no notion of a good or bad field. Every unit gets one plan
// with a worth, the plans are made in a fixed order, a plan worth more takes a
// unit away from one worth less, and a unit then walks the shortest way
// towards where its plan sends it.
//
// What a unit kind is to the computer comes from the map's .COM file (see
// src/formats/computerTable.ts): its worth as a target, and whether it takes
// buildings, fires from afar, guards the headquarters, is a transport, or is
// built in factories.
//
// In the half its side moves:
//
//   - Every enemy unit on the map gets a worth as a target: its kind's worth;
//     50 more if it cannot fire back or fires only from afar; 25 more for each
//     of air, ground and water it has no weapon against; the worth of what it
//     carries; 10 for each step of experience it lacks; and 300 more if it
//     takes buildings and is within a move of the computer's headquarters,
//     which also adds 300 to the enemy units beside it.
//   - Buildings to take, if the side has a unit that takes buildings: the
//     enemy headquarters, worth ten times its record's worth (200 unless the
//     map says otherwise), and every factory and depot that is not the
//     side's, worth 110 times that (1650 and 1100), a factory 20 more for
//     every 10 points it earns. The nearest free taker goes for each, with a
//     plan worth that less the length of its way.
//   - Fields beside its own headquarters to hold, if the enemy has a unit
//     that takes buildings: one, two or three by how the two sides' strengths
//     compare, two more for every enemy taker within a move of the
//     headquarters, six at most, and one only for a side of fewer than ten
//     units. The nearest units of the kinds that guard go there and stay.
//   - A unit that has lost vehicles goes into a building of its side that it
//     can reach in this move, while the side has more than 14 points.
//   - A unit that fires from afar stays where it is while an enemy is in range.
//   - The enemy units are gone through from the one worth most: up to four
//     units that can fight it, are not outmatched and are near enough are sent
//     to fields around it, first those it cannot hit back, then fields
//     opposite ones already taken. A field with more than three enemy units
//     around it, or with two on opposite sides, is not used.
//   - A unit left without a plan walks towards the enemy unit worth most that
//     it can attack and find a way to.
//
// In the half its side attacks:
//
//   - Units inside its buildings that have lost vehicles are repaired while
//     the side has more than 14 points.
//   - Every unit that can attack attacks the enemy unit in its range that is
//     worth most: first the units that fire from afar, then the others.
//   - Every free place of its factories is filled with a unit of a kind drawn
//     at random from those the computer builds, while more than 61 points are
//     left.
//
// Left out of what the original does: units that escort others (no map's
// table calls for it), sending a transport to fetch a unit, and the order in
// which fields round the headquarters are held (a table in HL.EXE not read
// here). Not in the original and added here: a transport that carries units
// takes them towards the nearest building that is not its side's, and they
// get out when they can walk on; a unit that fires from afar and has to walk
// stops as soon as its target is in range; and an attack that would cost the
// attacker vehicles and the target none is not ordered. Like the original it
// does not build depots or dig trenches.

import { GROUND_BONUS, ATTACKS_INDIRECTLY, ATTACKS_NEVER_BACK, canAttack, distance, weaponAgainst } from './combat.ts';
import {
  FIRES_FROM_AFAR,
  GUARDS_HEADQUARTERS,
  IS_BUILT,
  IS_CARRIER,
  TAKES_BUILDINGS,
  type ComputerKind,
  type ComputerTable,
} from '../formats/computerTable.ts';
import type { Side } from '../formats/map.ts';
import { canEnter, entranceClosedTo } from '../formats/terrain.ts';
import { DIRECTIONS, fieldTowards, neighbours, type Field } from './movement.ts';
import {
  attackerSide,
  attackTargets,
  buildChoices,
  buildingAt,
  buildUnit,
  cannotAttackReason,
  cannotMoveReason,
  cannotRepairReason,
  cannotStopReason,
  foreseeFight,
  isBuilding,
  moveUnit,
  orderAttack,
  PLACES,
  rangeOf,
  repairUnit,
  unitAt,
  type Arrival,
  type Building,
  type GameState,
  type RuleType,
  type Unit,
} from './state.ts';

/** Points the computer keeps back when it repairs and when it builds. */
export const REPAIR_RESERVE = 14;
export const BUILD_RESERVE = 61;
/** How many units are sent against one enemy unit at most. */
const ATTACKERS_PER_TARGET = 4;
const UNREACHABLE = 0x3fffffff;
const CLASS_BITS = 0x3c;

export interface ComputerOptions {
  /** The map's .COM table. Without one the kinds' uses are worked out from the unit table. */
  table?: ComputerTable | null;
  /** A number from 0 up to but not 1, for the choice of what to build; Math.random by default. */
  random?: () => number;
}

export interface ComputerMove {
  unit: Unit;
  from: Field;
  to: Field;
  arrival: Arrival;
}

/** What the computer did when it played its part of a half. */
export interface ComputerTurn {
  side: Side;
  moves: ComputerMove[];
  /** The attacks ordered, as attacker and field. */
  attacks: { unit: Unit; target: Field }[];
  repaired: Unit[];
  built: Unit[];
}

/** What a kind is to the computer when there is no table: read off the unit table. */
export function derivedKind(type: RuleType): ComputerKind {
  const weapons = [type.weapons.air, type.weapons.ground, type.weapons.water];
  const armed = weapons.some((weapon) => weapon && weapon.range > 0 && weapon.power > 0);
  const afar = (type.attackMask & ATTACKS_INDIRECTLY) !== 0 || weapons.some((weapon) => (weapon?.range ?? 0) > 1);
  return {
    worth: 70,
    flags:
      (type.entersAnyBuilding ? TAKES_BUILDINGS : 0) |
      (afar ? FIRES_FROM_AFAR : 0) |
      (type.isTransport ? IS_CARRIER : 0) |
      (armed && !type.isTransport && !type.isShipBack ? IS_BUILT : 0),
    escorts: 0,
  };
}

/** Everything one call works with. */
interface Mind {
  state: GameState;
  side: Side;
  other: Side;
  kinds: ComputerKind[];
  /** Ways to a field for a unit kind, worked out once each. */
  ways: Map<number, Int32Array>;
}

interface Plan {
  worth: number;
  /** The field the plan sends the unit to or towards; null for a unit that stays. */
  goal: Field | null;
  /** True if the unit is to end its move on the goal itself, not just near it. */
  exact: boolean;
}

function mindOf(state: GameState, side: Side, options: ComputerOptions): Mind {
  const table = options.table ?? null;
  return {
    state,
    side,
    other: side === 0 ? 1 : 0,
    kinds: state.unitTypes.map((type, number) => table?.[number] ?? derivedKind(type)),
    ways: new Map(),
  };
}

const sameField = (a: Field, b: Field) => a.column === b.column && a.row === b.row;

function indexOf(mind: Mind, field: Field): number {
  return field.row * mind.state.map.columns + field.column;
}

function fieldAt(mind: Mind, index: number): Field {
  const { columns } = mind.state.map;
  return { column: index % columns, row: Math.floor(index / columns) };
}

function onMap(mind: Mind, field: Field): boolean {
  const { columns, rows } = mind.state.map;
  return field.column >= 0 && field.column < columns && field.row >= 0 && field.row < rows;
}

function typeOf(mind: Mind, unit: Unit): RuleType {
  return mind.state.unitTypes[unit.type]!;
}

function has(mind: Mind, unit: Unit, flags: number): boolean {
  return ((mind.kinds[unit.type]?.flags ?? 0) & flags) !== 0;
}

/** A unit that takes buildings: the table says so, and the rules let it. */
function takes(mind: Mind, unit: Unit): boolean {
  return has(mind, unit, TAKES_BUILDINGS) && typeOf(mind, unit).entersAnyBuilding;
}

function alive(mind: Mind, side: Side): Unit[] {
  return mind.state.units.filter((unit) => unit.side === side && !unit.destroyed);
}

/** The units of a side that stand on the map. */
function standing(mind: Mind, side: Side): Unit[] {
  return alive(mind, side).filter((unit) => !unit.inside);
}

function headquarters(mind: Mind, side: Side): Building | null {
  return mind.state.buildings.find((building) => building.kind === 'headquarters' && building.owner === side) ?? null;
}

/** What entering a field costs a kind of a side, or -1 if it cannot; units on the way are not looked at. */
function stepCost(mind: Mind, type: RuleType, index: number): number {
  const terrain = mind.state.terrainTypes[mind.state.map.terrain[index]!];
  if (!terrain || !canEnter(type.terrainMask, terrain)) return -1;
  if (!type.entersAnyBuilding && entranceClosedTo(mind.side, terrain)) return -1;
  const cost = type.flatMoveCost ? 2 : type.isAircraft ? terrain.airCost : terrain.surfaceCost;
  return Math.max(1, cost);
}

/**
 * For every field, what the way from it to `goal` costs a unit of a kind, or
 * UNREACHABLE. The goal itself may be a field the kind cannot enter, such as
 * one an enemy stands on; the last step then counts 1.
 */
function waysTo(mind: Mind, goal: Field, typeNumber: number): Int32Array {
  const goalIndex = indexOf(mind, goal);
  const key = goalIndex * 256 + typeNumber;
  const known = mind.ways.get(key);
  if (known) return known;
  const type = mind.state.unitTypes[typeNumber]!;
  const fieldCount = mind.state.map.columns * mind.state.map.rows;
  const cost = new Int32Array(fieldCount).fill(UNREACHABLE);
  // Fields waiting to be looked at, by what the way from them costs.
  const waiting: number[][] = [[goalIndex]];
  cost[goalIndex] = 0;
  for (let far = 0; far < waiting.length; far++) {
    for (const index of waiting[far] ?? []) {
      if (cost[index] !== far) continue;
      const enter = stepCost(mind, type, index);
      const next = far + (enter < 0 ? 1 : enter);
      for (const near of neighbours(fieldAt(mind, index), mind.state.map)) {
        const nearIndex = indexOf(mind, near);
        if (next >= cost[nearIndex]! || stepCost(mind, type, nearIndex) < 0) continue;
        cost[nearIndex] = next;
        (waiting[next] ??= []).push(nearIndex);
      }
    }
  }
  mind.ways.set(key, cost);
  return cost;
}

/** What the way from where a unit is to a field costs it. */
function wayFrom(mind: Mind, unit: Unit, goal: Field): number {
  if (sameField(unit, goal)) return 0;
  return waysTo(mind, goal, unit.type)[indexOf(mind, unit)]!;
}

/** A unit's strength as the original adds the sides up, to compare them. */
function strength(mind: Mind, unit: Unit): number {
  const type = typeOf(mind, unit);
  const power = (type.weapons.air?.power ?? 0) + (type.weapons.ground?.power ?? 0) + (type.weapons.water?.power ?? 0);
  return (power * (Math.floor(unit.count / 2) + 1) * (unit.experience + 1) * Math.floor(type.armour / 8)) / 32;
}

/** Whether an enemy unit that takes buildings is within a move of the side's headquarters. */
function threatens(mind: Mind, enemy: Unit, home: Building | null): boolean {
  if (!home || !takes(mind, enemy)) return false;
  return distance(home.entrance, enemy) < typeOf(mind, enemy).movementBudget;
}

/** What each enemy unit on the map is worth as a target. */
function targetWorths(mind: Mind): Map<Unit, number> {
  const home = headquarters(mind, mind.side);
  const worths = new Map<Unit, number>();
  const enemies = standing(mind, mind.other);
  for (const enemy of enemies) {
    const type = typeOf(mind, enemy);
    let worth = mind.kinds[enemy.type]?.worth ?? 0;
    if (type.attackMask & (ATTACKS_INDIRECTLY | ATTACKS_NEVER_BACK)) worth += 50;
    for (const weapon of [type.weapons.air, type.weapons.ground, type.weapons.water]) {
      if (!weapon || weapon.power === 0) worth += 25;
    }
    for (const carried of enemy.cargo) worth += mind.kinds[carried.type]?.worth ?? 0;
    worth += (6 - enemy.experience) * 10;
    worths.set(enemy, (worths.get(enemy) ?? 0) + worth);
    if (!threatens(mind, enemy, home)) continue;
    worths.set(enemy, worths.get(enemy)! + 300);
    for (const near of neighbours(enemy, mind.state.map)) {
      const beside = unitAt(mind.state, near);
      if (beside && beside.side === mind.other && beside !== enemy) worths.set(beside, (worths.get(beside) ?? 0) + 300);
    }
  }
  return worths;
}

/** Whether a field has more than three enemy units around it, or two on opposite sides. */
function pinched(mind: Mind, field: Field): boolean {
  const enemy = Array.from({ length: DIRECTIONS }, (_, direction) => {
    const near = fieldTowards(field, direction);
    return onMap(mind, near) && unitAt(mind.state, near)?.side === mind.other;
  });
  if (enemy.filter(Boolean).length > 3) return true;
  return enemy.some((there, direction) => there && enemy[(direction + 3) % DIRECTIONS]);
}

/** Whether a field is the entrance of a building. */
function isEntrance(mind: Mind, field: Field): boolean {
  const building = buildingAt(mind.state, field);
  return building !== null && sameField(building.entrance, field);
}

/**
 * The free fields a unit could end a move on now, as field numbers: not a
 * transport's field and not an entrance, which are only ever gone to on
 * purpose.
 */
function stopsOf(mind: Mind, unit: Unit): number[] {
  if (cannotMoveReason(mind.state, unit) !== null) return [];
  const range = rangeOf(mind.state, unit);
  if (!range) return [];
  const stops: number[] = [];
  range.remaining.forEach((left, index) => {
    if (left < 0) return;
    const field = fieldAt(mind, index);
    if (unitAt(mind.state, field) || isEntrance(mind, field)) return;
    if (cannotStopReason(mind.state, unit, range, field) === null) stops.push(index);
  });
  return stops;
}

function groundDefence(mind: Mind, index: number): number {
  const terrain = mind.state.terrainTypes[mind.state.map.terrain[index]!];
  return GROUND_BONUS[terrain?.combatGround ?? 8]?.[1] ?? 0;
}

/** Whether a unit's kind could attack an enemy unit at all, at some distance. */
function couldAttack(mind: Mind, unit: Unit, enemy: Unit): boolean {
  const type = typeOf(mind, unit);
  const enemyBits = typeOf(mind, enemy).classBits;
  if (type.digsTrenches || !(type.attackMask & enemyBits & CLASS_BITS)) return false;
  return (weaponAgainst(type, enemyBits)?.range ?? 0) > 0;
}

/** Whether a unit is inside a building of its side, short of vehicles, with a repair in the side's reach. */
function waitsForRepair(mind: Mind, unit: Unit): boolean {
  if (!unit.inside || !isBuilding(unit.inside)) return false;
  return unit.count < typeOf(mind, unit).groupSize && mind.state.points[mind.side] > REPAIR_RESERVE;
}

/** Whether a unit is so much weaker than another that the original does not send it. */
function outmatched(unit: Unit, enemy: Unit): boolean {
  return unit.count - enemy.count < -2 && unit.experience < 3;
}

// --- the half in which the side moves ----------------------------------------

function planMoves(mind: Mind): Map<Unit, Plan> {
  const { state, side } = mind;
  const plans = new Map<Unit, Plan>();
  const worthOf = (unit: Unit) => plans.get(unit)?.worth ?? 0;
  const own = alive(mind, side);
  const movable = own.filter((unit) => cannotMoveReason(state, unit) === null);
  const enemies = standing(mind, mind.other);
  const worths = targetWorths(mind);
  const home = headquarters(mind, side);
  const stops = new Map<Unit, Set<number>>();
  const stopsFor = (unit: Unit) => {
    if (!stops.has(unit)) stops.set(unit, new Set(stopsOf(mind, unit)));
    return stops.get(unit)!;
  };
  /** Fields a plan sends a unit to, which no other unit is to end up on. */
  const taken = new Set<number>();
  const give = (unit: Unit, plan: Plan) => {
    const before = plans.get(unit);
    if (before?.goal && before.exact) taken.delete(indexOf(mind, before.goal));
    plans.set(unit, plan);
    if (plan.goal && plan.exact) taken.add(indexOf(mind, plan.goal));
  };

  // Buildings to take, the one worth most first; the nearest taker goes.
  const takers = movable.filter((unit) => takes(mind, unit));
  if (own.some((unit) => takes(mind, unit))) {
    const aims = state.buildings
      .filter((building) => building.owner !== side)
      .map((building) => {
        if (building.kind === 'headquarters') return { building, worth: building.worth * 10 };
        const income = building.kind === 'factory' && building.resources >= 10 ? Math.floor(building.resources / 10) * 20 : 0;
        return { building, worth: building.worth * 110 + income };
      })
      .sort((a, b) => b.worth - a.worth);
    for (const { building, worth } of aims) {
      const nearest = takers
        .map((unit) => ({ unit, way: wayFrom(mind, unit, building.entrance) }))
        .filter(({ way }) => way < UNREACHABLE)
        .sort((a, b) => a.way - b.way)
        .find(({ unit, way }) => worthOf(unit) < worth - way);
      if (nearest) give(nearest.unit, { worth: worth - nearest.way, goal: building.entrance, exact: true });
    }
  }

  // Fields beside the headquarters to hold against units that take buildings.
  if (home && enemies.some((unit) => takes(mind, unit))) {
    const sum = (units: Unit[]) => units.reduce((total, unit) => total + strength(mind, unit), 0);
    const [ours, theirs] = [sum(own), sum(alive(mind, mind.other))];
    let count = ours * 2 <= theirs ? 3 : ours < theirs ? 2 : 1;
    count += 2 * enemies.filter((unit) => threatens(mind, unit, home)).length;
    count = Math.min(count, 6);
    if (own.length < 10) count = 1;
    const guards = movable.filter((unit) => has(mind, unit, GUARDS_HEADQUARTERS));
    const around = neighbours(home.entrance, state.map).filter((field) => !buildingAt(state, field));
    for (const field of around.slice(0, count)) {
      const worth = 120 + count * 30;
      count--;
      const holder = unitAt(state, field);
      if (holder && holder.side === side && has(mind, holder, GUARDS_HEADQUARTERS)) {
        if (worthOf(holder) < worth) give(holder, { worth, goal: null, exact: false });
        continue;
      }
      const nearest = guards
        .filter((unit) => worthOf(unit) < worth && !unit.inside)
        .map((unit) => ({ unit, way: wayFrom(mind, unit, field) }))
        .filter(({ way }) => way < UNREACHABLE)
        .sort((a, b) => a.way - b.way)[0];
      if (nearest) give(nearest.unit, { worth, goal: field, exact: true });
    }
  }

  // Units that have lost vehicles go in for repair, if a building is within this move.
  if (state.points[side] > REPAIR_RESERVE) {
    for (const unit of movable) {
      if (unit.inside || unit.count >= typeOf(mind, unit).groupSize) continue;
      const worth = 2 * (unit.count < 5 && unit.experience > 1 ? 70 + unit.experience * 10 : 15);
      if (worthOf(unit) >= worth) continue;
      const range = rangeOf(state, unit);
      const shelter = state.buildings.find(
        (building) =>
          building.owner === side &&
          range !== null &&
          (range.remaining[indexOf(mind, building.entrance)] ?? -1) >= 0 &&
          cannotStopReason(state, unit, range, building.entrance) === null,
      );
      if (shelter) give(unit, { worth, goal: shelter.entrance, exact: true });
    }
  }

  // Units that fire from afar stay put while something is in range.
  for (const unit of own) {
    if (unit.inside || !has(mind, unit, FIRES_FROM_AFAR) || worthOf(unit) >= 100) continue;
    const type = typeOf(mind, unit);
    const inRange = enemies.some((enemy) => canAttack(type, typeOf(mind, enemy).classBits, distance(unit, enemy)));
    if (inRange && !type.digsTrenches) give(unit, { worth: 100, goal: null, exact: false });
  }

  // The enemy units, from the one worth most: up to four units to fields around each.
  const targets = [...enemies].sort((a, b) => (worths.get(b) ?? 0) - (worths.get(a) ?? 0));
  for (const target of targets) {
    const worth = worths.get(target) ?? 0;
    const targetType = typeOf(mind, target);
    const fighters = own.filter((unit) => {
      const type = typeOf(mind, unit);
      if (worthOf(unit) >= worth || has(mind, unit, IS_CARRIER) || type.digsTrenches) return false;
      if (type.attackMask & ATTACKS_INDIRECTLY || !canAttack(type, targetType.classBits, 1)) return false;
      if (outmatched(unit, target) || waitsForRepair(mind, unit)) return false;
      const beside = !unit.inside && distance(unit, target) === 1;
      return beside || (cannotMoveReason(state, unit) === null && distance(unit, target) < type.movementBudget / 2);
    });
    if (fighters.length === 0) continue;
    // For each field round the target, the units that could fight from it.
    const usable = Array.from({ length: DIRECTIONS }, (_, direction): Unit[] => {
      const field = fieldTowards(target, direction);
      if (!onMap(mind, field)) return [];
      const index = indexOf(mind, field);
      if (taken.has(index) || pinched(mind, field)) return [];
      return fighters.filter((unit) => (!unit.inside && sameField(unit, field)) || stopsFor(unit).has(index));
    });
    const placed: (Unit | null)[] = Array(DIRECTIONS).fill(null);
    const chosen = new Set<Unit>();
    for (let n = 0; n < ATTACKERS_PER_TARGET; n++) {
      let best: { unit: Unit; direction: number; score: number } | null = null;
      for (let direction = 0; direction < DIRECTIONS; direction++) {
        if (placed[direction]) continue;
        const opposite = (direction + 3) % DIRECTIONS;
        for (const unit of usable[direction]!) {
          if (chosen.has(unit)) continue;
          const hitsBack = (targetType.attackMask & typeOf(mind, unit).classBits & CLASS_BITS) !== 0;
          let score = hitsBack ? 0 : 1000;
          if (placed[opposite]) score += 500;
          else if (usable[opposite]!.some((other) => other !== unit && !chosen.has(other))) score += 100;
          if (placed[(direction + 1) % DIRECTIONS] && placed[(direction + 5) % DIRECTIONS]) score += 200;
          score += 10 * groundDefence(mind, indexOf(mind, fieldTowards(target, direction)));
          if (!unit.inside && sameField(unit, fieldTowards(target, direction))) score += 3;
          if (!best || score > best.score) best = { unit, direction, score };
        }
      }
      if (!best) break;
      placed[best.direction] = best.unit;
      chosen.add(best.unit);
      const field = fieldTowards(target, best.direction);
      const stays = !best.unit.inside && sameField(best.unit, field);
      give(best.unit, stays ? { worth, goal: null, exact: false } : { worth, goal: field, exact: true });
      if (stays) taken.add(indexOf(mind, field));
    }
  }

  // Whoever is left walks towards the enemy unit worth most that it can attack and get to.
  for (const unit of movable) {
    if (plans.has(unit) || has(mind, unit, IS_CARRIER)) continue;
    const goal = marchGoal(mind, unit, targets, worths);
    if (goal) plans.set(unit, { worth: 10, goal, exact: false });
  }
  return plans;
}

/** Where a unit with nothing else to do heads: the enemy unit worth most that it can attack and find a way to. */
function marchGoal(mind: Mind, unit: Unit, targets: Unit[], worths: Map<Unit, number>): Field | null {
  if (waitsForRepair(mind, unit)) return null;
  for (const target of targets) {
    if ((worths.get(target) ?? 0) <= 0 || !couldAttack(mind, unit, target)) continue;
    if (wayFrom(mind, unit, target) < UNREACHABLE) return { column: target.column, row: target.row };
  }
  return null;
}

/**
 * Moves a unit as far towards a field as it can get in this move. Returns the
 * field it went to, or null if it stayed.
 */
function advance(mind: Mind, unit: Unit, goal: Field, taken: Set<number>): Field | null {
  const { state } = mind;
  const type = typeOf(mind, unit);
  const ways = waysTo(mind, goal, unit.type);
  const here = unit.inside ? UNREACHABLE : ways[indexOf(mind, unit)]!;
  const target = unitAt(state, goal);
  // A unit that fires from afar goes no nearer than it has to.
  const reach = target && target.side === mind.other ? (weaponAgainst(type, typeOf(mind, target).classBits)?.range ?? 0) : 0;
  let best: { index: number; way: number; inRange: boolean; defence: number } | null = null;
  for (const index of stopsOf(mind, unit)) {
    if (taken.has(index)) continue;
    const way = ways[index]!;
    if (way >= UNREACHABLE) continue;
    const apart = distance(fieldAt(mind, index), goal);
    const inRange = reach > 1 && target !== null && canAttack(type, typeOf(mind, target).classBits, apart);
    const defence = groundDefence(mind, index);
    const better =
      !best ||
      (inRange !== best.inRange
        ? inRange
        : inRange
          ? apart > distance(fieldAt(mind, best.index), goal)
          : way < best.way || (way === best.way && defence > best.defence));
    if (better) best = { index, way, inRange, defence };
  }
  if (!best || (!best.inRange && best.way >= here)) return null;
  const to = fieldAt(mind, best.index);
  return moveUnit(state, unit, to).ok ? to : null;
}

function computerMoves(mind: Mind, turn: ComputerTurn): void {
  const { state, side } = mind;
  const plans = planMoves(mind);
  const taken = new Set<number>();
  for (const plan of plans.values()) if (plan.goal && plan.exact) taken.add(indexOf(mind, plan.goal));
  const go = (unit: Unit, goal: Field, exact: boolean) => {
    if (cannotMoveReason(state, unit) !== null) return;
    const from = { column: unit.column, row: unit.row };
    if (exact) {
      const result = moveUnit(state, unit, goal);
      if (result.ok) {
        turn.moves.push({ unit, from, to: goal, arrival: result.arrival });
        return;
      }
    }
    const own = exact ? indexOf(mind, goal) : -1;
    taken.delete(own);
    const to = advance(mind, unit, goal, taken);
    if (own >= 0) taken.add(own);
    if (to) turn.moves.push({ unit, from, to, arrival: 'field' });
  };

  const order = [...plans.entries()].sort(([, a], [, b]) => b.worth - a.worth);
  for (const [unit, plan] of order) if (plan.goal) go(unit, plan.goal, plan.exact);

  // Transports that carry units take them towards the nearest building that is not the side's.
  const targets = standing(mind, mind.other);
  const worths = targetWorths(mind);
  targets.sort((a, b) => (worths.get(b) ?? 0) - (worths.get(a) ?? 0));
  for (const carrier of standing(mind, side)) {
    if (carrier.cargo.length === 0 || !typeOf(mind, carrier).isTransport) continue;
    const goalOf = (unit: Unit) => plans.get(unit)?.goal ?? marchGoal(mind, unit, targets, worths);
    if (!carrier.cargo.some((unit) => goalOf(unit) !== null)) {
      const aim = state.buildings
        .filter((building) => building.owner !== side)
        .sort((a, b) => distance(carrier, a.entrance) - distance(carrier, b.entrance))[0];
      if (aim && cannotMoveReason(state, carrier) === null) {
        const from = { column: carrier.column, row: carrier.row };
        const nearer = stopsOf(mind, carrier)
          .filter((index) => !taken.has(index))
          .sort((a, b) => distance(fieldAt(mind, a), aim.entrance) - distance(fieldAt(mind, b), aim.entrance))[0];
        if (nearer !== undefined && distance(fieldAt(mind, nearer), aim.entrance) < distance(carrier, aim.entrance)) {
          const to = fieldAt(mind, nearer);
          if (moveUnit(state, carrier, to).ok) turn.moves.push({ unit: carrier, from, to, arrival: 'field' });
        }
      }
    }
    // What it carries gets out where it can walk on from.
    for (const unit of [...carrier.cargo]) {
      const goal = goalOf(unit);
      if (goal) go(unit, goal, plans.get(unit)?.exact ?? false);
    }
  }
}

// --- the half in which the side attacks --------------------------------------

function computerOrders(mind: Mind, turn: ComputerTurn, random: () => number): void {
  const { state, side } = mind;

  for (const unit of alive(mind, side)) {
    if (state.points[side] <= REPAIR_RESERVE) break;
    if (!unit.inside || !isBuilding(unit.inside) || cannotRepairReason(state, unit) !== null) continue;
    if (repairUnit(state, unit).ok) turn.repaired.push(unit);
  }

  // Each unit's best target; the units that fire from afar give their orders first.
  const worths = targetWorths(mind);
  const wanted: { unit: Unit; target: Field; worth: number; afar: boolean }[] = [];
  for (const unit of standing(mind, side)) {
    if (cannotAttackReason(state, unit) !== null) continue;
    let best: { target: Field; worth: number; losses: number } | null = null;
    for (const target of attackTargets(state, unit)) {
      const fight = foreseeFight(state, unit, target);
      if (!fight || (fight.targetLosses === 0 && fight.attackerLosses > 0)) continue;
      const worth = worths.get(fight.target) ?? 0;
      if (!best || worth > best.worth || (worth === best.worth && fight.targetLosses > best.losses)) {
        best = { target, worth, losses: fight.targetLosses };
      }
    }
    if (best) wanted.push({ unit, target: best.target, worth: best.worth, afar: has(mind, unit, FIRES_FROM_AFAR) });
  }
  wanted.sort((a, b) => Number(b.afar) - Number(a.afar) || (a.afar ? 0 : b.worth - a.worth));
  for (const { unit, target } of wanted) {
    if (orderAttack(state, unit, target).ok) turn.attacks.push({ unit, target });
  }

  // Factories: a unit for every free place, of a kind drawn from those the computer builds.
  for (const factory of state.buildings) {
    if (factory.kind !== 'factory' || factory.owner !== side) continue;
    const choices = buildChoices(state, factory);
    const marked = choices.filter(({ type }) => (mind.kinds[type]?.flags ?? 0) & IS_BUILT);
    // A table made for the other army marks nothing this side can build here.
    const offered = marked.length > 0 ? marked : choices.filter(({ type }) => derivedKind(state.unitTypes[type]!).flags & IS_BUILT);
    while (factory.units.length < PLACES && state.points[side] > BUILD_RESERVE) {
      const spare = state.points[side] - BUILD_RESERVE;
      const affordable = offered.filter(({ price }) => price <= spare);
      const pick = affordable[Math.floor(random() * affordable.length)];
      if (!pick) break;
      const result = buildUnit(state, factory, pick.type);
      if (!result.ok) break;
      turn.built.push(result.unit);
    }
  }
}

/**
 * Has the computer play a side's part of the half the game is in: its moves
 * if the side moves, its orders if it attacks. Does nothing once the battle
 * is over. Calling it twice in one half moves the units that stayed put the
 * first time and may build more, so call it once.
 */
export function computerPlay(state: GameState, side: Side, options: ComputerOptions = {}): ComputerTurn {
  const turn: ComputerTurn = { side, moves: [], attacks: [], repaired: [], built: [] };
  if (state.winner !== null) return turn;
  const mind = mindOf(state, side, options);
  if (state.mover === side) computerMoves(mind, turn);
  else if (attackerSide(state) === side) computerOrders(mind, turn, options.random ?? Math.random);
  return turn;
}

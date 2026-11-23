// UNIT.DAT in the game's root: one 69-byte record per unit type.
//
//   offset  field
//    0      movement budget for a turn
//    1      speed, as shown on the unit's information screen
//    2      armour
//    3      group size
//    5      terrain classes the unit can enter, one bit each
//    6      what it can attack: bit 2 ground units, bit 3 ships, bit 4
//           aircraft; bit 6: cannot fire at the fields next to it; bit 7:
//           does not fire back
//    8      range against air targets, plus 1
//    9      range against ground and water targets, plus 1
//   10      power against air targets
//   11      power against ground targets
//   12      power against water targets
//   13      what it is, as a target: bit 2 a ground unit, bit 3 a ship, bit 4
//           an aircraft; bit 6: one half of a ship that fills two fields
//           (bit 7 on its first half). The second half is the next kind in
//           the table: it only gives the ship's rear its picture.
//   14      bit 4: transport
//   15      bit 0: cannot attack in the half after the one it moved in (the
//           medium, heavy and train artillery)
//   17      (a word with byte 18) bit 0: may use any side's building
//           entrances; bit 4: every field costs it 2 to enter (the balloon);
//           bits 6 to 11: which transports can carry it; bit 13: digs
//           trenches in place of attacking (the sappers); bit 14: builds
//           depots (the construction unit)
//   19      (a word with byte 20) bits 6 to 11: for a transport, which units
//           it carries: those sharing one of these bits with it
//   27      char[17] class name
//   44      char[19] name
//   63      price; 255 for the bunker and the ships
//   64      transport capacity
//   65      weight: what it adds to a transport's load
//
// Speed, armour, group size, weapons, cost, capacity and weight were checked
// against the data sheets in the game's manual for all 51 unit types. They
// agree except in three places: the manual gives anti-tank guns speed 2 where
// the file has 3, gives trains and large ships a group size of 1 where the
// file has 6, and gives trains a weight where the file has 0.
//
// Battle Isle's table (27 kinds in each of its three games) has the same
// record without its first byte, 68 bytes: it has no movement budget apart
// from the speed, and a unit there moves on its speed. The two names are the
// other way round, the model first and the kind of unit after it. Bit 13 of
// the word at byte 17 is set for three of its transports and means something
// else there; Battle Isle has no trenches. Its ships have a group size of 1
// and a 6 in the byte after it, which History Line leaves at 0. Battle Isle's
// numbers were not checked against its manual.
//
// The terrain mask follows the manual's seven kinds of terrain and holds for
// every train and ship placed on the game's maps. The movement budget and the
// flag bits in bytes 6, 13 to 15 and 17 to 20 are as the hl1914-18 project's
// notes describe the game using them; see src/game/movement.ts,
// src/game/combat.ts and src/game/state.ts. The remaining bytes are kept in
// `raw`.

import { paddedText } from './bytes.ts';
import { unpackIfPacked } from './tpwm.ts';

const RECORD_SIZE = 69;
/** Battle Isle's record: History Line's without the movement budget in front. */
const BATTLE_ISLE_RECORD_SIZE = RECORD_SIZE - 1;

/** Which game's unit table a file is. */
export type UnitLayout = 'historyline' | 'battleisle';
const CANNOT_BE_BUILT = 255;
const LOAD_CLASS_BITS = 0x0fc0;

export interface Weapon {
  /** How many fields away it reaches. 0 means it only fires back when attacked. */
  range: number;
  power: number;
}

export interface UnitType {
  /** The unit's class as the game names it, for example "TANK". */
  className: string;
  name: string;
  /** What the unit can spend on entering fields in one turn. */
  movementBudget: number;
  /** The speed the game shows for the unit. */
  speed: number;
  armour: number;
  /** How many vehicles, guns or men a full-strength unit has. */
  groupSize: number;
  /** Weapons by kind of target; null where the unit has none. */
  weapons: { air: Weapon | null; ground: Weapon | null; water: Weapon | null };
  /** Bit mask of the terrain classes the unit can enter; see TERRAIN_CLASSES. */
  terrainMask: number;
  /** What the unit can attack and how; see the ATTACKS_* bits in src/game/combat.ts. */
  attackMask: number;
  /** What the unit is as a target; see the CLASS_* bits in src/game/combat.ts. */
  classBits: number;
  /** Pays the terrain's air cost instead of its surface cost. */
  isAircraft: boolean;
  /** Carries other units; a friendly unit can move onto it to be loaded. */
  isTransport: boolean;
  /** One half of a ship that fills two fields. It cannot pass through other units. */
  isShipHalf: boolean;
  /** The second half of such a ship: not a unit of its own, only the picture of the ship's rear. */
  isShipBack: boolean;
  /** May use the building entrances of any side, not only its own. */
  entersAnyBuilding: boolean;
  /** Pays 2 for every field, whatever the terrain. */
  flatMoveCost: boolean;
  /** Points needed to build one, or null for the kinds the file prices at 255 (see `price`). */
  cost: number | null;
  /** The price as the file has it: 255 for the kinds `cost` gives as null. */
  price: number;
  /** Builds depots; it costs more to repair. */
  buildsDepots: boolean;
  /** Digs trenches and fills them in, in place of attacking; its weapons only fire back. */
  digsTrenches: boolean;
  /** Cannot attack in the half after the one it moved in. */
  slowToFire: boolean;
  /** Total weight a transport can carry; 0 for units that carry nothing. */
  capacity: number;
  /** What the unit adds to a transport's load. */
  weight: number;
  /** Which transports can carry the unit: those whose `carries` shares a bit with this. */
  loadClasses: number;
  /** For a transport, the load classes it carries; 0 for other units. */
  carries: number;
  raw: Uint8Array;
}

export function decodeUnitTypes(file: Uint8Array, layout: UnitLayout = 'historyline'): UnitType[] {
  const data = unpackIfPacked(file);
  const battleIsle = layout === 'battleisle';
  const size = battleIsle ? BATTLE_ISLE_RECORD_SIZE : RECORD_SIZE;
  if (data.length % size !== 0) {
    throw new Error(`unit table length ${data.length} is not a multiple of ${size}`);
  }
  const types: UnitType[] = [];
  for (let at = 0; at < data.length; at += size) {
    const stored = data.subarray(at, at + size);
    // A Battle Isle record is read as History Line's, with its speed as its budget.
    const raw = battleIsle ? Uint8Array.of(stored[0]!, ...stored) : stored;
    const first = paddedText(raw, 27, 17).trim();
    const second = paddedText(raw, 44, 19).trim();
    const weapon = (rangeByte: number, powerByte: number): Weapon | null => {
      const power = raw[powerByte]!;
      return power === 0 ? null : { range: Math.max(0, raw[rangeByte]! - 1), power };
    };
    types.push({
      className: battleIsle ? second : first,
      name: battleIsle ? first : second,
      movementBudget: raw[0]!,
      speed: raw[1]!,
      armour: raw[2]!,
      groupSize: raw[3]!,
      weapons: { air: weapon(8, 10), ground: weapon(9, 11), water: weapon(9, 12) },
      terrainMask: raw[5]!,
      attackMask: raw[6]!,
      classBits: raw[13]!,
      isAircraft: (raw[13]! & 0x10) !== 0,
      isShipHalf: (raw[13]! & 0x40) !== 0,
      isShipBack: (raw[13]! & 0xc0) === 0x40,
      isTransport: (raw[14]! & 0x10) !== 0,
      entersAnyBuilding: (raw[17]! & 0x01) !== 0,
      flatMoveCost: (raw[17]! & 0x10) !== 0,
      cost: raw[63] === CANNOT_BE_BUILT ? null : raw[63]!,
      price: raw[63]!,
      buildsDepots: (raw[18]! & 0x40) !== 0,
      digsTrenches: !battleIsle && (raw[18]! & 0x20) !== 0,
      slowToFire: (raw[15]! & 0x01) !== 0,
      capacity: raw[64]!,
      weight: raw[65]!,
      loadClasses: (raw[17]! | (raw[18]! << 8)) & LOAD_CLASS_BITS,
      carries: (raw[19]! | (raw[20]! << 8)) & LOAD_CLASS_BITS,
      raw: stored,
    });
  }
  return types;
}

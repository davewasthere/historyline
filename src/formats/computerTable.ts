// MAP\nn.COM: what the computer's player knows about each unit kind on a
// single-player map. Six bytes for each of the 51 kinds:
//
//   offset  field
//    0      what a unit of this kind is worth as a target (signed)
//    1      not read by the game (1 to 5 in the files)
//    2-3    how the computer uses units of this kind, as bits (little-endian):
//             0x001  takes buildings
//             0x002  fires from where it stands when something is in range
//             0x004, 0x008, 0x010  may escort certain units
//             0x020  wants an escort
//             0x040  guards the headquarters
//             0x080, 0x100, 0x200  a transport: never sent to fight
//             0x400  a kind the computer builds in its factories
//    4      how many units escort one of this kind
//    5      not read by the game (0 in the files)
//
// The layout and the meaning of the bits are as the hl1914-18 project's port
// uses them; the names of the bits are that project's reading. The 48 files
// come in four versions: maps 00 to 20 share one, in which the kinds the
// computer builds are French; most of the rest share another, in which they
// are German.

import { unpackIfPacked } from './tpwm.ts';

const RECORD_SIZE = 6;

export const TAKES_BUILDINGS = 0x001;
export const FIRES_FROM_AFAR = 0x002;
export const GUARDS_HEADQUARTERS = 0x040;
export const IS_CARRIER = 0x380;
export const IS_BUILT = 0x400;

export interface ComputerKind {
  /** What a unit of this kind is worth as a target. */
  worth: number;
  /** The bits above. */
  flags: number;
  escorts: number;
}

/** One record for each unit kind, in the order of the unit table. */
export type ComputerTable = ComputerKind[];

export function decodeComputerTable(file: Uint8Array): ComputerTable {
  const data = unpackIfPacked(file);
  if (data.length === 0 || data.length % RECORD_SIZE !== 0) {
    throw new Error(`computer table length ${data.length} is not a multiple of ${RECORD_SIZE}`);
  }
  const kinds: ComputerTable = [];
  for (let at = 0; at < data.length; at += RECORD_SIZE) {
    kinds.push({
      worth: (data[at]! << 24) >> 24,
      flags: data[at + 2]! | (data[at + 3]! << 8),
      escorts: data[at + 4]!,
    });
  }
  return kinds;
}

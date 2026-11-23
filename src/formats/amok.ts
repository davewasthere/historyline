// AMOK.DAT: 36 terrain numbers the program changes fields to.
//
//   offset  field
//    0-2    a factory's entrance: first side's, second side's, nobody's
//    3-5    a depot's entrance, in the same order
//    6-7    a headquarters' entrance: first side's, second side's
//    24-27  ground prepared for a depot: the field its entrance will be on,
//           then the fields to its lower right, below it and to its lower
//           left
//    28     nobody's depot entrance again (in The Desert a factory's, which
//           looks like a slip in that file); not used here
//    29-31  a depot's other fields: lower right, below, lower left
//
// The rest is unknown. Bytes 24 to 27 and 29 to 31 are as the hl1914-18
// project's notes give them for History Line; the first eight were read off
// the terrain tables, where each of those numbers is the entrance named. A
// building that changes hands gets its new entrance by looking the terrain
// table up (see entranceTerrain in terrain.ts), which gives the same numbers.

import type { WorkGround } from '../game/rules.ts';
import { unpackIfPacked } from './tpwm.ts';

const LENGTH = 36;

export function decodeWorkGround(file: Uint8Array): WorkGround {
  const data = unpackIfPacked(file);
  if (data.length !== LENGTH) throw new Error(`AMOK.DAT is ${data.length} bytes, expected ${LENGTH}`);
  return { preparedGround: [...data.subarray(24, 28)], depotGround: [...data.subarray(29, 32)] };
}

// MAP\nn.SHP: what can be built on a map, and the contents of its buildings
// and loaded transports.
//
//   u8 unavailable[51]   per unit type: 0 = can be built, 1 = not available
//   u8 count
//   count records of 12 bytes:
//     u8 owner       0 German, 1 French, 2 neutral
//     u8 kind        0 headquarters, 1 factory, 2 depot, 3 transport unit
//     u8 index       which one: a headquarters by its side; a factory or depot
//                    by its number among those of its kind as the map is read
//                    row by row; a transport by its number among the
//                    transports, those on the map first and then those these
//                    records make
//     u8 resources   what the building adds to its owner's points each round
//     u8 worth       what the building is worth to the computer's player as
//                    something to take
//     u8 contents[7] unit types inside, 0xFF = empty slot
//
// Layout as documented on the ModdingWiki ("Battle Isle / History Line map
// format"), which leaves the fifth byte unexplained. How the index is
// counted and what the resources and the worth are for come from the
// hl1914-18 project; see createGame in src/game/state.ts, which puts the units
// inside, and src/game/computer.ts.

import { unpackIfPacked } from './tpwm.ts';

export const UNIT_TYPE_COUNT = 51;
const RECORD_SIZE = 12;
const EMPTY_SLOT = 0xff;

export const SHOP_KINDS = ['headquarters', 'factory', 'depot', 'transport'] as const;
export const OWNERS = ['German', 'French', 'neutral'] as const;

export interface Shop {
  owner: number;
  kind: number;
  index: number;
  resources: number;
  /** What the building is worth to the computer's player; unused for a transport. */
  worth: number;
  /** Unit types held inside. */
  contents: number[];
}

export interface MapShops {
  /** Unit types that can be built on this map. */
  buildable: number[];
  shops: Shop[];
}

export function decodeShops(file: Uint8Array): MapShops {
  const data = unpackIfPacked(file);
  const count = data[UNIT_TYPE_COUNT];
  if (count === undefined) throw new Error('shop file is too short');
  const expected = UNIT_TYPE_COUNT + 1 + count * RECORD_SIZE;
  if (data.length !== expected) {
    throw new Error(`shop file with ${count} records needs ${expected} bytes, has ${data.length}`);
  }
  const buildable: number[] = [];
  for (let type = 0; type < UNIT_TYPE_COUNT; type++) if (data[type] === 0) buildable.push(type);

  const shops: Shop[] = [];
  for (let i = 0; i < count; i++) {
    const at = UNIT_TYPE_COUNT + 1 + i * RECORD_SIZE;
    shops.push({
      owner: data[at]!,
      kind: data[at + 1]!,
      index: data[at + 2]!,
      resources: data[at + 3]!,
      worth: data[at + 4]!,
      contents: [...data.subarray(at + 5, at + RECORD_SIZE)].filter((type) => type !== EMPTY_SLOT),
    });
  }
  return { buildable, shops };
}

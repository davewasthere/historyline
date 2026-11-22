// CODES.DAT: one 10-byte record per map, in map-number order.
//
//   offset  field
//    0      char[5] the map's code word, each letter stored as its place in
//           the alphabet plus 16 ('A' is 17)
//    5      always 2; unknown
//    6      number of players: 1 on maps 00-47, 2 on maps 48-71
//    7      0 on the last map of each group of 24, else 1; unknown
//    8      bit 1 set: the map is played in winter
//    9      always 0; unknown
//
// The winter bit is how the game itself picks between the summer and winter
// terrain libraries (PARTS and PARTW). That reading comes from the notes of
// the hl1914-18 project, which traced it in the running game; the other
// fields are read off the values. Byte 8 is also 1, without the winter bit, on
// maps 23 and 47.

import { unpackIfPacked } from './tpwm.ts';

const RECORD_SIZE = 10;
const CODE_LENGTH = 5;
const LETTER_BASE = 16;
const WINTER_BIT = 2;

export interface MapRecord {
  /** The word a player types to start this map. */
  code: string;
  players: number;
  winter: boolean;
  raw: Uint8Array;
}

export function decodeMapRecords(file: Uint8Array): MapRecord[] {
  const data = unpackIfPacked(file);
  if (data.length % RECORD_SIZE !== 0) {
    throw new Error(`map record table length ${data.length} is not a multiple of ${RECORD_SIZE}`);
  }
  const records: MapRecord[] = [];
  for (let at = 0; at < data.length; at += RECORD_SIZE) {
    const raw = data.subarray(at, at + RECORD_SIZE);
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += String.fromCharCode(64 + raw[i]! - LETTER_BASE);
    records.push({ code, players: raw[6]!, winter: (raw[8]! & WINTER_BIT) !== 0, raw });
  }
  return records;
}

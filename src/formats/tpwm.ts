// TPWM ("Turbo Packer" by Wolfgang Mayerle) is the LZ scheme that wraps almost
// every data file of the game.
//
//   "TPWM"  u32le unpacked size  stream
//
// The stream is a flag byte followed by 8 items, read from the flag's most
// significant bit down:
//   bit 0 -> one literal byte
//   bit 1 -> two bytes b1 b2: copy (b1 & 0x0F) + 3 bytes starting
//            ((b1 & 0xF0) << 4 | b2) bytes back in the output.

import { u32le } from './bytes.ts';

const HEADER_SIZE = 8;

export interface Unpacked {
  data: Uint8Array;
  /** Input bytes the block occupied, header included. */
  used: number;
}

export function isTpwm(data: Uint8Array, at = 0): boolean {
  return (
    data.length >= at + HEADER_SIZE &&
    data[at] === 0x54 && // T
    data[at + 1] === 0x50 && // P
    data[at + 2] === 0x57 && // W
    data[at + 3] === 0x4d // M
  );
}

export function unpackTpwm(data: Uint8Array, start = 0, end = data.length): Unpacked {
  if (!isTpwm(data, start)) throw new Error('not a TPWM block');
  const size = u32le(data, start + 4);
  const out = new Uint8Array(size);
  let ip = start + HEADER_SIZE;
  let op = 0;
  const need = (count: number) => {
    if (ip + count > end) throw new Error(`TPWM input ran out at ${op} of ${size} bytes`);
  };
  while (op < size) {
    need(1);
    let flags = data[ip++]!;
    for (let bit = 0; bit < 8 && op < size; bit++, flags <<= 1) {
      if (flags & 0x80) {
        need(2);
        const b1 = data[ip++]!;
        const b2 = data[ip++]!;
        const distance = ((b1 & 0xf0) << 4) | b2;
        const length = (b1 & 0x0f) + 3;
        if (distance === 0 || distance > op) {
          throw new Error(`TPWM back-reference of ${distance} at output ${op}`);
        }
        // Byte by byte on purpose: source and destination may overlap.
        for (let i = 0; i < length && op < size; i++, op++) out[op] = out[op - distance]!;
      } else {
        need(1);
        out[op++] = data[ip++]!;
      }
    }
  }
  return { data: out, used: ip - start };
}

/** Unpacks `data` if it is a TPWM block and returns it unchanged otherwise. */
export function unpackIfPacked(data: Uint8Array): Uint8Array {
  return isTpwm(data) ? unpackTpwm(data).data : data;
}

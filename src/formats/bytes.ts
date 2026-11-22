// Small readers over Uint8Array, so the decoders run unchanged in Node and
// in the browser.

export function u16le(data: Uint8Array, at: number): number {
  return byte(data, at) | (byte(data, at + 1) << 8);
}

export function u16be(data: Uint8Array, at: number): number {
  return (byte(data, at) << 8) | byte(data, at + 1);
}

export function u32le(data: Uint8Array, at: number): number {
  return (u16le(data, at) | (u16le(data, at + 2) << 16)) >>> 0;
}

/** Reads `length` bytes as Latin-1 text. */
export function text(data: Uint8Array, at: number, length: number): string {
  if (at + length > data.length) throw new RangeError(`read past end at ${at + length}`);
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(data[at + i]!);
  return out;
}

/** Reads a fixed-width field that is padded with NULs or spaces. */
export function paddedText(data: Uint8Array, at: number, length: number): string {
  const raw = text(data, at, length);
  const nul = raw.indexOf('\0');
  return (nul < 0 ? raw : raw.slice(0, nul)).trimEnd();
}

function byte(data: Uint8Array, at: number): number {
  const value = data[at];
  if (value === undefined) throw new RangeError(`read past end at ${at}`);
  return value;
}

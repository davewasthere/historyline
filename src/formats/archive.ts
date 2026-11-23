// Library archives (*.LIB and several *.DAT files).
//
//   u32le directory offset
//   entries...
//   directory: { char name[8]; u32le offset } until end of file
//
// Either the whole archive is TPWM-packed, or each entry is packed on its own.
// Layout as documented on the ModdingWiki ("Battle Isle / History Line library
// format").
//
// Most of Battle Isle 2's libraries have eight more bytes after the directory
// offset: "TCT ", the number of entries and a word that is always 0x49. Their
// entries then start at 12 and are not packed.

import { paddedText, text, u32le } from './bytes.ts';
import { unpackIfPacked } from './tpwm.ts';

const RECORD_SIZE = 12;
/** Where the first entry starts: after the directory offset, or after a "TCT " header as well. */
const FIRST_ENTRY = 4;
const FIRST_ENTRY_TCT = 12;

export interface ArchiveSlot {
  name: string;
  offset: number;
  end: number;
}

/**
 * Returns the directory of an unpacked archive in directory order, or null if
 * `data` does not have the archive layout.
 */
export function readArchiveDirectory(data: Uint8Array): ArchiveSlot[] | null {
  if (data.length < 4 + RECORD_SIZE) return null;
  const directory = u32le(data, 0);
  const directorySize = data.length - directory;
  const first = data.length >= FIRST_ENTRY_TCT && text(data, 4, 4) === 'TCT ' ? FIRST_ENTRY_TCT : FIRST_ENTRY;
  if (directory < first || directorySize < RECORD_SIZE || directorySize % RECORD_SIZE !== 0) return null;

  const slots: ArchiveSlot[] = [];
  for (let at = directory; at < data.length; at += RECORD_SIZE) {
    const name = paddedText(data, at, 8);
    const offset = u32le(data, at + 8);
    if (offset < first || offset >= directory || !/^[\x21-\x7e]+$/.test(name)) return null;
    slots.push({ name, offset, end: directory });
  }
  if (!slots.some((slot) => slot.offset === first)) return null;

  // An entry runs up to the next higher offset; the last one runs to the directory.
  const starts = [...new Set(slots.map((slot) => slot.offset))].sort((a, b) => a - b);
  for (const slot of slots) {
    slot.end = starts[starts.indexOf(slot.offset) + 1] ?? directory;
  }
  return slots;
}

export interface ArchiveEntry {
  name: string;
  data: Uint8Array;
}

/** Opens an archive file as stored on disk and returns its entries unpacked. */
export function readArchive(file: Uint8Array): ArchiveEntry[] {
  const data = unpackIfPacked(file);
  const slots = readArchiveDirectory(data);
  if (!slots) throw new Error('not a library archive');
  return slots.map((slot) => ({
    name: slot.name,
    data: unpackIfPacked(data.subarray(slot.offset, slot.end)),
  }));
}

/**
 * Opens an archive nothing in which is packed, as Battle Isle 2's are: its
 * entries are bare pixels, which could start with any four bytes.
 */
export function readPlainArchive(file: Uint8Array): ArchiveEntry[] {
  const slots = readArchiveDirectory(file);
  if (!slots) throw new Error('not a library archive');
  return slots.map((slot) => ({ name: slot.name, data: file.subarray(slot.offset, slot.end) }));
}

/**
 * Reads the list of 8-character names in a library's companion .DAT file. The
 * position in this list is the number the game uses for that graphic.
 */
export function readNameList(file: Uint8Array): string[] {
  const data = unpackIfPacked(file);
  if (data.length % 8 !== 0) throw new Error(`name list length ${data.length} is not a multiple of 8`);
  const names: string[] = [];
  for (let at = 0; at < data.length; at += 8) names.push(paddedText(data, at, 8));
  return names;
}

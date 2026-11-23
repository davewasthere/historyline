// Reads files out of a CD image: ISO 9660, either as plain 2048-byte sectors
// or as the raw 2352-byte sectors of a MODE1 track (the .gog files of the GOG
// installs), where a sector's 2048 bytes of data follow a 16-byte header.
//
// Only what is asked for is read from the image; it is never loaded whole.
// The image stays open for as long as the program runs: the tools and the
// development server read from it again and again.

import { closeSync, openSync, read as readCallback } from 'node:fs';
import { promisify } from 'node:util';

const readAt = promisify(readCallback);

const DATA_BYTES = 2048;
const RAW_SECTOR = 2352;
const RAW_HEADER = 16;
/** A raw sector starts with this. */
const SYNC = '00ffffffffffffffffffff00';
const VOLUME_DESCRIPTOR = 16;
const IS_DIRECTORY = 2;

interface Extent {
  sector: number;
  length: number;
  directory: boolean;
}

export interface CdImage {
  /** Reads a file by its path on the CD, with forward slashes; upper and lower case are the same. */
  read(path: string): Promise<Uint8Array>;
  /** The names of the files in a folder of the CD. */
  list(directory: string): Promise<string[]>;
}

export async function openCdImage(path: string): Promise<CdImage> {
  const file = openSync(path, 'r');
  const probe = Buffer.alloc(12);
  await readAt(file, probe, 0, 12, 0);
  const raw = probe.toString('hex') === SYNC;
  const sectorSize = raw ? RAW_SECTOR : DATA_BYTES;
  const header = raw ? RAW_HEADER : 0;

  const readExtent = async (sector: number, length: number): Promise<Buffer> => {
    const out = Buffer.alloc(length);
    for (let done = 0; done < length; done += DATA_BYTES, sector++) {
      await readAt(file, out, done, Math.min(DATA_BYTES, length - done), sector * sectorSize + header);
    }
    return out;
  };

  const descriptor = await readExtent(VOLUME_DESCRIPTOR, DATA_BYTES);
  if (descriptor[0] !== 1 || descriptor.toString('latin1', 1, 6) !== 'CD001') {
    closeSync(file);
    throw new Error(`${path} is not an ISO 9660 CD image`);
  }
  // The root directory's record sits in the volume descriptor.
  const root: Extent = { sector: descriptor.readUInt32LE(158), length: descriptor.readUInt32LE(166), directory: true };

  const directories = new Map<string, Promise<Map<string, Extent & { name: string }>>>();
  const entriesOf = (extent: Extent, key: string) => {
    let entries = directories.get(key);
    if (!entries) {
      entries = readExtent(extent.sector, extent.length).then((data) => {
        const found = new Map<string, Extent & { name: string }>();
        for (let at = 0; at < data.length; ) {
          const length = data[at]!;
          if (length === 0) {
            // Records do not cross sectors: the rest of this one is empty.
            at = (Math.floor(at / DATA_BYTES) + 1) * DATA_BYTES;
            continue;
          }
          const nameLength = data[at + 32]!;
          const name = data.toString('latin1', at + 33, at + 33 + nameLength).replace(/;\d+$/, '');
          // The first two records are the folder itself and the one above it.
          if (name !== '\0' && name !== '\x01') {
            found.set(name.toUpperCase(), {
              name,
              sector: data.readUInt32LE(at + 2),
              length: data.readUInt32LE(at + 10),
              directory: (data[at + 25]! & IS_DIRECTORY) !== 0,
            });
          }
          at += length;
        }
        return found;
      });
      directories.set(key, entries);
    }
    return entries;
  };

  const find = async (path: string): Promise<Extent> => {
    let extent = root;
    let key = '';
    for (const part of path.split('/').filter((piece) => piece !== '')) {
      if (!extent.directory) throw new Error(`${path} is not on the CD`);
      const next = (await entriesOf(extent, key)).get(part.toUpperCase());
      if (!next) throw new Error(`${path} is not on the CD`);
      extent = next;
      key += `/${part.toUpperCase()}`;
    }
    return extent;
  };

  return {
    async read(path) {
      const extent = await find(path);
      if (extent.directory) throw new Error(`${path} is a folder`);
      return new Uint8Array(await readExtent(extent.sector, extent.length));
    },
    async list(directory) {
      const extent = await find(directory);
      if (!extent.directory) throw new Error(`${directory} is not a folder`);
      const key = directory.split('/').filter((piece) => piece !== '').map((piece) => `/${piece.toUpperCase()}`).join('');
      return [...(await entriesOf(extent, key)).values()].filter((entry) => !entry.directory).map((entry) => entry.name);
    },
  };
}

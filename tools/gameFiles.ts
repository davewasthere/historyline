// Reads the original game's files from disk, for the command-line tools and
// the development server.

import { readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { FileSource } from '../src/viewer/assets.ts';

const DEFAULT_GAME_DIR = 'C:\\GOG Games\\Battle Isle Historyline 1914-1918';

/** The folder of the installed game: $HL_GAME_DIR, or the GOG default. */
export function gameDir(): string {
  return resolve(process.env.HL_GAME_DIR ?? DEFAULT_GAME_DIR);
}

/** Resolves a path inside the game folder, refusing anything that leaves it. */
export function resolveInGame(root: string, path: string): string {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`path "${path}" is outside the game folder`);
  }
  return full;
}

export function diskFiles(root = gameDir()): FileSource {
  return {
    read: async (path) => new Uint8Array(await readFile(resolveInGame(root, path))),
    list: async (directory) => {
      const entries = await readdir(resolveInGame(root, directory), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    },
  };
}

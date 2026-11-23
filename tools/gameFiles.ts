// Reads the original games' files from disk, for the command-line tools and
// the development server.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { GAME_IDS, GAMES, isGameId, type GameProfile, type InstallId } from '../src/games.ts';
import type { FileSource } from '../src/viewer/assets.ts';

/**
 * Where each install is looked for: the environment variable that names its
 * folder, and the GOG install path used without it. Battle Isle's folder is
 * the one that holds ISLE, DESERT and MOON.
 */
const INSTALLS: Record<InstallId, { variable: string; folder: string }> = {
  historyline: { variable: 'HL_GAME_DIR', folder: 'C:\\GOG Games\\Battle Isle Historyline 1914-1918' },
  battleisle: { variable: 'BI_GAME_DIR', folder: 'C:\\GOG Games\\Battle Isle' },
};

/** The folder of a game's files: History Line's unless another game is named. */
export function gameDir(profile: GameProfile = GAMES.historyline): string {
  const install = INSTALLS[profile.install];
  return resolve(process.env[install.variable] ?? install.folder, profile.folder);
}

/** The games whose folders are there. */
export function installedGames(): GameProfile[] {
  return GAME_IDS.map((id) => GAMES[id]).filter((profile) => existsSync(gameDir(profile)));
}

/** The game a tool's --game option names; History Line without one. */
export function gameNamed(name: string | undefined): GameProfile {
  if (name === undefined) return GAMES.historyline;
  const id = name.toLowerCase();
  if (!isGameId(id)) throw new Error(`--game must be one of ${GAME_IDS.join(', ')}`);
  return GAMES[id];
}

/** Resolves a path inside a game's folder, refusing anything that leaves it. */
export function resolveInGame(root: string, path: string): string {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`path "${path}" is outside the game folder`);
  }
  return full;
}

/** Reads a game's files from its folder: History Line's unless another game, or a folder, is given. */
export function diskFiles(game: GameProfile | string = GAMES.historyline): FileSource {
  const root = typeof game === 'string' ? game : gameDir(game);
  return {
    read: async (path) => new Uint8Array(await readFile(resolveInGame(root, path))),
    list: async (directory) => {
      const entries = await readdir(resolveInGame(root, directory), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    },
  };
}

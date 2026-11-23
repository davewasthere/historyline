// Reads the original games' files from disk, for the command-line tools and
// the development server.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { BI2_DISKS, BI2_GAME_ID, type Bi2Disk } from '../src/bi2/games.ts';
import { GAME_IDS, GAMES, isGameId, type GameProfile, type InstallId } from '../src/games.ts';
import type { FileSource } from '../src/viewer/assets.ts';
import { openCdImage, type CdImage } from './cdImage.ts';

/**
 * Where each install is looked for: the environment variable that names its
 * folder, and the GOG install path used without it. Battle Isle's folder is
 * the one that holds ISLE, DESERT and MOON; Battle Isle 2's the one that
 * holds ISLE2 and SCENERY.
 */
const INSTALLS: Record<InstallId | 'battleisle2', { variable: string; folder: string }> = {
  historyline: { variable: 'HL_GAME_DIR', folder: 'C:\\GOG Games\\Battle Isle Historyline 1914-1918' },
  battleisle: { variable: 'BI_GAME_DIR', folder: 'C:\\GOG Games\\Battle Isle' },
  battleisle2: { variable: 'BI2_GAME_DIR', folder: 'C:\\GOG Games\\Battle Isle 2' },
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
  if (!isGameId(id)) throw new Error(`--game must be one of ${[...GAME_IDS, BI2_GAME_ID].join(', ')}`);
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

// --- Battle Isle 2, which is read from its folder and its CD image -----------

/** The folder a Battle Isle 2 disk is installed in. */
function bi2Folder(disk: Bi2Disk): string {
  const install = INSTALLS.battleisle2;
  return resolve(process.env[install.variable] ?? install.folder, disk.folder);
}

/** The CD image of a Battle Isle 2 disk. */
export function bi2ImagePath(disk: Bi2Disk): string {
  return join(bi2Folder(disk), disk.image);
}

/** The Battle Isle 2 disks whose CD images are there, the game before its add-on. */
export function installedBi2Disks(): Bi2Disk[] {
  return BI2_DISKS.filter((disk) => existsSync(bi2ImagePath(disk)));
}

/** Whether a tool's --game option names Battle Isle 2. */
export function namesBi2(name: string | undefined): boolean {
  return name?.toLowerCase() === BI2_GAME_ID;
}

/**
 * Reads a Battle Isle 2 disk's files: from the folder it is installed in, and
 * what is not there from the game's folder on its CD image. Neither has
 * everything: the missions are only on the CD, and the add-on's palette only
 * in its folder. The image is opened when it is first needed and kept open.
 */
export function bi2Files(disk: Bi2Disk): FileSource {
  const folder = diskFiles(bi2Folder(disk));
  let image: Promise<CdImage> | undefined;
  const opened = () => (image ??= openCdImage(bi2ImagePath(disk)));
  // A path that climbs out of the game's folder is not looked for at all.
  const onCd = (path: string) => {
    if (path.split('/').includes('..')) throw new Error(`path "${path}" is outside the game folder`);
    return disk.imageRoot + path;
  };
  return {
    read: (path) => folder.read(path).catch(async () => (await opened()).read(onCd(path))),
    list: async (directory) => {
      const [installed, pressed] = await Promise.all([
        folder.list(directory).catch(() => []),
        opened().then((cd) => cd.list(onCd(directory))).catch(() => []),
      ]);
      const names = new Map([...pressed, ...installed].map((name) => [name.toUpperCase(), name]));
      if (names.size === 0) throw new Error(`there is no folder ${directory}`);
      return [...names.values()];
    },
  };
}

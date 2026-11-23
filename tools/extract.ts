// Copies out of the installed games just the files the viewer reads, so that
// it can be hosted without the games beside it (see the Dockerfile).
//
//   node tools/extract.ts [outDir]
//
// outDir defaults to <project>/game-data, which is git-ignored: these are the
// games' own files and must not be committed or passed on.
//
// What is needed is found by doing what the viewer does, for every game that
// is installed, and noting what it asks for: loading the tiles and tables,
// listing the maps and loading each one. The files are written as they are,
// under the paths the viewer asks for them by:
//
//   <outDir>/index.json                 the games found, as the viewer's list has them
//   <outDir>/<game>/<path>              a file
//   <outDir>/<game>/<folder>/index.json the names of the files in a folder the viewer lists
//
// A web server that answers a request for a folder with its index.json then
// serves the viewer what the development server does under /game. For Battle
// Isle 2, <game> is one of its two disks, and the missions come off the CD
// images.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadBi2Game } from '../src/bi2/assets.ts';
import { BI2_GAME_ID } from '../src/bi2/games.ts';
import { listMaps, loadAssets, loadMap, type FileSource } from '../src/viewer/assets.ts';
import { bi2Files, diskFiles, installedBi2Disks, installedGames } from './gameFiles.ts';

const outDir = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'game-data'));

interface Recorded {
  files: Map<string, Uint8Array>;
  /** The folders listed, each with the names it was said to hold. */
  folders: Map<string, string[]>;
}

/** A source that reads from another and keeps what was read and listed. */
function recording(source: FileSource): { source: FileSource; recorded: Recorded } {
  const recorded: Recorded = { files: new Map(), folders: new Map() };
  return {
    recorded,
    source: {
      async read(path) {
        const data = await source.read(path);
        recorded.files.set(path, data);
        return data;
      },
      async list(directory) {
        const names = await source.list(directory);
        recorded.folders.set(directory, names);
        return names;
      },
    },
  };
}

/** Writes what was read of a game, and for each folder listed the names of its files that were read. */
async function write(game: string, { files, folders }: Recorded): Promise<number> {
  let bytes = 0;
  for (const [path, data] of files) {
    const target = join(outDir, game, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    bytes += data.length;
  }
  for (const [folder, names] of folders) {
    // Only what the viewer went on to read: a list that named more would send it after files that are not here.
    const kept = names.filter((name) => files.has(`${folder}/${name}`));
    await mkdir(join(outDir, game, folder), { recursive: true });
    await writeFile(join(outDir, game, folder, 'index.json'), JSON.stringify(kept));
  }
  return bytes;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

await rm(outDir, { recursive: true, force: true });
const games: string[] = [];

for (const profile of installedGames()) {
  const { source, recorded } = recording(diskFiles(profile));
  await loadAssets(source, profile);
  const maps = await listMaps(source);
  for (const map of maps) await loadMap(source, map.id, profile);
  const bytes = await write(profile.id, recorded);
  games.push(profile.id);
  console.log(`${profile.title}: ${maps.length} maps, ${recorded.files.size} files, ${megabytes(bytes)}`);
}

const disks = installedBi2Disks().map((disk) => ({ disk, ...recording(bi2Files(disk)) }));
if (disks.length > 0) {
  const game = await loadBi2Game(disks);
  for (const info of game.missions) await game.loadMission(info);
  for (const { disk, recorded } of disks) {
    const bytes = await write(disk.id, recorded);
    const missions = game.missions.filter((info) => info.disk === disk).length;
    console.log(`Battle Isle 2, ${disk.title.toLowerCase()}: ${missions} missions, ${recorded.files.size} files, ${megabytes(bytes)}`);
  }
  games.push(BI2_GAME_ID);
}

if (games.length === 0) throw new Error('no game was found; see the README for where each is looked for');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.json'), JSON.stringify(games));
console.log(`wrote ${outDir}`);

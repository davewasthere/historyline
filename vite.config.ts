import { defineConfig, type Plugin } from 'vite';
import { bi2Disk, BI2_GAME_ID } from './src/bi2/games.ts';
import { GAMES, isGameId } from './src/games.ts';
import type { FileSource } from './src/viewer/assets.ts';
import { bi2Files, diskFiles, installedBi2Disks, installedGames } from './tools/gameFiles.ts';

/** Where each game's files are read from, once it has been asked for. */
const sources = new Map<string, FileSource>();

/** The files of a game, or of one of Battle Isle 2's two disks. */
function sourceOf(game: string): FileSource | null {
  let source = sources.get(game);
  if (!source) {
    const disk = bi2Disk(game);
    if (isGameId(game)) source = diskFiles(GAMES[game]);
    else if (disk) source = bi2Files(disk);
    else return null;
    sources.set(game, source);
  }
  return source;
}

/**
 * Serves the installed games' files to the viewer during development:
 *   GET /game/                   a JSON array of the games that are installed
 *   GET /game/<game>/<path>      the file's bytes
 *   GET /game/<game>/<folder>/   a JSON array of the file names in that folder
 * <game> is one of the ids in src/games.ts, or one of Battle Isle 2's disks
 * in src/bi2/games.ts; the list has Battle Isle 2 once if either disk is
 * there. Nothing is copied into the project; files are read from the game's
 * folder, or for Battle Isle 2 from its CD image too, on each request.
 */
function gameFiles(): Plugin {
  return {
    name: 'historyline-game-files',
    configureServer(server) {
      server.middlewares.use('/game', async (request, response) => {
        try {
          if (request.method !== 'GET') {
            response.statusCode = 405;
            response.end();
            return;
          }
          const path = decodeURIComponent((request.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
          const json = (value: unknown) => {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(value));
          };
          if (path === '') {
            const ids: string[] = installedGames().map((game) => game.id);
            if (installedBi2Disks().length > 0) ids.push(BI2_GAME_ID);
            json(ids);
            return;
          }
          const slash = path.indexOf('/');
          const source = sourceOf(slash < 0 ? path : path.slice(0, slash));
          if (!source) throw new Error('no such game');
          const inside = slash < 0 ? '' : path.slice(slash + 1);
          if (inside === '' || inside.endsWith('/')) {
            json(await source.list(inside.replace(/\/+$/, '')));
            return;
          }
          const data = await source.read(inside);
          response.setHeader('Content-Type', 'application/octet-stream');
          response.end(data);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [gameFiles()],
  server: { port: 5914, strictPort: true },
  // The viewer's pages: the games, a game's maps, a battle, and Battle Isle 2's missions.
  build: { rollupOptions: { input: ['index.html', 'maps.html', 'play.html', 'bi2.html'] } },
});

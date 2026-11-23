import { readdir, readFile, stat } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import { isGameId, GAMES } from './src/games.ts';
import { gameDir, installedGames, resolveInGame } from './tools/gameFiles.ts';

/**
 * Serves the installed games' files to the viewer during development:
 *   GET /game/                   a JSON array of the games that are installed
 *   GET /game/<game>/<path>      the file's bytes
 *   GET /game/<game>/<folder>/   a JSON array of the file names in that folder
 * <game> is one of the ids in src/games.ts. Nothing is copied into the
 * project; files are read from the game's folder on each request.
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
            json(installedGames().map((profile) => profile.id));
            return;
          }
          const slash = path.indexOf('/');
          const game = slash < 0 ? path : path.slice(0, slash);
          if (!isGameId(game)) throw new Error('no such game');
          const inside = slash < 0 ? '' : path.slice(slash + 1);
          const full = resolveInGame(gameDir(GAMES[game]), inside);
          if (inside === '' || inside.endsWith('/')) {
            const entries = await readdir(full, { withFileTypes: true });
            json(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
            return;
          }
          if (!(await stat(full)).isFile()) throw new Error('not a file');
          response.setHeader('Content-Type', 'application/octet-stream');
          response.end(await readFile(full));
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
});

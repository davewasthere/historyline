import { readdir, readFile, stat } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import { gameDir, resolveInGame } from './tools/gameFiles.ts';

/**
 * Serves the installed game's files to the viewer during development:
 *   GET /game/<path>    the file's bytes
 *   GET /game/<folder>/ a JSON array of the file names in that folder
 * Nothing is copied into the project; files are read from the game folder on
 * each request.
 */
function gameFiles(): Plugin {
  const root = gameDir();
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
          const full = resolveInGame(root, path);
          if (path === '' || path.endsWith('/')) {
            const entries = await readdir(full, { withFileTypes: true });
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(entries.filter((entry) => entry.isFile()).map((entry) => entry.name)));
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

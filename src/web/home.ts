// The page the viewer opens on: the games that are installed, to pick one.
// Each is shown with a piece of one of its maps, drawn from its own files.
// Picking a game goes to its maps (maps.ts), or for Battle Isle 2, which can
// only be looked at, to its missions (bi2.ts).

import { loadBi2Game } from '../bi2/assets.ts';
import { BI2_DISKS, BI2_GAME_ID } from '../bi2/games.ts';
import { renderMission } from '../bi2/render.ts';
import { rgbaBytes, type Surface } from '../gfx/surface.ts';
import { GAMES, isGameId, type GameId } from '../games.ts';
import { listMaps, loadAssets, loadMap } from '../viewer/assets.ts';
import { renderMap } from '../viewer/render.ts';
import { filesOf, gameTitle, installedGameIds, mapsPage, playPage } from './library.ts';

// Addresses from before the viewer had pages of its own for picking: one that names a map is a
// battle's, one that names only a game is that game's maps.
const asked = new URLSearchParams(location.hash.slice(1));
if (asked.has('map')) location.replace(playPage(asked));
else if (asked.has('game')) location.replace(mapsPage(asked.get('game')!));

/** A line on what each game is. */
const ABOUT: Record<GameId | typeof BI2_GAME_ID, string> = {
  historyline: 'The First World War, from 1914 to 1918. Its own maps, new ones, and Battle Isle’s rebuilt with its units.',
  isle: 'The first game: two armies with the same machines, on the islands of Chromos.',
  desert: 'Battle Isle’s first data disk: desert, rivers, ice and snow.',
  moon: 'Battle Isle’s second data disk: the moon of Chromos, with units of its own.',
  bi2: 'Its missions can be looked through here, not played.',
};

/** The map each game is shown by, where the first is not the best look at it. */
const SHOWN_MAP: Partial<Record<string, string>> = { historyline: '12', isle: '03', desert: '08', moon: '02', bi2: '004' };

const games = document.getElementById('games')!;
const lead = document.getElementById('lead')!;
const message = document.getElementById('message')!;

interface Shown {
  /** How many maps the game has, in words. */
  count: string;
  /** One of its maps, drawn. */
  picture: Surface;
}

/** A game's count of maps and a picture of one, from its files. */
async function show(id: string): Promise<Shown> {
  if (!isGameId(id)) {
    const game = await loadBi2Game(BI2_DISKS.map((disk) => ({ disk, source: filesOf(disk.id) })));
    const info = game.missions.find((mission) => mission.id === SHOWN_MAP[id]) ?? game.missions[0]!;
    return {
      count: `${game.missions.length} missions · maps only`,
      picture: renderMission(await game.loadMission(info), game.assets, { showUnits: true }),
    };
  }
  const profile = GAMES[id];
  const source = filesOf(id);
  const [assets, maps] = await Promise.all([loadAssets(source, profile), listMaps(source)]);
  const info = maps.find((map) => map.id === SHOWN_MAP[id]) ?? maps[0]!;
  const { map } = await loadMap(source, info.id, profile);
  return {
    count: `${maps.length} maps`,
    picture: renderMap(map, assets, { season: info.season, palette: 0, showUnits: true }),
  };
}

function card(id: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'game-card';
  link.href = mapsPage(id);
  const canvas = document.createElement('canvas');
  // Until the picture is there the canvas holds its place.
  canvas.width = 16;
  canvas.height = 9;
  const text = document.createElement('div');
  text.className = 'text';
  const title = document.createElement('h2');
  title.textContent = gameTitle(id);
  const about = document.createElement('p');
  about.textContent = ABOUT[id as keyof typeof ABOUT] ?? '';
  const count = document.createElement('p');
  count.className = 'count';
  count.textContent = ' ';
  text.append(title, about, count);
  link.append(canvas, text);

  void show(id).then(
    ({ count: maps, picture }) => {
      count.textContent = maps;
      canvas.width = picture.width;
      canvas.height = picture.height;
      canvas.getContext('2d')!.putImageData(new ImageData(rgbaBytes(picture), picture.width, picture.height), 0, 0);
    },
    (error: Error) => {
      count.textContent = `Its files could not be read: ${error.message}`;
    },
  );
  return link;
}

async function start(): Promise<void> {
  const installed = await installedGameIds();
  if (installed.length === 0) {
    lead.textContent = 'No game was found.';
    message.hidden = false;
    message.textContent =
      'This viewer reads the files of an installed copy of Historyline 1914-1918, Battle Isle or Battle Isle 2. ' +
      'Start it with "npm run dev". The games are looked for in their GOG install folders; the environment ' +
      'variables HL_GAME_DIR, BI_GAME_DIR and BI2_GAME_DIR name other places.';
    return;
  }
  lead.textContent = `${installed.length} ${installed.length === 1 ? 'game is' : 'games are'} installed. Pick one to see its maps.`;
  games.replaceChildren(...installed.map(card));
}

// A page that is about to be left for another address draws nothing first.
if (!asked.has('map') && !asked.has('game')) void start();

// What the viewer's pages share: where the games' files come from, which
// games are there, and the maps a game offers to be looked at and played.
//
// A game's maps are its own, and for History Line also the new maps made from
// the sketches in maps/ and the maps of the Battle Isle games that are
// installed, rebuilt with History Line's tiles when one is opened (see
// src/maps/battleIsle.ts).

import { BI2_GAME_ID, BI2_TITLE, isBi2GameId } from '../bi2/games.ts';
import { GAMES, isGameId, type GameId } from '../games.ts';
import { REBUILT_GAMES, sketchFromBattleIsle, type RebuiltGame } from '../maps/battleIsle.ts';
import { buildMap, type MapSketch } from '../maps/sketch.ts';
import {
  listMaps,
  loadAssets,
  loadMap,
  type FileSource,
  type GameAssets,
  type LoadedMap,
  type MapInfo,
} from '../viewer/assets.ts';

/** The development server hands out each installed game's files under /game/<its id>. */
export function filesOf(game: string): FileSource {
  return {
    async read(path) {
      const response = await fetch(`/game/${game}/${path}`);
      if (!response.ok) throw new Error(`could not read ${path} (HTTP ${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async list(directory) {
      const response = await fetch(`/game/${game}/${directory}/`);
      if (!response.ok) throw new Error(`could not list ${directory} (HTTP ${response.status})`);
      return (await response.json()) as string[];
    },
  };
}

/** A game's name: one of those that are played, or Battle Isle 2, whose maps are only shown. */
export function gameTitle(id: string): string | null {
  return isGameId(id) ? GAMES[id].title : isBi2GameId(id) ? BI2_TITLE : null;
}

/** The games the server finds installed, in the order it gives them; none if it cannot say. */
export async function installedGameIds(): Promise<string[]> {
  try {
    const response = await fetch('/game/');
    const ids: unknown = response.ok ? await response.json() : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && gameTitle(id) !== null) : [];
  } catch {
    return [];
  }
}

// --- the viewer's pages --------------------------------------------------------

/** The page that lists the games. */
export const HOME_PAGE = './';

/** The page on which a game's maps are looked through and one is picked. */
export function mapsPage(game: string, mapId?: string): string {
  if (game === BI2_GAME_ID) return `bi2.html${mapId ? `#map=${mapId}` : ''}`;
  const params = new URLSearchParams({ game });
  if (mapId) params.set('map', mapId);
  return `maps.html#${params}`;
}

/** The page a battle is played on, with what the address says of it. */
export function playPage(params: URLSearchParams): string {
  return `play.html#${params}`;
}

/** The game an address names; History Line if it names none, as addresses from before other games were read do. */
export function gameInAddress(): GameId {
  const named = new URLSearchParams(location.hash.slice(1)).get('game');
  return isGameId(named) ? named : 'historyline';
}

// --- a game's maps ---------------------------------------------------------------

export interface Library {
  gameId: GameId;
  assets: GameAssets;
  /** Every map the game offers. */
  maps: MapInfo[];
  /** The maps as the list shows them: under headings, those without maps left out. */
  groups: [heading: string, maps: MapInfo[]][];
  /**
   * Loads a map. `problems` says what could not be done in making it, for a
   * map made from a sketch or rebuilt from another game's; empty otherwise.
   */
  load(id: string): Promise<{ loaded: LoadedMap; problems: string[] }>;
}

/** Loads a game's tiles and tables and lists its maps. */
export async function openLibrary(gameId: GameId): Promise<Library> {
  const profile = GAMES[gameId];
  const source = filesOf(gameId);
  const [assets, maps, installed] = await Promise.all([loadAssets(source, profile), listMaps(source), installedGameIds()]);

  // The maps that are not the game's own: first the sketches in maps/, each known by its file's
  // name. They are put together from History Line's tiles, so only that game has them.
  const sketches = new Map<string, MapSketch>(
    !profile.sketches
      ? []
      : Object.entries(import.meta.glob<MapSketch>('../../maps/*.json', { eager: true, import: 'default' })).map(
          ([file, sketch]) => [file.slice(file.lastIndexOf('/') + 1, -'.json'.length), sketch],
        ),
  );
  for (const [id, sketch] of sketches) {
    maps.push({ id, singlePlayer: false, season: sketch.season ?? 'summer', code: '', title: sketch.title, about: sketch.about });
  }
  // Then the maps of the Battle Isle games that are installed, to be rebuilt when opened.
  for (const from of profile.sketches ? REBUILT_GAMES.filter((game) => installed.includes(game)) : []) {
    try {
      for (const theirs of await listMaps(filesOf(from))) {
        maps.push({ ...theirs, id: `${from}-${theirs.id}`, season: 'summer', from: { game: from, mapId: theirs.id } });
      }
    } catch {
      // That game's maps cannot be listed: this game's are shown without them.
    }
  }

  /** The tiles and tables of the Battle Isle games whose maps were rebuilt, each loaded when first needed. */
  const rebuiltAssets = new Map<RebuiltGame, Promise<GameAssets>>();
  const sketchOfRebuilt = async (game: RebuiltGame, info: MapInfo): Promise<MapSketch> => {
    const theirSource = filesOf(game);
    let loading = rebuiltAssets.get(game);
    if (!loading) rebuiltAssets.set(game, (loading = loadAssets(theirSource, GAMES[game])));
    const mapId = info.from!.mapId;
    const [theirs, their] = await Promise.all([loading, loadMap(theirSource, mapId, GAMES[game])]);
    return sketchFromBattleIsle({
      game,
      title: `${GAMES[game].title} ${mapId}`,
      about: `Map ${mapId} (${info.code}) of ${GAMES[game].title}, rebuilt with History Line's tiles and units.`,
      map: their.map,
      shops: their.shops,
      terrainTypes: theirs.tilesets.summer.terrainTypes,
      tileNames: theirs.tilesets.summer.tileNames,
      isTransport: theirs.unitTypes.map((type) => type.isTransport),
    });
  };

  const [first, second] = profile.sides;
  const own = maps.filter((map) => !map.from);
  const single = own.filter((map) => map.singlePlayer);
  // History Line's single-player maps come as two sets of the same battlefields with different
  // starting positions: in the first the original's computer plays the French side, in the
  // second the German.
  const groups: [string, MapInfo[]][] = [
    [`Single-player, as ${first}`, single.filter((map) => profile.computerSide(map.id) === 1)],
    [`Single-player, as ${second}`, single.filter((map) => profile.computerSide(map.id) === 0)],
    ['Two-player', own.filter((map) => !map.singlePlayer && !map.title)],
    ['New maps', own.filter((map) => map.title)],
    ...REBUILT_GAMES.map((from): [string, MapInfo[]] => [
      `From ${GAMES[from].title}`,
      maps.filter((map) => map.from?.game === from),
    ]),
  ];

  return {
    gameId,
    assets,
    maps,
    groups: groups.filter(([, members]) => members.length > 0),
    async load(id) {
      const info = maps.find((map) => map.id === id);
      const from = info?.from;
      const sketch =
        sketches.get(id) ??
        (info && from && REBUILT_GAMES.includes(from.game as RebuiltGame)
          ? await sketchOfRebuilt(from.game as RebuiltGame, info)
          : undefined);
      if (!sketch) return { loaded: await loadMap(source, id, profile), problems: [] };
      const terrainTypes = assets.tilesets[sketch.season ?? 'summer'].terrainTypes;
      const built = buildMap(sketch, { unitTypes: assets.unitTypes, terrainTypes });
      return { loaded: { map: built.map, shops: built.shops, computerTable: null }, problems: built.problems };
    },
  };
}

/** What a map is called in a list: its number, or for a new map its name. */
export function mapLabel(map: MapInfo): string {
  return map.from?.mapId ?? map.title ?? map.id;
}

/** What a map is called in full. */
export function mapName(map: MapInfo): string {
  if (map.from) return `${GAMES[map.from.game].title} ${map.from.mapId}`;
  return map.title ?? `Map ${map.id}`;
}

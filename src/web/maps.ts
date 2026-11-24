// The page a map is picked on: a game's maps in a list, the one picked drawn
// beside it with what there is to know of it, and what a battle on it starts
// with: which side to play, the season, the colours. Starting goes to the
// page the battle is played on (play.ts), with the choices in the address.

import type { Side } from '../formats/map.ts';
import { createGame, incomeOf, type GameState } from '../game/state.ts';
import { rgbaBytes } from '../gfx/surface.ts';
import { GAMES, seasonsOf } from '../games.ts';
import { PALETTE_FILES, type LoadedMap, type MapInfo, type Season } from '../viewer/assets.ts';
import { mapPixelSize, renderMap } from '../viewer/render.ts';
import { autosaveKey, describeSave, readBattle, saveKey, type ComputerChoice, type SavedBattle } from './battles.ts';
import { gameInAddress, mapLabel, mapName, openLibrary, playPage, type Library } from './library.ts';

const gameId = gameInAddress();
const profile = GAMES[gameId];
const [firstSide, secondSide] = profile.sides;
const hasSeasons = seasonsOf(profile).length > 1;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const mapCanvas = element<HTMLCanvasElement>('map');
const canvasWrap = element<HTMLDivElement>('canvas-wrap');
const stage = element<HTMLElement>('stage');
const mapList = element<HTMLDivElement>('map-list');
const details = element<HTMLElement>('details');
const message = element<HTMLParagraphElement>('message');
const unitsCheckbox = element<HTMLInputElement>('show-units');

/** Who sits at the screen: one side against the computer, both sides, or nobody. */
type Player = 'first' | 'second' | 'both' | 'nobody';
/** What the computer plays for each. */
const COMPUTER_FOR: Record<Player, ComputerChoice> = { first: 'french', second: 'german', both: 'nobody', nobody: 'both' };

// What is remembered from one visit to the next, for each game: the colours last played in.
const paletteKey = `historyline.prefs.${gameId}.palette`;
function rememberedPalette(): number {
  try {
    const value = Number(localStorage.getItem(paletteKey));
    return Number.isInteger(value) && value >= 0 && value < PALETTE_FILES.length ? value : 0;
  } catch {
    return 0;
  }
}

const state = {
  mapId: new URLSearchParams(location.hash.slice(1)).get('map') ?? '',
  player: 'first' as Player,
  season: 'summer' as Season,
  palette: rememberedPalette(),
  showUnits: true,
};

let library: Library;
/** The map picked, as it is in the game's files, and a battle begun on it to count what it has. */
let loaded: LoadedMap | null = null;
let battle: GameState | null = null;
/** What could not be done in making the map, for a map that was made. */
let problems: string[] = [];

function showMessage(text: string | null): void {
  message.hidden = text === null;
  message.textContent = text ?? '';
  canvasWrap.hidden = text !== null;
}

function writeStateToUrl(): void {
  const params = new URLSearchParams({ game: gameId });
  if (state.mapId) params.set('map', state.mapId);
  history.replaceState(null, '', `#${params}`);
}

function heading(text: string): HTMLHeadingElement {
  const h2 = document.createElement('h2');
  h2.textContent = text;
  return h2;
}

function factList(facts: [string, string][]): HTMLDListElement {
  const dl = document.createElement('dl');
  for (const [term, value] of facts) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  return dl;
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

const infoOf = (id: string) => library.maps.find((map) => map.id === id);
/** The battle in progress on a map, and the one saved for it with the Save button. */
const inProgress = (id: string): SavedBattle | null => readBattle(autosaveKey(gameId, id), id);
const saved = (id: string): SavedBattle | null => readBattle(saveKey(gameId, id), id);

/** The side a single player has on a map of the game's own; null where the game does not say. */
function givenSide(info: MapInfo): Side | null {
  if (!info.singlePlayer || info.from || info.title) return null;
  return profile.computerSide(info.id) === 0 ? 1 : 0;
}

// --- the list ------------------------------------------------------------------

function renderMapList(): void {
  mapList.replaceChildren();
  for (const [title, members] of library.groups) {
    const grid = document.createElement('div');
    // The game's maps go by their numbers; the new ones by their names, which need a line each.
    grid.className = members[0]!.title && !members[0]!.from ? 'map-grid named' : 'map-grid';
    for (const map of members) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = mapLabel(map);
      const kept = inProgress(map.id) ?? saved(map.id);
      button.title =
        (map.about ?? mapName(map)) +
        (hasSeasons && !map.from ? ` (${map.season})` : '') +
        (kept ? `; a battle is ${describeSave(kept, profile.sides)}` : '');
      if (hasSeasons && map.season === 'winter') button.classList.add('winter');
      if (kept) button.classList.add('saved');
      if (map.id === state.mapId) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => void selectMap(map.id));
      // A map can be started straight from the list; a battle in progress on it is gone on with.
      button.addEventListener('dblclick', () => startBattle(false));
      grid.append(button);
    }
    mapList.append(heading(title), grid);
  }
}

// --- the map --------------------------------------------------------------------

function draw(): void {
  if (!loaded) return;
  const { map } = loaded;
  const surface = renderMap(map, library.assets, { season: state.season, palette: state.palette, showUnits: state.showUnits });
  mapCanvas.width = surface.width;
  mapCanvas.height = surface.height;
  mapCanvas.getContext('2d')!.putImageData(new ImageData(rgbaBytes(surface), surface.width, surface.height), 0, 0);
  // As large as fits beside the list without scrolling, up to three times; a large map at its own size.
  const { width, height } = mapPixelSize(map);
  const room = { width: stage.clientWidth - 32, height: stage.clientHeight - 32 };
  const scale = [3, 2.5, 2, 1.5].find((times) => width * times <= room.width && height * times <= room.height) ?? 1;
  mapCanvas.style.width = `${width * scale}px`;
  mapCanvas.style.height = `${height * scale}px`;
}

// --- what there is to know, and to choose ------------------------------------------

/** Goes to the page the battle is played on: a new one with what was chosen, or the one in progress. */
function startBattle(afresh: boolean): void {
  if (!loaded || !state.mapId) return;
  const params = new URLSearchParams({ game: gameId, map: state.mapId });
  if (afresh || !inProgress(state.mapId)) {
    if (hasSeasons) params.set('season', state.season);
    params.set('computer', COMPUTER_FOR[state.player]);
    params.set('fresh', '1');
  }
  if (state.palette !== 0) params.set('palette', String(state.palette));
  try {
    localStorage.setItem(paletteKey, String(state.palette));
  } catch {
    // No storage: the colours are not remembered.
  }
  location.href = playPage(params);
}

function radio(name: string, value: string, checked: boolean, label: string, note: string): HTMLLabelElement {
  const wrap = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  const text = document.createElement('span');
  text.textContent = label;
  const small = document.createElement('small');
  small.textContent = note;
  wrap.append(input, text, small);
  return wrap;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const made = document.createElement('button');
  made.type = 'button';
  made.textContent = label;
  made.className = className;
  made.addEventListener('click', onClick);
  return made;
}

/** The choices a battle starts with, and the buttons that start it. */
function renderStart(): HTMLElement {
  const form = document.createElement('div');
  form.className = 'start';

  const who = document.createElement('fieldset');
  who.className = 'who';
  who.append(
    radio('player', 'first', state.player === 'first', firstSide, `against the computer's ${secondSide}`),
    radio('player', 'second', state.player === 'second', secondSide, `against the computer's ${firstSide}`),
    radio('player', 'both', state.player === 'both', 'Both sides', 'two players at this screen'),
    radio('player', 'nobody', state.player === 'nobody', 'Neither', 'watch the computer play both'),
  );
  who.addEventListener('change', () => {
    state.player = (who.querySelector<HTMLInputElement>('input:checked')?.value ?? 'first') as Player;
  });
  form.append(heading('Play as'), who);

  const row = document.createElement('div');
  row.className = 'row';
  if (hasSeasons) {
    const seasons = document.createElement('fieldset');
    seasons.className = 'segmented';
    seasons.setAttribute('aria-label', 'Season');
    for (const season of seasonsOf(profile)) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'season';
      input.value = season;
      input.checked = state.season === season;
      const span = document.createElement('span');
      span.textContent = season === 'winter' ? 'Winter' : 'Summer';
      label.append(input, span);
      seasons.append(label);
    }
    seasons.addEventListener('change', () => {
      state.season = seasons.querySelector<HTMLInputElement>('input:checked')?.value === 'winter' ? 'winter' : 'summer';
      // The seasons differ in what the ground costs to cross, so the battle counted from is begun again.
      begin();
      draw();
    });
    row.append(seasons);
  }
  const colours = document.createElement('label');
  colours.className = 'select';
  colours.append('Colours ');
  const select = document.createElement('select');
  profile.palettes.forEach((name, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = name;
    select.append(option);
  });
  select.value = String(state.palette);
  select.addEventListener('change', () => {
    state.palette = Number(select.value);
    draw();
  });
  colours.append(select);
  row.append(colours);
  form.append(heading('Battle'), row);

  const go = document.createElement('div');
  go.className = 'go';
  const going = inProgress(state.mapId);
  if (going) {
    go.append(
      button('Continue the battle', 'primary', () => startBattle(false)),
      paragraph('sub', `A battle is in progress on this map: ${describeSave(going, profile.sides)}.`),
      button('Start afresh', '', () => startBattle(true)),
    );
  } else {
    go.append(button('Start battle', 'primary', () => startBattle(true)));
  }
  const kept = saved(state.mapId);
  if (kept) {
    go.append(paragraph('sub', `A battle is saved for this map (${describeSave(kept, profile.sides)}). "Load" brings it back once a battle is open.`));
  }
  form.append(go);
  return form;
}

function renderDetails(): void {
  details.replaceChildren();
  const info = infoOf(state.mapId);
  if (!loaded || !battle || !info) return;
  const { map } = loaded;
  const count = (side: Side) => battle!.units.filter((unit) => unit.side === side).length;
  const buildings = (['headquarters', 'factory', 'depot'] as const)
    .map((kind) => [kind, battle!.buildings.filter((building) => building.kind === kind).length] as const)
    .filter(([, number]) => number > 0)
    .map(([kind, number]) => `${number} ${kind === 'headquarters' || number === 1 ? kind : kind === 'factory' ? 'factories' : 'depots'}`);
  const given = givenSide(info);

  details.append(heading(mapName(info)));
  if (info.about) details.append(paragraph('about', info.about));
  details.append(
    factList([
      ...(info.code ? ([['Code', info.code]] as [string, string][]) : []),
      [
        'In the game',
        info.from
          ? `not one of its maps: ${GAMES[info.from.game].title}'s, rebuilt`
          : info.title
            ? 'not one of its maps: a new one'
            : given !== null
              ? `one player, as the ${profile.sides[given]} side`
              : 'two players',
      ],
      ...(hasSeasons && !info.from ? ([['Season', info.season]] as [string, string][]) : []),
      ['Size', `${map.columns} × ${map.rows} fields`],
      [`${firstSide}`, `${count(0)} units, earning ${incomeOf(battle, 0)} a round`],
      [`${secondSide}`, `${count(1)} units, earning ${incomeOf(battle, 1)} a round`],
      ['Buildings', buildings.join(', ') || 'none'],
      ['Factories build', `${battle.buildable.length} of ${library.assets.unitTypes.length} unit kinds`],
    ]),
  );
  if (problems.length > 0) {
    details.append(
      paragraph(
        'sub',
        info.from
          ? `History Line's tiles cannot follow this map in ${problems.length} place(s), mostly along the coast.`
          : `This map's sketch has ${problems.length} problem(s): ${problems.slice(0, 2).join('; ')}.`,
      ),
    );
  }
  details.append(renderStart());
}

/** Begins a battle on the map picked, to count its units and buildings from. Nothing is played here. */
function begin(): void {
  if (!loaded) return;
  const terrain = library.assets.tilesets[state.season].terrainTypes;
  battle = createGame(loaded.map, library.assets.unitTypes, terrain, loaded.shops, library.assets.rules);
}

async function selectMap(id: string): Promise<void> {
  state.mapId = id;
  writeStateToUrl();
  renderMapList();
  const info = infoOf(id);
  try {
    const next = await library.load(id);
    // Another map may have been picked while this one was loading.
    if (state.mapId !== id) return;
    loaded = next.loaded;
    problems = next.problems;
  } catch (error) {
    loaded = null;
    battle = null;
    showMessage(`Map ${id} could not be loaded: ${(error as Error).message}`);
    renderDetails();
    return;
  }
  // A map starts as the game has it: in its season, and for one player as the side the game gives them.
  if (info) {
    state.season = hasSeasons ? info.season : 'summer';
    const given = givenSide(info);
    state.player = given === 1 ? 'second' : given === 0 || info.from || info.title ? 'first' : 'both';
  }
  begin();
  showMessage(null);
  draw();
  renderDetails();
  document.title = `${info ? mapName(info) : `Map ${id}`} · ${profile.title}`;
}

unitsCheckbox.addEventListener('change', () => {
  state.showUnits = unitsCheckbox.checked;
  draw();
});
window.addEventListener('resize', draw);
// Enter starts the map picked, wherever in the list the keys have moved to.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLSelectElement)) {
    startBattle(false);
  }
});

async function start(): Promise<void> {
  element<HTMLHeadingElement>('game-title').textContent = profile.title;
  document.title = `${profile.title} · maps`;
  try {
    library = await openLibrary(gameId);
  } catch (error) {
    showMessage(
      `The game's files could not be read (${(error as Error).message}). ` +
        'Start the viewer with "npm run dev", and set the HL_GAME_DIR environment variable (BI_GAME_DIR ' +
        'for Battle Isle) if the game is not installed in the default GOG folder.',
    );
    return;
  }
  // The map the address names, or the one the list begins with.
  const first = infoOf(state.mapId) ?? library.groups[0]?.[1][0] ?? library.maps[0];
  if (!first) {
    showMessage('The game folder has no maps in MAP.');
    return;
  }
  await selectMap(first.id);
}

void start();

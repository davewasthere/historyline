// The viewer's page for Battle Isle 2: it shows a mission's map and what is
// on it. Battle Isle 2 cannot be played here; see src/bi2/games.ts.

import { loadBi2Game, type Bi2Assets, type Bi2Game, type MissionInfo } from '../bi2/assets.ts';
import { NOTHING, splitUnit, waysOf, WAYS, WEATHERS, type Mission } from '../bi2/formats.ts';
import { BI2_DISKS, BI2_TITLE } from '../bi2/games.ts';
import { renderMission } from '../bi2/render.ts';
import type { Field } from '../game/movement.ts';
import { rgbaBytes } from '../gfx/surface.ts';
import type { FileSource } from '../viewer/assets.ts';
import { fieldAt, fieldOrigin, hexMask, TILE_SIZE } from '../viewer/render.ts';

const params = new URLSearchParams(location.hash.slice(1));

/** The development server hands out the files of each of the game's disks under /game/<the disk's id>. */
function diskFiles(disk: string): FileSource {
  return {
    async read(path) {
      const response = await fetch(`/game/${disk}/${path}`);
      if (!response.ok) throw new Error(`could not read ${path} (HTTP ${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async list(directory) {
      const response = await fetch(`/game/${disk}/${directory}/`);
      if (!response.ok) throw new Error(`could not list ${directory} (HTTP ${response.status})`);
      return (await response.json()) as string[];
    },
  };
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const mapCanvas = element<HTMLCanvasElement>('map');
const overlayCanvas = element<HTMLCanvasElement>('overlay');
const canvasWrap = element<HTMLDivElement>('canvas-wrap');
const mapList = element<HTMLDivElement>('map-list');
const details = element<HTMLElement>('details');
const fieldInfo = element<HTMLOutputElement>('field-info');
const message = element<HTMLParagraphElement>('message');
const zoomSelect = element<HTMLSelectElement>('zoom');
const weatherSelect = element<HTMLSelectElement>('weather');
const unitsCheckbox = element<HTMLInputElement>('show-units');

const FIELD_INFO_IDLE = fieldInfo.textContent;

const zoomNamed = Number(params.get('zoom'));
const weatherNamed = Number(params.get('ground'));
const state = {
  missionId: params.get('map') ?? '',
  showUnits: params.get('units') !== '0',
  zoom: Number.isInteger(zoomNamed) && zoomNamed >= 1 && zoomNamed <= 4 ? zoomNamed : 2,
  /** Which of each part's pictures the ground is drawn with. */
  weather: Number.isInteger(weatherNamed) && weatherNamed >= 0 && weatherNamed < WEATHERS ? weatherNamed : 0,
};

let game: Bi2Game;
let assets: Bi2Assets;
let missions: MissionInfo[] = [];
let mission: Mission | null = null;
/** 1 for the pixels of a tile that lie inside its field. */
let mask: Uint8Array = new Uint8Array(TILE_SIZE * TILE_SIZE);
let hovered: Field | null = null;
let pinned: Field | null = null;

/** The view is kept in the URL's hash so a reload or a shared link shows the same thing. */
function writeStateToUrl(): void {
  const next = new URLSearchParams({ map: state.missionId, zoom: String(state.zoom) });
  if (!state.showUnits) next.set('units', '0');
  if (state.weather !== 0) next.set('ground', String(state.weather));
  history.replaceState(null, '', `#${next}`);
}

function showMessage(text: string | null): void {
  message.hidden = text === null;
  message.textContent = text ?? '';
  canvasWrap.hidden = text !== null;
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

const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(3, '0')}`;

/** What a part is, as far as its kinds are known: the ways it has. */
function describePart(part: number): string {
  if (part === NOTHING) return 'nothing';
  const ways = waysOf(assets.partTable[part]).map((way) => WAYS[way]);
  return `part ${hex(part)}${ways.length > 0 ? ` (${ways.join(', ')})` : ''}`;
}

function describeUnit(code: number): string {
  const { type, player } = splitUnit(code);
  return `${assets.unitNames[type] ?? `unit kind ${type}`}, player ${player + 1}`;
}

function describeField(field: Field): string {
  if (!mission) return '';
  const at = field.row * mission.columns + field.column;
  const unit = mission.units[at]!;
  return (
    `Field ${field.column}, ${field.row} · ground ${describePart(mission.ground[at]!)} · on it ${describePart(mission.objects[at]!)}` +
    (unit !== NOTHING ? ` · ${describeUnit(unit)}` : '')
  );
}

function draw(): void {
  if (!mission) return;
  const surface = renderMission(mission, assets, { showUnits: state.showUnits, weather: state.weather });
  for (const canvas of [mapCanvas, overlayCanvas]) {
    canvas.width = surface.width;
    canvas.height = surface.height;
    canvas.style.width = `${surface.width * state.zoom}px`;
    canvas.style.height = `${surface.height * state.zoom}px`;
  }
  mapCanvas.getContext('2d')!.putImageData(new ImageData(rgbaBytes(surface), surface.width, surface.height), 0, 0);
  drawOverlay();
}

/** A field's shape in one colour, to lay over the map. */
function makeStamp(red: number, green: number, blue: number, alpha: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const image = new ImageData(TILE_SIZE, TILE_SIZE);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) image.data.set([red, green, blue, alpha], i * 4);
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
}

let stamps: { hover: HTMLCanvasElement; pinned: HTMLCanvasElement };

function drawOverlay(): void {
  const context = overlayCanvas.getContext('2d')!;
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const stampOn = (stamp: HTMLCanvasElement, field: Field) => {
    const { x, y } = fieldOrigin(field.column, field.row);
    context.drawImage(stamp, x, y);
  };
  if (pinned) stampOn(stamps.pinned, pinned);
  if (hovered) stampOn(stamps.hover, hovered);
}

function renderMapList(): void {
  // One list for the whole game, by mission number: the add-on's missions stand among the game's own.
  const grid = document.createElement('div');
  grid.className = 'map-grid named';
  for (const info of missions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = info.title ? `${info.id} ${info.title}` : info.id;
    button.title = [info.about, info.password && `password ${info.password}`, `from ${info.disk.title.toLowerCase()}`]
      .filter(Boolean)
      .join('; ');
    if (info.id === state.missionId) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => void selectMission(info.id));
    grid.append(button);
  }
  mapList.replaceChildren(heading(`Missions (${missions.length})`), grid);
}

function renderDetails(): void {
  details.replaceChildren();
  if (!mission) return;
  const info = missions.find((entry) => entry.id === state.missionId);
  // The units on the map, by player and then by kind.
  const players = new Map<number, Map<number, number>>();
  for (const code of mission.units) {
    if (code === NOTHING) continue;
    const { type, player } = splitUnit(code);
    const kinds = players.get(player) ?? new Map<number, number>();
    kinds.set(type, (kinds.get(type) ?? 0) + 1);
    players.set(player, kinds);
  }
  if (pinned) {
    const at = pinned.row * mission.columns + pinned.column;
    const unit = mission.units[at]!;
    details.append(
      heading(`Field ${pinned.column}, ${pinned.row}`),
      factList([
        ['Ground', describePart(mission.ground[at]!)],
        ['On it', describePart(mission.objects[at]!)],
        ['Unit', unit === NOTHING ? 'none' : describeUnit(unit)],
      ]),
    );
  }
  details.append(
    heading('Mission'),
    factList([
      ['Mission', state.missionId],
      ['Name', info?.title || 'none given'],
      ['Task', info?.about || 'none given'],
      ['Password', info?.password || 'none'],
      ['From', info ? info.disk.title.toLowerCase() : 'unknown'],
      ['Size', `${mission.columns} × ${mission.rows} fields`],
    ]),
  );
  for (const player of [...players.keys()].sort((a, b) => a - b)) {
    const kinds = [...players.get(player)!].sort((a, b) => a[0] - b[0]);
    const total = kinds.reduce((sum, [, count]) => sum + count, 0);
    details.append(
      heading(`Player ${player + 1}: ${total} units on the map`),
      factList(kinds.map(([type, count]) => [assets.unitNames[type] ?? `unit kind ${type}`, String(count)])),
    );
  }
  const note = document.createElement('p');
  note.className = 'sub';
  note.textContent =
    'Battle Isle 2 can be looked at here, not played. Every unit is drawn facing up the map, and which player ' +
    'has which colours is a guess; buildings are drawn without their owners, and what is inside them is not read.';
  details.append(note);
}

async function selectMission(id: string): Promise<void> {
  state.missionId = id;
  writeStateToUrl();
  renderMapList();
  try {
    const info = missions.find((entry) => entry.id === id);
    if (!info) throw new Error('the game has no such mission');
    const next = await game.loadMission(info);
    // Another mission may have been picked while this one was loading.
    if (state.missionId !== id) return;
    mission = next;
  } catch (error) {
    mission = null;
    showMessage(`Mission ${id} could not be loaded: ${(error as Error).message}`);
    renderDetails();
    return;
  }
  hovered = pinned = null;
  showMessage(null);
  draw();
  renderDetails();
}

function fieldUnderPointer(event: MouseEvent): Field | null {
  if (!mission) return null;
  const bounds = mapCanvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * mapCanvas.width);
  const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * mapCanvas.height);
  return fieldAt(x, y, mission, mask);
}

const sameField = (a: Field | null, b: Field | null) => a?.column === b?.column && a?.row === b?.row;

mapCanvas.addEventListener('mousemove', (event) => {
  const field = fieldUnderPointer(event);
  if (sameField(field, hovered)) return;
  hovered = field;
  fieldInfo.textContent = field ? describeField(field) : pinned ? describeField(pinned) : FIELD_INFO_IDLE;
  drawOverlay();
});
mapCanvas.addEventListener('mouseleave', () => {
  hovered = null;
  fieldInfo.textContent = pinned ? describeField(pinned) : FIELD_INFO_IDLE;
  drawOverlay();
});
mapCanvas.addEventListener('click', (event) => {
  const field = fieldUnderPointer(event);
  pinned = sameField(field, pinned) ? null : field;
  drawOverlay();
  renderDetails();
});

for (const control of [unitsCheckbox, zoomSelect, weatherSelect]) {
  control.addEventListener('change', () => {
    state.showUnits = unitsCheckbox.checked;
    state.zoom = Number(zoomSelect.value);
    state.weather = Number(weatherSelect.value);
    writeStateToUrl();
    draw();
  });
}

async function start(): Promise<void> {
  document.title = `${BI2_TITLE} map viewer`;
  unitsCheckbox.checked = state.showUnits;
  zoomSelect.value = String(state.zoom);
  weatherSelect.value = String(state.weather);
  try {
    game = await loadBi2Game(BI2_DISKS.map((disk) => ({ disk, source: diskFiles(disk.id) })));
    ({ assets, missions } = game);
  } catch (error) {
    showMessage(
      `The game's files could not be read (${(error as Error).message}). ` +
        'Start the viewer with "npm run dev", and set the BI2_GAME_DIR environment variable ' +
        'if Battle Isle 2 is not installed in the default GOG folder.',
    );
    return;
  }
  // A ground part fills its field and leaves the tile's corners undrawn; the first parts are not ground.
  const middle = (TILE_SIZE / 2) * (TILE_SIZE + 1);
  const ground = assets.parts.find((part) => part.pixels[0] === part.transparent && part.pixels[middle] !== part.transparent);
  if (ground) mask = hexMask(ground);
  stamps = { hover: makeStamp(255, 255, 255, 90), pinned: makeStamp(255, 214, 64, 140) };
  const first = missions.find((entry) => entry.id === state.missionId) ?? missions[0];
  if (!first) {
    showMessage('The game has no missions in MIS.');
    return;
  }
  await selectMission(first.id);
}

void start();

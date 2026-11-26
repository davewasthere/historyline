// The page a battle is played on. The map and who plays it come with the
// address, from the page on which maps are picked (maps.ts). It shows the
// map, lets fields, units and buildings be inspected, and the battle be
// played turn by turn: move units, load and unload them, take
// buildings, order attacks, build and repair units, and have construction
// units build depots. A click on a building or a loaded transport opens a
// dialog that shows what is inside. A battle can be saved, one for each map,
// and loaded again; saves are kept in the browser, and so is the battle in
// progress on each map, which is taken up again when the map is opened. The
// computer can play
// either side or both: it plays its part when a half begins, and what it has
// ordered is not shown to the player it plays against. When a turn ends its
// attacks are shown on the map one after another, and stay until the next
// click.

import type { Side } from '../formats/map.ts';
import { canEnter, terrainClassName, terrainMaskNames } from '../formats/terrain.ts';
import type { UnitType, Weapon } from '../formats/unitTypes.ts';
import { ATTACKS_INDIRECTLY, ATTACKS_NEVER_BACK, MAX_EXPERIENCE } from '../game/combat.ts';
import { computerPlay, type ComputerTurn } from '../game/computer.ts';
import type { Field } from '../game/movement.ts';
import { restoreGame, saveGame } from '../game/save.ts';
import {
  attackerSide,
  attackTargets,
  buildChoices,
  buildingAt,
  buildUnit,
  cancelAttack,
  cancelWork,
  cannotAttackReason,
  cannotBuildReason,
  cannotMoveReason,
  cannotRepairReason,
  cannotStopReason,
  cannotWorkReason,
  contentsOf,
  createGame,
  endHalf,
  fieldOf,
  fieldsOf,
  incomeOf,
  isBuilding,
  moveUnit,
  orderAttack,
  orderOf,
  orderWork,
  PLACES,
  rangeOf,
  repairCost,
  repairUnit,
  START_FACING,
  unitAt,
  workOf,
  workPlaces,
  type Building,
  type CaptureReport,
  type FightReport,
  type GameState,
  type HalfReport,
  type Holder,
  type Unit,
  type WorkReport,
} from '../game/state.ts';
import { rgbaBytes } from '../gfx/surface.ts';
import { GAMES, seasonsOf } from '../games.ts';
import {
  computerTableFor,
  PALETTE_FILES,
  type GameAssets,
  type LoadedMap,
  type MapInfo,
  type Season,
} from '../viewer/assets.ts';
import { fieldAt, fieldOrigin, hexMask, renderMap, renderUnit, TILE_SIZE } from '../viewer/render.ts';
import {
  autosaveKey as autosaveKeyOf,
  COMPUTER_CHOICES,
  computerPlaysSide,
  describeSave as describeSaveOf,
  forgetBattle,
  readBattle,
  saveKey as saveKeyOf,
  type ComputerChoice,
  type SavedBattle,
} from './battles.ts';
import { gameInAddress, mapName, mapsPage, openLibrary, type Library } from './library.ts';

/** The game the battle is of: the one the address names, else History Line. */
const gameId = gameInAddress();
const profile = GAMES[gameId];
/** What the two sides are called in this game, and what belongs to neither. */
const OWNERS = [...profile.sides, 'neutral'] as const;
const hasSeasons = seasonsOf(profile).length > 1;


function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const mapCanvas = element<HTMLCanvasElement>('map');
const overlayCanvas = element<HTMLCanvasElement>('overlay');
const canvasWrap = element<HTMLDivElement>('canvas-wrap');
const backLink = element<HTMLAnchorElement>('back');
const battleTitle = element<HTMLHeadingElement>('battle-title');
const details = element<HTMLElement>('details');
const fieldInfo = element<HTMLOutputElement>('field-info');
const message = element<HTMLParagraphElement>('message');
const zoomSelect = element<HTMLSelectElement>('zoom');
const unitsCheckbox = element<HTMLInputElement>('show-units');
const turnStatus = element<HTMLSpanElement>('turn-status');
const endTurnButton = element<HTMLButtonElement>('end-turn');
const restartButton = element<HTMLButtonElement>('restart');
const saveButton = element<HTMLButtonElement>('save');
const loadButton = element<HTMLButtonElement>('load');
const insideDialog = element<HTMLDialogElement>('inside');
const insideBody = element<HTMLDivElement>('inside-body');

const FIELD_INFO_IDLE = fieldInfo.textContent;

interface ViewState {
  mapId: string;
  computer: ComputerChoice;
  season: Season;
  /** Index into the game's palette files. */
  palette: number;
  showUnits: boolean;
  zoom: number;
}

/** What could not be done in making the map last opened, in words; empty for a sound one and for the game's own maps. */
let sketchProblems: string[] = [];

/** The game's maps, and its tiles and tables. */
let library: Library;
let assets: GameAssets;
let maps: MapInfo[] = [];
/** The map as it is in the game's files. */
let loaded: LoadedMap | null = null;
/** The game being played on it. */
let game: GameState | null = null;
/** The map `game` is played on; while another map is being loaded it is not yet the one picked. */
let gameMapId = '';
/** Which pixels of a tile belong to its hexagon. */
let mask: Uint8Array;
/** Hexagon-shaped stamps for marking fields on the overlay. */
let stamps: {
  hover: HTMLCanvasElement;
  selected: HTMLCanvasElement;
  closed: HTMLCanvasElement;
  outOfReach: HTMLCanvasElement;
  target: HTMLCanvasElement;
  work: HTMLCanvasElement;
};
/** What happened when the last turn ended: the attacks carried out, the buildings taken, the side paid. */
let lastReport: HalfReport | null = null;
/** The field under the pointer, and the field picked with a click. */
let hovered: Field | null = null;
let selected: Field | null = null;
/** A unit inside the transport or building on the selected field, picked to move out. */
let leaving: Unit | null = null;
/** The transport or building the dialog shows, while it is open. */
let inside: Holder | null = null;
/** The kind picked in the dialog's list of what a factory can build: the one whose details it shows. */
let picked: number | null = null;
/** A message that replaces the field description until the pointer moves on. */
let notice: string | null = null;
/** For each side, the half ("round:mover") in which the computer last played it, so that it plays a half once. */
let played: [string | null, string | null] = [null, null];
/** What the computer did when this half began. */
let computerTurns: ComputerTurn[] = [];

/** One attack of the turn that has just ended, as the map shows it. */
interface FightMark {
  /** Where the attacker stood, and the field it aimed at. */
  from: Field;
  to: Field;
  attackerLosses: number;
  targetLosses: number;
  attackerGone: boolean;
  targetGone: boolean;
  /** True if nothing it could attack stood on the field any more. */
  missed: boolean;
}
/** The attacks of the turn that has just ended, in the order they were carried out. */
let fightMarks: FightMark[] = [];
/** How many of them the map shows; they come up one after another. */
let fightsShown = 0;
/** Set while more of them are still to come up. */
let fightTimer: number | undefined;
/** The longest the attacks of one turn take to come up, and the bounds of the time one takes, in milliseconds. */
const FIGHTS_PLAY_TIME = 4000;
const FIGHT_STEP_SHORTEST = 120;
const FIGHT_STEP_LONGEST = 500;
const state: ViewState = readStateFromUrl();

/** The view is kept in the URL's hash so a reload or a shared link shows the same thing. */
function readStateFromUrl(): ViewState {
  const params = new URLSearchParams(location.hash.slice(1));
  const zoom = Number(params.get('zoom'));
  const palette = Number(params.get('palette'));
  const computer = params.get('computer') as ComputerChoice;
  return {
    mapId: params.get('map') ?? '',
    computer: COMPUTER_CHOICES.includes(computer) ? computer : 'nobody',
    season: hasSeasons && params.get('season') === 'winter' ? 'winter' : 'summer',
    palette: Number.isInteger(palette) && palette >= 0 && palette < PALETTE_FILES.length ? palette : 0,
    showUnits: params.get('units') !== '0',
    zoom: Number.isInteger(zoom) && zoom >= 1 && zoom <= 4 ? zoom : 2,
  };
}

function writeStateToUrl(): void {
  const params = new URLSearchParams();
  // History Line, the game this viewer began with, needs no naming.
  if (gameId !== 'historyline') params.set('game', gameId);
  params.set('map', state.mapId);
  if (hasSeasons) params.set('season', state.season);
  params.set('zoom', String(state.zoom));
  if (state.palette !== 0) params.set('palette', String(state.palette));
  if (!state.showUnits) params.set('units', '0');
  if (state.computer !== 'nobody') params.set('computer', state.computer);
  history.replaceState(null, '', `#${params}`);
  // The way back to the list of maps leads to this one.
  backLink.href = mapsPage(gameId, state.mapId);
}

function showMessage(text: string | null): void {
  message.hidden = text === null;
  message.textContent = text ?? '';
  canvasWrap.hidden = text !== null;
}

function unitName(type: number): string {
  return assets.unitTypes[type]?.name ?? `unit type ${type}`;
}

/** The side's name in this game, or "neutral" for what belongs to neither side. */
function sideName(side: Side | null): string {
  return side === null ? 'neutral' : OWNERS[side];
}

function describeUnit(unit: Unit): string {
  return `${sideName(unit.side)} ${unitName(unit.type)}`;
}

function describeBuilding(building: Building): string {
  return `${sideName(building.owner)} ${building.kind}`;
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function terrainAt(field: Field): number {
  return game!.map.terrain[field.row * game!.map.columns + field.column]!;
}

function currentTerrainTypes() {
  return assets.tilesets[state.season].terrainTypes;
}

const sameField = (a: Field | null, b: Field | null) => a?.column === b?.column && a?.row === b?.row;

/** The unit on the selected field, when units are shown. */
function selectedUnit(): Unit | null {
  return game && selected && state.showUnits ? unitAt(game, selected) : null;
}

/** The unit a click on the map gives orders to: the one picked to move out, else the selected one. */
function activeUnit(): Unit | null {
  return leaving ?? selectedUnit();
}

/** The transport or building on the selected field, when units are shown. */
function selectedHolder(): Holder | null {
  if (!game || !selected || !state.showUnits) return null;
  const unit = unitAt(game, selected);
  if (unit && assets.unitTypes[unit.type]?.isTransport) return unit;
  // A unit standing on an entrance, about to take the building, does not hide it.
  return buildingAt(game, selected);
}

/** Forgets everything that was picked or reported in the game before. */
function clearPicks(): void {
  hovered = null;
  selected = null;
  leaving = null;
  notice = null;
  lastReport = null;
  hideFights();
  fightMarks = [];
}

// --- the last turn's attacks on the map --------------------------------------

/** Notes where each attack of a turn took place. Called before anything moves again. */
function markFights(fights: FightReport[]): void {
  fightMarks = fights.map((fight) => ({
    from: { column: fight.attacker.column, row: fight.attacker.row },
    to: fight.targetField,
    attackerLosses: fight.attackerLosses,
    targetLosses: fight.targetLosses,
    attackerGone: fight.attackerLeft <= 0,
    targetGone: fight.target !== null && fight.targetLeft <= 0,
    missed: fight.target === null,
  }));
}

/** Brings the attacks up on the map one after another, the first at once. */
function playFights(): void {
  window.clearTimeout(fightTimer);
  fightTimer = undefined;
  fightsShown = 0;
  if (fightMarks.length === 0) return;
  const step = Math.max(FIGHT_STEP_SHORTEST, Math.min(FIGHT_STEP_LONGEST, FIGHTS_PLAY_TIME / fightMarks.length));
  const next = () => {
    fightsShown++;
    fightTimer = fightsShown < fightMarks.length ? window.setTimeout(next, step) : undefined;
    drawOverlay();
  };
  next();
}

/** Takes the attacks off the map; they can be played again from the side panel. */
function hideFights(): void {
  window.clearTimeout(fightTimer);
  fightTimer = undefined;
  if (fightsShown === 0) return;
  fightsShown = 0;
  drawOverlay();
}

/** Draws the attacks that have come up: a line for each, what each unit lost, and a cross on those destroyed. */
function drawFights(context: CanvasRenderingContext2D, stampOn: (stamp: HTMLCanvasElement, field: Field) => void): void {
  const shown = fightMarks.slice(0, fightsShown);
  if (shown.length === 0) return;
  // While they are still coming up, the newest stands out.
  const newest = fightTimer !== undefined ? shown[shown.length - 1] : undefined;
  if (newest) {
    stampOn(stamps.selected, newest.from);
    stampOn(stamps.target, newest.to);
  }
  for (const mark of shown) {
    const [a, b] = [fieldCentre(mark.from), fieldCentre(mark.to)];
    // White, to tell them from the red lines of orders not yet carried out and the yellow ones of moves.
    context.strokeStyle = mark.missed ? '#b8b8b8' : '#ffffff';
    const width = mark === newest ? 2 : 1;
    const colour = context.strokeStyle;
    // A dark edge first, so the line shows on light ground too.
    for (const [style, lineWidth] of [['rgba(0, 0, 0, 0.6)', width + 2], [colour, width]] as const) {
      context.strokeStyle = style;
      context.lineWidth = lineWidth;
      context.setLineDash(mark.missed && style === colour ? [2, 2] : []);
      context.beginPath();
      context.moveTo(a.x + 0.5, a.y + 0.5);
      context.lineTo(b.x + 0.5, b.y + 0.5);
      context.stroke();
    }
  }
  context.setLineDash([]);
  context.lineWidth = 1;

  // What was lost on each field, over all the attacks shown, and whether the unit there is gone.
  const fields = new Map<string, { field: Field; lost: number; gone: boolean; hit: boolean }>();
  const note = (field: Field, lost: number, gone: boolean, hit: boolean) => {
    const key = `${field.column},${field.row}`;
    const before = fields.get(key);
    fields.set(key, { field, lost: (before?.lost ?? 0) + lost, gone: gone || (before?.gone ?? false), hit: hit || (before?.hit ?? false) });
  };
  for (const mark of shown) {
    note(mark.from, mark.attackerLosses, mark.attackerGone, false);
    if (!mark.missed) note(mark.to, mark.targetLosses, mark.targetGone, true);
  }
  context.font = '8px sans-serif';
  context.textBaseline = 'top';
  for (const { field, lost, gone, hit } of fields.values()) {
    const { x, y } = fieldOrigin(field.column, field.row);
    if (gone) {
      context.strokeStyle = '#ff3020';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x + 6, y + 6);
      context.lineTo(x + 18, y + 18);
      context.moveTo(x + 18, y + 6);
      context.lineTo(x + 6, y + 18);
      context.stroke();
      context.lineWidth = 1;
    }
    // An attacker that lost nothing gets no number; a target that lost nothing gets a 0.
    if (lost === 0 && !hit) continue;
    const text = lost === 0 ? '0' : `-${lost}`;
    const width = Math.ceil(context.measureText(text).width) + 2;
    context.fillStyle = lost === 0 ? '#404040' : '#b02a2a';
    context.fillRect(x + 22 - width, y + 10, width, 9);
    context.fillStyle = '#ffffff';
    context.fillText(text, x + 23 - width, y + 11);
  }
}

/** Starts the loaded map's game afresh. */
function startGame(): void {
  if (!loaded) return;
  game = createGame(loaded.map, assets.unitTypes, currentTerrainTypes(), loaded.shops, assets.rules);
  gameMapId = state.mapId;
  clearPicks();
  played = [null, null];
  computerTurns = [];
  runComputer();
}

// --- the computer's player ---------------------------------------------------

function computerPlays(side: Side | null): boolean {
  return side !== null && computerPlaysSide(state.computer, side);
}

/** Whether a side's orders are drawn: the computer's are kept from the player it plays against. */
function showsOrdersOf(side: Side | null): boolean {
  return !computerPlays(side) || state.computer === 'both';
}

/**
 * Has the computer play its part of the half the game is in, if it has not
 * yet. The side that attacks goes first, so that its orders are given before
 * the other side's units move, as a player's are who cannot see them move.
 */
function runComputer(): void {
  if (!game || !loaded || game.winner !== null) return;
  const half = `${game.round}:${game.mover}`;
  for (const side of [attackerSide(game), game.mover]) {
    if (!computerPlays(side) || played[side] === half) continue;
    played[side] = half;
    computerTurns.push(computerPlay(game, side, { table: computerTableFor(assets, loaded, state.mapId, side) }));
  }
}

/** What the computer did when this half began, in a few words; empty if it did nothing worth telling. */
function describeComputerTurn(turn: ComputerTurn): string {
  const parts: string[] = [];
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
  if (turn.moves.length) parts.push(`moved ${count(turn.moves.length, 'unit')}`);
  if (turn.attacks.length && showsOrdersOf(turn.side)) parts.push(`ordered ${count(turn.attacks.length, 'attack')}`);
  if (turn.repaired.length) parts.push(`repaired ${count(turn.repaired.length, 'unit')}`);
  if (turn.built.length) parts.push(`built ${turn.built.map((unit) => unitName(unit.type)).join(', ')}`);
  return parts.join(', ');
}

// --- saved battles -----------------------------------------------------------

// How battles are kept is in battles.ts; these are this game's names for them.
const saveKey = (mapId: string) => saveKeyOf(gameId, mapId);
const autosaveKey = (mapId: string) => autosaveKeyOf(gameId, mapId);

/** The battle saved for a map with the Save button. */
function savedBattle(mapId: string): SavedBattle | null {
  return readBattle(saveKey(mapId), mapId);
}

/** The battle as it stands, to be kept. */
function battleNow(current: GameState): SavedBattle {
  return {
    mapId: gameMapId,
    computer: state.computer,
    played,
    season: state.season,
    savedAt: new Date().toISOString(),
    game: saveGame(current),
  };
}

/** Whether nothing has been done in a battle yet. */
function untouched(current: GameState): boolean {
  if (current.round !== 1 || current.mover !== 0 || current.orders.length + current.works.length > 0) return false;
  return !current.units.some((unit) => unit.moved);
}

/**
 * Keeps the battle in progress, so that a reload or a look at another map
 * does not lose it. A battle nothing has happened in, or one that is over,
 * is not kept: its map then starts afresh.
 */
function autosave(): void {
  if (!game || gameMapId !== state.mapId) return;
  try {
    if (game.winner !== null || untouched(game)) localStorage.removeItem(autosaveKey(gameMapId));
    else localStorage.setItem(autosaveKey(gameMapId), JSON.stringify(battleNow(game)));
  } catch {
    // No storage, or no room in it: the Save button says so when it is used.
  }
}

/** Puts a kept battle in the place of the game. Returns what is wrong with it, or null if it is now being played. */
function takeUp(battle: SavedBattle): string | null {
  try {
    const season: Season = hasSeasons && battle.season === 'winter' ? 'winter' : 'summer';
    game = restoreGame(battle.game, assets.unitTypes, assets.tilesets[season].terrainTypes, assets.rules);
    state.season = season;
  } catch (error) {
    return (error as Error).message;
  }
  gameMapId = state.mapId;
  closeInside();
  clearPicks();
  if (battle.computer && COMPUTER_CHOICES.includes(battle.computer)) state.computer = battle.computer;
  played = battle.played ?? [null, null];
  computerTurns = [];
  runComputer();
  syncControls();
  writeStateToUrl();
  return null;
}

function describeSave(battle: SavedBattle): string {
  return describeSaveOf(battle, OWNERS);
}

function saveBattle(): void {
  if (!game || gameMapId !== state.mapId) return;
  try {
    localStorage.setItem(saveKey(state.mapId), JSON.stringify(battleNow(game)));
    notice = `Battle on map ${state.mapId} saved in this browser. Load brings it back.`;
  } catch (error) {
    notice = `The battle could not be saved: ${(error as Error).message}`;
  }
  refresh();
}

function loadBattle(): void {
  const battle = savedBattle(state.mapId);
  if (!battle || !loaded) return;
  const problem = takeUp(battle);
  notice = problem
    ? `The saved battle could not be loaded: ${problem}.`
    : `Battle loaded: ${describeSave(battle)}.`;
  refresh();
}

// --- drawing ---------------------------------------------------------------

function draw(): void {
  if (!game) return;
  const { map } = game;
  const facings = new Uint8Array(map.units.length);
  for (const unit of game.units) {
    if (unit.destroyed || unit.inside) continue;
    // Both halves of a ship that fills two fields face the same way.
    for (const field of fieldsOf(unit)) facings[field.row * map.columns + field.column] = unit.facing;
  }
  const surface = renderMap(map, assets, {
    season: state.season,
    palette: state.palette,
    showUnits: state.showUnits,
    facings,
  });
  for (const canvas of [mapCanvas, overlayCanvas]) {
    canvas.width = surface.width;
    canvas.height = surface.height;
    canvas.style.width = `${surface.width * state.zoom}px`;
    canvas.style.height = `${surface.height * state.zoom}px`;
  }
  mapCanvas.getContext('2d')!.putImageData(new ImageData(rgbaBytes(surface), surface.width, surface.height), 0, 0);
  drawOverlay();
}

/** A hexagon in one translucent colour, the size of a tile. */
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

interface Reach {
  /** For every field: 1 if the unit could end a move there, else 0. */
  stops: Uint8Array;
  /** How many fields that is. */
  count: number;
  /** For every field: 1 if the unit's terrain mask allows the field's terrain. */
  open: Uint8Array;
}

/**
 * Where the selected unit, or the one picked to move out, can go, if it
 * belongs to the side that moves in this half. A unit that has already moved,
 * or cannot move at all, has no stops.
 */
function selectedReach(): Reach | null {
  const unit = activeUnit();
  const type = unit ? assets.unitTypes[unit.type] : undefined;
  if (!game || !unit || !type || unit.side !== game.mover || computerPlays(unit.side)) return null;
  const { map } = game;
  const fieldCount = map.columns * map.rows;
  const stops = new Uint8Array(fieldCount);
  const open = new Uint8Array(fieldCount);
  const range = rangeOf(game, unit);
  const blocked = cannotMoveReason(game, unit) !== null;
  let count = 0;
  for (let at = 0; at < fieldCount; at++) {
    const terrain = game.terrainTypes[map.terrain[at]!];
    if (terrain && canEnter(type.terrainMask, terrain)) open[at] = 1;
    if (!range || blocked) continue;
    const field = { column: at % map.columns, row: Math.floor(at / map.columns) };
    if (cannotStopReason(game, unit, range, field) === null) {
      stops[at] = 1;
      count++;
    }
  }
  return { stops, count, open };
}

/** The fields the selected unit can attack, if it belongs to the side that attacks in this half. */
function selectedTargets(): Field[] {
  const unit = selectedUnit();
  if (!game || !unit || leaving || computerPlays(unit.side) || cannotAttackReason(game, unit) !== null) return [];
  return attackTargets(game, unit);
}

/** Where the selected unit could build or dig, if it is a construction unit or sappers of the side that attacks. */
function selectedPlaces(): ReturnType<typeof workPlaces> {
  const unit = selectedUnit();
  if (!game || !unit || leaving || computerPlays(unit.side) || cannotWorkReason(game, unit) !== null) return [];
  return workPlaces(game, unit);
}

/** The middle of a field, in map pixels. */
function fieldCentre(field: Field): { x: number; y: number } {
  const { x, y } = fieldOrigin(field.column, field.row);
  return { x: x + TILE_SIZE / 2, y: y + TILE_SIZE / 2 };
}

/**
 * Redraws the marks on top of the map: the selected unit's reach or targets,
 * the attacks ordered, moved and damaged units, how many units each transport
 * and building holds, the selection, the pointer.
 */
function drawOverlay(): void {
  const context = overlayCanvas.getContext('2d')!;
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!game) return;
  const { map } = game;
  // Stamps are drawn, not copied, so the corners of one do not erase its neighbours.
  const stampOn = (stamp: HTMLCanvasElement, field: Field) => {
    const { x, y } = fieldOrigin(field.column, field.row);
    context.drawImage(stamp, x, y);
  };

  const reach = selectedReach();
  // The fields the unit that moves covers now; they are left as they are.
  const mover = activeUnit();
  const own = mover ? fieldsOf(mover) : [];
  if (reach) {
    // Two shades: very dark where the unit can never go, dimmed where it
    // cannot end a move this turn. What stays bright it can move to.
    for (let row = 0; row < map.rows; row++) {
      for (let column = 0; column < map.columns; column++) {
        const at = row * map.columns + column;
        if (reach.stops[at] || own.some((field) => sameField(field, { column, row }))) continue;
        stampOn(reach.open[at] ? stamps.outOfReach : stamps.closed, { column, row });
      }
    }
  }

  for (const field of selectedTargets()) stampOn(stamps.target, field);
  for (const { field } of selectedPlaces()) stampOn(stamps.work, field);

  if (state.showUnits) {
    // A small number on each transport and building entrance: the units inside.
    const countMark = (field: Field, count: number) => {
      if (count === 0) return;
      const { x, y } = fieldOrigin(field.column, field.row);
      context.fillStyle = '#10140f';
      context.fillRect(x + 4, y + 1, 7, 9);
      context.fillStyle = '#ffe27a';
      context.font = '8px sans-serif';
      context.textBaseline = 'top';
      context.fillText(String(count), x + 5, y + 2);
    };
    for (const building of game.buildings) countMark(building.entrance, building.units.length);
    for (const unit of game.units) {
      if (unit.destroyed || unit.inside) continue;
      countMark(unit, unit.cargo.length);
      const { x, y } = fieldOrigin(unit.column, unit.row);
      // A small square on each unit of the moving side that has had its move.
      if (unit.side === game.mover && unit.moved) {
        context.fillStyle = '#ffffff';
        context.fillRect(x + 14, y + 2, 5, 5);
        context.fillStyle = '#b02a2a';
        context.fillRect(x + 15, y + 3, 3, 3);
      }
      // A bar under each unit that has taken losses: one step per vehicle left.
      const full = assets.unitTypes[unit.type]?.groupSize ?? unit.count;
      if (unit.count < full) {
        context.fillStyle = '#000000';
        context.fillRect(x + 5, y + 20, full * 2 + 2, 3);
        context.fillStyle = '#e04a3a';
        context.fillRect(x + 6, y + 21, full * 2, 1);
        context.fillStyle = '#7fe07a';
        context.fillRect(x + 6, y + 21, unit.count * 2, 1);
      }
    }
    // A line along each move the computer made when this half began, half
    // see-through so the attacks and orders drawn over them stand out.
    context.strokeStyle = 'rgba(255, 226, 122, 0.5)';
    context.fillStyle = 'rgba(255, 226, 122, 0.5)';
    context.lineWidth = 1;
    for (const { unit, from, to } of computerTurns.flatMap((turn) => turn.moves)) {
      if (unit.destroyed) continue;
      const [a, b] = [fieldCentre(from), fieldCentre(to)];
      context.beginPath();
      context.moveTo(a.x + 0.5, a.y + 0.5);
      context.lineTo(b.x + 0.5, b.y + 0.5);
      context.stroke();
      context.fillRect(a.x - 1, a.y - 1, 3, 3);
    }
    // A line from each unit ordered to attack to the field it aims at.
    context.strokeStyle = '#ff4030';
    context.fillStyle = '#ff4030';
    for (const order of game.orders) {
      if (!showsOrdersOf(order.attacker.side)) continue;
      const from = fieldCentre(order.attacker);
      const to = fieldCentre(order.target);
      context.beginPath();
      context.moveTo(from.x + 0.5, from.y + 0.5);
      context.lineTo(to.x + 0.5, to.y + 0.5);
      context.stroke();
      context.fillRect(to.x - 1, to.y - 1, 3, 3);
    }
    // And one from each construction unit to the field it is to work on.
    context.strokeStyle = '#40a0ff';
    context.fillStyle = '#40a0ff';
    for (const order of game.works) {
      const from = fieldCentre(order.unit);
      const to = fieldCentre(order.target);
      context.beginPath();
      context.moveTo(from.x + 0.5, from.y + 0.5);
      context.lineTo(to.x + 0.5, to.y + 0.5);
      context.stroke();
      context.fillRect(to.x - 1, to.y - 1, 3, 3);
    }
  }
  drawFights(context, stampOn);
  if (selected) {
    // A ship that fills two fields is marked on both.
    const unit = selectedUnit();
    for (const field of unit && !leaving ? fieldsOf(unit) : [selected]) stampOn(stamps.selected, field);
  }
  if (hovered) stampOn(stamps.hover, hovered);
}

function describeField(field: Field): string {
  const terrain = terrainAt(field);
  const parts = [
    `Field ${field.column}, ${field.row}`,
    `terrain ${hex(terrain)} ${assets.tilesets[state.season].tileNames[terrain] ?? 'unknown'}`,
  ];
  const building = buildingAt(game!, field);
  if (building) parts.push(`${describeBuilding(building)}, ${building.units.length} inside`);
  const unit = state.showUnits ? unitAt(game!, field) : null;
  if (unit) parts.push(describeUnit(unit) + (unit.cargo.length ? `, carrying ${unit.cargo.length}` : ''));
  return parts.join(' · ');
}

function renderFieldInfo(): void {
  fieldInfo.textContent = notice ?? (hovered && game ? describeField(hovered) : FIELD_INFO_IDLE);
}

function renderTurn(): void {
  const battle = game ? savedBattle(state.mapId) : null;
  saveButton.disabled = !game;
  loadButton.disabled = !battle;
  saveButton.title = battle ? 'Replaces the battle saved for this map' : 'Keeps this battle in the browser';
  loadButton.title = battle ? `Back to the battle ${describeSave(battle)}` : 'No battle is saved for this map';
  if (!game) {
    turnStatus.textContent = '';
    return;
  }
  if (game.winner !== null) {
    turnStatus.textContent =
      `${OWNERS[game.winner]} side has won: ` +
      (game.wonBy === 'headquarters' ? 'it took the enemy headquarters.' : 'no enemy units are left.');
    return;
  }
  const own = game.units.filter((unit) => unit.side === game!.mover && !unit.destroyed);
  const moved = own.filter((unit) => unit.moved).length;
  const orders = game.orders.length + game.works.length;
  const attacker = attackerSide(game);
  turnStatus.textContent =
    `Round ${game.round} · ${OWNERS[game.mover]} moves (${computerPlays(game.mover) ? 'computer, ' : ''}${moved} of ${own.length}), ` +
    `${OWNERS[attacker]} attacks (${showsOrdersOf(attacker) ? `${orders} ordered` : 'computer'}) · ` +
    `points: ${OWNERS[0]} ${game.points[0]}, ${OWNERS[1]} ${game.points[1]}`;
}

/** Brings everything on screen in line with the game after it changed. */
function refresh(): void {
  autosave();
  draw();
  renderTurn();
  renderFieldInfo();
  renderDetails();
  if (insideDialog.open) renderInside();
}

// --- side panels -----------------------------------------------------------

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

function itemList(items: [title: string, sub: string][]): HTMLUListElement {
  const ul = document.createElement('ul');
  for (const [title, sub] of items) {
    const li = document.createElement('li');
    const first = document.createElement('div');
    first.textContent = title;
    const second = document.createElement('div');
    second.className = 'sub';
    second.textContent = sub;
    li.append(first, second);
    ul.append(li);
  }
  return ul;
}

function describeWeapon(weapon: Weapon | null): string {
  if (!weapon) return 'none';
  return weapon.range === 0 ? `power ${weapon.power}, defends only` : `power ${weapon.power}, range ${weapon.range}`;
}

function unitFacts(type: UnitType): [string, string][] {
  const facts: [string, string][] = [
    ['Class', type.className],
    ['Movement budget', String(type.movementBudget)],
    ['Speed', String(type.speed)],
    ['Armour', String(type.armour)],
    ['Group size', String(type.groupSize)],
    ['Against air', describeWeapon(type.weapons.air)],
    ['Against ground', describeWeapon(type.weapons.ground)],
    ['Against water', describeWeapon(type.weapons.water)],
    ['Cost', String(type.price)],
    ['Weight', type.loadClasses === 0 ? 'no transport carries it' : String(type.weight)],
  ];
  if (type.capacity > 0) facts.push(['Capacity', String(type.capacity)]);
  const armed = [type.weapons.air, type.weapons.ground, type.weapons.water].some((weapon) => weapon && weapon.power > 0);
  if (armed && type.attackMask & ATTACKS_INDIRECTLY) facts.push(['Fires from afar', 'not at the fields beside it, and never back']);
  else if (armed && type.attackMask & ATTACKS_NEVER_BACK) facts.push(['Never fires back', 'attacks, but does not answer an attack']);
  if (type.slowToFire) facts.push(['Slow to fire', 'cannot attack in the half after it moved']);
  if (type.entersAnyBuilding) facts.push(['Takes buildings', 'may use the entrance of a building that is not its side\'s']);
  if (type.buildsDepots) facts.push(['Builds depots', 'prepares the ground in one round, builds in another']);
  if (type.digsTrenches) facts.push(['Digs trenches', 'in place of attacking; its weapons only fire back']);
  facts.push(['Can enter', terrainMaskNames(type.terrainMask, profile.terrainClasses).join('; ') || 'nothing (does not move)']);
  return facts;
}

function panelButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function textElement(tag: 'div' | 'p' | 'h2' | 'h3' | 'span', className: string, text: string): HTMLElement {
  const made = document.createElement(tag);
  if (className) made.className = className;
  made.textContent = text;
  return made;
}

/** The side panel's lines for the transport or building on the selected field; the dialog shows the rest. */
function renderHolder(holder: Holder): void {
  const units = contentsOf(holder);
  const title = isBuilding(holder)
    ? `${describeBuilding(holder)} (${units.length} of ${PLACES} places taken)`
    : `Aboard (${units.length} of ${PLACES} places taken)`;
  const names = units.length ? units.map((unit) => unitName(unit.type)).join(', ') : 'Nothing inside.';
  details.append(heading(title), textElement('p', 'sub', names));
  if (leaving) {
    details.append(
      textElement('p', 'sub', `${unitName(leaving.type)} is moving out: click a bright field.`),
      panelButton('Keep inside', () => pickLeaving(null)),
    );
  }
  if (units.length > 0 && opensOnSecondClick(holder)) {
    details.append(textElement('p', 'sub', 'Click a bright field to move it, or click it again to look inside.'));
  }
  details.append(panelButton('Look inside', () => openInside(holder)));
}

// --- the inside of a transport or building -----------------------------------

/** A unit's sprite on a canvas of its own. */
function unitCanvas(type: number, side: Side | null, facing: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const surface = renderUnit(assets, type, side, facing, state.palette);
  if (surface) {
    canvas.getContext('2d')!.putImageData(new ImageData(rgbaBytes(surface), surface.width, surface.height), 0, 0);
  }
  return canvas;
}

const SVG = 'http://www.w3.org/2000/svg';

/** A five-pointed star round a point, as the path of an SVG. */
function starPath(x: number, y: number, radius: number): string {
  let path = '';
  for (let point = 0; point < 10; point++) {
    const reach = point % 2 === 0 ? radius : radius * 0.42;
    const angle = (Math.PI * point) / 5 - Math.PI / 2;
    path += `${point === 0 ? 'M' : 'L'}${(x + reach * Math.cos(angle)).toFixed(2)} ${(y + reach * Math.sin(angle)).toFixed(2)}`;
  }
  return `${path}Z`;
}

/**
 * The marks for experience, each drawn in a square of 24. They follow the
 * game's: for one to four steps that many small stars, set as the game sets
 * them (one; two aslant; three in a triangle; four in a diamond); for five
 * one large star; for the sixth and last a cross with flared arms.
 */
const SMALL_STAR = 4.7;
const SMALL_STARS: readonly (readonly [number, number])[][] = [
  [[12, 12.5]],
  [[7.5, 8.5], [16.5, 16.5]],
  [[12, 7], [6.5, 17], [17.5, 17]],
  [[12, 5.5], [5.5, 12.5], [18.5, 12.5], [12, 19.5]],
];
const LARGE_STAR = starPath(12, 12.8, 11.6);
const CROSS = 'M5 1H19Q15 7 14 10Q17 9 23 5V19Q17 15 14 14Q15 17 19 23H5Q9 17 10 14Q7 15 1 19V5Q7 9 10 10Q9 7 5 1Z';

/** The side's flag, in a game whose sides have flags; null for a unit of neither side and in the other games. */
function sideFlag(side: Side | null): SVGSVGElement | null {
  const flag = side === null ? undefined : profile.flags?.[side];
  if (!flag) return null;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 30 21');
  svg.setAttribute('class', 'flag');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${sideName(side)} flag`);
  flag.stripes.forEach((colour, number) => {
    const stripe = document.createElementNS(SVG, 'rect');
    stripe.setAttribute(flag.upright ? 'x' : 'y', String(number * (flag.upright ? 10 : 7)));
    stripe.setAttribute('width', flag.upright ? '10' : '30');
    stripe.setAttribute('height', flag.upright ? '21' : '7');
    stripe.setAttribute('fill', colour);
    svg.append(stripe);
  });
  return svg;
}

/** A unit's experience as a mark: stars or the cross. With no experience there is no mark, only its room. */
function experienceMarks(experience: number): HTMLElement {
  const marks = document.createElement('span');
  marks.className = 'rank';
  marks.setAttribute('role', 'img');
  marks.setAttribute('aria-label', `experience ${experience} of ${MAX_EXPERIENCE}`);
  marks.title = `experience ${experience} of ${MAX_EXPERIENCE}`;
  if (experience <= 0) return marks;
  const small = SMALL_STARS[experience - 1];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-1 -1 26 26');
  svg.setAttribute('class', experience >= MAX_EXPERIENCE ? 'cross' : 'stars');
  svg.setAttribute('aria-hidden', 'true');
  const drawn = document.createElementNS(SVG, 'path');
  drawn.setAttribute(
    'd',
    small ? small.map(([x, y]) => starPath(x, y, SMALL_STAR)).join('') : experience >= MAX_EXPERIENCE ? CROSS : LARGE_STAR,
  );
  svg.append(drawn);
  marks.append(svg);
  return marks;
}

/** A unit's strength: a mark for each vehicle, gun or squad of a full unit, the lost ones hollow. */
function strengthMarks(count: number, full: number): HTMLElement {
  const marks = document.createElement('div');
  marks.className = 'pips';
  marks.setAttribute('role', 'img');
  marks.setAttribute('aria-label', `strength ${count} of ${full}`);
  marks.title = `strength ${count} of ${full}`;
  for (let i = 0; i < Math.max(full, count); i++) marks.append(textElement('span', i < count ? 'pip' : 'pip lost', ''));
  return marks;
}

/** A line of the unit's card that shows a number as marks: what it is, the marks, and the number in words. */
function meter(label: string, marks: HTMLElement, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'meter';
  row.append(textElement('span', 'label', label), marks, textElement('span', 'sub', value));
  return row;
}

/** What a kind of unit fires at, how hard and how far: the table the game's own information screen shows. */
function weaponTable(type: UnitType): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'weapons';
  const cell = (tag: 'th' | 'td', text: string, scope?: 'col' | 'row') => {
    const made = document.createElement(tag);
    made.textContent = text;
    if (scope) (made as HTMLTableCellElement).scope = scope;
    return made;
  };
  const head = table.createTHead().insertRow();
  head.append(cell('th', 'Weapons', 'col'), cell('th', 'Power', 'col'), cell('th', 'Range', 'col'));
  const body = table.createTBody();
  const rows: [string, Weapon | null][] = [
    ['Air', type.weapons.air],
    ['Ground', type.weapons.ground],
    ['Water', type.weapons.water],
  ];
  for (const [against, weapon] of rows) {
    const row = body.insertRow();
    row.append(cell('th', against, 'row'));
    if (!weapon || weapon.power === 0) {
      row.className = 'unarmed';
      row.append(cell('td', '–'), cell('td', '–'));
    } else {
      row.append(cell('td', String(weapon.power)), cell('td', weapon.range === 0 ? 'fires back only' : String(weapon.range)));
    }
  }
  return table;
}

/** The facts of a kind of unit that the card shows as marks, a table or tiles, and so not in its list. */
const ON_THE_CARD = new Set([
  'Class',
  'Movement budget',
  'Speed',
  'Armour',
  'Group size',
  'Against air',
  'Against ground',
  'Against water',
  'Cost',
]);

/**
 * The selected unit's card: its picture, name, side and flag; its experience as
 * stars or the cross and its strength as pips; its weapons; its numbers; what else is to be said of
 * its kind; and what it can do in this half.
 */
function unitCard(unit: Unit, type: UnitType, now: string, more: [string, string][]): HTMLElement {
  const card = document.createElement('section');
  card.className = 'unit-card';

  const head = document.createElement('div');
  head.className = 'unit-head';
  const portrait = unitCanvas(unit.type, unit.side, unit.facing);
  portrait.className = 'portrait';
  const names = document.createElement('div');
  names.append(
    textElement('h2', 'unit-name', unitName(unit.type)),
    textElement('div', 'sub', `${sideName(unit.side)} · ${type.className.toLowerCase()}`),
  );
  names.className = 'unit-names';
  head.append(portrait, names);
  const flag = sideFlag(unit.side);
  if (flag) head.append(flag);

  const tiles = document.createElement('div');
  tiles.className = 'stats';
  const numbers: [string, number][] = [
    ['Armour', type.armour],
    ['Speed', type.speed],
    ['Movement', type.movementBudget],
    ['Cost', type.price],
  ];
  for (const [label, value] of numbers) {
    const tile = document.createElement('div');
    tile.append(textElement('span', 'number', String(value)), textElement('span', 'label', label));
    tiles.append(tile);
  }

  card.append(
    head,
    meter('Experience', experienceMarks(unit.experience), `${unit.experience} of ${MAX_EXPERIENCE}`),
    meter('Strength', strengthMarks(unit.count, type.groupSize), `${unit.count} of ${type.groupSize}`),
    weaponTable(type),
    tiles,
    factList([...unitFacts(type).filter(([term]) => !ON_THE_CARD.has(term)), ...more]),
    textElement('p', 'unit-now', now),
  );
  return card;
}

/** Shows the inside of a transport or building in the dialog. */
function openInside(holder: Holder): void {
  if (holder !== inside) picked = null;
  inside = holder;
  renderInside();
  if (!insideDialog.open) insideDialog.showModal();
}

function closeInside(): void {
  if (insideDialog.open) insideDialog.close();
}

/** Has a damaged unit inside a building repaired, and says what it cost. */
function repair(unit: Unit): void {
  if (!game) return;
  const result = repairUnit(game, unit);
  notice = result.ok ? `${unitName(unit.type)} repaired for ${result.cost} points.` : result.reason;
  refresh();
}

/** Builds a unit in a factory, and says what it cost. */
function build(factory: Building, type: number): void {
  if (!game) return;
  const result = buildUnit(game, factory, type);
  notice = result.ok
    ? `${unitName(type)} built for ${assets.unitTypes[type]?.price ?? 0} points. It can move out when its side next moves.`
    : result.reason;
  refresh();
}

/** Closes the dialog with a unit picked to move out: the map then shows where it can go. */
function moveOut(holder: Holder, unit: Unit): void {
  closeInside();
  selected = fieldOf(holder);
  pickLeaving(unit);
  notice = `Click a bright field to move ${unitName(unit.type)} out. Esc keeps it inside.`;
  renderFieldInfo();
}

/** One of the seven places: the unit in it with what can be done with it, or an empty place. */
function placeCard(holder: Holder, unit: Unit | undefined, number: number): HTMLElement {
  const card = document.createElement('div');
  card.className = unit ? 'place' : 'place empty';
  if (!unit) {
    card.append(textElement('div', 'place-number', String(number)), textElement('div', 'sub', 'free'));
    return card;
  }
  const type = assets.unitTypes[unit.type];
  const full = type?.groupSize ?? unit.count;
  card.append(
    unitCanvas(unit.type, unit.side, unit.facing),
    textElement('div', 'place-name', unitName(unit.type)),
    textElement('div', 'sub', sideName(unit.side)),
    strengthMarks(unit.count, full),
    textElement('div', 'sub', `strength ${unit.count} of ${full}`),
    experienceMarks(unit.experience),
  );
  if (unit.cargo.length) {
    card.append(textElement('div', 'sub', `carrying ${unit.cargo.map((carried) => unitName(carried.type)).join(', ')}`));
  }
  // A unit of neither side can do nothing; the dialog says so once, above the places.
  if (computerPlays(unit.side)) {
    // The computer moves and repairs its own.
  } else if (unit.side === game!.mover) {
    const blocked = cannotMoveReason(game!, unit);
    if (blocked) card.append(textElement('div', 'sub', blocked));
    else card.append(panelButton('Move out', () => moveOut(holder, unit)));
  } else if (unit.side !== null && isBuilding(holder) && unit.count < full) {
    // A damaged unit of the side that attacks: this is the half in which it can be repaired.
    const blocked = cannotRepairReason(game!, unit);
    if (blocked) card.append(textElement('div', 'sub', blocked));
    else card.append(panelButton(`Repair for ${repairCost(game!, unit)}`, () => repair(unit)));
  }
  return card;
}

/** Picks a kind in the list of what a factory can build, to show its details; the same kind again puts them away. */
function pickChoice(type: number): void {
  picked = picked === type ? null : type;
  // The list is made anew: keep it where it was scrolled to, and give the keyboard's place back to the card.
  const scrolled = insideDialog.scrollTop;
  renderInside();
  insideDialog.scrollTop = scrolled;
  insideBody.querySelector<HTMLElement>(`.choice[data-type="${type}"]`)?.focus({ preventScroll: true });
}

/** What the picked kind is and can do, beside the list of what a factory can build. */
function choiceDetails(factory: Building, owner: Side, type: number, price: number, now: boolean): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'choice-details';
  const unitType = assets.unitTypes[type];
  const points = game!.points[owner];
  const top = document.createElement('div');
  top.className = 'choice-top';
  const name = document.createElement('div');
  name.append(
    textElement('div', 'place-name', unitName(type)),
    // When the side has too few points, the reason under the facts says so.
    textElement('div', 'sub', price > points ? `costs ${price} points` : `costs ${price} of the side's ${points} points`),
  );
  top.append(unitCanvas(type, owner, START_FACING[owner]), name);
  panel.append(top);
  // The price is said above, with what the side has.
  if (unitType) panel.append(factList(unitFacts(unitType).filter(([term]) => term !== 'Cost')));
  const blocked = now ? cannotBuildReason(game!, factory, type) : null;
  if (now && blocked === null) panel.append(panelButton(`Build for ${price}`, () => build(factory, type)));
  else if (blocked !== null) panel.append(textElement('p', 'sub', blocked));
  return panel;
}

/**
 * What a factory can build for its owner: each kind with its price, and a
 * button when it can be built now. A click on a kind shows what it is and
 * can do beside the list.
 */
function buildSection(factory: Building): HTMLElement[] {
  const choices = buildChoices(game!, factory);
  const { owner } = factory;
  if (owner === null || choices.length === 0) return [];
  const now = owner === attackerSide(game!) && !computerPlays(owner);
  const points = game!.points[owner];
  const shown = choices.find((choice) => choice.type === picked);
  const grid = document.createElement('div');
  grid.className = 'choices';
  for (const { type, price } of choices) {
    const blocked = now ? cannotBuildReason(game!, factory, type) : null;
    const card = document.createElement('div');
    card.className = price > points ? 'choice dear' : 'choice';
    card.dataset.type = String(type);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', String(type === shown?.type));
    card.title = `Show what ${unitName(type)} can do`;
    card.addEventListener('click', (event) => {
      // The "Build" button on the card builds; it does not pick.
      if (!(event.target instanceof HTMLButtonElement)) pickChoice(type);
    });
    card.addEventListener('keydown', (event) => {
      if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      pickChoice(type);
    });
    card.append(
      unitCanvas(type, owner, START_FACING[owner]),
      textElement('div', 'place-name', unitName(type)),
      textElement('div', 'sub', `${assets.unitTypes[type]?.className ?? ''} · costs ${price}`),
    );
    if (now && blocked === null) card.append(panelButton('Build', () => build(factory, type)));
    // What is too dear is dimmed; anything else that stops the building is said.
    else if (now && blocked !== null && price <= points) card.append(textElement('div', 'sub', blocked));
    grid.append(card);
  }
  const note = computerPlays(owner)
    ? `The ${OWNERS[owner]} side has ${points} points. The computer builds here when its side attacks.`
    : now
      ? `The ${OWNERS[owner]} side has ${points} points to spend in this half.`
      : `The ${OWNERS[owner]} side has ${points} points. It builds in the half in which it attacks.`;
  const layout = document.createElement('div');
  layout.className = 'build';
  layout.append(
    grid,
    shown
      ? choiceDetails(factory, owner, shown.type, shown.price, now)
      : textElement('p', 'choice-details sub', 'Click a kind to see what it is and can do.'),
  );
  return [textElement('h3', '', `Build a unit (${choices.length} kinds)`), textElement('p', 'sub', note), layout];
}

/** Fills the dialog with the transport or building it shows. */
function renderInside(): void {
  if (!inside || !game) return;
  const holder = inside;
  if (!isBuilding(holder) && holder.destroyed) {
    closeInside();
    return;
  }
  const units = contentsOf(holder);
  const title = document.createElement('header');
  const name = textElement('h2', '', isBuilding(holder) ? describeBuilding(holder) : describeUnit(holder));
  name.id = 'inside-title';
  const close = panelButton('Close', closeInside);
  close.className = 'inside-close';
  title.append(name, close);

  const facts: string[] = [];
  if (isBuilding(holder)) {
    facts.push(`Entrance on field ${holder.entrance.column}, ${holder.entrance.row}`);
    facts.push(`earns ${holder.resources} points a round${holder.owner === null ? ' once it is taken' : ''}`);
  } else {
    const type = assets.unitTypes[holder.type];
    const load = units.reduce((sum, unit) => sum + (assets.unitTypes[unit.type]?.weight ?? 0), 0);
    facts.push(`On field ${holder.column}, ${holder.row}`, `load ${load} of ${type?.capacity ?? 0}`);
  }
  facts.push(`${units.length} of ${PLACES} places taken`);

  const places = document.createElement('div');
  places.className = 'places';
  for (let i = 0; i < PLACES; i++) places.append(placeCard(holder, units[i], i + 1));

  insideBody.replaceChildren(title, textElement('p', 'sub', facts.join(' · ')));
  if (units.some((unit) => unit.side === null)) {
    insideBody.append(textElement('p', 'sub', 'The grey units belong to neither side until the building is taken.'));
  }
  insideBody.append(places);
  if (notice) insideBody.append(textElement('p', 'inside-note', notice));
  if (isBuilding(holder)) insideBody.append(...buildSection(holder));
}

function renderSelection(): void {
  if (!selected || !game) return;
  const unit = selectedUnit();
  const type = unit ? assets.unitTypes[unit.type] : undefined;
  const holder = selectedHolder();
  if (unit && type) renderSelectedUnit(unit, type);
  if (holder) renderHolder(holder);
  const terrain = terrainAt(selected);
  const terrainType = game.terrainTypes[terrain];
  details.append(
    heading(`Field ${selected.column}, ${selected.row}`),
    factList([
      ['Terrain', `${hex(terrain)} ${assets.tilesets[state.season].tileNames[terrain] ?? 'unknown'}`],
      [
        'Kind',
        terrainType ? (terrainType.sitePart ?? terrainClassName(terrainType.terrainClass, profile.terrainClasses)) : 'unknown',
      ],
    ]),
  );
}

/** The selected unit's card, with what it can do in this half and what the marks on the map mean. */
function renderSelectedUnit(unit: Unit, type: UnitType): void {
  if (!game) return;
  const more: [string, string][] = [];
  if (type.buildsDepots) more.push(['Supplies', `${unit.supplies} ${unit.supplies === 1 ? 'piece' : 'pieces'} of work left`]);
  let now: string;
  let note = '';
  if (computerPlays(unit.side)) {
    now = 'The computer plays this side.';
  } else if (unit.side === game.mover) {
    const reach = selectedReach();
    const blocked = cannotMoveReason(game, unit);
    now = blocked ?? 'Can move: click a bright field.';
    if (reach && blocked === null && !leaving) {
      more.push(['In reach', `${reach.count} ${reach.count === 1 ? 'field' : 'fields'}`]);
    }
    note =
      'Bright fields are where this unit can move. A bright transport or building entrance takes it in; ' +
      'the entrance of a building that is not its side\'s is taken when the turn ends. ' +
      'Dimmed fields are not in reach; very dark ones are terrain it can never enter.';
  } else if (type.buildsDepots || type.digsTrenches) {
    const blocked = cannotWorkReason(game, unit);
    const order = workOf(game, unit);
    const places = selectedPlaces().length;
    now =
      blocked ??
      (order
        ? `Ordered to ${describeWork(order.work)} on field ${order.target.column}, ${order.target.row}. Click it again to cancel.`
        : places
          ? `Can ${type.buildsDepots ? 'work on a depot' : 'dig'}: click a blue field.`
          : type.buildsDepots
            ? 'No ground near it can take a depot.'
            : 'No ground next to it can be dug.');
    note = type.buildsDepots
      ? 'Blue fields are where this unit can prepare the ground for a depot, or build one on ground already prepared. ' +
        'A depot needs four free fields of open ground: the blue one and the three below it. ' +
        'The work is done when the turn ends.'
      : 'Blue fields are open ground or trench next to the sappers. They dig a trench three fields long across ' +
        'the way to the field picked, or fill it in if that field is a trench. The work is done when the turn ends.';
  } else {
    const blocked = cannotAttackReason(game, unit);
    const order = orderOf(game, unit);
    const targets = selectedTargets().length;
    now =
      blocked ??
      (order
        ? `Ordered to attack field ${order.column}, ${order.row}. Click it again to cancel.`
        : targets
          ? 'Can attack: click a red field.'
          : 'No enemy unit is in range.');
    if (blocked === null) more.push(['In range', `${targets} enemy ${targets === 1 ? 'unit' : 'units'}`]);
    note = 'Red fields hold enemy units this unit can attack. Attacks are carried out when the turn ends.';
  }
  details.append(unitCard(unit, type, now, more));
  if (note) details.append(textElement('p', 'sub', note));
}

function renderDetails(): void {
  details.replaceChildren();
  if (!loaded || !game) return;
  const { map } = game;
  renderSelection();

  const info = maps.find((entry) => entry.id === state.mapId);
  const seasonNote = !info
    ? 'unknown'
    : info.season === state.season
      ? info.season
      : `${info.season} (shown in ${state.season})`;
  const count = (side: Side) => game!.units.filter((unit) => unit.side === side && !unit.destroyed).length;
  const { fights, captures, works } = lastReport ?? { fights: [], captures: [], works: [] };
  const computerDid = computerTurns
    .map((turn): [string, string] => [`${OWNERS[turn.side]} side`, describeComputerTurn(turn)])
    .filter(([, did]) => did !== '');
  if (computerDid.length > 0) {
    details.append(heading('The computer, as this half began'), itemList(computerDid));
    details.append(textElement('p', 'sub', 'Yellow lines on the map show where its units moved from.'));
  }
  if (works.length > 0) {
    details.append(heading(`Building and digging when the last turn ended (${works.length})`), itemList(works.map(describeWorkDone)));
  }
  if (captures.length > 0) {
    details.append(heading(`Buildings taken when the last turn ended (${captures.length})`), itemList(captures.map(describeCapture)));
  }
  if (fights.length > 0) {
    details.append(
      heading(`Attacks when the last turn ended (${fights.length})`),
      textElement('p', 'sub', 'On the map: a white line for each attack (dashed if it hit nothing), what each unit lost, and a cross on those destroyed. A click on the map clears them.'),
      panelButton('Show them on the map again', playFights),
      itemList(fights.map(describeFight)),
    );
  }
  details.append(
    heading('Map'),
    factList([
      ...(info?.from
        ? ([
            ['Map', `${GAMES[info.from.game].title} ${info.from.mapId}`],
            ['Code', info.code || 'unknown'],
            [
              'In the game',
              `not one of its maps: ${GAMES[info.from.game].title}'s map, rebuilt with History Line's tiles and units`,
            ],
          ] as [string, string][])
        : info?.title
          ? ([
              ['Map', info.title],
              ['About', info.about ?? 'nothing is said of it'],
              ['In the game', `not one of its maps: made from the sketch maps/${info.id}.json`],
            ] as [string, string][])
        : ([
            ['Map', state.mapId],
            ['Code', info?.code ?? 'unknown'],
            [
              'In the game',
              info?.singlePlayer
                ? `one player, as the ${OWNERS[profile.computerSide(state.mapId) === 0 ? 1 : 0]} side against the computer`
                : 'two players',
            ],
          ] as [string, string][])),
      ['Game', profile.title],
      ...(hasSeasons ? ([['Season', seasonNote]] as [string, string][]) : []),
      ['Size', `${map.columns} × ${map.rows} fields`],
      [`${OWNERS[0]} units`, String(count(0))],
      [`${OWNERS[1]} units`, String(count(1))],
      [`${OWNERS[0]} points`, `${game.points[0]}, earning ${incomeOf(game, 0)} a round`],
      [`${OWNERS[1]} points`, `${game.points[1]}, earning ${incomeOf(game, 1)} a round`],
    ]),
  );
}

function describeWork(work: WorkReport['work']): string {
  return {
    prepare: 'prepare the ground for a depot',
    build: 'build a depot',
    dig: 'dig a trench',
    fill: 'fill in the trench',
  }[work];
}

/** One piece of work on a depot or a trench, as a title and a line of detail. */
function describeWorkDone(report: WorkReport): [string, string] {
  const where = `field ${report.target.column}, ${report.target.row}`;
  const title = `${describeUnit(report.unit)} was to ${describeWork(report.work)} on ${where}`;
  if (!report.done) return [title, 'Not done: the ground was no longer fit for it.'];
  return [
    title,
    {
      prepare: 'Done: a depot can be built there from the next round on.',
      build: 'Done: the depot stands, and is empty.',
      dig: 'Done: the trench is three fields long where the ground allowed.',
      fill: 'Done: the trench is open ground again.',
    }[report.work],
  ];
}

/** One building taken, as a title and a line of detail. */
function describeCapture(report: CaptureReport): [string, string] {
  const { building, captured, displaced } = report;
  const notes = [`It was ${sideName(report.previousOwner)}; the unit is now inside.`];
  if (captured.length) {
    notes.push(`Went over with it: ${captured.map((unit) => unitName(unit.type)).join(', ')}`);
  }
  if (displaced) notes.push(`${unitName(displaced.type)} was lost: every place was taken`);
  if (building.kind === 'headquarters') notes.push('That wins the battle');
  return [
    `${describeUnit(report.unit)} took the ${building.kind} at ${building.entrance.column}, ${building.entrance.row}`,
    notes.join(' · '),
  ];
}

/** One attack, as a title and a line of detail. */
function describeFight(report: FightReport): [string, string] {
  const attacker = describeUnit(report.attacker);
  const where = `field ${report.targetField.column}, ${report.targetField.row}`;
  if (!report.target) return [`${attacker} attacked ${where}`, 'Nothing it could attack was there any more.'];
  const outcome = (losses: number, left: number) =>
    left <= 0 ? `lost ${losses} and was destroyed` : `lost ${losses}, ${left} left`;
  const extras = [
    report.flank ? `attack +${report.flank}% from units around the target` : '',
    report.support ? `armour +${report.support}% from units beside it` : '',
    report.cargoDestroyed.length
      ? `lost aboard: ${report.cargoDestroyed.map((unit) => unitName(unit.type)).join(', ')}`
      : '',
  ].filter(Boolean);
  return [
    `${attacker} attacked ${describeUnit(report.target)} on ${where}`,
    [
      `Target ${outcome(report.targetLosses, report.targetLeft)}`,
      `attacker ${outcome(report.attackerLosses, report.attackerLeft)}`,
      ...extras,
    ].join(' · '),
  ];
}

// --- state changes ---------------------------------------------------------

async function selectMap(id: string): Promise<void> {
  state.mapId = id;
  writeStateToUrl();
  const info = maps.find((map) => map.id === id);
  battleTitle.textContent = `${profile.title} · ${info ? mapName(info) : `Map ${id}`}`;
  document.title = `${info ? mapName(info) : `Map ${id}`} · ${profile.title}`;
  try {
    sketchProblems = [];
    const next = await library.load(id);
    // Another map may have been picked while this one was loading.
    if (state.mapId !== id) return;
    loaded = next.loaded;
    sketchProblems = next.problems;
  } catch (error) {
    loaded = null;
    game = null;
    showMessage(`Map ${id} could not be loaded: ${(error as Error).message}`);
    renderTurn();
    renderDetails();
    return;
  }
  // The battle that was in progress on this map is taken up; without one the map starts afresh.
  const inProgress = readBattle(autosaveKey(id), id);
  if (inProgress && takeUp(inProgress) === null) {
    notice = `The battle on this map is taken up where it was left: ${describeSave(inProgress)}. Restart begins it afresh.`;
  } else {
    startGame();
  }
  // Anything wrong with a new map's sketch is said in place of that.
  if (sketchProblems.length > 0) {
    notice = maps.find((map) => map.id === id)?.from
      ? `Rebuilt from another game's map. History Line's tiles cannot follow it in ${sketchProblems.length} place(s), ` +
        `mostly along the coast; the first: ${sketchProblems[0]}.`
      : `This map's sketch has ${sketchProblems.length} problem(s): ${sketchProblems.slice(0, 3).join('; ')}.`;
  }
  showMessage(null);
  refresh();
}

/**
 * The toolbar's two controls. Who plays, the season and the colours are
 * picked where the map is, and come with the address.
 */
function syncControls(): void {
  unitsCheckbox.checked = state.showUnits;
  zoomSelect.value = String(state.zoom);
}

function onControlChange(): void {
  state.showUnits = unitsCheckbox.checked;
  state.zoom = Number(zoomSelect.value);
  writeStateToUrl();
  refresh();
}

function fieldUnderPointer(event: MouseEvent): Field | null {
  if (!game) return null;
  const bounds = mapCanvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * mapCanvas.width);
  const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * mapCanvas.height);
  return fieldAt(x, y, game.map, mask);
}

function setSelected(field: Field | null): void {
  selected = field;
  leaving = null;
  drawOverlay();
  renderDetails();
}

/** Picks a unit inside the selected transport or building to move out, or with null lets it be. */
function pickLeaving(unit: Unit | null): void {
  leaving = unit;
  drawOverlay();
  renderDetails();
}

/**
 * A click on a field. With a unit selected that can move, or one picked to
 * move out, a click on a field it can end its move on is an order to move
 * there: an empty field, a transport that takes it, or a building's entrance.
 * With a unit selected that can attack, a click on an enemy unit in range
 * orders the attack, and a second click on the same one cancels it. Any other
 * click picks the field, and a second click on it lets it go; a building or
 * a transport that carries something also shows its inside, the transport of
 * the side that moves only when it is clicked a second time.
 */
function onFieldClick(field: Field | null): void {
  if (!game) return;
  notice = null;
  hideFights();
  // The computer's units are looked at, not given orders.
  const active = activeUnit();
  const unit = active && !computerPlays(active.side) ? active : null;
  const clicked = field && state.showUnits ? unitAt(game, field) : null;
  // An order to a construction unit or sappers to work on a blue field, or with a second click its end.
  const place = field && unit && !leaving ? selectedPlaces().find((one) => sameField(one.field, field)) : undefined;
  if (field && unit && place) {
    if (sameField(workOf(game, unit)?.target ?? null, field)) {
      cancelWork(game, unit);
    } else {
      const result = orderWork(game, unit, field);
      notice = result.ok
        ? `${unitName(unit.type)} will ${describeWork(result.work)} when the turn ends.`
        : result.reason;
    }
    refresh();
    return;
  }
  if (field && unit && !leaving && clicked && clicked.side !== unit.side && cannotAttackReason(game, unit) === null) {
    if (sameField(orderOf(game, unit), field)) {
      cancelAttack(game, unit);
      refresh();
      return;
    }
    const result = orderAttack(game, unit, field);
    if (result.ok) {
      refresh();
      return;
    }
    notice = result.reason;
  }
  // A click on the unit's own field, or on what it is inside, is no order to move.
  const ownField = unit !== null && fieldsOf(unit).some((covered) => sameField(covered, field));
  if (field && unit && !ownField && cannotMoveReason(game, unit) === null) {
    const range = rangeOf(game, unit);
    const refused = range ? cannotStopReason(game, unit, range, field) : 'This unit cannot move.';
    // A click on another unit picks that unit, unless it is a transport that takes this one.
    if (!clicked || refused === null) {
      const result = moveUnit(game, unit, field);
      if (result.ok) {
        selected = field;
        leaving = null;
        notice =
          result.arrival === 'loaded'
            ? `${unitName(unit.type)} is aboard.`
            : result.arrival === 'entered'
              ? `${unitName(unit.type)} is inside.`
              : result.arrival === 'taking'
                ? `${unitName(unit.type)} takes the building when the turn ends, if it is still there.`
                : null;
        refresh();
        return;
      }
      notice = result.reason;
    } else if (clicked.side === unit.side && assets.unitTypes[clicked.type]?.isTransport) {
      notice = refused;
    }
  }
  renderFieldInfo();
  const holder = field ? holderToOpen(field) : null;
  if (holder && opensOnSecondClick(holder) && selectedUnit() !== holder) {
    setSelected(field);
    return;
  }
  if (holder) {
    setSelected(field);
    openInside(holder);
    return;
  }
  setSelected(sameField(field, selected) ? null : field);
}

/**
 * Whether the first click on a transport or building only selects it. That
 * is so for a transport of the side that moves in this half, which is clicked
 * to be moved more often than to be looked into.
 */
function opensOnSecondClick(holder: Holder): boolean {
  return !isBuilding(holder) && holder.side === game?.mover && !computerPlays(holder.side);
}

/**
 * What a click on a field opens the dialog for: the building that covers it,
 * or a transport standing there with something aboard. A transport of the
 * side that moves is only selected by the first click and opened by a second.
 * An empty transport is only ever selected; its "Look inside" button still
 * opens it.
 */
function holderToOpen(field: Field): Holder | null {
  if (!game || !state.showUnits) return null;
  const unit = unitAt(game, field);
  if (unit) return unit.cargo.length > 0 ? unit : null;
  return buildingAt(game, field);
}

mapCanvas.addEventListener('pointermove', (event) => {
  const field = fieldUnderPointer(event);
  if (sameField(field, hovered)) return;
  hovered = field;
  notice = null;
  renderFieldInfo();
  drawOverlay();
});
mapCanvas.addEventListener('pointerleave', () => {
  hovered = null;
  renderFieldInfo();
  drawOverlay();
});
mapCanvas.addEventListener('click', (event) => onFieldClick(fieldUnderPointer(event)));
document.addEventListener('keydown', (event) => {
  // In the dialog Esc closes it, which the browser does itself.
  if (event.key !== 'Escape' || insideDialog.open) return;
  hideFights();
  if (leaving) pickLeaving(null);
  else if (selected) setSelected(null);
});
insideDialog.addEventListener('close', () => {
  inside = null;
});
// A click beside the dialog's content lands on the dialog itself: on its backdrop.
insideDialog.addEventListener('click', (event) => {
  if (event.target === insideDialog) closeInside();
});
endTurnButton.addEventListener('click', () => {
  if (!game) return;
  lastReport = endHalf(game);
  selected = null;
  leaving = null;
  // Before the computer moves anything: the attackers still stand where they fought.
  markFights(lastReport.fights);
  computerTurns = [];
  runComputer();
  const computerMoved = computerTurns.reduce((sum, turn) => sum + turn.moves.length, 0);
  const { fights, captures, works, paid } = lastReport;
  const built = works.filter((work) => work.done && work.work === 'build').length;
  const taken =
    (captures.length ? `${captures.length} ${captures.length === 1 ? 'building' : 'buildings'} taken. ` : '') +
    (built ? `${built} ${built === 1 ? 'depot' : 'depots'} built. ` : '') +
    (paid.points ? `${OWNERS[paid.side]} side paid ${paid.points} points. ` : '');
  notice =
    game.winner !== null
      ? `${OWNERS[game.winner]} side has won.`
      : `${fights.length} ${fights.length === 1 ? 'attack' : 'attacks'} carried out. ${taken}` +
        `Now ${OWNERS[game.mover]} moves and ${OWNERS[attackerSide(game)]} attacks.` +
        (computerMoved ? ` The computer has moved ${computerMoved} ${computerMoved === 1 ? 'unit' : 'units'}.` : '');
  refresh();
  playFights();
});
restartButton.addEventListener('click', () => {
  startGame();
  refresh();
});
saveButton.addEventListener('click', saveBattle);
loadButton.addEventListener('click', loadBattle);
for (const control of [unitsCheckbox, zoomSelect]) {
  control.addEventListener('change', onControlChange);
}

/** Names the page after the game, and points the way back at its maps. */
function nameControls(): void {
  document.title = profile.title;
  battleTitle.textContent = profile.title;
  backLink.href = mapsPage(gameId, state.mapId || undefined);
}

async function start(): Promise<void> {
  const asked = new URLSearchParams(location.hash.slice(1));
  // A battle is of a map: without one named, the maps are there to pick from.
  if (!state.mapId) {
    location.replace(mapsPage(gameId));
    return;
  }
  nameControls();
  syncControls();
  try {
    library = await openLibrary(gameId);
    ({ assets, maps } = library);
  } catch (error) {
    showMessage(
      `The game's files could not be read (${(error as Error).message}). ` +
        'Start the viewer with "npm run dev", and set the HL_GAME_DIR environment variable (BI_GAME_DIR ' +
        'for Battle Isle) if the game is not installed in the default GOG folder.',
    );
    return;
  }
  mask = hexMask(assets.tilesets.summer.tiles[0]!);
  stamps = {
    hover: makeStamp(255, 255, 255, 90),
    selected: makeStamp(255, 214, 64, 140),
    closed: makeStamp(0, 0, 0, 175),
    outOfReach: makeStamp(0, 0, 0, 85),
    target: makeStamp(255, 48, 32, 120),
    work: makeStamp(64, 160, 255, 130),
  };
  const first = maps.find((map) => map.id === state.mapId);
  if (!first) {
    showMessage(`${profile.title} has no map ${state.mapId}. The list of its maps is one step back.`);
    return;
  }
  // Without a season in the address, start in the season the game plays the map in.
  if (hasSeasons && !asked.has('season')) {
    state.season = first.season;
    syncControls();
  }
  // Asked to begin afresh: the battle that was in progress on this map is let go. The address
  // loses the asking as soon as the map is open, so loading the page again goes on with the new battle.
  if (asked.has('fresh')) forgetBattle(autosaveKey(first.id));
  await selectMap(first.id);
}

void start();

// Battles as the browser keeps them, and who plays them. Shared by the page
// a map is picked on, which offers to go on with a battle, and the page it is
// played on.

import type { Side } from '../formats/map.ts';
import type { SavedGame } from '../game/save.ts';
import type { GameId, Season } from '../games.ts';

/**
 * Which side or sides the computer plays. The first side is named 'german'
 * and the second 'french' in every game: the names are in addresses and in
 * battles saved before other games were read.
 */
export type ComputerChoice = 'nobody' | 'german' | 'french' | 'both';
export const COMPUTER_CHOICES: readonly ComputerChoice[] = ['nobody', 'german', 'french', 'both'];

/** Whether the computer plays a side. */
export function computerPlaysSide(choice: ComputerChoice, side: Side): boolean {
  return choice === 'both' || choice === (side === 0 ? 'german' : 'french');
}

/**
 * A battle as the browser keeps it. Each map has two places: one for the
 * battle saved with the Save button, and one for the battle in progress,
 * which is kept up to date without being asked.
 */
export interface SavedBattle {
  mapId: string;
  /** Which sides the computer played, and the halves it had played them in; missing in older saves. */
  computer?: ComputerChoice;
  played?: [string | null, string | null];
  /** Each side's strength when the battle began and as each half ended; missing in older saves. */
  strengths?: [number, number][];
  /** The season it was being played in. */
  season: Season;
  /** When it was saved, as an ISO date. */
  savedAt: string;
  game: SavedGame;
}

// History Line's battles are kept under the names they always had; another game's have the game in theirs.
const prefix = (game: GameId) => (game === 'historyline' ? 'historyline' : `historyline.${game}`);
export const saveKey = (game: GameId, mapId: string) => `${prefix(game)}.save.${mapId}`;
export const autosaveKey = (game: GameId, mapId: string) => `${prefix(game)}.auto.${mapId}`;

/** The battle kept under a name for a map, if there is one that can be read. */
export function readBattle(key: string, mapId: string): SavedBattle | null {
  try {
    const text = localStorage.getItem(key);
    const battle = text ? (JSON.parse(text) as SavedBattle) : null;
    return battle && battle.mapId === mapId && battle.game ? battle : null;
  } catch {
    // No storage, or something else's data under the name.
    return null;
  }
}

/** Forgets the battle kept under a name. */
export function forgetBattle(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // No storage: there is nothing kept.
  }
}

/** When a battle was kept and how it stood, in words; `sides` are the game's names for the two sides. */
export function describeSave(battle: SavedBattle, sides: readonly string[]): string {
  const { round, mover, winner } = battle.game;
  const when = new Date(battle.savedAt).toLocaleString();
  return winner !== null
    ? `saved ${when}, won by the ${sides[winner]} side in round ${round}`
    : `saved ${when} in round ${round}, ${sides[mover]} side moving`;
}

// The list of games in the toolbar, which the viewer's two pages share: the
// one for the games that can be played (main.ts) and the one that only shows
// Battle Isle 2's maps (bi2.ts).

import { BI2_TITLE, isBi2GameId } from '../bi2/games.ts';
import { GAMES, isGameId } from '../games.ts';

/** A game's name in the list. */
function titleOf(id: string): string | null {
  return isGameId(id) ? GAMES[id].title : isBi2GameId(id) ? `${BI2_TITLE} (maps only)` : null;
}

/** The address of the page that shows a game. History Line, the game the viewer began with, needs no naming. */
export function addressOf(id: string): string {
  if (isBi2GameId(id)) return '/bi2.html';
  return id === 'historyline' ? '/' : `/#game=${id}`;
}

/** The games the development server finds installed; just the one shown if it cannot say. */
export async function installedGameIds(shown: string): Promise<string[]> {
  try {
    const response = await fetch('/game/');
    const ids: unknown = response.ok ? await response.json() : [];
    const known = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && titleOf(id) !== null) : [];
    return known.length > 0 ? known : [shown];
  } catch {
    return [shown];
  }
}

/** Opens the page of another game. Everything on a page belongs to the game it was loaded for. */
export function openGame(id: string): void {
  const next = new URL(addressOf(id), location.href);
  if (next.pathname !== location.pathname) {
    location.href = next.href;
    return;
  }
  // Between two games of one page only the part after the # differs, and going
  // there loads nothing by itself. The address is changed in place and the
  // page loaded again: asking to go to an address without a # (History Line's)
  // and then to reload would reload the old address and drop the going.
  history.replaceState(null, '', next.href);
  location.reload();
}

/** Fills the list with the installed games and has a pick open that game's page. */
export function showGameList(select: HTMLSelectElement, shown: string, installed: readonly string[]): void {
  select.replaceChildren(
    ...installed.map((id) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = titleOf(id);
      return option;
    }),
  );
  select.value = shown;
  // A game on its own needs no choosing.
  select.parentElement!.hidden = installed.length < 2;
  select.addEventListener('change', () => {
    if (select.value !== shown) openGame(select.value);
  });
}

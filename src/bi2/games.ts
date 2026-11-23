// Battle Isle 2, of which this project only draws the maps.
//
// Battle Isle 2 is a later program than History Line with other files (see
// formats.ts), and nothing of the rules in src/game fits it: it has weather,
// fuel, ammunition, four weapons to a unit and up to seven players. So it is
// not one of the games in src/games.ts. Its missions can be looked at, not
// played.
//
// It came on two disks, the game and an add-on, the Scenery disk, which a
// GOG install keeps in a folder each. They are one game here: the add-on has
// the game's terrain parts and unit kinds unchanged, six unit kinds more, and
// missions with numbers the game does not use.
//
// Each disk is read from its folder and from the CD image beside it (a .gog
// file): the missions are only on the image.

/** The one game the two disks make, as the viewer's list and the tools' --game option name it. */
export const BI2_GAME_ID = 'bi2';
export const BI2_TITLE = 'Battle Isle 2';

export function isBi2GameId(value: unknown): value is typeof BI2_GAME_ID {
  return value === BI2_GAME_ID;
}

export type Bi2DiskId = 'bi2' | 'bi2scenery';

export interface Bi2Disk {
  id: Bi2DiskId;
  /** What its missions are listed under. */
  title: string;
  /** The disk's folder inside the Battle Isle 2 install. */
  folder: string;
  /** The CD image in that folder. */
  image: string;
  /** The folder on the CD that holds the game, with a slash after it. */
  imageRoot: string;
}

/**
 * The two disks, the game first. The later one has everything the earlier
 * has but its missions, so the tiles and names are taken from the last one
 * that is installed.
 */
export const BI2_DISKS: readonly Bi2Disk[] = [
  { id: 'bi2', title: 'The game', folder: 'ISLE2', image: 'BI2.gog', imageRoot: 'BI2/' },
  { id: 'bi2scenery', title: 'Scenery disk', folder: 'SCENERY', image: 'BI2scen.gog', imageRoot: 'BI2_SCEN/' },
];

export function bi2Disk(id: unknown): Bi2Disk | null {
  return BI2_DISKS.find((disk) => disk.id === id) ?? null;
}

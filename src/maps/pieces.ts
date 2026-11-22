// What the game's terrain tiles show, as far as making a map needs to know:
// what lies along each of a tile's six sides, which tiles are the same kind
// of ground, and which tiles only come together as one larger piece.
//
// None of this is in the game's files. The sides were read off the tiles'
// pictures, the larger pieces off the 72 original maps, where their tiles
// never appear apart; test/maps.test.ts checks both against the installed
// game. A tile is named by its terrain number, the one a map file uses, so
// the table holds for the winter tiles as well as the summer ones.
//
// Sides are given clockwise from the one above, like directions everywhere
// else: above, upper right, lower right, below, lower left, upper left.

/**
 * What lies along one side of a tile: land, water, a paved road, a track, a
 * railway or a river crossing that side, or anything at all.
 */
export type Edge = 'g' | 'w' | 'R' | 'T' | 'L' | 'V' | '?';

/** The kinds of line that cross a tile's side. */
export type Link = 'R' | 'T' | 'L' | 'V';

export const TILE_COUNT = 175;

const LAND = 'gggggg';
const WATER = 'wwwwww';

/** The tiles that are not land on every side. */
const SIDES: Record<number, string> = {
  // Open water, and rocks standing in it.
  0x19: WATER, 0x2f: WATER, 0x30: WATER, 0x3c: WATER, 0x3d: WATER, 0x3e: WATER,
  // Shores. On 0x20 and 0x21 the shore runs down the middle, and the beach
  // along the sides above and below joins another beach or the land.
  0x1a: 'wwggww', 0x1b: 'gwwwwg', 0x1c: 'wwwggw', 0x1d: 'ggwwww',
  0x1e: 'wwgggw', 0x1f: 'ggwwwg', 0x20: 'gwwggg', 0x21: 'ggggww',
  // Rivers, and the two footbridges over them.
  0x24: 'ggVggV', 0x25: 'gVggVg', 0x26: 'VggVgg', 0x27: 'VgggVg', 0x28: 'gggVgV', 0x29: 'gVgVgg',
  0x2a: 'VgVggg', 0x2b: 'ggVgVg', 0x2c: 'gVgggV', 0x2d: 'gVgVgV', 0x2e: 'VgVgVg',
  0x3a: 'gVggVg', 0x3b: 'VggVgg',
  // Railways: straight, bent, points, then crossing a river, a track and a road.
  0x55: 'LggLgg', 0x56: 'ggLggL', 0x57: 'gLggLg',
  0x58: 'LgggLg', 0x59: 'gggLgL', 0x5a: 'gLgLgg', 0x5b: 'LgLggg', 0x5c: 'gLgggL', 0x5d: 'ggLgLg',
  0x5e: 'LggLLg', 0x5f: 'LgLLgg', 0x60: 'LggLgL',
  0x61: 'LgVLgV', 0x62: 'LVgLVg', 0x63: 'TLgTLg', 0x64: 'LTgLTg',
  0x65: 'LgRLgR', 0x66: 'RgLRgL', 0x67: 'RLgRLg', 0x68: 'LRgLRg',
  // A town's street.
  0x69: 'TggTgg', 0x6a: 'TggTgg',
  // Road bridges over open water, and the six ends of them: a shore with the
  // road running off it.
  0x6c: 'wwRwwR', 0x6e: 'wRwwRw', 0x72: 'RwwRww',
  0x6b: 'gwRggR', 0x6d: 'ggRgwR', 0x6f: 'gRggRw', 0x70: 'gRwgRg', 0x71: 'RgwRwg', 0x73: 'RwgRgw',
  // Roads and tracks over a river.
  0x74: 'RgVRgV', 0x75: 'RVgRVg', 0x76: 'VgRVgR', 0x79: 'TVgTVg', 0x7a: 'TgVTgV',
  // Paved roads: straight, bent, forks, and the one crossroads.
  0x7f: 'RggRgg', 0x80: 'gRggRg', 0x81: 'ggRggR',
  0x82: 'gRgRgg', 0x83: 'RgRggg', 0x84: 'gggRgR', 0x85: 'RgggRg', 0x86: 'gRgggR', 0x87: 'ggRgRg',
  0x88: 'gRggRR', 0x89: 'gRRggR', 0x8a: 'gRRgRg', 0x8b: 'ggRgRR',
  0x8c: 'RggRRg', 0x8d: 'RggRgR', 0x8e: 'RgRRgg', 0x8f: 'RRgRgg', 0x91: 'gRgRgR',
  0x90: 'gRRgRR',
  // Tracks, in the same order.
  0x92: 'TggTgg', 0x93: 'gTggTg', 0x94: 'ggTggT',
  0x95: 'gTgTgg', 0x96: 'TgTggg', 0x97: 'gggTgT', 0x98: 'TgggTg', 0x99: 'gTgggT', 0x9a: 'ggTgTg',
  0x9b: 'TggTTg', 0x9c: 'TggTgT', 0x9d: 'TgTTgg', 0x9e: 'TTgTgg',
  0x9f: 'gTggTT', 0xa0: 'gTTggT', 0xa1: 'gTTgTg', 0xa2: 'ggTgTT', 0xa4: 'gTgTgT',
  0xa3: 'gTTgTT',
  // Buildings: the gate a road leads to, the rest as it comes.
  0x01: 'Rg???g', 0x02: 'Rg???g', 0x03: '??????', 0x04: '??ggg?', 0x05: 'g???gg', 0x06: '???ggg',
  0x07: 'ggg???', 0x08: '?ggg??',
  0x09: 'gg???g', 0x0a: '??ggg?', 0x0b: 'g??ggg',
  0x0c: 'gRgg??', 0x0d: 'gRgg??', 0x0e: 'gRgg??',
  0x0f: 'Rg???g', 0x10: 'Rg???g', 0x11: 'Rg???g',
  0x12: '??ggg?', 0x13: 'g??ggg', 0x14: 'gggg??',
  0x15: 'gg???g', 0x16: '??ggg?', 0x17: 'g??ggg', 0x18: 'gggg??',
  // Tiles this table does not describe: the quay and the harbour pieces.
  0x23: '??????', 0x34: '??????', 0x35: '??????', 0x77: '??????', 0x78: '??????',
  0x7b: '??????', 0x7c: '??????', 0x7d: '??????', 0x7e: '??????', 0xae: '??????',
};

/** The six sides of every tile, by terrain number. */
export const TILE_SIDES: readonly string[] = Array.from({ length: TILE_COUNT }, (_, tile) => SIDES[tile] ?? LAND);

/**
 * Tiles that are open water or a shore: the ones a field of shallow water
 * can become. The rest of the tiles with water along a side are land that a
 * river runs through.
 */
export const SHALLOW_TILES: readonly number[] = [
  0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21,
  0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73,
];

export const SHALLOW_WATER = 0x19;
/** Shallow water away from the shore, as the originals draw it beside the deep. */
export const OPEN_SHALLOW_WATER = 0x2f;
export const DEEP_WATER = 0x30;

/**
 * The kinds of ground a sketch can ask for by letter, and the tiles that are
 * that ground. A tile listed more than once is picked that much more often;
 * the numbers follow roughly how often the originals use each.
 */
export const GROUND: Record<string, readonly number[]> = {
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x50, 0x50, 0x4e, 0x4f],
  ',': [0x51, 0x51, 0x51, 0x52],
  o: [0x53, 0x54],
  f: [0x38, 0x38, 0x38, 0x38, 0x39, 0x39, 0x39, 0x37, 0x37, 0x36],
  h: [0x31, 0x32],
  '^': [0x40],
  r: [0x4c, 0x4c, 0x4b, 0x4d],
  '#': [0x3f],
  t: [0xa7],
  p: [0x22],
  '*': [0x3c, 0x3d, 0x3e],
  '-': [SHALLOW_WATER],
  '~': [DEEP_WATER],
};

/** The ground letters that are water: lines cross them on bridges, and a shore forms beside them. */
export const WATER_GROUND = '-~*';

export type Owner = 'german' | 'french' | 'neutral';

/** A piece's tiles: each is reached from the field the piece is placed by, taking these steps. */
export type Piece = readonly { steps: readonly number[]; tile: number }[];

// A field and the three below it: to the lower right, below, to the lower left.
const diamond = (top: number, lowerRight: number, below: number, lowerLeft: number): Piece => [
  { steps: [], tile: top },
  { steps: [2], tile: lowerRight },
  { steps: [3], tile: below },
  { steps: [4], tile: lowerLeft },
];

/** The larger pieces of scenery, each placed by its topmost field (the town by its house). */
export const SCENERY: Record<string, Piece> = {
  hill: diamond(0x43, 0x46, 0x44, 0x45),
  mountain: diamond(0x47, 0x4a, 0x48, 0x49),
  ridge: [
    { steps: [], tile: 0x42 },
    { steps: [4], tile: 0x41 },
  ],
  town: [
    { steps: [], tile: 0x33 },
    { steps: [1], tile: 0x69 },
    { steps: [2], tile: 0x6a },
  ],
};

export type BuildingKind = 'headquarters' | 'factory' | 'depot';

const ENTRANCES: Record<BuildingKind, Partial<Record<Owner, number>>> = {
  headquarters: { german: 0x01, french: 0x02 },
  factory: { neutral: 0x0c, german: 0x0d, french: 0x0e },
  depot: { neutral: 0x0f, german: 0x10, french: 0x11 },
};

/**
 * A building as tiles, placed by its entrance; null if there is no such
 * building, which is the case for a headquarters that is nobody's.
 *
 * A headquarters lies around the field below its entrance. A factory lies to
 * the left of its entrance, a depot below it.
 */
export function buildingPiece(kind: BuildingKind, owner: Owner): Piece | null {
  const entrance = ENTRANCES[kind][owner];
  if (entrance === undefined) return null;
  if (kind === 'headquarters') {
    return [
      { steps: [], tile: entrance },
      { steps: [3], tile: 0x03 },
      { steps: [2], tile: 0x07 },
      { steps: [3, 2], tile: 0x08 },
      { steps: [3, 3], tile: 0x04 },
      { steps: [3, 4], tile: 0x06 },
      { steps: [4], tile: 0x05 },
    ];
  }
  if (kind === 'factory') {
    return [
      { steps: [], tile: entrance },
      { steps: [5], tile: 0x09 },
      { steps: [4], tile: 0x0a },
      { steps: [5, 4], tile: 0x0b },
    ];
  }
  return diamond(entrance, 0x14, 0x12, 0x13);
}

/**
 * Whether two sides that face each other go together. A road may end against
 * plain land, a paved road may run on as a track, and a river may run out
 * into open water; land against water is a shore with no beach drawn.
 */
export function sidesAgree(one: string, other: string): boolean {
  if (one === other || one === '?' || other === '?') return true;
  const pair = one < other ? one + other : other + one;
  // Upper-case letters sort before lower-case ones.
  return pair === 'RT' || pair === 'Vw' || pair === 'Rg' || pair === 'Tg' || pair === 'Lg' || pair === 'Vg';
}

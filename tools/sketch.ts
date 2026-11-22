// Builds a map from a sketch, says what is wrong with it, draws it, and can
// have the computer play both sides of it to see how the battle goes.
//
//   node tools/sketch.ts <sketch.json> [--play rounds] [--games n] [--scale n] [--out file] [--no-units]
//
// The picture goes to out/ unless --out is given. With --play, the computer
// plays both sides for at most that many rounds; --games plays that many
// battles, which differ in what the factories build.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Side } from '../src/formats/map.ts';
import { computerPlay } from '../src/game/computer.ts';
import { attackerSide, createGame, endHalf } from '../src/game/state.ts';
import { buildMap, type MapSketch } from '../src/maps/sketch.ts';
import { loadAssets } from '../src/viewer/assets.ts';
import { renderMap } from '../src/viewer/render.ts';
import { diskFiles } from './gameFiles.ts';
import { encodePng } from './png.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    play: { type: 'string' },
    games: { type: 'string', default: '1' },
    scale: { type: 'string', default: '2' },
    out: { type: 'string' },
    'no-units': { type: 'boolean', default: false },
  },
});
const [path] = positionals;
if (!path) throw new Error('usage: sketch.ts <sketch.json> [--play rounds] [--games n] [--scale n] [--out file]');

const sketch = JSON.parse(await readFile(path, 'utf8')) as MapSketch;
const assets = await loadAssets(diskFiles());
const season = sketch.season ?? 'summer';
const terrainTypes = assets.tilesets[season].terrainTypes;
const built = buildMap(sketch, { unitTypes: assets.unitTypes, terrainTypes });

const { map } = built;
const unitCount = [...map.units].filter((code) => code !== 0xff).length;
console.log(`${sketch.title}: ${map.columns} x ${map.rows} fields, ${unitCount} units on the map, ${season}`);
if (built.problems.length === 0) console.log('nothing is wrong with it');
for (const problem of built.problems) console.log(`  problem: ${problem}`);

const surface = renderMap(map, assets, { season, palette: 0, showUnits: !values['no-units'] });
const target = resolve(values.out ?? join(import.meta.dirname, '..', 'out', `${basename(path, '.json')}.png`));
await mkdir(dirname(target), { recursive: true });
await writeFile(target, encodePng(surface, Number(values.scale)));
console.log(`drawn to ${target}`);

if (values.play) {
  const rounds = Number(values.play);
  const sideName = ['German', 'French'];
  const wins = [0, 0];
  for (let game = 0; game < Number(values.games); game++) {
    let seed = 12345 + game * 7919;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    const state = createGame(map, assets.unitTypes, terrainTypes, built.shops);
    const start = [0, 1].map((side) => state.units.filter((unit) => unit.side === side).length);
    const tally = { attacks: 0, hits: 0, built: [0, 0], taken: [0, 0] };
    while (state.round <= rounds && state.winner === null) {
      for (const side of [attackerSide(state), state.mover]) {
        const turn = computerPlay(state, side, { table: assets.computerTables[side], random });
        tally.attacks += turn.attacks.length;
        tally.built[side]! += turn.built.length;
      }
      const taker: Side = state.mover;
      const report = endHalf(state);
      tally.hits += report.fights.filter((fight) => fight.targetLosses > 0).length;
      tally.taken[taker]! += report.captures.length;
    }
    const left = [0, 1].map((side) => state.units.filter((unit) => unit.side === side && !unit.destroyed).length);
    const outcome =
      state.winner === null
        ? `no winner after ${rounds} rounds`
        : `${sideName[state.winner]} win in round ${state.round} by ${state.wonBy === 'units' ? 'destroying every unit' : 'taking the headquarters'}`;
    if (state.winner !== null) wins[state.winner]!++;
    console.log(
      `game ${game + 1}: ${outcome}; units German ${start[0]} -> ${left[0]}, French ${start[1]} -> ${left[1]};` +
        ` built ${tally.built.join('/')}, buildings taken ${tally.taken.join('/')}, ${tally.hits} of ${tally.attacks} attacks hit`,
    );
  }
  if (Number(values.games) > 1) console.log(`German wins ${wins[0]}, French wins ${wins[1]}, of ${values.games}`);
}

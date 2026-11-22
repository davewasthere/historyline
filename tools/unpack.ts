// Unpacks the game's data files into a plain directory tree for inspection.
// The viewer does not need this: it reads the original files directly.
//
//   node tools/unpack.ts [gameDir] [outDir]
//
// gameDir defaults to $HL_GAME_DIR, then to the GOG install path.
// outDir defaults to <project>/unpacked.
//
// TPWM-packed files are unpacked, library archives become a folder with one
// file per entry, and everything else is copied unchanged. manifest.tsv lists
// every file written. The original files are only read, never modified.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { readArchiveDirectory } from '../src/formats/archive.ts';
import { isTpwm, unpackTpwm } from '../src/formats/tpwm.ts';
import { gameDir } from './gameFiles.ts';

const sourceDir = resolve(process.argv[2] ?? gameDir());
const outDir = resolve(process.argv[3] ?? join(import.meta.dirname, '..', 'unpacked'));

// Not game data: the emulator, the GOG installer's files, and the executables.
const SKIP_DIRS = new Set(['DOSBOX', '__support', 'cloud_saves']);
const SKIP_FILES = /^(gog.*|goggame-.*|unins\d+\..*|webcache\.zip|EULA\.txt|manual\.pdf|support\.ico|.*\.(lnk|conf|exe))$/i;

interface Extracted {
  data: Uint8Array;
  kind: 'tpwm' | 'raw' | 'FAILED';
  packed: number;
  /** Bytes of the packed block that the stream did not use. */
  slack: number;
}

const rows: (string | number)[][] = [];
const problems: string[] = [];

function* walk(directory: string): Generator<string> {
  for (const name of readdirSync(directory).sort()) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full);
    } else if (!SKIP_FILES.test(name)) {
      yield full;
    }
  }
}

/** Unpacks data[start..end) if it is TPWM, otherwise returns it as is. */
function extract(label: string, data: Uint8Array, start: number, end: number): Extracted {
  const packed = end - start;
  if (!isTpwm(data, start)) return { data: data.subarray(start, end), kind: 'raw', packed, slack: 0 };
  try {
    const unpacked = unpackTpwm(data, start, end);
    return { data: unpacked.data, kind: 'tpwm', packed, slack: packed - unpacked.used };
  } catch (error) {
    problems.push(`${label}: ${(error as Error).message}`);
    return { data: data.subarray(start, end), kind: 'FAILED', packed, slack: 0 };
  }
}

/** First bytes as printable text, for the manifest's "what is inside" column. */
function magic(data: Uint8Array): string {
  return [...data.subarray(0, 12)].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

function save(path: string, data: Uint8Array | string): void {
  const target = join(outDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

function record(path: string, extracted: Extracted): void {
  save(path, extracted.data);
  rows.push([path.split(sep).join('/'), extracted.kind, extracted.packed, extracted.data.length, extracted.slack, magic(extracted.data)]);
}

for (const file of walk(sourceDir)) {
  const path = relative(sourceDir, file);
  let data: Uint8Array = readFileSync(file);
  // Some archives are packed as a whole, others pack each entry separately.
  let whole: Extracted | null = null;
  if (isTpwm(data)) {
    whole = extract(path, data, 0, data.length);
    if (whole.kind === 'tpwm') data = whole.data;
  }
  const slots = isTpwm(data) ? null : readArchiveDirectory(data);
  if (!slots) {
    record(path, whole ?? extract(path, data, 0, data.length));
    continue;
  }
  // One folder per archive; the index prefix keeps directory order and keeps
  // apart entries that share a name.
  const width = String(slots.length - 1).length;
  slots.forEach((slot, i) => {
    const name = `${String(i).padStart(width, '0')}_${slot.name.replace(/[^\w.-]/g, '_')}`;
    record(join(path, name), extract(`${path}[${slot.name}]`, data, slot.offset, slot.end));
  });
}

const header = ['path', 'kind', 'packed', 'unpacked', 'slack', 'magic'];
save('manifest.tsv', [header, ...rows].map((row) => row.join('\t')).join('\n') + '\n');

const count = (kind: string) => rows.filter((row) => row[1] === kind).length;
console.log(`${rows.length} files written to ${outDir}`);
console.log(`  tpwm: ${count('tpwm')}  raw: ${count('raw')}  failed: ${count('FAILED')}`);
if (problems.length) {
  console.log('Problems:');
  for (const problem of problems) console.log(`  ${problem}`);
  process.exitCode = 1;
}

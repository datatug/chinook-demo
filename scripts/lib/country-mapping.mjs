// Value mapping from a dataset's own country values to the universal country
// concept of github.com/meaninggraph/core (CC0-1.0), at one pinned commit.
//
// A dataset stores a country as a name ("USA") or as a code or numeric id; the
// mapping says which universal country each stored value is, one row per value:
//
//   { "value": "USA", "code": "US", "concept": "meaning://github.com/meaninggraph/core/country?ref=<sha>" }
//
// This module holds the pure parts (matching, building, rendering, checking), so
// that tests run on fixtures with no network; build-country-mapping.mjs reads
// the real core and Chinook.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const coreRepo = 'github.com/meaninggraph/core';
export const coreUrl = 'https://github.com/meaninggraph/core';
export const conceptId = 'country';
export const commitPattern = /^[0-9a-f]{40}$/;

export const conceptRef = (pin) => `meaning://${coreRepo}/${conceptId}?ref=${pin}`;

// --- core, read from git objects at the pinned commit -----------------------

const git = (gitDir, ...args) => execFileSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

// A bare repository per pin under cacheDir, holding that one commit. The commit
// is immutable and git verifies every object against its id, so a cached copy is
// trusted without touching the network and files are read from the commit itself
// (git show <commit>:<file>), never from a working tree someone could have edited.
export function fetchCore(pin, { cacheDir, url = coreUrl, retries = 3 } = {}) {
  if (!commitPattern.test(pin)) throw new Error(`${pin} is not a full 40-character commit id (a branch or tag can move, so it cannot be a pin)`);
  const gitDir = join(cacheDir, `${pin}.git`);
  const have = () => { try { git(gitDir, 'cat-file', '-e', `${pin}^{commit}`); return true; } catch { return false; } };
  if (existsSync(gitDir) && have()) return gitDir;
  mkdirSync(cacheDir, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', gitDir], { stdio: 'ignore' });
  for (let attempt = 1; ; attempt++) {
    try { git(gitDir, 'fetch', '-q', '--depth', '1', url, pin); break; } catch (error) {
      if (attempt >= retries) throw new Error(`cannot fetch ${pin} from ${url}: ${String(error.stderr ?? error.message).trim()}`);
      execFileSync('sleep', [String(attempt)]);
    }
  }
  if (!have()) throw new Error(`${url} did not give commit ${pin}`);
  return gitDir;
}

// The `country` concept of the pinned commit: its values and the licence of the file.
export function readCountryConcept(gitDir, pin) {
  const files = git(gitDir, 'ls-tree', '--name-only', pin).split('\n').filter((name) => name.endsWith('.meaning.yaml'));
  const found = [];
  for (const file of files) {
    const doc = parseYaml(git(gitDir, 'show', `${pin}:${file}`));
    for (const concept of doc?.concepts ?? []) if (concept.id === conceptId) found.push({ file, licence: doc.license, concept });
  }
  if (found.length !== 1) throw new Error(`expected exactly one concept "${conceptId}" in ${coreRepo} at ${pin}, found ${found.length}`);
  return { file: found[0].file, licence: found[0].licence, values: found[0].concept.values ?? [] };
}

// --- matching ----------------------------------------------------------------

// The universal values a stored value names. `match` is "labels" (a label or
// alias in any language, ignoring case) or "codes.<code>" (that code of the
// value, exactly, as strings): the two modes meaninggraph/core's FORMAT.md
// defines for a binding. Returns { value, by } pairs; by is "label" or "alias"
// (or the code name).
export function matchValue(values, stored, match = 'labels') {
  if (match.startsWith('codes.')) {
    const code = match.slice('codes.'.length);
    return values.filter((value) => value.codes?.[code] === String(stored)).map((value) => ({ value, by: code }));
  }
  const key = String(stored).toLowerCase();
  const hits = [];
  for (const value of values) {
    const labels = Object.values(value.labels ?? {});
    const aliases = Object.values(value.aliases ?? {}).flat();
    if (labels.some((word) => word.toLowerCase() === key)) hits.push({ value, by: 'label' });
    else if (aliases.some((word) => word.toLowerCase() === key)) hits.push({ value, by: 'alias' });
  }
  return hits;
}

// --- building ----------------------------------------------------------------

export class MappingError extends Error {
  constructor(problems) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

const compare = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : a < b ? -1 : a > b ? 1 : 0);

// dataset: { id, title, covers: [{source, collection, column, values: [...]}], match, codeKey }
// core: { values, pin, file, licence }; the result is the mapping document.
// Every distinct stored value must name exactly one universal country; all
// problems are reported together.
export function buildMapping({ dataset, core, generator, from }) {
  const problems = [];
  const codeKey = dataset.codeKey ?? 'alpha2';
  const match = dataset.match ?? 'labels';
  const stored = new Map();
  for (const cover of dataset.covers) for (const value of cover.values) if (value !== null && value !== undefined) stored.set(value, [...(stored.get(value) ?? []), `${cover.collection}.${cover.column}`]);
  const types = new Set([...stored.keys()].map((value) => typeof value));
  if (types.size > 1) problems.push(`the stored values mix ${[...types].join(' and ')}; one column type per mapping`);
  const valueType = types.has('number') ? 'integer' : 'string';
  if (types.has('number') && [...stored.keys()].some((value) => !Number.isInteger(value))) problems.push('a numeric value is not an integer');

  const rows = [];
  for (const value of [...stored.keys()].sort(compare)) {
    const hits = matchValue(core.values, value, match);
    const where = `${JSON.stringify(value)} (${stored.get(value).join(', ')})`;
    if (hits.length === 0) { problems.push(`${where} matches no ${coreRepo} country by ${match}`); continue; }
    if (hits.length > 1) { problems.push(`${where} matches ${hits.length} countries by ${match}: ${hits.map((hit) => hit.value.id).join(', ')}`); continue; }
    const { value: country } = hits[0];
    const code = country.codes?.[codeKey];
    if (typeof code !== 'string') { problems.push(`${where}: country ${country.id} has no codes.${codeKey}`); continue; }
    if (codeKey === 'alpha2' && country.id !== code.toLowerCase()) problems.push(`${where}: country id "${country.id}" is not the lowercase alpha-2 code "${code}" that the geo collections are keyed by`);
    rows.push({ value, code, concept: conceptRef(core.pin) });
  }
  if (problems.length > 0) throw new MappingError(problems);

  return {
    id: dataset.id,
    title: dataset.title,
    type: 'value-mapping',
    concept: conceptRef(core.pin),
    codeSystem: { name: dataset.codeName ?? 'ISO 3166-1 alpha-2', key: codeKey, case: 'upper' },
    valueType,
    match,
    covers: dataset.covers.map(({ source, collection, column }) => ({ source, collection, column })),
    columns: [{ name: 'value', type: valueType }, { name: 'code', type: 'string' }, { name: 'concept', type: 'string' }],
    generated: {
      by: generator,
      note: 'Generated; never edit by hand. Regenerate with the command in "by"; CI fails when this file differs from what it gives.',
      from: [
        { repository: coreRepo, ref: core.pin, file: core.file, licence: core.licence },
        ...from,
      ],
    },
    licence: 'CC0-1.0',
    rows,
  };
}

// --- rendering and the derived alias records -----------------------------------

const flat = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => item === null || typeof item !== 'object');
const line = (object) => `{${Object.entries(object).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')}}`;

// JSON with a flat object on one line and an array of them one per line.
function pretty(value, indent = '') {
  const inner = `${indent}  `;
  if (flat(value)) return line(value);
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[\n${value.map((item) => `${inner}${pretty(item, inner)}`).join(',\n')}\n${indent}]`;
  if (value !== null && typeof value === 'object') return `{\n${Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`).join(',\n')}\n${indent}}`;
  return JSON.stringify(value);
}

// Stable text: the header and one row per line.
export const renderMapping = (mapping) => `${pretty(mapping)}\n`;

export const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The rows of the demo's country_aliases collection (inGitDB, one record per
// file): alias is the stored value, country the key of the geo `countries`
// record (the lowercase alpha-2 code). Only a mapping of names has aliases.
export function aliasRecords(mapping, mappingPath) {
  if (mapping.valueType !== 'string') throw new Error('only a mapping of names has aliases');
  if (mapping.codeSystem?.key !== 'alpha2') throw new Error('the geo collections are keyed by alpha-2 codes');
  const pin = /\?ref=([0-9a-f]{40})$/.exec(mapping.concept)?.[1] ?? '';
  const records = new Map();
  for (const row of mapping.rows) {
    const key = slug(row.value);
    if (!key) throw new Error(`value ${JSON.stringify(row.value)} has no usable record key`);
    if (records.has(key)) throw new Error(`values ${JSON.stringify(records.get(key).alias)} and ${JSON.stringify(row.value)} give the same record key "${key}"`);
    records.set(key, {
      alias: row.value,
      country: row.code.toLowerCase(),
      source: `generated from ${mappingPath} (${mapping.covers.map((c) => `${c.collection}.${c.column}`).join(', ')} mapped to ${coreRepo} ${conceptId} at ${pin.slice(0, 7)}); not hand-edited`,
    });
  }
  return records;
}

export const renderRecord = (record) => `${JSON.stringify(record, null, 2)}\n`;

// Problems with a committed mapping that need no network: its shape, one row
// per value, every row naming the header's concept. [] when it is consistent.
export function mappingProblems(mapping) {
  const problems = [];
  if (mapping?.type !== 'value-mapping') problems.push('type must be "value-mapping"');
  if (!/^meaning:\/\/github\.com\/meaninggraph\/core\/country\?ref=[0-9a-f]{40}$/.test(mapping?.concept ?? '')) problems.push('concept must be meaning://github.com/meaninggraph/core/country?ref=<40-character commit>');
  if (!Array.isArray(mapping?.rows) || mapping.rows.length === 0) return [...problems, 'rows must be a non-empty array'];
  const seen = new Set();
  for (const row of mapping.rows) {
    if (typeof row.value !== (mapping.valueType === 'integer' ? 'number' : 'string')) problems.push(`row ${JSON.stringify(row.value)}: value must be a ${mapping.valueType}`);
    if (seen.has(row.value)) problems.push(`value ${JSON.stringify(row.value)} appears in two rows`);
    seen.add(row.value);
    if (row.concept !== mapping.concept) problems.push(`row ${JSON.stringify(row.value)}: concept differs from the header's`);
    if (typeof row.code !== 'string' || row.code === '') problems.push(`row ${JSON.stringify(row.value)}: code must be a non-empty string`);
  }
  return problems;
}

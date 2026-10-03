#!/usr/bin/env node
// Generate, or check, the Chinook country value mapping and the country_aliases records.
//
//   node scripts/build-country-mapping.mjs                   write both
//   node scripts/build-country-mapping.mjs --core-ref <sha>  write both, moving the pin to that commit
//   node scripts/build-country-mapping.mjs --check           fail when either differs from what the
//                                                            sources give (CI runs this)
//   node scripts/build-country-mapping.mjs --check --offline fail when the committed files disagree
//                                                            with each other (no network)
//
// Reads the distinct country values of the pinned Chinook file (Customer.Country,
// Invoice.BillingCountry, Employee.Country; scripts/fetch-chinook.sh fetches it and checks its
// SHA-256) and the `country` concept of github.com/meaninggraph/core (CC0-1.0) at the commit
// pinned in mappings/chinook.country-values.json. Each value must name exactly one core country
// by label or alias, ignoring case; no match, or two, is an error that lists every such value.
//
// Writes mappings/chinook.country-values.json (the mapping, one row per Chinook value) and
// data/geo/country_aliases/$records/*.json (the join table the saved query reads, one record per
// value) and then data/geo/.web/*.json (scripts/build-web-geo.py). None is edited by hand.
//
// Needs Node.js 22.13 or newer (node:sqlite), git, bash and python3 (3.10+).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MappingError, aliasRecords, buildMapping, commitPattern, fetchCore, mappingProblems, readCountryConcept, renderMapping, renderRecord } from './lib/country-mapping.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mappingRel = 'mappings/chinook.country-values.json';
const mappingPath = join(root, mappingRel);
const aliasesDir = join(root, 'data/geo/country_aliases/$records');
const cacheDir = process.env.MEANING_CACHE_DIR ?? join(root, '.cache/meaning-sources');
const generator = 'node scripts/build-country-mapping.mjs';

// The dataset the mapping covers: where its country values are stored.
const chinook = {
  id: 'chinook-country-values',
  title: 'Chinook country names to ISO 3166-1 alpha-2 codes',
  match: 'labels',
  covers: [
    { source: 'chinook', collection: 'Customer', column: 'Country' },
    { source: 'chinook', collection: 'Invoice', column: 'BillingCountry' },
    { source: 'chinook', collection: 'Employee', column: 'Country' },
  ],
};

const usage = () => { console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(2); };

const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(name); if (at < 0) return false; args.splice(at, 1); return true; };
const option = (name) => { const at = args.indexOf(name); if (at < 0) return undefined; const [, value] = args.splice(at, 2); return value; };
const check = flag('--check');
const offline = flag('--offline');
const coreRefOption = option('--core-ref');
if (args.length > 0 || (offline && !check) || (check && coreRefOption)) usage();

const fail = (lines) => { console.error(`build-country-mapping: ${lines.join('\n  ')}`); process.exit(1); };
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const committed = existsSync(mappingPath) ? readJson(mappingPath) : null;

// The records on disk: file name -> text.
const recordFiles = () => (existsSync(aliasesDir) ? Object.fromEntries(readdirSync(aliasesDir).filter((n) => n.endsWith('.json')).sort().map((n) => [n, readFileSync(join(aliasesDir, n), 'utf8')])) : {});
const wantedRecordFiles = (mapping) => Object.fromEntries([...aliasRecords(mapping, mappingRel)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, record]) => [`${key}.json`, renderRecord(record)]));
const differences = (want, have, what) => {
  const out = [];
  for (const name of Object.keys(want)) if (!(name in have)) out.push(`${what}/${name} is missing`); else if (have[name] !== want[name]) out.push(`${what}/${name} differs from what the mapping gives`);
  for (const name of Object.keys(have)) if (!(name in want)) out.push(`${what}/${name} is not in the mapping`);
  return out;
};

if (check && offline) {
  if (!committed) fail([`${mappingRel} is missing`]);
  const problems = mappingProblems(committed);
  if (problems.length > 0) fail([`${mappingRel} is inconsistent:`, ...problems]);
  const out = [];
  if (renderMapping(committed) !== readFileSync(mappingPath, 'utf8')) out.push(`${mappingRel} is not in the form the generator writes`);
  out.push(...differences(wantedRecordFiles(committed), recordFiles(), 'data/geo/country_aliases/$records'));
  if (out.length > 0) fail([...out, `run: ${generator}`]);
  console.error(`build-country-mapping: ${mappingRel} and data/geo/country_aliases agree (offline check)`);
  process.exit(0);
}

const pin = coreRefOption ?? /\?ref=([0-9a-f]{40})$/.exec(committed?.concept ?? '')?.[1];
if (!pin) fail([`no pin: ${mappingRel} does not exist yet, pass --core-ref <40-character commit of ${'github.com/meaninggraph/core'}>`]);
if (!commitPattern.test(pin)) fail([`--core-ref must be a full 40-character commit id, got "${pin}"`]);

// The pinned Chinook file, SHA-256 checked by the fetch script (a verified copy is reused).
const chinookPin = readJson(join(root, 'fixtures/chinook/chinookdb.json'));
const sqlitePath = execFileSync(join(root, 'scripts/fetch-chinook.sh'), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').pop();
const db = new DatabaseSync(sqlitePath, { readOnly: true });
const dataset = { ...chinook, covers: chinook.covers.map((cover) => ({ ...cover, values: db.prepare(`SELECT DISTINCT "${cover.column}" AS v FROM "${cover.collection}" WHERE "${cover.column}" IS NOT NULL ORDER BY 1`).all().map((row) => row.v) })) };
db.close();

const gitDir = fetchCore(pin, { cacheDir });
const core = { ...readCountryConcept(gitDir, pin), pin };
let mapping;
try {
  mapping = buildMapping({
    dataset, core, generator,
    from: [{ dataset: 'chinook', file: 'chinook.sqlite', sha256: chinookPin.sqlite.sha256, upstream: `${chinookPin.upstream.repository}@${chinookPin.upstream.revision}` }],
  });
} catch (error) {
  if (!(error instanceof MappingError)) throw error;
  fail(['the Chinook country values do not map one-to-one onto github.com/meaninggraph/core countries:', ...error.problems]);
}

const mappingText = renderMapping(mapping);
const records = wantedRecordFiles(mapping);

if (check) {
  const out = [];
  if (!committed) out.push(`${mappingRel} is missing`);
  else if (readFileSync(mappingPath, 'utf8') !== mappingText) out.push(`${mappingRel} differs from what ${chinook.covers.length} Chinook columns and ${pin.slice(0, 7)} give`);
  out.push(...differences(records, recordFiles(), 'data/geo/country_aliases/$records'));
  if (out.length > 0) fail([...out, `run: ${generator}`, 'a hand edit of a generated file is overwritten; change the sources or the pin instead']);
  console.error(`build-country-mapping: ${mappingRel} and data/geo/country_aliases equal what meaninggraph/core ${pin.slice(0, 7)} and the pinned Chinook give (${mapping.rows.length} values)`);
  process.exit(0);
}

mkdirSync(dirname(mappingPath), { recursive: true });
writeFileSync(mappingPath, mappingText);
mkdirSync(aliasesDir, { recursive: true });
for (const name of Object.keys(recordFiles())) if (!(name in records)) rmSync(join(aliasesDir, name));
for (const [name, text] of Object.entries(records)) writeFileSync(join(aliasesDir, name), text);
console.error(`build-country-mapping: wrote ${mappingRel} and ${Object.keys(records).length} records in data/geo/country_aliases (meaninggraph/core ${pin.slice(0, 7)})`);
execFileSync('python3', [join(root, 'scripts/build-web-geo.py')], { stdio: 'inherit' });

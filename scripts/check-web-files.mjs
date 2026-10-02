#!/usr/bin/env node
// Checks the files a browser reads from this repository: the `web` environment and
// (once present) the prepared questions.
//
//   node scripts/check-web-files.mjs [--fetch=none|mirror|live]
//
// Always (no data downloaded):
//   * every file below is valid against its JSON Schema, fetched from datatug/datatug-apps
//     AT A PINNED COMMIT (a tag can be moved), with a standard validator (ajv, JSON Schema 2020-12);
//   * what a schema cannot state: the catalog's addresses begin with one of the app's own
//     prefixes (design 3.6), every keyed table has a checksum, the catalog and
//     fixtures/chinook/chinookdb.json name the same upstream revision, the environment lists the
//     catalogs it should, a prepared question's `query` is a saved query that exists, ids are unique;
//   * every file a cold demo run reads exists (design 4.3).
//
//   --fetch=mirror  also downloads the Invoice rows from the catalog's fallback address (the pinned
//                   jsDelivr commit: immutable, so this cannot fail because chinookdb.com changed)
//                   and checks the SHA-256 and the numbers.
//   --fetch=live    downloads from BOTH addresses in the catalog (chinookdb.com and the mirror) and
//                   the SQLite file from both addresses in fixtures/chinook/chinookdb.json, and checks
//                   every SHA-256 and the numbers. This is what the daily live-sources job runs.
//
// The numbers: summing the downloaded Invoice rows' Total by BillingCountry must give the golden
// result's totalSales (rounded to two decimals) for all 24 countries, from 412 invoices: the web
// path reads the same Chinook the CLI does.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The schemas live in datatug/datatug-apps, pinned by commit (task G-K1).
const SCHEMAS_COMMIT = '321c9f24147b811396b6cc38a599e5dc6e88d239';
const SCHEMA_BASE = `https://raw.githubusercontent.com/datatug/datatug-apps/${SCHEMAS_COMMIT}/libs/datatug/main/src/lib/project-files/schemas/`;

// The only addresses a trusted project may read data from (design 3.6): a prefix of the whole
// address, never a host alone.
const ALLOWED_PREFIXES = [
  /^https:\/\/chinookdb\.com\/data\//,
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/datatug\/chinookdb@[0-9a-f]{40}\//,
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fetchMode = (process.argv.find((a) => a.startsWith('--fetch=')) ?? '--fetch=none').slice('--fetch='.length);
if (!['none', 'mirror', 'live'].includes(fetchMode)) {
  console.error('usage: node scripts/check-web-files.mjs [--fetch=none|mirror|live]');
  process.exit(2);
}

const problems = [];
const fail = (message) => problems.push(message);
const read = (path) => readFileSync(join(root, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url, attempts = 3) {
  let last;
  for (let n = 1; n <= attempts; n++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      last = error;
      if (n < attempts) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

// ajv is installed by `npm ci --prefix scripts` (a lock file pins it).
let Ajv2020;
try {
  ({ default: Ajv2020 } = await import('ajv/dist/2020.js'));
} catch {
  console.error('check-web-files: ajv is not installed; run `npm ci --prefix scripts` first');
  process.exit(2);
}

async function validateAgainstSchema(path, schemaName) {
  const schema = JSON.parse((await download(SCHEMA_BASE + schemaName + '.schema.json')).toString('utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const document = readJson(path);
  if (!validate(document)) {
    for (const e of validate.errors) fail(`${path}: ${e.instancePath || '/'} ${e.message}`);
  }
  return document;
}

// ---- the web environment ------------------------------------------------------------------
const env = readJson('web/web.env.json');
const servers = Object.fromEntries((env.dbServers ?? []).map((s) => [s.driver, s.catalogs]));
if (env.id !== 'web') fail(`web/web.env.json: id is ${JSON.stringify(env.id)}, expected "web"`);
if (JSON.stringify(servers['https-json']) !== '["chinook"]') fail('web/web.env.json: the https-json server must list exactly the catalog "chinook"');
if (JSON.stringify(servers['ingitdb']) !== '["geo"]') fail('web/web.env.json: the ingitdb server must list exactly the catalog "geo"');

const geo = readJson('web/catalogs/geo/geo.db.json');
const localGeo = readJson('environments/local/catalogs/geo/geo.db.json');
if (JSON.stringify(geo) !== JSON.stringify(localGeo)) fail('web/catalogs/geo/geo.db.json must be identical to the local environment\'s geo catalog');

const catalog = await validateAgainstSchema('web/catalogs/chinook/chinook.db.json', 'https-json-catalog');
const pin = readJson('fixtures/chinook/chinookdb.json');
if (catalog.upstream?.revision !== pin.upstream.revision) fail(`the catalog's upstream revision ${catalog.upstream?.revision} is not the pin's ${pin.upstream.revision}`);
if (catalog.fallbackUrlTemplate) {
  for (const table of Object.keys(catalog.keys ?? {})) {
    if (!catalog.sha256?.[table]) fail(`the catalog gives a fallback address, so table ${table} needs a sha256`);
  }
}
for (const field of ['urlTemplate', 'fallbackUrlTemplate']) {
  const template = catalog[field];
  if (template !== undefined && !ALLOWED_PREFIXES.some((p) => p.test(template))) fail(`catalog ${field} ${template} does not begin with one of the app's own address prefixes`);
}
const tableUrl = (template, table) => template.replace('{table}', table);

// ---- prepared questions (the file arrives with task G-R3) -------------------------------------
if (existsSync(join(root, 'ai/prepared-questions.json'))) {
  const questions = await validateAgainstSchema('ai/prepared-questions.json', 'prepared-questions');
  const ids = new Set();
  for (const q of questions.questions ?? []) {
    if (ids.has(q.id)) fail(`ai/prepared-questions.json: duplicate question id ${q.id}`);
    ids.add(q.id);
    if (!existsSync(join(root, 'queries', `${q.query}.query.json`))) fail(`ai/prepared-questions.json: question ${q.id} names the saved query ${q.query}, which does not exist`);
  }
}

// ---- every file a cold demo run reads (design 4.3) -------------------------------------------
const tables = ['Album', 'Artist', 'Customer', 'Employee', 'Genre', 'Invoice', 'InvoiceLine', 'MediaType', 'Playlist', 'PlaylistTrack', 'Track'];
const required = [
  'datatug-project.json',
  'queries/sales/chinook-sales-per-capita.query.json',
  'queries/sales/chinook-sales-per-capita.query.dtql',
  'web/web.env.json',
  'web/catalogs/chinook/chinook.db.json',
  'web/catalogs/geo/geo.db.json',
  ...tables.map((t) => `dbmodels/chinook/main/tables/${t}/main.${t}.columns.json`),
  'entities/Country/Country.entity.json',
  'golden/sales-per-capita.json',
];
for (const path of required) if (!existsSync(join(root, path))) fail(`missing: ${path}`);

// ---- downloads -------------------------------------------------------------------------------
const golden = readJson('golden/sales-per-capita.json');

function checkNumbers(label, bytes) {
  let rows;
  try {
    rows = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(`${label}: not JSON (${error.message})`);
    return;
  }
  if (rows.length !== golden.invoices) fail(`${label}: ${rows.length} invoices, golden has ${golden.invoices}`);
  const totals = new Map();
  for (const row of rows) totals.set(row.BillingCountry, (totals.get(row.BillingCountry) ?? 0) + row.Total);
  if (totals.size !== golden.rows.length) fail(`${label}: ${totals.size} billing countries, golden has ${golden.rows.length}`);
  for (const g of golden.rows) {
    const total = totals.get(g.country);
    if (total === undefined || total.toFixed(2) !== g.totalSales.toFixed(2)) fail(`${label}: ${g.country} totals ${total?.toFixed(2)}, golden has ${g.totalSales.toFixed(2)}`);
  }
}

async function checkInvoiceRows(label, template) {
  const url = tableUrl(template, 'Invoice');
  let bytes;
  try {
    bytes = await download(url);
  } catch (error) {
    fail(`${label}: ${error.message}`);
    return;
  }
  const got = sha256(bytes);
  if (got !== catalog.sha256.Invoice) fail(`${label}: ${url} has SHA-256 ${got}, the catalog says ${catalog.sha256.Invoice}`);
  else checkNumbers(label, bytes);
  console.log(`check-web-files: ${label}: ${url} ${bytes.length} bytes, SHA-256 ${got === catalog.sha256.Invoice ? 'equals the catalog' : 'DIFFERS'}`);
}

async function checkSqlite(label, url) {
  let bytes;
  try {
    bytes = await download(url);
  } catch (error) {
    fail(`${label}: ${error.message}`);
    return;
  }
  const got = sha256(bytes);
  if (got !== pin.sqlite.sha256) fail(`${label}: ${url} has SHA-256 ${got}, the pin says ${pin.sqlite.sha256}`);
  console.log(`check-web-files: ${label}: ${url} ${bytes.length} bytes, SHA-256 ${got === pin.sqlite.sha256 ? 'equals the pin' : 'DIFFERS'}`);
}

if (fetchMode === 'mirror' || fetchMode === 'live') {
  if (!catalog.fallbackUrlTemplate) fail('the catalog has no fallbackUrlTemplate to check');
  else await checkInvoiceRows('mirror', catalog.fallbackUrlTemplate);
}
if (fetchMode === 'live') {
  await checkInvoiceRows('chinookdb.com', catalog.urlTemplate);
  await checkSqlite('chinookdb.com sqlite', pin.sqlite.url);
  await checkSqlite('mirror sqlite', pin.sqlite.mirrorUrl);
}

if (problems.length > 0) {
  console.error(`check-web-files: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-web-files: ok (--fetch=${fetchMode})`);

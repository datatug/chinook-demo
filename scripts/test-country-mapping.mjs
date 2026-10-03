// Tests of scripts/lib/country-mapping.mjs on small fixtures: no network, no Chinook file.
// Run with: node --test scripts/test-country-mapping.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MappingError, aliasRecords, buildMapping, conceptRef, fetchCore, mappingProblems, matchValue, readCountryConcept, renderMapping, renderRecord, slug } from './lib/country-mapping.mjs';

const pin = 'a'.repeat(40);

// A starter country list shaped like meaninggraph/core's: values keyed by the lowercase alpha-2 code.
const values = [
  { id: 'ie', labels: { en: 'Ireland', ru: 'Ирландия' }, codes: { alpha2: 'IE', alpha3: 'IRL', numeric: '372' } },
  { id: 'cz', labels: { en: 'Czechia' }, aliases: { en: ['Czech Republic'] }, codes: { alpha2: 'CZ', alpha3: 'CZE', numeric: '203' } },
  { id: 'us', labels: { en: 'United States' }, aliases: { en: ['USA', 'US'] }, codes: { alpha2: 'US', alpha3: 'USA', numeric: '840' } },
  { id: 'ar', labels: { en: 'Argentina' }, codes: { alpha2: 'AR', alpha3: 'ARG', numeric: '032' } },
];
const core = { values, pin, file: 'geo.meaning.yaml', licence: 'CC0-1.0' };
const names = (columnValues) => ({ id: 'names', title: 'Names', covers: [{ source: 'shop', collection: 'Order', column: 'Country', values: columnValues }] });
const build = (dataset) => buildMapping({ dataset, core, generator: 'test', from: [] });
const problems = (dataset) => { try { build(dataset); } catch (error) { assert.ok(error instanceof MappingError); return error.problems; } return assert.fail('expected the mapping to fail'); };

test('names map by label or alias, ignoring case, one row per value, sorted', () => {
  const mapping = build(names(['USA', 'ireland', 'Czech Republic', 'Ireland']));
  assert.deepEqual(mapping.rows.map(({ value, code }) => [value, code]), [['Czech Republic', 'CZ'], ['Ireland', 'IE'], ['USA', 'US'], ['ireland', 'IE']]);
  assert.ok(mapping.rows.every((row) => row.concept === conceptRef(pin)));
  assert.equal(mapping.concept, conceptRef(pin));
  assert.equal(mapping.valueType, 'string');
  assert.deepEqual(mappingProblems(mapping), []);
});

test('a value that matches no country fails, and every such value is reported', () => {
  const found = problems(names(['Ireland', 'Atlantis', 'Narnia']));
  assert.equal(found.length, 2);
  assert.match(found[0], /"Atlantis" \(Order\.Country\) matches no github\.com\/meaninggraph\/core country by labels/);
  assert.match(found[1], /"Narnia"/);
});

test('a value that matches two countries fails', () => {
  const ambiguous = { ...core, values: [...values, { id: 'xx', labels: { en: 'Elsewhere' }, aliases: { en: ['usa'] }, codes: { alpha2: 'XX' } }] };
  assert.throws(() => buildMapping({ dataset: names(['USA']), core: ambiguous, generator: 'test', from: [] }), (error) => error instanceof MappingError && /"USA" \(Order\.Country\) matches 2 countries by labels: us, xx/.test(error.message));
});

test('a country whose id is not its lowercase alpha-2 code is refused: the geo collections are keyed by it', () => {
  const odd = { ...core, values: [{ id: 'usa', labels: { en: 'United States' }, codes: { alpha2: 'US' } }] };
  assert.throws(() => buildMapping({ dataset: names(['United States']), core: odd, generator: 'test', from: [] }), /not the lowercase alpha-2 code/);
});

// Another database stores a numeric CountryId: the same format, with integer values.
test('numeric ids map by their numeric code and keep the same row shape', () => {
  const mapping = build({ id: 'ids', title: 'Ids', match: 'codes.numeric', covers: [{ source: 'erp', collection: 'Customer', column: 'CountryId', values: [840, 372] }] });
  assert.equal(mapping.valueType, 'integer');
  assert.deepEqual(mapping.columns[0], { name: 'value', type: 'integer' });
  assert.deepEqual(mapping.rows.map(({ value, code }) => [value, code]), [[372, 'IE'], [840, 'US']]);
  assert.deepEqual(Object.keys(mapping.rows[0]), ['value', 'code', 'concept']);
  assert.deepEqual(mappingProblems(mapping), []);
  assert.throws(() => aliasRecords(mapping, 'x.json'), /only a mapping of names has aliases/);
  assert.match(problems({ id: 'ids', title: 'Ids', match: 'codes.numeric', covers: [{ source: 'erp', collection: 'Customer', column: 'CountryId', values: [372, 999] }] }).join(), /999 \(Customer\.CountryId\) matches no .* by codes\.numeric/);
});

test('codes compare exactly as strings, so a code with a leading zero needs a string value', () => {
  assert.equal(matchValue(values, '032', 'codes.numeric').length, 1);
  assert.equal(matchValue(values, 32, 'codes.numeric').length, 0);
  assert.equal(matchValue(values, 'IRL', 'codes.alpha3')[0].value.id, 'ie');
  assert.equal(matchValue(values, 'irl', 'codes.alpha3').length, 0);
});

test('values of one dataset may not mix strings and numbers', () => {
  assert.match(problems(names(['Ireland', 372])).join(), /mix string and number/);
});

test('the mapping text is stable and the alias records follow from it alone', () => {
  const mapping = build(names(['USA', 'Czech Republic']));
  const text = renderMapping(mapping);
  assert.equal(renderMapping(JSON.parse(text)), text, 'rendering a parsed mapping gives the same text');
  assert.ok(text.endsWith('}\n'));
  const records = aliasRecords(mapping, 'mappings/x.json');
  assert.deepEqual([...records.keys()], ['czech-republic', 'usa']);
  assert.deepEqual(records.get('usa'), { alias: 'USA', country: 'us', source: records.get('usa').source });
  assert.match(records.get('usa').source, /^generated from mappings\/x\.json \(Order\.Country mapped to github\.com\/meaninggraph\/core country at aaaaaaa\)/);
  assert.equal(renderRecord(records.get('usa')), `${JSON.stringify(records.get('usa'), null, 2)}\n`);
  assert.equal(slug('Czech Republic'), 'czech-republic');
  assert.throws(() => aliasRecords({ ...mapping, rows: [{ ...mapping.rows[0], value: 'A B' }, { ...mapping.rows[1], value: 'a-b' }] }, 'x'), /same record key "a-b"/);
});

test('the offline checks catch a hand-edited mapping', () => {
  const mapping = build(names(['USA', 'Ireland']));
  assert.deepEqual(mappingProblems(mapping), []);
  const edited = structuredClone(mapping);
  edited.rows[0].concept = conceptRef('b'.repeat(40));
  assert.match(mappingProblems(edited).join(), /concept differs from the header's/);
  const twice = structuredClone(mapping);
  twice.rows.push({ ...twice.rows[0] });
  assert.match(mappingProblems(twice).join(), /appears in two rows/);
  assert.match(mappingProblems({ ...mapping, concept: 'meaning://github.com/meaninggraph/core/country' }).join(), /concept must be/);
});

// The commit is fetched by its id into a bare repository, and read from git objects.
const dir = mkdtempSync(join(tmpdir(), 'country-mapping-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('core is fetched at a commit, read from that commit and cached under its id', () => {
  const origin = join(dir, 'origin');
  mkdirSync(origin);
  const git = (...args) => execFileSync('git', ['-C', origin, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  const yaml = (extra) => `format: meaning/draft-1\nid: geo\nlicense: CC0-1.0\nconcepts:\n  - id: country\n    kind: entity\n    values:\n      - id: ie\n        labels: {en: Ireland}\n        codes: {alpha2: IE}${extra}\n`;
  writeFileSync(join(origin, 'geo.meaning.yaml'), yaml(''));
  git('add', '.'); git('commit', '-q', '-m', 'one');
  const first = git('rev-parse', 'HEAD');
  writeFileSync(join(origin, 'geo.meaning.yaml'), yaml('\n      - id: us\n        labels: {en: United States}\n        codes: {alpha2: US}'));
  git('commit', '-q', '-am', 'two');
  const cacheDir = join(dir, 'cache');
  const gitDir = fetchCore(first, { cacheDir, url: origin, retries: 1 });
  const read = readCountryConcept(gitDir, first);
  assert.deepEqual(read.values.map((v) => v.id), ['ie'], 'the first commit, not the branch tip');
  assert.equal(read.licence, 'CC0-1.0');
  assert.equal(read.file, 'geo.meaning.yaml');
  rmSync(origin, { recursive: true, force: true });
  assert.equal(fetchCore(first, { cacheDir, url: origin, retries: 1 }), gitDir, 'a cached commit needs no network');
  assert.throws(() => fetchCore('main', { cacheDir }), /not a full 40-character commit id/);
  assert.throws(() => fetchCore('c'.repeat(40), { cacheDir, url: join(dir, 'nowhere'), retries: 1 }), /cannot fetch/);
});

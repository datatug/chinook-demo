# Chinook demo: historical example

The maintained DataTug demo is [datatug/datatug-demo-project](https://github.com/datatug/datatug-demo-project/tree/main/demo-project-1), containing all six DemoDB datasets and their storage editions. Use that single project for current demo connections. This repository retains the earlier Chinook hero-query example and its recorded provenance.

## Historical example

A demo [DataTug](https://datatug.app) project, and the repository is the project: its root
holds `datatug-project.json`, the saved queries, the entities, the access policies and the
data they read.

It is built around one question, answered with no AI and no network at query time:

> Which countries buy the most music relative to their population?

The saved query `sales/chinook-sales-per-capita` joins Chinook invoices to a country alias
table (generated from a [value mapping](mappings) onto the universal country list of
[`meaninggraph/core`](https://github.com/meaninggraph/core)), then to World Bank population, and returns sales per million people for the 24
countries in Chinook. Ireland comes first (8.32 per million); the USA is 17th (1.53).

## Open it

**In the web app.** The project lives at this address:

```
https://datatug.app/project/github.com/datatug/chinook-demo
```

That address is the plan, not a working page today: the web app does not open projects
from it yet, and nothing in this repository claims a live web demo. When it ships it will
read the project files straight from this repository.

**With the CLI.** Needs the [`datatug` CLI](https://github.com/datatug/datatug-cli) (0.55.0 or newer),
`bash`, `python3` (3.10 or newer) and `curl`.

```sh
git clone https://github.com/datatug/chinook-demo && cd chinook-demo

datatug validate -d=.      # check the project files
scripts/run-hero-demo.sh   # run the saved query end to end, print the top 10
go -C tests test ./...     # the repository's own tests
```

`scripts/run-hero-demo.sh` fetches the Chinook file from chinookdb.com and checks its SHA-256,
runs the saved query with the DataTug CLI, prints the result and checks it against
[`golden/sales-per-capita.json`](golden/sales-per-capita.json) (24 countries; Ireland first at 8.32,
Czech Republic 8.29, Finland 7.37, USA 17th at 1.53; 412 invoices read).
[docs/hero-demo.md](docs/hero-demo.md) explains each step, what is verified and what is not.

You can also use this repository as a starting point for your own project: the layout is
the standard DataTug project layout, and everything in it is licensed as stated below.

## What data it uses, and from where

| Data | Where it comes from | In this repository? |
|---|---|---|
| Chinook rows (invoices, customers, tracks) | [chinookdb.com](https://chinookdb.com), an independent hosted copy of [lerocha/chinook-database](https://github.com/lerocha/chinook-database) (revision `7f67772`). The SQLite file `https://chinookdb.com/data/chinook.sqlite` is fetched by `scripts/fetch-chinook.sh` and its SHA-256 is checked against [`fixtures/chinook/chinookdb.json`](fixtures/chinook/chinookdb.json); if chinookdb.com does not answer, a pinned mirror (the public `datatug/chinookdb` repository on jsDelivr) is used, with the same check. A browser would read per-table JSON from the same site: see [`web/`](web). | No. Only the schema is here ([`dbmodels/chinook`](dbmodels/chinook)). |
| Country population | World Bank, indicator SP.POP.TOTL, via [ingitdb/geo-ingitdb](https://github.com/ingitdb/geo-ingitdb) | Yes, a modified snapshot in [`data/geo`](data/geo) |
| Country names and ISO codes | GeoNames, via the same geo-ingitdb copy | Yes, in [`data/geo`](data/geo) |
| Which universal country each Chinook country value is (the 24 spellings Chinook uses) | [`meaninggraph/core`](https://github.com/meaninggraph/core) (CC0) at the commit pinned in [`mappings/chinook.country-values.json`](mappings/chinook.country-values.json), matched to Chinook's own values by label or alias; generated, see [Country codes](#country-codes) | Yes: the mapping in [`mappings`](mappings) and the join table generated from it, `data/geo/country_aliases` |
| Support notes, orders and other small fixtures | Invented for this demo | Yes, in [`data`](data) and [`fixtures`](fixtures) |
| Two recorded HTTP responses (country currency, exchange rate) | Public keyless APIs, recorded so the demo works offline | Yes, in [`fixtures/http`](fixtures/http) |

The Chinook in chinookdb.com is a later revision than the one the previous repository
pinned: the 412 invoices carry 2021 dates where the old file had 2009, and two tracks differ
in one text field. The hero query does not read dates, so its result did not change.

Attribution and licences of the third-party data are in [NOTICE.md](NOTICE.md).

## Layout

| Path | What |
|---|---|
| `datatug-project.json` | the project (id `datatug-demo-project`), its boards, models and environments |
| `queries/` | saved queries, including `sales/chinook-sales-per-capita` |
| `entities/`, `dbmodels/`, `boards/`, `policies/`, `recordsets/`, `datasources/` | the project's definitions |
| `mappings/` | value mappings from a dataset's own values to universal concepts: `chinook.country-values.json` maps Chinook's country names to ISO 3166-1 alpha-2 codes (generated; see [Country codes](#country-codes)) |
| `environments/` | where each database is read from (`local` is the one the scripts use). The local environment also declares the hypothetical affiliations JSON source for the normal project catalog picker. |
| `web/` | the older browser hero-query environment: `web/web.env.json` and one catalog per database (Chinook as JSON from chinookdb.com with checksums and a mirror, geo as the inGitDB folder). It remains separate from the project's listed environments. |
| `golden/` | the expected result of the hero query, with what it was computed from |
| `data/` | the geo snapshot (`data/geo`, with `data/geo/.web/`: each geo table the hero query joins as one generated file, for the browser), support notes and recordsets |
| `ai/` | `prepared-questions.json`: the wordings (English, Russian) of each prepared question and the saved query that answers it |
| `fixtures/` | the Chinook pin (`fixtures/chinook/chinookdb.json`) and recorded inputs the tests use |
| `scripts/` | the hero script, the Chinook fetch and preparation, the golden comparison, the check of the `web/` files, the geo sync and the country mapping generator |
| `tests/` | Go tests that load and run the project |
| `.github/workflows/` | CI: `hero` and `web-files` on every pull request, `live-sources` daily (see below) |

The [`affiliations` catalog](environments/local/catalogs/affiliations/affiliations.db.json)
describes a pinned, hypothetical public user source. Its table and field mapping does not
admit a public lookup target or make the saved hero query use these rows.

## Country codes

Chinook has no country ids: it stores names (`Customer.Country`, `Invoice.BillingCountry`,
`Employee.Country`; 24 distinct values such as "USA" and "Czech Republic"). Which country each name
is comes from [`meaninggraph/core`](https://github.com/meaninggraph/core), the universal concepts
repository, at one pinned commit (`cb97dbcd9e951b00e7d46cb2e0c4e120c24c8db7`, the same commit that
[`datatug/chinookdb`](https://github.com/datatug/chinookdb) pins), not from a list kept by hand:

1. [`mappings/chinook.country-values.json`](mappings/chinook.country-values.json) holds one row per
   Chinook value, `{"value": "USA", "code": "US", "concept": "meaning://github.com/meaninggraph/core/country?ref=<commit>"}`,
   with a header naming the fields it covers, the pin and how it was generated. `code` is the
   ISO 3166-1 **alpha-2** code, the key of core's country values and of the geo data below. The format
   also takes numeric ids; see [`mappings/README.md`](mappings/README.md).
2. [`data/geo/country_aliases`](data/geo/country_aliases) (the table the saved query joins, one record
   per value) is generated from that file, so there are no hand-maintained alias records.
   The join and the result are the same as before: [`golden/sales-per-capita.json`](golden/sales-per-capita.json)
   did not change.

[`scripts/build-country-mapping.mjs`](scripts/build-country-mapping.mjs) generates both. It reads the
distinct country values of the pinned Chinook file (fetched and SHA-256 checked by
`scripts/fetch-chinook.sh`) and the `country` concept of core at the pinned commit (a shallow
`git fetch` of that commit into `.cache/meaning-sources/`, git-ignored, reused afterwards). Every
value must name exactly one core country by label or alias, ignoring case: a value that matches
none, or more than one, fails the run and is listed.

```sh
npm ci --prefix scripts --ignore-scripts                 # once: the YAML parser
node scripts/build-country-mapping.mjs                   # regenerate the mapping, country_aliases and data/geo/.web
node scripts/build-country-mapping.mjs --core-ref <sha>  # the same, moving the pin to another core commit
node scripts/build-country-mapping.mjs --check           # fail if any of them differs from what the sources give
node --test scripts/test-country-mapping.mjs             # the generator's tests (fixtures, no network)
```

Needs Node.js 22.13 or newer (it reads the Chinook file with `node:sqlite`), `git`, `bash` and
`python3`. The drift check (`--check`) runs in CI in the job `Vendored geo data and scripts`; it fails on a
hand edit of the mapping or of a `country_aliases` record, and on a mapping that no longer
matches core at its pin. `--check --offline` compares the committed files with each other only.

Licence: core is CC0-1.0 and the mapping holds only country names, codes and the core address, so it
is released under [CC0 1.0](LICENSE) like the project's other files (the header says so). The
population and the country names and codes in `data/geo` keep the licences in [NOTICE.md](NOTICE.md).

## History

This repository was made from the `demo-project-1` folder of
[`datatug/datatug-demo-projects`](https://github.com/datatug/datatug-demo-projects), with
that folder's history (including its earlier life as the `datatug` folder). The older
repository is unchanged.

## CI

| Job | When | What it proves |
|---|---|---|
| `hero` | pull request, push | downloads `chinookdb.com/data/chinook.sqlite`, checks its SHA-256, runs the saved query with the Go tests and with the released DataTug CLI, and compares the rows with `golden/sales-per-capita.json` |
| `web-files` | pull request, push | the files in `web/` and `ai/prepared-questions.json` are valid against their JSON Schemas (taken from `datatug/datatug-apps` at a pinned commit), the catalog's checksum equals the Invoice file on the pinned mirror and its numbers equal the golden result, the one-file geo tables in `data/geo/.web` equal the records they are generated from, and every file a cold run reads exists |
| `Vendored geo data and scripts` | pull request, push | `data/geo` equals geo-ingitdb at the recorded commit (`country_aliases` aside, it is generated) and is a valid inGitDB database; the scripts pass shellcheck; the country mapping tests pass and `mappings/chinook.country-values.json` and `data/geo/country_aliases` equal what the pinned Chinook file and `meaninggraph/core` at the pinned commit give |
| `live-sources` ([its own workflow](.github/workflows/live-sources.yml)) | daily | the same checks against the live chinookdb.com and the mirror; a failure on the schedule opens an issue. Never part of a pull request's checks, so a third-party outage cannot block a change |

## Licence

The project files (queries, mappings, models, scripts, tests) are released under
[CC0 1.0 Universal](LICENSE). Third-party data and schema keep their own licences: see
[NOTICE.md](NOTICE.md).

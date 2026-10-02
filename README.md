# chinook-demo

A demo [DataTug](https://datatug.app) project, and the repository is the project: its root
holds `datatug-project.json`, the saved queries, the entities, the access policies and the
data they read.

It is built around one question, answered with no AI and no network at query time:

> Which countries buy the most music relative to their population?

The saved query `sales/chinook-sales-per-capita` joins Chinook invoices to a country alias
table, then to World Bank population, and returns sales per million people for the 24
countries in Chinook. Ireland comes first (8.32 per million); the USA is 17th (1.53).

## Open it

**In the web app.** The project lives at this address:

```
https://datatug.app/project/github.com/datatug/chinook-demo
```

That address is the plan, not a working page today: the web app does not open projects
from it yet, and nothing in this repository claims a live web demo. When it ships it will
read the project files straight from this repository.

**With the CLI.** Needs the [`datatug` CLI](https://github.com/datatug/datatug-cli) (0.51.0 or newer),
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
| Country aliases (the 24 spellings Chinook uses) | Written and hand-checked for this project | Yes, in [`data/geo`](data/geo) |
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
| `environments/` | where each database is read from (`local` is the one the scripts use) |
| `web/` | where a browser would read each database from: `web/web.env.json` and one catalog per database (Chinook as JSON from chinookdb.com with checksums and a mirror, geo as the inGitDB folder). It is at the root, not under `environments/`, because the released `datatug` CLI refuses an environment whose server driver is `https-json` or `ingitdb` |
| `golden/` | the expected result of the hero query, with what it was computed from |
| `data/` | the geo snapshot, support notes and recordsets |
| `fixtures/` | the Chinook pin (`fixtures/chinook/chinookdb.json`) and recorded inputs the tests use |
| `scripts/` | the hero script, the Chinook fetch and preparation, the golden comparison, the check of the `web/` files and the geo sync |
| `tests/` | Go tests that load and run the project |
| `.github/workflows/` | CI: `hero` and `web-files` on every pull request, `live-sources` daily (see below) |

## History

This repository was made from the `demo-project-1` folder of
[`datatug/datatug-demo-projects`](https://github.com/datatug/datatug-demo-projects), with
that folder's history (including its earlier life as the `datatug` folder). The older
repository is unchanged.

## CI

| Job | When | What it proves |
|---|---|---|
| `hero` | pull request, push | downloads `chinookdb.com/data/chinook.sqlite`, checks its SHA-256, runs the saved query with the Go tests and with the released DataTug CLI, and compares the rows with `golden/sales-per-capita.json` |
| `web-files` | pull request, push | the files in `web/` are valid against the JSON Schema of the `https-json` catalog (taken from `datatug/datatug-apps` at a pinned commit), the catalog's checksum equals the Invoice file on the pinned mirror and its numbers equal the golden result, and every file a cold run reads exists |
| `live-sources` ([its own workflow](.github/workflows/live-sources.yml)) | daily | the same checks against the live chinookdb.com and the mirror; a failure on the schedule opens an issue. Never part of a pull request's checks, so a third-party outage cannot block a change |

## Licence

The project files (queries, mappings, models, scripts, tests) are released under
[CC0 1.0 Universal](LICENSE). Third-party data and schema keep their own licences: see
[NOTICE.md](NOTICE.md).

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

**With the CLI.** Needs the [`datatug` CLI](https://github.com/datatug/datatug-cli) (0.51.0 or newer), `ovdb`
(0.19.0 or newer), `bash`, `python3` (3.10 or newer), `curl` and `git`.

```sh
git clone https://github.com/datatug/chinook-demo && cd chinook-demo

datatug validate -d=.      # check the project files
scripts/run-hero-demo.sh   # run the saved query end to end, print the top 10
go -C tests test ./...     # the repository's own tests
```

`scripts/run-hero-demo.sh` fetches the pinned Chinook file, runs the saved query with the
DataTug CLI and prints the result. [docs/hero-demo.md](docs/hero-demo.md) explains each step,
what is verified and what is not.

You can also use this repository as a starting point for your own project: the layout is
the standard DataTug project layout, and everything in it is licensed as stated below.

## What data it uses, and from where

| Data | Where it comes from | In this repository? |
|---|---|---|
| Chinook rows (invoices, customers, tracks) | Today: the revision pinned in [`fixtures/chinook/phase1-acceptance.json`](fixtures/chinook/phase1-acceptance.json) of `datatug/chinook-database` (a fork of [lerocha/chinook-database](https://github.com/lerocha/chinook-database)), SHA-256 checked by the scripts and by CI. Planned: the Chinook file published at chinookdb.com. | No. Only the schema is here ([`dbmodels/chinook`](dbmodels/chinook)). |
| Country population | World Bank, indicator SP.POP.TOTL, via [ingitdb/geo-ingitdb](https://github.com/ingitdb/geo-ingitdb) | Yes, a modified snapshot in [`data/geo`](data/geo) |
| Country names and ISO codes | GeoNames, via the same geo-ingitdb copy | Yes, in [`data/geo`](data/geo) |
| Country aliases (the 24 spellings Chinook uses) | Written and hand-checked for this project | Yes, in [`data/geo`](data/geo) |
| Support notes, orders and other small fixtures | Invented for this demo | Yes, in [`data`](data) and [`fixtures`](fixtures) |
| Two recorded HTTP responses (country currency, exchange rate) | Public keyless APIs, recorded so the demo works offline | Yes, in [`fixtures/http`](fixtures/http) |

The Chinook rows currently come from the pinned source the previous repository used, and
will move to chinookdb.com in a follow-up change. This README will say so when that has
happened.

Attribution and licences of the third-party data are in [NOTICE.md](NOTICE.md).

## Layout

| Path | What |
|---|---|
| `datatug-project.json` | the project (id `datatug-demo-project`), its boards, models and environments |
| `queries/` | saved queries, including `sales/chinook-sales-per-capita` |
| `entities/`, `dbmodels/`, `boards/`, `policies/`, `recordsets/`, `datasources/` | the project's definitions |
| `environments/` | where each database is read from (`local` is the one the scripts use) |
| `data/` | the geo snapshot, support notes and recordsets |
| `fixtures/` | pinned and recorded inputs the tests use |
| `scripts/` | the hero script, the Chinook preparation and the geo sync |
| `tests/` | Go tests that load and run the project |
| `.github/workflows/` | CI |

## History

This repository was made from the `demo-project-1` folder of
[`datatug/datatug-demo-projects`](https://github.com/datatug/datatug-demo-projects), with
that folder's history (including its earlier life as the `datatug` folder). The older
repository is unchanged.

## Licence

The project files (queries, mappings, models, scripts, tests) are released under
[CC0 1.0 Universal](LICENSE). Third-party data and schema keep their own licences: see
[NOTICE.md](NOTICE.md).

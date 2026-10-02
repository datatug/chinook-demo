# Notice: third-party material

The project files in this repository (queries, mappings, models, scripts, tests) are
released under [CC0 1.0 Universal](LICENSE). The material below is **not** covered by that
dedication; each part keeps its own licence and requires the attribution given here.

## Chinook database (schema files in `dbmodels/`)

The table and column definitions in [`dbmodels/chinook`](dbmodels/chinook) describe the
Chinook sample database, created by Luis Rocha, upstream at
<https://github.com/lerocha/chinook-database>. The database rows are **not** in this
repository; the scripts fetch the SQLite file from <https://chinookdb.com> and check its
SHA-256 against [`fixtures/chinook/chinookdb.json`](fixtures/chinook/chinookdb.json), and the
`web` environment ([`web/`](web)) names the same site's per-table JSON files, with a pinned
mirror. The rows come from upstream revision `7f67772503d71ba90f19283c38e93923addb43fa`.
ChinookDB.com is an independent hosted resource and is not the official upstream project.

Chinook is licensed under the MIT licence. The notice below is copied from the upstream
`LICENSE.md` at that revision (`7f67772503d71ba90f19283c38e93923addb43fa`), not retyped
(trailing spaces at line ends removed):

```
Chinook Database
--------------------------------------
Copyright (c) 2008-2024 Luis Rocha

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## World Bank population (`data/geo/population_wb`)

Population figures are from the World Bank, World Development Indicators, indicator
[SP.POP.TOTL](https://data.worldbank.org/indicator/SP.POP.TOTL) ("Population, total"),
copyright The World Bank, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

**Modified.** This is a snapshot, not the World Bank's own publication: only the most recent
non-empty observation per country is kept, aggregates (regions, income groups, "World") and
entities without a matching country record are dropped, and rows are re-keyed by ISO 3166-1
alpha-2 code. The values are the World Bank's figures as published. Each record carries its
indicator, observation year, source URL and the date it was fetched. The World Bank does not
endorse this project or the changes made to its data. The full statement is in
[`data/geo/DATA-LICENSE.md`](data/geo/DATA-LICENSE.md) and
[`data/geo/README.md`](data/geo/README.md).

## GeoNames (`data/geo/countries`)

Country names and ISO codes are derived from the
[GeoNames geographical database](https://www.geonames.org/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This is a derived and modified
copy (filtered, renamed to this project's column names and re-keyed by ISO 3166-1 alpha-2
code); GeoNames does not endorse it. See
[`data/geo/DATA-LICENSE.md`](data/geo/DATA-LICENSE.md).

The two collections above are vendored from
[ingitdb/geo-ingitdb](https://github.com/ingitdb/geo-ingitdb) at the commit recorded in
[`data/geo/.vendored-from`](data/geo/.vendored-from).

## Country aliases (`data/geo/country_aliases`)

Written and hand-checked for this project. No third-party content.

## Recorded HTTP responses (`fixtures/http`)

Two small responses recorded from public keyless APIs so the demo works offline: country
currency data from `countriesnow.space` and an exchange rate from
[Frankfurter](https://frankfurter.dev). They are test fixtures, not a redistribution of
those services' datasets; see [`fixtures/http/README.md`](fixtures/http/README.md). Check
each service's own terms before reusing the data.

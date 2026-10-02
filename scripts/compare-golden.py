#!/usr/bin/env python3
"""Compare the hero query's result with golden/sales-per-capita.json, or rewrite the golden file.

The golden file holds the 24 countries of the saved query sales/chinook-sales-per-capita in
result order, with totalSales and salesPerMillion rounded to two decimals (the engine returns
floating point: 303.9599999999999) and population and populationYear exact, plus what they
were computed from. A difference in any country, value or position fails.

usage: compare-golden.py RESULT.json GOLDEN.json [--chinook CHINOOK.sqlite]
           RESULT.json  the output of `datatug query run ... --format json`
           --chinook    also check that the file holds the golden number of invoices and that
                        every invoice is in one of the countries (nothing silently dropped)
       compare-golden.py RESULT.json GOLDEN.json --chinook CHINOOK.sqlite --update
           rewrite GOLDEN.json from RESULT.json (after an intended change of the data), with
           `computedFrom` filled from this repository's files; review the diff.

Python 3.10 or newer, standard library only.
"""

from __future__ import annotations

import sys

if sys.version_info < (3, 10):
    raise SystemExit(f"compare-golden.py needs Python 3.10 or newer (found {sys.version.split()[0]})")

import hashlib
import json
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUERY_ID = "sales/chinook-sales-per-capita"
FIELDS = ("totalSales", "population", "populationYear", "salesPerMillion")
MONEY = ("totalSales", "salesPerMillion")


def two_places(value: float) -> str:
    return f"{value:.2f}"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def invoice_counts(chinook: Path) -> tuple[int, dict[str, int]]:
    db = sqlite3.connect(f"file:{chinook}?mode=ro", uri=True)
    try:
        total = db.execute("SELECT COUNT(*) FROM Invoice").fetchone()[0]
        by_country = dict(db.execute("SELECT BillingCountry, COUNT(*) FROM Invoice GROUP BY BillingCountry"))
    finally:
        db.close()
    return total, by_country


def rows_from_result(result: list[dict]) -> list[dict]:
    rows = []
    for rank, r in enumerate(result, 1):
        rows.append({
            "rank": rank,
            "country": r["country"],
            "totalSales": float(two_places(r["totalSales"])),
            "population": int(r["population"]),
            "populationYear": int(r["populationYear"]),
            "salesPerMillion": float(two_places(r["salesPerMillion"])),
        })
    return rows


def compare(result: list[dict], golden: dict, chinook: Path | None) -> list[str]:
    problems: list[str] = []
    want = golden["rows"]
    got = rows_from_result(result)
    if [r["country"] for r in got] != [r["country"] for r in want]:
        problems.append(f"countries or their order differ: got {[r['country'] for r in got]}, golden {[r['country'] for r in want]}")
    for g, r in zip(want, got):
        if g["country"] != r["country"]:
            continue
        for field in FIELDS:
            if field in MONEY:
                same = two_places(g[field]) == two_places(r[field])
            else:
                same = g[field] == r[field]
            if not same:
                problems.append(f"{g['country']}: {field} is {r[field]}, golden has {g[field]}")
    if chinook is not None:
        total, by_country = invoice_counts(chinook)
        if total != golden["invoices"]:
            problems.append(f"the Chinook file has {total} invoices, golden has {golden['invoices']}")
        covered = sum(by_country.get(r["country"], 0) for r in want)
        if covered != total:
            problems.append(f"only {covered} of {total} invoices are in the golden countries")
    return problems


def update(result: list[dict], golden_path: Path, chinook: Path) -> None:
    pin = json.loads((ROOT / "fixtures" / "chinook" / "chinookdb.json").read_text())
    catalog = json.loads((ROOT / "web" / "catalogs" / "chinook" / "chinook.db.json").read_text())
    vendored = dict(line.split("=", 1) for line in (ROOT / "data" / "geo" / ".vendored-from").read_text().split() if "=" in line)
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    total, _ = invoice_counts(chinook)
    golden = {
        "query": QUERY_ID,
        "question": "Which countries buy the most music relative to their population?",
        "rounding": "totalSales and salesPerMillion are rounded to two decimals; population and populationYear are exact; rows are in result order (rank 1 first)",
        "computedFrom": {
            "projectCommit": commit,
            "chinook": {
                "sqliteSha256": pin["sqlite"]["sha256"],
                "invoiceJsonSha256": catalog["sha256"]["Invoice"],
                "upstreamRevision": pin["upstream"]["revision"],
            },
            "geo": {"vendoredFrom": f"{vendored['repository']}@{vendored['commit']}"},
            "queryDtqlSha256": sha256_file(ROOT / "queries" / "sales" / "chinook-sales-per-capita.query.dtql"),
        },
        "invoices": total,
        "rows": rows_from_result(result),
    }
    golden_path.parent.mkdir(parents=True, exist_ok=True)
    golden_path.write_text(json.dumps(golden, indent=2, ensure_ascii=False) + "\n")


def main(argv: list[str]) -> int:
    args = list(argv)
    do_update = "--update" in args
    if do_update:
        args.remove("--update")
    chinook = None
    if "--chinook" in args:
        i = args.index("--chinook")
        chinook = Path(args[i + 1])
        del args[i:i + 2]
    if len(args) != 2 or (do_update and chinook is None):
        print(__doc__, file=sys.stderr)
        return 2
    result = json.loads(Path(args[0]).read_text())
    golden_path = Path(args[1])
    if do_update:
        update(result, golden_path, chinook)
        print(f"compare-golden: wrote {golden_path} ({len(result)} rows)", file=sys.stderr)
        return 0
    golden = json.loads(golden_path.read_text())
    problems = compare(result, golden, chinook)
    if problems:
        print("compare-golden: the result differs from the golden file:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    first, last = golden["rows"][0], next(r for r in golden["rows"] if r["country"] == "USA")
    print(f"compare-golden: matches {golden_path.name}: {len(golden['rows'])} countries, "
          f"{first['country']} first ({first['salesPerMillion']:.2f}), USA {last['rank']}th ({last['salesPerMillion']:.2f})"
          + (f", {golden['invoices']} invoices read" if chinook else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

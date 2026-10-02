#!/usr/bin/env python3
"""Generate, or check, data/geo/.web/<collection>.json: one file per geo table for the browser.

The vendored inGitDB database (data/geo) keeps one file per record: country_aliases has 24
files and population_wb has 216, and a browser reading the project from GitHub would need one
request each. A browser run reads the two tables it joins as one file each instead:

    data/geo/.web/country_aliases.json    24 records, about 3.9 KB
    data/geo/.web/population_wb.json      216 records, about 63 KB

Each file is a JSON array of {"key": <record id>, "data": <the record file's content, verbatim>}
in key order, one record per line: the shape the browser's reader takes (OVDB pages of
{key, data}). The files are generated from the records and are never edited by hand.

usage: build-web-geo.py            write the files
       build-web-geo.py --check    fail (exit 1) when a file is missing or differs from what the
                                   records give, i.e. the records changed and the files were not
                                   regenerated (CI runs this)

Python 3.10 or newer, standard library only.
"""

from __future__ import annotations

import sys

if sys.version_info < (3, 10):
    raise SystemExit(f"build-web-geo.py needs Python 3.10 or newer (found {sys.version.split()[0]})")

import json
from pathlib import Path

GEO = Path(__file__).resolve().parent.parent / "data" / "geo"
COLLECTIONS = ("country_aliases", "population_wb")


def render(collection: str) -> str:
    records = sorted((path.stem, json.loads(path.read_text(encoding="utf-8")))
                     for path in (GEO / collection / "$records").glob("*.json"))
    if not records:
        raise SystemExit(f"build-web-geo: no records under {GEO / collection / '$records'}")
    lines = [
        "  {\"key\": %s, \"data\": %s}" % (json.dumps(key, ensure_ascii=False), json.dumps(data, ensure_ascii=False))
        for key, data in records
    ]
    return "[\n" + ",\n".join(lines) + "\n]\n"


def main(argv: list[str]) -> int:
    if argv not in ([], ["--check"]):
        print(__doc__, file=sys.stderr)
        return 2
    check = argv == ["--check"]
    out_dir = GEO / ".web"
    stale = []
    for collection in COLLECTIONS:
        target = out_dir / f"{collection}.json"
        want = render(collection)
        if check:
            if not target.is_file():
                stale.append(f"{target.relative_to(GEO.parent.parent)} is missing")
            elif target.read_text(encoding="utf-8") != want:
                stale.append(f"{target.relative_to(GEO.parent.parent)} differs from the records in data/geo/{collection}/$records")
        else:
            out_dir.mkdir(exist_ok=True)
            target.write_text(want, encoding="utf-8")
            print(f"build-web-geo: wrote {target.relative_to(GEO.parent.parent)} ({want.count(chr(10)) - 2} records)", file=sys.stderr)
    if stale:
        print("build-web-geo: the one-file tables are out of date:", file=sys.stderr)
        for line in stale:
            print(f"  - {line}", file=sys.stderr)
        print("run scripts/build-web-geo.py and commit the result", file=sys.stderr)
        return 1
    if check:
        print("build-web-geo: data/geo/.web matches the records", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

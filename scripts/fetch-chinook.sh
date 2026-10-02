#!/usr/bin/env bash
# Fetch the Chinook SQLite file from chinookdb.com and verify its SHA-256.
#
# The pin is fixtures/chinook/chinookdb.json: the chinookdb.com address, a mirror
# (the public repo datatug/chinookdb on jsDelivr, at a fixed commit, serving the same
# file) and the SHA-256 both must produce. chinookdb.com is tried first. If it does not
# answer, the mirror is used, and the script says so. A file whose SHA-256 differs from
# the pin is never accepted, from either address: it is an error, not a warning.
#
# Prints the path of the verified file on stdout; everything else goes to stderr.
#
# Usage: scripts/fetch-chinook.sh [DESTINATION]
#   DESTINATION   default: .demo-data/chinook-source.sqlite in this repository
#                 (git-ignored). A file already there with the pinned SHA-256 is kept.
# Environment:
#   CHINOOK_FETCH_ATTEMPTS   tries per address (default 3, 5 seconds apart)
# Needs: bash, python3 (3.10+), curl.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${1:-$root/.demo-data/chinook-source.sqlite}"
attempts="${CHINOOK_FETCH_ATTEMPTS:-3}"

die() { echo "fetch-chinook: $*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || die "'curl' not found on PATH"
command -v python3 >/dev/null 2>&1 || die "'python3' not found on PATH"

pin() { python3 "$root/scripts/prepare_chinook.py" --pin "$1"; }
sha256_of() {
  python3 - "$1" <<'PY'
import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())
PY
}

want="$(pin sha256)"
if [ -f "$dest" ] && [ "$(sha256_of "$dest")" = "$want" ]; then
  echo "fetch-chinook: $dest already has the pinned SHA-256 $want" >&2
  echo "$dest"
  exit 0
fi

mkdir -p "$(dirname "$dest")"
tmp="$(mktemp "$dest.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# download URL: up to $attempts tries; success means the transfer worked, not that the
# bytes are right (the caller checks the SHA-256).
download() {
  local n
  for n in $(seq 1 "$attempts"); do
    if curl --fail --silent --show-error --location --max-redirs 3 --proto '=https' \
        --connect-timeout 10 --max-time 120 --output "$tmp" "$1"; then
      return 0
    fi
    echo "fetch-chinook: attempt $n of $attempts for $1 failed" >&2
    [ "$n" -lt "$attempts" ] && sleep 5
  done
  return 1
}

for which in url mirror; do
  address="$(pin "$which")"
  echo "fetch-chinook: $which: $address" >&2
  if download "$address"; then
    got="$(sha256_of "$tmp")"
    [ "$got" = "$want" ] || die "$address answered, but its SHA-256 is $got, not the pinned $want (the published file changed, or the pin is out of date); refusing it"
    chmod 0644 "$tmp"
    mv "$tmp" "$dest"
    trap - EXIT
    [ "$which" = url ] || echo "fetch-chinook: chinookdb.com did not answer; the verified mirror copy was used" >&2
    echo "fetch-chinook: verified SHA-256 $want ($which)" >&2
    echo "$dest"
    exit 0
  fi
done
die "neither chinookdb.com nor the mirror could be read"

#!/usr/bin/env bash
# Pull the live /game-html/<slug> for every game into public/games/<slug>/index.html.
# Usage: ./scripts/sync-games.sh <base-url>
#        SYNC_BASE_URL=https://example.com ./scripts/sync-games.sh
set -euo pipefail

BASE_URL="${1:-${SYNC_BASE_URL:-}}"
if [[ -z "$BASE_URL" ]]; then
  echo "usage: $0 <base-url>   (e.g. https://your-site.vercel.app)" >&2
  exit 1
fi
BASE_URL="${BASE_URL%/}"

cd "$(dirname "$0")/../public/games"

ok=0; fail=0; skipped=0
for dir in */; do
  slug="${dir%/}"
  url="$BASE_URL/game-html/$slug"
  printf 'sync %-40s ' "$slug"

  tmp="$slug/index.html.tmp"
  if curl -fsSL --max-time 30 --max-redirs 5 -o "$tmp" "$url"; then
    if [[ -s "$tmp" ]]; then
      mv "$tmp" "$slug/index.html"
      echo "ok"
      ok=$((ok+1))
    else
      rm -f "$tmp"
      echo "skip (empty)"
      skipped=$((skipped+1))
    fi
  else
    rm -f "$tmp"
    echo "FAIL"
    fail=$((fail+1))
  fi
done

echo
echo "synced: $ok   skipped: $skipped   failed: $fail"
[[ $fail -eq 0 ]]

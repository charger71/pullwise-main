#!/bin/bash
# One-off check of the PRH API before building prh-sync: asks for the key (not echoed, not saved),
# then saves raw responses for a trade ISBN, its flap copy, a comic UPC and a one-week on-sale window.
# Usage: [PRH_DOMAIN=PRH.US] tools/prh-probe.sh [ISBN] [UPC]   (output goes to tools/prh-probe-out/, which git ignores)
set -u
ISBN="${1:-9780593135204}"
UPC="${2:-}"
BASE="https://api.penguinrandomhouse.com/resources/v2/title"
D="domains/${PRH_DOMAIN:-PRH.US}"
OUT="$(dirname "$0")/prh-probe-out"
mkdir -p "$OUT"
read -rsp "PRH API key: " KEY; echo

get() { # name, path, extra query
  local code
  code=$(curl -s -o "$OUT/$1.json" -w '%{http_code}' "$BASE/$2?api_key=$KEY${3:-}")
  sed -i '' -E 's/api_key=[A-Za-z0-9_-]+/api_key=REDACTED/g' "$OUT/$1.json" # replies echo the key in their links
  echo "$1: HTTP $code ($(wc -c < "$OUT/$1.json" | tr -d ' ') bytes)"
}

get domains "domains"
get isbn "$D/titles/$ISBN"
get content "$D/titles/$ISBN/content"
if [ -n "$UPC" ]; then
  # Comics may live in another domain (USA3PD is likely third-party distribution: Marvel, Dark Horse, Oni)
  for dom in PRH.US USA3PD PRH.NA USA SALESPLATFORM; do
    get "upc-$dom" "domains/$dom/titles/$UPC"
  done
  get upcsearch "$D/search" "&q=$UPC"
fi
FROM=$(date +%m/%d/%Y); TO=$(date -v+7d +%m/%d/%Y)
get onsale "$D/titles" "&onSaleFrom=$FROM&onSaleTo=$TO&rows=25"
echo "Saved to $OUT"

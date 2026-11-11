#!/usr/bin/env bash
set -euo pipefail
base=${1:?Usage smoke.sh http://127.0.0.1:PORT}
for path in /healthz / /search/deployment /api/health; do
  curl --fail --silent --show-error --max-time 15 "$base$path" >/dev/null
done
curl --fail --silent --show-error --max-time 15 "$base/api/youtube/search?part=snippet&q=deployment&maxResults=1" |
  python3 -c 'import json,sys; v=json.load(sys.stdin); assert isinstance(v.get("items"),list) and len(v["items"])>0, "No items returned"'
printf '%s\n' 'HTTP, SPA route, proxy readiness, and metadata checks passed.'

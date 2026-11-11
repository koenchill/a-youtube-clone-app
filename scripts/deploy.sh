#!/usr/bin/env bash
set -euo pipefail
# Run as Jenkins on the dedicated training host. Never source untrusted env files.
root=/opt/youtube-lab
mkdir -p "$root/releases" "$root/secrets"
chmod 700 "$root" "$root/secrets"
if [[ ${1:-} == rollback ]]; then
  [[ -f "$root/previous.env" && -f "$root/previous.compose.yml" ]] || { echo 'No previous release'; exit 1; }
  compose=(docker compose -p youtube-app --env-file "$root/previous.env" -f "$root/previous.compose.yml")
  "${compose[@]}" up -d --wait --wait-timeout 120
  bash scripts/smoke.sh http://127.0.0.1:8081
  cp "$root/previous.env" "$root/current.env"
  cp "$root/previous.compose.yml" "$root/current.compose.yml"
  echo 'Previous release restored. This command does not rotate provider credentials.'
  exit 0
fi
: "${WEB_IMAGE:?}" "${PROXY_IMAGE:?}" "${BUILD_TAG:?}" "${API_MODE:?}"
[[ $API_MODE == demo || $API_MODE == live ]] || exit 1
# Avoid shell/env-file injection through image names and build labels.
[[ $WEB_IMAGE =~ ^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$ ]] || exit 1
[[ $PROXY_IMAGE =~ ^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$ ]] || exit 1
release=$(printf '%s' "$BUILD_TAG" | tr -c 'a-zA-Z0-9._-' '_')
key="$root/secrets/$release.key"
if [[ $API_MODE == live ]]; then
  : "${RAPIDAPI_KEY:?Live deployment requires Jenkins rapidapi-key credential}"
  # Atomic replacement keeps an existing container's old secret mount intact.
  (umask 077; printf '%s' "$RAPIDAPI_KEY" > "$key.new")
else
  (umask 077; printf '%s' 'demo-no-provider-key' > "$key.new")
fi
chmod 444 "$key.new"
mv "$key.new" "$key"
# Parent 0700 protects the host file. The non-root proxy reads its read-only bind mount.
new="$root/releases/$release.env"
{
  printf 'WEB_IMAGE=%s\nPROXY_IMAGE=%s\nAPI_MODE=%s\nSECRET_FILE=%s\n' "$WEB_IMAGE" "$PROXY_IMAGE" "$API_MODE" "$key"
  printf 'APP_PORT=8081\n'
} > "$new"
cp compose.app.yml "$root/releases/$release.compose.yml"
candidate=(docker compose -p youtube-candidate --env-file "$new" -f "$root/releases/$release.compose.yml")
cleanup() { APP_PORT=18080 "${candidate[@]}" down --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
# APP_PORT from environment overrides the env-file only for the candidate.
APP_PORT=18080 "${candidate[@]}" up -d --wait --wait-timeout 120
bash scripts/smoke.sh http://127.0.0.1:18080
if [[ -f "$root/current.env" ]]; then
  cp "$root/current.env" "$root/previous.env"
  cp "$root/current.compose.yml" "$root/previous.compose.yml"
fi
stable=(docker compose -p youtube-app --env-file "$new" -f "$root/releases/$release.compose.yml")
if "${stable[@]}" up -d --wait --wait-timeout 120 && bash scripts/smoke.sh http://127.0.0.1:8081; then
  cp "$new" "$root/current.env"
  cp "$root/releases/$release.compose.yml" "$root/current.compose.yml"
  echo 'Release verified on port 8081.'
else
  echo 'New stable release failed. Attempting previous release.' >&2
  if [[ -f "$root/previous.env" ]]; then
    docker compose -p youtube-app --env-file "$root/previous.env" -f "$root/previous.compose.yml" up -d --wait --wait-timeout 120
    bash scripts/smoke.sh http://127.0.0.1:8081
  else
    echo 'No previous release exists. Preserve logs and repair the initial deployment.' >&2
  fi
  exit 1
fi

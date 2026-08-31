#!/usr/bin/env bash
# Starts the static site server for the Peyoteros calendar page.
# Runs on every Cloud Agent boot via environment.json "start".
# Idempotent: does nothing if the site is already being served.
set -euo pipefail

PORT="${PORT:-8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "${SCRIPT_DIR}")"
LOG="/tmp/peyoteros-web.log"

if curl -sf -o /dev/null "http://localhost:${PORT}/"; then
  echo "Static server already serving on port ${PORT}"
  exit 0
fi

cd "${ROOT}"
nohup python3 -m http.server "${PORT}" --bind 0.0.0.0 >"${LOG}" 2>&1 &
disown || true

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://localhost:${PORT}/"; then
    echo "Static server ready on port ${PORT} (root: ${ROOT}, logs: ${LOG})"
    exit 0
  fi
  sleep 1
done

echo "ERROR: static server did not become ready on port ${PORT}" >&2
[ -f "${LOG}" ] && cat "${LOG}" >&2
exit 1

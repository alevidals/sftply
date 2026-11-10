#!/usr/bin/env bash
# Start the protocol integration stack, run the ignored Rust tests against it,
# and tear everything down again.
#
# Usage:
#   tests/integration/run.sh            # build, test, tear down
#   tests/integration/run.sh --keep     # leave the containers running
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.yml)
KEEP=0
if [[ "${1:-}" == "--keep" ]]; then
  KEEP=1
fi

cleanup() {
  if [[ "$KEEP" -eq 0 ]]; then
    # Remove containers, volumes, networks and every image used by this
    # compose project (built and pulled), so a test run leaves no Docker
    # state behind.
    "${COMPOSE[@]}" down --volumes --remove-orphans --rmi all >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

./generate-certs.sh

echo "Starting integration services…"
"${COMPOSE[@]}" up -d --build

wait_for_service() {
  local service="$1"
  local pattern="$2"
  local port="$3"
  local name="$4"
  for _ in $(seq 1 90); do
    if "${COMPOSE[@]}" logs "$service" 2>/dev/null | grep -q "$pattern" \
      && nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
      echo "  $name ready on port $port"
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $name on port $port" >&2
  "${COMPOSE[@]}" logs --tail=60 "$service" >&2 || true
  return 1
}

wait_for_service ftp "Starting pure-ftpd" 2121 "plain FTP"
wait_for_service ftps-explicit "Starting pure-ftpd" 2122 "explicit FTPS"
wait_for_service ftps-implicit "Starting pure-ftpd implicit FTPS" 2990 "implicit FTPS"
wait_for_service sftp "Server listening on" 2222 "SFTP"

echo "Running protocol integration tests…"
cargo test \
  --manifest-path ../../src-tauri/Cargo.toml \
  --lib \
  -- \
  --ignored \
  --nocapture

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node "$ROOT/scripts/eval-fixtures.mjs"
node --test "$ROOT/scripts/security.test.mjs"
node --test "$ROOT/scripts/mcp-tools.test.mjs" "$ROOT/scripts/bridge-files.test.mjs" "$ROOT/scripts/bridge-csv.test.mjs" "$ROOT/scripts/bridge-connectors.test.mjs" "$ROOT/scripts/bridge-numbers.test.mjs" "$ROOT/scripts/bridge-native-wire.test.mjs"
node "$ROOT/scripts/bridge-smoke.mjs"
node "$ROOT/scripts/mcp-smoke.mjs"

cd "$ROOT/core"
npm run typecheck
npm run lint
npm test
npm run deadcode
npm run shellcheck
npm run build

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node "$ROOT/scripts/eval-fixtures.mjs"
node "$ROOT/scripts/bridge-smoke.mjs"

cd "$ROOT/core"
npm run typecheck
npm run lint
npm test
npm run deadcode
npm run shellcheck
npm run build

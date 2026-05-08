#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node "$ROOT/scripts/eval-fixtures.mjs"

cd "$ROOT/core"
npm run typecheck
npm test
npm run build

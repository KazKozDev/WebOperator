#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.hermes/node/bin:$PATH"

NODE_BIN="$(command -v node 2>/dev/null || echo "/opt/homebrew/bin/node")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "$NODE_BIN" "$SCRIPT_DIR/bridge.js" "$@"

#!/bin/bash
# Install WebOperator Bridge Native Messaging Host for Chrome.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_PATH="$SCRIPT_DIR/bridge.js"
NODE_PATH="$(which node)"
EXT_ID="${WEBOPERATOR_EXTENSION_ID:-phbohkmfojcjbmgfnaikenmgemgckdpg}"

if [[ "$OSTYPE" == "darwin"* ]]; then
  HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
elif [[ "$OSTYPE" == "linux"* ]]; then
  HOST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
else
  echo "Unsupported OS."
  exit 1
fi

HOST_FILE="$HOST_DIR/com.weboperator.bridge.json"
mkdir -p "$HOST_DIR"

cat > "$HOST_FILE" << EOF
{
  "name": "com.weboperator.bridge",
  "description": "WebOperator local agent bridge",
  "path": "$NODE_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ],
  "args": ["$BRIDGE_PATH"]
}
EOF

chmod +x "$BRIDGE_PATH"

echo "Installed native host: $HOST_FILE"
echo "Extension ID: $EXT_ID"
echo "Node: $NODE_PATH"
echo "Bridge: $BRIDGE_PATH"
echo "Agent socket: \${WEBOPERATOR_AGENT_SOCKET:-/tmp/weboperator-bridge.sock}"
echo "HTTP API: http://127.0.0.1:8765"
echo ""
echo "Reload the extension in chrome://extensions."

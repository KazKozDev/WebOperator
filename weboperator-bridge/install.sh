#!/bin/bash
# Install WebOperator Bridge Native Messaging Host for Chromium browsers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/native-host.sh"
EXT_ID="${WEBOPERATOR_EXTENSION_ID:-phbohkmfojcjbmgfnaikenmgemgckdpg}"

HOST_DIRS=()

if [[ "$OSTYPE" == "darwin"* ]]; then
  HOST_DIRS=(
    "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
    "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    "$HOME/Library/Application Support/BraveSoftware/Brave-Browser-Nightly/NativeMessagingHosts"
    "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
  )
elif [[ "$OSTYPE" == "linux"* ]]; then
  HOST_DIRS=(
    "$HOME/.config/google-chrome/NativeMessagingHosts"
    "$HOME/.config/chromium/NativeMessagingHosts"
    "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  )
else
  echo "Unsupported OS."
  exit 1
fi

chmod +x "$HOST_SCRIPT"
chmod +x "$SCRIPT_DIR/bridge.js"
chmod +x "$SCRIPT_DIR/mcp-server.js" 2>/dev/null || true

for HOST_DIR in "${HOST_DIRS[@]}"; do
  mkdir -p "$HOST_DIR"
  HOST_FILE="$HOST_DIR/com.weboperator.bridge.json"
  cat > "$HOST_FILE" << EOF
{
  "name": "com.weboperator.bridge",
  "description": "WebOperator local agent bridge",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF
  echo "Installed native host: $HOST_FILE"
done

echo ""
echo "Extension ID: $EXT_ID"
echo "Native Host: $HOST_SCRIPT"
echo "Agent socket: ${WEBOPERATOR_AGENT_SOCKET:-/tmp/weboperator-bridge.sock}"
echo "HTTP API: http://127.0.0.1:8765"
echo ""
echo "Reload the extension in chrome://extensions."

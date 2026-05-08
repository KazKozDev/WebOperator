#!/bin/bash
# Install Hermes Companion Native Messaging Host for Chrome
# Extension ID: phbohkmfojcjbmgfnaikenmgemgckdpg

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPANION_PATH="$SCRIPT_DIR/companion.js"
NODE_PATH="$(which node)"
EXT_ID="phbohkmfojcjbmgfnaikenmgemgckdpg"

if [[ "$OSTYPE" == "darwin"* ]]; then
  HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
elif [[ "$OSTYPE" == "linux"* ]]; then
  HOST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
else
  echo "Unsupported OS."
  exit 1
fi

HOST_FILE="$HOST_DIR/com.weboperator.hermes.json"

mkdir -p "$HOST_DIR"

cat > "$HOST_FILE" << EOF
{
  "name": "com.weboperator.hermes",
  "description": "WebOperator Hermes Agent Bridge",
  "path": "$NODE_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ],
  "args": ["$COMPANION_PATH"]
}
EOF

echo "Installed native host: $HOST_FILE"
echo "Extension ID: $EXT_ID"
echo "Node: $NODE_PATH"
echo "Companion: $COMPANION_PATH"
echo ""
echo "Done. Reload the extension in chrome://extensions"

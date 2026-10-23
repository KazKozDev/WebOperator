# weboperator-mcp

MCP server that hands your **live Chrome tab** to any agent client — Claude Desktop, Cursor, Hermes, OpenClaw, OpenHands. Speaks MCP over stdio.

It drives the browser you are already signed into, so your sessions, cookies, and extensions come along. Nothing is launched headless and nothing leaves the machine.

## Tools

The stdio server and HTTP MCP endpoint expose the same **45 tools**: browser actions, image reading, JavaScript dialogs, tabs, task lifecycle, network and console observation, cookies, storage, file transfers and clipboard access. See the [tool catalogue](https://github.com/KazKozDev/WebOperator/blob/main/docs/mcp-tools.md).

New tools include `browser_image`, `browser_select_option`, `browser_handle_dialog`, and `agent_task_pause`, `agent_task_resume`, `agent_task_wait`.

`browser_snapshot` returns an accessibility tree with numbered interactive elements; the action tools take those numbers, so an agent never guesses at CSS selectors.

After updating, rebuild and reload the extension and reconnect your MCP client so it fetches the new tool list. Running clients keep their current server process until restarted; local changes do not update an already published npm package.

## Install

The server talks to Chrome through the [WebOperator extension](https://github.com/KazKozDev/WebOperator) and a Native Messaging host, so install the extension first, then register the host:

```bash
npx -p weboperator-mcp weboperator-bridge-install
```

Then point your client at the server:

```json
{
  "mcpServers": {
    "weboperator": {
      "command": "npx",
      "args": ["-y", "weboperator-mcp"]
    }
  }
}
```

Reload the extension in `chrome://extensions` after registering the host.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `WEBOPERATOR_BRIDGE_PORT` | `8765` | Port of the local bridge HTTP API |
| `WEBOPERATOR_BRIDGE_HOST` | `127.0.0.1` | Bridge bind address |
| `WEBOPERATOR_AGENT_SOCKET` | `/tmp/weboperator-bridge.sock` | Unix socket the bridge listens on |
| `WEBOPERATOR_API_TOKEN` | _(unset)_ | Shared token, required when unauthenticated bridge access is disabled |

macOS and Linux. Chrome, Chromium, Brave, Edge, and Arc are all registered by the installer.

## Security

Page content is treated as data, never as instructions — the extension's prompt-injection fixtures live in [`evals/fixtures/`](https://github.com/KazKozDev/WebOperator/tree/main/evals/fixtures). `browser_solve_captcha` pauses for you rather than defeating a challenge, and login flows stop for a human instead of typing credentials.

MIT © Artem KK · [full documentation](https://github.com/KazKozDev/WebOperator)

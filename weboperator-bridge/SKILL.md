---
name: weboperator
description: "Control and automate the live browser (Brave, Chrome) via the WebOperator MCP server. Navigate websites, search, click, type, scroll, take screenshots, extract data, or run autonomous goals directly in the user's active browser."
version: 1.4.0
author: WebOperator
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Browser-Automation, WebOperator, MCP, Chrome, Brave, Web-Navigation, Live-Browser]
---

# WebOperator Browser Automation Skill

WebOperator connects Hermes directly to the user's live browser (Brave Browser, Google Chrome) via MCP.

> [!IMPORTANT]
> When the user asks to open a site, search in the browser, scroll, click, or mentions "вебоператор" / "WebOperator", **ALWAYS** use the `mcp__weboperator__*` tools.
> **DO NOT** use Firecrawl or built-in `web_search`/`web_extract` when the user refers to WebOperator or wants browser automation.

---

## Available MCP Tools

All tools are prefixed with `mcp__weboperator__`:

### 1. `mcp__weboperator__browser_navigate`
Navigate the active tab to a specific URL.
```json
{
  "url": "https://www.google.com"
}
```

### 2. `mcp__weboperator__browser_snapshot`
Capture the interactive accessibility tree with numbered element IDs (`@1`, `@2`, etc.) from the active tab.
```json
{}
```

### 3. `mcp__weboperator__browser_click`
Click an interactive element by its index from `browser_snapshot` or CSS selector.
```json
{
  "index": 2
}
```

### 4. `mcp__weboperator__browser_type`
Type text into an input field.
```json
{
  "index": 1,
  "text": "auriculares baratos",
  "clear": true
}
```

### 5. `mcp__weboperator__browser_press`
Press a keyboard key (e.g. Enter, Tab, Escape).
```json
{
  "key": "Enter"
}
```

### 6. `mcp__weboperator__browser_scroll`
Scroll the active webpage up or down.
```json
{
  "direction": "down",
  "amount": 500
}
```

### 7. `mcp__weboperator__browser_screenshot`
Capture a visual PNG screenshot of the active browser viewport.
```json
{}
```

### 8. `mcp__weboperator__browser_extract`
Extract structured text content or answers from the active page.
```json
{
  "instruction": "Extract list of top 5 products with prices"
}
```

### 9. `mcp__weboperator__weboperator_execute_goal`
Run a high-level autonomous goal in the browser end-to-end using WebOperator's planner.
```json
{
  "goal": "Find headphones under 30 euros on amazon.es and summarize top 3 options",
  "timeoutMs": 120000
}
```

---

## Typical Workflow

1. **Open a site**: Call `mcp__weboperator__browser_navigate` with `url`.
2. **Inspect page**: Call `mcp__weboperator__browser_snapshot` to see element numbers and text.
3. **Interact**: Call `mcp__weboperator__browser_type` or `mcp__weboperator__browser_click` using the element indices.
4. **Scroll / Read**: Call `mcp__weboperator__browser_scroll` or `mcp__weboperator__browser_extract`.
5. **Or run autonomous goal**: Call `mcp__weboperator__weboperator_execute_goal` with the full prompt.

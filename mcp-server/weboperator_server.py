#!/usr/bin/env python3
"""WebOperator MCP Server — bridges Hermes Agent to Brave Nightly via CDP."""

import asyncio
import json
import time
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

import websocket

CDP_BASE = "http://127.0.0.1:9224"
executor = ThreadPoolExecutor(max_workers=4)


def _get_active_page() -> dict:
    """Find the active page target from CDP (runs in thread)."""
    resp = urllib.request.urlopen(f"{CDP_BASE}/json", timeout=5)
    targets = json.loads(resp.read().decode())
    for t in targets:
        if t.get("type") == "page" and not t.get("url", "").startswith("chrome://"):
            return t
    for t in targets:
        if t.get("type") == "page":
            return t
    raise RuntimeError("No page target found in CDP")


def _cdp_evaluate(expression: str, await_promise: bool = False, timeout: int = 15) -> Any:
    """Evaluate JS in the page (runs in thread)."""
    page = _get_active_page()
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=timeout)
    msg_id = int(time.time() * 1000)
    ws.send(json.dumps({"id": msg_id, "method": "Runtime.evaluate", "params": {
        "expression": expression, "returnByValue": True, "awaitPromise": await_promise
    }}))
    ws.settimeout(timeout)
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get("id") == msg_id:
            ws.close()
            result = data.get("result", {}).get("result", {})
            if result.get("subtype") == "error":
                return {"error": result.get("description", "unknown")}
            return result.get("value", None)
    ws.close()
    return None


def _cdp_call(method: str, params: dict | None = None, timeout: int = 15) -> dict:
    """Make a CDP method call (runs in thread)."""
    page = _get_active_page()
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=timeout)
    msg_id = int(time.time() * 1000)
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    ws.settimeout(timeout)
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get("id") == msg_id:
            ws.close()
            return data.get("result", {})
    ws.close()
    return {}


# ── MCP Server ──

server = Server("weboperator")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(name="weboperator_snapshot", description="Take an accessibility snapshot of the current page. Returns structured page content with element refs.", inputSchema={"type": "object", "properties": {}}),
        Tool(name="weboperator_screenshot", description="Take a screenshot of the current page viewport.", inputSchema={"type": "object", "properties": {}}),
        Tool(name="weboperator_navigate", description="Navigate to a URL.", inputSchema={"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}),
        Tool(name="weboperator_click", description="Click an element by its ref ID from the snapshot.", inputSchema={"type": "object", "properties": {"ref": {"type": "string"}}, "required": ["ref"]}),
        Tool(name="weboperator_type", description="Type text into an input field by its ref ID.", inputSchema={"type": "object", "properties": {"ref": {"type": "string"}, "text": {"type": "string"}}, "required": ["ref", "text"]}),
        Tool(name="weboperator_scroll", description="Scroll the page up or down.", inputSchema={"type": "object", "properties": {"direction": {"type": "string", "enum": ["up", "down"]}, "amount": {"type": "number"}}, "required": ["direction"]}),
        Tool(name="weboperator_extract", description="Extract structured data from the current page.", inputSchema={"type": "object", "properties": {}}),
        Tool(name="weboperator_press", description="Press a keyboard key.", inputSchema={"type": "object", "properties": {"key": {"type": "string"}}, "required": ["key"]}),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    loop = asyncio.get_running_loop()
    try:
        if name == "weboperator_snapshot":
            js = """(async()=>{const e=document.querySelectorAll('a,button,input,select,textarea,[role]');const r=[];e.forEach((e,i)=>{const t=e.tagName.toLowerCase();const n=(e.textContent||'').trim().slice(0,60);r.push({ref:'@e'+(i+1),tag:t,text:n,id:e.id||'',cls:typeof e.className==='string'?e.className.slice(0,40):'',href:t==='a'?e.getAttribute('href')||'':'',type:e.getAttribute('type')||'',placeholder:e.getAttribute('placeholder')||'',role:e.getAttribute('role')||'',value:e.value!==undefined?String(e.value).slice(0,30):''})});return JSON.stringify({url:location.href,title:document.title,elements:r.slice(0,200)})})()"""
            result = await loop.run_in_executor(executor, _cdp_evaluate, js, True, 15)
            return [TextContent(type="text", text=str(result))]

        elif name == "weboperator_screenshot":
            result = await loop.run_in_executor(executor, _cdp_call, "Page.captureScreenshot", {"format": "png"}, 15)
            size = len(result.get("data", ""))
            return [TextContent(type="text", text=f"Screenshot captured ({size} chars base64)")]

        elif name == "weboperator_navigate":
            result = await loop.run_in_executor(executor, _cdp_call, "Page.navigate", {"url": arguments["url"]}, 30)
            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        elif name == "weboperator_click":
            ref = arguments["ref"]
            idx = int(ref.replace("@e", "")) - 1
            result = await loop.run_in_executor(executor, _cdp_evaluate,
                f"(()=>{{const e=document.querySelectorAll('a,button,input,select,textarea,[role]');if(e[{idx}]){{e[{idx}].click();return'clicked '+e[{idx}].tagName}}return'not found at {idx}'}})()", False, 10)
            return [TextContent(type="text", text=str(result))]

        elif name == "weboperator_type":
            ref = arguments["ref"]
            text = arguments["text"]
            idx = int(ref.replace("@e", "")) - 1
            result = await loop.run_in_executor(executor, _cdp_evaluate,
                f"(()=>{{const e=document.querySelectorAll('a,button,input,select,textarea,[role]');const el=e[{idx}];if(!el)return'not found';el.focus();el.value={json.dumps(text)};el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return'typed into '+el.tagName}})()", False, 10)
            return [TextContent(type="text", text=str(result))]

        elif name == "weboperator_scroll":
            direction = arguments.get("direction", "down")
            amount = arguments.get("amount", 500)
            sign = "-" if direction == "up" else ""
            result = await loop.run_in_executor(executor, _cdp_evaluate,
                f"window.scrollBy(0,{sign}{amount});'scrolled {direction} {amount}px'", False, 10)
            return [TextContent(type="text", text=str(result))]

        elif name == "weboperator_extract":
            js = """(()=>JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,3000),links:Array.from(document.querySelectorAll('a[href]')).slice(0,50).map(a=>({text:(a.textContent||'').trim().slice(0,80),href:a.href}))}))()"""
            result = await loop.run_in_executor(executor, _cdp_evaluate, js, True, 15)
            return [TextContent(type="text", text=str(result))]

        elif name == "weboperator_press":
            key = arguments["key"]
            await loop.run_in_executor(executor, _cdp_call, "Input.dispatchKeyEvent", {"type": "keyDown", "key": key}, 5)
            await loop.run_in_executor(executor, _cdp_call, "Input.dispatchKeyEvent", {"type": "keyUp", "key": key}, 5)
            return [TextContent(type="text", text=f"Pressed key: {key}")]

        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())

// Client for external MCP servers that the user lists in a local config file.
// The extension can only name a configured server key, never a command.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROTOCOL_VERSION = '2025-06-18';
const START_TIMEOUT_MS = 120_000; // first `npx` run may install the package
const CALL_TIMEOUT_MS = 120_000;
const MAX_TEXT = 20_000;
const MAX_SCHEMA = 4_000;
// Chrome starts the native host with a minimal PATH.
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.volta/bin')];

function defaultConfigPath() {
  return process.env.WEBOPERATOR_CONNECTORS || path.join(os.homedir(), '.weboperator', 'connectors.json');
}

function readConfig(file) {
  let stat;
  try { stat = fs.statSync(file); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
  // Anyone who can edit this file can make the bridge run a program.
  if (stat.mode & 0o022) throw new Error(`${file} must not be writable by group or others (chmod 600)`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${file} must be owned by the current user`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const servers = parsed.servers ?? parsed.mcpServers ?? {};
  const result = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (!/^[\w-]{1,40}$/.test(name)) throw new Error(`Invalid connector name: ${name}`);
    if (!spec || typeof spec.command !== 'string' || !spec.command) throw new Error(`Connector ${name} needs a command`);
    if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some(a => typeof a !== 'string'))) throw new Error(`Connector ${name}: args must be strings`);
    if (spec.readOnly !== undefined && (!Array.isArray(spec.readOnly) || spec.readOnly.some(a => typeof a !== 'string'))) throw new Error(`Connector ${name}: readOnly must list tool names`);
    result[name] = { command: spec.command, args: spec.args ?? [], env: spec.env ?? {}, cwd: spec.cwd, readOnly: spec.readOnly ?? [] };
  }
  return result;
}

function resolveCommand(command, envPath) {
  if (path.isAbsolute(command)) return command;
  const dirs = [...(envPath ?? '').split(path.delimiter), ...EXTRA_PATH].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  throw new Error(`Connector command not found: ${command}. Use an absolute path in the connectors file.`);
}

function capJson(value, max) {
  const text = JSON.stringify(value ?? {});
  return text.length > max ? { note: `schema omitted (${text.length} characters)` } : value;
}

class StdioServer {
  constructor(name, spec, log) {
    this.name = name; this.spec = spec; this.log = log;
    this.proc = null; this.ready = null; this.pending = new Map(); this.nextId = 1; this.tools = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const env = { ...process.env, ...this.spec.env };
      env.PATH = [env.PATH, ...EXTRA_PATH].filter(Boolean).join(path.delimiter);
      const command = resolveCommand(this.spec.command, env.PATH);
      // stdout of the bridge is the Chrome native-messaging stream: the child never writes to it.
      const proc = spawn(command, this.spec.args, { env, cwd: this.spec.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = proc;
      let buffer = '';
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) this.receive(line);
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', chunk => this.log(`[connector ${this.name}] ${String(chunk).trim().slice(0, 500)}`));
      proc.stdin.on('error', () => {});
      const failed = new Promise((_, reject) => {
        proc.once('error', reject);
        proc.once('exit', (code, signal) => reject(new Error(`Connector ${this.name} exited (${signal ?? code})`)));
      });
      proc.once('exit', (code, signal) => this.stopped(new Error(`Connector ${this.name} exited (${signal ?? code})`)));
      proc.once('error', error => this.stopped(error));
      await Promise.race([failed, this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'weboperator', version: '1.6.0' },
      }, START_TIMEOUT_MS)]);
      this.notify('notifications/initialized');
    })();
    this.ready.catch(() => this.stop());
    return this.ready;
  }

  stopped(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.proc = null; this.ready = null; this.tools = null;
  }

  stop() {
    const proc = this.proc;
    this.stopped(new Error(`Connector ${this.name} stopped`));
    try { proc?.kill(); } catch {}
  }

  receive(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { this.log(`[connector ${this.name}] non-JSON output ignored`); return; }
    if (msg.method && msg.id !== undefined) {
      // Server-initiated requests must get an answer or some servers wait forever.
      if (msg.method === 'ping') this.send({ jsonrpc: '2.0', id: msg.id, result: {} });
      else if (msg.method === 'roots/list') this.send({ jsonrpc: '2.0', id: msg.id, result: { roots: [] } });
      else this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} is not supported by WebOperator` } });
      return;
    }
    const item = this.pending.get(msg.id);
    if (!item) return;
    this.pending.delete(msg.id);
    clearTimeout(item.timer);
    if (msg.error) item.reject(new Error(`${this.name}: ${msg.error.message ?? 'error'}`));
    else item.resolve(msg.result ?? {});
  }

  send(msg) {
    if (!this.proc) throw new Error(`Connector ${this.name} is not running`);
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  notify(method, params) { this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); }

  request(method, params, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Connector ${this.name} timed out on ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async listTools() {
    await this.start();
    if (this.tools) return this.tools;
    const tools = [];
    let cursor;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {}, CALL_TIMEOUT_MS);
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor && tools.length < 500);
    this.tools = tools.map(tool => ({
      name: String(tool.name),
      description: String(tool.description ?? '').slice(0, 500),
      inputSchema: capJson(tool.inputSchema, MAX_SCHEMA),
      // Only the user's config waives confirmation. Server annotations are self-reported.
      readOnly: this.spec.readOnly.includes(String(tool.name)),
    }));
    return this.tools;
  }

  async callTool(name, args, timeoutMs = CALL_TIMEOUT_MS) {
    const tools = await this.listTools();
    if (!tools.some(tool => tool.name === name)) throw new Error(`Connector ${this.name} has no tool ${name}`);
    const result = await this.request('tools/call', { name, arguments: args ?? {} }, timeoutMs);
    const content = Array.isArray(result.content) ? result.content : [];
    let text = content.filter(part => part?.type === 'text').map(part => String(part.text)).join('\n');
    if (!text && result.structuredContent !== undefined) text = JSON.stringify(result.structuredContent);
    const truncated = text.length > MAX_TEXT;
    return {
      isError: result.isError === true,
      text: truncated ? text.slice(0, MAX_TEXT) : text,
      truncated,
      otherContent: content.filter(part => part?.type !== 'text').map(part => part?.type ?? 'unknown'),
    };
  }
}

function createConnectors({ log = () => {}, configPath = defaultConfigPath() } = {}) {
  const servers = new Map();
  function server(name) {
    const config = readConfig(configPath);
    const spec = config[name];
    if (!spec) throw new Error(`Unknown connector: ${name}`);
    let running = servers.get(name);
    // A config edit takes effect on the next call.
    if (running && JSON.stringify(running.spec) !== JSON.stringify(spec)) { running.stop(); running = undefined; }
    if (!running) { running = new StdioServer(name, spec, log); servers.set(name, running); }
    return running;
  }

  async function request({ op, server: name, tool, arguments: args, timeoutMs } = {}) {
    if (op === 'servers') {
      const config = readConfig(configPath);
      return { servers: Object.entries(config).map(([key, spec]) => ({ name: key, readOnly: spec.readOnly, tools: servers.get(key)?.tools?.map(t => t.name) ?? null })) };
    }
    if (typeof name !== 'string') throw new Error('Missing connector name');
    if (op === 'tools') return { server: name, tools: await server(name).listTools() };
    if (op === 'call') {
      if (typeof tool !== 'string' || !tool) throw new Error('Missing connector tool');
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) throw new Error('Connector arguments must be an object');
      const limit = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1000), CALL_TIMEOUT_MS) : CALL_TIMEOUT_MS;
      return server(name).callTool(tool, args, limit);
    }
    throw new Error('Unknown connector operation');
  }

  function closeAll() { for (const item of servers.values()) item.stop(); servers.clear(); }
  return { request, closeAll };
}

module.exports = { createConnectors, readConfig };

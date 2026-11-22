// Shared bridge token: WEBOPERATOR_API_TOKEN if set, else ~/.weboperator/bridge-token,
// created on first use. The bridge (started by Chrome) and MCP clients (started by an
// agent) never share an environment, so a 0600 file is how they agree without setup.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomBytes, timingSafeEqual } = require('crypto');

const TOKEN_FILE = path.join(os.homedir(), '.weboperator', 'bridge-token');

function loadBridgeToken() {
  const fromEnv = (process.env.WEBOPERATOR_API_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const existing = readTokenFile();
  if (existing) return existing;
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  // Write then link, so a process starting at the same moment never reads a half-written file.
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  try { fs.linkSync(tmp, TOKEN_FILE); } catch (err) { if (err.code !== 'EEXIST') throw err; } finally { fs.rmSync(tmp, { force: true }); }
  return readTokenFile();
}

function readTokenFile() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (err) { if (err.code === 'ENOENT') return ''; throw err; }
}

function sameToken(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = { TOKEN_FILE, loadBridgeToken, sameToken };

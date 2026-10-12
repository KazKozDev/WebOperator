import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';

const source = await readFile(new URL('./eval-extension.mjs', import.meta.url), 'utf8');
const proxySource = source.slice(source.indexOf('async function startOllamaProxy()'), source.indexOf('\nfunction run('));

test('Ollama proxy fixes the destination and rejects redirects and unexpected paths', async () => {
  const calls = [];
  const context = vm.createContext({
    createServer, URL, Buffer, process,
    fetch: async (url, options) => {
      calls.push({ url: url.href, redirect: options.redirect });
      return { status: 200, headers: new Headers(), body: null };
    },
  });
  const server = await vm.runInContext(`${proxySource}\nstartOllamaProxy()`, context);
  try {
    const response = await fetch(`${server.origin}//evil.test/api/chat`);
    assert.equal(response.status, 200);
    const target = new URL(process.env.WEBOPERATOR_OLLAMA_URL ?? 'http://127.0.0.1:11434');
    assert.equal(calls[0].url, `${target.origin}/api/chat`);
    assert.equal(calls[0].redirect, 'error');
    assert.equal((await fetch(`${server.origin}/admin`)).status, 404);
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Ollama proxy does not expose upstream error details', async () => {
  const context = vm.createContext({ createServer, URL, Buffer, process, fetch: async () => { throw new Error('secret internal details'); } });
  const server = await vm.runInContext(`${proxySource}\nstartOllamaProxy()`, context);
  try {
    const response = await fetch(`${server.origin}/api/chat`);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), 'Ollama upstream request failed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

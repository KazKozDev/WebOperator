import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { imageContent } = require('../weboperator-bridge/tools.js');

test('image bytes are MCP image content and are not repeated in the text block', () => {
  const content = imageContent({ kind: 'image', mimeType: 'image/png', base64: 'aW1hZ2U=', width: 2 });
  assert.deepEqual(content[0], { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' });
  assert.equal(JSON.parse(content[1].text).width, 2);
  assert(!content[1].text.includes('aW1hZ2U='));
  for (const result of [null, {}, { mimeType: 'text/html', base64: 'data' }]) assert.throws(() => imageContent(result), /Expected/);
});

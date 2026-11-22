import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { imageContent, formatTaskResultForAgent } = require('../weboperator-bridge/tools.js');

test('image bytes are MCP image content and are not repeated in the text block', () => {
  const content = imageContent({ kind: 'image', mimeType: 'image/png', base64: 'aW1hZ2U=', width: 2 });
  assert.deepEqual(content[0], { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' });
  assert.equal(JSON.parse(content[1].text).width, 2);
  assert(!content[1].text.includes('aW1hZ2U='));
  for (const result of [null, {}, { mimeType: 'text/html', base64: 'data' }]) assert.throws(() => imageContent(result), /Expected/);
});

test('a finished task is summarized from its done step, then from extracted data', () => {
  const done = formatTaskResultForAgent({ id: 't1', status: 'done', goal: 'g', steps: [
    { toolCall: { name: 'extract', arguments: {} }, result: { extracted: 'rows' } },
    { toolCall: { name: 'done', arguments: { summary: 'All 50 titles' } } },
  ] });
  assert.deepEqual([done.ok, done.taskId, done.answer, done.stepCount], [true, 't1', 'All 50 titles', 2]);
  assert.equal(formatTaskResultForAgent({ status: 'failed', goal: 'g', steps: [{ result: { extracted: 'partial' } }] }).answer, 'partial');
  assert.equal(formatTaskResultForAgent({ status: 'failed', goal: 'g', error: 'boom', steps: [] }).answer, 'Goal failed: boom');
  assert.equal(formatTaskResultForAgent(null).ok, false);
});

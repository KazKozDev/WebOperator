#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evalDir = path.join(root, 'evals');
const fixtureDir = path.join(evalDir, 'fixtures');
const tasksPath = path.join(evalDir, 'tasks.json');

const tasks = JSON.parse(await readFile(tasksPath, 'utf8'));
const errors = [];
const ids = new Set();
const cyrillic = /[А-Яа-я]/;

if (!Array.isArray(tasks) || tasks.length === 0) {
  errors.push('evals/tasks.json must contain a non-empty array');
}

for (const task of tasks) {
  const label = task?.id ?? '(missing id)';

  if (!task.id || typeof task.id !== 'string') errors.push(`${label}: missing string id`);
  if (ids.has(task.id)) errors.push(`${label}: duplicate id`);
  ids.add(task.id);

  for (const field of ['title', 'fixture', 'prompt']) {
    if (!task[field] || typeof task[field] !== 'string') errors.push(`${label}: missing string ${field}`);
  }

  for (const field of ['expectedEvidence', 'expectedAnswerIncludes', 'traceAssertions', 'failureModes']) {
    if (!Array.isArray(task[field]) || task[field].length === 0) {
      errors.push(`${label}: ${field} must be a non-empty array`);
    }
  }

  const textBlob = JSON.stringify(task);
  if (cyrillic.test(textBlob)) errors.push(`${label}: eval metadata must be English-only`);

  const fixtures = [task.fixture, ...(task.relatedFixtures ?? [])];
  for (const fixture of fixtures) {
    const fixturePath = path.join(fixtureDir, fixture);
    if (!existsSync(fixturePath)) {
      errors.push(`${label}: missing fixture ${fixture}`);
    }
  }

  const existingFixtures = fixtures.filter((fixture) => existsSync(path.join(fixtureDir, fixture)));
  if (existingFixtures.length > 0) {
    const htmlParts = await Promise.all(existingFixtures.map((fixture) => readFile(path.join(fixtureDir, fixture), 'utf8')));
    const html = htmlParts.join('\n');
    for (const evidence of task.expectedEvidence ?? []) {
      if (!html.toLowerCase().includes(String(evidence).toLowerCase())) {
        errors.push(`${label}: fixtures do not contain expected evidence "${evidence}"`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Eval fixture validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Eval fixtures ok: ${tasks.length} tasks, ${ids.size} unique ids`);

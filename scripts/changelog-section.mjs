#!/usr/bin/env node
// Prints the CHANGELOG.md section for one version, for use as release notes.
// Usage: node scripts/changelog-section.mjs 1.4.0
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('usage: changelog-section.mjs <version>');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');

// Sections start at "## [1.4.0]" and run to the next "## " heading.
const lines = changelog.split('\n');
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`No CHANGELOG section for ${version}. Add one before tagging.`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith('## '));
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

if (!body) {
  console.error(`The CHANGELOG section for ${version} is empty.`);
  process.exit(1);
}
console.log(body);

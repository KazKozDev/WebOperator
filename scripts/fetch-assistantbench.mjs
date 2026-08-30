#!/usr/bin/env node
// Download the AssistantBench dev split and convert it to the eval task format used by
// scripts/eval-extension.mjs. Only the dev split carries gold answers — the test split
// ships them as null because scoring there happens on the project's own leaderboard.
//
//   node scripts/fetch-assistantbench.mjs [--limit N] [--difficulty Easy|Medium|Hard]
//                                         [--start-url URL] [--out FILE]
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://huggingface.co/datasets/AssistantBench/AssistantBench/resolve/main/assistant_bench_v1.0_dev.jsonl';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = parseArgs(process.argv.slice(2));
const startUrl = args['start-url'] ?? 'https://duckduckgo.com/';
const outPath = path.resolve(root, args.out ?? 'evals/assistantbench.json');

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const rows = (await res.text())
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

let tasks = rows
  .filter((row) => row.answer)
  .map((row) => ({
    id: `ab-${row.id.slice(0, 8)}`,
    title: truncate(row.task, 70),
    source: 'assistantbench-dev',
    difficulty: row.difficulty ?? null,
    startUrl,
    prompt: row.task,
    goldAnswer: row.answer,
    goldUrls: String(row.gold_url ?? '').split('\n').filter(Boolean),
  }));

if (args.difficulty) {
  const want = String(args.difficulty).toLowerCase();
  tasks = tasks.filter((task) => String(task.difficulty).toLowerCase() === want);
}
if (args.limit) tasks = tasks.slice(0, Number(args.limit));

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(tasks, null, 2)}\n`);

const byDifficulty = tasks.reduce((acc, task) => {
  acc[task.difficulty ?? 'unknown'] = (acc[task.difficulty ?? 'unknown'] ?? 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${tasks.length} tasks to ${path.relative(root, outPath)}`);
console.log(`Difficulty: ${Object.entries(byDifficulty).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`Start URL: ${startUrl}`);

function truncate(value, max) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

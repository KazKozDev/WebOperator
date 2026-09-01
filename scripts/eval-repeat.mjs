#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const traceDir = path.join(root, 'evals', 'traces');
const reportDir = path.join(root, 'evals', 'reports');
const tasks = JSON.parse(await readFile(path.join(root, 'evals', 'tasks.json'), 'utf8'));

const { runs, passThrough } = parseArgs(process.argv.slice(2));
// Only the tasks this invocation actually asked for. Without this the summary reads
// every trace file in the directory, so a filtered run reports stale results from an
// earlier one as if they had just passed.
const selectedTasks = selectTasks(tasks, passThrough);
const startedAt = new Date().toISOString();
const runResults = [];

await mkdir(reportDir, { recursive: true });

for (let i = 1; i <= runs; i++) {
  console.log(`\n== Eval run ${i}/${runs} ==`);
  const started = Date.now();
  const result = await runEvalExtension(passThrough);
  const traces = await summarizeTraces(started);
  runResults.push({
    run: i,
    ok: result.code === 0 && traces.every((trace) => trace.ok),
    exitCode: result.code,
    durationMs: Date.now() - started,
    traces,
  });

  for (const trace of traces) {
    const marker = trace.ok ? 'ok' : 'fail';
    console.log(`${marker}: ${trace.id} status=${trace.status} model=${trace.modelUsed ?? 'unknown'} steps=${trace.steps} llmMs=${Math.round(trace.llmMs)}`);
    for (const error of trace.errors) console.log(`  - ${error}`);
  }

  if (result.code !== 0) {
    console.log(`eval-extension exited with ${result.code}`);
    break;
  }
}

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  requestedRuns: runs,
  completedRuns: runResults.length,
  ok: runResults.length === runs && runResults.every((run) => run.ok),
  provider: process.env.WEBOPERATOR_PROVIDER ?? 'ollama',
  model: process.env.WEBOPERATOR_MODEL ?? undefined,
  runs: runResults,
};

const reportPath = path.join(reportDir, `eval-repeat-${startedAt.replace(/[:.]/g, '-')}.json`);
await writeFile(reportPath, JSON.stringify(summary, null, 2));

console.log(`\nReport: ${path.relative(root, reportPath)}`);
if (!summary.ok) process.exit(1);
console.log(`Eval repeat ok: ${summary.completedRuns}/${summary.requestedRuns} runs`);

function parseArgs(argv) {
  let runs = Number(process.env.WEBOPERATOR_EVAL_RUNS ?? 3);
  const passThrough = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') runs = Number(argv[++i]);
    else passThrough.push(arg);
  }

  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  return { runs, passThrough };
}

function runEvalExtension(passThrough) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(root, 'scripts', 'eval-extension.mjs'), ...passThrough], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve({ code: code ?? 1 }));
    child.on('error', reject);
  });
}

function selectTasks(all, passThrough) {
  const taskIndex = passThrough.indexOf('--task');
  if (taskIndex >= 0) {
    const id = passThrough[taskIndex + 1];
    return all.filter((task) => task.id === id);
  }
  const matchIndex = passThrough.indexOf('--match');
  if (matchIndex >= 0) {
    const needle = passThrough[matchIndex + 1];
    return all.filter((task) => task.id.includes(needle));
  }
  return all;
}

async function summarizeTraces(runStartedAt) {
  const traces = [];
  for (const task of selectedTasks) {
    const tracePath = path.join(traceDir, `${task.id}.json`);
    if (existsSync(tracePath) && (await stat(tracePath)).mtimeMs < runStartedAt) {
      traces.push({
        id: task.id,
        ok: false,
        status: 'stale',
        modelUsed: undefined,
        steps: 0,
        llmMs: 0,
        errors: ['trace file was not rewritten by this run'],
      });
      continue;
    }
    if (!existsSync(tracePath)) {
      traces.push({
        id: task.id,
        ok: false,
        status: 'missing',
        modelUsed: undefined,
        steps: 0,
        llmMs: 0,
        errors: ['trace file missing'],
      });
      continue;
    }
    const trace = JSON.parse(await readFile(tracePath, 'utf8'));
    const steps = Array.isArray(trace.result?.steps) ? trace.result.steps : [];
    const llmMs = steps.reduce((sum, step) => sum + Number(step.timings?.llmMs ?? 0), 0);
    const errors = Array.isArray(trace.errors) ? trace.errors : [];
    traces.push({
      id: task.id,
      ok: trace.result?.status === 'done' && errors.length === 0,
      status: trace.result?.status ?? 'missing',
      modelUsed: trace.result?.modelUsed,
      steps: steps.length,
      llmMs,
      errors,
    });
  }
  return traces;
}

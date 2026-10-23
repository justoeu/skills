import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { initRun, updateTask } from '../run-meta.mjs';
import { readJson, writeJson, artifactIdentity } from '../state-io.mjs';
import { buildReport } from '../build-report.mjs';
import { writeTaskProgress } from '../task-progress.mjs';
import { watchReport, reportWatchStatus, stopReportWatch } from '../report-watch.mjs';

const cli = fileURLToPath(new URL('../report-watch.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-watch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'spec.md'), 'Create an export.');
  const { dir } = initRun(root, { spec: 'spec.md' });
  writeJson(path.join(dir, 'TASKS.json'), { tasks: [{ id: 'T-001', title: 'Exportação', version: 1, status: 'IN_PROGRESS' }] });
  buildReport(dir);
  return dir;
}
const html = dir => fs.readFileSync(path.join(dir, 'report.html'), 'utf8');

test('default watcher renders immediately and after ten minutes with updated task data', async t => {
  const dir = fixture(t), abort = new AbortController(), times = [];
  let clock = Date.now();
  await watchReport(dir, { signal: abort.signal, now: () => clock, wait: async ms => { clock += ms; },
    onCycle: event => {
      assert.equal(event.ok, true); times.push(Date.parse(event.at));
      if (times.length === 1) {
        const doc = readJson(path.join(dir, 'TASKS.json'));
        doc.tasks[0].notes = 'Validação de CSV concluída'; writeJson(path.join(dir, 'TASKS.json'), doc);
      } else abort.abort();
    },
  });
  assert.deepEqual(times.map(time => time - times[0]), [0, 600000]);
  assert.match(html(dir), /Validação de CSV concluída/);
  assert.equal(reportWatchStatus(dir).status, 'stopped');
  assert.match(html(dir), /data-auto-refresh="false"/);
});

test('one watcher owns the pack and cooperative stop flushes the last change', async t => {
  const dir = fixture(t), abort = new AbortController();
  t.after(() => abort.abort());
  let started; const ready = new Promise(resolve => { started = resolve; });
  const running = watchReport(dir, { signal: abort.signal, onCycle: started });
  await ready;
  await assert.rejects(watchReport(dir), /already running/);
  const tasks = readJson(path.join(dir, 'TASKS.json'));
  tasks.tasks[0].notes = 'Última alteração antes da pausa'; writeJson(path.join(dir, 'TASKS.json'), tasks);
  const stopped = await stopReportWatch(dir);
  assert.equal(stopped.status, 'stopped');
  assert.match(html(dir), /Última alteração antes da pausa/);
  await running;
});

for (const finalFails of [false, true]) {
  test(`stop confirms its original watcher when another starts immediately (${finalFails ? 'failed' : 'successful'} final render)`, { timeout: 20000 }, async t => {
    const dir = fixture(t), abort = new AbortController();
    const originalTasks = readJson(path.join(dir, 'TASKS.json'));
    let readyResolve, replacementResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const replacementReady = new Promise(resolve => { replacementResolve = resolve; });
    const first = watchReport(dir, { wait: () => delay(10), onCycle: readyResolve });
    await ready;
    const firstToken = reportWatchStatus(dir).token;
    let replacement;
    const replace = () => {
      writeJson(path.join(dir, 'TASKS.json'), originalTasks);
      replacement = watchReport(dir, { signal: abort.signal, onCycle: replacementResolve });
    };
    let firstFailure;
    const transition = first.then(replace, error => { firstFailure = error; replace(); });
    try {
      if (finalFails) fs.writeFileSync(path.join(dir, 'TASKS.json'), '{partial');
      const stop = stopReportWatch(dir).then(value => ({ value }), error => ({ error }));
      await replacementReady;
      const result = await stop;
      assert.equal(reportWatchStatus(dir).running, true);
      assert.notEqual(reportWatchStatus(dir).token, firstToken);
      if (finalFails) {
        assert.ok(firstFailure);
        assert.equal(result.error?.message, firstFailure.message);
      } else {
        assert.equal(result.error, undefined);
        assert.equal(result.value.token, firstToken);
        assert.equal(result.value.status, 'stopped');
        assert.equal(result.value.running, false);
      }
    } finally { abort.abort(); await transition; await replacement; }
  });
}

test('three failed renders preserve previous HTML and record failure', async t => {
  const dir = fixture(t), previous = html(dir);
  fs.writeFileSync(path.join(dir, 'TASKS.json'), '{partial');
  let clock = Date.now(), attempts = 0;
  await assert.rejects(watchReport(dir, { now: () => clock, wait: async ms => { clock += ms; },
    onCycle: event => { assert.equal(event.ok, false); attempts++; },
  }), /failed three times/);
  assert.equal(attempts, 3); assert.equal(html(dir), previous);
  assert.equal(reportWatchStatus(dir).status, 'failed');
  assert.ok(reportWatchStatus(dir).last_error);
});

test('closed metadata stops the watcher and disallows restart', async t => {
  const dir = fixture(t);
  await watchReport(dir, { wait: async () => {}, onCycle: () => {
    const meta = readJson(path.join(dir, 'run-meta.json'));
    meta.status = 'closed'; writeJson(path.join(dir, 'run-meta.json'), meta);
  } });
  assert.equal(reportWatchStatus(dir).reason, 'closed');
  await assert.rejects(watchReport(dir), /active identified run/);
});

test('ownership change does not overwrite another run or its report', async t => {
  const dir = fixture(t);
  await assert.rejects(watchReport(dir, { wait: async () => {}, onCycle: () => {
    const meta = readJson(path.join(dir, 'run-meta.json'));
    meta.run_id = 'replacement-run'; writeJson(path.join(dir, 'run-meta.json'), meta);
    writeJson(path.join(dir, 'report-watch.json'), { token: 'replacement', run_id: meta.run_id, status: 'stopped' });
    fs.writeFileSync(path.join(dir, 'report.html'), 'replacement report');
  } }), /ownership changed/);
  assert.equal(html(dir), 'replacement report');
  assert.equal(reportWatchStatus(dir).token, 'replacement');
});

test('dead watcher can be stopped and restarted without signaling an unrelated process', async t => {
  const dir = fixture(t), run_id = readJson(path.join(dir, 'run-meta.json')).run_id;
  const processResult = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  writeJson(path.join(dir, 'report-watch.json'), { run_id, token: 'dead', pid: processResult.pid, status: 'running' });
  assert.equal(reportWatchStatus(dir).running, false);
  await stopReportWatch(dir);
  assert.match(html(dir), /data-auto-refresh="false"/);
  const abort = new AbortController();
  await watchReport(dir, { signal: abort.signal, onCycle: () => abort.abort() });
  assert.notEqual(reportWatchStatus(dir).token, 'dead');
  assert.equal(reportWatchStatus(dir).status, 'stopped');
});

test('invalid intervals fail before taking ownership', async t => {
  const dir = fixture(t);
  for (const intervalMs of [0, -1, NaN, Infinity, 999, 86400001])
    await assert.rejects(watchReport(dir, { intervalMs }), /report interval/);
  assert.equal(fs.existsSync(path.join(dir, 'report-watch.json')), false);
});

test('progress is visible but cannot change task status, versions, evidence or closure inputs', t => {
  const dir = fixture(t), original = readJson(path.join(dir, 'TASKS.json')), identity = artifactIdentity(dir);
  writeTaskProgress(dir, { id: 'T-001', expected_version: 1, summary: 'Parser implementado; testes pendentes.',
    completed: ['Leitura de CSV'], next: ['Executar os testes'], blockers: [],
    status: 'DONE', red_green: true,
  });
  assert.deepEqual(readJson(path.join(dir, 'TASKS.json')), original);
  assert.equal(artifactIdentity(dir), identity);
  assert.match(html(dir), /Parser implementado; testes pendentes/);
  assert.match(html(dir), /ainda não validado/);
  assert.match(html(dir), /data-status="IN_PROGRESS"/);
  assert.throws(() => writeTaskProgress(dir, { id: '../outside', expected_version: 1, summary: 'x' }), /invalid task id/);
  assert.throws(() => writeTaskProgress(dir, { id: 'T-001', expected_version: 0, summary: 'x' }), /stale progress/);
  assert.throws(() => writeTaskProgress(dir, { id: 'T-001', expected_version: 1, summary: 'x', next: 'invalid' }), /invalid progress/);
  updateTask(dir, { id: 'T-001', expected_version: 1, patch: { notes: 'Nova versão aplicada' } });
  assert.doesNotMatch(html(dir), /Parser implementado; testes pendentes/);
});

test('progress from another run is not shown and embedded HTML remains inert', t => {
  const dir = fixture(t);
  writeTaskProgress(dir, { id: 'T-001', expected_version: 1, summary: '<script>forged()</script>' });
  assert.doesNotMatch(html(dir), /<script>forged\(\)<\/script>/);
  const file = path.join(dir, 'progress/T-001.json'), progress = readJson(file);
  progress.run_id = 'other'; writeJson(file, progress); buildReport(dir);
  assert.doesNotMatch(html(dir), /forged\(\)/);
});

test('real CLI renders on timer, reports status, rejects duplicates and flushes on SIGTERM', { timeout: 15000 }, async t => {
  const dir = fixture(t);
  const child = spawn(process.execPath, [cli, 'start', '--dir', dir, '--interval-seconds', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const exit = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  let buffer = '', cycles = 0, readyResolve, secondResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; }), second = new Promise(resolve => { secondResolve = resolve; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.ok) { cycles++; if (cycles === 1) readyResolve(); if (cycles === 2) secondResolve(); }
    }
  });
  await ready;
  const status = spawnSync(process.execPath, [cli, 'status', '--dir', dir], { encoding: 'utf8' });
  assert.equal(JSON.parse(status.stdout).running, true);
  const duplicate = spawnSync(process.execPath, [cli, 'start', '--dir', dir], { encoding: 'utf8' });
  assert.equal(duplicate.status, 1); assert.match(duplicate.stderr, /already running/);
  const doc = readJson(path.join(dir, 'TASKS.json')); doc.tasks[0].notes = 'Atualização entre ciclos reais';
  writeJson(path.join(dir, 'TASKS.json'), doc); await second;
  assert.match(html(dir), /Atualização entre ciclos reais/);
  child.kill('SIGTERM'); assert.equal((await exit).code, 0);
  assert.equal(reportWatchStatus(dir).running, false);
  assert.match(html(dir), /data-auto-refresh="false"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { initRun } from '../run-meta.mjs';
import { readJson, writeJson, artifactIdentity } from '../state-io.mjs';
import { buildReport } from '../build-report.mjs';
import { watchReport, stopReportWatch, reportWatchStatus } from '../report-watch.mjs';
import { prepareNativeReport, bindNativeReport, tickNativeReport, stopNativeReport } from '../report-native.mjs';

const cli = fileURLToPath(new URL('../report-native.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-native-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'spec.md'), 'Export CSV.');
  const { dir } = initRun(root, { spec: 'spec.md' });
  writeJson(path.join(dir, 'TASKS.json'), { tasks: [{ id: 'T-001', title: 'CSV', status: 'IN_PROGRESS', version: 1 }] });
  buildReport(dir);
  return dir;
}
const html = dir => fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
const prepare = (dir, options = {}) => prepareNativeReport(dir, { kind: 'subtask', provider: 'fixture-agent', ...options });

test('native scheduler binds a real handle before rendering and never promotes task results', t => {
  const dir = fixture(t), identity = artifactIdentity(dir), original = readJson(path.join(dir, 'TASKS.json'));
  const state = prepare(dir);
  assert.equal(state.pid, undefined);
  assert.equal(state.status, 'starting');
  assert.equal(tickNativeReport(dir, state.token).waiting_for_binding, true);
  assert.throws(() => bindNativeReport(dir, state.token, ''), /id is required/);
  bindNativeReport(dir, state.token, 'agent-123');
  assert.throws(() => bindNativeReport(dir, state.token, 'agent-other'), /already bound/);
  const first = tickNativeReport(dir, state.token);
  assert.ok(first.last_success_at);
  assert.match(html(dir), /data-auto-refresh="true"/);
  assert.equal(reportWatchStatus(dir).liveness, 'check-native-tool');
  assert.equal(artifactIdentity(dir), identity);
  assert.deepEqual(readJson(path.join(dir, 'TASKS.json')), original);
});

test('native callbacks include newly recorded data at ten minutes and flag missing heartbeats without freeing ownership', async t => {
  const dir = fixture(t), now = new Date();
  const state = prepare(dir, { kind: 'schedule', now });
  bindNativeReport(dir, state.token, 'job-123');
  tickNativeReport(dir, state.token, { now });
  const tasks = readJson(path.join(dir, 'TASKS.json'));
  tasks.tasks[0].notes = 'Updated by implementer'; writeJson(path.join(dir, 'TASKS.json'), tasks);
  const next = new Date(now.getTime() + 600000);
  const result = tickNativeReport(dir, state.token, { now: next });
  assert.equal(result.last_success_at, next.toISOString());
  assert.match(html(dir), /Updated by implementer/);
  assert.equal(reportWatchStatus(dir, { now: next.getTime() + 720001 }).stale, true);
  await assert.rejects(watchReport(dir), /already running/);
  await assert.rejects(stopReportWatch(dir), /cancel the native job/);
  assert.equal(readJson(path.join(dir, 'report-watch.json')).stop_requested, undefined);
});

test('a successful native recovery clears the stale alert in the same HTML publication', t => {
  const dir = fixture(t), state = prepare(dir, { now: new Date(Date.now() - 900000) });
  bindNativeReport(dir, state.token, 'job-123');
  assert.equal(reportWatchStatus(dir).stale, true);
  tickNativeReport(dir, state.token);
  assert.equal(reportWatchStatus(dir).stale, false);
  assert.doesNotMatch(html(dir), /Sem ciclo nativo confirmado no intervalo esperado/);
});

test('concurrent native stops cannot overwrite a successful stop with failure', { timeout: 15000 }, async t => {
  const dir = fixture(t), state = prepare(dir);
  bindNativeReport(dir, state.token, 'job-123'); tickNativeReport(dir, state.token);
  const paused = path.join(dir, 'test-paused'), release = path.join(dir, 'test-release');
  const preload = path.join(dir, 'test-pause-stop.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
    const original = fs.rmSync; let paused = false;
    fs.rmSync = function (target, options) {
      const result = original.call(this, target, options);
      if (!paused && String(target) === ${JSON.stringify(path.join(dir, '.writer-lock'))}) {
        paused = true; fs.writeFileSync(${JSON.stringify(paused)}, 'ready');
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(${JSON.stringify(release)})) {
          if (Date.now() > deadline) throw Error('test barrier timeout');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      return result;
    };`);
  const child = spawn(process.execPath, ['--import', preload, cli, 'stop', '--dir', dir, '--token', state.token],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const exit = new Promise(resolve => child.once('exit', code => resolve(code)));
  try {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(paused)) { assert.ok(Date.now() < deadline, 'child reaches barrier'); await delay(10); }
    assert.equal(stopNativeReport(dir, state.token).status, 'stopped');
    fs.writeFileSync(release, 'go');
    assert.equal(await exit, 0, stderr);
    assert.equal(reportWatchStatus(dir).status, 'stopped');
    assert.equal(reportWatchStatus(dir).last_error, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit;
  }
});

test('native and Node schedulers cannot overlap, including pending native setup', async t => {
  const dir = fixture(t), state = prepare(dir);
  await assert.rejects(watchReport(dir), /already running/);
  assert.throws(() => prepare(dir), /already running/);
  stopNativeReport(dir, state.token);
  const abort = new AbortController();
  await watchReport(dir, { signal: abort.signal, onCycle: () => {
    assert.throws(() => prepare(dir), /already running/);
    abort.abort();
  } });
  const next = prepare(dir);
  assert.notEqual(next.token, state.token);
  assert.throws(() => tickNativeReport(dir, state.token), /ownership changed/);
});

test('stop flushes the last change and fences delayed callbacks before Node fallback', async t => {
  const dir = fixture(t), state = prepare(dir);
  bindNativeReport(dir, state.token, 'job-123'); tickNativeReport(dir, state.token);
  const tasks = readJson(path.join(dir, 'TASKS.json'));
  tasks.tasks[0].notes = 'Final change'; writeJson(path.join(dir, 'TASKS.json'), tasks);
  const stopped = stopNativeReport(dir, state.token);
  assert.equal(stopped.running, false);
  assert.match(html(dir), /Final change/);
  assert.match(html(dir), /data-auto-refresh="false"/);
  const finalHtml = html(dir);
  assert.throws(() => tickNativeReport(dir, state.token), /stopped or failed/);
  assert.throws(() => buildReport(dir, { strict: true, watcherToken: state.token }), /ownership or status changed/);
  assert.equal(html(dir), finalHtml);
  const abort = new AbortController();
  await watchReport(dir, { signal: abort.signal, onCycle: () => {
    const currentHtml = html(dir);
    assert.throws(() => tickNativeReport(dir, state.token), /ownership changed/);
    assert.throws(() => stopNativeReport(dir, state.token), /ownership changed/);
    assert.equal(html(dir), currentHtml);
    abort.abort();
  } });
});

test('three failed native callbacks preserve the previous HTML and require recovery', t => {
  const dir = fixture(t), state = prepare(dir);
  bindNativeReport(dir, state.token, 'job-123'); tickNativeReport(dir, state.token);
  const previous = html(dir);
  fs.writeFileSync(path.join(dir, 'TASKS.json'), '{partial');
  for (let i = 1; i <= 3; i++) {
    assert.throws(() => tickNativeReport(dir, state.token));
    assert.equal(reportWatchStatus(dir).failures, i);
    assert.equal(html(dir), previous);
  }
  assert.equal(reportWatchStatus(dir).status, 'failed');
  assert.throws(() => tickNativeReport(dir, state.token), /stopped or failed/);
  assert.throws(() => stopNativeReport(dir, state.token));
  assert.equal(reportWatchStatus(dir).status, 'failed');
  assert.equal(html(dir), previous);
});

test('closed run revokes native callbacks and cannot acquire another native scheduler', t => {
  const dir = fixture(t), state = prepare(dir);
  bindNativeReport(dir, state.token, 'job-123');
  const file = path.join(dir, 'run-meta.json'), meta = readJson(file);
  writeJson(file, { ...meta, status: 'closed' });
  assert.equal(tickNativeReport(dir, state.token).status, 'stopped');
  assert.match(html(dir), /data-auto-refresh="false"/);
  assert.throws(() => prepare(dir), /active identified run/);
});

test('another run cannot be modified by a delayed native callback', t => {
  const dir = fixture(t), state = prepare(dir);
  bindNativeReport(dir, state.token, 'job-123');
  const file = path.join(dir, 'run-meta.json'), meta = readJson(file);
  writeJson(file, { ...meta, run_id: 'replacement' });
  const previous = html(dir), previousState = readJson(path.join(dir, 'report-watch.json'));
  assert.throws(() => tickNativeReport(dir, state.token), /ownership changed/);
  assert.throws(() => stopNativeReport(dir, state.token), /ownership changed/);
  assert.equal(html(dir), previous);
  assert.deepEqual(readJson(path.join(dir, 'report-watch.json')), previousState);
});

test('native CLI prepares, binds, publishes and stops without starting a Node timer', t => {
  const dir = fixture(t);
  const call = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--dir', dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const state = call('prepare', '--kind', 'schedule', '--provider', 'fixture-cron');
  call('bind', '--token', state.token, '--id', 'job-123');
  assert.ok(call('tick', '--token', state.token).last_success_at);
  assert.equal(call('stop', '--token', state.token).running, false);
});

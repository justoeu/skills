import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initRun, updateTask, stampFile, closeRun } from '../run-meta.mjs';
import { captureEvidence, readJson, writeJson, validSeal } from '../state-io.mjs';
import { scorePack } from '../score.mjs';
import { inferNextStep } from '../resume.mjs';
import { HOOK_IDS } from '../hooks.mjs';
import { buildReport } from '../build-report.mjs';

const cli = fileURLToPath(new URL('../run-meta.mjs', import.meta.url));
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'spec.md'), 'Double the amount. Preserve zero.');
  fs.writeFileSync(path.join(root, 'product.mjs'), 'export const double = x => x * 2;\n');
  fs.writeFileSync(
    path.join(root, 'product.test.mjs'),
    "import {double} from './product.mjs'; import assert from 'node:assert/strict'; assert.equal(double(3),6); assert.equal(double(0),0);\n",
  );
  const { dir, meta } = initRun(root, {
    spec: 'spec.md',
    branch: 'feature/cart',
    test_cmd: 'node --test product.test.mjs',
  });
  writeJson(path.join(dir, 'hooks/arch-map.json'), { source: 'manual', style: 'single module' });
  writeJson(path.join(dir, 'TASKS.json'), {
    tasks: [
      {
        id: 'T-1',
        title: 'Double',
        worktree: 1,
        version: 0,
        validation: 'red-green',
        status: 'DONE',
        tests_added: 1,
        red_green: true,
        red: { command: 'node --test product.test.mjs', output_excerpt: 'expected 6 got 3' },
        green: { command: 'node --test product.test.mjs', output_excerpt: 'pass' },
      },
    ],
  });
  writeJson(path.join(dir, 'worktrees.json'), { skipped: true, reason: 'fixture without Git' });
  writeJson(path.join(dir, 'payloads.json'), []);
  return { root, dir, meta };
}
function verifyAll(root, dir) {
  const snap = captureEvidence(dir);
  const result = spawnSync(process.execPath, ['--test', 'product.test.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const artifacts = {
    'tests.json': {
      cmd: 'node --test product.test.mjs',
      ok: result.status === 0,
      failed: 0,
      log: result.stdout,
    },
    'coverage.json': { pct: 100, floor: 90, tool: 'fixture', scope: 'double' },
    'immutability.json': {
      green: true,
      command: 'node --test product.test.mjs',
      tests: ['zero remains zero'],
    },
    'hooks/ui-scope.json': { ui_touched: false },
    'project-gates.json': { gates: [], reason: 'fixture has no extra gates' },
    'tracking.json': { files: [], reason: 'fixture has no canonical progress files' },
  };
  for (const axis of ['standards', 'spec', 'correctness'])
    artifacts[`reviews/${axis}.json`] = { axis, verdict: 'APPROVE', findings: [] };
  for (const hook of HOOK_IDS) artifacts[`hooks/${hook}.json`] = { hook, verdict: 'APPROVE', findings: [] };
  for (const [file, doc] of Object.entries(artifacts)) {
    writeJson(path.join(dir, file), doc);
    stampFile(dir, file, snap);
  }
  return snap;
}

test('F20: same day and slash branch initialize distinct runs without changing old evidence', (t) => {
  const { root, dir } = setup(t);
  writeJson(path.join(dir, 'old-evidence.json'), { value: 'preserve' });
  const next = initRun(root, { branch: 'feature/cart', spec: 'spec.md' });
  assert.notEqual(next.dir, dir);
  assert.notEqual(next.meta.run_id, readJson(path.join(dir, 'run-meta.json')).run_id);
  assert.equal(readJson(path.join(dir, 'old-evidence.json')).value, 'preserve');
  assert.ok(!path.basename(next.dir).includes('/'));
});
test('F13: supplied spec still produces an explicit architecture setup state', (t) => {
  const { root } = setup(t);
  const { dir } = initRun(root, { spec: 'spec.md' });
  assert.equal(readJson(path.join(dir, 'hooks/arch-map.json')).source, 'pending');
});
test('F10: task patches preserve other tasks and reject a stale writer', (t) => {
  const { dir } = setup(t);
  writeJson(path.join(dir, 'TASKS.json'), {
    tasks: [
      { id: 'A', version: 0, status: 'OPEN' },
      { id: 'B', version: 0, status: 'OPEN' },
    ],
  });
  updateTask(dir, { id: 'A', expected_version: 0, patch: { status: 'IN_PROGRESS' } });
  updateTask(dir, { id: 'B', expected_version: 0, patch: { status: 'BLOCKED' } });
  assert.throws(() => updateTask(dir, { id: 'A', expected_version: 0, patch: { status: 'DONE' } }), /stale/);
  const tasks = readJson(path.join(dir, 'TASKS.json')).tasks;
  assert.deepEqual(
    tasks.map((t) => t.status),
    ['IN_PROGRESS', 'BLOCKED'],
  );
  const md = fs.readFileSync(path.join(dir, 'TASKS.md'), 'utf8');
  assert.ok(md.includes('IN_PROGRESS') && md.includes('BLOCKED'));
});
test('F10: simultaneous CLI writers cannot overwrite a task revision', async (t) => {
  const { dir } = setup(t);
  writeJson(path.join(dir, 'TASKS.json'), { tasks: [{ id: 'A', version: 0, status: 'OPEN' }] });
  const result = path.join(dir, 'result.json');
  writeJson(result, { id: 'A', expected_version: 0, patch: { status: 'IN_PROGRESS' } });
  const run = () =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [cli, 'task', '--dir', dir, '--result', result], { stdio: 'ignore' });
      p.on('exit', resolve);
    });
  const outcomes = await Promise.all([run(), run()]);
  assert.equal(outcomes.filter((x) => x === 0).length, 1);
  assert.equal(readJson(path.join(dir, 'TASKS.json')).tasks[0].version, 1);
});
test('F08: changed product rejects a pre-change snapshot and invalidates accepted results', (t) => {
  const { root, dir } = setup(t);
  const snapshot = verifyAll(root, dir);
  assert.equal(scorePack(dir).closable, true);
  fs.appendFileSync(path.join(root, 'product.mjs'), '// additional product change\n');
  assert.throws(() => stampFile(dir, 'tests.json', snapshot), /changed/);
  assert.equal(scorePack(dir).closable, false);
  assert.notEqual(inferNextStep(dir, []), 'closed');
  assert.throws(() => closeRun(dir), /stale/);
});
test('F08: changed contract inputs invalidate results without product changes', (t) => {
  const { root, dir } = setup(t);
  verifyAll(root, dir);
  assert.equal(scorePack(dir).closable, true);
  writeJson(path.join(dir, 'payloads.json'), [{ kind: 'cli', request: 'new' }]);
  assert.equal(scorePack(dir).closable, false);
});
test('F03/F08: complete verified run closes, reports history, and evidence edits break its seal', (t) => {
  const { root, dir } = setup(t);
  verifyAll(root, dir);
  assert.equal(inferNextStep(dir, []), 'close');
  closeRun(dir);
  assert.ok(validSeal(dir));
  assert.equal(inferNextStep(dir, []), 'closed');
  const html = buildReport(dir).html;
  assert.ok(html.includes('Resultado histórico'));
  fs.appendFileSync(path.join(root, 'product.mjs'), '// later independent work\n');
  assert.equal(inferNextStep(dir, []), 'closed', 'historical close is not approval of later work');
  const tests = readJson(path.join(dir, 'tests.json'));
  tests.ok = false;
  tests.failed = 1;
  writeJson(path.join(dir, 'tests.json'), tests);
  assert.equal(validSeal(dir), null);
  assert.notEqual(inferNextStep(dir, []), 'closed');
});
test('project gates and canonical tracking must complete before close', (t) => {
  const { root, dir } = setup(t);
  const snapshot = verifyAll(root, dir);
  writeJson(path.join(dir, 'project-gates.json'), {
    gates: [{ name: 'required CI', status: 'OPEN', evidence: 'unavailable' }],
  });
  stampFile(dir, 'project-gates.json', snapshot);
  assert.equal(scorePack(dir).pack_closable, true);
  assert.equal(scorePack(dir).closable, false);
  assert.equal(inferNextStep(dir, []), 'project-gates');
});
test('refactor uses true before/after characterization instead of a fabricated RED', (t) => {
  const { root, dir } = setup(t);
  const doc = readJson(path.join(dir, 'TASKS.json'));
  doc.tasks[0] = {
    ...doc.tasks[0],
    validation: 'characterization',
    red_green: false,
    tests_added: 0,
    before: { ok: true, command: 'test', output_excerpt: 'pass before' },
    after: { ok: true, command: 'test', output_excerpt: 'pass after' },
  };
  writeJson(path.join(dir, 'TASKS.json'), doc);
  verifyAll(root, dir);
  assert.equal(scorePack(dir).score, 10);
  assert.equal(scorePack(dir).closable, true);
});

test('external and in-pack specs invalidate snapshots when their content changes', (t) => {
  const { root, dir } = setup(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-external-spec-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  for (const spec of [path.join(external, 'spec.md'), path.join(dir, 'spec.md')]) {
    fs.writeFileSync(spec, 'initial contract');
    writeJson(path.join(dir, 'run-meta.json'), { ...readJson(path.join(dir, 'run-meta.json')), spec });
    const snap = verifyAll(root, dir);
    fs.writeFileSync(spec, 'changed contract');
    assert.throws(() => stampFile(dir, 'tests.json', snap), /changed/);
    assert.equal(scorePack(dir).closable, false);
  }
});
test('editing a result after stamping invalidates that artifact', (t) => {
  const { root, dir } = setup(t);
  verifyAll(root, dir);
  const file = path.join(dir, 'reviews/spec.json'),
    doc = readJson(file);
  doc.summary = 'another result written after verification';
  writeJson(file, doc);
  assert.equal(scorePack(dir).closable, false);
});
test('architecture pending blocks closure even with all outputs stamped', (t) => {
  const { root, dir } = setup(t);
  writeJson(path.join(dir, 'hooks/arch-map.json'), { source: 'pending' });
  verifyAll(root, dir);
  assert.equal(scorePack(dir).closable, false);
});
test('UI touched requires acceptance, OPEN and SKIP cannot substitute for running it', (t) => {
  const { root, dir } = setup(t);
  const snap = verifyAll(root, dir);
  writeJson(path.join(dir, 'hooks/ui-scope.json'), { ui_touched: true });
  stampFile(dir, 'hooks/ui-scope.json', snap);
  for (const verdict of ['OPEN', 'SKIP']) {
    writeJson(path.join(dir, 'hooks/ui-acceptance.json'), { hook: 'ui-acceptance', verdict, findings: [] });
    stampFile(dir, 'hooks/ui-acceptance.json', snap);
    assert.equal(scorePack(dir).closable, false, verdict);
  }
});
test('malformed review findings cannot be waived by an unrecognized severity', (t) => {
  const { root, dir } = setup(t);
  const snap = verifyAll(root, dir);
  writeJson(path.join(dir, 'reviews/spec.json'), {
    axis: 'spec',
    verdict: 'APPROVE',
    findings: [{ id: 'S-1', severity: 'typo', status: 'wontfix' }],
  });
  stampFile(dir, 'reviews/spec.json', snap);
  assert.equal(scorePack(dir).closable, false);
});
test('a cyclic plan or non-existent canonical tracking file blocks closure', (t) => {
  const { root, dir } = setup(t);
  const doc = readJson(path.join(dir, 'TASKS.json'));
  doc.tasks[0].depends_on = ['T-1'];
  writeJson(path.join(dir, 'TASKS.json'), doc);
  verifyAll(root, dir);
  assert.equal(scorePack(dir).closable, false);
  doc.tasks[0].depends_on = [];
  writeJson(path.join(dir, 'TASKS.json'), doc);
  const snap = verifyAll(root, dir);
  writeJson(path.join(dir, 'tracking.json'), {
    files: [{ path: 'does-not-exist.md', status: 'DONE', evidence: 'updated' }],
  });
  stampFile(dir, 'tracking.json', snap);
  assert.equal(scorePack(dir).closable, false);
});

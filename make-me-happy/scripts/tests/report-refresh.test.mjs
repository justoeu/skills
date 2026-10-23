import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initRun, updateTask, recordStep } from '../run-meta.mjs';
import { writeJson, withPackLock } from '../state-io.mjs';
import { buildReport } from '../build-report.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-report-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'spec.md'), 'Create an export.');
  const { dir } = initRun(root, { spec: 'spec.md' });
  writeJson(path.join(dir, 'TASKS.json'), { tasks: [{ id: 'T-001', title: 'Crie a exportação', status: 'OPEN', version: 0 }] });
  return dir;
}

test('applied task progress refreshes HTML without a manual build', t => {
  const dir = fixture(t);
  buildReport(dir);
  updateTask(dir, { id: 'T-001', expected_version: 0, patch: { status: 'IN_PROGRESS', notes: 'Parser CSV implementado; validação pendente.' } });
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /Parser CSV implementado; validação pendente/);
  assert.match(html, /data-status="IN_PROGRESS"/);
});

test('recorded phase refreshes HTML without a manual build', t => {
  const dir = fixture(t);
  buildReport(dir);
  recordStep(dir, 'review', 'in_progress', { note: 'Revisão dos limites CSV' });
  assert.match(fs.readFileSync(path.join(dir, 'report.html'), 'utf8'), /Revisão dos limites CSV/);
});

test('a busy writer prevents report replacement', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'report.html');
  fs.writeFileSync(file, 'previous complete HTML');
  withPackLock(dir, () => assert.throws(() => buildReport(dir), /writer busy/));
  assert.equal(fs.readFileSync(file, 'utf8'), 'previous complete HTML');
});

test('strict refresh preserves the last report when canonical task JSON is malformed', t => {
  const dir = fixture(t);
  buildReport(dir);
  const file = path.join(dir, 'report.html'), previous = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(dir, 'TASKS.json'), '{broken');
  assert.throws(() => buildReport(dir, { strict: true }));
  assert.equal(fs.readFileSync(file, 'utf8'), previous);
});

test('failed atomic publication preserves HTML and does not replay an already saved task', t => {
  const dir = fixture(t), file = path.join(dir, 'report.html');
  buildReport(dir);
  const previous = fs.readFileSync(file, 'utf8'), rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === file) throw new Error('simulated report publication failure');
    return rename(from, to);
  };
  try {
    const applied = updateTask(dir, { id: 'T-001', expected_version: 0, patch: { status: 'IN_PROGRESS', notes: 'Estado salvo durante falha do HTML' } });
    assert.equal(applied.version, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
    assert.equal(fs.readdirSync(dir).some(name => name.startsWith('report.html.') && name.endsWith('.tmp')), false);
  } finally { fs.renameSync = rename; }
  buildReport(dir);
  assert.match(fs.readFileSync(file, 'utf8'), /Estado salvo durante falha do HTML/);
});

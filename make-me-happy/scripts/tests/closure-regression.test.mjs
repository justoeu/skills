import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePack } from '../score.mjs';
import { loadPack } from '../report/load-pack.mjs';
import { renderReport } from '../report/render.mjs';
import { findPacks, inferNextStep } from '../resume.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-closure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, data) => {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(data));
  };
  write('run-meta.json', {
    app: 'test',
    branch: 'feature/test',
    kind: 'feature',
    status: 'in_progress',
    spec: 'spec.md',
    spec_status: 'confirmed',
    coverage_floor: 90,
  });
  write('TASKS.json', {
    tasks: [{ id: 'T-1', title: 'test', status: 'DONE', tests_added: 1, red_green: true }],
  });
  write('immutability.json', { green: true, tests: ['contract'] });
  write('worktrees.json', { skipped: true });
  write('coverage.json', { pct: 99, floor: 90, tool: 'fixture' });
  for (const axis of ['standards', 'spec', 'correctness'])
    write(`reviews/${axis}.json`, { verdict: 'APPROVE', findings: [] });
  return { dir, write };
}

test('F07: coverage report cannot lower the requested floor', (t) => {
  const { dir, write } = fixture(t);
  write('run-meta.json', { coverage_floor: 95 });
  write('coverage.json', { pct: 91, floor: 90 });
  assert.equal(scorePack(dir).coverage.floor, 95);
  assert.equal(scorePack(dir).closable, false);
});
test('F08: final suite failure prevents closure even with approvals', (t) => {
  const { dir, write } = fixture(t);
  write('tests.json', { ok: false, failed: 1 });
  assert.equal(scorePack(dir).closable, false);
});
test('F08: report recomputes tasks instead of using stale score', (t) => {
  const { dir, write } = fixture(t);
  write('score.json', scorePack(dir));
  write('TASKS.json', { tasks: [{ id: 'T-1', status: 'OPEN' }] });
  const pack = loadPack(dir);
  assert.equal(pack.score.score, scorePack(dir).score);
  assert.equal(pack.score.closable, false);
});
test('F08: HTML never claims closure with failed hooks', (t) => {
  const { dir, write } = fixture(t);
  write('hooks/security.json', {
    hook: 'security',
    verdict: 'REJECT',
    findings: [{ id: 'S-1', status: 'open', severity: 'high' }],
  });
  write('hooks/verdict.json', { verdict: 'FAIL', hooks: [] });
  const html = renderReport(loadPack(dir));
  assert.ok(!html.includes('pack pode fechar'));
});
test('F02: discovery finds legacy nested branch pack', (t) => {
  const { dir, write } = fixture(t);
  write('docs/impl/make-me-happy/2026-10-21-feature/demo/run-meta.json', { status: 'in_progress' });
  assert.equal(findPacks(dir).length, 1);
});
test('F12: a draft spec always resumes exploration even with tasks', (t) => {
  const { dir, write } = fixture(t);
  write('run-meta.json', { spec: 'spec.md', spec_status: 'draft' });
  assert.equal(inferNextStep(dir, []), 'explore');
});
test('F03: missing UI acceptance and failed hooks cannot resume closed', (t) => {
  const { dir, write } = fixture(t);
  write('hooks/ui-scope.json', { ui_touched: true });
  write('hooks/verdict.json', { verdict: 'FAIL' });
  assert.notEqual(inferNextStep(dir, []), 'closed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferNextStep, findPacks, resumeState } from '../resume.mjs';
import { artifactIdentity } from '../state-io.mjs';

function write(dir, rel, body) {
  const dest = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

function sealedPack(root, name, finishedAt) {
  const dir = path.join(root, 'docs', 'impl', 'make-me-happy', name);
  write(dir, 'run-meta.json', { run_id: name, status: 'closed', updated_at: finishedAt, finished_at: finishedAt });
  write(dir, 'closure.json', { run_id: name, closable: true, at: finishedAt, artifact_hash: artifactIdentity(dir) });
  write(dir, 'report.html', '<html>Historical result</html>');
  return dir;
}

test('inferNextStep walks the pipeline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-resume-'));
  assert.equal(inferNextStep(dir, []), 'explore');

  write(dir, 'run-meta.json', { spec: 'docs/s.md', spec_status: 'confirmed' });
  assert.equal(inferNextStep(dir, []), 'planner');

  write(dir, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'OPEN', tests_added: 0 }] });
  assert.equal(inferNextStep(dir, []), 'worktrees-add');

  write(dir, 'worktrees.json', { slices: [{ index: 1, merged: false }] });
  assert.equal(inferNextStep(dir, []), 'implement');

  write(dir, 'run-meta.json', {spec:'spec.md',spec_status:'confirmed'});
  write(dir, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'DONE', tests_added: 1, red_green: true }] });
  write(dir, 'worktrees.json', { slices: [{ index: 1, merged: true, removed: true }] });
  assert.equal(inferNextStep(dir, []), 'immutability');

  write(dir, 'immutability.json', { green: true, suite: ['A'] });
  assert.equal(inferNextStep(dir, []), 'review');

  write(dir, 'reviews/standards.md', 'VERDICT: APPROVE');
  write(dir, 'reviews/spec.md', 'VERDICT: APPROVE');
  write(dir, 'reviews/correctness.md', 'VERDICT: REJECT');
  assert.equal(inferNextStep(dir, []), 'review');

  write(dir, 'reviews/correctness.md', 'VERDICT: APPROVE');
  assert.equal(inferNextStep(dir, []), 'setup');

  write(dir, 'coverage.json', { pct: 96, tool: 'c8' });
  assert.notEqual(inferNextStep(dir, []), 'closed');
});

test('draft spec stays on explore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-resume-'));
  write(dir, 'run-meta.json', { spec: 'docs/s.md', spec_status: 'draft' });
  assert.equal(inferNextStep(dir, []), 'explore');
});

test('leftover worktrees require cleanup even if tasks look done', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-resume-'));
  write(dir, 'run-meta.json', {spec:'spec.md',spec_status:'confirmed'});
  write(dir, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'DONE', tests_added: 1, red_green: true }] });
  write(dir, 'worktrees.json', { slices: [{ index: 1, merged: true, removed: true }] });
  assert.equal(inferNextStep(dir, [{ dir: '/x/.worktrees/mmh-1', branch: 'mmh/slice-1' }]), 'clean');
});

test('resumeState picks the newest open pack', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-root-'));
  const a = path.join(root, 'docs', 'impl', 'make-me-happy', 'old');
  const b = path.join(root, 'docs', 'impl', 'make-me-happy', 'new');
  write(a, 'run-meta.json', { loop: 'full' });
  write(a, 'TASKS.json', { tasks: [] });
  write(b, 'run-meta.json', { loop: 'task', spec: 'docs/s.md', spec_status:'confirmed' });
  write(b, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'OPEN' }] });
  const later = Date.now() + 1000;
  fs.utimesSync(b, later / 1000, later / 1000);
  const st = resumeState(root, 'mmh');
  assert.equal(st.resumable, true);
  assert.equal(st.pack_name, 'new');
  assert.equal(st.next_step, 'worktrees-add');
  assert.equal(st.loop, 'task');
});

test('findPacks ignores empty dirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-empty-'));
  fs.mkdirSync(path.join(root, 'docs', 'impl', 'make-me-happy', 'noise'), { recursive: true });
  assert.deepEqual(findPacks(root), []);
});

test('a closed flag without a verified seal cannot hide unfinished artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-root-'));
  const dir = path.join(root, 'docs', 'impl', 'make-me-happy', '2026-10-17-fix-x');
  write(dir, 'run-meta.json', { spec: 'docs/s.md', spec_status: 'confirmed', status: 'closed' });
  write(dir, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'DONE', tests_added: 1, red_green: true }] });
  assert.notEqual(inferNextStep(dir, []), 'closed');
  const state = resumeState(root, 'mmh');
  assert.equal(state.resumable, true);
  assert.equal(state.open_packs.length,1);

  write(dir, 'run-meta.json', { spec: 'docs/s.md', spec_status: 'confirmed', status: 'in_progress' });
  assert.equal(inferNextStep(dir, []), 'worktrees-add');
});

test('resume exposes the newest sealed report without making it an active run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-history-'));
  sealedPack(root, 'older', '2026-10-01T08:00:00Z');
  const latest = sealedPack(root, 'latest', '2026-10-02T08:00:00Z');
  const state = resumeState(root);
  assert.equal(state.resumable, false);
  assert.equal(state.next_step, 'closed');
  assert.equal(state.pack, null);
  assert.equal(state.loop, null);
  assert.deepEqual(state.open_packs, []);
  assert.deepEqual(state.historical_pack, {
    dir: latest, name: 'latest', run_id: 'latest', finished_at: '2026-10-02T08:00:00Z', report: path.join(latest, 'report.html'),
  });
});

test('historical report stays separate when an older active pack needs resuming', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-history-'));
  const latest = sealedPack(root, 'latest', '2026-10-02T08:00:00Z');
  const active = path.join(root, 'docs', 'impl', 'make-me-happy', 'active');
  write(active, 'run-meta.json', { status: 'in_progress', updated_at: '2026-10-01T08:00:00Z', spec: 'spec.md', spec_status: 'confirmed', loop: 'task' });
  const state = resumeState(root);
  assert.equal(state.resumable, true);
  assert.equal(state.next_step, 'planner');
  assert.equal(state.pack, active);
  assert.equal(state.loop, 'task');
  assert.deepEqual(state.open_packs, [{ dir: active, next_step: 'planner' }]);
  assert.equal(state.historical_pack.dir, latest);
});

test('an invalid dependency graph routes completed tasks back to planner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-planner-'));
  write(dir, 'spec.md', '# Confirmed specification');
  write(dir, 'run-meta.json', { run_id: 'plan-validation', repo_root: dir, spec: 'spec.md', spec_status: 'confirmed' });
  write(dir, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'DONE', tests_added: 1, red_green: true, depends_on: ['T-001'],
    red: { command: 'test', output_excerpt: 'failed' }, green: { command: 'test', output_excerpt: 'passed' } }] });
  write(dir, 'hooks/arch-map.json', { source: 'manual' });
  write(dir, 'worktrees.json', { skipped: true, reason: 'fixture without Git' });
  write(dir, 'immutability.json', { green: true, suite: ['ExistingContract'] });
  for (const axis of ['standards', 'spec', 'correctness']) write(dir, `reviews/${axis}.json`, { axis, verdict: 'APPROVE', findings: [] });
  assert.equal(inferNextStep(dir, []), 'planner');
});

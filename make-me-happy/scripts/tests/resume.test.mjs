import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferNextStep, findPacks, resumeState } from '../resume.mjs';

function write(dir, rel, body) {
  const dest = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
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

  write(dir, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'DONE', tests_added: 1, red_green: true }] });
  write(dir, 'worktrees.json', { slices: [{ index: 1, merged: true, removed: true }] });
  assert.equal(inferNextStep(dir, []), 'immutability');

  write(dir, 'immutability.json', { green: true, suite: ['A'] });
  assert.equal(inferNextStep(dir, []), 'review');

  write(dir, 'reviews/standards.md', 'VERDICT: APPROVE');
  write(dir, 'reviews/spec.md', 'VERDICT: SKIP');
  write(dir, 'reviews/correctness.md', 'VERDICT: REJECT');
  assert.equal(inferNextStep(dir, []), 'review');

  write(dir, 'reviews/correctness.md', 'VERDICT: APPROVE');
  assert.equal(inferNextStep(dir, []), 'score');

  write(dir, 'coverage.json', { pct: 96, tool: 'c8' });
  assert.equal(inferNextStep(dir, []), 'closed');
});

test('draft spec stays on explore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-resume-'));
  write(dir, 'run-meta.json', { spec: 'docs/s.md', spec_status: 'draft' });
  assert.equal(inferNextStep(dir, []), 'explore');
});

test('leftover worktrees keep the run on implement even if tasks look done', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-resume-'));
  write(dir, 'TASKS.json', { tasks: [{ id: 'T-001', status: 'DONE', tests_added: 1, red_green: true }] });
  write(dir, 'worktrees.json', { slices: [{ index: 1, merged: true, removed: true }] });
  assert.equal(inferNextStep(dir, [{ dir: '/x/.worktrees/mmh-1', branch: 'mmh/slice-1' }]), 'implement');
});

test('resumeState picks the newest open pack', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-root-'));
  const a = path.join(root, 'docs', 'impl', 'make-me-happy', 'old');
  const b = path.join(root, 'docs', 'impl', 'make-me-happy', 'new');
  write(a, 'run-meta.json', { loop: 'full' });
  write(a, 'TASKS.json', { tasks: [] });
  write(b, 'run-meta.json', { loop: 'task', spec: 'docs/s.md' });
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

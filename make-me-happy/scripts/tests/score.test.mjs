import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePack } from '../score.mjs';

function pack(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-score-'));
  const reviews = path.join(dir, 'reviews');
  fs.mkdirSync(reviews);
  const tasks = {
    spec: 'docs/s.md',
    tasks: [
      { id: 'T-001', title: 'a', status: 'DONE', tests_added: 2, red_green: true, immutability: true, worktree: 1 },
      { id: 'T-002', title: 'b', status: 'DONE', tests_added: 1, red_green: true, immutability: true, worktree: 2 },
    ],
  };
  fs.writeFileSync(path.join(dir, 'TASKS.json'), JSON.stringify(tasks));
  fs.writeFileSync(path.join(dir, 'immutability.json'), JSON.stringify({ green: true, suite: ['A#b'] }));
  fs.writeFileSync(path.join(dir, 'worktrees.json'), JSON.stringify({
    slices: [
      { index: 1, merged: true, removed: true },
      { index: 2, merged: true, removed: true },
    ],
  }));
  fs.writeFileSync(path.join(reviews, 'standards.md'), 'ok\nVERDICT: APPROVE\n');
  fs.writeFileSync(path.join(reviews, 'spec.md'), 'ok\nVERDICT: APPROVE\n');
  fs.writeFileSync(path.join(reviews, 'correctness.md'), 'ok\nVERDICT: APPROVE\n');
  fs.writeFileSync(path.join(dir, 'coverage.json'), JSON.stringify({ pct: 96.2, tool: 'c8' }));
  for (const [file, body] of Object.entries(overrides)) {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (body === null) fs.rmSync(dest, { force: true });
    else fs.writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

test('ten when every gate is paid', () => {
  const r = scorePack(pack());
  assert.equal(r.score, 10);
  assert.equal(r.closable, true);
});

test('spec SKIP still pays the review gate', () => {
  const r = scorePack(pack({ 'reviews/spec.md': 'no spec available\nVERDICT: SKIP\n' }));
  assert.equal(r.score, 10);
});

test('REJECT on correctness blocks close', () => {
  const r = scorePack(pack({ 'reviews/correctness.md': 'VERDICT: REJECT\n' }));
  assert.equal(r.closable, false);
  assert.equal(r.gates.find((g) => g.id === 'review').ok, false);
  assert.equal(r.score, 8);
});

test('DONE without tests fails red-green', () => {
  const r = scorePack(pack({
    'TASKS.json': {
      tasks: [{ id: 'T-001', status: 'DONE', tests_added: 0, red_green: true }],
    },
  }));
  assert.equal(r.gates.find((g) => g.id === 'red-green').ok, false);
});

test('coverage below 95 blocks close even at score 10', () => {
  const r = scorePack(pack({ 'coverage.json': { pct: 94.9, tool: 'c8' } }));
  assert.equal(r.score, 10);
  assert.equal(r.coverage.ok, false);
  assert.equal(r.closable, false);
});

test('missing coverage.json blocks close', () => {
  const r = scorePack(pack({ 'coverage.json': null }));
  assert.equal(r.closable, false);
  assert.equal(r.coverage.ok, false);
});

test('unmerged slice fails worktrees gate', () => {
  const r = scorePack(pack({
    'worktrees.json': { slices: [{ index: 1, merged: false, removed: false }] },
  }));
  assert.equal(r.gates.find((g) => g.id === 'worktrees').ok, false);
});

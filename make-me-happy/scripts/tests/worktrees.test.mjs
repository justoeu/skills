import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sliceOf } from '../worktrees.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'worktrees.mjs');

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-wt-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'README'), 'x\n');
  git(['add', '.']);
  git(['commit', '-m', 'init']);
  return dir;
}

test('sliceOf is stable', () => {
  const s = sliceOf('/repo', 'mmh', 2);
  assert.equal(s.branch, 'mmh/slice-2');
  assert.equal(s.dir, path.join('/repo', '.worktrees', 'mmh-2'));
});

test('add + merge + verify-clean on a throwaway repo', () => {
  const dir = gitRepo();
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const add = spawnSync(process.execPath, [SCRIPT, 'add', '--root', dir, '--count', '2', '--prefix', 'mmh', '--out', out], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr || add.stdout);
  const state = JSON.parse(fs.readFileSync(path.join(out, 'worktrees.json'), 'utf8'));
  assert.equal(state.slices.length, 2);
  assert.ok(fs.existsSync(state.slices[0].dir));

  const dirty = spawnSync(process.execPath, [SCRIPT, 'verify-clean', '--root', dir, '--prefix', 'mmh'], { encoding: 'utf8' });
  assert.notEqual(dirty.status, 0);

  for (const i of [1, 2]) {
    const m = spawnSync(process.execPath, [SCRIPT, 'merge', '--root', dir, '--index', String(i), '--out', out], { encoding: 'utf8' });
    assert.equal(m.status, 0, m.stderr || m.stdout);
  }
  const clean = spawnSync(process.execPath, [SCRIPT, 'verify-clean', '--root', dir, '--prefix', 'mmh'], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /\.worktrees\//);
});

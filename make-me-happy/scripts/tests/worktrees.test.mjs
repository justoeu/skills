import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sliceOf, isProtectedBranch } from '../worktrees.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'worktrees.mjs');

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-wt-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-b', 'main']);
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

test('main/master/trunk are protected', () => {
  assert.equal(isProtectedBranch('main'), true);
  assert.equal(isProtectedBranch('master'), true);
  assert.equal(isProtectedBranch('trunk'), true);
  assert.equal(isProtectedBranch('feature/painel-v2'), false);
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
  assert.notEqual(state.into, 'main');
  assert.match(state.into, /^feature\/mmh-/);
  assert.equal(state.gitignore_appended, true);
  assert.match(add.stderr, /NOTE: appended \.worktrees\//);

  const dirty = spawnSync(process.execPath, [SCRIPT, 'verify-clean', '--root', dir, '--prefix', 'mmh'], { encoding: 'utf8' });
  assert.notEqual(dirty.status, 0);

  for (const i of [1, 2]) {
    const m = spawnSync(process.execPath, [SCRIPT, 'merge', '--root', dir, '--index', String(i), '--out', out], { encoding: 'utf8' });
    assert.equal(m.status, 0, m.stderr || m.stdout);
  }
  const clean = spawnSync(process.execPath, [SCRIPT, 'verify-clean', '--root', dir, '--prefix', 'mmh'], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(fs.existsSync(state.slices[0].dir), false);
  assert.equal(fs.existsSync(path.join(dir, '.worktrees')), false);
  const branches = spawnSync('git', ['branch', '--list', 'mmh/slice-*'], { cwd: dir, encoding: 'utf8' });
  assert.equal(branches.stdout.trim(), '');
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /\.worktrees\//);
  const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(head.stdout.trim(), 'main');
});

test('remove apaga branch órfã, pasta da slice e .worktrees vazio', () => {
  const dir = gitRepo();
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const add = spawnSync(process.execPath, [
    SCRIPT, 'add', '--root', dir, '--count', '1', '--prefix', 'mmh', '--into', 'feature/painel-v2', '--out', out,
  ], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr || add.stdout);
  const branch = spawnSync('git', ['branch', 'mmh/slice-9'], { cwd: dir, encoding: 'utf8' });
  assert.equal(branch.status, 0, branch.stderr);
  fs.mkdirSync(path.join(dir, '.worktrees', 'mmh-9'), { recursive: true });
  const dirty = spawnSync(process.execPath, [SCRIPT, 'verify-clean', '--root', dir, '--prefix', 'mmh'], { encoding: 'utf8' });
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /mmh\/slice-9/);
  const removed = spawnSync(process.execPath, [SCRIPT, 'remove', '--root', dir, '--prefix', 'mmh'], { encoding: 'utf8' });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  const clean = spawnSync(process.execPath, [SCRIPT, 'verify-clean', '--root', dir, '--prefix', 'mmh'], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.worktrees')), false);
  const left = spawnSync('git', ['branch', '--list', 'mmh/slice-*'], { cwd: dir, encoding: 'utf8' });
  assert.equal(left.stdout.trim(), '');
});

test('merge --into main is refused', () => {
  const dir = gitRepo();
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const add = spawnSync(process.execPath, [
    SCRIPT, 'add', '--root', dir, '--count', '1', '--prefix', 'mmh', '--into', 'feature/painel-v2', '--out', out,
  ], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr || add.stdout);
  const m = spawnSync(process.execPath, [
    SCRIPT, 'merge', '--root', dir, '--index', '1', '--into', 'main', '--out', out,
  ], { encoding: 'utf8' });
  assert.notEqual(m.status, 0);
  assert.match(m.stderr, /protected/);
});

test('add refuses a red baseline and does not create worktrees', () => {
  const dir = gitRepo();
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const add = spawnSync(process.execPath, [
    SCRIPT, 'add', '--root', dir, '--count', '1', '--prefix', 'mmh',
    '--into', 'feature/x', '--test-cmd', 'exit 1', '--out', out,
  ], { encoding: 'utf8' });
  assert.notEqual(add.status, 0);
  assert.match(add.stderr, /red baseline/);
  assert.equal(fs.existsSync(path.join(dir, '.worktrees', 'mmh-1')), false);
});

test('add --into uses the given feature branch even from main', () => {
  const dir = gitRepo();
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const add = spawnSync(process.execPath, [
    SCRIPT, 'add', '--root', dir, '--count', '1', '--prefix', 'mmh', '--into', 'feature/painel-v2', '--out', out,
  ], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(out, 'worktrees.json'), 'utf8'));
  assert.equal(state.into, 'feature/painel-v2');
  const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  assert.equal(head.stdout.trim(), 'feature/painel-v2');
});

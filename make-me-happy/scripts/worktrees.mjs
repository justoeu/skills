#!/usr/bin/env node
/**
 * git worktree helper for make-me-happy.
 *
 *   node worktrees.mjs add --root . --count 3 --prefix mmh --into feature/foo --out docs/impl/...
 *   node worktrees.mjs merge --root . --index 1 --test-cmd "npm test" --out ...
 *   node worktrees.mjs verify-clean --root . --prefix mmh
 *   node worktrees.mjs remove --root . --prefix mmh
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  if (fallback === false) return true;
  return process.argv[i + 1] ?? fallback;
}

const action = process.argv[2];
const root = path.resolve(arg('root', '.'));
const prefix = arg('prefix', 'mmh');
const outDir = arg('out', '');

function git(args, cwd = root) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r;
}

function gitOk(args, cwd = root) {
  const r = git(args, cwd);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}\n${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
}

function ensureGit() {
  const r = git(['rev-parse', '--show-toplevel']);
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function clampCount(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 3;
  return Math.max(1, Math.min(8, Math.trunc(x)));
}

export function isProtectedBranch(name) {
  return /^(main|master|trunk)$/i.test(String(name || '').trim());
}

export function ignoreWorktrees(repo) {
  const gi = path.join(repo, '.gitignore');
  const line = '.worktrees/';
  let cur = '';
  if (fs.existsSync(gi)) cur = fs.readFileSync(gi, 'utf8');
  if (cur.split(/\r?\n/).some((l) => l.trim() === line)) {
    return { path: gi, appended: false };
  }
  const next = cur.endsWith('\n') || cur === '' ? `${cur}${line}\n` : `${cur}\n${line}\n`;
  fs.writeFileSync(gi, next);
  return { path: gi, appended: true };
}

function ensureIntoBranch(repo, requested) {
  const current = gitOk(['rev-parse', '--abbrev-ref', 'HEAD']);
  let into = requested || '';
  if (!into) {
    into = isProtectedBranch(current)
      ? `feature/mmh-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
      : current;
  }
  if (isProtectedBranch(into)) {
    throw new Error(
      `refusing merge target '${into}' (protected: main/master/trunk). Pass --into feature/<name>`,
    );
  }
  if (current !== into) {
    const exists = git(['rev-parse', '--verify', into]);
    if (exists.status === 0) gitOk(['checkout', into]);
    else gitOk(['checkout', '-b', into]);
  }
  return gitOk(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function readWorktreesState() {
  if (!outDir) return { slices: [] };
  const f = path.join(outDir, 'worktrees.json');
  if (!fs.existsSync(f)) return { slices: [] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function sliceOf(repo, prefix, index) {
  return {
    index,
    branch: `${prefix}/slice-${index}`,
    dir: path.join(repo, '.worktrees', `${prefix}-${index}`),
  };
}

export function slicePaths(repo, prefix, count) {
  const slices = [];
  for (let i = 1; i <= count; i++) slices.push(sliceOf(repo, prefix, i));
  return slices;
}

function runTestCmd(testCmd, cwd, label) {
  if (!testCmd) return { skipped: true };
  const t = spawnSync(testCmd, {
    cwd, encoding: 'utf8', shell: true, timeout: 30 * 60 * 1000,
  });
  if (t.status !== 0) {
    if (t.stdout) console.error(t.stdout);
    if (t.stderr) console.error(t.stderr);
    throw new Error(
      `${label} (exit ${t.status}). Never stack work on a red baseline.`,
    );
  }
  return { skipped: false, ok: true };
}

function cmdAdd() {
  const repo = ensureGit();
  if (!repo) {
    console.error('not a git repo — worktrees disabled');
    process.exit(2);
  }
  const count = clampCount(arg('count', '3'));
  const into = ensureIntoBranch(repo, arg('into', '') || arg('branch', ''));
  const testCmd = arg('test-cmd', '');
  const baseline = runTestCmd(testCmd, repo, `red baseline on '${into}'`);
  const head = gitOk(['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(repo, '.worktrees'), { recursive: true });
  const gitignore = ignoreWorktrees(repo);
  if (gitignore.appended) {
    console.error(`NOTE: appended .worktrees/ to ${gitignore.path} (versioned file — include in the PR)`);
  }
  const slices = [];
  for (const s of slicePaths(repo, prefix, count)) {
    if (fs.existsSync(s.dir)) {
      throw new Error(`worktree already exists: ${s.dir}`);
    }
    gitOk(['worktree', 'add', '-b', s.branch, s.dir, head]);
    slices.push({ ...s, base: into, head, merged: false });
  }
  const state = {
    prefix,
    count,
    into,
    base: into,
    head,
    gitignore_appended: gitignore.appended,
    gitignore_path: gitignore.path,
    baseline_green: baseline.skipped ? null : true,
    slices,
  };
  if (outDir) writeJson(path.join(outDir, 'worktrees.json'), state);
  console.log(JSON.stringify(state, null, 2));
}

function cmdMerge() {
  const repo = ensureGit();
  if (!repo) throw new Error('not a git repo');
  const index = Number(arg('index', ''));
  if (!index) throw new Error('--index required');
  const testCmd = arg('test-cmd', '');
  const state = readWorktreesState();
  const slice = (state.slices || []).find((s) => s.index === index)
    || sliceOf(repo, prefix, index);
  if (!slice || !fs.existsSync(slice.dir)) {
    throw new Error(`slice ${index} worktree missing`);
  }
  runTestCmd(testCmd, slice.dir, `tests failed in worktree ${index}`);
  const into = arg('into', '')
    || state.into
    || (!isProtectedBranch(state.base) && state.base)
    || '';
  if (!into) {
    throw new Error('no merge target: pass --into feature/<name> or run add first');
  }
  if (isProtectedBranch(into)) {
    throw new Error(
      `refusing to merge into '${into}' (protected). Checkout/pass --into a feature branch`,
    );
  }
  const current = gitOk(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current !== into) gitOk(['checkout', into]);
  gitOk(['merge', '--no-ff', '--no-edit', slice.branch]);
  gitOk(['worktree', 'remove', '--force', slice.dir]);
  git(['branch', '-d', slice.branch]);
  slice.merged = true;
  slice.removed = true;
  slice.merged_into = into;
  if (outDir) {
    const next = readWorktreesState();
    const row = (next.slices || []).find((s) => s.index === index);
    if (row) Object.assign(row, { merged: true, removed: true, merged_into: into });
    next.into = into;
    writeJson(path.join(outDir, 'worktrees.json'), next);
  }
  console.log(`merged ${slice.branch} into ${into} and removed worktree`);
}

export function leftoverWorktrees(repo, prefixName) {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) return [];
  const blocks = (r.stdout || '').split('\n\n').map((b) => b.trim()).filter(Boolean);
  const hits = [];
  for (const b of blocks) {
    const dir = (b.match(/^worktree (.+)$/m) || [])[1];
    const branch = (b.match(/^branch refs\/heads\/(.+)$/m) || [])[1];
    if (!dir) continue;
    if (dir.includes(`${path.sep}.worktrees${path.sep}${prefixName}-`)
      || (branch && branch.startsWith(`${prefixName}/slice-`))) {
      hits.push({ dir, branch });
    }
  }
  return hits;
}

function leftover(prefixName) {
  return leftoverWorktrees(root, prefixName);
}

function cmdRemove() {
  const repo = ensureGit();
  if (!repo) throw new Error('not a git repo');
  for (const h of leftover(prefix)) {
    git(['worktree', 'remove', '--force', h.dir]);
    if (h.branch) git(['branch', '-D', h.branch]);
  }
  const dir = path.join(repo, '.worktrees');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`${prefix}-`)) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      }
    }
  }
  git(['worktree', 'prune']);
  console.log('removed leftover worktrees');
}

function cmdVerify() {
  const hits = leftover(prefix);
  if (hits.length) {
    console.error(JSON.stringify(hits, null, 2));
    process.exit(1);
  }
  console.log('clean');
}

function cmdList() {
  const r = git(['worktree', 'list']);
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) process.exit(r.status);
}

const cmds = {
  add: cmdAdd,
  merge: cmdMerge,
  remove: cmdRemove,
  'verify-clean': cmdVerify,
  list: cmdList,
};

if (path.basename(process.argv[1] || '') === 'worktrees.mjs') {
  if (!cmds[action]) {
    console.error('usage: worktrees.mjs add|merge|remove|verify-clean|list');
    process.exit(2);
  }
  try {
    cmds[action]();
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

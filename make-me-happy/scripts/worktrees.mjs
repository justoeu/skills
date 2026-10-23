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
import { writeJson, readJson, withPackLock, digest } from './state-io.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  if (fallback === false) return true;
  return process.argv[i + 1] ?? fallback;
}

const action = process.argv[2];
const root = path.resolve(arg('root', '.'));
const outPath = arg('out', '') ? path.resolve(arg('out', '')) : '';
const outDir = outPath && fs.existsSync(outPath) ? fs.realpathSync(outPath) : outPath;
const meta = outDir ? readJson(path.join(outDir, 'run-meta.json'), {}) : {};
const prefix = arg('prefix', meta.worktree_prefix || 'mmh');
if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('invalid worktree prefix');

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
    cwd,
    encoding: 'utf8',
    shell: true,
    timeout: 30 * 60 * 1000,
  });
  if (t.status !== 0) {
    if (t.stdout) console.error(t.stdout);
    if (t.stderr) console.error(t.stderr);
    throw new Error(`${label} (exit ${t.status}). Never stack work on a red baseline.`);
  }
  return { skipped: false, ok: true };
}

function protectedTarget(repo, name) {
  if (isProtectedBranch(name)) return true;
  return ['origin', 'upstream'].some((remote) => {
    const r = git(['symbolic-ref', `refs/remotes/${remote}/HEAD`], repo);
    return r.status === 0 && r.stdout.trim().replace(`refs/remotes/${remote}/`, '') === name;
  });
}
function saveState(state) {
  if (!outDir) throw new Error('--out required for recoverable worktree operations');
  writeJson(path.join(outDir, 'worktrees.json'), state);
}
function cleanTree(dir, state, allowPack = false) {
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], dir);
  if (status.status !== 0) throw new Error(status.stderr || 'cannot inspect worktree');
  const raw = status.stdout.split('\0').filter(Boolean);
  const dirty = raw.filter((entry) => {
    const file = entry.slice(3);
    if (
      allowPack &&
      outDir &&
      (path.resolve(dir, file) === outDir || path.resolve(dir, file).startsWith(outDir + path.sep))
    )
      return false;
    if (
      allowPack &&
      file === '.gitignore' &&
      state.gitignore_content_hash &&
      fs.existsSync(path.join(dir, file)) &&
      digest(fs.readFileSync(path.join(dir, file), 'utf8')) === state.gitignore_content_hash
    )
      return false;
    return true;
  });
  if (dirty.length)
    throw new Error(
      `uncommitted changes in ${dir}; commit or preserve them before continuing: ${dirty.join(', ')}`,
    );
}
function cmdAdd() {
  const repo = ensureGit();
  if (!repo) throw new Error('not a git repo — use the documented inline fallback');
  const existing = readWorktreesState();
  const count = existing.count || clampCount(arg('count', '3'));
  const into = ensureIntoBranch(repo, existing.into || arg('into', '') || arg('branch', ''));
  if (protectedTarget(repo, into)) throw new Error(`refusing protected merge target ${into}`);
  const testCmd = arg('test-cmd', meta.test_cmd || '');
  cleanTree(repo, existing, true);
  const baseline = runTestCmd(testCmd, repo, `red baseline on '${into}'`);
  cleanTree(repo, existing, true);
  const head = existing.head || gitOk(['rev-parse', 'HEAD']);
  const gi = ignoreWorktrees(repo);
  if (gi.appended)
    console.error(`NOTE: appended .worktrees/ to ${gi.path} (versioned file — include in the PR)`);
  const state = existing.into
    ? existing
    : {
        run_id: meta.run_id || null,
        prefix,
        count,
        into,
        base: into,
        head,
        gitignore_appended: gi.appended,
        gitignore_path: gi.path,
        gitignore_content_hash: digest(fs.readFileSync(gi.path, 'utf8')),
        baseline_green: baseline.skipped ? null : true,
        slices: slicePaths(repo, prefix, count).map((x) => ({
          ...x,
          base: into,
          head,
          created: false,
          merged: false,
          removed: false,
        })),
      };
  saveState(state);
  for (const slice of state.slices) {
    if (slice.removed) continue;
    if (fs.existsSync(slice.dir)) {
      const registered = leftoverWorktrees(repo, prefix).find(
        (w) => path.resolve(w.dir) === path.resolve(slice.dir) && w.branch === slice.branch,
      );
      if (!registered) throw new Error(`existing path is not the recorded worktree: ${slice.dir}`);
    } else {
      if (slice.created)
        throw new Error(`recorded worktree disappeared: ${slice.dir}; reconcile before continuing`);
      const branchRef = `refs/heads/${slice.branch}`;
      const branchExists = git(['show-ref', '--verify', branchRef], repo).status === 0;
      if (branchExists) {
        // A failed checkout can leave the branch behind even though Git removes
        // the worktree. Reuse only the branch owned by our recorded attempt.
        if (!slice.creating || gitOk(['rev-parse', branchRef], repo) !== (slice.head || head)) {
          throw new Error(
            `existing branch preserved: ${slice.branch}; reconcile ownership before continuing`,
          );
        }
        gitOk(['worktree', 'add', slice.dir, slice.branch]);
      } else {
        // Persist intent BEFORE git; a crash after successful add is recovered above.
        slice.creating = true;
        saveState(state);
        gitOk(['worktree', 'add', '-b', slice.branch, slice.dir, head]);
      }
    }
    slice.created = true;
    delete slice.creating;
    saveState(state);
  }
  console.log(JSON.stringify(state, null, 2));
}
function taskRows() {
  return outDir ? readJson(path.join(outDir, 'TASKS.json'), {}).tasks || [] : [];
}
function cmdSync() {
  const repo = ensureGit(),
    state = readWorktreesState(),
    index = Number(arg('index', ''));
  const slice = state.slices?.find((x) => x.index === index);
  if (!repo || !slice || !fs.existsSync(slice.dir)) throw new Error('recorded slice required for sync');
  const tasks = taskRows(),
    own = tasks.filter((t) => t.worktree === index && t.status !== 'DONE');
  for (const t of own)
    for (const depId of t.depends_on || []) {
      const dep = tasks.find((d) => d.id === depId);
      if (!dep) throw new Error(`unknown dependency ${depId}`);
      if (dep.worktree === index) continue;
      const producer = state.slices.find((w) => w.index === dep.worktree);
      if (
        dep.status !== 'DONE' ||
        !producer?.merged ||
        !producer.integrated_head ||
        git(['merge-base', '--is-ancestor', producer.integrated_head, state.into], repo).status !== 0
      )
        throw new Error(`dependency ${depId} has not been integrated`);
    }
  cleanTree(slice.dir, state);
  gitOk(['merge', '--no-edit', state.into], slice.dir);
  runTestCmd(arg('test-cmd', meta.test_cmd || ''), slice.dir, 'dependency sync tests failed');
  cleanTree(slice.dir, state);
  slice.synced_head = gitOk(['rev-parse', state.into], repo);
  saveState(state);
  console.log(`synced slice ${index}`);
}
function cmdMerge() {
  const repo = ensureGit();
  if (!repo) throw new Error('not a git repo');
  const state = readWorktreesState(),
    index = Number(arg('index', ''));
  const slice = state.slices?.find((s) => s.index === index);
  if (!slice) throw new Error('recorded slice required; run add/reconcile first');
  const into = arg('into', '') || state.into;
  if (!into || protectedTarget(repo, into))
    throw new Error(`refusing protected or missing merge target '${into}'`);
  if (state.into && into !== state.into) throw new Error('merge target differs from recorded into');
  const testCmd = arg('test-cmd', meta.test_cmd || '');
  const pending = taskRows().some((t) => t.worktree === index && t.status !== 'DONE');
  if (fs.existsSync(slice.dir)) {
    cleanTree(slice.dir, state);
    const head = gitOk(['rev-parse', 'HEAD'], slice.dir);
    runTestCmd(testCmd, slice.dir, `tests failed in worktree ${index}`);
    cleanTree(slice.dir, state);
    if (gitOk(['rev-parse', 'HEAD'], slice.dir) !== head) throw new Error('test command changed slice HEAD');
    slice.tested_head = head;
    saveState(state);
  } else if (!slice.tested_head) throw new Error(`slice ${index} worktree missing without a tested commit`);
  cleanTree(repo, state, true);
  if (gitOk(['rev-parse', '--abbrev-ref', 'HEAD']) !== into) gitOk(['checkout', into]);
  // Git ancestry reconciles a crash between merge and JSON persistence.
  if (git(['merge-base', '--is-ancestor', slice.tested_head, into], repo).status !== 0)
    gitOk(['merge', '--no-ff', '--no-edit', slice.tested_head]);
  slice.integrated_head = slice.tested_head;
  slice.merged_into = into;
  slice.integration_validated = false;
  saveState(state);
  runTestCmd(testCmd, repo, 'tests failed after integration; slice preserved for repair');
  cleanTree(repo, state, true);
  slice.integration_validated = true;
  slice.merged = !pending;
  slice.partial_merge = pending;
  saveState(state);
  if (pending) {
    console.log(`partially merged slice ${index}; pending tasks keep the worktree`);
    return;
  }
  if (fs.existsSync(slice.dir)) {
    cleanTree(slice.dir, state);
    gitOk(['worktree', 'remove', slice.dir]);
  }
  slice.worktree_removed = true;
  saveState(state);
  if (git(['show-ref', '--verify', `refs/heads/${slice.branch}`], repo).status === 0)
    gitOk(['branch', '-d', slice.branch]);
  slice.removed = true;
  saveState(state);
  dropEmptyWorktreesRoot(repo);
  console.log(`merged ${slice.branch} into ${into} and removed worktree`);
}

export function leftoverWorktrees(repo, prefixName) {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) return [];
  const blocks = (r.stdout || '')
    .split('\n\n')
    .map((b) => b.trim())
    .filter(Boolean);
  const hits = [];
  for (const b of blocks) {
    const dir = (b.match(/^worktree (.+)$/m) || [])[1];
    const branch = (b.match(/^branch refs\/heads\/(.+)$/m) || [])[1];
    if (!dir) continue;
    if (
      dir.includes(`${path.sep}.worktrees${path.sep}${prefixName}-`) ||
      (branch && branch.startsWith(`${prefixName}/slice-`))
    ) {
      hits.push({ dir, branch });
    }
  }
  return hits;
}

function leftover(prefixName) {
  return leftoverWorktrees(root, prefixName);
}

function sliceBranches(repo, prefixName) {
  const r = git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefixName}/slice-*`], repo);
  if (r.status !== 0) return [];
  return (r.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function sliceDirs(repo, prefixName) {
  const dir = path.join(repo, '.worktrees');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${prefixName}-`))
    .map((name) => path.join(dir, name));
}

function dropEmptyWorktreesRoot(repo) {
  const parent = path.join(repo, '.worktrees');
  if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

function prefixDirt(repo, prefixName) {
  const parent = path.join(repo, '.worktrees');
  const emptyParent = fs.existsSync(parent) && fs.readdirSync(parent).length === 0;
  return {
    worktrees: leftoverWorktrees(repo, prefixName),
    branches: sliceBranches(repo, prefixName),
    dirs: sliceDirs(repo, prefixName),
    empty_dir: emptyParent ? parent : null,
  };
}

function cmdRemove() {
  const repo = ensureGit();
  if (!repo) throw new Error('not a git repo');
  const state = readWorktreesState(),
    into = state.into || gitOk(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (protectedTarget(repo, into)) throw new Error('cleanup requires a feature merge target');
  // Preflight ALL resources before mutation. Never discard dirty or unmerged work.
  const hits = leftover(prefix);
  for (const hit of hits) {
    cleanTree(hit.dir, state);
    if (!hit.branch || git(['merge-base', '--is-ancestor', hit.branch, into], repo).status !== 0)
      throw new Error(`unmerged worktree preserved: ${hit.dir}`);
    const row = state.slices?.find((s) => s.branch === hit.branch);
    if (row && taskRows().some((t) => t.worktree === row.index && t.status !== 'DONE'))
      throw new Error('pending tasks: preserve the slice');
  }
  for (const branch of sliceBranches(repo, prefix))
    if (git(['merge-base', '--is-ancestor', branch, into], repo).status !== 0)
      throw new Error(`unmerged branch preserved: ${branch}`);
  for (const dir of sliceDirs(repo, prefix))
    if (!hits.some((h) => h.dir === dir) && fs.readdirSync(dir).length)
      throw new Error(`unknown nonempty directory preserved: ${dir}`);
  for (const hit of hits) gitOk(['worktree', 'remove', hit.dir]);
  for (const dir of sliceDirs(repo, prefix)) fs.rmdirSync(dir);
  for (const branch of sliceBranches(repo, prefix)) gitOk(['branch', '-d', branch]);
  dropEmptyWorktreesRoot(repo);
  gitOk(['worktree', 'prune']);
  if (outDir && state.into) {
    for (const slice of state.slices)
      if (
        !fs.existsSync(slice.dir) &&
        git(['merge-base', '--is-ancestor', slice.tested_head || slice.head, into], repo).status === 0
      )
        slice.removed = true;
    saveState(state);
  }
  console.log('removed merged clean worktrees');
}

function cmdVerify() {
  const repo = ensureGit();
  if (!repo) throw new Error('not a git repo');
  const hits = prefixDirt(repo, prefix);
  const dirty = hits.worktrees.length || hits.branches.length || hits.dirs.length || hits.empty_dir;
  if (dirty) {
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
  sync: cmdSync,
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
    if (['add', 'merge', 'sync', 'remove'].includes(action) && outDir)
      withPackLock(outDir, () => cmds[action]());
    else cmds[action]();
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

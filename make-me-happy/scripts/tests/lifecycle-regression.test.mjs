import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resumeState } from '../resume.mjs';

const SCRIPT = fileURLToPath(new URL('../worktrees.mjs', import.meta.url));
const STATE_MODULE = new URL('../state-io.mjs', import.meta.url).href;

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
}

function succeeded(result) {
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture(t, tasks = [{ id: 'T-001', worktree: 1, status: 'OPEN' }]) {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-lifecycle-')));
  const root = path.join(sandbox, 'repo');
  const out = path.join(root, 'docs/impl/make-me-happy/2026-10-21-lifecycle');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const git = (args, cwd = root) => spawnSync('git', args, {
    cwd, encoding: 'utf8', timeout: 15_000,
  });
  succeeded(git(['init', '-b', 'feature/lifecycle']));
  succeeded(git(['config', 'user.name', 'Lifecycle Test']));
  succeeded(git(['config', 'user.email', 'lifecycle@example.invalid']));
  succeeded(git(['config', 'commit.gpgsign', 'false']));
  succeeded(git(['config', 'core.hooksPath', path.join(sandbox, 'empty-hooks')]));
  write(path.join(root, '.gitignore'), '.worktrees/\ndocs/impl/\n');
  write(path.join(root, 'value.txt'), 'base\n');
  succeeded(git(['add', '.']));
  succeeded(git(['commit', '-m', 'initial state']));
  write(path.join(out, 'run-meta.json'), {
    status: 'in_progress', spec: 'spec.md', spec_status: 'confirmed', loop: 'task',
    worktree_n: new Set(tasks.map((task) => task.worktree)).size,
  });
  write(path.join(out, 'TASKS.json'), { tasks });

  const command = (action, args = [], env = {}, testCmd = 'true') => spawnSync(process.execPath, [
    SCRIPT, action, '--root', root, '--out', out, '--test-cmd', testCmd, ...args,
  ], { cwd: root, encoding: 'utf8', timeout: 15_000, env: { ...process.env, ...env } });
  const state = () => JSON.parse(fs.readFileSync(path.join(out, 'worktrees.json'), 'utf8'));
  const slice = (index) => state().slices.find((entry) => entry.index === index);
  const finish = (id) => {
    const doc = JSON.parse(fs.readFileSync(path.join(out, 'TASKS.json'), 'utf8'));
    doc.tasks.find((task) => task.id === id).status = 'DONE';
    write(path.join(out, 'TASKS.json'), doc);
  };
  const commit = (cwd, file, contents) => {
    write(path.join(cwd, file), contents);
    succeeded(git(['add', '--', file], cwd));
    succeeded(git(['commit', '-m', `implement ${file}`], cwd));
    return succeeded(git(['rev-parse', 'HEAD'], cwd));
  };
  const add = (count = 1, env = {}) => command('add', ['--count', String(count), '--into', 'feature/lifecycle'], env);
  const merge = (index, env = {}) => command('merge', ['--index', String(index)], env);

  // Faults affect only this command's child Git process. The after mode kills the
  // worktrees CLI after Git has changed the repository but before the CLI returns.
  const fault = (match, mode = 'before', token = null) => {
    const bin = path.join(sandbox, 'fault-bin');
    fs.mkdirSync(bin, { recursive: true });
    const wrapper = path.join(bin, 'git');
    write(wrapper, `#!${process.execPath}\n`
      + `const { spawnSync } = require('node:child_process');\n`
      + `const args = process.argv.slice(2);\n`
      + `const rule = JSON.parse(process.env.MMH_LIFECYCLE_FAULT);\n`
      + `const matches = rule.match.every((value, index) => args[index] === value)\n`
      + `  && (!rule.token || args.includes(rule.token));\n`
      + `if (matches && rule.mode === 'before') process.exit(97);\n`
      + `const result = spawnSync('git', args, { stdio: 'inherit', env: { ...process.env,\n`
      + `  PATH: process.env.MMH_LIFECYCLE_ORIGINAL_PATH } });\n`
      + `if (matches && rule.mode === 'after' && result.status === 0) process.kill(process.ppid, 'SIGKILL');\n`
      + `process.exit(result.status ?? 98);\n`);
    fs.chmodSync(wrapper, 0o755);
    return {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      MMH_LIFECYCLE_ORIGINAL_PATH: process.env.PATH,
      MMH_LIFECYCLE_FAULT: JSON.stringify({ match, mode, token }),
    };
  };
  return { root, out, sandbox, git, command, add, merge, state, slice, finish, commit, fault };
}

test('merge preserves both tracked and untracked work that has not been committed', (t) => {
  const f = fixture(t);
  succeeded(f.add());
  const slice = f.slice(1);
  f.commit(slice.dir, 'value.txt', 'committed\n');
  f.finish('T-001');
  write(path.join(slice.dir, 'value.txt'), 'uncommitted tracked work\n');
  write(path.join(slice.dir, 'new-work.txt'), 'uncommitted new file\n');
  const targetBefore = succeeded(f.git(['rev-parse', 'feature/lifecycle']));

  const result = f.merge(1);

  assert.notEqual(result.status, 0, 'merge must stop before discarding uncommitted work');
  assert.equal(fs.readFileSync(path.join(slice.dir, 'value.txt'), 'utf8'), 'uncommitted tracked work\n');
  assert.equal(fs.readFileSync(path.join(slice.dir, 'new-work.txt'), 'utf8'), 'uncommitted new file\n');
  assert.equal(succeeded(f.git(['rev-parse', 'feature/lifecycle'])), targetBefore);
});

test('merge preserves staged changes and leaves the target unchanged', (t) => {
  const f = fixture(t);
  succeeded(f.add());
  const slice = f.slice(1);
  f.commit(slice.dir, 'value.txt', 'committed\n');
  f.finish('T-001');
  write(path.join(slice.dir, 'value.txt'), 'staged work\n');
  succeeded(f.git(['add', 'value.txt'], slice.dir));
  const targetBefore = succeeded(f.git(['rev-parse', 'feature/lifecycle']));

  assert.notEqual(f.merge(1).status, 0);
  assert.equal(succeeded(f.git(['show', ':value.txt'], slice.dir)), 'staged work');
  assert.equal(fs.readFileSync(path.join(slice.dir, 'value.txt'), 'utf8'), 'staged work\n');
  assert.equal(succeeded(f.git(['rev-parse', 'feature/lifecycle'])), targetBefore);
});

test('merge preserves tracked changes created by a successful test command', (t) => {
  const f = fixture(t);
  succeeded(f.add());
  const slice = f.slice(1);
  f.commit(slice.dir, 'value.txt', 'committed\n');
  f.finish('T-001');
  const targetBefore = succeeded(f.git(['rev-parse', 'feature/lifecycle']));
  const testCmd = `node -e "require('node:fs').writeFileSync('value.txt', 'changed by tests')"`;
  const result = spawnSync(process.execPath, [
    SCRIPT, 'merge', '--root', f.root, '--out', f.out, '--index', '1', '--test-cmd', testCmd,
  ], { cwd: f.root, encoding: 'utf8', timeout: 15_000 });

  assert.notEqual(result.status, 0, 'the tested checkout must still match its commit before merging');
  assert.equal(fs.readFileSync(path.join(slice.dir, 'value.txt'), 'utf8'), 'changed by tests');
  assert.equal(succeeded(f.git(['rev-parse', 'feature/lifecycle'])), targetBefore);
});

test('add can retry a later-slice failure without losing earlier commits or local work', (t) => {
  const f = fixture(t, [
    { id: 'T-001', worktree: 1, status: 'OPEN' },
    { id: 'T-002', worktree: 2, status: 'OPEN' },
  ]);
  assert.notEqual(f.add(2, f.fault(['worktree', 'add'], 'before', 'mmh/slice-2')).status, 0);
  const first = path.join(f.root, '.worktrees/mmh-1');
  const committed = f.commit(first, 'first.txt', 'work completed after interruption\n');
  write(path.join(first, 'next.txt'), 'work still in progress\n');

  succeeded(f.add(2));

  assert.equal(succeeded(f.git(['rev-parse', 'HEAD'], f.slice(1).dir)), committed);
  assert.equal(fs.readFileSync(path.join(f.slice(1).dir, 'first.txt'), 'utf8'), 'work completed after interruption\n');
  assert.equal(fs.readFileSync(path.join(f.slice(1).dir, 'next.txt'), 'utf8'), 'work still in progress\n');
  assert.equal(succeeded(f.git(['branch', '--show-current'], f.slice(2).dir)), 'mmh/slice-2');
  assert.equal(f.state().into, 'feature/lifecycle');
});

test('add recovers a process interruption after Git creates a worktree', (t) => {
  const f = fixture(t);
  assert.notEqual(f.add(1, f.fault(['worktree', 'add'], 'after', 'mmh/slice-1')).status, 0);
  const first = path.join(f.root, '.worktrees/mmh-1');
  const committed = f.commit(first, 'first.txt', 'preserved across restart\n');

  succeeded(f.add());

  assert.equal(succeeded(f.git(['rev-parse', 'HEAD'], f.slice(1).dir)), committed);
  assert.equal(fs.readFileSync(path.join(f.slice(1).dir, 'first.txt'), 'utf8'), 'preserved across restart\n');
  assert.equal((succeeded(f.git(['worktree', 'list', '--porcelain'])).match(/^worktree /gm) || []).length, 2);
});

test('add retries a failed Git checkout while preserving the branch created by that attempt', (t) => {
  const f = fixture(t);
  succeeded(f.git(['config', 'filter.checkout-test.clean', 'cat']));
  succeeded(f.git(['config', 'filter.checkout-test.smudge', 'false']));
  succeeded(f.git(['config', 'filter.checkout-test.required', 'true']));
  f.commit(f.root, '.gitattributes', '*.filtered filter=checkout-test\n');
  const initialHead = f.commit(f.root, 'example.filtered', 'content that must survive checkout failure\n');

  assert.notEqual(f.add().status, 0);
  assert.equal(succeeded(f.git(['rev-parse', 'mmh/slice-1'])), initialHead);
  assert.equal(fs.existsSync(path.join(f.root, '.worktrees/mmh-1')), false);
  succeeded(f.git(['config', 'filter.checkout-test.smudge', 'cat']));

  succeeded(f.add());

  assert.equal(succeeded(f.git(['rev-parse', 'HEAD'], f.slice(1).dir)), initialHead);
  assert.equal(fs.readFileSync(path.join(f.slice(1).dir, 'example.filtered'), 'utf8'),
    'content that must survive checkout failure\n');
  assert.equal((succeeded(f.git(['worktree', 'list', '--porcelain'])).match(/^worktree /gm) || []).length, 2);
});

test('add never adopts an unrelated preexisting slice branch on retry', (t) => {
  const f = fixture(t);
  const initialHead = succeeded(f.git(['rev-parse', 'HEAD']));
  succeeded(f.git(['branch', 'mmh/slice-1']));

  assert.notEqual(f.add().status, 0);
  assert.notEqual(f.add().status, 0);

  assert.equal(succeeded(f.git(['rev-parse', 'mmh/slice-1'])), initialHead);
  assert.equal(fs.existsSync(path.join(f.root, '.worktrees/mmh-1')), false);
});

test('pack mutations can resume after interruption at each lock acquisition boundary', (t) => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-lock-recovery-')));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const script = `
    import fs from 'node:fs';
    import { withPackLock } from ${JSON.stringify(STATE_MODULE)};
    const dir = process.argv[1], stop = Number(process.argv[2]);
    let acquired = false;
    const operations = [];
    for (const name of ['mkdirSync', 'openSync', 'writeFileSync', 'renameSync', 'symlinkSync', 'linkSync']) {
      const original = fs[name];
      fs[name] = (...args) => {
        const result = original(...args);
        if (!acquired && args.some(value => typeof value === 'string' && value.startsWith(dir))) {
          operations.push(name);
          if (operations.length === stop) process.kill(process.pid, 'SIGKILL');
        }
        return result;
      };
    }
    withPackLock(dir, () => { acquired = true; });
    process.stdout.write(JSON.stringify(operations));
  `;
  const run = (dir, stop = 0) => spawnSync(process.execPath, ['--input-type=module', '-e', script, dir, String(stop)], {
    encoding: 'utf8', timeout: 15_000,
  });
  const operations = JSON.parse(succeeded(run(path.join(sandbox, 'reference'))));
  assert.ok(operations.length > 0, 'the fault harness must observe actual acquisition operations');
  for (let boundary = 1; boundary <= operations.length; boundary++) {
    const dir = path.join(sandbox, `interruption-${boundary}`);
    const interrupted = run(dir, boundary);
    assert.equal(interrupted.signal, 'SIGKILL', `fault injection must reach acquisition boundary ${boundary}`);
    const resumed = run(dir);
    assert.equal(resumed.status, 0,
      `lock must recover after boundary ${boundary} (${operations[boundary - 1]}): ${resumed.stderr}`);
  }
});

for (const fault of [
  { name: 'branch deletion fails', match: ['branch', '-d'], mode: 'before' },
  { name: 'the process stops after worktree removal', match: ['worktree', 'remove'], mode: 'after' },
]) {
  test(`merge retries safely when ${fault.name}`, (t) => {
    const f = fixture(t);
    succeeded(f.add());
    const slice = f.slice(1);
    const commit = f.commit(slice.dir, 'delivered.txt', 'delivered exactly once\n');
    f.finish('T-001');
    const result = f.merge(1, f.fault(fault.match, fault.mode));
    assert.notEqual(result.status, 0, 'the injected interruption must actually occur');
    assert.equal(fs.readFileSync(path.join(f.root, 'delivered.txt'), 'utf8'), 'delivered exactly once\n');
    const integratedHead = succeeded(f.git(['rev-parse', 'feature/lifecycle']));

    succeeded(f.merge(1));

    assert.equal(succeeded(f.git(['rev-parse', 'feature/lifecycle'])), integratedHead);
    succeeded(f.git(['merge-base', '--is-ancestor', commit, 'feature/lifecycle']));
    assert.equal(fs.existsSync(slice.dir), false);
    assert.equal(succeeded(f.git(['branch', '--list', 'mmh/slice-1'])), '');
    assert.equal(f.slice(1).merged, true);
    assert.equal(f.slice(1).removed, true);
    succeeded(f.command('verify-clean'));
  });
}

test('pausing after one task preserves a resumable slice until its remaining task is merged', (t) => {
  const f = fixture(t, [
    { id: 'T-001', worktree: 1, status: 'OPEN' },
    { id: 'T-002', worktree: 1, status: 'OPEN' },
  ]);
  succeeded(f.add());
  const slice = f.slice(1);
  f.commit(slice.dir, 'first.txt', 'first task\n');
  f.finish('T-001');
  succeeded(f.merge(1));

  assert.equal(fs.readFileSync(path.join(f.root, 'first.txt'), 'utf8'), 'first task\n');
  assert.equal(fs.existsSync(slice.dir), true, 'remaining tasks still need their checkout');
  const resumed = resumeState(f.root);
  assert.equal(resumed.resumable, true);
  assert.equal(resumed.pack, f.out);
  assert.equal(resumed.next_step, 'implement');
  f.commit(slice.dir, 'second.txt', 'second task\n');
  f.finish('T-002');

  succeeded(f.merge(1));

  assert.equal(fs.readFileSync(path.join(f.root, 'first.txt'), 'utf8'), 'first task\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'second.txt'), 'utf8'), 'second task\n');
  assert.equal(fs.existsSync(slice.dir), false);
  succeeded(f.command('verify-clean'));
});

test('sync waits for integrated dependencies, preserves local work, and supplies dependency content', (t) => {
  const f = fixture(t, [
    { id: 'T-001', worktree: 1, status: 'OPEN' },
    { id: 'T-002', worktree: 2, status: 'OPEN', depends_on: ['T-001'] },
  ]);
  succeeded(f.add(2));
  const first = f.slice(1);
  const second = f.slice(2);
  const secondBefore = succeeded(f.git(['rev-parse', 'HEAD'], second.dir));
  assert.notEqual(f.command('sync', ['--index', '2']).status, 0);
  assert.equal(succeeded(f.git(['rev-parse', 'HEAD'], second.dir)), secondBefore);
  const dependencyCommit = f.commit(first.dir, 'dependency.cjs', 'module.exports = 41;\n');
  f.finish('T-001');
  assert.notEqual(f.command('sync', ['--index', '2']).status, 0, 'DONE alone is insufficient before integration');
  assert.equal(fs.existsSync(path.join(second.dir, 'dependency.cjs')), false);
  succeeded(f.merge(1));
  write(path.join(second.dir, 'value.txt'), 'unfinished dependent work\n');
  assert.notEqual(f.command('sync', ['--index', '2']).status, 0);
  assert.equal(fs.readFileSync(path.join(second.dir, 'value.txt'), 'utf8'), 'unfinished dependent work\n');
  assert.equal(succeeded(f.git(['rev-parse', 'HEAD'], second.dir)), secondBefore);
  succeeded(f.git(['restore', 'value.txt'], second.dir));

  succeeded(f.command('sync', ['--index', '2'], {},
    `node -e "require('node:assert/strict').equal(require('./dependency.cjs'), 41)"`));

  assert.equal(fs.readFileSync(path.join(second.dir, 'dependency.cjs'), 'utf8'), 'module.exports = 41;\n');
  succeeded(f.git(['merge-base', '--is-ancestor', dependencyCommit, 'HEAD'], second.dir));
  f.commit(second.dir, 'consumer.cjs', "module.exports = require('./dependency.cjs') + 1;\n");
  f.finish('T-002');
  succeeded(f.merge(2));
  const result = spawnSync(process.execPath, ['-e', "process.stdout.write(String(require('./consumer.cjs')))"], {
    cwd: f.root, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(succeeded(result), '42');
  succeeded(f.command('verify-clean'));
});

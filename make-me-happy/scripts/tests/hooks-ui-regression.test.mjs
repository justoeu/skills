import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOOK_IDS, aggregateVerdict, buildDiffFacts, runDepsFreshness } from '../hooks.mjs';
import { buildUiScope, buildDriverSource, runDrive, bootApp, teardownApp } from '../ui-acceptance.mjs';

const HOOK_CLI = fileURLToPath(new URL('../hooks.mjs', import.meta.url));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, name, body) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  return file;
}

function greenHooks(dir) {
  for (const hook of HOOK_IDS) {
    write(dir, `hooks/${hook}.json`, { hook, verdict: 'APPROVE', findings: [], round: 1, summary: 'Checked fixture.' });
  }
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function gitRepo(t) {
  const dir = fixture(t);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Regression fixture');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.hooksPath', path.join(dir, 'empty-hooks'));
  return dir;
}

function commit(dir, message) {
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', message);
  return git(dir, 'rev-parse', 'HEAD');
}

test('hook gate rejects malformed documents rather than approving missing evidence', async (t) => {
  const cases = {
    empty: {},
    'unknown verdict': { hook: 'security', verdict: 'GREEN', findings: [] },
    'wrong hook identity': { hook: 'performance', verdict: 'APPROVE', findings: [] },
    'non-array findings': { hook: 'security', verdict: 'APPROVE', findings: {} },
    'unknown severity': { hook: 'security', verdict: 'REJECT', findings: [{ id: 'S-1', severity: 'urgent', status: 'open', title: 'Unsafe route' }] },
    'unknown status': { hook: 'security', verdict: 'REJECT', findings: [{ id: 'S-1', severity: 'high', status: 'pending', title: 'Unsafe route' }] },
  };
  for (const [name, doc] of Object.entries(cases)) {
    await t.test(name, (t) => {
      const dir = fixture(t);
      greenHooks(dir);
      assert.equal(aggregateVerdict(dir).verdict, 'PASS');
      write(dir, 'hooks/security.json', doc);
      assert.equal(aggregateVerdict(dir).verdict, 'FAIL');
    });
  }
});

test('hook gate blocks an open critical finding even if the author wrote APPROVE', (t) => {
  const dir = fixture(t);
  greenHooks(dir);
  write(dir, 'hooks/security.json', {
    hook: 'security', verdict: 'APPROVE', findings: [{ id: 'S-1', severity: 'critical', status: 'open', title: 'Unsafe route' }],
  });
  const result = aggregateVerdict(dir);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.hooks.find((row) => row.hook === 'security').blocking, true);
});

test('dependency waiver remains attached to its finding after another round', async (t) => {
  const dir = fixture(t);
  greenHooks(dir);
  const facts = (alphaVersion, betaVersion) => ({ manifests: [{
    file: 'package.json', ecosystem: 'npm', added: [
      { name: 'alpha', version: alphaVersion, dev: false },
      { name: 'beta', version: betaVersion, dev: false },
    ], removed: [], changed: [],
  }] });
  const fakeRegistry = { npm: {
    alpha: { latest: '2.0.0', deprecated: true },
    beta: { latest: '2.0.0', deprecated: true },
  } };
  write(dir, 'hooks/diff-facts.json', facts('1.0.0', '1.0.0'));
  const first = await runDepsFreshness(dir, dir, { fakeRegistry });
  write(dir, 'hooks/deps-freshness.json', first);
  const alpha = first.findings.find((f) => f.dep === 'alpha' && f.status === 'open');
  const beta = first.findings.find((f) => f.dep === 'beta' && f.status === 'open');
  assert.ok(alpha && beta);
  const waiver = spawnSync(process.execPath, [HOOK_CLI, 'waive', '--dir', dir,
    '--hook', 'deps-freshness', '--finding', alpha.id, '--reason', 'User accepted only alpha 1.0.0.'], { encoding: 'utf8' });
  assert.equal(waiver.status, 0, waiver.stderr);
  assert.equal(aggregateVerdict(dir).verdict, 'FAIL', 'beta is still unwaived');
  write(dir, 'hooks/diff-facts.json', facts('2.0.0', '1.0.0'));
  const second = await runDepsFreshness(dir, dir, { fakeRegistry: { npm: {
    alpha: { latest: '2.0.0', deprecated: false },
    beta: { latest: '2.0.0', deprecated: true },
  } } });
  write(dir, 'hooks/deps-freshness.json', second);
  const stillOpen = second.findings.find((f) => f.dep === 'beta' && f.status === 'open');
  assert.ok(stillOpen);
  assert.equal(stillOpen.id, beta.id, 'a finding must not inherit another dependency ID');
  assert.equal(aggregateVerdict(dir).verdict, 'FAIL', 'alpha waiver must never approve beta');
});

test('nested manifest paths retain their added dependencies through freshness checking', async (t) => {
  const dir = gitRepo(t);
  write(dir, 'apps/web/package.json', { dependencies: {} });
  const base = commit(dir, 'baseline');
  write(dir, 'apps/web/package.json', { dependencies: { oldlib: '1.0.0' } });
  commit(dir, 'add nested dependency');
  const out = fixture(t);
  const facts = buildDiffFacts(dir, base);
  const manifest = facts.manifests.find((m) => m.file === 'apps/web/package.json');
  assert.ok(manifest, 'diff must retain the real nested path');
  assert.deepEqual(manifest.added.map((d) => d.name), ['oldlib']);
  write(out, 'hooks/diff-facts.json', facts);
  const result = await runDepsFreshness(dir, out, { fakeRegistry: { npm: { oldlib: { latest: '9.0.0' } } } });
  assert.ok(result.deps.some((d) => d.name === 'oldlib' && d.current === '1.0.0'));
  assert.ok(result.findings.some((f) => f.dep === 'oldlib' && f.status === 'open'));
});

test('removing the last new dependency keeps the earlier review round and resolved finding', async (t) => {
  const dir = fixture(t);
  write(dir, 'hooks/diff-facts.json', { manifests: [{ file: 'package.json', ecosystem: 'npm',
    added: [{ name: 'alpha', version: '1.0.0', dev: false }], removed: [], changed: [] }] });
  const first = await runDepsFreshness(dir, dir, { fakeRegistry: { npm: { alpha: { latest: '2.0.0', deprecated: true } } } });
  write(dir, 'hooks/deps-freshness.json', first);
  write(dir, 'hooks/diff-facts.json', { manifests: [] });
  const second = await runDepsFreshness(dir, dir, { fetchJson: async () => { throw new Error('registry must not be called'); } });
  assert.equal(second.verdict, 'APPROVE');
  assert.equal(second.round, first.round + 1);
  assert.equal(second.rounds.length, first.rounds.length + 1);
  assert.equal(second.findings.find((f) => f.id === first.findings[0].id)?.status, 'fixed');
});

test('UI scope uses run-meta baseline before diff-facts exists', (t) => {
  const dir = gitRepo(t);
  write(dir, 'README.md', 'Fixture');
  const base = commit(dir, 'baseline');
  write(dir, 'apps/web/src/Checkout.tsx', 'export const Checkout = () => null;');
  commit(dir, 'add checkout');
  const out = fixture(t);
  write(out, 'run-meta.json', { head: base, ui_drive: 'fast' });
  write(out, 'payloads.json', []);
  const scope = buildUiScope(dir, out);
  assert.equal(scope.ui_touched, true);
  assert.ok(scope.frontend_files.includes('apps/web/src/Checkout.tsx'));
});

test('UI scope cannot reuse backend-only diff facts after a later UI commit', (t) => {
  const dir = gitRepo(t);
  write(dir, 'README.md', 'Fixture');
  const base = commit(dir, 'baseline');
  write(dir, 'server.go', 'package main');
  commit(dir, 'backend change');
  const out = fixture(t);
  write(out, 'run-meta.json', { head: base, ui_drive: 'fast' });
  write(out, 'hooks/diff-facts.json', buildDiffFacts(dir, base));
  write(dir, 'src/Checkout.tsx', 'export const Checkout = () => null;');
  commit(dir, 'later UI change');
  const scope = buildUiScope(dir, out);
  assert.equal(scope.ui_touched, true);
  assert.ok(scope.frontend_files.includes('src/Checkout.tsx'));
});

test('UI scope accounts for uncommitted UI changes after the last backend commit', (t) => {
  const dir = gitRepo(t);
  write(dir, 'src/Checkout.tsx', 'export const Checkout = () => null;');
  const base = commit(dir, 'baseline UI');
  write(dir, 'server.go', 'package main');
  commit(dir, 'backend change');
  const out = fixture(t);
  write(out, 'run-meta.json', { head: base });
  assert.equal(buildUiScope(dir, out).ui_touched, false, 'known backend-only diff can skip UI');
  write(dir, 'src/Checkout.tsx', 'export const Checkout = () => "changed";');
  write(dir, 'src/NewScreen.tsx', 'export const NewScreen = () => null;');
  const scope = buildUiScope(dir, out);
  assert.equal(scope.ui_touched, true);
  assert.ok(scope.frontend_files.includes('src/Checkout.tsx'));
  assert.ok(scope.frontend_files.includes('src/NewScreen.tsx'));
});

test('Node source and tests do not become UI merely through src or test paths', (t) => {
  const dir = gitRepo(t);
  write(dir, 'package.json', { type: 'module', devDependencies: { '@playwright/test': '1.0.0' } });
  const base = commit(dir, 'Node baseline');
  write(dir, 'src/cart.mjs', 'export const sum = (a, b) => a + b;');
  write(dir, 'test/cart.test.mjs', 'import { sum } from "../src/cart.mjs";');
  commit(dir, 'Node implementation');
  const out = fixture(t);
  write(out, 'run-meta.json', { head: base });
  const scope = buildUiScope(dir, out);
  assert.equal(scope.ui_touched, false);
  assert.deepEqual(scope.frontend_files, []);
});

test('browser JavaScript in an explicit frontend directory is detected without frameworks', (t) => {
  const dir = gitRepo(t);
  write(dir, 'README.md', 'Vanilla browser app');
  const base = commit(dir, 'baseline');
  write(dir, 'web/cart.js', 'document.querySelector("#cart").textContent = "Ready";');
  commit(dir, 'browser change');
  const out = fixture(t);
  write(out, 'run-meta.json', { head: base });
  const scope = buildUiScope(dir, out);
  assert.equal(scope.ui_touched, true);
  assert.deepEqual(scope.frontend_files, ['web/cart.js']);
});

test('plain JavaScript inside a React package is detected from its nearest manifest', (t) => {
  const dir = gitRepo(t);
  write(dir, 'package.json', { private: true, workspaces: ['packages/*'] });
  write(dir, 'packages/store/package.json', { dependencies: { react: '19.0.0' } });
  const base = commit(dir, 'workspace baseline');
  write(dir, 'packages/store/src/cart.js', 'import React from "react"; export const Cart = () => React.createElement("h1", null, "Cart");');
  commit(dir, 'React screen change');
  const out = fixture(t);
  write(out, 'run-meta.json', { head: base });
  const scope = buildUiScope(dir, out);
  assert.equal(scope.ui_touched, true);
  assert.deepEqual(scope.frontend_files, ['packages/store/src/cart.js']);
});

test('intrinsic UI extensions do not require a generic src directory hint', (t) => {
  const dir = gitRepo(t);
  write(dir, 'README.md', 'Fixture');
  const base = commit(dir, 'baseline');
  write(dir, 'Checkout.jsx', 'export const Checkout = () => <h1>Checkout</h1>;');
  commit(dir, 'screen change');
  const out = fixture(t);
  write(out, 'run-meta.json', { head: base });
  assert.equal(buildUiScope(dir, out).ui_touched, true);
});

test('UI scope without diff evidence cannot silently claim backend-only SKIP', (t) => {
  const dir = fixture(t);
  const scope = buildUiScope(dir, dir);
  assert.notEqual(scope.ui_touched, false);
  greenHooks(dir);
  fs.unlinkSync(path.join(dir, 'hooks/ui-acceptance.json'));
  write(dir, 'hooks/ui-scope.json', scope);
  const result = aggregateVerdict(dir);
  assert.equal(result.verdict, 'FAIL');
  assert.notEqual(result.hooks.find((h) => h.hook === 'ui-acceptance').verdict, 'SKIP');
});

// Execute the generated production driver, replacing only the browser/IO boundary.
async function driveInVm(spec, emitOnGoto = () => {}) {
  const handlers = new Map();
  let journey;
  let exit;
  let closed = false;
  const emit = (event, value) => handlers.get(event)?.(value);
  const page = {
    on: (event, callback) => handlers.set(event, callback),
    goto: async () => emitOnGoto(emit),
    url: () => `${spec.base_url}/checkout`,
    screenshot: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    waitForSelector: async () => ({ textContent: async () => 'Checkout' }),
    textContent: async () => 'Checkout',
  };
  const playwright = { chromium: { launch: async () => ({
    newContext: async () => ({ newPage: async () => page, route: async () => {} }),
    close: async () => { closed = true; },
  }) } };
  const fakeFs = {
    readFileSync: () => JSON.stringify(spec),
    writeFileSync: (_file, body) => { journey = JSON.parse(body); },
  };
  const errors = [];
  await vm.runInNewContext(buildDriverSource(), {
    require: (name) => {
      if (name === 'playwright') return playwright;
      if (name === 'fs' || name === 'node:fs') return fakeFs;
      if (name === 'path' || name === 'node:path') return path;
      throw new Error(`Unexpected driver dependency: ${name}`);
    },
    process: { env: { SPEC: 'fixture.json', OUT_JSON: 'result.json', SHOT_DIR: '/tmp', MMH_UI_EXECUTION_ID: 'fixture-execution' }, exit: (code) => { exit = code; } },
    URL,
    console: { log() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
  });
  assert.ok(journey, `driver must write a result; stderr: ${errors.join('\n')}`);
  assert.equal(closed, true);
  return { journey, exit };
}

const journeySpec = () => ({
  screen: 'checkout', base_url: 'http://localhost:3999',
  steps: [{ action: 'goto', path: '/checkout' }, { action: 'assert_text', selector: 'h1', text: 'Checkout' }],
});
const response = (status, pathname) => ({ status: () => status, url: () => `http://localhost:3999${pathname}` });

test('generated UI driver rejects page crashes even when all assertions pass', async () => {
  const { journey, exit } = await driveInVm(journeySpec(), (emit) => emit('pageerror', new Error('render crashed')));
  assert.equal(journey.verdict, 'REJECT');
  assert.notEqual(exit, 0);
  assert.equal(journey.console_errors.length, 1);
});

test('generated UI driver rejects console errors even without a thrown page exception', async () => {
  const { journey, exit } = await driveInVm(journeySpec(), (emit) => emit('console', {
    type: () => 'error', text: () => 'Checkout request failed',
  }));
  assert.equal(journey.verdict, 'REJECT');
  assert.notEqual(exit, 0);
  assert.equal(journey.console_errors.length, 1);
});

test('generated UI driver rejects unexpected HTTP errors and permits only the exact documented expectation', async () => {
  const spec = { ...journeySpec(), expected_network_errors: [{ status: 422, path: '/api/checkout' }] };
  const expected = await driveInVm(spec, (emit) => emit('response', response(422, '/api/checkout')));
  assert.equal(expected.journey.verdict, 'APPROVE');
  assert.equal(expected.exit, 0);
  assert.equal(expected.journey.network_errors.length, 1, 'expected errors remain visible as evidence');
  for (const [status, pathname] of [[500, '/api/checkout'], [422, '/api/orders']]) {
    const unexpected = await driveInVm(spec, (emit) => emit('response', response(status, pathname)));
    assert.equal(unexpected.journey.verdict, 'REJECT', `${status} ${pathname} is not waived`);
    assert.notEqual(unexpected.exit, 0);
  }
});

test('expected HTTP validation does not fail on Chromium own resource diagnostic', async () => {
  const spec = { ...journeySpec(), expected_network_errors: [{ status: 422, path: '/api/checkout' }] };
  const { journey, exit } = await driveInVm(spec, (emit) => {
    emit('response', response(422, '/api/checkout'));
    emit('console', {
      type: () => 'error',
      text: () => 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
      location: () => ({ url: 'http://localhost:3999/api/checkout', lineNumber: 0, columnNumber: 0 }),
      args: () => [],
    });
  });
  assert.equal(journey.verdict, 'APPROVE');
  assert.equal(exit, 0);
  assert.equal(journey.console_errors.length, 1, 'browser diagnostic remains visible');
});

test('an application console.error cannot borrow the expected HTTP exemption', async () => {
  const spec = { ...journeySpec(), expected_network_errors: [{ status: 422, path: '/api/checkout' }] };
  const { journey, exit } = await driveInVm(spec, (emit) => {
    emit('response', response(422, '/api/checkout'));
    emit('console', {
      type: () => 'error',
      text: () => 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
      location: () => ({ url: 'http://localhost:3999/api/checkout', lineNumber: 0, columnNumber: 0 }),
      args: () => [{}],
    });
  });
  assert.equal(journey.verdict, 'REJECT');
  assert.notEqual(exit, 0);
});

test('a native resource diagnostic needs a matching observed response URL to be exempt', async () => {
  const spec = { ...journeySpec(), expected_network_errors: [{ status: 422, path: '/api/checkout' }] };
  for (const observed of [false, true]) {
    const { journey, exit } = await driveInVm(spec, (emit) => {
      if (observed) emit('response', response(422, '/api/checkout'));
      emit('console', {
        type: () => 'error',
        text: () => 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
        location: () => ({ url: observed ? 'http://localhost:3999/api/orders' : 'http://localhost:3999/api/checkout' }),
        args: () => [],
      });
    });
    assert.equal(journey.verdict, 'REJECT');
    assert.notEqual(exit, 0);
  }
});

test('failed drive rerun cannot reuse a previous APPROVE artifact', async (t) => {
  const dir = fixture(t);
  const specPath = write(dir, 'ui/drive/checkout.spec.json', journeySpec());
  const old = { screen: 'checkout', verdict: 'APPROVE', at: '2000-01-01T00:00:00Z', execution_id: 'previous-run' };
  write(dir, 'ui/journeys/checkout.json', old);
  const result = await runDrive(dir, {
    specPath, ensureFn: () => ({ ready: true }),
    spawnFn: async () => ({ status: 2, stdout: '', stderr: 'Browser failed to launch.' }),
  });
  assert.equal(result.ok, false);
  assert.notEqual(result.journey?.verdict, 'APPROVE');
  const currentFile = path.join(dir, 'ui/journeys/checkout.json');
  if (fs.existsSync(currentFile)) assert.notEqual(JSON.parse(fs.readFileSync(currentFile, 'utf8')).verdict, 'APPROVE');
});

test('failed browser preparation also invalidates the current journey approval', async (t) => {
  const dir = fixture(t);
  const specPath = write(dir, 'ui/drive/checkout.spec.json', journeySpec());
  const currentFile = write(dir, 'ui/journeys/checkout.json', { screen: 'checkout', verdict: 'APPROVE', execution_id: 'previous-run' });
  let failed = false;
  try {
    const result = await runDrive(dir, { specPath, ensureFn: () => ({ ready: false, error: 'Browser unavailable' }) });
    failed = result.ok === false;
  } catch {
    failed = true;
  }
  assert.equal(failed, true);
  if (fs.existsSync(currentFile)) assert.notEqual(JSON.parse(fs.readFileSync(currentFile, 'utf8')).verdict, 'APPROVE');
});

test('another drive round does not overwrite screenshots referenced by the earlier round', async (t) => {
  const dir = fixture(t);
  const specPath = write(dir, 'ui/drive/checkout.spec.json', journeySpec());
  let round = 0;
  const runner = async (_cmd, _args, opts) => {
    round += 1;
    const screenshot = write(opts.env.SHOT_DIR, 'checkout-01-final.png', `round-${round}`);
    write(path.dirname(opts.env.OUT_JSON), path.basename(opts.env.OUT_JSON), {
      screen: 'checkout', execution_id: opts.env.EXECUTION_ID, verdict: 'APPROVE', screenshots: [screenshot],
    });
    return { status: 0, stdout: '', stderr: '' };
  };
  const first = await runDrive(dir, { specPath, ensureFn: () => ({ ready: true }), spawnFn: runner });
  const second = await runDrive(dir, { specPath, ensureFn: () => ({ ready: true }), spawnFn: runner });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.journey.screenshots[0], second.journey.screenshots[0]);
  assert.equal(fs.readFileSync(first.journey.screenshots[0], 'utf8'), 'round-1');
});

const shellQuote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));

test('boot refuses an occupied port before running a command or trusting the other server', async (t) => {
  const dir = fixture(t);
  const server = http.createServer((_req, res) => { res.end('unrelated server'); });
  await listen(server);
  t.after(() => close(server));
  const marker = path.join(dir, 'command-ran');
  const script = write(dir, 'boot-command.cjs', "require('fs').writeFileSync('command-ran', 'yes');");
  let result;
  let rejected = false;
  try {
    result = await bootApp(dir, dir, {
      cmd: `${shellQuote(process.execPath)} ${shellQuote(script)}`,
      port: server.address().port, timeoutMs: 1000,
    });
    rejected = result.ok === false;
  } catch {
    rejected = true;
  } finally {
    if (result?.boot?.pid) await teardownApp(dir);
  }
  assert.equal(rejected, true, 'another server must not prove this app booted');
  assert.equal(fs.existsSync(marker), false, 'preflight must prevent running the command');
  assert.equal(server.listening, true, 'the unrelated server belongs to someone else');
});

test('teardown stops only its own server and retains the boot evidence for reports', async (t) => {
  const dir = fixture(t);
  const probe = http.createServer();
  await listen(probe);
  const port = probe.address().port;
  await close(probe);
  const script = write(dir, 'server.cjs', `require('http').createServer((q,s)=>s.end('ok')).listen(${port}, '127.0.0.1');`);
  const result = await bootApp(dir, dir, {
    cmd: `${shellQuote(process.execPath)} ${shellQuote(script)}`, port, timeoutMs: 5000,
  });
  try {
    assert.equal(result.ok, true);
    await teardownApp(dir);
    const bootFile = path.join(dir, 'ui/boot.json');
    assert.equal(fs.existsSync(bootFile), true, 'teardown must preserve report evidence');
    const saved = JSON.parse(fs.readFileSync(bootFile, 'utf8'));
    assert.equal(saved.cmd, result.boot.cmd);
    assert.equal(saved.at, result.boot.at);
    assert.deepEqual(saved.health, result.boot.health);
    const second = await teardownApp(dir);
    assert.equal(second.killed, false, 'teardown is idempotent after recording stop');
    const deadline = Date.now() + 2000;
    let down = false;
    while (!down && Date.now() < deadline) {
      down = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(200) }).then(() => false, () => true);
      if (!down) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(down, true, 'the owned server must stop, not just update its metadata');
  } finally {
    await teardownApp(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-regression-'));
  if (process.env.ATLAS_KEEP_FIXTURES === '1') t.diagnostic('Fixture retained: ' + dir);
  else t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(dir, name, data) { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(data)); return p; }
function python(script, args) { return spawnSync('python3', [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' }); }
function build(dir, model, name = 'model') {
  const p = write(dir, name + '.json', model), html = path.join(dir, name + '.html');
  const run = python('atlas_build.py', [p, '--template', path.join(root, 'assets/template.html'), '-o', html]);
  return { ...run, model: JSON.parse(fs.readFileSync(p)), html: fs.existsSync(html) ? fs.readFileSync(html, 'utf8') : null };
}
function merge(dir, old, scan, mode = 'delta') {
  const prev = path.join(dir, 'previous.json');
  if (old) write(dir, 'previous.json', old); else fs.rmSync(prev, { force: true });
  const incoming = write(dir, 'scan.json', scan), out = path.join(dir, 'merged.json');
  const run = python('atlas_merge.py', [prev, incoming, '--mode', mode, '--commit', scan.app?.commit || 'c2', '-o', out]);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(fs.readFileSync(out));
}
function model() {
  return {
    schema: 'atlas-docs/1', app: { name: 'Orders fixture', commit: 'c0', generatedAt: '2026-10-22T10:00:00Z' },
    flows: [{ id: 'orders', label: 'Orders', brief: { what: 'Create order', does: 'Validate and save', happy: ['Saved'], unhappy: ['Invalid'] }, steps: [{ name: 'Create', payload: '{}', src: 'orders.mjs:1', calls: ['save'], errs: ['Invalid'], does: 'Save order', touches: ['orders'] }] }],
    entrypoints: [{ kind: 'http', ref: 'POST /orders', status: 'mapeado', flow: 'orders' }],
    architecture: { libs: [{ group: 'Runtime', items: [{ name: 'express', ver: '5.0.0' }, { name: 'sqlite3', ver: '5.1.0' }] }] },
    data: { model: [{ name: 'orders' }], ddl: { sql: 'CREATE TABLE orders(id TEXT)' } },
    contracts: { endpoints: [{ m: 'POST', path: '/orders' }] },
    env: { vars: [{ name: 'PORT', desc: 'HTTP port', flows: ['orders'] }] },
    quality: { gates: [{ name: 'synthetic gate', status: 'pass' }] },
    history: { scans: [], coverage: [], changelog: [] },
  };
}

test('first run creates nested model and HTML output directories', t => {
  const dir = fixture(t), incoming = write(dir, 'scan.json', model());
  const output = path.join(dir, 'docs', 'atlas', 'app-model.json');
  const merged = python('atlas_merge.py', [output, incoming, '--mode', 'full', '--commit', 'c1', '-o', output]);
  assert.equal(merged.status, 0, merged.stderr);
  const html = path.join(dir, 'published', 'atlas', 'index.html');
  const built = python('atlas_build.py', [output, '--template', path.join(root, 'assets/template.html'), '-o', html]);
  assert.equal(built.status, 0, built.stderr);
  assert.ok(fs.readFileSync(html, 'utf8').includes('Orders fixture'));
});

test('A2: sanitizes synthetic URL, headers, serialized JSON and private-key text in both artifacts', t => {
  const m = model(), dir = fixture(t);
  m.env.vars.push({ name: 'DATABASE_URL', value: 'postgres://synthetic:CANARY_URL@localhost/db' });
  m.flows[0].steps[0].payload = '{"password":"CANARY_JSON","token":"CANARY_TOKEN"}\nAuthorization: Bearer CANARY_HEADER';
  m.thirdParty = [{ name: 'fixture', prod: 'https://synthetic:CANARY_HTTP@example.invalid/?token=CANARY_QUERY' }];
  m.identity = { auth: '**** partial CANARY_PARTIAL', notes: '-----BEGIN PRIVATE KEY-----\nCANARY_PEM\n-----END PRIVATE KEY-----' };
  const r = build(dir, m);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(/CANARY_/.test(JSON.stringify(r.model) + r.html), false, 'Synthetic secrets must be absent from both artifacts');
  assert.match(r.model.env.vars.at(-1).value, /localhost\/db/);
});

test('A3: coverage is recomputed on every build, including empty steps and supplied extreme cov', t => {
  const dir = fixture(t), first = build(dir, model());
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.model.score.overall, 100);
  for (const steps of [[{ name: 'No evidence' }], []]) {
    const changed = structuredClone(first.model);
    changed.flows[0].steps = steps; changed.flows[0].cov = 1000;
    const r = build(dir, changed);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.model.flows[0].cov, 0);
    assert.equal(r.model.score.overall, 55);
  }
});

test('A7: missing inventory, unjustified empty inventory and trivial without note fail; justified no-entrypoint app passes', t => {
  const dir = fixture(t);
  for (const eps of [undefined, [], [{ kind: 'http', ref: 'POST /orders', status: 'trivial' }]]) {
    const m = model(); m.entrypoints = eps;
    const r = build(dir, m);
    assert.notEqual(r.status, 0); assert.equal(r.html, null);
  }
  const m = model(); m.flows = []; m.env.vars = []; m.entrypoints = [];
  m.entrypointsNote = 'Static schema package; no executable or public API.';
  assert.equal(build(dir, m, 'empty').status, 0);
});

test('A9: dangling env and every C4 flow reference block publication', t => {
  const dir = fixture(t);
  for (const field of ['env', 'self', 'actors', 'systems', 'containers']) {
    const m = model();
    if (field === 'env') m.env.vars[0].flows.push('removed');
    else {
      m.c4 = { context: { self: {}, actors: [], systems: [] }, containers: [] };
      if (field === 'self') m.c4.context.self.flows = ['removed'];
      else (field === 'containers' ? m.c4.containers : m.c4.context[field]).push({ id: 'element', flows: ['removed'] });
    }
    const r = build(dir, m, field);
    assert.notEqual(r.status, 0, field); assert.equal(r.html, null);
    assert.match(r.stderr, /removed/);
  }
});

test('A8: known runtime metrics cannot retain unsourced values; cited observations survive with provenance', t => {
  const dir = fixture(t), m = model();
  m.data.tables = [{ name: 'orders', rows: 'CANARY_ROWS', size: 'CANARY_SIZE', wps: 'CANARY_WPS', prov: 'code' }];
  m.events = { topics: [{ topic: 'orders', group: 'worker', parts: 3, lag: 'CANARY_LAG', dlq: 'CANARY_DLQ' }] };
  m.identity = { stats: [{ k: 'Latency', v: 'CANARY_STAT', prov: 'external' }] };
  let r = build(dir, m);
  assert.equal(r.status, 0, r.stderr); assert.equal(/CANARY_/.test(JSON.stringify(r.model) + r.html), false);
  const source = { ref: 'fixtures/telemetry.json:3', observedAt: '2026-10-22T10:00:00Z' };
  m.data.tables[0].source = source; m.data.tables[0].rows = 123;
  m.events.topics[0].source = source; m.events.topics[0].lag = 2;
  r = build(dir, m, 'sourced');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.model.data.tables[0].rows, 123); assert.equal(r.model.events.topics[0].lag, 2);
  assert.equal(r.model.data.tables[0].prov, 'observed');
});

test('A4/A5 and first changelog: two updates preserve history and remove full lists including empty libs', t => {
  const dir = fixture(t), repo = path.join(dir, 'product'); fs.mkdirSync(repo);
  function git(...args) { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
  git('init', '-q'); git('config', 'user.name', 'Atlas fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', path.join(dir, 'no-hooks'));
  function commit(title) { git('add', '.'); git('commit', '-qm', title); return git('rev-parse', 'HEAD'); }
  fs.writeFileSync(path.join(repo, 'orders.mjs'), 'export const createOrder = input => ({ id: "fixture", ...input });');
  write(repo, 'package.json', { type: 'module', dependencies: { express: '5.0.0', sqlite3: '5.1.0' } });
  const c0 = commit('Create orders'), scan0 = model(); scan0.app.commit = c0; scan0.__changelog = [{ tag: 'NOVO', body: 'Orders introduced' }];
  let r = build(dir, merge(dir, null, scan0, 'full'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.model.history.changelog[0].body, 'Orders introduced');
  write(dir, 'state0.json', r.model);
  fs.writeFileSync(path.join(repo, 'refunds.mjs'), 'export const refund = id => ({ id, refunded: true });');
  const c1 = commit('Add refunds');
  const scan1 = { app: { commit: c1 }, flows: [{ ...scan0.flows[0], id: 'refunds', steps: [{ src: 'refunds.mjs:1' }] }], entrypoints: [{ kind: 'http', ref: 'POST /refunds', status: 'mapeado', flow: 'refunds' }], __changelog: [{ tag: 'NOVO', body: 'Refunds introduced' }] };
  r = build(dir, merge(dir, r.model, scan1));
  assert.equal(r.status, 0, r.stderr); assert.equal(r.model.score.overall, 82);
  assert.equal(r.model.app.commitPrev, c0); write(dir, 'state1.json', r.model);
  fs.unlinkSync(path.join(repo, 'refunds.mjs')); write(repo, 'package.json', { type: 'module', dependencies: { sqlite3: '5.2.0' } });
  const c2 = commit('Remove refunds and express');
  const delta = python('atlas_delta.py', [path.join(dir, 'state1.json'), '--repo', repo]);
  assert.equal(delta.status, 0, delta.stderr); const facts = JSON.parse(delta.stdout);
  assert.equal(facts.base, c1); assert.ok(facts.files.some(f => f.path === 'refunds.mjs' && f.status === 'D'));
  write(dir, 'delta.json', facts);
  const scan2 = { app: { commit: c2 }, flows: scan0.flows, entrypoints: scan0.entrypoints, architecture: { libs: [{ group: 'Runtime', items: [{ name: 'sqlite3', ver: '5.2.0' }] }] }, history: { scans: [], coverage: [], changelog: [] }, __changelog: [{ tag: 'REMOVE', body: 'Refunds removed' }] };
  r = build(dir, merge(dir, r.model, scan2, 'full'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.model.flows.map(f => f.id), ['orders']);
  assert.deepEqual(r.model.architecture.libs[0].items.map(i => i.name), ['sqlite3']);
  assert.equal(r.model.history.scans.length, 3); assert.equal(r.model.history.changelog.length, 3);
  assert.deepEqual(r.model.history.coverage.map(p => p.v), [100, 82, 100]);
  assert.equal(r.model.app.commitPrev, c1); write(dir, 'state2.json', r.model);
  assert.deepEqual(merge(dir, r.model, { architecture: { libs: [] } }, 'full').architecture.libs, []);
  assert.deepEqual(merge(dir, r.model, {}, 'full').architecture.libs, r.model.architecture.libs);
});

test('coverage history retains changed observations on same day and idempotent rebuild adds none', t => {
  const dir = fixture(t); let r = build(dir, model());
  r.model.flows[0].steps = [{ name: 'No evidence' }];
  r = build(dir, r.model);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.model.history.coverage.map(p => p.v), [100, 55]);
  const again = build(dir, r.model);
  assert.deepEqual(again.model.history.coverage, r.model.history.coverage);
  const next = merge(dir, r.model, { app: { commit: 'next' } });
  next.flows[0].steps = model().flows[0].steps;
  const improved = build(dir, next);
  assert.equal(improved.model.history.scans[0].delta, '+45%');
  improved.model.flows[0].steps = [];
  const rebuilt = build(dir, improved.model);
  assert.equal(rebuilt.model.history.scans[0].delta, '+0%');
  assert.equal(rebuilt.model.history.scans[0].score, 55);
});

test('v1 migrates only after successful validation; unknown schemas and duplicate IDs do not publish', t => {
  const dir = fixture(t), good = build(dir, model(), 'migration');
  assert.equal(good.status, 0, good.stderr); assert.equal(good.model.schema, 'atlas-docs/2');
  for (const kind of ['unknown', 'duplicate', 'invalid-id']) {
    const m = model();
    if (kind === 'unknown') m.schema = 'atlas-docs/99';
    else if (kind === 'duplicate') m.flows.push(structuredClone(m.flows[0]));
    else m.flows[0].id = ['invalid'];
    const r = build(dir, m, kind);
    assert.notEqual(r.status, 0); assert.equal(r.html, null); assert.deepEqual(r.model, m);
    assert.equal(r.stderr.includes('Traceback'), false);
  }
});

test('A6: delta uses current documented commit and includes reverted, dirty and untracked paths', t => {
  const dir = fixture(t);
  function git(...args) { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
  git('init', '-q'); git('config', 'user.name', 'Atlas fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', path.join(dir, 'no-hooks'));
  fs.writeFileSync(path.join(dir, 'orders.mjs'), 'export const orders = true;'); git('add', '.'); git('commit', '-qm', 'orders'); const c0 = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'refunds.mjs'), 'export const refund = true;'); git('add', '.'); git('commit', '-qm', 'refund'); const c1 = git('rev-parse', 'HEAD');
  fs.unlinkSync(path.join(dir, 'refunds.mjs')); git('add', '-u'); git('commit', '-qm', 'remove refund');
  fs.appendFileSync(path.join(dir, 'orders.mjs'), '\n// dirty'); fs.writeFileSync(path.join(dir, 'new.mjs'), '// untracked');
  const m = model(); m.app.commit = c1; m.app.commitPrev = c0;
  const p = write(dir, 'documented.json', m);
  let r = python('atlas_delta.py', [p, '--repo', dir]);
  assert.equal(r.status, 0, r.stderr);
  const delta = JSON.parse(r.stdout); assert.equal(delta.base, c1); assert.equal(delta.mode, 'delta');
  assert.ok(delta.files.some(f => f.path === 'refunds.mjs' && f.status === 'D'));
  assert.ok(delta.files.some(f => f.path === 'orders.mjs' && f.status === 'M'));
  assert.ok(delta.files.some(f => f.path === 'new.mjs' && f.status === '?'));
  m.app.commit = '0000000'; write(dir, 'documented.json', m);
  r = python('atlas_delta.py', [p, '--repo', dir]); assert.equal(JSON.parse(r.stdout).mode, 'full');
});

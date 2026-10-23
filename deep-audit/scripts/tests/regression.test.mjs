import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { hash, acquireLock } from '../pack-state.mjs';
const scripts = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = [];
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const put = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n'); };
const run = (name, args = [], expected = 0) => {
  const r = spawnSync(process.execPath, [path.join(scripts, name + '.mjs'), ...args], { encoding: 'utf8', timeout: 30000 });
  if (expected !== null) assert.equal(r.status, expected, `${name}: ${r.stdout}\n${r.stderr}`);
  return r;
};
function git(root, ...args) { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function fixture(flags = ['--only', 'classic_bugs', '--depth', 'fast']) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-audit-regression-')); temp.push(base);
  const root = path.join(base, 'repo'); fs.mkdirSync(root);
  put(path.join(root, 'package.json'), { name: 'fixture', version: '1.0.0' });
  fs.writeFileSync(path.join(root, 'bug.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'regression.cjs'), "require('node:assert/strict').equal(require('./bug.cjs'), 2);\n");
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid'); git(root, 'add', '.'); git(root, 'commit', '-m', 'baseline');
  const pack = path.join(base, 'pack');
  const init = jsonOutput(run('init-run', ['--root', root, '--full', '--out', pack, ...flags]));
  return { root, pack, base, init };
}
function jsonOutput(r) { return JSON.parse(r.stdout); }
const args = (f, ...rest) => ['--dir', f.pack, ...rest];
const snapshot = f => jsonOutput(run('run-state', ['snapshot', ...args(f)]));
function complete(f, s, stage, artifacts) { run('run-state', ['complete', ...args(f, '--stage', stage, '--snapshot', s.snapshot_id, '--artifacts', artifacts.join(','))]); }
const finding = (name = 'one', severity = 'HIGH') => ({ agent: 'Artemis', lens: 'classic_bugs', title: `Wrong ${name}`, path: `${name}.js`, line: 1, severity, confidence: 'high', evidence: 'returns wrong value for concrete input', impact: 'bad result', fix: 'correct branch' });
function deps(f, s) {
  run('check-deps-latest', ['--root', f.root, '--out', path.join(f.pack, 'deps-latest.json'), '--findings', path.join(f.pack, 'agent-prisma-freshness.json')]);
  complete(f, s, 'deps', ['deps-latest.json', 'agent-prisma-freshness.json']);
}
function baseline(f, list = []) {
  const s = snapshot(f); put(path.join(f.pack, 'agent-artemis.json'), list);
  complete(f, s, 'classic_bugs', ['agent-artemis.json']); deps(f, s);
  run('merge-findings', args(f)); return s;
}
function security(f, candidates = []) {
  const s = snapshot(f);
  put(path.join(f.pack, 'sec-deep/inventory.json'), { status: 'complete', components: [{ name: 'app', paths: ['.'] }], required_hunters: [{ component: 'app', lens: 'authorization' }], scope_note: 'Read fixture app, no external surfaces' });
  put(path.join(f.pack, 'sec-deep/hunter-app.json'), { status: 'complete', component: 'app', lens: 'authorization', scope_note: 'App paths and inputs traced', candidates });
  put(path.join(f.pack, 'sec-deep/candidates.json'), { candidates });
  complete(f, s, 'security_inventory', ['sec-deep/inventory.json']);
  complete(f, s, 'security_hunters', ['sec-deep/hunter-app.json', 'sec-deep/candidates.json']);
  return s;
}
function secArgs(f, s) { return args(f, '--snapshot', s.snapshot_id, '--candidates', path.join(f.pack, 'sec-deep/candidates.json'), '--votes-dir', path.join(f.pack, 'sec-deep/votes'), '--require-vote-files', '--out', path.join(f.pack, 'agent-cerbero.json')); }
function secVotes(f, s, candidate, bad = false) {
  for (const lens of ['REACHABILITY', 'IMPACT', 'DEFENSES']) put(path.join(f.pack, `sec-deep/votes/${candidate.temp_id}-${lens}.json`), { lens, verdict: bad && lens === 'DEFENSES' ? 'UNKNOWN' : 'TRUE_POSITIVE', reasoning: 'concrete trace', context: { run_id: f.init.run_id, source_hash: s.source_hash, candidate_hash: hash(candidate) } });
}
function review(f, id, reversal = true) {
  const context = jsonOutput(run('run-state', ['review-start', ...args(f, '--id', id)]));
  if (reversal) run('reversal-proof', args(f, '--id', id, '--base', f.init.head, '--fix-paths', 'bug.cjs', '--test-cmd', 'node regression.cjs'));
  for (const lens of ['CORRECTNESS', 'QUALITY', 'SCOPE']) put(path.join(f.pack, `reviews/votes/${id}-${lens}.json`), { context, lens, verdict: 'APROVA', reasoning: 'independent fixture review', required_changes: [], test_reversal_checked: reversal });
  return context;
}
test.after(() => { for (const p of temp) fs.rmSync(p, { recursive: true, force: true }); });

test('DA-01/06/11: JSON round trip, unique runs, explicit compatible resume and invalid base refusal', () => {
  const f = fixture(); const malicious = '$(printf EXECUTED) `printf NO` "quote" \'single\'\nline';
  put(path.join(f.root, 'package.json'), { name: malicious, version: '1.0.0' });
  const one = jsonOutput(run('init-run', ['--root', f.root, '--full']));
  const two = jsonOutput(run('init-run', ['--root', f.root, '--full']));
  assert.equal(one.app, malicious); assert.notEqual(one.out, two.out); assert.notEqual(one.run_id, two.run_id);
  assert.notEqual(run('init-run', ['--root', f.root, '--full', '--out', one.out], null).status, 0);
  assert.equal(jsonOutput(run('init-run', ['--root', f.root, '--full', '--resume', one.out])).run_id, one.run_id);
  git(f.root, 'checkout', '-b', 'feature/other');
  assert.notEqual(run('init-run', ['--root', f.root, '--full', '--resume', one.out], null).status, 0);
  const invalid = path.join(f.base, 'invalid');
  assert.notEqual(run('init-run', ['--root', f.root, '--base', 'origin/nonexistent', '--out', invalid], null).status, 0);
  assert.equal(fs.existsSync(path.join(invalid, 'run-meta.json')), false);
});

test('DA-04/07: malformed producer preserves last findings; absent, forged and stale stages fail closed', () => {
  const f = fixture(); put(path.join(f.pack, 'FINDINGS.json'), []); put(path.join(f.pack, 'deps-latest.json'), {});
  assert.notEqual(run('lint-findings', args(f, '--gate'), null).status, 0);
  baseline(f, [finding()]); const before = fs.readFileSync(path.join(f.pack, 'FINDINGS.json'));
  fs.writeFileSync(path.join(f.pack, 'agent-artemis.json'), '{');
  assert.notEqual(run('merge-findings', args(f), null).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.pack, 'FINDINGS.json')), before);
  assert.notEqual(run('lint-findings', args(f, '--audit-gate'), null).status, 0);
  baseline(f); run('lint-findings', args(f, '--audit-gate'));
  fs.writeFileSync(path.join(f.root, 'new.js'), 'new source');
  assert.notEqual(run('lint-findings', args(f, '--audit-gate'), null).status, 0);
});

test('DA-03: severity reorder/new candidate cannot inherit a different defect disposition', () => {
  const f = fixture(); baseline(f, [finding('old', 'LOW')]);
  const old = json(path.join(f.pack, 'FINDINGS.json'))[0];
  run('sync-progress', args(f, '--refute', old.id, '--evidence', 'old.js has an explicit guard'));
  baseline(f, [finding('new', 'CRITICAL')]);
  const list = json(path.join(f.pack, 'FINDINGS.json')), fresh = list.find(x => x.path === 'new.js');
  assert.notEqual(fresh.id, old.id); assert.equal(fresh.status, 'open'); assert.equal(fresh.refuted_by, undefined);
  assert.equal(new Set(list.map(f => f.id)).size, list.length);
  assert.notEqual(run('lint-findings', args(f, '--gate'), null).status, 0);
  baseline(f, [finding('new', 'HIGH'), finding('old', 'LOW')]);
  assert.equal(json(path.join(f.pack, 'FINDINGS.json')).find(x => x.path === 'new.js').id, fresh.id);
});

test('DA-02/12: valid zero-candidate deep scan passes; missing hunters, malformed or changed votes fail', () => {
  const f = fixture(['--only', 'security', '--depth', 'deep']);
  let s = snapshot(f); put(path.join(f.pack, 'sec-deep/candidates.json'), { candidates: [] });
  assert.notEqual(run('sec-verify', secArgs(f, s), null).status, 0);
  s = security(f); run('sec-verify', secArgs(f, s));
  assert.equal(json(path.join(f.pack, 'sec-deep/coverage.json')).verification_status, 'verified');
  complete(f, s, 'security', ['agent-cerbero.json', 'sec-deep/coverage.json']); deps(f, s); run('merge-findings', args(f)); run('lint-findings', args(f, '--gate'));
  const candidate = { temp_id: 'C1', ...finding('security'), lens: 'security' };
  s = security(f, [candidate]); secVotes(f, s, candidate, true);
  const previous = fs.readFileSync(path.join(f.pack, 'agent-cerbero.json'));
  assert.notEqual(run('sec-verify', secArgs(f, s), null).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.pack, 'agent-cerbero.json')), previous);
  assert.equal(json(path.join(f.pack, 'sec-deep/coverage.json')).pending_candidates.length, 1);
  assert.notEqual(run('lint-findings', args(f, '--gate'), null).status, 0);
  secVotes(f, s, candidate); run('sec-verify', secArgs(f, s)); complete(f, s, 'security', ['agent-cerbero.json', 'sec-deep/coverage.json']); run('merge-findings', args(f)); run('lint-findings', args(f, '--audit-gate'));
  const votePath = path.join(f.pack, 'sec-deep/votes/C1-IMPACT.json'); const v = json(votePath); v.reasoning += ' changed'; put(votePath, v);
  assert.notEqual(run('lint-findings', args(f, '--audit-gate'), null).status, 0);
});

test('DA-05/09/10: real fix/reversal, approval, remerge preserve review; missing votes invalidate done and gate', () => {
  const f = fixture(); assert.notEqual(spawnSync(process.execPath, ['regression.cjs'], { cwd: f.root }).status, 0);
  fs.writeFileSync(path.join(f.root, 'bug.cjs'), 'module.exports = 2;\n');
  baseline(f, [finding()]); const id = json(path.join(f.pack, 'FINDINGS.json'))[0].id;
  review(f, id, false); assert.notEqual(run('review-verify', args(f, '--id', id), null).status, 0);
  assert.notEqual(run('sync-progress', args(f, '--done', id, '--test', 'regression.cjs'), null).status, 0);
  const before = git(f.root, 'diff'); review(f, id); assert.equal(git(f.root, 'diff'), before); assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('worktree ').length - 1, 1);
  run('review-verify', args(f, '--id', id)); run('sync-progress', args(f, '--done', id, '--test', 'regression.cjs'));
  const completed = json(path.join(f.pack, 'FINDINGS.json'))[0]; run('merge-findings', args(f));
  assert.deepEqual(json(path.join(f.pack, 'FINDINGS.json'))[0].review, completed.review); run('lint-findings', args(f, '--gate'));
  fs.unlinkSync(path.join(f.pack, `reviews/votes/${id}-QUALITY.json`));
  assert.notEqual(run('lint-findings', args(f, '--gate'), null).status, 0);
  run('review-verify', args(f, '--id', id), 2); assert.equal(json(path.join(f.pack, `reviews/${id}.json`)).verdict, 'invalid');
  run('sync-progress', args(f, '--open', id)); assert.notEqual(run('sync-progress', args(f, '--done', id, '--test', 'regression.cjs'), null).status, 0);
  const summary = json(path.join(f.pack, 'reviews/summary.json')); assert.equal(summary.attempts, 3); assert.equal(summary.first_pass, 0);
});

test('DA-08/09 and reporting: concurrent writers are serialized/refused; progress and banner survive retries', async () => {
  const f = fixture(); baseline(f, [finding('one', 'LOW'), finding('two', 'LOW')]); fs.writeFileSync(path.join(f.pack, 'REPORT.md'), '# Report\n\nBody\n');
  const ids = json(path.join(f.pack, 'FINDINGS.json')).map(x => x.id);
  const spawnUpdate = id => new Promise(resolve => { const p = spawn(process.execPath, [path.join(scripts, 'sync-progress.mjs'), ...args(f, '--progress', id, '--note', `work ${id}`)]); let output = ''; p.stdout.on('data', d => output += d); p.stderr.on('data', d => output += d); p.on('exit', code => resolve({ id, code, output })); });
  const results = await Promise.all(ids.map(spawnUpdate));
  assert.ok(results.some(r => r.code === 0));
  for (const r of results) if (r.code !== 0) { assert.match(r.output, /pack ocupado/); run('sync-progress', args(f, '--progress', r.id, '--note', `work ${r.id}`)); }
  run('merge-findings', args(f)); assert.ok(json(path.join(f.pack, 'FINDINGS.json')).every(x => x.in_progress && x.progress.length));
  run('sync-progress', args(f)); run('sync-progress', args(f));
  const report = fs.readFileSync(path.join(f.pack, 'REPORT.md'), 'utf8'); assert.equal(report.match(/> \*\*Progresso:/g).length, 1); assert.match(report, /Body/);
  const release = acquireLock(f.pack); assert.notEqual(run('sync-progress', args(f), null).status, 0); release(); run('sync-progress', args(f));
});

test('complete full run with all 15 real producer artifacts, empty security and real no-dependency CLI', () => {
  const f = fixture([]), s = security(f);
  run('sec-verify', secArgs(f, s)); complete(f, s, 'security', ['agent-cerbero.json', 'sec-deep/coverage.json']);
  for (const stage of f.init.expected_stages.filter(x => !['deps', 'security', 'security_inventory', 'security_hunters'].includes(x))) {
    put(path.join(f.pack, `agent-${stage}.json`), []); complete(f, s, stage, [`agent-${stage}.json`]);
  }
  deps(f, s); run('merge-findings', args(f)); run('lint-findings', args(f, '--gate')); run('sync-progress', args(f));
  assert.match(fs.readFileSync(path.join(f.pack, 'report.html'), 'utf8'), /Evidências atuais verificadas pelo gate/);
  assert.ok(fs.statSync(path.join(f.pack, 'TASKS.md')).size > 0);
  put(path.join(f.pack, 'deps-latest.json'), {}); assert.notEqual(run('lint-findings', args(f, '--gate'), null).status, 0);
});

test('recovery: SIGKILL before/after FINDINGS rename preserves valid JSON and makes incomplete transaction retryable', async () => {
  const f = fixture(); baseline(f, [finding('original', 'LOW')]);
  for (const timing of ['before', 'after']) {
    const before = fs.readFileSync(path.join(f.pack, 'FINDINGS.json'));
    put(path.join(f.pack, 'agent-artemis.json'), [finding(timing, 'LOW')]);
    const hook = path.join(f.base, `interrupt-${timing}.mjs`);
    fs.writeFileSync(hook, `import fs from 'node:fs'; const original = fs.renameSync; fs.renameSync = function(a,b) { if (String(b).endsWith('/FINDINGS.json')) { ${timing === 'after' ? 'original(a,b);' : ''} process.stdout.write('AT_WRITE\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); } return original(a,b); };`);
    const child = spawn(process.execPath, ['--import', hook, path.join(scripts, 'merge-findings.mjs'), ...args(f)]);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('interruption hook not reached')); }, 10000);
      child.stderr.on('data', () => {});
      child.stdout.on('data', d => { if (String(d).includes('AT_WRITE')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
    });
    child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
    const actual = fs.readFileSync(path.join(f.pack, 'FINDINGS.json')); assert.ok(Array.isArray(JSON.parse(actual)));
    if (timing === 'before') assert.deepEqual(actual, before);
    assert.notEqual(run('sync-progress', args(f), null).status, 0);
    run('run-state', ['recover-lock', ...args(f)]);
    assert.notEqual(run('lint-findings', args(f, '--audit-gate'), null).status, 0);
    const s = snapshot(f); complete(f, s, 'classic_bugs', ['agent-artemis.json']);
    run('merge-findings', args(f)); run('lint-findings', args(f, '--audit-gate'));
  }
});

test('old source/proof and false-green never approve; review retries are idempotent and preserve all IDs', () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, 'bug.cjs'), 'module.exports = 2;\n');
  baseline(f, [finding('one', 'LOW'), finding('two', 'LOW')]); const ids = json(path.join(f.pack, 'FINDINGS.json')).map(x => x.id);
  for (const id of ids) { review(f, id); run('review-verify', args(f, '--id', id)); }
  run('review-verify', args(f, '--id', ids[0]));
  const summary = json(path.join(f.pack, 'reviews/summary.json')); assert.equal(summary.reviewed, 2); assert.equal(summary.attempts, 2); assert.equal(summary.first_pass, 2);
  run('sync-progress', args(f, '--done', ids.join(','), '--test', 'regression.cjs'));
  const closed = json(path.join(f.pack, 'FINDINGS.json')); run('sync-progress', args(f, '--done', ids.join(','), '--test', 'regression.cjs'));
  assert.deepEqual(json(path.join(f.pack, 'FINDINGS.json')), closed);
  run('lint-findings', args(f, '--gate'));
  fs.writeFileSync(path.join(f.root, 'bug.cjs'), 'module.exports = 3;\n');
  assert.notEqual(run('lint-findings', args(f, '--gate'), null).status, 0);
  assert.notEqual(run('sync-progress', args(f, '--done', ids[0], '--test', 'regression.cjs'), null).status, 0);
  fs.writeFileSync(path.join(f.root, 'bug.cjs'), 'module.exports = 2;\n');
  const context = jsonOutput(run('run-state', ['review-start', ...args(f, '--id', ids[0])]));
  const before = git(f.root, 'diff');
  assert.notEqual(run('reversal-proof', args(f, '--id', ids[0], '--base', f.init.head, '--fix-paths', 'bug.cjs', '--test-cmd', 'node -e "process.exit(0)"'), null).status, 0);
  assert.equal(fs.existsSync(path.join(f.pack, 'reviews/rounds', ids[0], context.round_id, 'proof.json')), false);
  assert.equal(git(f.root, 'diff'), before); assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('worktree ').length - 1, 1);
});

test('legacy reports stay readable but cannot acquire schema 2 trust; migration creates a distinct run', () => {
  const f = fixture(); const original = { app: 'legacy', version: '1', branch: 'main' };
  put(path.join(f.pack, 'run-meta.json'), original); put(path.join(f.pack, 'FINDINGS.json'), []);
  run('build-report', ['--findings', path.join(f.pack, 'FINDINGS.json'), '--out', path.join(f.pack, 'report.html')]);
  assert.match(fs.readFileSync(path.join(f.pack, 'report.html'), 'utf8'), /PENDENTE/);
  assert.notEqual(run('lint-findings', args(f, '--gate'), null).status, 0);
  const migrated = jsonOutput(run('init-run', ['--root', f.root, '--full', '--legacy', f.pack]));
  assert.notEqual(migrated.out, f.pack); assert.equal(migrated.legacy_source, f.pack); assert.deepEqual(json(path.join(f.pack, 'run-meta.json')), original);
  assert.deepEqual(migrated.stages, {});
});

test('resume preserves full without a default branch/base; changed HEAD and incompatible flags require a new run', () => {
  const f = fixture(); git(f.root, 'branch', '-m', 'feature/no-default');
  const out = path.join(f.base, 'feature-pack');
  const started = jsonOutput(run('init-run', ['--root', f.root, '--full', '--out', out]));
  assert.equal(started.base, null);
  assert.equal(jsonOutput(run('init-run', ['--root', f.root, '--resume', out])).run_id, started.run_id);
  assert.notEqual(run('init-run', ['--root', f.root, '--resume', out, '--depth', 'fast'], null).status, 0);
  fs.writeFileSync(path.join(f.root, 'bug.cjs'), 'module.exports = 2;\n'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'later commit');
  assert.notEqual(run('run-state', ['snapshot', '--dir', out], null).status, 0);
  assert.notEqual(run('init-run', ['--root', f.root, '--resume', out], null).status, 0);
  const noGit = path.join(f.base, 'no-git'); fs.mkdirSync(noGit); put(path.join(noGit, 'package.json'), { name: 'plain', version: '1.0.0' });
  const plain = jsonOutput(run('init-run', ['--root', noGit, '--full', '--no-git']));
  assert.equal(jsonOutput(run('init-run', ['--root', noGit, '--resume', plain.out])).run_id, plain.run_id);
});

test('security coverage requires every planned hunter; explicit no attack surface permits genuine zero', () => {
  const f = fixture(['--only', 'security', '--depth', 'deep']); let s = security(f);
  const inventory = json(path.join(f.pack, 'sec-deep/inventory.json'));
  inventory.required_hunters.push({ component: 'app', lens: 'injection' }); put(path.join(f.pack, 'sec-deep/inventory.json'), inventory);
  complete(f, s, 'security_inventory', ['sec-deep/inventory.json']);
  assert.notEqual(run('run-state', ['complete', ...args(f, '--stage', 'security_hunters', '--snapshot', s.snapshot_id, '--artifacts', 'sec-deep/hunter-app.json,sec-deep/candidates.json')], null).status, 0);
  assert.notEqual(run('sec-verify', secArgs(f, s), null).status, 0);
  put(path.join(f.pack, 'sec-deep/inventory.json'), { status: 'complete', scope_note: 'Read all fixture sources', components: [], required_hunters: [], no_attack_surface: true, reason: 'Pure constant fixture; no externally controlled inputs' });
  fs.unlinkSync(path.join(f.pack, 'sec-deep/hunter-app.json'));
  complete(f, s, 'security_inventory', ['sec-deep/inventory.json']); complete(f, s, 'security_hunters', ['sec-deep/candidates.json']);
  run('sec-verify', secArgs(f, s)); complete(f, s, 'security', ['agent-cerbero.json', 'sec-deep/coverage.json']); deps(f, s); run('merge-findings', args(f)); run('lint-findings', args(f, '--gate'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactText, redactValue, redactPack, REDACTED_ROOT } from '../redact.mjs';
import { closeRun } from '../run-meta.mjs';
import { validSeal } from '../state-io.mjs';
import { loadPack } from '../report/load-pack.mjs';
import { renderReport } from '../report/render.mjs';
import { completePack } from './helpers/complete-pack.mjs';

const HOME = os.homedir();

test('redactText: repo path becomes repo-relative', () => {
  const repo = '/Users/dev/Developer/app';
  assert.equal(redactText(`${repo}/docs/SDD/x.md`, { repoRoot: repo }), 'docs/SDD/x.md');
  assert.equal(redactText(repo, { repoRoot: repo }), REDACTED_ROOT);
});

test('redactText: home becomes ~ and repo wins over home (longest first)', () => {
  const repo = `${HOME}/Developer/app`;
  assert.equal(redactText(`${HOME}/Developer/app/src/a.go`, { repoRoot: repo }), 'src/a.go');
  assert.equal(redactText(`${HOME}/other/secret`, { repoRoot: repo }), '~/other/secret');
  assert.equal(redactText(`${HOME}/Developer/app`, { repoRoot: repo }), REDACTED_ROOT);
});

test('redactText: non-strings and untouched values pass through', () => {
  assert.equal(redactText(null), null);
  assert.equal(redactText(42), 42);
  assert.equal(redactText('docs/a.md', { repoRoot: '/nowhere' }), 'docs/a.md');
});

test('redactValue: deep walk over objects and arrays', () => {
  const repo = '/Users/dev/app';
  const doc = {
    cmd: `${repo}/bin/tool --path ${repo}/tmp`,
    nested: [{ file: `${HOME}/notes.txt`, ok: true }],
    n: 3,
  };
  const out = redactValue(doc, { repoRoot: repo });
  assert.equal(out.cmd, 'bin/tool --path tmp');
  assert.equal(out.nested[0].file, '~/notes.txt');
  assert.equal(out.nested[0].ok, true);
});

function leakFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-redact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Fake repo root distinct from the pack dir, with a spec file inside it.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-redact-repo-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'sdd.md'), '# Fixture SDD\n');
  const write = (file, data) => {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(data));
  };
  write('run-meta.json', {
    run_id: 'redact-run',
    app: 'fixture',
    branch: 'feature/redact',
    kind: 'feature',
    status: 'in_progress',
    repo_root: repo,
    spec: path.join(repo, 'docs', 'sdd.md'),
    spec_status: 'confirmed',
    coverage_floor: 90,
    test_cmd: `node ${repo}/node_modules/.bin/test`,
    steps: {},
  });
  write('TASKS.json', {
    kind: 'feature',
    spec: path.join(repo, 'docs', 'sdd.md'),
    tasks: [
      {
        id: 'T-1',
        title: 'fixture',
        status: 'DONE',
        tests_added: 1,
        red_green: true,
        validation: 'red-green',
        red: { command: `node ${repo}/node_modules/.bin/test -- cap`, output_excerpt: `expected 400 at ${repo}/src/cap.js:12` },
        green: { command: `node ${repo}/node_modules/.bin/test -- cap`, output_excerpt: '1 passed' },
        tests: ['rejects above cap'],
        files: ['src/cap.js'],
      },
    ],
  });
  write('results/T-1-1.json', {
    id: 'T-1',
    patch: {
      status: 'DONE',
      tests_added: 1,
      red_green: true,
      red: { command: `node ${repo}/node_modules/.bin/test -- cap`, output_excerpt: `expected 400 at ${repo}/src/cap.js:12` },
      green: { command: `node ${repo}/node_modules/.bin/test -- cap`, output_excerpt: '1 passed' },
      tests: ['rejects above cap'],
      files: ['src/cap.js'],
    },
  });
  write('progress/T-1.json', { id: 'T-1', note: `rodando em ${HOME}/Developer`, at: '2026-10-31T00:00:00Z' });
  write('worktrees.json', { skipped: true, reason: 'repo sem Git' });
  write('tests.json', { cmd: `node ${repo}/node_modules/.bin/test`, ok: true, failed: 0 });
  write('coverage.json', { pct: 95, floor: 90, tool: 'fixture' });
  write('immutability.json', { green: true, tests: ['contract'], command: `node ${repo}/node_modules/.bin/test contract` });
  write('payloads.json', []);
  write('hooks/arch-map.json', { source: 'manual', style: null, notes: `manual em ${repo}` });
  write('hooks/ui-scope.json', { ui_touched: false });
  write('hooks/security.json', { hook: 'security', verdict: 'APPROVE', findings: [] });
  write('project-gates.json', { gates: [{ name: 'lint', status: 'DONE', evidence: `roda em ${repo}/ci` }], reason: '' });
  write('tracking.json', { files: [], reason: 'fixture' });
  for (const axis of ['standards', 'spec', 'correctness'])
    write(`reviews/${axis}.json`, {
      axis,
      verdict: 'APPROVE',
      findings: [{ id: `${axis[0]}-1`, severity: 'info', title: 'ok', description: `visto em ${HOME}/tmp`, file: `${repo}/src/cap.js`, status: 'fixed', fixed_in_round: 1, round: 1 }],
      rounds: [],
    });
  return { dir, repo, write };
}

test('redactPack: rewrites leaks across the pack and marks repo_root', (t) => {
  const { dir, repo } = leakFixture(t);
  const rewritten = redactPack(dir, { repoRoot: repo });
  assert.ok(rewritten.length > 0);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'run-meta.json'), 'utf8'));
  assert.equal(meta.repo_root, REDACTED_ROOT);
  assert.equal(meta.repo_root_name, path.basename(repo));
  assert.equal(meta.spec, 'docs/sdd.md');
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'results/T-1-1.json'), 'utf8'));
  assert.match(result.patch.red.command, /^node node_modules/);
  const progress = JSON.parse(fs.readFileSync(path.join(dir, 'progress/T-1.json'), 'utf8'));
  assert.ok(!progress.note.includes(HOME));
});

test('closeRun: sealed pack and HTML expose no machine paths', (t) => {
  const { dir, repo } = leakFixture(t);
  completePack(dir); // carimba a evidência exigida pelo close
  const result = closeRun(dir);
  assert.equal(result.closable, true);
  // Seal integrity: hash computed over the redacted state still validates.
  assert.ok(validSeal(dir));
  // No artifact under the pack carries the machine repo root or the user home.
  const leaks = [];
  const visit = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) visit(full);
      else if (/\.(json|md|mmd|html)$/.test(e.name)) {
        const raw = fs.readFileSync(full, 'utf8');
        if (raw.includes(repo)) leaks.push(path.relative(dir, full) + ' (repo)');
        if (raw.includes(HOME)) leaks.push(path.relative(dir, full) + ' (home)');
      }
    }
  };
  visit(dir);
  assert.deepEqual(leaks, []);
  // Score evidence carried into closure.json is redacted too.
  const closure = JSON.parse(fs.readFileSync(path.join(dir, 'closure.json'), 'utf8'));
  assert.ok(!JSON.stringify(closure).includes(repo));
  assert.ok(!JSON.stringify(closure).includes(HOME));
  // The regenerated HTML renders and stays clean.
  const html = renderReport(loadPack(dir));
  assert.ok(!html.includes(repo));
  assert.ok(!html.includes(HOME));
});

test('loadPack: render-time redaction covers open (unclosed) packs', (t) => {
  const { dir, repo } = leakFixture(t);
  const html = renderReport(loadPack(dir));
  assert.ok(!html.includes(repo), 'HTML must not leak the repo root');
  assert.ok(!html.includes(HOME), 'HTML must not leak the user home');
  assert.ok(html.includes('node_modules'), 'commands remain readable after redaction');
});

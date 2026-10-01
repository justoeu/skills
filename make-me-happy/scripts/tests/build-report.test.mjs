import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReport } from '../build-report.mjs';
import { loadPack, normalizePayloads, coverageBreakdown } from '../report/load-pack.mjs';
import { renderMarkdown } from '../report/markdown.mjs';
import { recordStep } from '../run-meta.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'build-report.mjs');
const NOW = new Date('2026-10-01T12:00:00Z');
const PANELS = ['overview', 'sdd', 'impl', 'fluxo', 'payloads', 'testes', 'review', 'score', 'gates'];

function makePack(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-report-'));
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

function build(dir) {
  return buildReport(dir, { out: path.join(dir, 'out', 'report.html'), now: NOW });
}

/** Text of one tab panel, so assertions are scoped to the section they test. */
function panel(html, id) {
  const start = html.indexOf(`id="panel-${id}"`);
  assert.notEqual(start, -1, `panel ${id} missing`);
  const end = html.indexOf('role="tabpanel"', start + 20);
  return html.slice(start, end === -1 ? html.indexOf('</main>') : end);
}

const FULL = {
  'run-meta.json': {
    app: 'Demo', branch: 'feat/demo', into: 'feature/demo', head: 'abc1234', kind: 'feature', loop: 'full',
    worktree_n: 2, spec: 'docs/spec.md', spec_status: 'confirmed', coverage_floor: 90, status: 'closed',
    test_cmd: 'npm test', started_at: '2026-10-01T08:00:00Z', finished_at: '2026-10-01T10:30:00Z',
    steps: {
      explore: { status: 'skipped', started_at: '2026-10-01T08:00:00Z', finished_at: '2026-10-01T08:00:00Z' },
      planner: { status: 'done', started_at: '2026-10-01T08:00:00Z', finished_at: '2026-10-01T08:20:00Z', note: '2 tasks' },
      worktrees: { status: 'done', started_at: '2026-10-01T08:20:00Z', finished_at: '2026-10-01T08:22:00Z' },
      implement: { status: 'done', started_at: '2026-10-01T08:22:00Z', finished_at: '2026-10-01T09:40:00Z' },
      immutability: { status: 'done', started_at: '2026-10-01T09:40:00Z', finished_at: '2026-10-01T09:50:00Z' },
      review: { status: 'done', started_at: '2026-10-01T09:50:00Z', finished_at: '2026-10-01T10:20:00Z' },
      score: { status: 'done', started_at: '2026-10-01T10:20:00Z', finished_at: '2026-10-01T10:21:00Z' },
      clean: { status: 'done', started_at: '2026-10-01T10:21:00Z', finished_at: '2026-10-01T10:22:00Z' },
      'project-gates': { status: 'in_progress', started_at: '2026-10-01T10:22:00Z' },
    },
  },
  'spec-summary.md': '# Demo spec\n\nGoal: cap ids.\n\n## Contracts\n\n| route | limit |\n|---|---|\n| `POST /x` | 200 |\n\n```json\n{"ids": [1]}\n```\n',
  'TASKS.json': {
    kind: 'feature',
    spec: 'docs/spec.md',
    tasks: [
      {
        id: 'T-001', title: 'Cap ids at 200', slice: 'jobs', worktree: 1, status: 'DONE', depends_on: [], refs: ['RF-01'],
        tests_added: 2, red_green: true, immutability: true,
        red: { test: 'TestCapRejects201', file: 'jobs_test.go', command: 'go test -run TestCap', output_excerpt: 'expected 400, got 200', at: '2026-10-01T08:30:00Z' },
        green: { command: 'go test -run TestCap', output_excerpt: 'ok jobs 0.41s', at: '2026-10-01T08:40:00Z' },
        reversal: { done: true, output_excerpt: 'reverted → FAIL expected 400' },
        tests: ['TestCapRejects201', 'TestCapAccepts200'],
        files: ['jobs.go', 'jobs_test.go'],
        commits: [{ sha: 'deadbeef01', message: 'fix(jobs): cap ids' }],
      },
      {
        id: 'T-002', title: 'Document the cap', slice: 'docs', worktree: 2, status: 'DONE', depends_on: ['T-001'], refs: [],
        tests_added: 1, red_green: true, immutability: false,
        red: { test: 'TestDocMentionsCap', output_excerpt: 'doc lacks "200"' },
        green: { output_excerpt: 'ok' },
        reversal: { done: false, note: 'pure addition' },
        tests: ['TestDocMentionsCap'], files: ['docs/api.md'], commits: [{ sha: 'cafebabe02', message: 'docs: cap' }],
      },
    ],
  },
  'flow.mmd': 'flowchart LR\n  A["client"] --> B["POST /x"]\n',
  'diagrams/T-001.mmd': 'sequenceDiagram\n  C->>S: POST /x\n',
  'payloads.json': [
    {
      name: 'over the cap', kind: 'http', method: 'POST', path: '/api/x', request: { ids: [1, 2] },
      responses: [{ status: 400, body: { error: 'validacao' } }, { status: 200, body: { deleted: 2 } }],
      notes: ['no DELETE'], tasks: ['T-001'],
    },
  ],
  'worktrees.json': { into: 'feature/demo', slices: [{ index: 1, branch: 'mmh/slice-1', merged: true, removed: true }, { index: 2, branch: 'mmh/slice-2', merged: true, removed: true }] },
  'immutability.json': {
    green: true, command: 'go test -run Contract',
    tests: [{ name: 'ContractShape#list', task: 'T-001', file: 'c_test.go', kind: 'golden', green: true }],
    tasks_covered: ['T-001'],
  },
  'tests.json': { cmd: 'npm test', ok: true, total: 120, passed: 118, failed: 0, skipped: 2, duration_s: 41.5, suites: [{ name: 'backend', passed: 80, failed: 0 }, { name: 'web', passed: 38, failed: 0 }], log: 'all green' },
  'coverage.json': { pct: 93.5, floor: 90, tool: 'c8', report: 'coverage/index.html', scope: 'diff', modules: [{ name: 'internal/jobs', pct: 97.1, covered: 34, total: 35 }, { name: 'web/src', pct: 88.2, covered: 15, total: 17 }] },
  'reviews/standards.md': '# Standards\n\nok\n\nVERDICT: APPROVE\n',
  'reviews/standards.json': { axis: 'standards', verdict: 'APPROVE', round: 1, summary: 'clean', findings: [], rounds: [{ round: 1, verdict: 'APPROVE', findings: [] }] },
  'reviews/spec.md': 'VERDICT: APPROVE\n',
  'reviews/spec.json': { axis: 'spec', verdict: 'APPROVE', round: 1, findings: [] },
  'reviews/correctness.md': '# Correctness\n\nround 2\n\nVERDICT: APPROVE\n',
  'reviews/correctness.json': {
    axis: 'correctness', verdict: 'APPROVE', round: 2, summary: 'fixed after round 1',
    findings: [{ id: 'C-1', severity: 'high', title: 'T-002 had no red test', file: 'docs_test.go', line: 12, status: 'fixed', round: 1, fixed_in_round: 2, fix: 'commit cafebabe02' }],
    rounds: [
      { round: 1, verdict: 'REJECT', at: '2026-10-01T10:00:00Z', findings: [{ id: 'C-1', severity: 'high', title: 'T-002 had no red test', status: 'open' }] },
      { round: 2, verdict: 'APPROVE', at: '2026-10-01T10:15:00Z', findings: [] },
    ],
  },
  'project-gates.json': { gates: [
    { name: 'security-review', source: 'CLAUDE.md §2', status: 'DONE', evidence: 'reviews/repo-security.md' },
    { name: 'docs i18n sweep', source: 'AGENTS.md', status: 'OPEN', evidence: 'not run' },
  ] },
};

test('empty pack: every section renders with an explicit empty state', () => {
  const dir = makePack({});
  const { html, warnings } = build(dir);
  for (const id of PANELS) assert.match(html, new RegExp(`id="panel-${id}"`));
  assert.match(panel(html, 'impl'), /não registrado pelo pack[\s\S]*TASKS\.json[\s\S]*planner/);
  assert.match(panel(html, 'fluxo'), /flow\.mmd/);
  assert.match(panel(html, 'payloads'), /payloads\.json/);
  assert.match(panel(html, 'testes'), /tests\.json/);
  assert.match(panel(html, 'testes'), /coverage\.json/);
  assert.match(panel(html, 'testes'), /immutability\.json/);
  assert.match(panel(html, 'review'), /reviews\/standards\.json/);
  assert.match(panel(html, 'review'), /reviews\/correctness\.json/);
  assert.match(panel(html, 'score'), /score\.json/);
  assert.match(panel(html, 'gates'), /project-gates\.json/);
  assert.match(panel(html, 'sdd'), /spec-summary\.md/);
  assert.ok(warnings.some((w) => w.file === 'run-meta.json'));
});

test('partial pack: tasks and flow render, missing review/tests show empty states', () => {
  const dir = makePack({
    'run-meta.json': { app: 'Half', branch: 'feat/h', kind: 'feature', status: 'in_progress', next_step: 'review' },
    'TASKS.json': { tasks: [{ id: 'T-001', title: 'Only task', worktree: 1, status: 'IN_PROGRESS', tests_added: 0 }] },
    'flow.mmd': 'flowchart LR\n  A --> B\n',
  });
  const { html } = build(dir);
  assert.match(panel(html, 'impl'), /Only task/);
  assert.match(panel(html, 'impl'), /data-status="IN_PROGRESS"/);
  assert.match(panel(html, 'fluxo'), /data-mermaid=/);
  assert.match(panel(html, 'fluxo'), /A --&gt; B/);
  assert.match(panel(html, 'review'), /não registrado pelo pack/);
  assert.match(panel(html, 'testes'), /não registrado pelo pack[\s\S]*tests\.json/);
  assert.match(panel(html, 'overview'), /Próximo passo registrado: review/);
  assert.match(panel(html, 'overview'), /class="step [^"]*current/);
});

test('full canonical pack: every section uses the data, zero schema warnings', () => {
  const dir = makePack(FULL);
  const { html, warnings } = build(dir);
  assert.deepEqual(warnings, []);

  const head = html.slice(0, html.indexOf('role="tablist"'));
  assert.match(head, /feat\/demo[\s\S]*feature\/demo/);
  assert.match(head, /<strong>10<\/strong>\/10/);
  assert.match(head, /93\.5%/);
  assert.match(head, /2 h 30 min/);

  const ov = panel(html, 'overview');
  assert.match(ov, /2<span class="of">\/2<\/span>/);
  assert.match(ov, /Testes adicionados[\s\S]*>3</);
  assert.match(ov, /2 tasks/);
  assert.match(ov, /2026-10-01 08:00 UTC/);
  assert.match(ov, /Gate do projeto OPEN: docs i18n sweep/);

  const sdd = panel(html, 'sdd');
  assert.match(sdd, /<h1 id="sdd-summary-demo-spec">/);
  assert.match(sdd, /<table>/);
  assert.match(sdd, /href="#sdd-summary-contracts"/);
  assert.match(sdd, /confirmed/);

  const impl = panel(html, 'impl');
  assert.match(impl, /id="task-q"/);
  assert.match(impl, /expected 400, got 200/);
  assert.match(impl, /REVERSÃO/);
  assert.match(impl, /deadbeef01/);
  assert.match(impl, /Worktree 1[\s\S]*mmh\/slice-1/);

  const fl = panel(html, 'fluxo');
  assert.equal((fl.match(/data-mermaid=/g) || []).length, 2);
  assert.match(fl, /sequenceDiagram/);

  const pl = panel(html, 'payloads');
  assert.match(pl, /class="method m-post">POST/);
  assert.match(pl, /\/api\/x/);
  assert.match(pl, /chip ok">200</);
  assert.match(pl, /chip bad">400</);
  assert.match(pl, /<span class="j-key">&quot;ids&quot;<\/span>/);
  assert.match(pl, /data-copy=/);

  const ts = panel(html, 'testes');
  assert.match(ts, /PASS/);
  assert.match(ts, />118</);
  assert.match(ts, /internal\/jobs/);
  assert.match(ts, /class="bar-floor"/);
  assert.match(ts, /class="gauge ok"/);
  assert.match(ts, /TestCapRejects201/);
  assert.match(ts, /ContractShape#list/);

  const rv = panel(html, 'review');
  assert.match(rv, /T-002 had no red test/);
  assert.match(rv, /docs_test\.go:12/);
  assert.match(rv, /R1<\/span> <span class="chip bad">REJECT/);
  assert.match(rv, /R2<\/span> <span class="chip ok">APPROVE/);
  assert.match(rv, /chip ok">fixed/);

  const sc = panel(html, 'score');
  assert.equal((sc.match(/class="card gate ok"/g) || []).length, 5);
  assert.match(sc, /Fecha: score 10/);
  assert.match(sc, /aria-label="Score: 10 de 10"/);

  const gt = panel(html, 'gates');
  assert.match(gt, /1\/2 DONE/);
  assert.match(gt, /chip bad">OPEN/);
});

test('legacy pack shapes are adapted with warnings instead of rendering empty', () => {
  const longSuite = Array.from({ length: 40 }, (_, i) => `LegacyContractTest${i}`);
  const dir = makePack({
    'run-meta.json': { app: 'Old', branch: 'b', kind: 'refactor', status: 'closed' },
    'TASKS.json': { tasks: [{ id: 'T-001', title: 'old', status: 'DONE', tests_added: 1, red_green: true, worktree: 1, red_test: 'TestOld', findings: ['SEC-1'] }] },
    'payloads.json': { schedule_update_payload: { mode: 'interval' }, checks: ['compose keeps network'] },
    'immutability.json': { green: true, suite: longSuite },
    'reviews/standards.md': '# S\n\n## Hard\n\n1. thing\n\nVERDICT: APPROVE\n',
    'reviews/repo-security.md': '# Security\n\nOverall: PASS\n',
    'score.json': { score: 10, max: 10, closable: true, coverage: { pct: 95, floor: 90, ok: true }, gates: [{ id: 'immutability', ok: true, detail: longSuite.join(', ') }] },
  });
  const { html, warnings } = build(dir);
  assert.ok(warnings.some((w) => w.file === 'payloads.json'));
  assert.ok(warnings.some((w) => w.file === 'reviews/standards.json'));
  const pl = panel(html, 'payloads');
  assert.match(pl, /schedule_update_payload/);
  assert.match(pl, /compose keeps network/);
  const sc = panel(html, 'score');
  assert.match(sc, /40 item\(ns\)/);
  assert.match(sc, /mostrar todos os 40/);
  assert.doesNotMatch(sc, /LegacyContractTest0, LegacyContractTest1/);
  assert.match(panel(html, 'testes'), /mostrar todos os 40 testes de imutabilidade/);
  assert.match(panel(html, 'review'), /Review completo \(markdown\)/);
  assert.match(panel(html, 'gates'), /Security[\s\S]*DONE/);
  assert.match(panel(html, 'impl'), /TestOld/);
});

test('malformed JSON warns and never crashes', () => {
  const dir = makePack({ 'TASKS.json': '{not json', 'coverage.json': '[1,' });
  const { html, warnings } = build(dir);
  assert.ok(warnings.some((w) => w.file === 'TASKS.json' && /JSON inválido/.test(w.msg)));
  assert.ok(warnings.some((w) => w.file === 'coverage.json'));
  assert.match(panel(html, 'impl'), /não registrado pelo pack/);
});

test('pack content is escaped (no script injection, no javascript: links)', () => {
  const dir = makePack({
    'run-meta.json': { app: '<img src=x onerror=alert(1)>', branch: 'b', kind: 'k', status: 'closed' },
    'TASKS.json': { tasks: [{ id: 'T-1', title: '<script>alert(1)</script>', status: 'OPEN' }] },
    'spec-summary.md': '[x](javascript:alert(1)) <b>raw</b>',
    'flow.mmd': 'flowchart LR\n A["</code><script>alert(2)</script>"]\n',
  });
  const { html } = build(dir);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('mermaid has an offline fallback and tabs are keyboard accessible', () => {
  const { html } = build(makePack(FULL));
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/mermaid@11/);
  assert.match(html, /offline\?/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-controls="panel-score"/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.doesNotMatch(html, /<link[^>]+stylesheet/);
});

test('CLI writes --out and prints warnings on stderr', () => {
  const dir = makePack({ 'TASKS.json': { tasks: [{ id: 'T-1', title: 'a', status: 'DONE' }] } });
  const out = path.join(dir, 'elsewhere', 'r.html');
  const r = spawnSync(process.execPath, [CLI, '--dir', dir, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), out);
  assert.ok(fs.existsSync(out));
  assert.match(r.stderr, /WARN TASKS\.json: T-1: DONE sem evidência RED/);
  assert.equal(fs.existsSync(path.join(dir, 'report.html')), false);
});

test('normalizePayloads maps legacy dict/response_NNN shapes', () => {
  const r = normalizePayloads({
    payloads: [{ contract: 'POST /api/auth/tokens', request: { name: 'x' }, response_201: { id: 7 }, response_409_too_many: { error: 'x' } }],
    error_envelope: { shape: '{}' },
  });
  assert.equal(r.items[0].method, 'POST');
  assert.equal(r.items[0].path, '/api/auth/tokens');
  assert.deepEqual(r.items[0].responses.map((x) => x.status), [201, 409]);
  assert.equal(r.context[0].key, 'error_envelope');
  assert.equal(r.canonical, false);
});

test('coverageBreakdown reads modules, fractions and nested pct fields', () => {
  const rows = coverageBreakdown({
    pct: 90, statements: '18/20', go: { covered: 9, total: 10 },
    frontend: { statements_pct: 91.2 }, backend: { notable: { 'internal/a': 99 } },
  });
  const by = Object.fromEntries(rows.map((r) => [r.name, r.pct]));
  assert.equal(by.statements, 90);
  assert.equal(by.go, 90);
  assert.equal(by['frontend · statements'], 91.2);
  assert.equal(by['internal/a'], 99);
});

test('markdown renderer: headings get ids, tables and code are rendered', () => {
  const { html, toc } = renderMarkdown('# Título Á\n\n| a | b |\n|---|---|\n| `x|y` | 2 |\n\n```js\nconst a = 1 < 2;\n```\n- [x] feito\n');
  assert.equal(toc[0].id, 'titulo-a');
  assert.match(html, /<td><code>x\|y<\/code><\/td>/);
  assert.match(html, /const a = 1 &lt; 2;/);
  assert.match(html, /class="check on"/);
});

test('run-meta step records timestamps that the timeline reads', () => {
  const dir = makePack({ 'run-meta.json': { app: 'a', branch: 'b', kind: 'feature', status: 'in_progress' } });
  recordStep(dir, 'planner', 'in_progress', { now: new Date('2026-10-01T08:00:00Z') });
  recordStep(dir, 'planner', 'done', { now: new Date('2026-10-01T08:15:00Z'), note: '3 tasks' });
  assert.throws(() => recordStep(dir, 'bogus', 'done'), /unknown step/);
  assert.throws(() => recordStep(dir, 'planner', 'maybe'), /unknown status/);
  const pack = loadPack(dir, { now: NOW });
  const planner = pack.steps.find((s) => s.id === 'planner');
  assert.equal(planner.status, 'done');
  assert.equal(planner.inferred, false);
  assert.equal(planner.started_at, '2026-10-01T08:00:00.000Z');
  assert.equal(planner.finished_at, '2026-10-01T08:15:00.000Z');
  assert.equal(planner.note, '3 tasks');
  assert.equal(pack.steps.find((s) => s.id === 'review').inferred, true);
});

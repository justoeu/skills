import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  isRange,
  stateFor,
  parseManifestDeps,
  buildDiffFacts,
  buildArchMapFromAtlas,
  runDepsFreshness,
  aggregateVerdict,
  HOOK_IDS,
} from '../hooks.mjs';
import { buildReport } from '../build-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'hooks.mjs');
const NOW = new Date('2026-10-01T12:00:00Z');

function makePack(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-hooks-'));
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

test('compareVersions / isRange / stateFor classificam dependência contra a última ativa', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.ok(isRange('^1.2.0'));
  assert.ok(isRange('~2.3'));
  assert.ok(isRange('*'));
  assert.ok(!isRange('7.1.0'));
  assert.equal(stateFor('7.1.0', '7.1.0', false), 'ok');
  assert.equal(stateFor('7.0.5', '7.1.0', false), 'minor-behind');
  assert.equal(stateFor('5.28.4', '7.1.0', false), 'major-behind');
  assert.equal(stateFor('5.28.4', '7.1.0', true), 'deprecated');
  assert.equal(stateFor('^5.0.0', '7.1.0', false), 'range-behind');
  assert.equal(stateFor('^7.0.0', '7.1.0', false), 'range');
});

test('parseManifestDeps lê npm, go, pypi, maven e Cargo', () => {
  const npm = parseManifestDeps(JSON.stringify({ dependencies: { express: '4.18.0' }, devDependencies: { jest: '29.0.0' } }), 'npm');
  assert.deepEqual(npm, [
    { name: 'express', version: '4.18.0', dev: false },
    { name: 'jest', version: '29.0.0', dev: true },
  ]);
  const go = parseManifestDeps('require (\n\tgithub.com/go-chi/chi/v5 v5.0.10\n\tgolang.org/x/text v0.14.0 // indirect\n)\n', 'go');
  assert.equal(go.length, 1);
  assert.equal(go[0].name, 'github.com/go-chi/chi/v5');
  const py = parseManifestDeps('[project]\ndependencies = [\n  "flask==3.0.0",\n  "httpx>=0.27",\n]\n', 'pypi');
  assert.deepEqual(py.map((d) => d.name).sort(), ['flask', 'httpx']);
  const mvn = parseManifestDeps('<dependencies><dependency><groupId>io.javalin</groupId><artifactId>javalin</artifactId><version>6.1.0</version></dependency></dependencies>', 'maven');
  assert.deepEqual(mvn, [{ name: 'io.javalin:javalin', version: '6.1.0', dev: false }]);
  const cargo = parseManifestDeps('[dependencies]\nserde = "1.0"\ntokio = { version = "1.38", features = ["full"] }\n', 'crates');
  assert.deepEqual(cargo.map((d) => d.name).sort(), ['serde', 'tokio']);
});

test('buildDiffFacts detecta deps novas, migrações, rotas e suspeitos (git injetável)', () => {
  const diff = [
    'M\tpackage.json',
    'A\tinternal/pack/zip.go',
    'A\troutes.go',
    'A\tdb/migrations/0001.sql',
  ].join('\n');
  const fakeGit = (repo, args) => {
    if (args[0] === 'diff' && args[1] === '--name-status') return { status: 0, out: diff, err: '' };
    if (args[0] === 'log') return { status: 0, out: 'abc1234 feat\n', err: '' };
    if (args[0] === 'diff') {
      return {
        status: 0,
        out: '+++ b/routes.go\n@@ -0,0 +1 @@\n+router.GET("/v1/jobs", h.list)\n',
        err: '',
      };
    }
    if (args[0] === 'show' && args[1].endsWith(':package.json')) {
      const base = args[1].startsWith('base');
      return { status: 0, out: JSON.stringify({ dependencies: base ? { express: '4.18.0' } : { express: '4.18.0', undici: '5.28.4' } }), err: '' };
    }
    return { status: 1, out: '', err: 'not found' };
  };
  const facts = buildDiffFacts('/repo', 'base', 'HEAD', { gitFn: fakeGit });
  assert.equal(facts.files.length, 4);
  const pkg = facts.manifests.find((m) => m.file === 'package.json');
  assert.deepEqual(pkg.added.map((d) => d.name), ['undici']);
  assert.deepEqual(facts.migrations, ['db/migrations/0001.sql']);
  assert.deepEqual(facts.suspicious_files, ['internal/pack/zip.go']);
  assert.equal(facts.routes.length, 1);
  assert.match(facts.routes[0].snippet, /router\.GET/);
});

test('buildArchMapFromAtlas deriva do app-model do atlas-docs', () => {
  const dir = makePack({
    'docs/atlas/app-model.json': {
      schema: 'atlas-docs/1',
      app: { name: 'demo', generatedAt: '2026-10-01T00:00:00Z' },
      architecture: {
        style: 'hexagonal',
        libs: [{ group: 'Runtime', items: [{ name: 'chi', ver: '5.0', use: 'router' }] }],
        adrs: [{ id: 'ADR-004', title: 'Sem ORM', status: 'aceito' }],
        containers: [{ group: 'borda', name: 'api', sub: 'Go · chi', prov: 'code' }],
      },
      c4: { containers: [{ id: 'api', name: 'billing-api', group: 'borda', tech: 'Go 1.23' }] },
    },
  });
  const map = buildArchMapFromAtlas(dir);
  assert.equal(map.source, 'atlas');
  assert.equal(map.style, 'hexagonal');
  assert.equal(map.libs.length, 1);
  assert.equal(map.adrs[0].id, 'ADR-004');
  assert.equal(map.containers[0].id, 'api');
  assert.equal(buildArchMapFromAtlas(makePack({})), null);
});

test('deps-freshness: dep nova fora da última ativa vira bloqueio; dep velha vira follow-up', async () => {
  const repo = makePack({
    'hooks/diff-facts.json': {
      base: 'b', head: 'h', commits: [], files: [], migrations: [], suspicious_files: [], routes: [],
      manifests: [{ file: 'package.json', ecosystem: 'npm', added: [{ name: 'undici', version: '5.28.4', dev: false }], removed: [], changed: [] }],
    },
  });
  const doc = await runDepsFreshness(repo, repo, { fakeRegistry: { npm: { undici: { latest: '7.1.0', deprecated: false } } } });
  assert.equal(doc.verdict, 'REJECT');
  assert.equal(doc.findings.length, 1);
  assert.equal(doc.findings[0].severity, 'high');
  assert.equal(doc.deps[0].state, 'major-behind');

  const okDoc = await runDepsFreshness(repo, repo, { fakeRegistry: { npm: { undici: { latest: '5.28.4', deprecated: false } } } });
  assert.equal(okDoc.verdict, 'APPROVE');
  assert.equal(okDoc.findings.length, 0);
});

test('deps-freshness: sem dep nova o hook aprova sem tocar registry; registry fora vira OPEN', async () => {
  const noDeps = makePack({
    'hooks/diff-facts.json': {
      manifests: [{ file: 'package.json', ecosystem: 'npm', added: [], removed: [], changed: [] }],
    },
  });
  const doc = await runDepsFreshness(noDeps, noDeps, {});
  assert.equal(doc.verdict, 'APPROVE');
  assert.equal(doc.registry, 'not-needed');

  const withDep = makePack({
    'hooks/diff-facts.json': {
      manifests: [{ file: 'package.json', ecosystem: 'npm', added: [{ name: 'ghost', version: '1.0.0', dev: false }], removed: [], changed: [] }],
    },
  });
  const offline = await runDepsFreshness(withDep, withDep, { fetchJson: async () => { throw new Error('sem rede'); } });
  assert.equal(offline.verdict, 'OPEN');
});

test('verdict: FAIL com achado >= high; waiver do usuário desbloqueia; OPEN não derruba; missing bloqueia com require all', async () => {
  const base = makePack({
    'hooks/security.json': { hook: 'security', verdict: 'REJECT', findings: [{ id: 'S-1', severity: 'high', title: 'rota sem authz', status: 'open' }] },
    'hooks/performance.json': { hook: 'performance', verdict: 'APPROVE', findings: [] },
    'hooks/deps-freshness.json': { hook: 'deps-freshness', verdict: 'OPEN', findings: [] },
  });
  const fail = aggregateVerdict(base);
  assert.equal(fail.verdict, 'FAIL');
  assert.ok(fail.hooks.find((h) => h.hook === 'security').blocking);
  assert.ok(fail.hooks.find((h) => h.hook === 'deps-freshness').blocking === false);
  assert.ok(fail.hooks.find((h) => h.hook === 'arch-alignment').verdict === 'MISSING');

  const present = aggregateVerdict(base, { require: 'present' });
  assert.equal(present.verdict, 'FAIL'); // security ainda bloqueia

  const waived = makePack({
    'hooks/security.json': { hook: 'security', verdict: 'REJECT', findings: [{ id: 'S-1', severity: 'high', title: 'rota sem authz', status: 'open' }] },
    'hooks/performance.json': { hook: 'performance', verdict: 'APPROVE', findings: [] },
    'hooks/deps-freshness.json': { hook: 'deps-freshness', verdict: 'APPROVE', findings: [] },
    'hooks/arch-alignment.json': { hook: 'arch-alignment', verdict: 'APPROVE', findings: [] },
    'hooks/reinvention.json': { hook: 'reinvention', verdict: 'APPROVE', findings: [] },
    'hooks/overengineering.json': { hook: 'overengineering', verdict: 'APPROVE', findings: [] },
    'hooks/ui-scope.json': { ui_touched: false },
    'hooks/waivers.json': { waivers: [{ hook: 'security', finding: 'S-1', reason: 'rede interna, sem exposição', at: '2026-10-01T00:00:00Z' }] },
  });
  const pass = aggregateVerdict(waived);
  assert.equal(pass.verdict, 'PASS');
  assert.equal(pass.waivers, 1);
});

test('CLI: verdict sai 1 em FAIL e 0 após waive', () => {
  const dir = makePack({
    'hooks/security.json': { hook: 'security', verdict: 'REJECT', findings: [{ id: 'S-1', severity: 'critical', title: 'sql injection', status: 'open' }] },
  });
  const fail = spawnSync('node', [CLI, 'verdict', '--dir', dir], { encoding: 'utf8' });
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /hooks verdict: FAIL/);

  const w = spawnSync('node', [CLI, 'waive', '--dir', dir, '--hook', 'security', '--finding', 'S-1', '--reason', 'falso positivo validado'], { encoding: 'utf8' });
  assert.equal(w.status, 0);
  const ok = spawnSync('node', [CLI, 'verdict', '--dir', dir, '--require', 'present'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /hooks verdict: PASS/);
});

test('report renderiza a aba Hooks com achados, deps, waivers e verdict', () => {
  const dir = makePack({
    'run-meta.json': { app: 'Demo', branch: 'feat/x', kind: 'feature', status: 'in_progress', started_at: NOW.toISOString() },
    'hooks/arch-map.json': { source: 'atlas', style: 'hexagonal', layers: [], libs: [{ name: 'chi' }], adrs: [], containers: [] },
    'hooks/diff-facts.json': { files: [{ status: 'A', file: 'a.go' }], commits: ['x'], manifests: [{ added: [{ name: 'undici' }] }], routes: [], migrations: [] },
    'hooks/reinvention.json': {
      hook: 'reinvention', verdict: 'REJECT', round: 1, summary: 'zip caseiro no diff.',
      findings: [{ id: 'R-1', severity: 'high', title: 'hand-rolled zip64', description: 'reescreve archive/zip', file: 'internal/pack/zip.go', line: 88, canonical: 'stdlib archive/zip', status: 'open' }],
    },
    'hooks/deps-freshness.json': {
      hook: 'deps-freshness', verdict: 'APPROVE', scope: 'new', registry: 'fake', summary: '1 dep ok.',
      deps: [{ name: 'undici', current: '7.1.0', latest: '7.1.0', state: 'ok', ecosystem: 'npm' }],
      findings: [],
    },
    'hooks/verdict.json': { verdict: 'FAIL', at: NOW.toISOString(), hooks: [] },
    'hooks/waivers.json': { waivers: [{ hook: 'security', finding: 'S-1', reason: 'rede interna', at: NOW.toISOString() }] },
  });
  const { html } = buildReport(dir, { now: NOW });
  const hooksPanelStart = html.indexOf('id="panel-hooks"');
  assert.notEqual(hooksPanelStart, -1, 'painel hooks ausente');
  const hooksHtml = html.slice(hooksPanelStart, html.indexOf('role="tabpanel"', hooksPanelStart + 20));
  assert.match(hooksHtml, /Não reinventar a roda/);
  assert.match(hooksHtml, /hand-rolled zip64/);
  assert.match(hooksHtml, /stdlib archive\/zip/);
  assert.match(hooksHtml, /Deps na última ativa/);
  assert.match(hooksHtml, /undici/);
  assert.match(hooksHtml, /Waivers/);
  assert.match(hooksHtml, /rede interna/);
  assert.match(hooksHtml, /FAIL/);
  // alerta na visão geral
  assert.match(html, /Hook Não reinventar a roda: 1 achado\(s\) ≥ high aberto\(s\)/);
});

test('HOOK_IDS cobre os 7 hooks e o verdict lista todos', () => {
  assert.deepEqual(HOOK_IDS, ['arch-alignment', 'reinvention', 'security', 'performance', 'overengineering', 'deps-freshness', 'ui-acceptance']);
  const empty = makePack({});
  const v = aggregateVerdict(empty);
  assert.equal(v.verdict, 'FAIL'); // require all: hooks não rodaram
  assert.equal(v.hooks.filter((h) => h.verdict === 'MISSING').length, 7);
});

test('ui-acceptance sem UI no pack paga como SKIP automático', () => {
  const dir = makePack({ 'hooks/ui-scope.json': { ui_touched: false } });
  const v = aggregateVerdict(dir);
  const ui = v.hooks.find((h) => h.hook === 'ui-acceptance');
  assert.equal(ui.verdict, 'SKIP');
  assert.equal(ui.blocking, false);
});

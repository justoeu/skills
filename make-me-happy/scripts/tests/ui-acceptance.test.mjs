import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildUiScope,
  bootApp,
  teardownApp,
  runE2e,
  runDrive,
  buildDriverSource,
} from '../ui-acceptance.mjs';
import { buildReport } from '../build-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'ui-acceptance.mjs');
const NOW = new Date('2026-10-01T12:00:00Z');

function makePack(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-ui-'));
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

test('scope: detecta UI por diff, por payloads kind ui e acha runner', () => {
  const repo = makePack({ 'package.json': { dependencies: { react: '19.0.0' }, devDependencies: { '@playwright/test': '1.40.0' } } });
  const out = makePack({
    'hooks/diff-facts.json': { files: [{ status: 'M', file: 'src/Checkout.tsx' }, { status: 'M', file: 'internal/api/charge.go' }] },
    'payloads.json': [{ name: 'checkout', kind: 'ui', spec_ref: '§4.2' }],
  });
  const scope = buildUiScope(repo, out, {});
  assert.equal(scope.ui_touched, true);
  assert.equal(scope.frontend_files.length, 1);
  assert.equal(scope.screens.length, 1);
  assert.equal(scope.e2e_runner, '@playwright/test');

  const backendOnly = makePack({
    'hooks/diff-facts.json': { files: [{ status: 'M', file: 'internal/api/charge.go' }] },
    'payloads.json': [],
  });
  const scope2 = buildUiScope(repo, backendOnly, {});
  assert.equal(scope2.ui_touched, false);
  assert.equal(scope2.how, null);
});

test('boot sobe, healthcheck responde; teardown mata pelo pid registrado', async () => {
  const repo = makePack({});
  const out = makePack({});
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  srv.close(); // o boot real vai subir um processo próprio

  const { ok, boot } = await bootApp(repo, out, {
    cmd: `node -e "require('http').createServer((q,s)=>{s.end('ok')}).listen(${port}, '127.0.0.1')"`,
    port,
    healthcheck: '/',
    timeoutMs: 15000,
  });
  assert.equal(ok, true);
  assert.equal(boot.health.ok, true);
  assert.ok(boot.pid > 0);

  teardownApp(out);
  await new Promise((r) => setTimeout(r, 300));
  const probe = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.status).catch(() => 'down');
  assert.equal(probe, 'down');
  // teardown é idempotente e nunca mata em massa
  const t2 = teardownApp(out);
  assert.equal(t2.killed, false);
});

test('run-e2e registra exit, duração e cauda do log', () => {
  const repo = makePack({});
  const out = makePack({});
  const okDoc = runE2e(repo, out, { cmd: 'node -e "console.log(\'pass\'); process.exit(0)"' });
  assert.equal(okDoc.ok, true);
  assert.match(okDoc.log, /pass/);
  const badDoc = runE2e(repo, out, { cmd: 'node -e "console.error(\'boom\'); process.exit(1)"' });
  assert.equal(badDoc.ok, false);
  assert.match(badDoc.log, /boom/);
});

test('drive: driver gerado cobre ações/asserts; runDrive com runner fake produz jornada', async () => {
  const src = buildDriverSource();
  for (const a of ['goto', 'click', 'fill', 'assert_visible', 'assert_text', 'wait', 'screenshot']) {
    assert.match(src, new RegExp(`'${a}'`), `driver deve suportar ${a}`);
  }
  assert.match(src, /console_errors/);
  assert.match(src, /network_errors/);
  assert.match(src, /block_external/);

  const out = makePack({});
  const spec = path.join(out, 'ui', 'drive', 'checkout.spec.json');
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.writeFileSync(spec, JSON.stringify({ screen: 'checkout', base_url: 'http://localhost:4599', steps: [{ action: 'goto', path: '/' }] }));

  const fakeRunner = async (cmd, args, opts) => {
    // simula o driver headless: lê SPEC e escreve OUT_JSON
    const specRead = JSON.parse(fs.readFileSync(opts.env.SPEC, 'utf8'));
    const journey = {
      screen: specRead.screen, mode: 'drive', steps: [{ n: 1, action: 'goto', ok: true }],
      console_errors: [{ text: 'TypeError: x', step: 1 }], network_errors: [],
      screenshots: [], assertions: { ok: 1, total: 1, failed: [] },
      verdict: 'APPROVE', at: NOW.toISOString(),
    };
    fs.mkdirSync(path.dirname(opts.env.OUT_JSON), { recursive: true });
    fs.writeFileSync(opts.env.OUT_JSON, JSON.stringify(journey));
    return { status: 0, stdout: '', stderr: '' };
  };
  const r = await runDrive(out, { specPath: spec, ensureFn: () => ({ ready: true }), spawnFn: fakeRunner });
  assert.equal(r.ok, true);
  assert.equal(r.journey.screen, 'checkout');
  assert.equal(r.journey.console_errors.length, 1);
  // credenciais passam por env, nunca pelo spec
  assert.equal(fs.readFileSync(spec, 'utf8').includes('password'), false);
});

test('report: hook de UI + bloco Aceitação de UI + galeria embutida', () => {
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const dir = makePack({
    'run-meta.json': { app: 'Demo', branch: 'feat/x', kind: 'feature', status: 'in_progress', started_at: NOW.toISOString() },
    'hooks/ui-scope.json': { ui_touched: true, how: '2 arquivo(s) de frontend no diff', screens: [{ name: 'checkout' }] },
    'hooks/ui-acceptance.json': { hook: 'ui-acceptance', verdict: 'REJECT', round: 1, summary: 'submit quebra.', findings: [{ id: 'U-1', severity: 'high', title: 'TypeError no submit', screen: 'checkout', status: 'open' }] },
    'ui/boot.json': { cmd: 'npm run dev', url: 'http://localhost:3000/', health: { ok: true, status: 200 } },
    'ui/journeys/checkout.json': { screen: 'checkout', mode: 'drive', verdict: 'REJECT', steps: [], console_errors: [{ text: 'TypeError' }], network_errors: [], screenshots: ['ui/screenshots/checkout-02-fail.png'], assertions: { ok: 2, total: 3, failed: ['submit'] } },
    'ui/screenshots/checkout-02-fail.png': png1x1,
  });
  const { html } = buildReport(dir, { now: NOW });
  assert.match(html, /Aceitação de UI \(runtime\)/);
  assert.match(html, /TypeError no submit/);
  const uiPanel = html.slice(html.indexOf('Aceitação de UI <span'), html.indexOf('Waivers') === -1 ? undefined : html.indexOf('Waivers'));
  assert.match(uiPanel, /npm run dev/);
  assert.match(uiPanel, /checkout/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /Hook Aceitação de UI \(runtime\): 1 achado\(s\) ≥ high aberto\(s\)/);
});

test('CLI scope grava ui-scope.json', () => {
  const repo = makePack({ 'package.json': { dependencies: { vue: '3.4.0' } } });
  const out = makePack({ 'payloads.json': [{ name: 'painel', kind: 'ui' }] });
  const r = spawnSync('node', [CLI, 'scope', '--root', repo, '--dir', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ui_touched=true/);
  const doc = JSON.parse(fs.readFileSync(path.join(out, 'hooks', 'ui-scope.json'), 'utf8'));
  assert.equal(doc.screens.length, 1);
  assert.ok(doc.frameworks.includes('vue'));
});

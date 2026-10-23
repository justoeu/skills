import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.ATLAS_REAL_BROWSER === '1';

test('offline Chromium: safe navigation, source rendering and missing-flow state', { skip: !enabled, timeout: 60000 }, async t => {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.ATLAS_PLAYWRIGHT_PATH, 'playwright', path.join(os.homedir(), 'Library/Caches/make-me-happy/ui-driver/node_modules/playwright'), path.join(os.homedir(), '.cache/make-me-happy/ui-driver/node_modules/playwright')].filter(Boolean);
  let playwright;
  for (const candidate of candidates) { try { playwright = require(candidate); break; } catch {} }
  assert.ok(playwright, 'Opt-in requires existing Playwright; this test never installs packages');
  assert.ok(fs.existsSync(playwright.chromium.executablePath()), 'Opt-in requires cached Chromium');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-browser-'));
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => /^(?:file|data):/.test(route.request().url()) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const quoted = "orders');window.__atlasMarker=1;// & <tag> /";
  const source = { ref: 'fixtures/telemetry.json:3', observedAt: '2026-10-22T10:00:00Z' };
  const model = {
    schema: 'atlas-docs/2', app: { name: 'Offline fixture', commit: 'abc1234' },
    entrypoints: [{ kind: 'http', ref: 'POST /orders', status: 'mapeado', flow: quoted }],
    flows: [{ id: quoted, label: 'Orders', brief: { what: 'Create only orders', does: 'Persist synthetic order', happy: ['Saved'], unhappy: ['Invalid'] },
      steps: [{ name: 'Create order', payload: '{"password":"CANARY_PAYLOAD"}', src: 'orders.mjs:1' }],
      diagram: { nodes: [{ id: quoted, label: 'Order node', kind: 'own', x: 20, y: 30, insp: { desc: 'Selected order node', reqPayload: 'Synthetic request' } }], edges: [] },
      classes: [{ name: quoted, desc: 'Selected order class', methods: [{ sig: 'create()', what: 'Selected create method', calls: [] }] }] }],
    env: { vars: [{ name: 'PORT', value: '3000', desc: 'HTTP port', flows: [quoted] }, { name: 'DATABASE_URL', value: 'postgres://fixture:CANARY_URL@localhost/db' }] },
    c4: { context: { actors: [{ id: quoted, name: 'Customer', desc: 'Selected customer', flows: [quoted] }], edges: [{ from: quoted, to: 'system' }] }, containers: [{ id: quoted, name: 'API', flows: [quoted] }] },
    data: { tables: [{ name: 'unsourced', rows: 'CANARY_ROWS', size: 'CANARY_SIZE', wps: 'CANARY_WPS', prov: 'code' }, { name: 'sourced', rows: '87654', size: '17 GB', wps: '42', source }] },
    events: { topics: [{ topic: 'unsourced', group: 'worker', lag: 'CANARY_LAG', dlq: 'CANARY_DLQ' }, { topic: 'sourced', group: 'worker', lag: '761', dlq: '13 msg', source }] },
  };
  const modelPath = path.join(dir, 'model.json'), htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(modelPath, JSON.stringify(model));
  const build = spawnSync('python3', [path.join(root, 'scripts/atlas_build.py'), modelPath, '--template', path.join(root, 'assets/template.html'), '-o', htmlPath], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  assert.equal(/CANARY_/.test(fs.readFileSync(htmlPath, 'utf8')), false);
  await page.goto(pathToFileURL(htmlPath).href);
  const go = async key => page.locator('.nav-row[data-value="' + key + '"]').click();

  await t.test('A1: quoted IDs remain data across nav, nodes, methods, C4 and env links', async () => {
    await page.locator('.nav-flow').click();
    assert.equal(decodeURIComponent(new URL(page.url()).hash.slice('#/fluxos/'.length)), quoted);
    await page.locator('[data-action="selNode"]').first().click();
    assert.ok((await page.locator('body').innerText()).includes('Selected order node'));
    await page.locator('[data-action="selClass"]').click();
    assert.ok((await page.locator('body').innerText()).includes('Selected order class'));
    await page.locator('[data-action="selMethod"]').click();
    assert.ok((await page.locator('body').innerText()).includes('MÉTODO SELECIONADO'));
    await go('c4'); await page.locator('.c4-node').filter({ hasText: 'Customer' }).click();
    assert.ok((await page.locator('body').innerText()).includes('Selected customer'));
    await page.locator('[data-action="flow"]').last().click();
    await go('env'); await page.locator('.env-search').fill('PORT');
    await page.locator('#env-list [data-action="flow"]').click();
    assert.ok((await page.locator('[data-atlas="flow-brief"]').innerText()).includes('Create only orders'));
    await page.reload();
    assert.ok((await page.locator('[data-atlas="flow-brief"]').innerText()).includes('Create only orders'));
    assert.equal(await page.evaluate(() => window.__atlasMarker ?? null), null);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name)).map(a => a.name))), []);
  });
  await t.test('A8: unsourced metrics are dashed, observed values show source and timestamp', async () => {
    await go('dados');
    let body = await page.locator('.col-main').innerText();
    assert.ok(body.includes('NÃO CONECTADO')); assert.ok(body.includes('87654')); assert.ok(body.includes(source.ref)); assert.ok(body.includes(source.observedAt));
    await go('filas'); body = await page.locator('.col-main').innerText();
    assert.ok(body.includes('761')); assert.ok(body.includes('13 msg')); assert.ok(body.includes('FONTE DECLARADA')); assert.equal(body.includes('CANARY_'), false);
  });
  await t.test('A9: stale deep link reports absence instead of rendering another journey', async () => {
    await page.goto(pathToFileURL(htmlPath).href + '#/fluxos/removed');
    assert.ok((await page.locator('[data-atlas="missing-flow"]').innerText()).includes('removed'));
    assert.equal(await page.locator('[data-atlas="flow-brief"]').count(), 0);
  });
  await t.test('delegated navigation and score tooltip retain ordinary behavior', async () => {
    for (const key of ['know', 'arq', 'con', 'third', 'deps', 'ops', 'qual', 'hist']) {
      const nav = page.locator('.nav-row[data-value="' + key + '"]');
      if (await nav.count()) { await nav.click(); assert.ok((await page.locator('.col-main').innerText()).length > 0); }
    }
    await page.locator('[data-score-tip]').focus();
    assert.ok((await page.locator('.score-tip').innerText()).toLowerCase().includes('score'));
  });
  assert.deepEqual(errors, []);
});

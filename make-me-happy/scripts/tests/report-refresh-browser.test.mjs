import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { driverHome } from '../ui-acceptance.mjs';
import { initRun } from '../run-meta.mjs';
import { readJson, writeJson } from '../state-io.mjs';
import { buildReport } from '../build-report.mjs';

for (const protocol of ['http', 'file']) {
test(`Chromium automatically reloads the ${protocol} report and preserves the reader view`, {
  skip: process.env.MMH_REAL_BROWSER !== '1', timeout: 30000,
}, async t => {
  const { chromium } = createRequire(path.join(driverHome(), 'report-test.cjs'))('playwright');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-report-browser-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'spec.md'), 'Export CSV.');
  const { dir, meta } = initRun(root, { spec: 'spec.md' });
  writeJson(path.join(dir, 'TASKS.json'), { tasks: [
    { id: 'T-001', title: 'Exportação CSV', status: 'IN_PROGRESS', version: 0, worktree: 1 },
    { id: 'T-002', title: 'Outra entrega', status: 'OPEN', version: 0, worktree: 2 },
  ] });
  writeJson(path.join(dir, 'report-watch.json'), { run_id: meta.run_id, status: 'running', pid: process.pid, interval_ms: 600000 });
  buildReport(dir);
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(path.join(dir, 'report.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = protocol === 'file' ? pathToFileURL(path.join(dir, 'report.html')).href
    : `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const original = window.setInterval;
    window.setInterval = function (fn, ms, ...args) {
      if (ms === 60000) { window.reportRefreshTick = fn; return 0; }
      return original(fn, ms, ...args);
    };
  });
  await page.goto(url);
  await page.locator('#tab-impl').click();
  await page.locator('#task-q').fill('Exportação');
  await page.locator('#task-status').selectOption('IN_PROGRESS');
  await page.locator('#task-wt').selectOption('1');
  await page.locator('details.task:not([hidden]) > summary').click();
  const doc = readJson(path.join(dir, 'TASKS.json'));
  doc.tasks[0].notes = 'Novos dados publicados no relatório'; writeJson(path.join(dir, 'TASKS.json'), doc);
  buildReport(dir);
  await page.evaluate(() => document.activeElement.blur());
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.reportRefreshTick())]);
  assert.equal(await page.locator('#tab-impl').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#task-q').inputValue(), 'Exportação');
  assert.equal(await page.locator('#task-status').inputValue(), 'IN_PROGRESS');
  assert.equal(await page.locator('#task-wt').inputValue(), '1');
  assert.equal(await page.locator('details.task:not([hidden])').getAttribute('open'), '');
  assert.match(await page.locator('details.task:not([hidden])').innerText(), /Novos dados publicados/);
  await page.evaluate(() => {
    document.getElementById('report-refresh').dataset.generatedAt = new Date(Date.now() - 900000).toISOString();
    document.getElementById('task-q').focus();
    window.reportRefreshTick();
  });
  assert.match(await page.locator('#report-age').textContent(), /desatualizada/);
  assert.deepEqual(errors, []);
});
}

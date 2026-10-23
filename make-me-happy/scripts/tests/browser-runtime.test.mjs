import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { driverHome, runDrive } from '../ui-acceptance.mjs';

// Opt in with MMH_REAL_BROWSER=1. This test never installs npm packages or browsers.
test('real Chromium distinguishes runtime failures from expected HTTP validation', {
  skip: process.env.MMH_REAL_BROWSER !== '1' ? 'Set MMH_REAL_BROWSER=1 to use an existing local Chromium cache.' : false,
}, async (t) => {
  let playwright;
  try {
    playwright = createRequire(path.join(driverHome(), 'browser-test.cjs'))('playwright');
  } catch {
    t.skip('Playwright is not installed in the existing driver cache. No installation attempted.');
    return;
  }
  if (!fs.existsSync(playwright.chromium.executablePath())) {
    t.skip('The existing Chromium cache is unavailable. No installation attempted.');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-browser-runtime-'));
  const diagnostic = 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)';
  let baseUrl;
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204); res.end(); return;
    }
    if (req.url === '/api/error' || req.url === '/api/checkout') {
      const status = req.url === '/api/error' ? 500 : 422;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: status === 500 ? 'server error handled' : 'validation expected' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url === '/happy') {
      res.end('<html><body><button id="pay" onclick="document.querySelector(\'#status\').textContent=\'Paid\'">Pay</button><p id="status">Pending</p></body></html>');
      return;
    }
    const endpoint = req.url === '/error' ? '/api/error' : '/api/checkout';
    // sourceURL makes the application message report the same URL as the expected
    // response. Its JS argument still distinguishes it from Chromium's diagnostic.
    const spoof = req.url === '/spoof'
      ? `eval(${JSON.stringify(`console.error(${JSON.stringify(diagnostic)});\n//# sourceURL=${baseUrl}/api/checkout`)});`
      : '';
    res.end(`<html><body><h1>Loading</h1><script>${spoof}
      fetch(${JSON.stringify(endpoint)}).then(r=>r.json()).then(data=>{
        const heading=document.querySelector('h1');heading.textContent=data.message;heading.id='result';
      });</script></body></html>`);
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const name of ['happy', 'error', 'validation', 'spoof']) {
      await t.test(name, async () => {
        const expected = name === 'validation' || name === 'spoof';
        const steps = name === 'happy'
          ? [{ action: 'goto', path: '/happy' }, { action: 'click', selector: '#pay' }, { action: 'assert_text', selector: '#status', text: 'Paid' }]
          : [{ action: 'goto', path: `/${name}` }, { action: 'assert_visible', selector: '#result', text: name === 'error' ? 'server error handled' : 'validation expected' }];
        const spec = { screen: name, base_url: baseUrl, steps,
          ...(expected ? { expected_network_errors: [{ status: 422, path: '/api/checkout' }] } : {}) };
        const specPath = path.join(dir, `${name}.spec.json`);
        fs.writeFileSync(specPath, JSON.stringify(spec));
        const result = await runDrive(dir, {
          specPath, timeoutMs: 20000,
          ensureFn: () => ({ ready: true }), // never call the installation helper
        });
        const approves = name === 'happy' || name === 'validation';
        assert.equal(result.ok, approves, result.log || result.journey?.error);
        assert.equal(result.journey.verdict, approves ? 'APPROVE' : 'REJECT');
        assert.equal(result.exit, approves ? 0 : 1);
        if (name === 'error') assert.ok(result.journey.unexpected_network_errors.some((e) => e.status === 500));
        if (name === 'validation') {
          assert.equal(result.journey.unexpected_console_errors.length, 0);
          assert.ok(result.journey.console_errors.some((e) => e.expected_network_error === true));
        }
        if (name === 'spoof') {
          assert.ok(result.journey.unexpected_console_errors.some((e) =>
            e.text === diagnostic && e.argument_count > 0 && e.location.url === `${baseUrl}/api/checkout`));
        }
      });
    }
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

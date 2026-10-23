#!/usr/bin/env node
/**
 * Aceitação de UI (runtime) — a parte determinística do §4z.
 *
 *   ui-acceptance.mjs scope    --root . --dir $OUT [--base <sha>]      # o pack toca UI?
 *   ui-acceptance.mjs boot     --root . --dir $OUT --cmd "npm run dev" [--port 3000] [--healthcheck /healthz]
 *   ui-acceptance.mjs teardown --dir $OUT                              # mata o que o boot subiu
 *   ui-acceptance.mjs run-e2e  --root . --dir $OUT --cmd "npx playwright test"
 *
 * A parte semântica (dirigir telas, conferir contrato e padrão) é do agente
 * `agents/ui-acceptance.md` (o Motorista), que grava `hooks/ui-acceptance.json`
 * e `ui/journeys/<tela>.json` com screenshots. O verdict entra no agregador do
 * `hooks.mjs verdict` como o 7º hook; pack sem UI (`ui-scope.ui_touched=false`)
 * paga a fase como SKIP automático.
 *
 * Regras: boot só pelo jeito do próprio repo (script/Makefile/compose do
 * README) e só em localhost; teardown mata pelo pid registrado (nunca em
 * massa); ports/credenciais de teste; sem browser no host → hook OPEN.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFile } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { writeJson, captureEvidence, attachEvidence } from './state-io.mjs';

// ---------------------------------------------------------------- helpers
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function loadJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function waitForHttp(url, timeoutMs, alive, expectedStatus) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) return { ok: false, status: null, error: 'boot process exited' };
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      if (alive() && (expectedStatus ? res.status === expectedStatus : res.status >= 200 && res.status < 300))
        return { ok: true, status: res.status };
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return { ok: false, status: null };
}

// ---------------------------------------------------------------- scope
const UI_EXTENSION_RE = /\.(tsx|jsx|vue|svelte|html?|css|scss|sass|less)$/i;
const SCRIPT_EXTENSION_RE = /\.(?:[mc]?js|ts)$/i;
const UI_DIRECTORY_RE = /(^|\/)(pages|components|views|screens|web|frontend|client|ui|stories|assets)(\/|$)/i;
const SOURCE_DIRECTORY_RE = /(^|\/)(src|app|lib|test|tests|__tests__)(\/|$)/i;
const UI_FRAMEWORKS = [
  'react',
  'react-dom',
  'next',
  'vue',
  'nuxt',
  'svelte',
  '@sveltejs/kit',
  'vite',
  '@angular/core',
  'astro',
  'gatsby',
  'solid-js',
  'preact',
  'flutter',
  'expo',
  'react-native',
  '@playwright/test',
  'playwright',
  'cypress',
  '@testing-library/react',
];
const E2E_FRAMEWORKS = new Set(['@playwright/test', 'playwright', 'cypress']);

function packageFrameworks(dir) {
  const pkg = loadJson(path.join(dir, 'package.json'), null);
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return UI_FRAMEWORKS.filter((name) => deps[name]);
}

/** Fatos determinísticos: o diff/pack toca UI? Que telas o SDD declara? */
export function buildUiScope(repoRoot, outDir, { base } = {}) {
  const meta = loadJson(path.join(outDir, 'run-meta.json'), {});
  const diffFacts = loadJson(path.join(outDir, 'hooks', 'diff-facts.json'), null);
  base = base || meta.base || meta.head || diffFacts?.base;
  let known = false;
  let files = Array.isArray(diffFacts?.files)
    ? diffFacts.files.map((f) => f?.file).filter((f) => typeof f === 'string')
    : [];

  // Cached facts can establish positive UI scope, but cannot prove its absence.
  // Compare with the current worktree so a later commit or local edit is included.
  if (base) {
    const changed = spawnSync('git', ['-C', repoRoot, 'diff', '--name-only', '-z', base, '--'], {
      encoding: 'utf8',
    });
    const untracked = spawnSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    });
    if (changed.status === 0 && untracked.status === 0) {
      known = true;
      files = [...new Set((changed.stdout + untracked.stdout).split('\0').filter(Boolean))];
    }
  }

  // stack: manifests no repo raiz
  const frameworks = packageFrameworks(repoRoot) || [];
  const hasFlutter = fs.existsSync(path.join(repoRoot, 'pubspec.yaml'));
  const hasSwiftUi =
    fs.existsSync(path.join(repoRoot, 'Package.swift')) || fs.existsSync(path.join(repoRoot, 'ios'));
  const hasRailsViews = fs.existsSync(path.join(repoRoot, 'app', 'views'));
  const root = path.resolve(repoRoot),
    output = path.resolve(outDir);
  const packageCache = new Map();
  const renderingStack = (file) => {
    let dir = path.dirname(path.resolve(root, file));
    while (dir === root || dir.startsWith(root + path.sep)) {
      if (!packageCache.has(dir)) packageCache.set(dir, packageFrameworks(dir));
      const names = packageCache.get(dir);
      if (names) return names.some((name) => !E2E_FRAMEWORKS.has(name));
      if (dir === root) break;
      dir = path.dirname(dir);
    }
    return false;
  };
  const frontendHits = files.filter((file) => {
    const absolute = path.resolve(root, file);
    if (
      (output !== root && (absolute === output || absolute.startsWith(output + path.sep))) ||
      /(^|\/)docs\/impl\/make-me-happy\//.test(file)
    )
      return false;
    if (UI_EXTENSION_RE.test(file)) return true;
    if (SCRIPT_EXTENSION_RE.test(file)) {
      // src/ and *.test.* are also ordinary backend code. A runner alone is not a UI stack.
      return UI_DIRECTORY_RE.test(file) || renderingStack(file);
    }
    if (/\.dart$/i.test(file))
      return UI_DIRECTORY_RE.test(file) || (hasFlutter && SOURCE_DIRECTORY_RE.test(file));
    if (/\.swift$/i.test(file))
      return UI_DIRECTORY_RE.test(file) || (hasSwiftUi && SOURCE_DIRECTORY_RE.test(file));
    return false;
  });

  // telas declaradas no contrato do SDD + decisão do setup (bypass é do usuário)
  const payloads = loadJson(path.join(outDir, 'payloads.json'), []);
  const uiPayloads = (Array.isArray(payloads) ? payloads : []).filter((p) => p && p.kind === 'ui');
  const screens = uiPayloads.map((p) => ({ name: p.name, spec_ref: p.spec_ref || null, payload: p }));

  const uiTouched = frontendHits.length > 0 || uiPayloads.length > 0;

  const bypass = meta.ui_drive === 'off';

  return {
    ui_touched: uiTouched ? true : known ? false : null,
    evidence_known: known,
    ...(bypass
      ? { bypass: true, bypass_reason: 'usuário optou por não testar telas no setup (ui_drive=off)' }
      : {}),
    how: frontendHits.length
      ? `${frontendHits.length} arquivo(s) de frontend no diff`
      : uiPayloads.length
        ? `${uiPayloads.length} contrato(s) kind:"ui" no payloads.json`
        : null,
    frontend_files: frontendHits.slice(0, 40),
    screens,
    frameworks: [
      ...frameworks,
      ...(hasFlutter ? ['flutter'] : []),
      ...(hasSwiftUi ? ['swiftui'] : []),
      ...(hasRailsViews ? ['rails-views'] : []),
    ],
    e2e_runner:
      frameworks.filter((f) => ['@playwright/test', 'playwright', 'cypress'].includes(f))[0] || null,
    at: nowIso(),
  };
}

// ---------------------------------------------------------------- boot
function listening(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (v) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(v);
      }
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}
function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() || null : null;
}
export async function bootApp(
  repoRoot,
  outDir,
  { cmd, port, healthcheck, timeoutMs = 120000, expectedStatus } = {},
) {
  if (!cmd || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('boot requires a repository command and valid localhost port');
  const uiDir = path.join(outDir, 'ui');
  fs.mkdirSync(uiDir, { recursive: true });
  const file = path.join(uiDir, 'boot.json');
  const previous = loadJson(file, null);
  if (
    previous &&
    !previous.stopped_at &&
    previous.pid_identity &&
    processIdentity(previous.pid) === previous.pid_identity
  )
    throw new Error('previous boot still running; teardown before another boot');
  if ((await listening(port, '127.0.0.1')) || (await listening(port, '::1')))
    return {
      ok: false,
      boot: {
        cmd,
        port,
        health: { ok: false, status: null },
        error: 'port already occupied; command was not started',
        at: nowIso(),
      },
    };
  const execution_id = randomUUID(),
    logFile = path.join(uiDir, 'boot.log'),
    started = Date.now();
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(cmd, { cwd: repoRoot, shell: true, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  let exited = false,
    spawnError = null;
  child.on('exit', () => {
    exited = true;
  });
  child.on('error', (e) => {
    spawnError = e.message;
    exited = true;
  });
  child.unref();
  const url = `http://localhost:${port}${healthcheck || '/'}`;
  const boot = {
    cmd,
    pid: child.pid,
    pgid: child.pid,
    pid_identity: processIdentity(child.pid),
    execution_id,
    url,
    port,
    healthcheck: healthcheck || '/',
    health: { ok: false, status: null },
    status: 'starting',
    log: 'ui/boot.log',
    at: nowIso(),
  };
  writeJson(file, boot);
  const alive = () => !exited && !!boot.pid_identity && processIdentity(child.pid) === boot.pid_identity;
  boot.health = await waitForHttp(url, timeoutMs, alive, expectedStatus);
  boot.started_ms = Date.now() - started;
  boot.status = boot.health.ok ? 'running' : 'failed';
  if (!boot.health.ok) boot.error = spawnError || `healthcheck failed for the started process at ${url}`;
  writeJson(file, boot);
  return { ok: boot.health.ok, boot };
}

// Preserve evidence; the process control record is never a reusable kill instruction.
export function teardownApp(outDir) {
  const file = path.join(outDir, 'ui', 'boot.json'),
    boot = loadJson(file, null);
  if (!boot || boot.stopped_at) return { killed: false };
  let killed = false;
  if (boot.pid_identity && processIdentity(boot.pid) === boot.pid_identity) {
    try {
      process.kill(-boot.pid, 'SIGTERM');
      killed = true;
    } catch {
      try {
        process.kill(boot.pid, 'SIGTERM');
        killed = true;
      } catch {
        /* already exited */
      }
    }
  }
  boot.stopped_at = nowIso();
  boot.status = 'stopped';
  boot.teardown = { killed, identity_matched: killed };
  writeJson(file, boot);
  return { killed, pid: boot.pid };
}

// ---------------------------------------------------------------- e2e
export function runE2e(repoRoot, outDir, { cmd, timeoutMs = 600000 } = {}) {
  const startedAt = Date.now();
  const r = spawnSync(cmd, { cwd: repoRoot, shell: true, encoding: 'utf8', timeout: timeoutMs });
  const lines = String(r.stdout || '')
    .concat(String(r.stderr || ''))
    .split('\n');
  const doc = {
    cmd,
    ok: r.status === 0,
    exit: r.status,
    duration_s: Math.round((Date.now() - startedAt) / 100) / 10,
    log: lines.slice(-40).join('\n'),
    at: nowIso(),
  };
  writeJson(path.join(outDir, 'ui', 'e2e.json'), doc);
  return doc;
}

// ---------------------------------------------------------------- drive
/** Fonte do driver Playwright gerado a partir do spec da jornada (export p/ teste). */
export function buildDriverSource() {
  return String.raw`
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const spec = JSON.parse(fs.readFileSync(process.env.SPEC, 'utf8'));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  if (spec.block_external !== false) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
    await context.route('**/*', (route) => {
      const h = new URL(route.request().url()).hostname;
      return local.test(h) ? route.continue() : route.abort();
    });
  }
  const consoleErrors = [], networkErrors = [], steps = [], shots = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push({ text: m.text(), step: steps.length,
      location: typeof m.location === 'function' ? m.location() : null,
      argument_count: typeof m.args === 'function' ? m.args().length : null });
  });
  page.on('pageerror', (e) => consoleErrors.push({ text: String(e), step: steps.length, pageerror: true }));
  page.on('response', (r) => { if (r.status() >= 400) networkErrors.push({ status: r.status(), url: r.url(), step: steps.length }); });
  const shot = async (name) => { if (shots.length >= 20) return null; const f = process.env.SHOT_DIR + '/' + spec.screen + '-' + String(steps.length + 1).padStart(2, '0') + '-' + (name || 'step') + '.png'; await page.screenshot({ path: f, fullPage: true }); shots.push(f); return f; };
  let ok = true;
  try {
    if (spec.auth) {
      await page.goto(spec.base_url + spec.auth.url);
      await page.fill(spec.auth.fields.user, process.env.MMH_UI_USER || '');
      await page.fill(spec.auth.fields.pass, process.env.MMH_UI_PASS || '');
      await page.click(spec.auth.submit);
      await page.waitForLoadState('networkidle').catch(() => {});
      steps.push({ n: 1, action: 'login', ok: true });
    }
  } catch (e) { ok = false; steps.push({ n: 1, action: 'login', ok: false, error: String(e) }); }
  for (const s of (spec.steps || [])) {
    const n = steps.length + 1;
    try {
      if (s.action === 'goto') await page.goto(spec.base_url + s.path);
      else if (s.action === 'click') await page.click(s.selector, { timeout: s.timeout || 5000 });
      else if (s.action === 'fill') await page.fill(s.selector, s.value == null ? '' : String(s.value), { timeout: s.timeout || 5000 });
      else if (s.action === 'assert_visible') { const el = await page.waitForSelector(s.selector, { timeout: s.timeout || 5000 }); if (s.text) { const t = await el.textContent(); if (!String(t || '').includes(s.text)) throw new Error('texto "' + s.text + '" não achado em ' + s.selector); } }
      else if (s.action === 'assert_text') { const t = await page.textContent(s.selector, { timeout: s.timeout || 5000 }); if (!String(t || '').includes(s.text)) throw new Error('esperado "' + s.text + '" em ' + s.selector + ', veio "' + String(t).trim().slice(0, 80) + '"'); }
      else if (s.action === 'wait') await page.waitForTimeout(s.ms || 500);
      else if (s.action === 'screenshot') { const f = await shot(s.name); steps.push({ n, action: 'screenshot', ok: true, file: f }); continue; }
      else throw new Error('ação desconhecida: ' + s.action);
      steps.push({ n, action: s.action, ok: true, ...(s.selector ? { selector: s.selector } : {}), ...(s.path ? { url: s.path } : {}) });
    } catch (e) {
      ok = false;
      const f = await shot('fail').catch(() => null);
      steps.push({ n, action: s.action, ok: false, error: String(e), ...(f ? { file: f } : {}) });
      break;
    }
  }
  if (!shots.length) await shot('final').catch(() => {});
  await browser.close();
  const failedSteps = steps.filter((s) => !s.ok);
  const expectedNetwork = networkErrors.filter(e => (spec.expected_network_errors || []).some(x => x.status === e.status && x.path === new URL(e.url).pathname));
  const unexpectedNetwork = networkErrors.filter(e => !expectedNetwork.includes(e));
  const unexpectedConsole = consoleErrors.filter(e => {
    // Chromium emits a console diagnostic in addition to the HTTP response.
    // Application console.error calls have JS arguments and never qualify.
    const status = e.text.match(/^Failed to load resource: the server responded with a status of (\d{3})(?: \([^)]*\))?$/);
    const expected = !e.pageerror && e.argument_count === 0 && status && e.location?.url
      && expectedNetwork.some(r => r.url === e.location.url && r.status === Number(status[1]));
    if (expected) e.expected_network_error = true;
    return !expected;
  });
  ok = ok && steps.length > 0 && unexpectedConsole.length === 0 && unexpectedNetwork.length === 0;
  const out = {
    execution_id: process.env.EXECUTION_ID, screen: spec.screen, spec_ref: spec.spec_ref || null, mode: 'drive', base_url: spec.base_url,
    steps, console_errors: consoleErrors, unexpected_console_errors:unexpectedConsole,
    network_errors: networkErrors, unexpected_network_errors:unexpectedNetwork, screenshots: shots,
    assertions: { ok: steps.length - failedSteps.length, total: steps.length, failed: failedSteps.map((s) => s.error || s.action) },
    verdict: ok ? 'APPROVE' : 'REJECT', at: new Date().toISOString(),
  };
  fs.writeFileSync(process.env.OUT_JSON, JSON.stringify(out, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
`;
}

function playwrightCacheDir() {
  const home = process.env.HOME || '';
  return process.platform === 'darwin'
    ? path.join(home, 'Library', 'Caches', 'ms-playwright')
    : path.join(home, '.cache', 'ms-playwright');
}

/** Home do driver: playwright instalado 1× (compartilhado entre runs/packs). */
export function driverHome() {
  const home = process.env.HOME || '';
  const base =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'make-me-happy')
      : path.join(home, '.cache', 'make-me-happy');
  return process.env.MMH_UI_DRIVER_HOME || path.join(base, 'ui-driver');
}

/** Garante playwright no driverHome (1×). `spawnFn` síncrono injetável p/ testes. */
export function ensurePlaywright({ spawnFn = spawnSync } = {}) {
  const home = driverHome();
  const installed = fs.existsSync(path.join(home, 'node_modules', 'playwright'));
  const browsers = playwrightCacheDir();
  const hasBrowser = fs.existsSync(browsers) && fs.readdirSync(browsers).some((d) => /^chromium/.test(d));
  if (installed && hasBrowser) return { ready: true, skipped: true };
  fs.mkdirSync(home, { recursive: true });
  if (!installed) {
    const r = spawnFn(
      'npm',
      ['install', '--prefix', home, 'playwright@latest', '--no-fund', '--no-audit', '--loglevel=error'],
      { encoding: 'utf8', timeout: 600000 },
    );
    if (r.status !== 0)
      return {
        ready: false,
        error: `npm install playwright falhou: ${String(r.stderr || r.stdout || '').slice(-300)}`,
      };
  }
  if (!hasBrowser && !process.env.MMH_PW_SKIP_INSTALL) {
    const nodeBins = path.join(home, 'node_modules', '.bin');
    const installedBrowser = spawnFn(path.join(nodeBins, 'playwright'), ['install', 'chromium'], {
      encoding: 'utf8',
      timeout: 600000,
      env: { ...process.env, PATH: `${nodeBins}:${process.env.PATH}` },
    });
    if (installedBrowser.status !== 0)
      return { ready: false, error: 'playwright browser installation failed' };
  }
  return { ready: true };
}

/** Roda o spec da jornada headless via Playwright do driverHome (sem dep no repo). `spawnFn` async injetável p/ testes. */
export async function runDrive(
  outDir,
  { specPath, user, pass, timeoutMs = 300000, spawnFn = null, ensureFn = null } = {},
) {
  const spec = loadJson(specPath, null);
  if (!spec || !/^[a-zA-Z0-9_-]+$/.test(spec.screen))
    throw new Error(`spec inválido (screen deve ser um slug): ${specPath}`);
  const executionId = randomUUID();
  const uiDir = path.join(outDir, 'ui');
  const outJson = path.join(uiDir, 'runs', `${executionId}.json`);
  const currentJson = path.join(uiDir, 'journeys', `${spec.screen}.json`);
  const initial = {
    execution_id: executionId,
    screen: spec.screen,
    mode: 'drive',
    base_url: spec.base_url,
    verdict: 'REJECT',
    at: nowIso(),
    steps: [],
    console_errors: [],
    network_errors: [],
    screenshots: [],
    assertions: { ok: 0, total: 0, failed: [] },
    error: 'current drive has not completed',
  };
  const persist = (journey) => {
    writeJson(outJson, journey);
    writeJson(currentJson, journey);
  };
  persist(initial);
  try {
    const baseUrl = new URL(spec.base_url);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname) ||
      !['http:', 'https:'].includes(baseUrl.protocol)
    )
      throw new Error('UI drive only supports localhost');
    const ensured = await (ensureFn || ensurePlaywright)();
    if (!ensured.ready) throw new Error(ensured.error);
  } catch (e) {
    persist({ ...initial, error: e.message || String(e), exit: 2 });
    throw e;
  }

  const shotDir = path.join(uiDir, 'screenshots', executionId);
  fs.mkdirSync(shotDir, { recursive: true });
  const driverPath = path.join(uiDir, 'drive', `${spec.screen}.driver.cjs`);
  fs.mkdirSync(path.dirname(driverPath), { recursive: true });
  fs.writeFileSync(driverPath, buildDriverSource());

  const run =
    spawnFn ||
    ((cmd, args, opts) =>
      new Promise((resolve) => {
        execFile(cmd, args, opts, (err, stdout, stderr) =>
          resolve({
            status: err ? (err.code ?? 1) : 0,
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
          }),
        );
      }));
  let r;
  try {
    r = await run('node', [driverPath], {
      timeout: timeoutMs,
      env: {
        ...process.env,
        NODE_PATH: path.join(driverHome(), 'node_modules'),
        EXECUTION_ID: executionId,
        SPEC: path.resolve(specPath),
        OUT_JSON: outJson,
        SHOT_DIR: shotDir,
        MMH_UI_USER: user || process.env.MMH_UI_USER || '',
        MMH_UI_PASS: pass || process.env.MMH_UI_PASS || '',
      },
    });
  } catch (e) {
    persist({ ...initial, error: e.message || String(e), exit: 2 });
    throw e;
  }
  let journey = loadJson(outJson, null);
  if (!journey || journey.execution_id !== executionId || r.status !== 0) {
    journey = {
      ...initial,
      ...(journey?.execution_id === executionId ? journey : {}),
      screen: spec.screen,
      execution_id: executionId,
      verdict: 'REJECT',
      at: nowIso(),
      error: 'current drive did not complete successfully',
      exit: r.status,
    };
  }
  persist(journey);
  return {
    ok: r.status === 0 && journey.verdict === 'APPROVE',
    exit: r.status,
    journey,
    log: String(r.stdout || '') + String(r.stderr || ''),
  };
}

// ---------------------------------------------------------------- cli
async function main() {
  const cmd = process.argv[2];
  const repoRoot = path.resolve(arg('root', '.'));
  const outDir = path.resolve(arg('dir', '.'));

  if (cmd === 'scope') {
    const started = loadJson(path.join(outDir, 'run-meta.json'), {}).run_id ? captureEvidence(outDir) : null;
    let scope = buildUiScope(repoRoot, outDir, { base: arg('base', null) });
    if (started) scope = attachEvidence(outDir, scope, started);
    writeJson(path.join(outDir, 'hooks', 'ui-scope.json'), scope);
    console.log(
      `ui-scope → ui_touched=${scope.ui_touched}${scope.how ? ` (${scope.how})` : ''} · ${scope.screens.length} tela(s) declarada(s)${scope.e2e_runner ? ` · runner ${scope.e2e_runner}` : ''}`,
    );
    return;
  }
  if (cmd === 'boot') {
    const c = arg('cmd', null);
    if (!c) {
      console.error('usage: ui-acceptance.mjs boot --cmd "npm run dev" [--port N] [--healthcheck /healthz]');
      process.exit(2);
    }
    const port = parseInt(arg('port', ''), 10) || null;
    bootApp(repoRoot, outDir, { cmd: c, port, healthcheck: arg('healthcheck', '/') }).then(({ ok, boot }) => {
      if (ok) console.log(`boot ok → pid ${boot.pid} · ${boot.url} (${boot.started_ms}ms)`);
      else {
        console.error(`boot FAIL: ${boot.error}`);
        process.exit(1);
      }
    });
    return;
  }
  if (cmd === 'teardown') {
    const t = teardownApp(outDir);
    if (t.killed) console.log(`teardown ok → pid ${t.pid}`);
    return;
  }
  if (cmd === 'run-e2e') {
    const c = arg('cmd', null);
    if (!c) {
      console.error('usage: ui-acceptance.mjs run-e2e --cmd "npx playwright test"');
      process.exit(2);
    }
    const doc = runE2e(repoRoot, outDir, { cmd: c });
    console.log(`e2e ${doc.ok ? 'ok' : 'FAIL'} → exit ${doc.exit} · ${doc.duration_s}s (ui/e2e.json)`);
    if (!doc.ok) process.exit(1);
    return;
  }
  if (cmd === 'drive') {
    const specArg = arg('spec', null);
    const all = process.argv.includes('--all');
    if (!specArg && !all) {
      console.error(
        'usage: ui-acceptance.mjs drive --spec <a.spec.json,b.spec.json> | --all [--user u --pass p] [--concurrency 3]',
      );
      process.exit(2);
    }
    const driveDir = path.join(outDir, 'ui', 'drive');
    const specs = all
      ? fs.existsSync(driveDir)
        ? fs
            .readdirSync(driveDir)
            .filter((f) => f.endsWith('.spec.json'))
            .map((f) => path.join(driveDir, f))
        : []
      : specArg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    if (!specs.length) {
      console.error('nenhum spec para rodar');
      process.exit(2);
    }
    const concurrency = Math.min(parseInt(arg('concurrency', '3'), 10) || 3, specs.length);
    try {
      const results = [];
      const queue = [...specs];
      const worker = async () => {
        while (queue.length) {
          const specPath = queue.shift();
          const r = await runDrive(outDir, { specPath, user: arg('user', null), pass: arg('pass', null) });
          results.push({ spec: path.basename(specPath), ...r });
          if (r.journey)
            console.log(
              `drive ${r.journey.verdict} → ${r.journey.screen}: ${r.journey.assertions.ok}/${r.journey.assertions.total} passos · ${r.journey.console_errors.length} console · ${r.journey.network_errors.length} rede ≥400`,
            );
          else console.error(`drive FAIL → ${path.basename(specPath)} (sem jornada; veja ui/drive/)`);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      const bad = results.filter((r) => !r.ok);
      console.log(
        `drive: ${results.length - bad.length}/${results.length} jornada(s) APPROVE (concorrência ${concurrency})`,
      );
      if (bad.length) process.exit(1);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }
  console.error('usage: ui-acceptance.mjs scope|boot|teardown|run-e2e|drive …');
  process.exit(2);
}

if (path.basename(process.argv[1] || '') === 'ui-acceptance.mjs') {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

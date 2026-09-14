#!/usr/bin/env node
/**
 * sync-progress.mjs — sincroniza FINDINGS.json ↔ TASKS.md e regenera report.html
 *
 * Uso (Oracle / cada iteração de implementação):
 *
 *   # Após auditoria (gera TASKS.md + HTML)
 *   node sync-progress.mjs --dir docs/audits/ultra-deep-audit/YYYY-MM-DD-full
 *
 *   # Marcar IDs como DONE após fix red→green
 *   node sync-progress.mjs --dir ... --done SEC-SEN-001,N1-NEX-002 \
 *     --note "PR #372" --test "FooServiceTest#bar"
 *
 *   # Reabrir
 *   node sync-progress.mjs --dir ... --open CQ-FOR-002
 *
 *   # Quando 100% DONE → HTML título "COMPLETE" + TASKS.md footer
 *   node sync-progress.mjs --dir ... --refresh
 *
 * Sempre: atualiza FINDINGS.json status, TASKS.md, report.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sh(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function detectAppName(root) {
  try {
    const pkg = loadJson(path.join(root, 'package.json'));
    if (pkg?.name) return String(pkg.name).replace(/^@[^/]+\//, '');
  } catch { /* */ }
  for (const rel of ['Package.swift', 'Bundler.toml', 'Cargo.toml', 'go.mod', 'Makefile']) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8');
    if (rel === 'go.mod') {
      const m = t.match(/^module\s+(\S+)/m);
      if (m) return m[1].split('/').pop();
    }
    if (rel === 'Package.swift') {
      const m = t.match(/name:\s*"([^"]+)"/);
      if (m) return m[1];
    }
    if (rel === 'Cargo.toml' || rel === 'Bundler.toml') {
      const m = t.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (m) return m[1];
    }
    if (rel === 'Makefile') {
      const m = t.match(/^(?:PROJECT|APP_NAME|NAME)\s*[?:]?=\s*(\S+)/m);
      if (m) return m[1];
    }
  }
  return path.basename(path.resolve(root));
}

/** Prefer deploy/release version (APP_VERSION / git tag) over module versions. */
function detectVersion(root, meta = {}) {
  if (meta.version || meta.app_version) return String(meta.version || meta.app_version);
  for (const rel of ['.env', '.env.example', 'Makefile', 'docker-compose.yml', 'docker-compose.app.yml']) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8');
    const m =
      t.match(/^\s*APP_VERSION\s*=\s*["']?([^\s"']+)/m) ||
      t.match(/APP_VERSION:-\s*([^\s}]+)/) ||
      t.match(/^\s*VERSION\s*[?:]?=\s*(\S+)/m);
    if (m?.[1] && m[1] !== 'latest') return m[1].replace(/^v/, '');
  }
  const tag = sh('git describe --tags --abbrev=0', root);
  if (tag) return tag.replace(/^v/, '');
  const pom = path.join(root, 'backend/pom.xml');
  if (fs.existsSync(pom)) {
    const m = fs.readFileSync(pom, 'utf8').match(/<version>([^<]+)<\/version>/);
    if (m) return m[1];
  }
  const pkg = loadJson(path.join(root, 'frontend/package.json')) || loadJson(path.join(root, 'package.json'));
  if (pkg?.version) return String(pkg.version);
  return 'unknown';
}

const dir = arg('dir');
if (!dir) {
  console.error('Usage: node sync-progress.mjs --dir <audit-out-dir> [--done id1,id2] [--open id] [--note "..."] [--test "..."] [--refresh] [--title "..."] [--app name] [--branch name]');
  process.exit(1);
}

const findingsPath = path.join(dir, 'FINDINGS.json');
const tasksPath = path.join(dir, 'TASKS.md');
const htmlPath = path.join(dir, 'report.html');
const reportPath = path.join(dir, 'REPORT.md');
const metaPath = path.join(dir, 'run-meta.json');

if (!fs.existsSync(findingsPath)) {
  console.error(`Missing ${findingsPath}`);
  process.exit(1);
}

let findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
if (!Array.isArray(findings)) findings = findings.findings ?? [];

const note = arg('note', '');
const testNote = arg('test', '');
const now = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';

function mark(ids, status) {
  const set = new Set(ids.map((s) => s.trim()).filter(Boolean));
  let n = 0;
  for (const f of findings) {
    if (!set.has(f.id)) continue;
    f.status = status;
    if (status === 'DONE') {
      f.blocks_pr = false;
      f.resolved_in = note || f.resolved_in || now;
      if (testNote) f.resolved_test = testNote;
      f.resolved_at = now;
    } else {
      f.resolved_in = null;
      f.resolved_test = null;
      f.resolved_at = null;
    }
    n++;
  }
  return n;
}

const doneArg = arg('done', '');
const openArg = arg('open', '');
if (doneArg) {
  const n = mark(doneArg.split(','), 'DONE');
  console.log(`Marked DONE: ${n} id(s)`);
}
if (openArg) {
  const n = mark(openArg.split(','), 'OPEN');
  console.log(`Marked OPEN: ${n} id(s)`);
}

// ensure status field
for (const f of findings) {
  if (!f.status) f.status = 'OPEN';
}

const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const prioOf = (f) => {
  if (f.severity === 'CRITICAL' || (f.severity === 'HIGH' && f.confidence === 'high')) return 'P0';
  if (f.severity === 'HIGH') return 'P1';
  if (f.severity === 'MEDIUM') return 'P2';
  return 'P3';
};

findings.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9) || a.id.localeCompare(b.id));

const done = findings.filter((f) => f.status === 'DONE');
const open = findings.filter((f) => f.status !== 'DONE');
const pct = findings.length ? Math.round((done.length / findings.length) * 100) : 0;
const complete = open.length === 0 && findings.length > 0;

// Write FINDINGS
fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2) + '\n');

// Build TASKS.md
const byPrio = { P0: [], P1: [], P2: [], P3: [] };
for (const f of findings) byPrio[prioOf(f)].push(f);

// Resolve app + branch (CLI > run-meta > git/manifests)
const gitRoot = sh('git rev-parse --show-toplevel') || process.cwd();
const prevMeta = loadJson(metaPath) || {};
const appName =
  arg('app') ||
  prevMeta.app ||
  prevMeta.app_name ||
  prevMeta.project ||
  detectAppName(gitRoot);
const branchName =
  arg('branch') ||
  prevMeta.branch ||
  prevMeta.git_branch ||
  sh('git rev-parse --abbrev-ref HEAD', gitRoot) ||
  'unknown-branch';
let headSha = prevMeta.head || prevMeta.sha || prevMeta.commit || '';
if (!headSha || headSha === 'HEAD' || headSha === 'head') {
  headSha = sh('git rev-parse --short HEAD', gitRoot) || '';
}
const appVersion = arg('version') || detectVersion(gitRoot, prevMeta);
const runMode = prevMeta.mode || arg('mode', 'full');
const runMeta = {
  ...prevMeta,
  app: appName,
  branch: branchName,
  head: headSha,
  version: appVersion,
  mode: runMode,
  root: prevMeta.root || gitRoot,
  updated_at: now,
};
fs.writeFileSync(metaPath, JSON.stringify(runMeta, null, 2) + '\n');

const lines = [];
lines.push(`# TASKS — Ultra-Deep Audit`);
lines.push('');
lines.push(`> Auto-gerado por \`sync-progress.mjs\` · **não editar IDs à mão** — use \`--done\` / \`--open\`.`);
lines.push('');
lines.push(`| Field | Value |`);
lines.push(`|-------|------:|`);
lines.push(`| **App** | \`${appName}\` |`);
lines.push(`| **Version** | \`${appVersion}\` |`);
lines.push(`| **Branch** | \`${branchName}\`${headSha ? ` @ \`${headSha}\`` : ''} |`);
lines.push(`| Mode | ${runMode} |`);
lines.push(`| Total | ${findings.length} |`);
lines.push(`| DONE | ${done.length} |`);
lines.push(`| OPEN | ${open.length} |`);
lines.push(`| Progress | **${pct}%** |`);
lines.push(`| Complete | ${complete ? '✅ YES' : '❌ NO'} |`);
lines.push(`| Updated | ${now} |`);
lines.push('');
lines.push(`## Iteration log`);
lines.push('');
// preserve previous log if exists
let prevLog = [];
if (fs.existsSync(tasksPath)) {
  const prev = fs.readFileSync(tasksPath, 'utf8');
  const m = prev.match(/## Iteration log\n\n([\s\S]*?)(?=\n## Tasks by priority|\n## |\z)/);
  if (m) {
    prevLog = m[1].trim().split('\n').filter((l) => l.startsWith('- '));
  }
}
if (doneArg || openArg || note) {
  const parts = [`- **${now}**`];
  if (doneArg) parts.push(`DONE \`${doneArg}\``);
  if (openArg) parts.push(`OPEN \`${openArg}\``);
  if (note) parts.push(`— ${note}`);
  if (testNote) parts.push(`(test: \`${testNote}\`)`);
  prevLog.unshift(parts.join(' '));
}
if (!prevLog.length) {
  prevLog.push(`- **${now}** — TASKS.md created from FINDINGS.json`);
}
lines.push(...prevLog.slice(0, 50));
lines.push('');
lines.push(`## Tasks by priority`);
lines.push('');
lines.push(`Checkbox = status. Oracle marca DONE só após **teste red→green**.`);
lines.push('');

for (const p of ['P0', 'P1', 'P2', 'P3']) {
  const items = byPrio[p];
  const d = items.filter((f) => f.status === 'DONE').length;
  lines.push(`### ${p} (${d}/${items.length} done)`);
  lines.push('');
  if (!items.length) {
    lines.push('_none_');
    lines.push('');
    continue;
  }
  for (const f of items) {
    const box = f.status === 'DONE' ? '[x]' : '[ ]';
    const test = f.test_red_green?.name ? ` · test: \`${f.test_red_green.name}\`` : '';
    const res = f.resolved_in ? ` · _${f.resolved_in}_` : '';
    lines.push(`- ${box} **${f.id}** (${f.agent}/${f.severity}) — ${f.title}`);
    lines.push(`  - \`${f.path || '?'}${f.line != null ? ':' + f.line : ''}\`${test}${res}`);
  }
  lines.push('');
}

lines.push(`## Still OPEN`);
lines.push('');
if (!open.length) {
  lines.push('_All tasks complete._ 🎉');
} else {
  for (const f of open) {
    lines.push(`- **${f.id}** — ${f.title}`);
  }
}
lines.push('');
lines.push(`## Workflow (cada iteração)`);
lines.push('');
lines.push('```bash');
lines.push('# 1) Implement fix + red→green test');
lines.push('# 2) Mark done:');
lines.push(`node "$SKILL_ROOT/scripts/sync-progress.mjs" \\`);
lines.push(`  --dir ${dir} \\`);
lines.push(`  --done ID1,ID2 \\`);
lines.push(`  --note "PR #N / commit sha" \\`);
lines.push(`  --test "ClassName#method"`);
lines.push('# 3) HTML + TASKS atualizados automaticamente');
lines.push('# 4) Quando OPEN=0, report.html título vira COMPLETE');
lines.push('```');
lines.push('');

if (complete) {
  lines.push(`## ✅ AUDIT COMPLETE`);
  lines.push('');
  lines.push(`All ${findings.length} findings marked DONE. HTML regenerated as complete.`);
  lines.push('');
}

fs.writeFileSync(tasksPath, lines.join('\n'));
console.log(`Wrote ${tasksPath} (${pct}% · ${done.length}/${findings.length} DONE)`);

// Regenerate HTML via build-report.mjs
const buildScript = path.join(__dirname, 'build-report.mjs');
const titleBase =
  arg('title') ||
  `Ultra-Deep Quality Audit — ${appName} v${appVersion} (${branchName})`;
const title = complete
  ? `${titleBase} ✅ COMPLETE (100%)`
  : `${titleBase} (${done.length} DONE / ${open.length} OPEN · ${pct}%)`;

const depsLatest = path.join(dir, 'deps-latest.json');
const stackJson = path.join(dir, 'stack.json');
const buildArgs = [
  buildScript,
  '--findings',
  findingsPath,
  '--out',
  htmlPath,
  '--title',
  title,
  '--mode',
  runMode,
  '--meta',
  metaPath,
  '--app',
  appName,
  '--branch',
  branchName,
  '--version',
  appVersion,
  '--root',
  gitRoot,
];
if (fs.existsSync(depsLatest)) buildArgs.push('--deps', depsLatest);
if (fs.existsSync(stackJson)) buildArgs.push('--stack', stackJson);

const r = spawnSync(process.execPath, buildArgs, { encoding: 'utf8' });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) {
  console.error('build-report failed');
  process.exit(r.status || 1);
}

// Full REPORT.md + ROADMAP.md (identity + stack + deps research + waves)
const mdScript = path.join(__dirname, 'write-pack-markdown.mjs');
if (fs.existsSync(mdScript)) {
  const mdArgs = [
    mdScript,
    '--dir',
    dir,
    '--app',
    appName,
    '--branch',
    branchName,
    '--version',
    appVersion,
  ];
  const md = spawnSync(process.execPath, mdArgs, { encoding: 'utf8' });
  if (md.stdout) process.stdout.write(md.stdout);
  if (md.stderr) process.stderr.write(md.stderr);
  if (md.status !== 0) {
    console.error('write-pack-markdown failed');
    process.exit(md.status || 1);
  }
} else if (fs.existsSync(reportPath)) {
  // fallback light banner
  let rep = fs.readFileSync(reportPath, 'utf8');
  const identity = `> **App:** \`${appName}\` · **Version:** \`${appVersion}\` · **Branch:** \`${branchName}\`${headSha ? ` @ \`${headSha}\`` : ''} · **Mode:** ${runMode}\n>\n`;
  const banner = `${identity}> **Progress:** ${done.length}/${findings.length} DONE (${pct}%) · OPEN ${open.length} · updated ${now}${complete ? ' · ✅ COMPLETE' : ''}\n\n`;
  if (/^> \*\*App:\*\*/m.test(rep) || rep.startsWith('> **Progress:**')) {
    rep = rep.replace(/^(?:> \*\*(?:App|Progress|Version):\*\*[^\n]*\n)+(?:>\n)?> \*\*Progress:\*\*[^\n]*\n\n/m, banner);
    if (!rep.includes(`**App:** \`${appName}\``)) {
      rep = rep.replace(/^> \*\*Progress:\*\*[^\n]*\n\n/, banner);
    }
  } else {
    rep = rep.replace(/^(#[^\n]*\n\n)/, `$1${banner}`);
  }
  fs.writeFileSync(reportPath, rep);
}

console.log(complete ? '✅ ALL TASKS COMPLETE — HTML updated' : `OPEN remaining: ${open.map((f) => f.id).join(', ')}`);

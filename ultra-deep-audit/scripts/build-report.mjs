#!/usr/bin/env node
/**
 * build-report.mjs — gera HTML interativo a partir de FINDINGS.json (SDD-17)
 *
 * Usage:
 *   node build-report.mjs --findings path/to/FINDINGS.json --out path/to/report.html \
 *     [--title "Ultra-Deep Audit"] [--mode delta|full] \
 *     [--deps path/to/deps-latest.json] [--stack path/to/stack.json] \
 *     [--meta path/to/run-meta.json] [--app name] [--branch name] [--version ver] [--root .]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const findingsPath = arg('findings');
const outPath = arg('out', 'report.html');
const title = arg('title', 'Ultra-Deep Quality Audit');
const mode = arg('mode', 'delta');
const depsPath = arg('deps', '');
const stackPath = arg('stack', '');
const metaPathArg = arg('meta', '');
const appArg = arg('app', '');
const branchArg = arg('branch', '');
const versionArg = arg('version', '');
const rootArg = arg('root', '');

if (!findingsPath) {
  console.error('Missing --findings');
  process.exit(1);
}

const raw = fs.readFileSync(findingsPath, 'utf8');
let findings = JSON.parse(raw);
if (!Array.isArray(findings)) {
  findings = findings.findings ?? [];
}
for (const finding of findings) {
  if (finding.line != null && (!Number.isSafeInteger(finding.line) || finding.line < 0)) {
    throw new TypeError('Finding line must be a non-negative safe integer when provided');
  }
}

function loadJson(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
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

function detectAppName(root) {
  const pkg = loadJson(path.join(root, 'package.json'));
  if (pkg?.name) return String(pkg.name).replace(/^@[^/]+\//, '');
  for (const rel of ['Package.swift', 'Bundler.toml', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'settings.gradle', 'settings.gradle.kts', 'Makefile']) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    if (rel === 'go.mod') {
      const m = fs.readFileSync(p, 'utf8').match(/^module\s+(\S+)/m);
      if (m) return m[1].split('/').pop();
    }
    if (rel === 'Cargo.toml' || rel === 'pyproject.toml' || rel === 'Bundler.toml') {
      const m = fs.readFileSync(p, 'utf8').match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (m) return m[1];
    }
    if (rel === 'Package.swift') {
      const m = fs.readFileSync(p, 'utf8').match(/name:\s*"([^"]+)"/);
      if (m) return m[1];
    }
    if (rel === 'Makefile') {
      const m = fs.readFileSync(p, 'utf8').match(/^PROJECT\s*[?:]?=\s*(\S+)/m)
        || fs.readFileSync(p, 'utf8').match(/^APP_NAME\s*[?:]?=\s*(\S+)/m)
        || fs.readFileSync(p, 'utf8').match(/^NAME\s*[?:]?=\s*(\S+)/m);
      if (m) return m[1];
    }
  }
  return path.basename(path.resolve(root));
}

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

// Auto-discover deps-latest.json / stack.json / run-meta.json next to FINDINGS
const findingsDir = path.dirname(path.resolve(findingsPath));
const depsDoc =
  loadJson(depsPath) ||
  loadJson(path.join(findingsDir, 'deps-latest.json')) ||
  null;
const stackDoc =
  loadJson(stackPath) ||
  loadJson(path.join(findingsDir, 'stack.json')) ||
  depsDoc?.stack ||
  null;
const metaDoc =
  loadJson(metaPathArg) ||
  loadJson(path.join(findingsDir, 'run-meta.json')) ||
  {};

const repoRoot = path.resolve(
  rootArg || metaDoc.root || metaDoc.repo_root || path.join(findingsDir, '../../..'),
);
// Prefer explicit cwd if it looks like a git root when default walk-up is wrong
const gitRoot = sh('git rev-parse --show-toplevel', process.cwd()) || sh('git rev-parse --show-toplevel', repoRoot);
const resolveRoot = gitRoot || (fs.existsSync(path.join(process.cwd(), '.git')) ? process.cwd() : repoRoot);

const appName =
  appArg ||
  metaDoc.app ||
  metaDoc.app_name ||
  metaDoc.project ||
  metaDoc.project_name ||
  detectAppName(resolveRoot) ||
  'unknown-app';

const branchName =
  branchArg ||
  metaDoc.branch ||
  metaDoc.git_branch ||
  sh('git rev-parse --abbrev-ref HEAD', resolveRoot) ||
  'unknown-branch';

const headSha =
  metaDoc.head ||
  metaDoc.sha ||
  metaDoc.commit ||
  sh('git rev-parse --short HEAD', resolveRoot) ||
  '';

const appVersion = versionArg || detectVersion(resolveRoot, metaDoc);

const runMeta = {
  ...metaDoc,
  app: appName,
  branch: branchName,
  head: headSha,
  version: appVersion,
  mode: metaDoc.mode || mode,
  root: metaDoc.root || resolveRoot,
};

const agents = {
  Atlas: { emoji: '🏛️', color: '#6366f1', blurb: 'Architecture / layer boundaries' },
  Sentinel: { emoji: '🛡️', color: '#ef4444', blurb: 'Security / Authz (fast|deep panel)' },
  Nexus: { emoji: '⚡', color: '#f59e0b', blurb: 'N+1 / Performance' },
  Hermes: { emoji: '⚔️', color: '#8b5cf6', blurb: 'Race / PBT' },
  Hydra: { emoji: '🐉', color: '#06b6d4', blurb: 'Leak / Backpressure' },
  Forge: { emoji: '🔨', color: '#84cc16', blurb: 'Residual dirty code / quality guild' },
  Daedalus: { emoji: '🧩', color: '#a3e635', blurb: 'Cyclomatic / cognitive complexity' },
  Echo: { emoji: '🔁', color: '#22d3ee', blurb: 'Duplicate code (T1–T4)' },
  Laconic: { emoji: '✂️', color: '#eab308', blurb: 'Verbosity / noise' },
  Mentor: { emoji: '📚', color: '#c084fc', blurb: 'Clean Code / patterns / BP' },
  Prism: { emoji: '💎', color: '#ec4899', blurb: 'Deps / CVE / latest stable' },
  Argus: { emoji: '👁️', color: '#14b8a6', blurb: 'Test quality' },
  Artemis: { emoji: '🏹', color: '#f97316', blurb: 'Caça-bugs / classic correctness' },
  Oracle: { emoji: '🔮', color: '#a855f7', blurb: 'Report / Roadmap' },
};

const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const sevColor = {
  CRITICAL: '#7f1d1d',
  HIGH: '#dc2626',
  MEDIUM: '#d97706',
  LOW: '#64748b',
};

function roadmapBucket(f) {
  if (f.severity === 'CRITICAL' || (f.severity === 'HIGH' && f.confidence === 'high')) return 'P0';
  if (f.severity === 'HIGH') return 'P1';
  if (f.severity === 'MEDIUM') return 'P2';
  return 'P3';
}

function implementationStatus(f) {
  const raw = String(f.status || 'open').toLowerCase();
  if (raw === 'done' || raw === 'resolved') return 'RESOLVED';
  if (raw === 'refuted') return 'REFUTED';
  if (raw === 'accepted' || raw === 'accept') return 'ACCEPTED';
  if (f.in_progress) return 'IN_PROGRESS';
  return 'OPEN';
}

function isClosedImplementationStatus(status) {
  return status === 'RESOLVED' || status === 'REFUTED' || status === 'ACCEPTED';
}

const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: findings.length, blocks: 0, done: 0, open: 0 };
const byAgent = {};
for (const f of findings) {
  counts[f.severity] = (counts[f.severity] || 0) + 1;
  if (f.blocks_pr) counts.blocks++;
  byAgent[f.agent] = (byAgent[f.agent] || 0) + 1;
  f._prio = roadmapBucket(f);
  f.status = f.status || 'open';
  f._implementation_status = implementationStatus(f);
  if (isClosedImplementationStatus(f._implementation_status)) counts.done++;
  else counts.open++;
}

findings.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

const dataJson = JSON.stringify(findings).replace(/</g, '\\u003c');
const depsJson = JSON.stringify(depsDoc || null).replace(/</g, '\\u003c');
const stackJson = JSON.stringify(stackDoc || null).replace(/</g, '\\u003c');
const metaJson = JSON.stringify(runMeta).replace(/</g, '\\u003c');
const generatedAt = new Date().toISOString();
const pageTitle = appName && appName !== 'unknown-app'
  ? `${appName} · ${title}`
  : title;
const headShort = headSha ? ` · <code>${escapeHtml(headSha)}</code>` : '';

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(pageTitle)}</title>
<style>
  :root {
    --bg: #0b1220;
    --panel: #111827;
    --panel2: #1f2937;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --border: #374151;
    --accent: #38bdf8;
    --ok: #22c55e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #1e3a5f 0%, transparent 50%),
                radial-gradient(900px 500px at 100% 0%, #3b0764 0%, transparent 45%),
                var(--bg);
    color: var(--text); min-height: 100vh;
  }
  header {
    padding: 1.5rem 2rem; border-bottom: 1px solid var(--border);
    backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 20;
    background: rgba(11,18,32,.85);
  }
  header h1 { margin: 0 0 .25rem; font-size: 1.5rem; letter-spacing: -.02em; }
  header .app-line {
    display: flex; flex-wrap: wrap; gap: .5rem .75rem; align-items: center;
    margin: 0 0 .55rem; font-size: .95rem;
  }
  header .pill {
    display: inline-flex; align-items: center; gap: .35rem;
    background: var(--panel2); border: 1px solid var(--border);
    border-radius: 999px; padding: .2rem .65rem; font-size: .8rem;
    color: var(--text);
  }
  header .pill strong { color: var(--accent); font-weight: 600; }
  header .pill code { font-size: .78rem; color: #fde68a; }
  header .meta { color: var(--muted); font-size: .875rem; }
  .layout { display: grid; grid-template-columns: 280px 1fr; gap: 0; min-height: calc(100vh - 88px); }
  @media (max-width: 960px) { .layout { grid-template-columns: 1fr; } aside { border-right: none !important; border-bottom: 1px solid var(--border); } }
  aside { border-right: 1px solid var(--border); padding: 1rem; background: rgba(17,24,39,.6); }
  main { padding: 1rem 1.25rem 3rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: .75rem; margin-bottom: 1rem; }
  .card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: .85rem; text-align: center;
  }
  .card .n { font-size: 1.6rem; font-weight: 700; }
  .card .l { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .filters { display: flex; flex-direction: column; gap: .75rem; }
  .filters label { font-size: .75rem; color: var(--muted); display: block; margin-bottom: .25rem; }
  select, input[type="search"] {
    width: 100%; background: var(--panel2); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: .5rem .65rem; font-size: .875rem;
  }
  .agent-list { display: flex; flex-direction: column; gap: .35rem; margin-top: .5rem; }
  .agent-chip {
    display: flex; align-items: center; gap: .5rem; padding: .4rem .55rem; border-radius: 8px;
    border: 1px solid transparent; cursor: pointer; background: transparent; color: inherit; text-align: left;
  }
  .agent-chip:hover, .agent-chip.active { background: var(--panel2); border-color: var(--border); }
  .agent-chip .dot { width: 10px; height: 10px; border-radius: 50%; }
  .agent-chip .count { margin-left: auto; font-size: .75rem; color: var(--muted); }
  .toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
  .btn {
    background: var(--panel2); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: .4rem .75rem; font-size: .8rem; cursor: pointer;
  }
  .btn:hover { border-color: var(--accent); }
  .btn.primary { background: #0ea5e9; border-color: #0284c7; color: #04111a; font-weight: 600; }
  .tabs { display: flex; gap: .35rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .tab {
    padding: .45rem .9rem; border-radius: 999px; border: 1px solid var(--border);
    background: transparent; color: var(--muted); cursor: pointer; font-size: .8rem;
  }
  .tab.active { background: var(--accent); color: #042f2e; border-color: transparent; font-weight: 600; }
  .finding {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: 1rem 1.1rem; margin-bottom: .75rem; transition: border-color .15s;
  }
  .finding:hover { border-color: #4b5563; }
  .finding header-row { display: contents; }
  .finding .top { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: .5rem; }
  .badge {
    font-size: .65rem; font-weight: 700; letter-spacing: .04em; padding: .2rem .45rem;
    border-radius: 6px; color: #fff; text-transform: uppercase;
  }
  .badge.prio { background: #334155; }
  .finding h3 { margin: 0; font-size: 1rem; flex: 1 1 auto; min-width: 200px; }
  .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; color: var(--accent); }
  .evidence {
    margin: .65rem 0; padding: .65rem .75rem; background: #0a0f1a; border-radius: 8px;
    font-family: ui-monospace, Menlo, monospace; font-size: .75rem; color: #cbd5e1;
    white-space: pre-wrap; border-left: 3px solid var(--border);
  }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
  .box { background: var(--panel2); border-radius: 8px; padding: .65rem .75rem; font-size: .85rem; }
  .box h4 { margin: 0 0 .35rem; font-size: .7rem; text-transform: uppercase; color: var(--muted); letter-spacing: .05em; }
  .empty { text-align: center; padding: 3rem; color: var(--muted); }
  .roadmap-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: .75rem; }
  .prio-col {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: .85rem;
  }
  .prio-col h3 { margin: 0 0 .65rem; font-size: .95rem; }
  .prio-item {
    font-size: .8rem; padding: .45rem 0; border-bottom: 1px solid var(--border); cursor: pointer;
  }
  .prio-item:last-child { border-bottom: none; }
  .agents-board { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: .75rem; }
  .agent-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 1rem;
    border-top: 3px solid var(--accent);
  }
  .agent-card h3 { margin: 0 0 .25rem; font-size: 1rem; }
  .agent-card p { margin: 0; color: var(--muted); font-size: .8rem; }
  footer { padding: 1rem 2rem; color: var(--muted); font-size: .75rem; border-top: 1px solid var(--border); }
  .legend { font-size: .75rem; color: var(--muted); line-height: 1.5; margin-top: 1rem; }
  kbd { background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; padding: 0 .3rem; font-size: .7rem; }
  .chip-row { display: flex; flex-wrap: wrap; gap: .35rem; margin: .5rem 0 1rem; }
  .chip {
    font-size: .72rem; padding: .25rem .55rem; border-radius: 999px;
    background: var(--panel2); border: 1px solid var(--border); color: var(--text);
  }
  .chip.fw { border-color: #7c3aed; color: #ddd6fe; }
  .chip.lang { border-color: #0284c7; color: #bae6fd; }
  .chip.eco { border-color: #059669; color: #a7f3d0; }
  table.deps {
    width: 100%; border-collapse: collapse; font-size: .82rem; margin: .5rem 0 1.25rem;
  }
  table.deps th, table.deps td {
    border-bottom: 1px solid var(--border); padding: .45rem .5rem; text-align: left; vertical-align: top;
  }
  table.deps th { color: var(--muted); font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; }
  table.deps tr:hover td { background: rgba(31,41,55,.5); }
  .bump-major { color: #fbbf24; font-weight: 700; }
  .bump-minor { color: #38bdf8; font-weight: 600; }
  .bump-patch { color: #94a3b8; }
  .cmd {
    font-family: ui-monospace, Menlo, monospace; font-size: .72rem; color: #86efac;
    background: #0a0f1a; padding: .35rem .5rem; border-radius: 6px; display: block; white-space: pre-wrap;
  }
  .batch {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: .85rem 1rem; margin-bottom: .75rem;
  }
  .batch h4 { margin: 0 0 .35rem; font-size: .95rem; }
  .muted { color: var(--muted); font-size: .8rem; }
  .arrow { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="app-line" aria-label="Target application, version and branch">
    <span class="pill">App <strong>${escapeHtml(appName)}</strong></span>
    <span class="pill">Version <code>${escapeHtml(appVersion)}</code></span>
    <span class="pill">Branch <code>${escapeHtml(branchName)}</code>${headShort}</span>
    <span class="pill">Mode <strong>${escapeHtml(runMeta.mode || mode)}</strong></span>
  </div>
  <div class="meta">
    Generated: ${generatedAt} ·
    SDD-17 · Skill <code>ultra-deep-audit</code> ·
    Agents: Atlas · Sentinel · Nexus · Hermes · Hydra · Daedalus · Echo · Laconic · Mentor · Forge · Prism · Argus · Artemis · Oracle
  </div>
</header>
<div class="layout">
  <aside>
    <div class="filters">
      <div>
        <label>Busca / Search</label>
        <input type="search" id="q" placeholder="id, path, title…"/>
      </div>
      <div>
        <label>Severidade / Severity</label>
        <select id="sev">
          <option value="">Todas / All</option>
          <option>CRITICAL</option>
          <option>HIGH</option>
          <option>MEDIUM</option>
          <option>LOW</option>
        </select>
      </div>
      <div>
        <label>Prioridade / Roadmap priority</label>
        <select id="prio">
          <option value="">Todas / All</option>
          <option>P0</option>
          <option>P1</option>
          <option>P2</option>
          <option>P3</option>
        </select>
      </div>
      <div>
        <label>Confiança / Confidence</label>
        <select id="conf">
          <option value="">Todas / All</option>
          <option>high</option>
          <option>medium</option>
          <option>low</option>
        </select>
      </div>
      <div>
        <label>Status implementação / Implementation</label>
        <select id="status">
          <option value="">Todos / All</option>
          <option value="OPEN">OPEN</option>
          <option value="IN_PROGRESS">IN PROGRESS</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="REFUTED">REFUTED</option>
          <option value="ACCEPTED">ACCEPTED</option>
        </select>
      </div>
      <div>
        <label>Bloqueia PR / PR-blocking</label>
        <select id="blocks">
          <option value="">Todos / All</option>
          <option value="1">Sim / Yes</option>
        </select>
      </div>
      <div>
        <label>Agentes / Agents</label>
        <div class="agent-list" id="agentList"></div>
      </div>
      <p class="legend">
        <strong>Red→green:</strong> cada fix precisa de teste que falha antes e passa depois. / Each fix requires a test that fails before and passes after.<br/>
        Atalhos / Shortcuts: <kbd>/</kbd> ${'foca busca / focus search'}.
      </p>
    </div>
  </aside>
  <main>
    <div class="cards" id="cards"></div>
    <div class="tabs">
      <button class="tab active" data-view="findings">Findings</button>
      <button class="tab" data-view="deps">Libs / Updates</button>
      <button class="tab" data-view="roadmap">Roadmap</button>
      <button class="tab" data-view="agents">Agentes / Agents</button>
      <button class="tab" data-view="flow">Fluxo / Flow</button>
    </div>
    <div class="toolbar">
      <button class="btn" id="expandAll">Expandir / Expand</button>
      <button class="btn" id="collapseAll">Colapsar / Collapse</button>
      <button class="btn primary" id="exportJson">Export JSON filtrado / Filtered</button>
      <button class="btn" id="exportDeps" ${depsDoc ? '' : 'hidden'}>Export deps map</button>
      <span id="shown" class="meta" style="margin-left:auto"></span>
    </div>
    <div id="view-findings"></div>
    <div id="view-deps" hidden></div>
    <div id="view-roadmap" hidden></div>
    <div id="view-agents" hidden></div>
    <div id="view-flow" hidden></div>
  </main>
</div>
<footer>
  Ultra-Deep Quality Audit · Sentinel deep + Artemis Caça-bugs + Prism latest-stable ·
  Cada etapa é dona de um agente nomeado · Oracle compõe este relatório.<br/>
  Each stage is owned by a named agent · Oracle composes this report.
</footer>
<script>
const FINDINGS = ${dataJson};
const DEPS = ${depsJson};
const STACK = ${stackJson};
const AGENTS = ${JSON.stringify(agents)};
const SEV_COLOR = ${JSON.stringify(sevColor)};
const STATUS_COLOR = { OPEN:'#ca8a04', IN_PROGRESS:'#0284c7', RESOLVED:'#16a34a', REFUTED:'#64748b', ACCEPTED:'#7c3aed' };

const state = { agent: '', sev: '', prio: '', conf: '', status: '', blocks: '', q: '' };

function $(id) { return document.getElementById(id); }

function renderCards() {
  const c = { CRITICAL:0, HIGH:0, MEDIUM:0, LOW:0, blocks:0 };
  for (const f of FINDINGS) {
    c[f.severity] = (c[f.severity]||0)+1;
    if (f.blocks_pr) c.blocks++;
  }
  const resolved = FINDINGS.filter(f => f._implementation_status === 'RESOLVED').length;
  const inProgress = FINDINGS.filter(f => f._implementation_status === 'IN_PROGRESS').length;
  const refuted = FINDINGS.filter(f => f._implementation_status === 'REFUTED').length;
  const accepted = FINDINGS.filter(f => f._implementation_status === 'ACCEPTED').length;
  const open = FINDINGS.filter(f => f._implementation_status === 'OPEN').length;
  $('cards').innerHTML = [
    ['Total', FINDINGS.length, '#38bdf8'],
    ['Resolved', resolved, '#22c55e'],
    ['In progress', inProgress, '#0284c7'],
    ['Refuted', refuted, '#64748b'],
    ['Accepted', accepted, '#7c3aed'],
    ['OPEN', open, '#f59e0b'],
    ['Critical', c.CRITICAL, SEV_COLOR.CRITICAL],
    ['High', c.HIGH, SEV_COLOR.HIGH],
    ['Medium', c.MEDIUM, SEV_COLOR.MEDIUM],
    ['Low', c.LOW, SEV_COLOR.LOW],
    ['Blocks PR', c.blocks, '#f43f5e'],
  ].map(([l,n,color]) =>
    \`<div class="card"><div class="n" style="color:\${color}">\${n}</div><div class="l">\${l}</div></div>\`
  ).join('');
}

function renderAgentList() {
  const counts = {};
  for (const f of FINDINGS) counts[f.agent] = (counts[f.agent]||0)+1;
  const names = Object.keys(AGENTS);
  $('agentList').innerHTML = names.map(name => {
    const a = AGENTS[name];
    const active = state.agent === name ? 'active' : '';
    return \`<button type="button" class="agent-chip \${active}" data-agent="\${name}">
      <span class="dot" style="background:\${a.color}"></span>
      <span>\${a.emoji} \${name}</span>
      <span class="count">\${counts[name]||0}</span>
    </button>\`;
  }).join('');
  $('agentList').querySelectorAll('.agent-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.agent = state.agent === btn.dataset.agent ? '' : btn.dataset.agent;
      renderAgentList();
      renderFindings();
    });
  });
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return FINDINGS.filter(f => {
    if (state.agent && f.agent !== state.agent) return false;
    if (state.sev && f.severity !== state.sev) return false;
    if (state.prio && f._prio !== state.prio) return false;
    if (state.conf && f.confidence !== state.conf) return false;
    if (state.status && f._implementation_status !== state.status) return false;
    if (state.blocks === '1' && !f.blocks_pr) return false;
    if (q) {
      const hay = [f.id, f.title, f.path, f.evidence, f.fix, f.impact, f.domain, f.agent,
        f.category, f.classic_pattern, f.language, f.exploit_scenario, f.failure_scenario]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFindings() {
  const list = filtered();
  $('shown').textContent = list.length + ' / ' + FINDINGS.length + ' findings';
  if (!list.length) {
    $('view-findings').innerHTML = '<div class="empty">Nenhum finding / No findings with current filters.</div>';
    return;
  }
  $('view-findings').innerHTML = list.map(f => {
    const a = AGENTS[f.agent] || { emoji: '•', color: '#64748b' };
    const tr = f.test_red_green || {};
    return \`
<article class="finding" id="f-\${esc(f.id)}" data-id="\${esc(f.id)}">
  <div class="top">
    <span class="badge" style="background:\${SEV_COLOR[f.severity]||'#64748b'}">\${esc(f.severity)}</span>
    <span class="badge" style="background:\${STATUS_COLOR[f._implementation_status]||'#ca8a04'}">\${esc(f._implementation_status)}</span>
    <span class="badge prio">\${esc(f._prio)}</span>
    <span class="badge" style="background:\${a.color}">\${a.emoji} \${esc(f.agent)}</span>
    \${f.blocks_pr ? '<span class="badge" style="background:#f43f5e">BLOCKS PR</span>' : ''}
    <span class="badge prio">\${esc(f.confidence||'?')} conf</span>
    \${f.verification === 'panel' ? '<span class="badge" style="background:#b91c1c">PANEL '+(f.panel?esc(f.panel.true)+'/'+esc(f.panel.voters):'')+'</span>' : ''}
    \${f.classic_pattern ? '<span class="badge" style="background:#c2410c">'+esc(f.classic_pattern)+'</span>' : ''}
    \${f.category ? '<span class="badge prio">'+esc(f.category)+'</span>' : ''}
    <h3>\${esc(f.id)} — \${esc(f.title)}</h3>
  </div>
  <div class="path">\${esc(f.path||'')}\${f.line != null ? ':'+esc(f.line) : ''}</div>
  <div class="evidence">\${esc(f.evidence||f.description||'')}</div>
  \${f.exploit_scenario ? '<div class="box" style="margin-top:.5rem"><h4>Exploit scenario</h4>'+esc(f.exploit_scenario)+'</div>' : ''}
  \${f.failure_scenario ? '<div class="box" style="margin-top:.5rem"><h4>Failure scenario</h4>'+esc(f.failure_scenario)+'</div>' : ''}
  <div class="grid2">
    <div class="box"><h4>Impacto / Impact</h4>\${esc(f.impact||'—')}</div>
    <div class="box"><h4>Fix</h4>\${esc(f.fix||'—')}</div>
  </div>
  <div class="box" style="margin-top:.65rem">
    <h4>Teste red → green / Red→green test (obrigatório / required)</h4>
    <div><strong>\${esc(tr.name||'TBD')}</strong></div>
    <div style="margin-top:.35rem;color:#fca5a5">RED: \${esc(tr.assert_before||'—')}</div>
    <div style="color:#86efac">GREEN: \${esc(tr.assert_after||'—')}</div>
  </div>
</article>\`;
  }).join('');
}

function renderRoadmap() {
  const buckets = { P0: [], P1: [], P2: [], P3: [] };
  for (const f of FINDINGS) buckets[f._prio].push(f);
  const titles = {
    P0: 'P0 — mesmo PR / 24h / Same PR / 24h (security, data loss, hot path)',
    P1: 'P1 — sprint atual / Current sprint (N+1 hot, session leak)',
    P2: 'P2 — próximo sprint / Next sprint (MEDIUM)',
    P3: 'P3 — backlog (LOW / polish)',
  };
  $('view-roadmap').innerHTML = \`
    <p class="meta" style="margin-bottom:1rem">
      Roadmap gerado pelo / generated by <strong>Oracle</strong>. Agrupe PRs por domínio / Group PRs by domain (Sentinel / Artemis / Nexus / Hermes / Hydra).
      Toda correção / Every fix: teste RED → fix → GREEN.
    </p>
    <div class="roadmap-col">
      \${Object.keys(buckets).map(p => \`
        <div class="prio-col">
          <h3>\${titles[p]} <span class="meta">(\${buckets[p].length})</span></h3>
          \${buckets[p].length ? buckets[p].map(f =>
            \`<div class="prio-item" data-jump="\${esc(f.id)}">
              <strong>\${esc(f.id)}</strong> · \${esc(f.agent)}<br/>
              \${esc(f.title)}
            </div>\`
          ).join('') : '<div class="meta">Nenhum</div>'}
        </div>
      \`).join('')}
    </div>
    <div class="box" style="margin-top:1rem">
      <h4>PRs sugeridos / Suggested PRs</h4>
      <ol style="margin:.35rem 0 0 1.1rem;padding:0;font-size:.9rem;line-height:1.6">
        <li><strong>PR-SEC</strong> — Sentinel P0/P1 (panel-verified when deep)</li>
        <li><strong>PR-BUG</strong> — Artemis classic bugs (BUG-ART-*)</li>
        <li><strong>PR-N1</strong> — Nexus listagens quentes</li>
        <li><strong>PR-RACE</strong> — Hermes CAS/UNIQUE/PBT</li>
        <li><strong>PR-LEAK</strong> — Hydra blobs/caps/backpressure</li>
        <li><strong>PR-QUALITY</strong> — Daedalus · Echo · Laconic · Mentor · Forge · Atlas · Argus · Prism</li>
      </ol>
    </div>\`;
  $('view-roadmap').querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelector('.tab[data-view="findings"]').click();
      const t = document.getElementById('f-' + el.dataset.jump);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function renderAgents() {
  $('view-agents').innerHTML = \`
    <p class="meta" style="margin-bottom:1rem">Cada etapa do skill é executada por um agente com nome próprio. / Each skill stage is executed by a named agent.</p>
    <div class="agents-board">
      \${Object.entries(AGENTS).map(([name, a]) => \`
        <div class="agent-card" style="border-top-color:\${a.color}">
          <h3>\${a.emoji} \${name}</h3>
          <p>\${a.blurb}</p>
          <p style="margin-top:.5rem">Findings: <strong>\${FINDINGS.filter(f=>f.agent===name).length}</strong></p>
        </div>
      \`).join('')}
    </div>\`;
}

function renderFlow() {
  $('view-flow').innerHTML = \`
    <div class="box">
      <h4>Fluxo pós-implementação / Post-implementation flow (obrigatório / required)</h4>
      <pre style="margin:0;white-space:pre-wrap;font-size:.85rem;line-height:1.55">Implement
  → Tests (0 failures)
  → Oracle inicia modo delta|full
  → Onda A: Atlas ‖ Sentinel ‖ Nexus ‖ Mentor
  → Onda B: Hermes ‖ Hydra ‖ Artemis ‖ Quality Guild (Daedalus ‖ Echo ‖ Laconic ‖ Forge)
  → Onda C: Prism (check-deps-latest) ‖ Argus
  → measure-quality.mjs → quality-metrics.json (CC / clones / verbosity hotspots)
  → Sentinel deep?: cartographer → hunters → panel → sec-verify.mjs
  → merge-findings + sync-progress → HTML/TASKS (aba Libs/Updates)
  → Fix P0 com red→green
  → Docs + graphify update .</pre>
    </div>
    <div class="grid2" style="margin-top:1rem">
      <div class="box">
        <h4>Security deep (Sentinel)</h4>
        Inventory → hunters × lenses → 3-lens refuter panel → <code>sec-verify.mjs</code> quorum 2/3 → only survivors in FINDINGS.
      </div>
      <div class="box">
        <h4>Quality Guild</h4>
        measure-quality → <strong>Daedalus</strong> CC · <strong>Echo</strong> clones · <strong>Laconic</strong> verbosity · <strong>Mentor</strong> Clean Code/patterns · <strong>Forge</strong> residual.
      </div>
      <div class="box">
        <h4>Caça-bugs (Artemis)</h4>
        detect-stack → classic-bugs catalog by language → failure_scenario → BUG-ART-* + red→green.
      </div>
      <div class="box">
        <h4>Deps / latest stable (Prism)</h4>
        detect-stack (Java/Spring/Kotlin/Node/React/Vite/Swift/…) → check-deps-latest → update_map + suggestions no HTML. Só releases stable.
      </div>
      <div class="box">
        <h4>N+1 / Race / Leak</h4>
        Nexus listagens · Hermes CAS/UNIQUE · Hydra caps — ownership exclusiva.
      </div>
    </div>\`;
}

function bumpClass(b) {
  if (b === 'major') return 'bump-major';
  if (b === 'minor') return 'bump-minor';
  return 'bump-patch';
}

function renderDeps() {
  const el = $('view-deps');
  if (!DEPS) {
    el.innerHTML = \`
      <div class="empty">
        Sem <code>deps-latest.json</code> neste pack.<br/>
        Rode <code>check-deps-latest.mjs</code> na Onda C (Prism) e regenere o HTML.
      </div>\`;
    return;
  }
  const sum = DEPS.summary || {};
  const stack = DEPS.stack || STACK || {};
  const um = DEPS.update_map || {};
  const suggestions = um.suggestions || [];
  const batches = um.batches || [];
  const byEco = um.by_ecosystem || sum.by_ecosystem || {};

  const chips = [];
  for (const l of (stack.languages || sum.languages || [])) chips.push(\`<span class="chip lang">\${esc(l)}</span>\`);
  for (const f of (stack.frameworks || sum.frameworks || [])) chips.push(\`<span class="chip fw">\${esc(f)}</span>\`);
  for (const e of (stack.ecosystems || Object.keys(byEco))) chips.push(\`<span class="chip eco">\${esc(e)}</span>\`);

  const ecoCards = Object.entries(byEco).map(([eco, info]) => {
    const total = info.total ?? info.checked ?? 0;
    const out = info.outdated ?? 0;
    const ok = info.up_to_date ?? Math.max(0, total - out);
    return \`<div class="card"><div class="n" style="color:\${out ? '#f59e0b' : '#22c55e'}">\${esc(out)}/\${esc(total)}</div><div class="l">\${esc(eco)} outdated</div><div class="muted" style="margin-top:.25rem">\${esc(ok)} ok</div></div>\`;
  }).join('');

  const tableRows = suggestions.map(s => \`
    <tr>
      <td><code>\${esc(s.package)}</code><div class="muted">\${esc(s.ecosystem)} · \${esc(s.manifest || '')}</div></td>
      <td>\${esc(s.from)}</td>
      <td class="arrow">→</td>
      <td><strong>\${esc(s.to)}</strong></td>
      <td class="\${bumpClass(s.bump)}">\${esc(s.bump)}</td>
      <td>\${(s.frameworks || []).map(f => '<span class="chip fw">'+esc(f)+'</span>').join(' ') || '—'}</td>
      <td><span class="chip">\${esc(s.priority || '')}</span> \${esc(s.action || '')}<div class="cmd" style="margin-top:.35rem">\${esc(s.command_hint || s.notes || '')}</div></td>
    </tr>\`).join('');

  const batchHtml = batches.map(b => \`
    <div class="batch">
      <h4>\${esc(b.title)} <span class="chip">\${esc(b.priority || '')}</span></h4>
      <p class="muted" style="margin:.25rem 0 .5rem">\${esc(b.rationale || '')}</p>
      \${(b.packages || []).length ? '<div class="chip-row">' + b.packages.map(p => '<span class="chip">'+esc(p)+'</span>').join('') + '</div>' : ''}
    </div>\`).join('');

  const allPkgs = (DEPS.packages || []).filter(p => !p.error && !p.skipped);
  const upToDate = allPkgs.filter(p => !p.outdated);

  el.innerHTML = \`
    <p class="meta" style="margin:0 0 .75rem">
      <strong>Prism · latest stable only</strong> (sem beta/rc/canary/snapshot; Docker sem <code>latest</code>/edge).
      Inclui libs <em>e</em> imagens <code>docker-compose</code>. / Includes libraries <em>and</em> Docker Compose images.
      Policy: \${esc((DEPS.policy && DEPS.policy.exclude) || 'stable-only')} ·
      Generated: \${esc(DEPS.generated_at || '')}
    </p>
    <h3 style="margin:.5rem 0 .25rem;font-size:1rem">Stack detectada / Detected stack</h3>
    <div class="chip-row">\${chips.length ? chips.join('') : '<span class="muted">nenhuma</span>'}</div>
    <div class="cards" style="margin-bottom:1rem">
      <div class="card"><div class="n" style="color:#38bdf8">\${esc(sum.checked ?? allPkgs.length)}</div><div class="l">Checked</div></div>
      <div class="card"><div class="n" style="color:#f59e0b">\${esc(sum.outdated ?? suggestions.length)}</div><div class="l">Outdated</div></div>
      <div class="card"><div class="n" style="color:#22c55e">\${esc(sum.up_to_date ?? upToDate.length)}</div><div class="l">Up to date</div></div>
      <div class="card"><div class="n" style="color:#fbbf24">\${esc((sum.by_bump && sum.by_bump.major) || 0)}</div><div class="l">Major</div></div>
      <div class="card"><div class="n" style="color:#38bdf8">\${esc((sum.by_bump && sum.by_bump.minor) || 0)}</div><div class="l">Minor</div></div>
      <div class="card"><div class="n" style="color:#94a3b8">\${esc((sum.by_bump && sum.by_bump.patch) || 0)}</div><div class="l">Patch</div></div>
    </div>
    <h3 style="margin:.5rem 0 .5rem;font-size:1rem">Por ecossistema / By ecosystem</h3>
    <div class="cards">\${ecoCards || '<div class="muted">—</div>'}</div>
    <h3 style="margin:1rem 0 .5rem;font-size:1rem">Mapa de atualizações / Update map & suggestions</h3>
    \${suggestions.length ? \`
    <table class="deps">
      <thead>
        <tr>
          <th>Pacote</th><th>Atual</th><th></th><th>Latest stable</th><th>Bump</th><th>Framework</th><th>Sugestão</th>
        </tr>
      </thead>
      <tbody>\${tableRows}</tbody>
    </table>\` : '<div class="box" style="margin-bottom:1rem">Todas as deps diretas estão no latest stable ✨</div>'}
    <h3 style="margin:1rem 0 .5rem;font-size:1rem">Batches sugeridos / Suggested batches</h3>
    \${batchHtml || '<div class="muted">Nenhum batch</div>'}
    <h3 style="margin:1.25rem 0 .5rem;font-size:1rem">Já atualizadas / Already up to date (amostra / sample)</h3>
    <div class="chip-row">
      \${upToDate.slice(0, 40).map(p => '<span class="chip">'+esc(p.name)+' @ '+esc(p.current || p.latest_stable || '')+'</span>').join('') || '—'}
      \${upToDate.length > 40 ? '<span class="muted">+'+(upToDate.length-40)+' more</span>' : ''}
    </div>
  \`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// wire filters
['sev','prio','conf','status','blocks'].forEach(id => {
  $(id).addEventListener('change', e => { state[id] = e.target.value; renderFindings(); });
});
$('q').addEventListener('input', e => { state.q = e.target.value; renderFindings(); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== $('q')) {
    e.preventDefault(); $('q').focus();
  }
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ['findings','deps','roadmap','agents','flow'].forEach(v => {
      $('view-' + v).hidden = v !== tab.dataset.view;
    });
    if (tab.dataset.view === 'deps') renderDeps();
    if (tab.dataset.view === 'roadmap') renderRoadmap();
    if (tab.dataset.view === 'agents') renderAgents();
    if (tab.dataset.view === 'flow') renderFlow();
  });
});

$('exportJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(filtered(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'findings-filtered.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
const exportDepsBtn = $('exportDeps');
if (exportDepsBtn) {
  exportDepsBtn.addEventListener('click', () => {
    if (!DEPS) return;
    const blob = new Blob([JSON.stringify(DEPS, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'deps-latest.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
$('expandAll').addEventListener('click', () => {
  document.querySelectorAll('.finding .box').forEach(b => b.style.display = '');
});
$('collapseAll').addEventListener('click', () => {
  document.querySelectorAll('.finding .grid2, .finding .box:last-child').forEach(b => {
    b.style.display = b.style.display === 'none' ? '' : 'none';
  });
});

renderCards();
renderAgentList();
renderFindings();
</script>
</body>
</html>`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');

// Persist resolved identity so TASKS/REPORT/re-runs stay consistent
const metaOut = path.join(findingsDir, 'run-meta.json');
try {
  const prev = loadJson(metaOut) || {};
  fs.writeFileSync(
    metaOut,
    JSON.stringify(
      {
        ...prev,
        ...runMeta,
        generated_at: generatedAt,
      },
      null,
      2,
    ) + '\n',
  );
} catch {
  /* best-effort */
}

const depN = depsDoc?.summary?.outdated ?? depsDoc?.update_map?.suggestions?.length ?? 0;
console.log(
  `Wrote ${outPath} (app=${appName} branch=${branchName} · ${findings.length} findings` +
    (depsDoc ? `, deps outdated=${depN}` : ', no deps-latest.json') +
    `)`,
);

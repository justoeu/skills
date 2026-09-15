#!/usr/bin/env node
/**
 * write-pack-markdown.mjs — regenera REPORT.md + ROADMAP.md com identidade + deps
 *
 * Usage:
 *   node write-pack-markdown.mjs --dir Docs/audit/ultra-deep/YYYY-MM-DD-full
 *
 * Lê FINDINGS.json, run-meta.json, deps-latest.json, stack.json.
 * Preserva seções manuais sob `## Notes` se existirem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
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
  const pkg = loadJson(path.join(root, 'package.json'));
  if (pkg?.name) return String(pkg.name).replace(/^@[^/]+\//, '');
  for (const rel of ['backend/pom.xml', 'pom.xml', 'Makefile', 'go.mod']) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8');
    if (rel.endsWith('pom.xml')) {
      const m = t.match(/<artifactId>([^<]+)<\/artifactId>/);
      if (m) return m[1];
    }
    if (rel === 'go.mod') {
      const m = t.match(/^module\s+(\S+)/m);
      if (m) return m[1].split('/').pop();
    }
    if (rel === 'Makefile') {
      const m = t.match(/^(?:PROJECT|APP_NAME|NAME)\s*[?:]?=\s*(\S+)/m);
      if (m) return m[1];
    }
  }
  return path.basename(path.resolve(root));
}

/** Prefer deploy/release version over library module versions. */
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
    if (m && m[1] && m[1] !== 'latest') return m[1].replace(/^v/, '');
  }
  const tag = sh('git describe --tags --abbrev=0', root);
  if (tag) return tag.replace(/^v/, '');
  const pom = path.join(root, 'backend/pom.xml');
  if (fs.existsSync(pom)) {
    const t = fs.readFileSync(pom, 'utf8');
    const m = t.match(/<version>([^<]+)<\/version>/);
    if (m) return m[1];
  }
  const pkg = loadJson(path.join(root, 'frontend/package.json')) || loadJson(path.join(root, 'package.json'));
  if (pkg?.version) return String(pkg.version);
  return 'unknown';
}

function countBy(arr, keyFn) {
  const m = {};
  for (const x of arr) {
    const k = keyFn(x) || 'unknown';
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function fmtCountMap(m) {
  return Object.entries(m)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ') || '—';
}

const CLOSED_STATUSES = new Set(['done', 'resolved', 'refuted', 'accepted', 'accept']);
const isClosed = (f) => CLOSED_STATUSES.has(String(f.status || 'open').toLowerCase());

const dir = arg('dir');
if (!dir) {
  console.error('Usage: node write-pack-markdown.mjs --dir <audit-out-dir>');
  process.exit(1);
}

const findingsPath = path.join(dir, 'FINDINGS.json');
const reportPath = path.join(dir, 'REPORT.md');
const roadmapPath = path.join(dir, 'ROADMAP.md');
const metaPath = path.join(dir, 'run-meta.json');
const depsPath = path.join(dir, 'deps-latest.json');
const stackPath = path.join(dir, 'stack.json');

let findings = loadJson(findingsPath);
if (!findings) {
  console.error(`Missing ${findingsPath}`);
  process.exit(1);
}
if (!Array.isArray(findings)) findings = findings.findings ?? [];

const meta = loadJson(metaPath) || {};
const deps = loadJson(depsPath);
const stack = loadJson(stackPath) || deps?.stack || {};
const gitRoot = meta.root || sh('git rev-parse --show-toplevel') || process.cwd();

const appName = arg('app') || meta.app || meta.app_name || detectAppName(gitRoot);
const branchName =
  arg('branch') || meta.branch || meta.git_branch || sh('git rev-parse --abbrev-ref HEAD', gitRoot) || 'unknown-branch';
let headSha = meta.head || meta.sha || meta.commit || '';
if (!headSha || headSha === 'HEAD' || headSha === 'head') {
  headSha = sh('git rev-parse --short HEAD', gitRoot) || '';
}
const version = arg('version') || detectVersion(gitRoot, meta);
const runMode = meta.mode || 'full';
const depth = meta.depth || (runMode === 'full' ? 'deep' : 'fast');
const effort = meta.effort || (depth === 'deep' ? 'max' : 'n/a');
const packName = path.basename(path.resolve(dir));
const now = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';

// persist version into run-meta
const nextMeta = {
  ...meta,
  app: appName,
  branch: branchName,
  head: headSha,
  version,
  mode: runMode,
  depth,
  effort,
  root: meta.root || gitRoot,
  updated_at: now,
};
fs.writeFileSync(metaPath, JSON.stringify(nextMeta, null, 2) + '\n');

const done = findings.filter(isClosed);
const open = findings.filter((f) => !isClosed(f));
const pct = findings.length ? Math.round((done.length / findings.length) * 100) : 0;
const complete = open.length === 0 && findings.length > 0;
const byAgent = countBy(findings, (f) => f.agent || 'Unknown');
const bySev = countBy(findings, (f) => f.severity || 'UNKNOWN');
const blocksOpen = findings.filter((f) => f.blocks_pr && !isClosed(f));
const highAll = findings.filter((f) => f.severity === 'HIGH' || f.severity === 'CRITICAL');
const highOpen = highAll.filter((f) => !isClosed(f));
const prism = findings.filter(
  (f) => f.agent === 'Prism' || String(f.id || '').startsWith('DEP-PRI') || String(f.domain || '').includes('dep'),
);

// preserve manual notes
function extractNotes(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const t = fs.readFileSync(filePath, 'utf8');
  const m = t.match(/\n## Notes\n([\s\S]*)$/);
  return m ? m[0] : '';
}
const prevReportNotes = extractNotes(reportPath);
const prevRoadmapNotes = extractNotes(roadmapPath);

// coverage
const covPath = path.join(dir, 'sec-deep', 'coverage.json');
const cov = loadJson(covPath);

const report = [];
report.push(`# Ultra-Deep Audit — ${packName}`);
report.push('');
report.push(
  `> **App:** \`${appName}\` · **Version:** \`${version}\` · **Branch:** \`${branchName}\`${headSha ? ` @ \`${headSha}\`` : ''} · **Mode:** ${runMode}`,
);
report.push('>');
report.push(
  `> **Progress:** ${done.length}/${findings.length} DONE (${pct}%) · OPEN ${open.length} · updated ${now}${complete ? ' · ✅ COMPLETE' : ''}`,
);
report.push('');
report.push('## Project');
report.push('');
report.push('| Field | Value |');
report.push('|-------|-------|');
report.push(`| App / project | \`${appName}\` |`);
report.push(`| Version | \`${version}\` |`);
report.push(`| Branch | \`${branchName}\` |`);
report.push(`| Head | \`${headSha || 'n/a'}\` |`);
report.push(`| Pack | \`${packName}\` |`);
report.push(`| Mode | **${runMode}** · depth **${depth}** · effort **${effort}** |`);
report.push(`| Root | \`${gitRoot}\` |`);
report.push(`| Findings | **${findings.length}** (DONE ${done.length} · OPEN ${open.length}) |`);
report.push(`| Severity | ${fmtCountMap(bySev)} |`);
report.push(`| HIGH/CRITICAL open | **${highOpen.length}** |`);
report.push(`| blocks_pr still open | **${blocksOpen.length}** |`);
report.push('');
report.push('## Stack');
report.push('');
report.push(`- Languages: ${(stack.languages || []).join(', ') || '—'}`);
report.push(`- Frameworks: ${(stack.frameworks || []).join(', ') || '—'}`);
report.push(`- Ecosystems: ${(stack.ecosystems || []).join(', ') || '—'}`);
report.push(`- Package managers: ${(stack.package_managers || []).join(', ') || '—'}`);
report.push('');
report.push('## Agents');
report.push('');
report.push('| Agent | Findings |');
report.push('|-------|----------:|');
for (const [a, n] of Object.entries(byAgent).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) {
  const extra = a === 'Prism' && deps ? ` (+${deps.summary?.outdated ?? 0} freshness in deps-latest)` : '';
  report.push(`| ${a} | ${n}${extra} |`);
}
report.push('');

if (cov) {
  report.push('## Sentinel deep coverage');
  report.push('');
  const vStatus =
    cov.verification?.status || cov.verification_status || cov.status || 'n/a';
  const panelSrc = cov.panel_source || cov.verification?.panel_source || 'n/a';
  const kept =
    cov.panel_quorum_findings ?? cov.panel_kept ?? cov.kept ?? null;
  const reviewed =
    cov.panel_reviewed_findings ?? cov.panel_reviewed ?? cov.reviewed ?? null;
  report.push(`- verification.status: \`${vStatus}\``);
  report.push(`- panel_source: \`${panelSrc}\``);
  if (kept != null || reviewed != null) {
    report.push(`- panel kept: ${kept ?? '?'} / reviewed ${reviewed ?? '?'}`);
  }
  report.push('');
}

report.push('## Dependencies (Prism)');
report.push('');
if (!deps) {
  report.push('_Sem `deps-latest.json` neste pack. Rode `check-deps-latest.mjs` na Onda C (Prism)._');
  report.push('');
} else {
  const s = deps.summary || {};
  const byBump = s.by_bump || {};
  const byEco = s.by_ecosystem || {};
  report.push(
    `Pesquisa **latest stable only** via \`check-deps-latest.mjs\` · gerado \`${deps.generated_at || 'n/a'}\`.`,
  );
  report.push('');
  report.push('| Metric | Value |');
  report.push('|--------|------:|');
  report.push(`| Checked | ${s.checked ?? '—'} |`);
  report.push(`| Outdated | **${s.outdated ?? '—'}** |`);
  report.push(`| Up to date | ${s.up_to_date ?? '—'} |`);
  report.push(`| Errors | ${s.errors ?? 0} |`);
  report.push(`| By bump | ${fmtCountMap(byBump)} |`);
  report.push('');
  report.push('### By ecosystem');
  report.push('');
  report.push('| Ecosystem | Checked | Outdated | Up to date |');
  report.push('|-----------|--------:|---------:|-----------:|');
  for (const [eco, row] of Object.entries(byEco)) {
    if (row && typeof row === 'object') {
      const checked = row.checked ?? null;
      const outdated = row.outdated ?? null;
      const up =
        row.up_to_date ??
        (checked != null && outdated != null ? checked - outdated : null);
      report.push(`| ${eco} | ${checked ?? '—'} | ${outdated ?? '—'} | ${up ?? '—'} |`);
    }
  }
  report.push('');

  const outdated = (deps.packages || []).filter((p) => p.outdated);
  const bumpOrder = { major: 0, minor: 1, patch: 2, unknown: 3, none: 9 };
  outdated.sort(
    (a, b) =>
      (bumpOrder[a.bump] ?? 5) - (bumpOrder[b.bump] ?? 5) ||
      String(a.ecosystem).localeCompare(b.ecosystem) ||
      String(a.name).localeCompare(b.name),
  );

  report.push('### Outdated packages (stable)');
  report.push('');
  report.push('| Eco | Package | Current | Latest stable | Bump | Manifest |');
  report.push('|-----|---------|---------|---------------|------|----------|');
  for (const p of outdated) {
    report.push(
      `| ${p.ecosystem} | \`${p.name}\` | ${p.current ?? '—'} | ${p.latest_stable ?? '—'} | ${p.bump || '—'} | \`${p.manifest || '—'}\` |`,
    );
  }
  if (!outdated.length) report.push('| — | _none_ | | | | |');
  report.push('');

  const batches = deps.update_map?.batches || [];
  if (batches.length) {
    report.push('### Suggested update batches');
    report.push('');
    for (const b of batches) {
      report.push(`- **${b.id}** (${b.priority || 'n/a'}) — ${b.title || ''}`);
      report.push(`  - packages: ${(b.packages || []).join(', ') || '—'}`);
      if (b.rationale) report.push(`  - ${b.rationale}`);
    }
    report.push('');
  }

  if (prism.length) {
    report.push('### DEP-PRI findings');
    report.push('');
    for (const f of prism.sort((a, b) => a.id.localeCompare(b.id))) {
      report.push(
        `- **${f.id}** [${f.severity}] status=${f.status || 'OPEN'} — ${f.title}${f.resolved_in ? ` · _${f.resolved_in}_` : ''}`,
      );
    }
    report.push('');
  }
}

// P0 / blocks
const p0list = findings.filter(
  (f) =>
    f.severity === 'CRITICAL' ||
    (f.severity === 'HIGH' && (f.confidence === 'high' || f.blocks_pr)) ||
    f.blocks_pr,
);
report.push('## P0 / blocks_pr');
report.push('');
for (const f of p0list.slice(0, 40)) {
  report.push(`- **${f.id}** [${f.severity}] ${isClosed(f) ? '✅' : '⬜'} ${f.title}`);
  if (f.path) report.push(`  - \`${f.path}\``);
}
if (!p0list.length) report.push('_none_');
report.push('');

report.push('## HIGH (all)');
report.push('');
for (const f of highAll.sort((a, b) => a.id.localeCompare(b.id))) {
  report.push(
    `- **${f.id}** blocks=${Boolean(f.blocks_pr)} status=${f.status || 'OPEN'} — ${f.title}`,
  );
}
if (!highAll.length) report.push('_none_');
report.push('');

if (prevReportNotes) {
  report.push(prevReportNotes.replace(/^\n/, '').trimEnd());
  report.push('');
} else {
  report.push('## Notes');
  report.push('');
  report.push('_Oracle notes (manual) go here._');
  report.push('');
}

fs.writeFileSync(reportPath, report.join('\n'));
console.log(`Wrote ${reportPath}`);

// ROADMAP
const roadmap = [];
roadmap.push(`# ROADMAP — ${packName}`);
roadmap.push('');
roadmap.push(
  `> **App:** \`${appName}\` · **Version:** \`${version}\` · **Branch:** \`${branchName}\`${headSha ? ` @ \`${headSha}\`` : ''}`,
);
roadmap.push('');
roadmap.push('Waves ordenadas por risco. Cada item exige teste **red→green** antes de marcar DONE.');
roadmap.push('');

function waveLine(f) {
  const box = isClosed(f) ? '[x]' : '[ ]';
  return `1. ${box} **${f.id}** — ${f.title}`;
}

roadmap.push(
  `> **Progress:** ${done.length}/${findings.length} DONE (${pct}%) · OPEN ${open.length} · HIGH/CRITICAL open ${highOpen.length} · blocks_pr open ${blocksOpen.length}`,
);
roadmap.push('');

roadmap.push('## Wave 1 — Security + Race (`blocks_pr`)');
roadmap.push('');
const w1 = findings.filter(
  (f) =>
    String(f.id).startsWith('SEC-SEN') ||
    String(f.id).startsWith('RACE-HER') ||
    f.agent === 'Sentinel' ||
    f.agent === 'Hermes',
);
for (const f of w1.filter((x) => x.severity === 'HIGH' || x.severity === 'CRITICAL' || x.blocks_pr)) {
  roadmap.push(waveLine(f));
}
if (!w1.length) roadmap.push('_none_');
roadmap.push('');

roadmap.push('## Wave 2 — N+1 / Performance HIGH');
roadmap.push('');
const w2 = findings.filter((f) => String(f.id).startsWith('N1-NEX') || f.agent === 'Nexus');
for (const f of w2.filter((x) => x.severity === 'HIGH' || x.blocks_pr)) {
  roadmap.push(waveLine(f));
}
roadmap.push('');

roadmap.push('## Wave 3 — Resources + classic bugs (money/time)');
roadmap.push('');
const w3 = findings.filter(
  (f) =>
    String(f.id).startsWith('RES-HYD') ||
    String(f.id).startsWith('LEAK-HYD') ||
    String(f.id).startsWith('BUG-ART') ||
    f.agent === 'Hydra' ||
    f.agent === 'Artemis',
);
for (const f of w3.filter((x) => x.severity === 'HIGH' || x.blocks_pr)) {
  roadmap.push(waveLine(f));
}
roadmap.push('');

roadmap.push('## Wave 4 — Architecture + quality + tests');
roadmap.push('');
const w4 = findings.filter(
  (f) =>
    String(f.id).startsWith('ARCH-ATL') ||
    String(f.id).startsWith('CQ-FOR') ||
    String(f.id).startsWith('TST-ARG') ||
    String(f.id).startsWith('CC-DAE') ||
    String(f.id).startsWith('DUP-ECH') ||
    String(f.id).startsWith('VRB-LAC') ||
    String(f.id).startsWith('BP-MEN') ||
    ['Atlas', 'Forge', 'Argus', 'Daedalus', 'Echo', 'Laconic', 'Mentor'].includes(f.agent),
);
for (const f of w4.filter((x) => x.severity === 'HIGH' || x.blocks_pr)) {
  roadmap.push(waveLine(f));
}
roadmap.push('');

// ALWAYS a dedicated deps wave — implementation task, not report-only
roadmap.push('## Wave 5 — Dependencies (Prism) — **obrigatória (implementar)**');
roadmap.push('');
roadmap.push(
  'Fonte: `deps-latest.json` (latest **stable** only). **Isto é task do closeout do pack**, não anexo cosmético: aplicar bumps (patch → minor seguro → major isolado) + testes, ou aceitar com justificativa em TASKS.',
);
roadmap.push('');
roadmap.push('Ordem sugerida de implementação:');
roadmap.push('1. **CVE / security** (qualquer severity) — PR imediato');
roadmap.push('2. **batch-patches** por ecossistema (npm / maven / …) + `mvn test` / `npm test && npm run build`');
roadmap.push('3. **batch-minors** agrupados (cuidado com breaking peer ranges)');
roadmap.push('4. **batch-other-majors** / Docker pins — um PR cada; false-positives (ex. mysql tag) documentar e **não** bump cego');
roadmap.push('5. Marcar `DEP-PRI-*` DONE só com teste red→green **ou** `--note` de aceite explícito');
roadmap.push('');
if (!deps) {
  roadmap.push('_Sem deps-latest.json — rode check-deps-latest antes de fechar o pack._');
} else {
  const s = deps.summary || {};
  roadmap.push(
    `Resumo: checked=${s.checked ?? '?'} · outdated=**${s.outdated ?? '?'}** · by_bump={${fmtCountMap(s.by_bump || {})}}`,
  );
  roadmap.push('');
  const batches = deps.update_map?.batches || [];
  if (batches.length) {
    roadmap.push('### Batches sugeridos');
    roadmap.push('');
    for (const b of batches) {
      roadmap.push(`#### ${b.id} — ${b.title || ''} (\`${b.priority || 'n/a'}\`)`);
      roadmap.push('');
      roadmap.push(`- packages: ${(b.packages || []).map((p) => `\`${p}\``).join(', ') || '—'}`);
      if (b.rationale) roadmap.push(`- rationale: ${b.rationale}`);
      roadmap.push('');
    }
  }
  const outdated = (deps.packages || []).filter((p) => p.outdated);
  if (outdated.length) {
    roadmap.push('### Checklist por bump');
    roadmap.push('');
    for (const bump of ['patch', 'minor', 'major', 'unknown']) {
      const xs = outdated.filter((p) => (p.bump || 'unknown') === bump);
      if (!xs.length) continue;
      roadmap.push(`- **${bump}** (${xs.length})`);
      for (const p of xs) {
        roadmap.push(
          `  - [ ] \`${p.ecosystem}/${p.name}\`: ${p.current} → ${p.latest_stable ?? 'pin/stable'} (\`${p.manifest || '?'}\`)`,
        );
      }
    }
    roadmap.push('');
  }
  if (prism.length) {
    roadmap.push('### DEP-PRI findings (track em TASKS)');
    roadmap.push('');
    for (const f of prism.sort((a, b) => a.id.localeCompare(b.id))) {
      const box = isClosed(f) ? '[x]' : '[ ]';
      roadmap.push(`- ${box} **${f.id}** [${f.severity}] — ${f.title}`);
    }
    roadmap.push('');
  }
}

const remainingOpen = open.filter(
  (f) => f.severity === 'MEDIUM' || f.severity === 'LOW',
);
if (remainingOpen.length) {
  roadmap.push('## Remaining OPEN (P2/P3)');
  roadmap.push('');
  roadmap.push('Sequência após Waves 1–4. Checkbox só vira `[x]` via `sync-progress --done`.');
  roadmap.push('');
  for (const f of remainingOpen) {
    roadmap.push(`- [ ] **${f.id}** [${f.severity}] — ${f.title}`);
  }
  roadmap.push('');
}

if (prevRoadmapNotes) {
  roadmap.push(prevRoadmapNotes.replace(/^\n/, '').trimEnd());
  roadmap.push('');
} else {
  roadmap.push('## Notes');
  roadmap.push('');
  roadmap.push('_Oracle notes (manual) go here._');
  roadmap.push('');
}

fs.writeFileSync(roadmapPath, roadmap.join('\n'));
console.log(`Wrote ${roadmapPath}`);
console.log(`Identity: app=${appName} version=${version} branch=${branchName} head=${headSha}`);

#!/usr/bin/env node
/**
 * Hooks de verificação do make-me-happy — a parte determinística.
 *
 *   hooks.mjs diff-facts     --repo-root . --base <sha> [--head HEAD] --dir $OUT
 *   hooks.mjs deps-freshness --repo-root . --dir $OUT [--mode new|all]
 *   hooks.mjs arch-map       --repo-root . --dir $OUT
 *   hooks.mjs verdict        --dir $OUT [--fail-severity high] [--require all|present]
 *   hooks.mjs waive          --dir $OUT --hook <id> --finding <id> --reason "…"
 *
 * A parte semântica (arch-alignment, reinvention, security, performance,
 * overengineering) roda em subagentes (agents/hook-*.md) que gravam
 * hooks/<id>.json; `verdict` agrega tudo, aplica waivers e decide o exit code.
 * Semântica de bloqueio: achado aberto com severity >= --fail-severity
 * (default high) e sem waiver → FAIL → o pack não fecha (mesma régua da
 * cobertura). Verdict OPEN (registry sem rede, hook não aplicável) nunca derruba.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeJson, digest, captureEvidence, attachEvidence, withPackLock } from './state-io.mjs';

export const HOOK_IDS = [
  'arch-alignment',
  'reinvention',
  'security',
  'performance',
  'overengineering',
  'deps-freshness',
  'ui-acceptance',
];
export const HOOK_LABEL = {
  'arch-alignment': 'Arquitetura ↔ SDD',
  reinvention: 'Não reinventar a roda',
  security: 'Segurança do diff',
  performance: 'Performance do diff',
  overengineering: 'Sem overengineering',
  'deps-freshness': 'Dependências no escopo',
  'ui-acceptance': 'Aceitação de UI (runtime)',
};
const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'];
const SEVERITIES = new Set(SEVERITY_ORDER);

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

// ---------------------------------------------------------------- git helpers
function git(repoRoot, args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ---------------------------------------------------------------- manifests
const MANIFESTS = {
  'package.json': 'npm',
  'go.mod': 'go',
  'pom.xml': 'maven',
  'pyproject.toml': 'pypi',
  'Cargo.toml': 'crates',
  Gemfile: 'rubygems',
  'composer.json': 'packagist',
};

export function manifestEcosystem(file) {
  if (MANIFESTS[path.basename(file)]) return MANIFESTS[path.basename(file)];
  if (/\.csproj$/.test(file)) return 'nuget';
  return null;
}

/** Top-level declared deps of a manifest content. [{name, version, dev}] */
export function parseManifestDeps(content, ecosystem) {
  if (content == null) return [];
  const out = [];
  const push = (name, version, dev = false) => {
    if (name && !out.some((d) => d.name === name && d.dev === dev))
      out.push({ name, version: String(version || ''), dev });
  };
  try {
    if (ecosystem === 'npm') {
      const doc = JSON.parse(content);
      for (const k of ['dependencies', 'optionalDependencies']) {
        for (const [n, v] of Object.entries(doc[k] || {})) push(n, v);
      }
      for (const [n, v] of Object.entries(doc.devDependencies || {})) push(n, v, true);
    } else if (ecosystem === 'packagist') {
      const doc = JSON.parse(content);
      for (const [n, v] of Object.entries(doc.require || {})) push(n, v);
    } else if (ecosystem === 'go') {
      for (const m of content.matchAll(/^\s*([\w.\-/]+)\s+v(\S+)\s*$/gm)) {
        push(m[1], m[2]);
      }
      // drop indirect: they appear as comment lines — strip manually below
      const indirect = new Set();
      for (const m of content.matchAll(/^\s*([\w.\-/]+)\s+v\S+\s*\/\/\s*indirect/gm)) indirect.add(m[1]);
      return out.filter((d) => !indirect.has(d.name));
    } else if (ecosystem === 'maven') {
      for (const m of content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const g = m[1].match(/<groupId>([^<]+)<\/groupId>/);
        const a = m[1].match(/<artifactId>([^<]+)<\/artifactId>/);
        const v = m[1].match(/<version>([^<]+)<\/version>/);
        if (g && a) push(`${g[1]}:${a[1]}`, v ? v[1] : '');
      }
    } else if (ecosystem === 'pypi') {
      const arr = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (arr) {
        for (const m of arr[1].matchAll(/['"]([^'"]+)['"]/g)) push(...parsePypiSpec(m[1]));
      }
      const poet = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/);
      if (poet) {
        for (const m of poet[1].matchAll(/^([\w.\-]+)\s*=\s*["']?([^"'\n]+)["']?\s*$/gm))
          push(m[1], m[2].trim());
      }
    } else if (ecosystem === 'crates') {
      const sec = content.match(/\[dependencies\]([\s\S]*?)(\n\[|$)/);
      if (sec) {
        for (const m of sec[1].matchAll(/^([\w\-]+)\s*=\s*(.+)$/gm)) {
          const ver = m[2].match(/"([^"]+)"/);
          push(m[1], ver ? ver[1] : m[2].trim());
        }
      }
    } else if (ecosystem === 'rubygems') {
      for (const m of content.matchAll(/gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/g))
        push(m[1], m[2] || '');
    } else if (ecosystem === 'nuget') {
      for (const m of content.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g))
        push(m[1], m[2] || '');
    }
  } catch {
    // malformed manifest → empty list; the agent layer reports it
  }
  return out;
}

function parsePypiSpec(spec) {
  const m = spec.match(/^([\w.\-]+)/);
  if (!m) return [null, null];
  const rest = spec
    .slice(m[1].length)
    .replace(/^\[[^\]]*\]/, '')
    .split(';')[0]
    .trim();
  return [m[1], /^==[^*,]+$/.test(rest) ? rest.slice(2) : rest];
}

// ---------------------------------------------------------------- versions
export function isRange(version) {
  return /^[*^~<>=]|,|\||\s/.test(String(version || '').trim()) || String(version || '').trim() === '';
}

/** -1 | 0 | 1 semver-ish (first 3 numeric parts, pre-release < release). */
export function compareVersions(a, b) {
  const norm = (v) => String(v || '').replace(/^v/i, '');
  const pre = (v) => (norm(v).includes('-') ? norm(v).split('-').slice(1).join('-') : '');
  const core = (v) =>
    norm(v)
      .split('-')[0]
      .split('.')
      .map((p) => parseInt(p, 10) || 0);
  const ca = core(a);
  const cb = core(b);
  for (let i = 0; i < 3; i++) {
    if ((ca[i] || 0) !== (cb[i] || 0)) return (ca[i] || 0) < (cb[i] || 0) ? -1 : 1;
  }
  const pa = pre(a);
  const pb = pre(b);
  if (!pa && pb) return 1;
  if (pa && !pb) return -1;
  return pa === pb ? 0 : pa < pb ? -1 : 1;
}

/**
 * State of a dependency against the latest active release.
 * ok | minor-behind | major-behind | range | range-behind | deprecated | unknown
 */
export function stateFor(current, latest, latestDeprecated) {
  if (latest == null) return 'unknown';
  if (latestDeprecated) return 'deprecated';
  if (isRange(current)) {
    const m = String(current).match(/\d+/);
    const major = m ? parseInt(m[0], 10) : null;
    const lm = String(latest).match(/\d+/);
    if (major != null && lm && parseInt(lm[0], 10) > major) return 'range-behind';
    return 'range';
  }
  const c = compareVersions(current, latest);
  if (c >= 0) return 'ok';
  const cm = String(current).match(/\d+/);
  const lm = String(latest).match(/\d+/);
  return cm && lm && parseInt(cm[0], 10) < parseInt(lm[0], 10) ? 'major-behind' : 'minor-behind';
}

// ---------------------------------------------------------------- registries
/** Registry lookup. `fetchJson` injectable (tests). Returns {latest, deprecated} | {error}. */
export async function registryLookup(ecosystem, name, { fetchJson = defaultFetchJson, current } = {}) {
  try {
    if (ecosystem === 'npm') {
      const d = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
      const latest = d?.['dist-tags']?.latest || null;
      const deprecated = !!(current && d?.versions?.[current]?.deprecated);
      return { latest, deprecated };
    }
    if (ecosystem === 'pypi') {
      const d = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
      const selected =
        current && !isRange(current)
          ? await fetchJson(
              `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(current)}/json`,
            )
          : null;
      return { latest: d?.info?.version || null, deprecated: !!selected?.info?.yanked };
    }
    if (ecosystem === 'crates') {
      const d = await fetchJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
      return { latest: d?.crate?.max_stable_version || null, deprecated: false };
    }
    if (ecosystem === 'maven') {
      const [g, a] = String(name).split(':');
      const d = await fetchJson(
        `https://search.maven.org/solrsearch/select?q=g:${encodeURIComponent(g)}+AND+a:${encodeURIComponent(a)}&rows=1&wt=json`,
      );
      return { latest: d?.response?.docs?.[0]?.latestVersion || null, deprecated: false };
    }
    if (ecosystem === 'nuget') {
      const d = await fetchJson(
        `https://api.nuget.org/v3-flatcontainer/${encodeURIComponent(name.toLowerCase())}/index.json`,
      );
      const vs = d?.versions || [];
      return { latest: vs.length ? vs[vs.length - 1] : null, deprecated: false };
    }
    if (ecosystem === 'packagist') {
      const d = await fetchJson(`https://repo.packagist.org/p2/${encodeURIComponent(name)}.json`);
      const list = d?.packages?.[name] || [];
      const vers = list.map((x) => x.version).filter((v) => /^\d/.test(v));
      vers.sort(compareVersions);
      return { latest: vers.length ? vers[vers.length - 1] : null, deprecated: false };
    }
    if (ecosystem === 'rubygems') {
      const d = await fetchJson(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`);
      return { latest: d?.version || null, deprecated: false };
    }
    if (ecosystem === 'go') {
      const escaped = name.replace(/[A-Z]/g, (c) => '!' + c.toLowerCase());
      const d = await fetchJson(`https://proxy.golang.org/${escaped}/@latest`);
      return { latest: d?.Version || null, deprecated: false };
    }
    return { error: `ecossistema sem registry: ${ecosystem}` };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

async function defaultFetchJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'make-me-happy-hooks' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Test seam: MMH_FAKE_REGISTRY=path.json — {ecosystem:{name:{latest,deprecated}}} */
function fakeRegistryFromEnv() {
  const p = process.env.MMH_FAKE_REGISTRY;
  if (!p || !fs.existsSync(p)) return null;
  return loadJson(p, {});
}

// ---------------------------------------------------------------- diff-facts
const MIGRATION_RE =
  /(migration|migrations|db\/migrate|flyway|liquibase|alembic|prisma\/migrations|\/db\/schema|\.sql$)/i;
const SUSPICIOUS_RE =
  /(zip|gzip|tar|deflat|crypt|aes|rsa|hmac|sha\d|md5|jwt|base64|hash|passwd|oauth|urlencod|querystr)/i;
const ROUTE_RES = [
  /router\.(get|post|put|patch|delete)\s*\(/,
  /app\.(get|post|put|patch|delete)\s*\(/,
  /@(Get|Post|Put|Patch|Delete)Mapping/,
  /@(GetMapping|PostMapping|RequestMapping)/,
  /#\[ (get|post|put|patch|delete)\(/i,
  /@(Get|Post|Put|Patch|Delete)\(/,
  /\.(GET|POST|PUT|PATCH|DELETE)\(\s*"/,
  /addRoute\s*\(/i,
  /\.Handle(Func)?\(\s*"/,
  /case\s+"\/[a-z]/,
];

export function buildDiffFacts(repoRoot, base, head = 'HEAD', { gitFn = git } = {}) {
  const nameStatus = gitFn(repoRoot, ['diff', '--name-status', `${base}..${head}`]);
  if (nameStatus.status !== 0) throw new Error(`git diff falhou: ${nameStatus.err || nameStatus.out}`);
  const commitsRaw = gitFn(repoRoot, ['log', '--oneline', `${base}..${head}`]);
  const commits = commitsRaw.out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const files = [];
  for (const line of nameStatus.out.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    files.push({ status: parts[0], file: parts[parts.length - 1] });
  }

  const manifests = [];
  for (const { file } of files) {
    const eco = manifestEcosystem(file);
    if (!eco) continue;
    const at = (ref) => {
      const r = gitFn(repoRoot, ['show', `${ref}:${file}`]);
      return r.status === 0 ? r.out : null;
    };
    const before = parseManifestDeps(at(base), eco),
      after = parseManifestDeps(at(head), eco);
    const key = (d) => `${d.name}#${d.dev ? 'dev' : 'prod'}`;
    const previous = new Map(before.map((d) => [key(d), d])),
      next = new Map(after.map((d) => [key(d), d]));
    manifests.push({
      file,
      ecosystem: eco,
      added: after.filter((d) => !previous.has(key(d))),
      removed: before.filter((d) => !next.has(key(d))),
      changed: after.filter((d) => previous.has(key(d)) && previous.get(key(d)).version !== d.version),
      dependencies: after,
    });
  }

  const migrations = files.filter((f) => MIGRATION_RE.test(f.file)).map((f) => f.file);
  const suspicious_files = files.filter((f) => SUSPICIOUS_RE.test(path.basename(f.file))).map((f) => f.file);

  const diffBody = gitFn(repoRoot, ['diff', '-U0', `${base}..${head}`]);
  const routes = [];
  if (diffBody.status === 0) {
    let file = null;
    let line = 0;
    for (const l of diffBody.out.split('\n')) {
      const h = l.match(/^\+\+\+ b\/(.+)$/);
      if (h) {
        file = h[1];
        continue;
      }
      const at = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (at) {
        line = parseInt(at[1], 10);
        continue;
      }
      if (l.startsWith('+') && !l.startsWith('+++')) {
        if (file && ROUTE_RES.some((re) => re.test(l))) {
          routes.push({ file, line, snippet: l.slice(1).trim().slice(0, 160) });
        }
        line += 1;
      }
    }
  }

  return {
    base,
    head,
    commits,
    files,
    manifests,
    migrations,
    suspicious_files,
    routes,
    at: nowIso(),
  };
}

// ---------------------------------------------------------------- arch-map
/** Deriva hooks/arch-map.json de docs/atlas/app-model.json (atlas-docs), se existir. */
export function buildArchMapFromAtlas(repoRoot) {
  const atlas = loadJson(path.join(repoRoot, 'docs', 'atlas', 'app-model.json'), null);
  if (!atlas || !atlas.app) return null;
  const arch = atlas.architecture || {};
  const c4 = atlas.c4 || {};
  const libs = [];
  for (const g of arch.libs || []) {
    for (const it of g.items || []) libs.push({ name: it.name, ver: it.ver || null, use: it.use || null });
  }
  return {
    source: 'atlas',
    generated_from: 'docs/atlas/app-model.json',
    style: arch.style || null,
    layers: (arch.containers || []).map((c) => ({
      name: c.name,
      group: c.group || null,
      sub: c.sub || null,
    })),
    libs,
    adrs: (arch.adrs || []).map((a) => ({ id: a.id, title: a.title, status: a.status || null })),
    containers: (c4.containers || []).map((c) => ({
      id: c.id,
      name: c.name,
      group: c.group || null,
      tech: c.tech || null,
    })),
    notes: `derivado do atlas-docs em ${(atlas.app || {}).generatedAt || '?'}`,
    at: nowIso(),
  };
}

// ---------------------------------------------------------------- deps-freshness
export async function runDepsFreshness(repoRoot, outDir, { mode, fetchJson, fakeRegistry } = {}) {
  const diffFacts = loadJson(path.join(outDir, 'hooks', 'diff-facts.json'), null);
  const scope = mode || (diffFacts ? 'new' : 'all');
  if (scope === 'new' && !diffFacts)
    throw new Error('new dependency scope requires diff-facts; generate it before verification');

  const deps = [];
  const seen = new Set();
  const collect = (d, ecosystem, isNew, manifest) => {
    const k = `${manifest}:${ecosystem}:${d.name}:${d.dev ? 'dev' : 'prod'}`;
    if (seen.has(k)) return;
    seen.add(k);
    deps.push({ name: d.name, current: d.version, ecosystem, manifest, dev: !!d.dev, isNew });
  };

  if (scope === 'new' && diffFacts) {
    for (const m of diffFacts.manifests || []) {
      for (const d of m.added || []) collect(d, m.ecosystem, true, m.file);
    }
  } else {
    const listed = git(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard']);
    const files =
      listed.status === 0
        ? [...new Set(listed.out.trim().split('\n').filter(Boolean))]
        : fs.readdirSync(repoRoot);
    for (const file of files) {
      const eco = manifestEcosystem(file);
      if (!eco) continue;
      const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      for (const d of parseManifestDeps(content, eco)) {
        const isNew = !!diffFacts?.manifests
          ?.find((m) => m.file === file)
          ?.added?.some((a) => a.name === d.name && !!a.dev === !!d.dev);
        collect(d, eco, isNew, file);
      }
    }
  }

  const fake = fakeRegistry || fakeRegistryFromEnv();
  const registry = !deps.length ? 'not-needed' : fake ? 'fake' : 'live';
  let unavailable = 0;
  const findings = [];

  for (const dep of deps) {
    let look;
    if (fake && fake[dep.ecosystem]?.[dep.name] != null) {
      look = fake[dep.ecosystem][dep.name];
    } else if (fake && fake[dep.ecosystem] && !fake[dep.ecosystem][dep.name]) {
      look = { latest: null, deprecated: false }; // fake registry intentionally has no entry
    } else {
      look = await registryLookup(dep.ecosystem, dep.name, { fetchJson, current: dep.current });
    }
    if (!look || look.error || look.latest == null) {
      unavailable += 1;
      dep.state = look?.error ? 'registry-error' : 'unknown';
      continue;
    }
    dep.latest = look.latest;
    dep.state = stateFor(dep.current, look.latest, look.deprecated);
  }

  for (const dep of deps) {
    if (dep.state === 'unknown' || dep.state === 'registry-error') continue;
    const title = `${dep.name}: ${dep.current || 'sem versão'} → última ativa ${dep.latest}`;
    if (dep.isNew) {
      if (dep.state === 'deprecated') {
        findings.push({
          id: `D-${digest([dep.ecosystem, dep.manifest, dep.name, dep.dev, dep.state]).slice(0, 16)}`,
          severity: 'high',
          title: `${dep.name}: versão selecionada deprecada/yanked`,
          description:
            'A versão escolhida está deprecada/yanked; avaliar alternativa compatível ou waiver explícito.',
          dep: dep.name,
          manifest: dep.manifest,
          ecosystem: dep.ecosystem,
          current: dep.current,
          condition: dep.state,
          status: 'open',
        });
      } else if (dep.state === 'major-behind' || dep.state === 'minor-behind') {
        findings.push({
          id: `D-${digest([dep.ecosystem, dep.manifest, dep.name, dep.dev, dep.state]).slice(0, 16)}`,
          severity: 'medium',
          title,
          description:
            'Há versão mais recente. Verifique suporte, runtime, peers e compatibilidade; estar atrás da última versão não é defeito por si só.',
          dep: dep.name,
          manifest: dep.manifest,
          ecosystem: dep.ecosystem,
          current: dep.current,
          condition: dep.state,
          status: 'open',
        });
      } else if (dep.state === 'range-behind') {
        findings.push({
          id: `D-${digest([dep.ecosystem, dep.manifest, dep.name, dep.dev, dep.state]).slice(0, 16)}`,
          severity: 'low',
          title: `${dep.name}: range ${dep.current} não alcança a major ${dep.latest}`,
          description: 'Range declarado resolve, mas fica uma major atrás. Avalie subir o range ao instalar.',
          dep: dep.name,
          manifest: dep.manifest,
          ecosystem: dep.ecosystem,
          current: dep.current,
          condition: dep.state,
          status: 'open',
        });
      }
    } else {
      const sev = dep.state === 'deprecated' ? 'medium' : dep.state === 'major-behind' ? 'low' : 'info';
      if (dep.state !== 'ok' && dep.state !== 'range') {
        findings.push({
          id: `D-${digest([dep.ecosystem, dep.manifest, dep.name, dep.dev, dep.state]).slice(0, 16)}`,
          severity: sev,
          title,
          description:
            'Dep pré-existente: não bumpar dentro do pack (escopo é o SDD). Proposta de follow-up para o usuário decidir.',
          dep: dep.name,
          manifest: dep.manifest,
          ecosystem: dep.ecosystem,
          current: dep.current,
          condition: dep.state,
          followup: true,
          status: 'open',
        });
      }
    }
  }

  const previous = loadJson(path.join(outDir, 'hooks/deps-freshness.json'), null);
  const round = (previous?.round || 0) + 1;
  const historical = (previous?.findings || [])
    .filter((f) => !findings.some((n) => n.id === f.id))
    .map((f) => {
      const dep = deps.find(
        (d) => d.manifest === f.manifest && d.ecosystem === f.ecosystem && d.name === f.dep,
      );
      if (dep && ['unknown', 'registry-error'].includes(dep.state)) return { ...f };
      if (!dep && f.followup && scope === 'new') return { ...f };
      return { ...f, status: 'fixed', fixed_in_round: f.fixed_in_round || round };
    });
  const allFindings = [...historical, ...findings];
  const blocking = allFindings.some(
    (f) =>
      f.status !== 'fixed' &&
      !f.followup &&
      SEVERITY_ORDER.indexOf(f.severity) >= SEVERITY_ORDER.indexOf('high'),
  );
  const verdict = blocking ? 'REJECT' : unavailable > 0 ? 'OPEN' : 'APPROVE';
  const summary =
    verdict === 'OPEN'
      ? `Registry indisponível para ${unavailable}/${deps.length} deps — verifique rede/registry. Sem apuração, sem bloqueio (honestidade, não silêncio).`
      : `${deps.length} dep(s) no escopo ${scope}; ${findings.length} achado(s); registry ${registry}.`;

  return {
    hook: 'deps-freshness',
    verdict,
    round,
    rounds: [...(previous?.rounds || []), { round, verdict, at: nowIso(), findings: allFindings }],
    scope,
    registry,
    summary,
    deps,
    findings: allFindings,
    at: nowIso(),
  };
}

// ---------------------------------------------------------------- verdict
export function findingFingerprint(hook, f) {
  return digest({
    hook,
    id: f.id,
    title: f.title,
    description: f.description,
    file: f.file,
    line: f.line,
    dep: f.dep,
    manifest: f.manifest,
    ecosystem: f.ecosystem,
    current: f.current,
    condition: f.condition,
    severity: f.severity,
  });
}

export function aggregateVerdict(outDir, { failSeverity = 'high', require = 'all' } = {}) {
  const hooksDir = path.join(outDir, 'hooks');
  const waivers = loadJson(path.join(hooksDir, 'waivers.json'), { waivers: [] }).waivers || [];
  const isWaived = (hook, finding) =>
    waivers.some(
      (w) =>
        w.hook === hook &&
        w.finding === finding.id &&
        w.fingerprint === findingFingerprint(hook, finding) &&
        typeof w.reason === 'string' &&
        w.reason.trim(),
    );
  const threshold = SEVERITY_ORDER.indexOf(failSeverity);
  if (threshold < 0) throw new Error(`--fail-severity inválido: ${failSeverity}`);

  const rows = [];
  for (const id of HOOK_IDS) {
    const doc = loadJson(path.join(hooksDir, `${id}.json`), null);
    if (!doc) {
      // ui-acceptance: pack sem UI não paga a fase — SKIP derivado do escopo
      if (id === 'ui-acceptance') {
        const scope = loadJson(path.join(hooksDir, 'ui-scope.json'), null);
        if (scope && scope.ui_touched === false) {
          rows.push({
            hook: id,
            verdict: 'SKIP',
            open: 0,
            worst: null,
            blocking: false,
            note: 'ui_touched=false (auto)',
          });
          continue;
        }
        if (scope && scope.bypass === true) {
          rows.push({
            hook: id,
            verdict: 'SKIP',
            open: 0,
            worst: null,
            blocking: false,
            note: `bypass do usuário (auto): ${scope.bypass_reason || 'ui_drive=off'}`,
          });
          continue;
        }
      }
      rows.push({ hook: id, verdict: 'MISSING', open: 0, worst: null, blocking: require === 'all' });
      continue;
    }
    const verdict = String(doc.verdict || '').toUpperCase();
    const valid =
      doc.hook === id &&
      ['APPROVE', 'REJECT', 'OPEN', 'SKIP'].includes(verdict) &&
      Array.isArray(doc.findings) &&
      doc.findings.every(
        (f) =>
          f &&
          typeof f.id === 'string' &&
          f.id &&
          SEVERITIES.has(f.severity) &&
          ['open', 'fixed', 'wontfix'].includes(f.status),
      ) &&
      new Set(doc.findings.map((f) => f.id)).size === doc.findings.length;
    if (!valid) {
      rows.push({ hook: id, verdict: 'INVALID', open: 0, worst: null, blocking: true, missing: false });
      continue;
    }
    const unresolved = doc.findings.filter((f) => f.status !== 'fixed');
    const findings = unresolved.filter((f) => !isWaived(id, f));
    const worst = findings.reduce(
      (w, f) => (SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(w || 'info') ? f.severity : w),
      null,
    );
    // A textual APPROVE cannot override an open high finding. An empty REJECT is unresolved too.
    const blocking =
      findings.some((f) => SEVERITY_ORDER.indexOf(f.severity) >= threshold) ||
      (verdict === 'REJECT' && unresolved.length === 0);
    rows.push({ hook: id, verdict, open: findings.length, worst, blocking, missing: false });
  }
  const failing = rows.filter((r) => r.blocking);
  const verdict =
    failing.length || (require === 'all' && rows.some((r) => r.verdict === 'MISSING')) ? 'FAIL' : 'PASS';
  return { verdict, hooks: rows, waivers: waivers.length, at: nowIso() };
}

// ---------------------------------------------------------------- cli
async function main() {
  const cmd = process.argv[2];
  const repoRoot = path.resolve(arg('repo-root', '.'));
  const outDir = path.resolve(arg('dir', '.'));
  const hooksDir = path.join(outDir, 'hooks');

  if (cmd === 'diff-facts') {
    const base = arg('base', null);
    if (!base) {
      console.error('usage: hooks.mjs diff-facts --base <sha> [--head HEAD] --dir $OUT');
      process.exit(2);
    }
    const facts = buildDiffFacts(repoRoot, base, arg('head', 'HEAD'));
    writeJson(path.join(hooksDir, 'diff-facts.json'), facts);
    console.log(
      `diff-facts → ${path.join(hooksDir, 'diff-facts.json')} · ${facts.files.length} arquivos · ${facts.manifests.reduce((n, m) => n + m.added.length, 0)} deps novas · ${facts.routes.length} rotas · ${facts.migrations.length} migrações`,
    );
    return;
  }

  if (cmd === 'deps-freshness') {
    const mode = arg('mode', null);
    const started = loadJson(path.join(outDir, 'run-meta.json'), {}).run_id ? captureEvidence(outDir) : null;
    let doc = await runDepsFreshness(repoRoot, outDir, {
      mode: ['new', 'all'].includes(mode) ? mode : undefined,
    });
    if (started) doc = attachEvidence(outDir, doc, started);
    writeJson(path.join(hooksDir, 'deps-freshness.json'), doc);
    console.log(
      `deps-freshness [${doc.scope}] → ${doc.verdict} · ${doc.deps.length} deps · ${doc.findings.length} achados`,
    );
    if (doc.verdict === 'REJECT') process.exit(1);
    return;
  }

  if (cmd === 'arch-map') {
    const map = buildArchMapFromAtlas(repoRoot);
    if (!map) {
      console.log(
        'atlas ausente — o explorer escreve hooks/arch-map.json manualmente (source: "manual" | "greenfield")',
      );
      return;
    }
    writeJson(path.join(hooksDir, 'arch-map.json'), map);
    console.log(
      `arch-map → derivado do atlas-docs · ${map.libs.length} libs · ${map.adrs.length} ADRs · ${map.containers.length} containers`,
    );
    return;
  }

  if (cmd === 'verdict') {
    const v = aggregateVerdict(outDir, {
      failSeverity: arg('fail-severity', 'high'),
      require: arg('require', 'all'),
    });
    writeJson(path.join(hooksDir, 'verdict.json'), v);
    for (const row of v.hooks) {
      const label = HOOK_LABEL[row.hook] || row.hook;
      console.log(
        `${row.blocking ? 'FAIL' : row.verdict === 'MISSING' ? '—' : 'ok  '} ${label}: ${row.verdict}${row.open ? ` (${row.open} aberto(s), pior ${row.worst})` : ''}`,
      );
    }
    console.log(`hooks verdict: ${v.verdict}${v.waivers ? ` · ${v.waivers} waiver(s)` : ''}`);
    if (v.verdict === 'FAIL') process.exit(1);
    return;
  }

  if (cmd === 'waive') {
    const hook = arg('hook', null);
    const finding = arg('finding', null);
    const reason = arg('reason', null);
    if (!hook || !finding || !reason) {
      console.error('usage: hooks.mjs waive --dir $OUT --hook <id> --finding <id|*> --reason "..."');
      process.exit(2);
    }
    const file = path.join(hooksDir, 'waivers.json');
    const report = loadJson(path.join(hooksDir, `${hook}.json`), null);
    const selected = (report?.findings || []).filter(
      (f) => f.status !== 'fixed' && (finding === '*' || f.id === finding),
    );
    if (!HOOK_IDS.includes(hook) || !selected.length)
      throw new Error('waiver must identify existing unresolved findings');
    withPackLock(outDir, () => {
      const doc = loadJson(file, { waivers: [] });
      for (const f of selected)
        doc.waivers.push({
          hook,
          finding: f.id,
          fingerprint: findingFingerprint(hook, f),
          reason,
          at: nowIso(),
        });
      writeJson(file, doc);
    });
    console.log(`waiver gravado: ${hook}#${finding}`);
    return;
  }

  console.error('usage: hooks.mjs diff-facts|deps-freshness|arch-map|verdict|waive …');
  process.exit(2);
}

if (path.basename(process.argv[1] || '') === 'hooks.mjs') {
  try {
    await main();
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

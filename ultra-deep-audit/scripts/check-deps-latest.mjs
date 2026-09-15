#!/usr/bin/env node
/**
 * check-deps-latest.mjs — compare direct deps to latest **stable** releases.
 *
 *   node check-deps-latest.mjs --root . [--out deps-latest.json] [--findings agent-prism-freshness.json]
 *     [--include-indirect] [--no-dev] [--concurrency 8]
 *
 * Ecosystems: npm, Go, Maven/Gradle (Java/Kotlin/Spring), SPM (Swift), Cargo, PyPI,
 *             Composer, RubyGems, Docker Compose images. Stack via detect-stack.mjs.
 * Pre-releases (beta/rc/alpha/canary/…) are never treated as "latest".
 * Writes deps-latest.json (update_map + suggestions) + optional Prism findings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  if (fallback === false) return true;
  return process.argv[i + 1] ?? fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const root = path.resolve(arg('root', '.'));
const outPath = arg('out', '');
const findingsPath = arg('findings', '');
const includeIndirect = hasFlag('include-indirect');
const includeDev = !hasFlag('no-dev');
const concurrency = Math.max(1, Number(arg('concurrency', '8')) || 8);
const DEPENDENCY_POLICY_FILE = path.join(
  root, '.claude', 'skills', 'ultra-deep-audit', 'dependency-policy.json',
);

function loadDependencyPolicy() {
  if (!fs.existsSync(DEPENDENCY_POLICY_FILE)) return { docker: {}, release_managed_images: [] };
  const parsed = JSON.parse(fs.readFileSync(DEPENDENCY_POLICY_FILE, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${DEPENDENCY_POLICY_FILE} must contain a JSON object`);
  }
  return {
    docker: parsed.docker || {},
    release_managed_images: parsed.release_managed_images || [],
  };
}

const dependencyPolicy = loadDependencyPolicy();

const PRE_RE = /(?:^|[.\-+_])(alpha|beta|rc|pre|preview|dev|canary|snapshot|experimental|nightly|unstable|next)(?:[.\-+_]|$|\d)/i;

function isPrerelease(version) {
  if (!version) return true;
  let v = String(version).trim();
  if (v.startsWith('v')) v = v.slice(1);
  // Go pseudo-version v0.0.0-yyyymmdd...
  if (/^\d+\.\d+\.\d+-\d{14}-[0-9a-f]{12}$/i.test(v)) return true;
  if (v.includes('+')) v = v.split('+')[0];
  // Maven / Ivy stable qualifiers
  if (/\.(RELEASE|Final|GA)$/i.test(v)) return false;
  if (/\.(M\d+|RC\d*|Alpha\d*|Beta\d*|SNAPSHOT|SP\d+)$/i.test(v)) return true;
  // semver prerelease after -
  const dash = v.indexOf('-');
  if (dash !== -1) {
    const pre = v.slice(dash + 1);
    if (/^(RELEASE|Final|GA)(\W|$)/i.test(pre)) return false;
    if (PRE_RE.test(pre) || PRE_RE.test('-' + pre)) return true;
    // any other -tag is prerelease in semver
    return true;
  }
  return PRE_RE.test(v);
}

/** Normalize Maven-ish versions for semver compare (strip .RELEASE/.Final). */
function mavenCore(version) {
  return stripV(version).replace(/\.(RELEASE|Final|GA)$/i, '');
}

function stripV(v) {
  const s = String(v || '').trim();
  return s.startsWith('v') ? s.slice(1) : s;
}

function parseSemver(version) {
  const raw = mavenCore(version);
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) {
    const m2 = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m2) return null;
    return {
      major: Number(m2[1]),
      minor: Number(m2[2] || 0),
      patch: Number(m2[3] || 0),
      raw,
    };
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    raw,
  };
}

function cmpSemver(a, b) {
  const pa = parseSemver(mavenCore(a));
  const pb = parseSemver(mavenCore(b));
  if (!pa && !pb) return String(a).localeCompare(String(b));
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

function maxStable(versions) {
  let best = null;
  for (const v of versions) {
    if (!v || isPrerelease(v)) continue;
    if (!best || cmpSemver(v, best) > 0) best = stripV(v);
  }
  return best;
}

function bumpType(current, latest) {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return 'unknown';
  if (l.major > c.major) return 'major';
  if (l.minor > c.minor) return 'minor';
  if (l.patch > c.patch) return 'patch';
  return 'none';
}

function normalizeDeclared(range) {
  if (range == null) return '';
  let s = String(range).trim();
  if (s.startsWith('npm:')) {
    const at = s.lastIndexOf('@');
    if (at > 4) s = s.slice(at + 1);
  }
  // workspace:/file:/link:/portal:
  if (/^(workspace|file|link|portal|http|git)/i.test(s)) return { special: s };
  // strip common range operators → lower bound-ish current pin
  s = s.replace(/^[\^~>=<\s]+/, '');
  s = s.replace(/\s.*$/, '');
  s = s.replace(/\|.*$/, '');
  if (s.includes(' - ')) s = s.split(' - ')[0].trim();
  if (s.startsWith('v')) s = s.slice(1);
  // 1.x / 1.2.x
  s = s.replace(/\.x$/i, '.0');
  if (/^\d+$/.test(s)) s = `${s}.0.0`;
  if (/^\d+\.\d+$/.test(s)) s = `${s}.0`;
  return s;
}

function fetchJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ultra-deep-audit-check-deps-latest/1.0',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${url}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse failed ${url}: ${e.message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
  });
}

function fetchText(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: { 'User-Agent': 'ultra-deep-audit-check-deps-latest/1.0' },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchText(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${url}`));
            return;
          }
          resolve(body);
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
  });
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function walkFiles(dir, pred, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const name = ent.name;
    if (
      name === 'node_modules' ||
      name === '.git' ||
      name === 'vendor' ||
      name === 'dist' ||
      name === 'build' ||
      name === 'target' ||
      name === '.build' ||
      name === 'coverage' ||
      name === '__pycache__'
    ) {
      continue;
    }
    const p = path.join(dir, name);
    if (ent.isDirectory()) walkFiles(p, pred, acc, depth + 1);
    else if (pred(name, p)) acc.push(p);
  }
  return acc;
}

// ── npm ─────────────────────────────────────────────────────────────

/** Strip trailing commas / comments so bun.lock / JSONC parse. */
function parseJsonLoose(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/^\s*\/\/.*$/gm, '');
  const noTrail = noLine.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(noTrail);
}

function loadNpmLockMaps(dir) {
  /** @type {Map<string, string>} name -> version */
  const map = new Map();

  // 1) node_modules/<pkg>/package.json (most accurate installed)
  const nm = path.join(dir, 'node_modules');
  if (fs.existsSync(nm)) {
    const readPkg = (pkgDir, name) => {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
        if (v) map.set(name, stripV(v));
      } catch {
        /* ignore */
      }
    };
    let ents = [];
    try {
      ents = fs.readdirSync(nm, { withFileTypes: true });
    } catch {
      ents = [];
    }
    for (const ent of ents) {
      if (!ent.isDirectory() || ent.name === '.bin') continue;
      if (ent.name.startsWith('@')) {
        const scopeDir = path.join(nm, ent.name);
        let scoped = [];
        try {
          scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const s of scoped) {
          if (!s.isDirectory()) continue;
          const name = `${ent.name}/${s.name}`;
          readPkg(path.join(scopeDir, s.name), name);
        }
      } else {
        readPkg(path.join(nm, ent.name), ent.name);
      }
    }
  }

  // 2) package-lock.json (npm)
  const lockNpm = path.join(dir, 'package-lock.json');
  if (fs.existsSync(lockNpm)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockNpm, 'utf8'));
      if (lock.packages) {
        for (const [k, meta] of Object.entries(lock.packages)) {
          if (!k.startsWith('node_modules/') || !meta?.version) continue;
          const name = k.replace(/^node_modules\//, '').replace(/\/node_modules\//g, '>');
          // top-level only
          if (name.includes('>')) continue;
          if (!map.has(name)) map.set(name, stripV(meta.version));
        }
      } else if (lock.dependencies) {
        for (const [name, meta] of Object.entries(lock.dependencies)) {
          if (meta?.version && !map.has(name)) map.set(name, stripV(meta.version));
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3) bun.lock — packages["name"] = ["name@version", ...]
  const bunLock = path.join(dir, 'bun.lock');
  if (fs.existsSync(bunLock)) {
    try {
      const lock = parseJsonLoose(fs.readFileSync(bunLock, 'utf8'));
      const pkgs = lock.packages || {};
      for (const [key, val] of Object.entries(pkgs)) {
        const id = Array.isArray(val) ? val[0] : null;
        if (typeof id !== 'string') continue;
        // "@scope/pkg@version" or "pkg@version"
        let name = key;
        let ver = null;
        const at = id.lastIndexOf('@');
        if (at > 0) {
          name = id.slice(0, at);
          ver = id.slice(at + 1);
        }
        if (ver && !map.has(name)) map.set(name, stripV(ver));
      }
    } catch {
      /* ignore */
    }
  }

  // 4) pnpm-lock.yaml — importers + packages keys
  const pnpmLock = path.join(dir, 'pnpm-lock.yaml');
  if (fs.existsSync(pnpmLock)) {
    try {
      const text = fs.readFileSync(pnpmLock, 'utf8');
      const re = /['"]?((?:@[^'\/\s]+\/)?[^'@\s/]+)@([^'":\s,]+)/g;
      let m;
      while ((m = re.exec(text))) {
        const name = m[1];
        const ver = m[2];
        if (name && ver && !isPrerelease(ver) && !map.has(name)) map.set(name, stripV(ver));
      }
    } catch {
      /* ignore */
    }
  }

  return map;
}

async function latestNpmStable(name, minReleaseAgeDays = 0) {
  const url = name.startsWith('@')
    ? `https://registry.npmjs.org/${name.replace('/', '%2F')}`
    : `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const meta = await fetchJson(url);
  return selectNpmVersionForPolicy(meta, minReleaseAgeDays);
}

function selectNpmVersionForPolicy(meta, minReleaseAgeDays = 0, nowMillis = Date.now()) {
  const tags = meta['dist-tags'] || {};
  const latestTag = tags.latest ? stripV(tags.latest) : null;
  const versions = Object.keys(meta.versions || {});
  const registryLatest = latestTag && !isPrerelease(latestTag)
    ? latestTag
    : maxStable(versions);
  if (!registryLatest || minReleaseAgeDays <= 0) return registryLatest;

  const cutoff = nowMillis - minReleaseAgeDays * 24 * 60 * 60 * 1000;
  const eligibleVersions = versions.filter((version) => {
    if (isPrerelease(version)) return false;
    if (cmpSemver(version, registryLatest) > 0) return false;
    const publishedAt = Date.parse(meta.time?.[version] || '');
    return Number.isFinite(publishedAt) && publishedAt <= cutoff;
  });
  const eligibleLatest = maxStable(eligibleVersions);
  const registryLatestPublishedAt = meta.time?.[registryLatest] || null;
  const publishedAtMillis = Date.parse(registryLatestPublishedAt || '');
  return {
    version: eligibleLatest,
    registry_latest: registryLatest,
    registry_latest_published_at: registryLatestPublishedAt,
    min_release_age_days: minReleaseAgeDays,
    deferred_until: eligibleLatest !== registryLatest && Number.isFinite(publishedAtMillis)
      ? new Date(publishedAtMillis + minReleaseAgeDays * 24 * 60 * 60 * 1000).toISOString()
      : null,
  };
}

function readNpmMinReleaseAgeDays(startDir) {
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  let current = path.resolve(startDir);
  const insideScanRoot = current === root || current.startsWith(rootWithSeparator);
  const boundary = insideScanRoot ? root : current;
  while (true) {
    const npmrc = path.join(current, '.npmrc');
    if (fs.existsSync(npmrc)) {
      const line = fs.readFileSync(npmrc, 'utf8')
        .split(/\r?\n/)
        .map((entry) => entry.replace(/\s*[#;].*$/, '').trim())
        .find((entry) => /^min-release-age\s*=/.test(entry));
      if (line) {
        const days = Number(line.slice(line.indexOf('=') + 1).trim());
        return Number.isFinite(days) && days > 0 ? days : 0;
      }
    }
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return 0;
}

function collectPackageJsonDeps(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const dir = path.dirname(pkgPath);
  const installed = loadNpmLockMaps(dir);
  const minReleaseAgeDays = readNpmMinReleaseAgeDays(dir);
  const rows = [];
  const add = (obj, dev) => {
    if (!obj) return;
    for (const [name, range] of Object.entries(obj)) {
      const declared = String(range);
      const alias = declared.match(/^npm:((?:@[^/@\s]+\/)?[^/@\s]+)(?:@(.+))?$/);
      const norm = normalizeDeclared(declared);
      if (norm && typeof norm === 'object' && norm.special) continue;
      const fromLock = installed.get(name);
      const current = fromLock || (typeof norm === 'string' ? norm : '');
      if (!current) continue;
      rows.push({
        ecosystem: 'npm',
        name,
        registry_name: alias ? alias[1] : name,
        manifest: path.relative(root, pkgPath) || path.basename(pkgPath),
        declared,
        current: stripV(current),
        current_source: fromLock ? 'lock_or_installed' : 'manifest_range',
        min_release_age_days: minReleaseAgeDays,
        dev,
      });
    }
  };
  add(pkg.dependencies, false);
  if (includeDev) {
    add(pkg.devDependencies, true);
    add(pkg.optionalDependencies, true);
  }
  return rows;
}

async function checkNpm(files = walkFiles(root, (n) => n === 'package.json'), lookup = latestNpmStable) {
  const all = [];
  for (const f of files) {
    all.push(...collectPackageJsonDeps(f));
  }
  return mapPool(all, concurrency, async (row) => {
    try {
      const lookupResult = await lookup(row.registry_name, row.min_release_age_days || 0);
      const latest = typeof lookupResult === 'string' ? lookupResult : lookupResult?.version;
      if (!latest) {
        return { ...row, error: 'no stable version found', outdated: false };
      }
      const cur = stripV(row.current);
      const outdated = cmpSemver(latest, cur) > 0;
      const lookupMetadata = typeof lookupResult === 'object' && lookupResult
        ? Object.fromEntries(Object.entries(lookupResult).filter(([key]) => key !== 'version'))
        : {};
      return {
        ...row,
        ...lookupMetadata,
        current: cur,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(cur, latest) : 'none',
      };
    } catch (e) {
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── Go ──────────────────────────────────────────────────────────────

function findGoMods() {
  return walkFiles(root, (n) => n === 'go.mod');
}

function parseGoModDirect(modPath) {
  const text = fs.readFileSync(modPath, 'utf8');
  const directs = new Set();
  let inRequire = false;
  let inExclude = false;
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('require (')) {
      inRequire = true;
      continue;
    }
    if (line.startsWith('exclude (')) {
      inExclude = true;
      continue;
    }
    if (line === ')') {
      inRequire = false;
      inExclude = false;
      continue;
    }
    if (inExclude) continue;
    const single = line.match(/^require\s+(\S+)\s+(\S+)/);
    if (single) {
      directs.add(single[1]);
      continue;
    }
    if (inRequire) {
      const m = line.match(/^(\S+)\s+(\S+)/);
      if (m) directs.add(m[1]);
    }
  }
  return directs;
}

function runGoList(modDir) {
  const r = spawnSync('go', ['list', '-m', '-u', '-json', 'all'], {
    cwd: modDir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'local' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(r.stderr || `go list exit ${r.status}`);
  }
  // stream of JSON objects
  const items = [];
  const raw = r.stdout.trim();
  if (!raw) return items;
  let depth = 0;
  let buf = '';
  for (const ch of raw) {
    buf += ch;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          items.push(JSON.parse(buf));
        } catch {
          /* skip */
        }
        buf = '';
      }
    }
  }
  return items;
}

async function latestGoStable(modulePath, hintVersions = []) {
  const candidates = [...hintVersions];
  try {
    const enc = modulePath
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/');
    const list = await fetchText(`https://proxy.golang.org/${enc}/@v/list`);
    for (const line of list.split(/\r?\n/)) {
      const v = line.trim();
      if (v) candidates.push(v);
    }
  } catch {
    /* proxy optional if go list had Update */
  }
  const best = maxStable(candidates.map(stripV).map((v) => (v.startsWith('v') ? v : `v${v}`)));
  if (!best) return null;
  return best.startsWith('v') ? best : `v${best}`;
}

async function checkGo() {
  const mods = findGoMods();
  const rows = [];
  for (const modPath of mods) {
    const modDir = path.dirname(modPath);
    const direct = parseGoModDirect(modPath);
    let items;
    try {
      items = runGoList(modDir);
    } catch (e) {
      rows.push({
        ecosystem: 'go',
        name: path.relative(root, modPath),
        manifest: path.relative(root, modPath),
        error: String(e.message || e),
        outdated: false,
      });
      continue;
    }
    const main = items.find((x) => x.Main);
    for (const it of items) {
      if (it.Main) continue;
      if (it.Indirect && !includeIndirect) continue;
      if (!includeIndirect && direct.size && !direct.has(it.Path)) continue;
      const current = it.Version || '';
      const hints = [];
      if (it.Version) hints.push(it.Version);
      if (it.Update?.Version) hints.push(it.Update.Version);
      rows.push({
        ecosystem: 'go',
        name: it.Path,
        manifest: path.relative(root, modPath) || 'go.mod',
        current,
        declared: current,
        dev: false,
        indirect: Boolean(it.Indirect),
        _hints: hints,
        _main: main?.Path,
      });
    }
  }

  return mapPool(rows, concurrency, async (row) => {
    if (row.error) return row;
    try {
      const latest = await latestGoStable(row.name, row._hints || []);
      delete row._hints;
      delete row._main;
      if (!latest) {
        return { ...row, error: 'no stable version found', outdated: false };
      }
      const cur = row.current;
      const outdated = cmpSemver(latest, cur) > 0;
      return {
        ...row,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(cur, latest) : 'none',
      };
    } catch (e) {
      delete row._hints;
      delete row._main;
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── Cargo ───────────────────────────────────────────────────────────

function parseCargoTomlDeps(text) {
  // minimal TOML table parser for [dependencies] / [dev-dependencies]
  const rows = [];
  let section = null;
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1];
      continue;
    }
    const isDep =
      section === 'dependencies' ||
      section === 'dev-dependencies' ||
      /\.dependencies$/.test(section || '') ||
      /\.dev-dependencies$/.test(section || '');
    if (!isDep) continue;
    const dev = (section || '').includes('dev-dependencies');
    // name = "1.2.3"
    let m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (m) {
      rows.push({ name: m[1], declared: m[2], current: normalizeDeclared(m[2]), dev });
      continue;
    }
    // name = { version = "1.2", ... }
    m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*\{([^}]+)\}/);
    if (m) {
      const vm = m[2].match(/version\s*=\s*"([^"]+)"/);
      if (vm) {
        rows.push({ name: m[1], declared: vm[1], current: normalizeDeclared(vm[1]), dev });
      }
    }
  }
  return rows;
}

async function latestCrateStable(name) {
  const meta = await fetchJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
  const versions = (meta.versions || []).map((v) => v.num);
  // crates.io marks yanked; prefer non-yanked
  const nonYanked = (meta.versions || []).filter((v) => !v.yanked).map((v) => v.num);
  return maxStable(nonYanked.length ? nonYanked : versions);
}

async function checkCargo() {
  const files = walkFiles(root, (n) => n === 'Cargo.toml');
  const all = [];
  for (const f of files) {
    const deps = parseCargoTomlDeps(fs.readFileSync(f, 'utf8'));
    for (const d of deps) {
      if (!includeDev && d.dev) continue;
      if (!d.current || typeof d.current !== 'string') continue;
      all.push({
        ecosystem: 'cargo',
        name: d.name,
        manifest: path.relative(root, f) || 'Cargo.toml',
        declared: d.declared,
        current: stripV(d.current),
        dev: d.dev,
      });
    }
  }
  return mapPool(all, concurrency, async (row) => {
    try {
      const latest = await latestCrateStable(row.name);
      if (!latest) return { ...row, error: 'no stable version found', outdated: false };
      const outdated = cmpSemver(latest, row.current) > 0;
      return {
        ...row,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(row.current, latest) : 'none',
      };
    } catch (e) {
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── PyPI ────────────────────────────────────────────────────────────

function parseRequirements(text) {
  const rows = [];
  for (const lineRaw of text.split(/\r?\n/)) {
    let line = lineRaw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*(?:\[.*?\])?\s*(==|>=|~=|!=|<=)?\s*([^,;]+)?/);
    if (!m) continue;
    const name = m[1];
    const op = m[2] || '';
    const ver = (m[3] || '').trim();
    if (op === '==' && ver) {
      rows.push({ name, declared: `${op}${ver}`, current: normalizeDeclared(ver) });
    } else if (ver) {
      rows.push({ name, declared: `${op}${ver}`, current: normalizeDeclared(ver) });
    }
  }
  return rows;
}

function parsePyprojectDeps(text) {
  const rows = [];
  // project.dependencies array strings "foo>=1.2"
  const depBlock = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depBlock) {
    const re = /"([^"]+)"|'([^']+)'/g;
    let m;
    while ((m = re.exec(depBlock[1]))) {
      const spec = m[1] || m[2];
      const parsed = parseRequirements(spec);
      rows.push(...parsed);
    }
  }
  return rows;
}

async function latestPypiStable(name) {
  const meta = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  const versions = Object.keys(meta.releases || {});
  return maxStable(versions);
}

async function checkPypi() {
  const files = [
    ...walkFiles(root, (n) => /^requirements.*\.txt$/i.test(n)),
    ...walkFiles(root, (n) => n === 'pyproject.toml'),
  ];
  const all = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const deps = f.endsWith('.toml') ? parsePyprojectDeps(text) : parseRequirements(text);
    for (const d of deps) {
      if (!d.current || typeof d.current !== 'string') continue;
      all.push({
        ecosystem: 'pypi',
        name: d.name,
        manifest: path.relative(root, f),
        declared: d.declared,
        current: stripV(d.current),
        dev: false,
      });
    }
  }
  return mapPool(all, concurrency, async (row) => {
    try {
      const latest = await latestPypiStable(row.name);
      if (!latest) return { ...row, error: 'no stable version found', outdated: false };
      const outdated = cmpSemver(latest, row.current) > 0;
      return {
        ...row,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(row.current, latest) : 'none',
      };
    } catch (e) {
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── Maven / Gradle (Java, Kotlin, Spring) ───────────────────────────

/** Resolve a literal or a single `${prop}` against this pom's own <properties>. */
function resolveMavenProp(text, raw) {
  let version = (raw || '').trim();
  if (!version.includes('${')) return version;
  const prop = version.match(/^\$\{([^}]+)\}$/);
  if (!prop) return '';
  // Semgrep 965108828: Maven property name is escaped before interpolation; regex operators are not user-controlled.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const pref = new RegExp(
    `<${prop[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>\\s*([^<]+)\\s*</`,
  );
  const pv = text.match(pref);
  return pv ? pv[1].trim() : '';
}

function parseMavenCoordsFromPom(text, manifestRel) {
  const rows = [];
  // parent
  const parent = text.match(/<parent>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/parent>/);
  if (parent) {
    rows.push({
      groupId: parent[1].trim(),
      artifactId: parent[2].trim(),
      version: parent[3].trim(),
      scope: 'parent',
    });
  }
  // dependencyManagement + dependencies blocks
  const depRe =
    /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]*)<\/version>)?/g;
  let m;
  while ((m = depRe.exec(text))) {
    const groupId = m[1].trim();
    const artifactId = m[2].trim();
    const version = resolveMavenProp(text, m[3]);
    if (!version) continue;
    rows.push({ groupId, artifactId, version, scope: 'dependency' });
  }
  // spring-boot plugin version etc.
  const pluginRe =
    /<plugin>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/g;
  while ((m = pluginRe.exec(text))) {
    const raw = m[3].trim();
    const version = resolveMavenProp(text, raw);
    rows.push({
      groupId: m[1].trim(),
      artifactId: m[2].trim(),
      // A ${prop} defined in the parent BOM cannot be resolved from this file. Keep the
      // row visible but skipped — comparing the literal "${x.version}" produced garbage.
      version: version || raw,
      scope: 'plugin',
      ...(version ? {} : { skipped: true, reason: `unresolved property ${raw} (defined outside this pom)` }),
    });
  }
  return rows.map((r) => ({
    ecosystem: 'maven',
    name: `${r.groupId}:${r.artifactId}`,
    groupId: r.groupId,
    artifactId: r.artifactId,
    manifest: manifestRel,
    declared: r.version,
    current: r.version,
    dev: r.scope === 'plugin',
    scope: r.scope,
    ...(r.skipped ? { skipped: true, reason: r.reason, outdated: false } : {}),
  }));
}

/**
 * TOOL-PRI-108 — CVE pins hidden in <properties>.
 *
 * A Spring Boot BOM property override (`<netty.version>`, `<jackson-bom.version>`,
 * `<rabbit-amqp-client.version>`) raises the version of an artifact that has NO
 * <dependency> element in the pom, so `parseMavenCoordsFromPom` never saw it. Those
 * overrides are precisely where this project's security pins live, and Trivy FS is blind
 * to them too (it does not read jar-packaged deps) — two instruments dark at the same spot.
 *
 * Property name → the coordinate whose version it drives. Names come from
 * spring-boot-dependencies-<ver>.pom; extend as new pins appear (the pom gate test
 * in tests/check-deps-latest.test.mjs fails when an unmapped pin shows up).
 */
const MAVEN_BOM_PROPERTY_COORDS = {
  'rabbit-amqp-client.version': 'com.rabbitmq:amqp-client',
  'jackson-bom.version': 'tools.jackson:jackson-bom',
  'netty.version': 'io.netty:netty-bom',
  'httpcore5.version': 'org.apache.httpcomponents.core5:httpcore5',
  'httpclient5.version': 'org.apache.httpcomponents.client5:httpclient5',
  'tomcat.version': 'org.apache.tomcat.embed:tomcat-embed-core',
  'hibernate.version': 'org.hibernate.orm:hibernate-core',
  'logback.version': 'ch.qos.logback:logback-classic',
  'micrometer.version': 'io.micrometer:micrometer-bom',
  'snakeyaml.version': 'org.yaml:snakeyaml',
  'commons-pool2.version': 'org.apache.commons:commons-pool2',
  'lettuce.version': 'io.lettuce:lettuce-core',
  'mysql.version': 'com.mysql:mysql-connector-j',
  'postgresql.version': 'org.postgresql:postgresql',
  'bouncycastle.version': 'org.bouncycastle:bcpkix-jdk18on',
  'spring-framework.version': 'org.springframework:spring-core',
  'spring-security.version': 'org.springframework.security:spring-security-core',
  'spring-boot.version': 'org.springframework.boot:spring-boot-dependencies',
};

/** Properties that name a toolchain/build knob, not an artifact version. */
const NON_ARTIFACT_VERSION_PROPS = /^(java\.|maven\.|project\.|sonar\.)/;

/** The XML comment sitting immediately above `index`, i.e. why this pin exists. */
function rationaleAbove(text, index) {
  const m = text.slice(0, index).match(/<!--([\s\S]*?)-->\s*$/);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim().slice(0, 600);
}

function parseMavenPropertyPins(text, manifestRel) {
  const propsBlock = text.match(/<properties>([\s\S]*?)<\/properties>/);
  if (!propsBlock) return [];
  const blockStart = propsBlock.index + '<properties>'.length;
  const block = propsBlock[1];

  const rows = [];
  const re = /<([\w.\-]+\.version)>\s*([^<]+?)\s*<\/\1>/g;
  let m;
  while ((m = re.exec(block))) {
    const property = m[1];
    const value = m[2].trim();
    if (NON_ARTIFACT_VERSION_PROPS.test(property)) continue;
    if (value.includes('${')) continue;
    // Already visible through an explicit <dependency>/<plugin> in the same pom.
    if (text.includes('${' + property + '}')) continue;

    const rationale = rationaleAbove(text, blockStart + m.index);
    const coord = MAVEN_BOM_PROPERTY_COORDS[property];
    const base = {
      ecosystem: 'maven',
      manifest: manifestRel,
      declared: value,
      current: value,
      dev: false,
      scope: 'bom-property-override',
      property,
      rationale,
    };
    if (coord) {
      const [groupId, artifactId] = coord.split(':');
      rows.push({ ...base, name: coord, groupId, artifactId });
    } else {
      rows.push({
        ...base,
        name: `property:${property}`,
        skipped: true,
        outdated: false,
        reason:
          `version pin declared only as a <properties> override — no Maven coordinate is known for ` +
          `"${property}", so nothing checks it. Map it in MAVEN_BOM_PROPERTY_COORDS or declare an ` +
          `explicit <dependency>.`,
      });
    }
  }
  return rows;
}

function parseGradleDeps(text, manifestRel) {
  const rows = [];
  // implementation 'g:a:v' | "g:a:v" | implementation("g:a:v")
  const re =
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testApi|annotationProcessor|kapt|debugImplementation|androidTestImplementation|classpath)\s*(?:\(?\s*["']([^"']+)["']\s*\)?)/g;
  let m;
  while ((m = re.exec(text))) {
    const coord = m[1];
    const parts = coord.split(':');
    if (parts.length < 3) continue;
    const [groupId, artifactId, version] = parts;
    if (!version || version.startsWith('$')) continue;
    rows.push({
      ecosystem: 'gradle',
      name: `${groupId}:${artifactId}`,
      groupId,
      artifactId,
      manifest: manifestRel,
      declared: version,
      current: version,
      dev: /test|kapt|annotation/i.test(m[0]),
    });
  }
  return rows;
}

function parseVersionCatalog(text, manifestRel) {
  const rows = [];
  // [versions] foo = "1.2.3"
  const versions = {};
  let section = null;
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section === 'versions') {
      const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/);
      if (m) versions[m[1]] = m[2];
    }
  }
  section = null;
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section !== 'libraries' && section !== 'plugins') continue;
    // foo = { module = "g:a", version.ref = "x" } | version = "1.2"
    const nameM = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*\{(.+)\}\s*$/);
    if (!nameM) continue;
    const body = nameM[2];
    const mod = body.match(/module\s*=\s*"([^"]+)"/) || body.match(/group\s*=\s*"([^"]+)"\s*,\s*name\s*=\s*"([^"]+)"/);
    let groupId;
    let artifactId;
    if (mod && mod[2]) {
      groupId = mod[1];
      artifactId = mod[2];
    } else if (mod) {
      const parts = mod[1].split(':');
      if (parts.length !== 2) continue;
      groupId = parts[0];
      artifactId = parts[1];
    } else continue;
    let version = null;
    const vr = body.match(/version\.ref\s*=\s*"([^"]+)"/);
    const vv = body.match(/version\s*=\s*"([^"]+)"/);
    if (vr) version = versions[vr[1]];
    else if (vv) version = vv[1];
    if (!version) continue;
    rows.push({
      ecosystem: 'gradle',
      name: `${groupId}:${artifactId}`,
      groupId,
      artifactId,
      manifest: manifestRel,
      declared: version,
      current: version,
      dev: section === 'plugins',
    });
  }
  return rows;
}

async function latestMavenStable(groupId, artifactId) {
  const gPath = groupId.replace(/\./g, '/');
  const url = `https://repo1.maven.org/maven2/${gPath}/${artifactId}/maven-metadata.xml`;
  const xml = await fetchText(url);
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1].trim());
  const release = (xml.match(/<release>([^<]+)<\/release>/) || [])[1];
  if (release && !isPrerelease(release)) return release.trim();
  return maxStable(versions);
}

async function checkMavenGradle() {
  const rows = [];
  for (const f of walkFiles(root, (n) => n === 'pom.xml')) {
    const text = fs.readFileSync(f, 'utf8');
    const manifestRel = path.relative(root, f) || 'pom.xml';
    rows.push(...parseMavenCoordsFromPom(text, manifestRel));
    rows.push(...parseMavenPropertyPins(text, manifestRel));
  }
  for (const f of walkFiles(root, (n) => n === 'build.gradle' || n === 'build.gradle.kts')) {
    rows.push(...parseGradleDeps(fs.readFileSync(f, 'utf8'), path.relative(root, f)));
  }
  for (const f of walkFiles(root, (n) => n === 'libs.versions.toml')) {
    rows.push(...parseVersionCatalog(fs.readFileSync(f, 'utf8'), path.relative(root, f)));
  }
  // de-dupe by name+manifest before network
  const seen = new Set();
  const uniq = [];
  for (const r of rows) {
    const k = `${r.name}::${r.manifest}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  return mapPool(uniq, concurrency, async (row) => {
    if (row.skipped) return row;
    try {
      const latest = await latestMavenStable(row.groupId, row.artifactId);
      if (!latest) return { ...row, error: 'no stable version found', outdated: false };
      const outdated = cmpSemver(latest, row.current) > 0;
      return {
        ...row,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(row.current, latest) : 'none',
      };
    } catch (e) {
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── Swift SPM ───────────────────────────────────────────────────────

function parsePackageSwift(text, manifestRel) {
  const rows = [];
  // .package(url: "https://github.com/org/repo.git", from: "1.2.3")
  // .package(url: "...", exact: "1.2.3")
  // .package(url: "...", .upToNextMajor(from: "1.0.0"))
  const re =
    /\.package\s*\(\s*url:\s*"(https?:\/\/[^"]+)"\s*,\s*(?:\.upToNextMajor\s*\(\s*from:\s*"([^"]+)"\s*\)|from:\s*"([^"]+)"|exact:\s*"([^"]+)"|"([^"]+)"\s*\.\.\.|upToNextMajorFrom:\s*"([^"]+)")/g;
  let m;
  while ((m = re.exec(text))) {
    const url = m[1];
    const ver = m[2] || m[3] || m[4] || m[5] || m[6];
    if (!ver) continue;
    const name = url
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
      .split('/')
      .slice(-2)
      .join('/');
    rows.push({
      ecosystem: 'spm',
      name,
      repo_url: url,
      manifest: manifestRel,
      declared: ver,
      current: stripV(ver),
      dev: false,
    });
  }
  return rows;
}

function parsePackageResolved(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  try {
    const j = JSON.parse(text);
    const pins = j.pins || j.object?.pins || [];
    for (const pin of pins) {
      const loc = pin.location || pin.repositoryURL || '';
      const ver = pin.state?.version || pin.version;
      if (!loc || !ver) continue;
      const name = loc
        .replace(/\.git$/, '')
        .replace(/\/$/, '')
        .split('/')
        .slice(-2)
        .join('/');
      map.set(name, stripV(ver));
      // also by full url key variants
      map.set(loc.replace(/\.git$/, ''), stripV(ver));
    }
  } catch {
    /* ignore */
  }
  return map;
}

function githubRepoFromUrl(url) {
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function latestGithubStableRelease(owner, repo) {
  // releases (non-prerelease first via API)
  try {
    const rel = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    if (rel?.tag_name && !rel.prerelease && !isPrerelease(rel.tag_name)) {
      return stripV(rel.tag_name);
    }
  } catch {
    /* fall through */
  }
  try {
    const tags = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=30`);
    const vers = (Array.isArray(tags) ? tags : []).map((t) => t.name);
    return maxStable(vers);
  } catch {
    return null;
  }
}

async function checkSpm() {
  const resolvedMaps = [];
  for (const f of walkFiles(root, (n) => n === 'Package.resolved')) {
    resolvedMaps.push(parsePackageResolved(fs.readFileSync(f, 'utf8')));
  }
  const rows = [];
  for (const f of walkFiles(root, (n) => n === 'Package.swift')) {
    const parsed = parsePackageSwift(fs.readFileSync(f, 'utf8'), path.relative(root, f) || 'Package.swift');
    for (const r of parsed) {
      for (const map of resolvedMaps) {
        if (map.has(r.name)) {
          r.current = map.get(r.name);
          r.current_source = 'Package.resolved';
          break;
        }
      }
      rows.push(r);
    }
  }
  return mapPool(rows, Math.min(concurrency, 4), async (row) => {
    try {
      const gh = githubRepoFromUrl(row.repo_url);
      if (!gh) return { ...row, error: 'non-github package (skipped latest lookup)', outdated: false, skipped: true };
      const latest = await latestGithubStableRelease(gh.owner, gh.repo);
      if (!latest) return { ...row, error: 'no stable version found', outdated: false };
      const outdated = cmpSemver(latest, row.current) > 0;
      return {
        ...row,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(row.current, latest) : 'none',
      };
    } catch (e) {
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── Composer (PHP) ──────────────────────────────────────────────────

async function latestComposerStable(name) {
  const meta = await fetchJson(`https://repo.packagist.org/p2/${name}.json`);
  const pkgs = meta.packages?.[name] || [];
  const versions = pkgs.map((p) => p.version);
  return maxStable(versions);
}

async function checkComposer() {
  const files = walkFiles(root, (n) => n === 'composer.json');
  const all = [];
  for (const f of files) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    const add = (obj, dev) => {
      if (!obj) return;
      for (const [name, range] of Object.entries(obj)) {
        if (name === 'php' || name.startsWith('ext-')) continue;
        const current = normalizeDeclared(String(range).replace(/^v/, ''));
        if (!current || typeof current !== 'string') continue;
        all.push({
          ecosystem: 'composer',
          name,
          manifest: path.relative(root, f) || 'composer.json',
          declared: String(range),
          current: stripV(current),
          dev,
        });
      }
    };
    add(pkg.require, false);
    if (includeDev) add(pkg['require-dev'], true);
  }
  return mapPool(all, concurrency, async (row) => {
    try {
      const latest = await latestComposerStable(row.name);
      if (!latest) return { ...row, error: 'no stable version found', outdated: false };
      const outdated = cmpSemver(latest, row.current) > 0;
      return {
        ...row,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(row.current, latest) : 'none',
      };
    } catch (e) {
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── RubyGems ────────────────────────────────────────────────────────

function parseGemfile(text, manifestRel) {
  const rows = [];
  // gem 'name', '1.2.3' | gem "name", "~> 1.2"
  const re = /gem\s+["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const ver = m[2];
    if (!ver) continue;
    const current = normalizeDeclared(ver.replace(/^~>?\s*/, '').replace(/,\s*.*$/, ''));
    if (!current || typeof current !== 'string') continue;
    rows.push({
      ecosystem: 'rubygems',
      name,
      manifest: manifestRel,
      declared: ver,
      current: stripV(current),
      dev: false,
    });
  }
  return rows;
}

async function latestRubygemStable(name) {
  const vers = await fetchJson(`https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`);
  const list = (Array.isArray(vers) ? vers : []).filter((v) => !v.prerelease).map((v) => v.number);
  return maxStable(list);
}

async function checkRubygems() {
  const files = walkFiles(root, (n) => n === 'Gemfile');
  const all = [];
  for (const f of files) {
    all.push(...parseGemfile(fs.readFileSync(f, 'utf8'), path.relative(root, f) || 'Gemfile'));
  }
  return mapPool(all, concurrency, async (row) => {
    try {
      const latest = await latestRubygemStable(row.name);
      if (!latest) return { ...row, error: 'no stable version found', outdated: false };
      const outdated = cmpSemver(latest, row.current) > 0;
      return {
        ...row,
        latest_stable: latest,
        outdated,
        bump: outdated ? bumpType(row.current, latest) : 'none',
      };
    } catch (e) {
      return { ...row, error: String(e.message || e), outdated: false };
    }
  });
}

// ── Docker Compose images ───────────────────────────────────────────

const COMPOSE_NAMES = new Set([
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'docker-compose.db.yml',
  'docker-compose.db.yaml',
  'docker-compose.services.yml',
  'docker-compose.services.yaml',
  'docker-compose.override.yml',
  'docker-compose.override.yaml',
  'docker-compose.prod.yml',
  'docker-compose.prod.yaml',
  'docker-compose.dev.yml',
  'docker-compose.dev.yaml',
]);

const FLOATING_TAGS = new Set([
  'latest',
  'stable',
  'edge',
  'current',
  'nightly',
  'master',
  'main',
  'develop',
  'dev',
  'rolling',
]);

function expandComposeEnv(value) {
  // ${VAR:-default} | ${VAR-default} | $VAR | ${VAR}
  return String(value).replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) => {
    if (bare) return process.env[bare] ?? '';
    const body = braced;
    let name = body;
    let def = '';
    let hasDefault = false;
    const m = body.match(/^([A-Za-z_][A-Za-z0-9_]*)(:-|-)([\s\S]*)$/);
    if (m) {
      name = m[1];
      hasDefault = true;
      def = m[3];
    }
    const env = process.env[name];
    if (env != null && env !== '') return env;
    if (hasDefault) return def;
    return '';
  });
}

function isReleaseManagedComposeImage(value) {
  const raw = String(value || '');
  if (/\$\{APP_VERSION(?::?-)?[^}]*}/.test(raw)) return true;
  return dependencyPolicy.release_managed_images.some(
    (entry) => {
      const image = typeof entry === 'string' ? entry : entry.image;
      return raw === image || raw.startsWith(`${image}:`) || raw.startsWith(`${image}@`);
    },
  );
}

function parseImageRef(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  // strip digest for version compare; keep tag if both (rare)
  let digest = null;
  if (s.includes('@')) {
    const separator = s.indexOf('@');
    digest = s.slice(separator + 1);
    s = s.slice(0, separator);
  }
  // registry/repo:tag — tag is after last : that is not part of port
  let name = s;
  let tag = 'latest';
  const lastSlash = s.lastIndexOf('/');
  const lastColon = s.lastIndexOf(':');
  if (lastColon > lastSlash) {
    name = s.slice(0, lastColon);
    tag = s.slice(lastColon + 1);
  }
  // split registry
  const parts = name.split('/');
  let registry = 'docker.io';
  let path = name;
  if (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost') {
    registry = parts[0];
    path = parts.slice(1).join('/');
  }
  // docker hub official
  let namespace;
  let repo;
  if (registry === 'docker.io' || registry === 'index.docker.io' || registry === 'registry-1.docker.io') {
    registry = 'docker.io';
    if (!path.includes('/')) {
      namespace = 'library';
      repo = path;
    } else {
      const [ns, ...rest] = path.split('/');
      namespace = ns;
      repo = rest.join('/');
    }
  } else {
    const [ns, ...rest] = path.split('/');
    namespace = ns || '';
    repo = rest.join('/') || ns;
  }
  return {
    raw,
    registry,
    namespace,
    repo,
    path: registry === 'docker.io' ? `${namespace}/${repo}` : `${registry}/${path}`,
    name: registry === 'docker.io' && namespace === 'library' ? repo : path.includes('/') ? path : `${namespace}/${repo}`,
    tag,
    digest,
    display: `${registry === 'docker.io' && namespace === 'library' ? repo : path}:${tag}`,
  };
}

function splitTagVariant(tag) {
  const t = String(tag || '');
  // MinIO / date releases — no variant
  if (/^RELEASE[.-]/i.test(t)) return { base: t, variant: '', kind: 'release_date' };
  // sha- / git short
  if (/^(sha-|g)?[0-9a-f]{7,40}$/i.test(t)) return { base: t, variant: '', kind: 'git' };
  // 18.2-alpine | 16-bookworm | 7.2-alpine3.19
  const m = t.match(/^v?(\d+(?:\.\d+)*)(?:-([A-Za-z][A-Za-z0-9._-]*))?$/);
  if (m) return { base: m[1], variant: m[2] || '', kind: 'semver' };
  // alpine3.19 alone etc.
  return { base: t, variant: '', kind: 'opaque' };
}

/** Known image OS/variant suffixes — NOT prereleases. */
const DOCKER_VARIANT_OK =
  /^(alpine|alpine\d+(\.\d+)?|slim|bookworm|bullseye|buster|jammy|focal|noble|ubi\d*|distroless|scratch|static|debian|ubuntu|oci|busybox)([-.]|$)/i;

function isDockerPrereleaseTag(tag) {
  const t = String(tag || '');
  if (!t || FLOATING_TAGS.has(t.toLowerCase())) return true;
  // MinIO / calendar RELEASE tags are stable product builds
  if (/^RELEASE[.-]\d{4}-\d{2}-\d{2}T/i.test(t)) return false;
  // architecture-only junk
  if (/^(arm|arm64|amd64|386|ppc|s390x)(-|$)/i.test(t)) return true;
  // explicit prerelease tokens anywhere in tag
  if (/(^|[-.])(windowsservercore|nanoserver|preview|nightly|snapshot|experimental|canary|beta\d*|alpha\d*|rc\d*|pre\d*|dev)([-.]|$)/i.test(t)) {
    return true;
  }
  // semver + variant: 18.2-alpine → only check prerelease on non-variant suffix
  const sp = splitTagVariant(t);
  if (sp.kind === 'semver') {
    if (!sp.variant) return false;
    if (DOCKER_VARIANT_OK.test(sp.variant)) return false;
    // unknown variant: treat as prerelease only if it looks like one
    return /beta|alpha|rc|pre|dev|snapshot|nightly|canary/i.test(sp.variant);
  }
  if (sp.kind === 'release_date') return false;
  // opaque tags with classic pre tokens already caught
  return false;
}

function cmpReleaseDateTag(a, b) {
  const pa = a.match(/RELEASE[.-](\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z/i);
  const pb = b.match(/RELEASE[.-](\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z/i);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return pa.slice(1).join('').localeCompare(pb.slice(1).join(''));
}

function maxDockerStableTag(tags, preferVariant = '', currentTag = '') {
  const all = new Set(tags.filter((t) => !isDockerPrereleaseTag(t)));
  // always consider current pin as candidate (avoids "older latest" false display)
  if (currentTag && !isDockerPrereleaseTag(currentTag)) all.add(currentTag);
  const stable = [...all];
  if (!stable.length) return null;

  // Prefer same variant (alpine, bookworm, …)
  const withVar = preferVariant
    ? stable.filter((t) => {
        const sp = splitTagVariant(t);
        return sp.variant === preferVariant || t.endsWith(`-${preferVariant}`);
      })
    : [];

  const pool = withVar.length ? withVar : stable;
  const curKind = currentTag ? splitTagVariant(currentTag).kind : '';

  // RELEASE.date tags (minio) — when current is calendar release OR pool is mostly RELEASE
  const releaseTags = pool.filter((t) => /^RELEASE[.-]/i.test(t));
  if (curKind === 'release_date' || (releaseTags.length && releaseTags.length >= pool.length * 0.3)) {
    let best = null;
    for (const t of releaseTags) {
      if (!best || cmpReleaseDateTag(t, best) > 0) best = t;
    }
    if (best) return best;
  }

  // Semver-ish
  let best = null;
  let bestBase = null;
  for (const t of pool) {
    if (/^RELEASE[.-]/i.test(t)) continue;
    const sp = splitTagVariant(t);
    if (sp.kind !== 'semver' && sp.kind !== 'opaque') continue;
    if (!parseSemver(sp.base) && !/^\d+(\.\d+)*$/.test(sp.base)) continue;
    if (!bestBase || cmpSemver(sp.base, bestBase) > 0) {
      bestBase = sp.base;
      best = t;
    } else if (bestBase && cmpSemver(sp.base, bestBase) === 0) {
      // same base: prefer exact variant match already filtered; else shorter tag
      if (best && t.length < best.length) best = t;
    }
  }
  if (best) return best;

  // fallback: last non-floating by string (weak)
  return pool.sort().at(-1) || null;
}

function validateDockerReleasePolicy(policy, now = new Date()) {
  if (!/^\d+(?:\.\d+)*$/.test(String(policy.series || ''))) {
    throw new Error('Docker release policy requires a numeric series');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(policy.review_after || ''))) {
    throw new Error('Docker release policy requires review_after=YYYY-MM-DD');
  }
  const today = now.toISOString().slice(0, 10);
  if (today > policy.review_after) {
    throw new Error(`Docker release policy expired on ${policy.review_after}`);
  }
}

function selectDockerLatestForPolicy(
  tags,
  preferVariant = '',
  currentTag = '',
  policy = null,
  now = new Date(),
) {
  if (!policy) {
    return {
      latest: maxDockerStableTag(tags, preferVariant, currentTag),
      policy_applied: false,
      cross_track_versions: [],
    };
  }
  validateDockerReleasePolicy(policy, now);
  const seriesPrefix = `${policy.series}.`;
  const sameTrack = tags.filter((tag) => {
    const base = splitTagVariant(tag).base;
    return base === policy.series || base.startsWith(seriesPrefix);
  });
  if (!sameTrack.length) {
    throw new Error(`Docker release policy series ${policy.series} has no registry tags`);
  }
  const crossTrack = tags
    .filter((tag) => !sameTrack.includes(tag) && !isDockerPrereleaseTag(tag))
    .filter((tag) => {
      const parsed = splitTagVariant(tag);
      return parsed.kind === 'semver'
        && !parsed.variant
        && cmpSemver(parsed.base, splitTagVariant(currentTag).base) > 0;
    })
    .sort((a, b) => cmpSemver(splitTagVariant(a).base, splitTagVariant(b).base));
  return {
    latest: maxDockerStableTag(sameTrack, preferVariant, currentTag),
    policy_applied: true,
    release_track: policy.track,
    release_series: policy.series,
    policy_review_after: policy.review_after,
    cross_track_versions: crossTrack,
  };
}

function dockerBump(currentTag, latestTag) {
  const c = splitTagVariant(currentTag);
  const l = splitTagVariant(latestTag);
  if (c.kind === 'release_date' || l.kind === 'release_date') {
    const cmp = cmpReleaseDateTag(latestTag, currentTag);
    if (cmp > 0) return 'minor'; // treat calendar bumps as minor
    return 'none';
  }
  if (c.kind === 'semver' && l.kind === 'semver') return bumpType(c.base, l.base);
  if (currentTag !== latestTag) return 'unknown';
  return 'none';
}

async function listDockerHubTags(namespace, repo, { preferVariant = '', currentBase = '' } = {}) {
  const tags = new Set();
  const base = `https://hub.docker.com/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/tags`;

  async function drain(startUrl, maxPages = 8) {
    let url = startUrl;
    for (let i = 0; i < maxPages && url; i++) {
      const data = await fetchJson(url);
      for (const t of data.results || []) {
        if (t?.name) tags.add(t.name);
      }
      url = data.next || null;
    }
  }

  // Prefer filtered pulls so alpine/RELEASE tags are not drowned by arch/os noise
  const queries = [];
  if (preferVariant) {
    queries.push(`${base}?page_size=100&ordering=-last_updated&name=${encodeURIComponent(preferVariant)}`);
  }
  if (currentBase) {
    const major = String(currentBase).split('.')[0];
    if (major && /^\d+$/.test(major)) {
      queries.push(`${base}?page_size=100&ordering=-last_updated&name=${encodeURIComponent(major)}`);
    }
  }
  // MinIO-style calendar tags: probe recent years explicitly
  if (/^RELEASE/i.test(currentBase) || !preferVariant) {
    const year = new Date().getFullYear();
    for (let y = year + 1; y >= year - 4; y--) {
      queries.push(`${base}?page_size=100&ordering=-last_updated&name=${encodeURIComponent(`RELEASE.${y}`)}`);
      queries.push(`${base}?page_size=100&ordering=-last_updated&name=${encodeURIComponent(`RELEASE-${y}`)}`);
    }
    queries.push(`${base}?page_size=100&ordering=-last_updated&name=RELEASE`);
  }
  queries.push(`${base}?page_size=100&ordering=-last_updated`);

  for (const q of [...new Set(queries)]) {
    try {
      await drain(q, 4);
    } catch {
      /* continue other queries */
    }
  }
  return [...tags];
}

async function listQuayTags(namespace, repo) {
  const tags = [];
  let url = `https://quay.io/api/v1/repository/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/tag/?limit=100&onlyActiveTags=true`;
  for (let i = 0; i < 5 && url; i++) {
    const data = await fetchJson(url);
    for (const t of data.tags || []) {
      if (t?.name) tags.push(t.name);
    }
    // quay pagination via page
    if (data.has_additional) {
      url = `https://quay.io/api/v1/repository/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/tag/?limit=100&onlyActiveTags=true&page=${i + 2}`;
    } else {
      url = null;
    }
  }
  return tags;
}

async function listGhcrTags(namespace, repo) {
  // Public catalog is unreliable without token; try GitHub packages versions API (public packages)
  try {
    const url = `https://api.github.com/orgs/${encodeURIComponent(namespace)}/packages/container/${encodeURIComponent(repo)}/versions?per_page=30`;
    const data = await fetchJson(url);
    if (!Array.isArray(data)) return [];
    const tags = [];
    for (const v of data) {
      const t = v.metadata?.container?.tags || [];
      tags.push(...t);
    }
    return tags;
  } catch {
    return [];
  }
}

async function latestDockerStable(ref) {
  const sp = splitTagVariant(ref.tag);
  const prefer = sp.variant;
  const policyKey = `${ref.registry}/${ref.path}`;
  const releasePolicy = dependencyPolicy.docker[policyKey] || null;
  if (releasePolicy) validateDockerReleasePolicy(releasePolicy);
  let tags = [];
  if (ref.registry === 'docker.io') {
    tags = await listDockerHubTags(ref.namespace, ref.repo, {
      preferVariant: prefer,
      currentBase: sp.base || ref.tag,
    });
  } else if (ref.registry === 'quay.io') {
    tags = await listQuayTags(ref.namespace, ref.repo);
  } else if (ref.registry === 'ghcr.io') {
    tags = await listGhcrTags(ref.namespace, ref.repo);
  } else {
    return { error: `unsupported registry ${ref.registry}`, latest: null };
  }
  if (!tags.length) return { error: 'no tags found (private or unsupported)', latest: null };
  const selection = selectDockerLatestForPolicy(
    tags,
    prefer,
    ref.tag,
    releasePolicy,
  );
  return {
    ...selection,
    tags_sampled: tags.length,
    prefer_variant: prefer || null,
  };
}

function collectComposeImageRows() {
  const files = walkFiles(root, (n) => {
    if (COMPOSE_NAMES.has(n)) return true;
    // any *compose*.yml in tree
    return /compose.*\.(yml|yaml)$/i.test(n) || /docker-compose.*\.(yml|yaml)$/i.test(n);
  });
  const rows = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f) || path.basename(f);
    // image: value  (ignore comments)
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*image:\s*(?:["']([^"']+)["']|([^\s#]+))\s*$/);
      if (!m) continue;
      const rawExpr = (m[1] || m[2] || '').trim();
      if (!rawExpr) continue;
      const expanded = expandComposeEnv(rawExpr);
      if (isReleaseManagedComposeImage(rawExpr)) {
        const ref = parseImageRef(expanded);
        rows.push({
          ecosystem: 'docker',
          name: ref?.display?.split(':')[0] || rawExpr,
          manifest: rel,
          declared: rawExpr,
          current: ref?.tag || expanded || rawExpr,
          service_line: i + 1,
          skipped: true,
          release_managed: true,
          reason: 'First-party image version is governed by the checked-in runtime build or release workflow',
          outdated: false,
        });
        continue;
      }
      if (!expanded || expanded.includes('${')) {
        rows.push({
          ecosystem: 'docker',
          name: rawExpr,
          manifest: rel,
          declared: rawExpr,
          current: expanded || rawExpr,
          service_line: i + 1,
          skipped: true,
          reason: 'unresolved env in image tag',
          outdated: false,
        });
        continue;
      }
      const ref = parseImageRef(expanded);
      if (!ref) continue;
      rows.push({
        ecosystem: 'docker',
        name: ref.display.split(':')[0],
        image: ref.display,
        registry: ref.registry,
        manifest: rel,
        declared: rawExpr,
        current: ref.tag,
        ref,
        line: i + 1,
        dev: false,
      });
    }
  }
  for (const entry of dependencyPolicy.release_managed_images) {
    if (typeof entry === 'string' || !entry.dockerfile || !entry.source_image) continue;
    const dockerfile = path.join(root, entry.dockerfile);
    if (!fs.existsSync(dockerfile)) {
      rows.push({
        ecosystem: 'docker',
        name: entry.source_image,
        manifest: entry.dockerfile,
        skipped: true,
        error: `release-managed Dockerfile is missing: ${entry.dockerfile}`,
        outdated: false,
      });
      continue;
    }
    const text = fs.readFileSync(dockerfile, 'utf8');
    const sourceLine = text.split(/\r?\n/).find((line) => {
      const match = line.match(/^FROM\s+(\S+)/i);
      return match && parseImageRef(match[1])?.name === entry.source_image;
    });
    const raw = sourceLine?.match(/^FROM\s+(\S+)/i)?.[1];
    const ref = parseImageRef(raw);
    if (!ref) {
      rows.push({
        ecosystem: 'docker',
        name: entry.source_image,
        manifest: entry.dockerfile,
        skipped: true,
        error: `release-managed source image is missing: ${entry.source_image}`,
        outdated: false,
      });
      continue;
    }
    rows.push({
      ecosystem: 'docker',
      name: ref.display.split(':')[0],
      image: ref.display,
      registry: ref.registry,
      manifest: entry.dockerfile,
      declared: raw,
      current: ref.tag,
      ref,
      line: text.slice(0, text.indexOf(sourceLine)).split(/\r?\n/).length,
      derived_runtime_source: true,
      dev: false,
    });
  }
  return rows;
}

async function checkDockerCompose() {
  const rows = collectComposeImageRows();
  return mapPool(rows, Math.min(concurrency, 4), async (row) => {
    if (row.skipped) return row;
    try {
      const tag = row.current;
      if (FLOATING_TAGS.has(String(tag).toLowerCase())) {
        if (/^sha256:[a-f0-9]{64}$/.test(row.ref?.digest || '')) {
          return {
            ...row,
            skipped: true,
            reason: 'Immutable SHA-256 digest pin; release freshness not verified from the tag',
            outdated: false,
            floating_tag: false,
          };
        }
        return {
          ...row,
          name: row.ref?.display?.split(':')[0] || row.name,
          latest_stable: null,
          outdated: true,
          bump: 'major',
          floating_tag: true,
          category_hint: 'docker_floating_tag',
          error: undefined,
          note: 'Floating tag (latest/edge/…) — pin a stable version tag',
        };
      }
      const {
        latest,
        error,
        tags_sampled,
        prefer_variant,
        policy_applied,
        release_track,
        release_series,
        policy_review_after,
        cross_track_versions,
      } = await latestDockerStable(row.ref);
      if (error && !latest) {
        return { ...row, name: row.ref.display.split(':')[0], error, outdated: false };
      }
      if (!latest) {
        return { ...row, name: row.ref.display.split(':')[0], error: 'no stable tag found', outdated: false };
      }
      const outdated = latest !== tag && (dockerBump(tag, latest) !== 'none' || cmpSemver(splitTagVariant(latest).base, splitTagVariant(tag).base) > 0 || cmpReleaseDateTag(latest, tag) > 0 || latest !== tag);
      // refine outdated
      let isOut = false;
      let bump = 'none';
      if (latest !== tag) {
        bump = dockerBump(tag, latest);
        if (bump === 'none') {
          // variant-only change or opaque
          isOut = true;
          bump = 'patch';
        } else {
          isOut = true;
        }
        // if latest is "older" by semver, not outdated
        const cb = splitTagVariant(tag);
        const lb = splitTagVariant(latest);
        if (cb.kind === 'semver' && lb.kind === 'semver' && cmpSemver(lb.base, cb.base) < 0) {
          isOut = false;
          bump = 'none';
        }
        if (cb.kind === 'release_date' && cmpReleaseDateTag(latest, tag) < 0) {
          isOut = false;
          bump = 'none';
        }
      }
      const { ref: _r, ...rest } = row;
      return {
        ...rest,
        name: row.ref.display.split(':')[0],
        image: `${row.ref.display.split(':')[0]}:${tag}`,
        current: tag,
        latest_stable: latest,
        outdated: isOut,
        bump: isOut ? bump : 'none',
        tags_sampled,
        prefer_variant,
        policy_applied,
        release_track,
        release_series,
        policy_review_after,
        cross_track_versions,
      };
    } catch (e) {
      const { ref: _r, ...rest } = row;
      return {
        ...rest,
        name: row.ref?.display?.split(':')[0] || row.name,
        error: String(e.message || e),
        outdated: false,
      };
    }
  });
}

// ── stack snapshot (delegates to detect-stack.mjs) ──────────────────

function detectStackInline() {
  const script = path.join(__dirname, 'detect-stack.mjs');
  const r = spawnSync(process.execPath, [script, '--root', root], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout) {
    try {
      return JSON.parse(r.stdout);
    } catch {
      /* fall through */
    }
  }
  return { root, languages: [], frameworks: [], ecosystems: [], manifests: [] };
}

// ── findings + update map ───────────────────────────────────────────

function severityFor(bump) {
  if (bump === 'major') return 'MEDIUM';
  if (bump === 'minor') return 'LOW';
  if (bump === 'patch') return 'LOW';
  return 'LOW';
}

function suggestionFor(p) {
  if (p.floating_tag || p.category_hint === 'docker_floating_tag') {
    return {
      action: 'pin_docker_tag',
      command_hint: upgradeHint(p),
      notes: 'Replace latest/edge with an immutable version tag (semver or RELEASE.date). Rebuilds become reproducible.',
      priority: 'P2',
    };
  }
  if (p.ecosystem === 'docker' && p.bump === 'major') {
    return {
      action: 'plan_major_upgrade',
      command_hint: upgradeHint(p),
      notes: 'Major image bump — review release notes, backup volumes, rolling restart.',
      priority: 'P2',
    };
  }
  if (p.bump === 'major') {
    return {
      action: 'plan_major_upgrade',
      command_hint: upgradeHint(p),
      notes: 'Breaking changes likely — read changelog, run full suite, upgrade related framework stack together (e.g. Spring Boot BOM / React major).',
      priority: 'P2',
    };
  }
  if (p.bump === 'minor') {
    return {
      action: 'bump_minor',
      command_hint: upgradeHint(p),
      notes:
        p.ecosystem === 'docker'
          ? 'Minor image update — prefer same variant (-alpine/-slim). Smoke healthchecks after pull.'
          : 'Safe to batch with other minors in the same ecosystem; re-run tests.',
      priority: 'P3',
    };
  }
  return {
    action: 'bump_patch',
    command_hint: upgradeHint(p),
    notes:
      p.ecosystem === 'docker'
        ? 'Patch image tag — low risk; pull + recreate service.'
        : 'Patch/bugfix — prefer soon; low risk.',
    priority: 'P3',
  };
}

function upgradeHint(p) {
  switch (p.ecosystem) {
    case 'npm': {
      const target = p.registry_name && p.registry_name !== p.name
        ? `${p.name}@npm:${p.registry_name}@${p.latest_stable}`
        : `${p.name}@${p.latest_stable}`;
      return `cd ${path.dirname(p.manifest) || '.'} && (bun add ${target} || npm install ${target})`;
    }
    case 'go':
      return `cd ${path.dirname(p.manifest) || '.'} && go get ${p.name}@${p.latest_stable} && go mod tidy`;
    case 'maven':
      return `Set <version>${p.latest_stable}</version> for ${p.name} in ${p.manifest} (or BOM property)`;
    case 'gradle':
      return `Set ${p.name} to ${p.latest_stable} in ${p.manifest} / libs.versions.toml`;
    case 'cargo':
      return `cargo update -p ${p.name} --precise ${p.latest_stable}`;
    case 'pypi':
      return `pip install '${p.name}==${p.latest_stable}'  # pin in requirements/pyproject`;
    case 'spm':
      return `Update ${p.name} to ${p.latest_stable} in Package.swift (from:) and resolve`;
    case 'composer':
      return `composer require ${p.name}:${p.latest_stable}`;
    case 'rubygems':
      return `bundle update ${p.name}  # gem '${p.name}', '${p.latest_stable}'`;
    case 'docker':
      if (p.floating_tag) {
        return `Pin image tag in ${p.manifest}: image: ${p.name}:<stable-version> (avoid latest/edge)`;
      }
      return `In ${p.manifest}: image: ${p.name}:${p.latest_stable}`;
    default:
      return `Bump ${p.name} → ${p.latest_stable}`;
  }
}

function toFindings(packages) {
  const findings = [];
  for (const p of packages) {
    if (!p.outdated || p.error || p.skipped) continue;
    const sug = suggestionFor(p);
    const isDocker = p.ecosystem === 'docker';
    const floating = Boolean(p.floating_tag);
    const title = floating
      ? `Docker floating tag: ${p.name}:${p.current} — pin a stable tag`
      : isDocker
        ? `Docker image outdated: ${p.name}:${p.current} → ${p.latest_stable} (${p.bump})`
        : `Outdated stable: ${p.name} ${p.current} → ${p.latest_stable} (${p.bump})`;
    findings.push({
      agent: 'Prism',
      domain: 'deps',
      category: floating ? 'docker_floating_tag' : isDocker ? 'docker_image_outdated' : 'outdated_stable',
      severity: floating ? 'MEDIUM' : severityFor(p.bump),
      confidence: 'high',
      title,
      path: p.manifest,
      line: p.line || 0,
      evidence: isDocker
        ? `docker:${p.name} tag=${p.current} latest_stable=${p.latest_stable || 'n/a'} bump=${p.bump}${p.note ? ' · ' + p.note : ''}`
        : `${p.ecosystem}:${p.name} current=${p.current} latest_stable=${p.latest_stable} bump=${p.bump}${p.dev ? ' (dev)' : ''}${p.indirect ? ' (indirect)' : ''}`,
      impact: floating
        ? 'Floating tags (latest/edge) are mutable — rebuilds are non-reproducible and may pull breaking changes unexpectedly.'
        : p.bump === 'major'
          ? 'Missing stable major release — may include breaking changes; plan upgrade.'
          : 'Not on latest stable release — missing fixes and improvements.',
      fix: sug.command_hint,
      suggestion: sug,
      package: p.name,
      ecosystem: p.ecosystem,
      current_version: p.current,
      latest_stable: p.latest_stable,
      bump: p.bump,
      status: 'open',
      blocks_pr: false,
      test_red_green: {
        name: isDocker
          ? `docker/${p.name}:${p.latest_stable || 'pinned'}`
          : `deps/${p.ecosystem}/${p.name}@${p.latest_stable}`,
        assert_before: floating
          ? 'image uses latest/edge/floating tag'
          : `image/tag < ${p.latest_stable}`,
        assert_after: floating
          ? 'compose pins immutable stable tag; compose config validates'
          : `compose/image pins ${p.latest_stable}; stack healthy`,
      },
    });
  }
  return findings;
}

function buildUpdateMap(packages, stack) {
  const outdated = packages.filter((p) => p.outdated && !p.error);
  const by_ecosystem = {};
  for (const p of packages) {
    const eco = p.ecosystem || 'unknown';
    if (!by_ecosystem[eco]) {
      by_ecosystem[eco] = { total: 0, outdated: 0, up_to_date: 0, updates: [] };
    }
    if (p.error || p.skipped) continue;
    by_ecosystem[eco].total++;
    if (p.outdated) {
      by_ecosystem[eco].outdated++;
      by_ecosystem[eco].updates.push({
        name: p.name,
        current: p.current,
        latest_stable: p.latest_stable,
        bump: p.bump,
        manifest: p.manifest,
        suggestion: suggestionFor(p),
        frameworks: inferPackageFrameworks(p, stack),
      });
    } else {
      by_ecosystem[eco].up_to_date++;
    }
  }
  for (const eco of Object.keys(by_ecosystem)) {
    by_ecosystem[eco].updates.sort(
      (a, b) =>
        ({ major: 0, minor: 1, patch: 2, unknown: 3 }[a.bump] ?? 9) -
          ({ major: 0, minor: 1, patch: 2, unknown: 3 }[b.bump] ?? 9) || a.name.localeCompare(b.name),
    );
  }

  const suggestions = outdated
    .map((p) => ({
      package: p.name,
      ecosystem: p.ecosystem,
      from: p.current,
      to: p.latest_stable,
      bump: p.bump,
      manifest: p.manifest,
      ...suggestionFor(p),
      frameworks: inferPackageFrameworks(p, stack),
    }))
    .sort(
      (a, b) =>
        ({ major: 0, minor: 1, patch: 2 }[a.bump] ?? 9) - ({ major: 0, minor: 1, patch: 2 }[b.bump] ?? 9) ||
        a.package.localeCompare(b.package),
    );

  return {
    stack: {
      languages: stack.languages || [],
      frameworks: stack.frameworks || [],
      ecosystems: stack.ecosystems || [],
      package_managers: stack.package_managers || [],
      manifests: stack.manifests || [],
    },
    by_ecosystem,
    suggestions,
    batches: buildBatches(suggestions, stack),
  };
}

function inferPackageFrameworks(p, stack) {
  const fw = [];
  const n = `${p.name} ${p.groupId || ''}`.toLowerCase();
  if (/react|@mui|@emotion/.test(n)) fw.push('react');
  if (/vite|@vitejs/.test(n)) fw.push('vite');
  if (/next/.test(n)) fw.push('next');
  if (/springframework|spring-boot/.test(n)) fw.push('spring-boot');
  if (/jetbrains\.kotlin|kotlin-/.test(n)) fw.push('kotlin');
  if (/swift|apple\//.test(n)) fw.push('swift');
  if (/vue/.test(n)) fw.push('vue');
  // attach stack frameworks that share ecosystem
  if (p.ecosystem === 'npm' && (stack.frameworks || []).includes('react')) {
    if (!fw.includes('react') && /react/.test(n)) fw.push('react');
  }
  return [...new Set(fw)];
}

function buildBatches(suggestions, stack) {
  const batches = [];
  const docker = suggestions.filter((s) => s.ecosystem === 'docker');
  const majors = suggestions.filter((s) => s.bump === 'major' && s.ecosystem !== 'docker');
  const minors = suggestions.filter((s) => s.bump === 'minor' && s.ecosystem !== 'docker');
  const patches = suggestions.filter((s) => s.bump === 'patch' && s.ecosystem !== 'docker');

  if (docker.length) {
    batches.push({
      id: 'batch-docker',
      title: 'Docker Compose image tags',
      priority: 'P2',
      packages: docker.map((s) => s.package),
      rationale: 'Pin floating tags; bump versioned images keeping variant (-alpine). Smoke compose up + healthchecks.',
    });
  }

  if (patches.length) {
    batches.push({
      id: 'batch-patches',
      title: 'Patch updates (low risk)',
      priority: 'P3',
      packages: patches.map((s) => s.package),
      rationale: 'Bugfix releases only — batch per ecosystem and run unit tests.',
    });
  }
  if (minors.length) {
    batches.push({
      id: 'batch-minors',
      title: 'Minor updates',
      priority: 'P3',
      packages: minors.map((s) => s.package),
      rationale: 'Backward-compatible features — group by ecosystem (npm / go / maven).',
    });
  }
  if (majors.length) {
    const spring = majors.filter((s) => /spring/i.test(s.package) || (s.frameworks || []).includes('spring-boot'));
    const react = majors.filter((s) => (s.frameworks || []).includes('react') || /react|@mui/i.test(s.package));
    if (spring.length) {
      batches.push({
        id: 'batch-spring-major',
        title: 'Spring / Java major stack',
        priority: 'P2',
        packages: spring.map((s) => s.package),
        rationale: 'Upgrade BOM / spring-boot-starter-parent first, then align plugins.',
      });
    }
    if (react.length) {
      batches.push({
        id: 'batch-react-major',
        title: 'React / frontend major',
        priority: 'P2',
        packages: react.map((s) => s.package),
        rationale: 'Align react, react-dom, types, and meta-framework (vite/next) together.',
      });
    }
    const rest = majors.filter((s) => !spring.includes(s) && !react.includes(s));
    if (rest.length) {
      batches.push({
        id: 'batch-other-majors',
        title: 'Other major upgrades (one PR each)',
        priority: 'P2',
        packages: rest.map((s) => s.package),
        rationale: 'Isolate majors with dedicated changelog review.',
      });
    }
  }
  if ((stack.frameworks || []).length) {
    batches.push({
      id: 'stack-detected',
      title: `Detected stack: ${(stack.frameworks || []).join(', ') || 'n/a'}`,
      priority: 'info',
      packages: [],
      rationale: `Languages: ${(stack.languages || []).join(', ') || '—'} · Ecosystems: ${(stack.ecosystems || []).join(', ') || '—'}`,
    });
  }
  return batches;
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const packages = [];
  const errors = [];
  const stack = detectStackInline();

  const runners = [
    ['npm', checkNpm],
    ['go', checkGo],
    ['cargo', checkCargo],
    ['pypi', checkPypi],
    ['maven+gradle', checkMavenGradle],
    ['spm', checkSpm],
    ['composer', checkComposer],
    ['rubygems', checkRubygems],
    ['docker-compose', checkDockerCompose],
  ];

  for (const [eco, fn] of runners) {
    try {
      const rows = await fn();
      packages.push(...rows);
    } catch (e) {
      errors.push({ ecosystem: eco, error: String(e.message || e) });
    }
  }

  // de-dupe same eco+name+manifest
  const seen = new Set();
  const uniq = [];
  for (const p of packages) {
    const k = `${p.ecosystem}::${p.name}::${p.manifest}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }

  const outdated = uniq.filter((p) => p.outdated);
  const checked = uniq.filter((p) => !p.error && !p.skipped);
  const update_map = buildUpdateMap(uniq, stack);

  const report = {
    generated_at: new Date().toISOString(),
    root,
    stack,
    policy: {
      stable_only: true,
      exclude: 'alpha|beta|rc|pre|preview|dev|canary|snapshot|experimental|nightly|unstable|next|pseudo-versions|maven-milestones',
      include_dev: includeDev,
      include_indirect: includeIndirect,
    },
    summary: {
      checked: checked.length,
      outdated: outdated.length,
      up_to_date: checked.length - outdated.length,
      errors: uniq.filter((p) => p.error).length + errors.length,
      by_bump: {
        major: outdated.filter((p) => p.bump === 'major').length,
        minor: outdated.filter((p) => p.bump === 'minor').length,
        patch: outdated.filter((p) => p.bump === 'patch').length,
      },
      by_ecosystem: {},
      languages: stack.languages || [],
      frameworks: stack.frameworks || [],
    },
    update_map,
    runner_errors: errors,
    packages: uniq.map(({ _hints, _main, ...rest }) => rest),
  };

  for (const p of uniq) {
    const eco = p.ecosystem || 'unknown';
    if (!report.summary.by_ecosystem[eco]) {
      report.summary.by_ecosystem[eco] = { checked: 0, outdated: 0 };
    }
    if (!p.error && !p.skipped) report.summary.by_ecosystem[eco].checked++;
    if (p.outdated) report.summary.by_ecosystem[eco].outdated++;
  }

  const findings = toFindings(uniq);
  report.findings_count = findings.length;

  const json = JSON.stringify(report, null, 2) + '\n';
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, json);
  } else {
    process.stdout.write(json);
  }

  if (findingsPath) {
    fs.mkdirSync(path.dirname(path.resolve(findingsPath)), { recursive: true });
    fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2) + '\n');
  }

  console.error(
    `check-deps-latest: stack=[${(stack.frameworks || []).join(',') || (stack.languages || []).join(',')}] ` +
      `checked=${report.summary.checked} outdated=${report.summary.outdated} ` +
      `(major=${report.summary.by_bump.major} minor=${report.summary.by_bump.minor} patch=${report.summary.by_bump.patch})` +
      ` errors=${report.summary.errors}` +
      (outPath ? ` → ${outPath}` : '') +
      (findingsPath ? ` findings→ ${findingsPath}` : ''),
  );
  if (report.summary.errors > 0) {
    process.exitCode = 1;
  }
}

export {
  parseMavenCoordsFromPom,
  parseMavenPropertyPins,
  toFindings,
  MAVEN_BOM_PROPERTY_COORDS,
  checkNpm,
  selectNpmVersionForPolicy,
  selectDockerLatestForPolicy,
  isReleaseManagedComposeImage,
};

// Only run the scan when invoked as a CLI — the parsers above are unit-tested by import.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

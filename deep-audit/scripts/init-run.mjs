#!/usr/bin/env node
/**
 * init-run.mjs — cria o pack da rodada e resolve os defaults de profundidade.
 *
 *   node init-run.mjs --root . [--mode delta|full] [--only a,b] [--depth fast|deep]
 *                     [--effort medium|high|max] [--base origin/main] [--scope dir,dir]
 *                     [--out docs/audits/deep-audit/<data>-<mode>] [--app "nome"]
 *                     [--version 1.2.3]
 *
 * Regra de defaults (não peça flag extra ao usuário):
 *   delta → depth=fast,  effort=n/a
 *   full  → depth=deep,  effort=max      ← --full JÁ é o teto
 *   depth=deep sem --effort → effort=max
 *
 * Escreve <out>/run-meta.json e imprime as variáveis do pack em shell-eval.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliArg, cliFlag, nowStamp } from './lib-findings.mjs';

const root = path.resolve(cliArg('root', '.'));
const mode = cliFlag('full') ? 'full' : (cliArg('mode', 'delta') === 'full' ? 'full' : 'delta');
const only = cliArg('only', '');
const scope = cliArg('scope', '');
const base = cliArg('base', '');

let depth = cliArg('depth', '');
if (!depth) depth = mode === 'full' ? 'deep' : 'fast';
if (!['fast', 'deep'].includes(depth)) depth = 'fast';

let effort = cliArg('effort', '');
if (depth === 'deep') {
  if (!['medium', 'high', 'max'].includes(effort)) effort = 'max';
} else {
  effort = 'n/a';
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function defaultBase() {
  if (base) return base;
  for (const cand of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git('rev-parse', '--verify', '--quiet', cand)) return cand;
  }
  return '';
}

const resolvedBase = defaultBase();
const head = git('rev-parse', '--short', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const date = new Date().toISOString().slice(0, 10);

const tryRead = (file) => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return '';
  }
};
const tryJsonField = (file, field) => {
  try {
    const v = JSON.parse(tryRead(file) || '{}')[field];
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
};

/** Nome da app: --app > manifesto do projeto > remote git > basename do root. */
function detectApp() {
  const explicit = cliArg('app', '');
  if (explicit) return explicit;
  const tryJsonName = (file) => tryJsonField(file, 'name');
  const pkg = tryJsonName('package.json');
  if (pkg) return pkg;
  const gomod = tryRead('go.mod').match(/^module\s+(\S+)/m);
  if (gomod) return gomod[1].split('/').pop();
  const cargo = tryRead('Cargo.toml').match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (cargo) return cargo[1];
  const pyproject = tryRead('pyproject.toml').match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (pyproject) return pyproject[1];
  const composer = tryJsonName('composer.json');
  if (composer) return composer;
  const remote = git('remote', 'get-url', 'origin');
  if (remote) {
    const repo = remote.split('/').pop().replace(/\.git$/, '');
    if (repo) return repo;
  }
  return path.basename(root);
}
const app = detectApp();

/**
 * Versão do projeto: --version > manifesto > arquivo VERSION > tag git.
 * Devolve { version, version_source } — a fonte importa tanto quanto o número
 * (uma tag git é o que está publicado; um manifesto é o que está em curso).
 */
function detectVersion() {
  const explicit = cliArg('version', '');
  if (explicit) return { version: explicit, version_source: '--version' };

  const rx = (file, re) => {
    const m = (tryRead(file) || '').match(re);
    return m ? { version: m[1].trim(), version_source: file } : null;
  };

  const pkg = tryJsonField('package.json', 'version');
  if (pkg) return { version: pkg, version_source: 'package.json' };

  const candidates = [
    // Makefile: VERSION = / ?= / :=   (comum em projetos Swift/Go/C sem manifesto)
    ['Makefile', /^\s*VERSION\s*[:?]?=\s*([^\s#]+)/m],
    ['Cargo.toml', /^\s*version\s*=\s*"([^"]+)"/m],
    ['pyproject.toml', /^\s*version\s*=\s*"([^"]+)"/m],
    ['setup.cfg', /^\s*version\s*=\s*([^\s#]+)/m],
    ['Bundler.toml', /^\s*version\s*=\s*"([^"]+)"/m],
    ['gradle.properties', /^\s*version\s*=\s*([^\s#]+)/m],
    ['build.gradle.kts', /^\s*version\s*=\s*"([^"]+)"/m],
    ['build.gradle', /^\s*version\s*=\s*['"]([^'"]+)['"]/m],
    ['VERSION', /^\s*v?([0-9][^\s]*)/],
    ['VERSION.txt', /^\s*v?([0-9][^\s]*)/],
    ['version.txt', /^\s*v?([0-9][^\s]*)/],
    // Info.plist: CFBundleShortVersionString é a versão de marketing
    ['Resources/Info.plist', /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/],
    ['Info.plist', /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/],
    // pom.xml: a 1ª <version> fora de <parent>/<dependency> é a do projeto
    ['pom.xml', /<artifactId>[^<]*<\/artifactId>\s*<version>([^<]+)<\/version>/],
  ];
  for (const [file, re] of candidates) {
    const hit = rx(file, re);
    if (hit && hit.version && !/^\$\{/.test(hit.version)) return hit;
  }

  const composer = tryJsonField('composer.json', 'version');
  if (composer) return { version: composer, version_source: 'composer.json' };

  const described = git('describe', '--tags', '--abbrev=0');
  if (described) return { version: described.replace(/^v/, ''), version_source: 'git tag' };

  return { version: null, version_source: null };
}
const { version, version_source: versionSource } = detectVersion();

const outDir = path.resolve(
  root,
  cliArg('out', path.join('docs', 'audits', 'deep-audit', `${date}-${mode}`)),
);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'sec-deep', 'votes'), { recursive: true });

const changedFiles =
  mode === 'delta' && resolvedBase
    ? git('diff', '--name-only', `${resolvedBase}...HEAD`).split('\n').filter(Boolean)
    : [];

const metaPath = path.join(outDir, 'run-meta.json');
let history = [];
if (fs.existsSync(metaPath)) {
  try {
    history = JSON.parse(fs.readFileSync(metaPath, 'utf8')).history || [];
  } catch {
    history = [];
  }
}
history.unshift({ at: nowStamp(), mode, depth, effort, head, event: 'init' });

const meta = {
  generated_at: nowStamp(),
  root,
  app: app || null,
  version: version || null,
  version_source: versionSource || null,
  mode,
  depth,
  effort,
  base: resolvedBase || null,
  head: head || null,
  branch: branch || null,
  only: only ? only.split(',').map((s) => s.trim()).filter(Boolean) : [],
  scope: scope ? scope.split(',').map((s) => s.trim()).filter(Boolean) : [],
  changed_files: changedFiles,
  changed_file_count: changedFiles.length,
  history: history.slice(0, 50),
};
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

// shell-eval: eval "$(node init-run.mjs --full)"
const lines = [
  `OUT=${JSON.stringify(outDir)}`,
  `APP=${JSON.stringify(app || '')}`,
  `VERSION=${JSON.stringify(version || '')}`,
  `BRANCH=${JSON.stringify(branch || '')}`,
  `MODE=${mode}`,
  `DEPTH=${depth}`,
  `EFFORT=${effort}`,
  `BASE=${JSON.stringify(resolvedBase)}`,
  `SEC_DIR=${JSON.stringify(path.join(outDir, 'sec-deep'))}`,
];
process.stdout.write(lines.join('\n') + '\n');
console.error(
  `init-run: app=${app || 'n/a'} v=${version || 'n/a'}${versionSource ? ` (${versionSource})` : ''} ` +
    `branch=${branch || 'n/a'} mode=${mode} depth=${depth} effort=${effort} base=${resolvedBase || 'n/a'} ` +
    `${mode === 'delta' ? `changed=${changedFiles.length} ` : ''}→ ${outDir}`,
);

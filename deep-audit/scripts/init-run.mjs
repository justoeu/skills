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
 * Escreve <out>/run-meta.json e emite JSON estruturado; nunca use eval.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { writeJson, metaFor, expectedStages, git as checkedGit, sourceState, acquireLock } from './pack-state.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliArg, cliFlag, nowStamp } from './lib-findings.mjs';

const root = fs.realpathSync(path.resolve(cliArg('root', '.')));
const resumeMeta = cliArg('resume') ? metaFor(path.resolve(root, cliArg('resume'))) : null;
const mode = cliFlag('full') ? 'full' : cliArg('mode', resumeMeta?.mode || 'delta');
if (!['delta', 'full'].includes(mode)) throw new Error('mode inválido');
const only = cliArg('only', '');
const scope = cliArg('scope', '');
const base = cliArg('base', '');

let depth = cliArg('depth', resumeMeta?.depth || '');
if (!depth) depth = mode === 'full' ? 'deep' : 'fast';
if (!['fast', 'deep'].includes(depth)) throw new Error('depth inválido');

let effort = cliArg('effort', resumeMeta?.effort || '');
if (depth === 'deep') {
  if (!effort) effort = 'max';
  if (!['medium', 'high', 'max'].includes(effort)) throw new Error('effort inválido');
} else {
  effort = 'n/a';
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function defaultBase() {
  if (base) return base;
  if (resumeMeta) return resumeMeta.base || '';
  for (const cand of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git('rev-parse', '--verify', '--quiet', cand)) return cand;
  }
  return '';
}

const resolvedBase = defaultBase();
const head = git('rev-parse', 'HEAD');
const hasGit = Boolean(head);
if (!hasGit && ((!cliFlag('no-git') && resumeMeta?.git !== false) || mode !== 'full')) throw new Error('sem HEAD Git: use --full --no-git explicitamente');
if (mode === 'delta' && !resolvedBase) throw new Error('delta sem base: passe --base válido ou use --full');
const baseCommit = resolvedBase ? checkedGit(root, ['rev-parse', '--verify', `${resolvedBase}^{commit}`]) : null;
if (baseCommit) checkedGit(root, ['merge-base', baseCommit, 'HEAD']);
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || 'NO_GIT';
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

const runId = randomUUID();
const resume = cliArg('resume', '');
if (resume) {
  const out = path.resolve(root, resume), meta = metaFor(out);
  if (meta.root !== root || meta.branch !== branch || meta.head !== (head || null) || meta.mode !== mode || meta.depth !== depth || meta.effort !== effort ||
      (base && meta.base_commit !== baseCommit) || (only && JSON.stringify(meta.only) !== JSON.stringify(only.split(','))) ||
      (scope && JSON.stringify(meta.scope) !== JSON.stringify(scope.split(',')))) throw new Error('retomada incompatível: root/branch/HEAD/base/escopo mudou; crie nova run');
  process.stdout.write(JSON.stringify({ out, ...meta, current: sourceState(meta, out) }) + '\n');
} else {
  const outDir = path.resolve(root, cliArg('out', path.join('docs', 'audits', 'deep-audit', `${date}-${mode}-${runId}`)));
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw new Error('OUT já existe e não está vazio; use --resume explicitamente ou outro OUT');
  const selected = only ? only.split(',').map(s => s.trim()).filter(Boolean) : [];
  const required = expectedStages(selected, depth);
  const changedFiles = mode === 'delta'
    ? [...new Set([...checkedGit(root, ['diff', '--name-only', `${baseCommit}...HEAD`]).split('\n'), ...checkedGit(root, ['diff', '--name-only', 'HEAD']).split('\n')])].filter(Boolean)
    : [];
  const meta = {
    schema_version: 2, run_id: runId, generated_at: nowStamp(), root, git: hasGit,
    app: app || null, version: version || null, version_source: versionSource || null,
    mode, depth, effort, base: resolvedBase || null, base_commit: baseCommit,
    head: head || null, branch, only: selected,
    scope: scope ? scope.split(',').map(s => s.trim()).filter(Boolean) : [],
    changed_files: changedFiles, changed_file_count: changedFiles.length,
    expected_stages: required, stages: {},
    legacy_source: cliArg('legacy', '') ? path.resolve(cliArg('legacy')) : null,
    history: [{ at: nowStamp(), event: 'init' }],
  };
  fs.mkdirSync(outDir, { recursive: true });
  const release = acquireLock(outDir);
  if (fs.readdirSync(outDir).some(name => name !== '.writer-lock')) throw new Error('OUT deixou de estar vazio; outra inicialização venceu');
  fs.mkdirSync(path.join(outDir, 'sec-deep', 'votes'), { recursive: true });
  writeJson(path.join(outDir, 'run-meta.json'), meta);
  release();
  process.stdout.write(JSON.stringify({ out: outDir, ...meta }) + '\n');
}

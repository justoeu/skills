/** Schema 2 pack persistence and evidence. No network; project files are data. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { LENSES, dedupeKey, normalizeFinding, idPrefix } from './lib-findings.mjs';

export const SCHEMA = 2;
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function readHashed(file) { const bytes = fs.readFileSync(file); return { doc: JSON.parse(bytes.toString('utf8')), digest: hash(bytes) }; }
export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(tmp, { force: true }); }
}
export const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
export function acquireLock(dir) {
  const lock = path.join(dir, '.writer-lock');
  const prepared = path.join(dir, `.lock-${randomUUID()}`);
  const owner = { pid: process.pid, host: os.hostname(), token: randomUUID(), at: new Date().toISOString() };
  fs.mkdirSync(prepared); writeJson(path.join(prepared, 'owner.json'), owner);
  try { fs.renameSync(prepared, lock); }
  catch { fs.rmSync(prepared, { recursive: true, force: true }); throw new Error('pack ocupado: outro escritor ou lock abandonado; retry, ou run-state recover-lock após verificar o dono'); }
  let released = false;
  const release = () => {
    if (released) return; released = true;
    try { if (readJson(path.join(lock, 'owner.json')).token === owner.token) fs.rmSync(lock, { recursive: true }); } catch {}
  };
  process.once('exit', release);
  return () => { release(); process.removeListener('exit', release); };
}
export function recoverLock(dir) {
  const lock = path.join(dir, '.writer-lock');
  const owner = readJson(path.join(lock, 'owner.json'));
  if (owner.host !== os.hostname() || !Number.isInteger(owner.pid)) throw new Error('dono desconhecido/remoto; recuperação manual necessária');
  try { process.kill(owner.pid, 0); throw new Error('dono do lock ainda está vivo'); }
  catch (e) { if (e.code !== 'ESRCH') throw e; }
  // Recovery is an explicit offline operation. Refuse if ownership changed.
  if (readJson(path.join(lock, 'owner.json')).token !== owner.token) throw new Error('dono mudou; tente novamente');
  fs.renameSync(lock, `${lock}.recovered-${owner.token}`);
}
export function metaFor(dir) {
  const meta = readJson(path.join(dir, 'run-meta.json'));
  if (meta.schema_version !== SCHEMA || !meta.run_id || !Array.isArray(meta.expected_stages)) throw new Error('pack legado/inválido: schema 2 necessário; crie nova run, preserve o legado como histórico');
  return meta;
}
export function git(root, args, optional = false) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !optional) throw new Error(`git ${args[0]} falhou: ${r.stderr || r.error || r.status}`);
  return r.status === 0 ? r.stdout.trim() : '';
}
const ignoredGenerated = rel => /^docs\/audits\/(deep-audit(?:\/|-)|deep-audit$)/.test(rel);
export function sourceState(meta, dir) {
  const root = fs.realpathSync(meta.root);
  const pack = fs.realpathSync(dir);
  let files, head = '', branch = 'NO_GIT';
  if (meta.git !== false) {
    head = git(root, ['rev-parse', 'HEAD']); branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (head !== meta.head || branch !== meta.branch) throw new Error('branch/HEAD mudou desde init; inicie nova run, sem reatribuir evidência antiga');
    const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('não foi possível inventariar fonte Git');
    files = [...new Set(r.stdout.split('\0').filter(Boolean))];
  } else {
    files = [];
    const walk = rel => { for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (['.git', 'node_modules', '.venv', 'vendor'].includes(e.name)) continue;
      const name = path.join(rel, e.name); if (path.resolve(root, name) === pack || ignoredGenerated(name)) continue;
      if (e.isDirectory()) walk(name); else files.push(name);
    } }; walk('');
  }
  const entries = [];
  for (const rel of files.sort()) {
    const full = path.resolve(root, rel);
    if (full === pack || full.startsWith(pack + path.sep) || ignoredGenerated(rel)) continue;
    try {
      const stat = fs.lstatSync(full);
      entries.push([rel, stat.mode & 0o777, stat.isSymbolicLink() ? `link:${fs.readlinkSync(full)}` : stat.isFile() ? hash(fs.readFileSync(full)) : 'directory']);
    } catch (e) { if (e.code !== 'ENOENT') throw e; entries.push([rel, 'deleted']); }
  }
  return { head, branch, source_hash: hash({ root, head, branch, entries, scope: meta.scope, base: meta.base_commit }) };
}
export function snapshot(dir) {
  const meta = metaFor(dir);
  const s = { schema_version: SCHEMA, run_id: meta.run_id, snapshot_id: randomUUID(), ...sourceState(meta, dir), created_at: new Date().toISOString() };
  writeJson(path.join(dir, 'snapshots', `${s.snapshot_id}.json`), s); return s;
}
export function readSnapshot(dir, id, current = true) {
  safeId(id);
  const s = readJson(path.join(dir, 'snapshots', `${id}.json`)); const meta = metaFor(dir);
  if (s.run_id !== meta.run_id || !s.source_hash || (current && s.source_hash !== sourceState(meta, dir).source_hash)) throw new Error('snapshot ausente/antigo ou de outra run; repita a etapa sobre snapshot atual');
  return s;
}
export function safeId(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`id inseguro/inválido: ${id}`); return id; }
export function artifactPath(dir, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('artefato deve ser relativo ao pack');
  const root = fs.realpathSync(dir), p = path.resolve(root, relative);
  if (!p.startsWith(root + path.sep) || !fs.realpathSync(p).startsWith(root + path.sep)) throw new Error('artefato fora do pack');
  return p;
}
export const fileHash = file => hash(fs.readFileSync(file));
export function findingsArray(doc, label = 'achados') {
  const a = Array.isArray(doc) ? doc : doc?.findings ?? doc?.verified;
  if (!Array.isArray(a) || a.some(x => !x || typeof x !== 'object' || !x.title || !(x.path || x.lens === 'deps' || x.domain === 'deps'))) throw new Error(`${label}: esperado array de achados válidos (array vazio é permitido)`);
  return a;
}
export function identity(f) { return hash(dedupeKey(normalizeFinding(f))); }
export function findingHash(f) {
  const keys = ['title', 'path', 'line', 'lens', 'category', 'classic_pattern', 'package', 'severity', 'confidence', 'description', 'evidence', 'impact', 'fix', 'snippet', 'source', 'sink', 'symbol', 'cwe'];
  const n = normalizeFinding(f); return hash(Object.fromEntries(keys.filter(k => n[k] !== undefined).map(k => [k, n[k]])));
}
export const stableId = f => `${idPrefix(normalizeFinding(f))}-${identity(f).slice(0, 16).toUpperCase()}`;
export function expectedStages(only, depth) {
  for (const lens of only) if (!LENSES.includes(lens)) throw new Error(`lente desconhecida: ${lens}`);
  const required = [...new Set([...(only.length ? only : LENSES), 'deps'])];
  if (required.includes('security') && depth === 'deep') required.push('security_inventory', 'security_hunters');
  return required;
}
export function validateDeps(doc) {
  if (!doc || !Array.isArray(doc.packages) || !doc.summary || !Array.isArray(doc.runner_errors)) throw new Error('deps-latest: schema inválido');
  for (const k of ['checked', 'outdated', 'up_to_date', 'errors']) if (!Number.isInteger(doc.summary[k]) || doc.summary[k] < 0) throw new Error(`deps-latest.summary.${k} inválido`);
  if (doc.summary.checked !== doc.packages.length || doc.summary.errors || doc.runner_errors.length || doc.packages.some(p => p.error || p.skipped)) throw new Error('deps-latest: consultas incompletas/falhas; reporte a lacuna, não conclua a etapa');
}
export function validateStageArtifacts(dir, stage, artifacts) {
  if (!Array.isArray(artifacts) || !artifacts.length) throw new Error('etapa exige artefatos');
  const docs = artifacts.map(a => ({ name: a, doc: readJson(artifactPath(dir, a)) }));
  if (LENSES.includes(stage)) {
    const agents = docs.filter(d => /^agent-.*\.json$/.test(d.name));
    if (!agents.length) throw new Error(`${stage}: falta resultado agent-*.json (inclusive [] explícito)`);
    for (const d of agents) for (const f of findingsArray(d.doc, d.name)) if (normalizeFinding(f).lens !== stage) throw new Error(`${d.name}: achado de outra lente`);
  }
  if (stage === 'deps') {
    const d = docs.find(d => d.name === 'deps-latest.json'); if (!d) throw new Error('deps exige deps-latest.json'); validateDeps(d.doc);
  }
  if (stage === 'security_inventory') {
    const d = docs.find(d => d.name === 'sec-deep/inventory.json');
    if (!d || d.doc.status !== 'complete' || !Array.isArray(d.doc.components) || !d.doc.scope_note || !Array.isArray(d.doc.required_hunters)) throw new Error('inventário de segurança incompleto');
    const names = d.doc.components.map(c => c?.name);
    const planned = d.doc.required_hunters.map(h => `${h.component}:${h.lens}`);
    if (!names.length) {
      if (d.doc.no_attack_surface !== true || !d.doc.reason || planned.length) throw new Error('inventário sem componentes exige no_attack_surface e razão');
    } else if (names.some(n => !n) || new Set(names).size !== names.length || d.doc.components.some(c => !Array.isArray(c.paths) || !c.paths.length) || new Set(planned).size !== planned.length || d.doc.required_hunters.some(h => !names.includes(h.component) || !h.lens) || names.some(n => !d.doc.required_hunters.some(h => h.component === n))) throw new Error('assignments incompletos/duplicados no inventário');
  }
  if (stage === 'security_hunters') {
    const d = docs.find(d => d.name === 'sec-deep/candidates.json');
    const hunters = docs.filter(d => /^sec-deep\/hunter-.*\.json$/.test(d.name));
    if (docs.some(x => Number(x.doc.dropped || 0) > 0 || Number(x.doc.unreviewed_candidate_sites || 0) > 0)) throw new Error('candidatos conhecidos não examinados; hunters incompleto');
    if (!d || !Array.isArray(d.doc.candidates) || hunters.some(d => d.doc.status !== 'complete' || !Array.isArray(d.doc.candidates) || !d.doc.scope_note || !d.doc.component || !d.doc.lens)) throw new Error('caçadores/candidatos não concluídos');
    validateStageArtifacts(dir, 'security_inventory', ['sec-deep/inventory.json']);
    const inventory = readJson(artifactPath(dir, 'sec-deep/inventory.json'));
    const expected = inventory.required_hunters.map(h => `${h.component}:${h.lens}`).sort();
    const actual = hunters.map(h => `${h.doc.component}:${h.doc.lens}`).sort();
    if (hash(expected) !== hash(actual)) throw new Error('caçadores não cobrem exatamente os assignments do inventário');
    const fromHunters = hunters.flatMap(d => d.doc.candidates).map(hash).sort();
    if (hash(fromHunters) !== hash(d.doc.candidates.map(hash).sort())) throw new Error('candidates não corresponde aos resultados dos caçadores');
  }
}
export function stageErrors(dir, stages, current = true) {
  const meta = metaFor(dir); const source = current ? sourceState(meta, dir).source_hash : null; const errors = [];
  for (const name of stages) {
    try {
      const s = meta.stages?.[name];
      if (!s || s.status !== 'complete' || s.run_id !== meta.run_id || (current && s.source_hash !== source)) throw new Error('ausente, incompleta ou antiga');
      readSnapshot(dir, s.snapshot_id, current);
      for (const a of s.artifacts || []) if (fileHash(artifactPath(dir, a.path)) !== a.hash) throw new Error(`artefato mudou: ${a.path}`);
      validateStageArtifacts(dir, name, (s.artifacts || []).map(a => a.path));
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  return errors;
}
export function completeStage(dir, stage, snapshotId, artifacts) {
  const meta = metaFor(dir);
  if (!meta.expected_stages.includes(stage)) throw new Error('etapa fora do escopo da run');
  const s = readSnapshot(dir, snapshotId);
  validateStageArtifacts(dir, stage, artifacts);
  if (stage === 'security' && meta.depth === 'deep') {
    const errors = securityErrors(dir); if (errors.length) throw new Error(errors.join('; '));
    if (!artifacts.includes('sec-deep/coverage.json')) throw new Error('security deep exige coverage como artefato');
  }
  meta.stages ||= {};
  meta.stages[stage] = { ...s, status: 'complete', completed_at: new Date().toISOString(), artifacts: artifacts.map(p => ({ path: p, hash: fileHash(artifactPath(dir, p)) })) };
  writeJson(path.join(dir, 'run-meta.json'), meta);
}
export function securityErrors(dir) {
  const errors = stageErrors(dir, ['security_inventory', 'security_hunters']);
  try {
    const meta = metaFor(dir), c = readJson(path.join(dir, 'sec-deep', 'coverage.json'));
    if (c.verification_status !== 'verified' || c.panel_source !== 'vote-files' || c.run_id !== meta.run_id || c.source_hash !== sourceState(meta, dir).source_hash) throw new Error('painel ausente, inválido ou antigo');
    if (!Array.isArray(c.inputs) || !c.inputs.length) throw new Error('painel sem vínculo aos inputs');
    for (const a of c.inputs) if (fileHash(artifactPath(dir, a.path)) !== a.hash) throw new Error(`evidência do painel mudou: ${a.path}`);
  } catch (e) { errors.push(`security: ${e.message}`); }
  return errors;
}
export function coverageErrors(dir) {
  try {
    const meta = metaFor(dir), errors = stageErrors(dir, meta.expected_stages);
    if (!meta.app || !meta.version || !meta.branch) errors.push('identidade app/version/branch incompleta');
    if (meta.expected_stages.includes('security') && meta.depth === 'deep') errors.push(...securityErrors(dir));
    const agents = fs.readdirSync(dir).filter(f => /^agent-.*\.json$/.test(f)).sort();
    const registered = new Set(Object.values(meta.stages || {}).flatMap(s => (s.artifacts || []).map(a => a.path)));
    for (const name of agents) if (!registered.has(name)) errors.push(`produtor não concluído: ${name}`);
    if (hash(agents.map(p => [p, fileHash(path.join(dir, p))])) !== meta.merge_inputs_hash) errors.push('consolidação ausente ou antiga: execute merge-findings');
    return errors;
  } catch (e) { return [e.message]; }
}

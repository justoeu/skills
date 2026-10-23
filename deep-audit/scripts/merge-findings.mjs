#!/usr/bin/env node
/**
 * merge-findings.mjs — junta agent-*.json → FINDINGS.json (fonte de verdade).
 *
 *   node merge-findings.mjs --dir <pack> [--mode delta|full]
 *
 * - Lê todo `agent-*.json` do pack (array ou {findings:[]} ou {verified:[]}).
 * - Normaliza para o schema canônico (lib-findings.mjs).
 * - Dedupe por (path, line, lente, categoria) mantendo a maior severidade e
 *   preferindo o achado verificado por painel.
 * - Atribui ids estáveis `<LENTE>-<AGT>-HASH`.
 * - **Preserva desfechos de uma rodada anterior** no mesmo pack: um `resolvido`
 *   com teste, um `refutado` com evidência e um `aceito` completo sobrevivem ao
 *   re-merge; qualquer rótulo inválido é rebaixado para `aberto`.
 * - Calcula `blocks_pr`.
 */
import fs from 'node:fs';
import { acquireLock, readJson, writeJson, findingsArray, findingHash, identity, stableId, metaFor, hash, fileHash } from './pack-state.mjs';
import path from 'node:path';
import {
  AGENTS,
  SEV_RANK,
  CONF_RANK,
  auditLabel,
  cliArg,
  dedupeKey,
  idPrefix,
  normalizeFinding,
  normalizeLens,
  normalizeStatus,
  nowStamp,
} from './lib-findings.mjs';

const dir = cliArg('dir');
const mode = cliArg('mode', 'delta');
if (!dir) {
  console.error('Uso: node merge-findings.mjs --dir <pack> [--mode delta|full]');
  process.exit(1);
}

const release = acquireLock(dir);
metaFor(dir);
const findingsPath = path.join(dir, 'FINDINGS.json');

function loadJson(p) { return fs.existsSync(p) ? readJson(p) : null; }

function loadAgentFiles() {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^agent-.*\.json$/i.test(f))
    .sort();
  const all = [];
  const sources = [];
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(dir, f));
    const doc = JSON.parse(bytes.toString('utf8'));
    const arr = findingsArray(doc, f);
    sources.push({ file: f, count: arr.length, hash: hash(bytes) });
    for (const item of arr) {
      if (item && typeof item === 'object' && (item.title || item.path)) {
        all.push({ ...item, _src: f });
      }
    }
  }
  return { all, sources };
}

const { all: raw, sources } = loadAgentFiles();

// ---- dedupe -----------------------------------------------------------------
const byKey = new Map();
for (const item of raw) {
  const f = normalizeFinding(item);
  const k = dedupeKey(f);
  const prev = byKey.get(k);
  if (!prev) {
    byKey.set(k, f);
    continue;
  }
  const sevBetter = (SEV_RANK[f.severity] ?? 9) < (SEV_RANK[prev.severity] ?? 9);
  const panelBetter =
    f.severity === prev.severity && f.verification === 'panel' && prev.verification !== 'panel';
  const confBetter =
    f.severity === prev.severity &&
    f.verification === prev.verification &&
    (CONF_RANK[f.confidence] ?? 0) > (CONF_RANK[prev.confidence] ?? 0);
  if (sevBetter || panelBetter || confBetter) {
    byKey.set(k, { ...prev, ...f });
  }
}

const merged = [...byKey.values()];

// ---- desfechos preservados da rodada anterior --------------------------------
const previous = Array.isArray(loadJson(findingsPath)) ? loadJson(findingsPath) : [];
const prevById = new Map();
const prevByKey = new Map();
for (const p of previous) {
  if (p.id) prevById.set(p.id, p);
  prevByKey.set(dedupeKey(p), p);
}

const CARRY = [
  'status',
  'resolved_test',
  'resolved_at',
  'resolved_note',
  'refuted_by',
  'refuted_at',
  'accept',
  'accepted_at',
  'label_audit',
  'progress',
  'owner',
  'review',
  'in_progress',
  'disposition_evidence',
];

for (const f of merged) {
  const prev = prevByKey.get(dedupeKey(f));
  f.id = stableId(f);
  if (!prev || findingHash(prev) !== findingHash(f)) { f.status = 'open'; continue; }
  for (const key of CARRY) {
    if (prev[key] != null) f[key] = prev[key];
  }
  f.status = normalizeStatus(f.status);
}

// Missing producer output cannot silently erase a previously known finding.
const identities = new Set(merged.map(identity));
for (const prior of previous) if (!identities.has(identity(prior))) merged.push({ ...prior, detector_missing: true });
for (const f of merged) f.id = stableId(f);
if (new Set(merged.map(f => f.id)).size !== merged.length) throw new Error('colisão de identidade: consolidação recusada');

// ---- política blocks_pr + auditoria de rótulo -------------------------------
const labelErrors = [];
for (const f of merged) {
  const highImpact = f.severity === 'CRITICAL' || f.severity === 'HIGH';
  const panel = f.verification === 'panel';

  let blocks = Boolean(highImpact && f.confidence === 'high');
  if (normalizeLens(f) === 'security' && panel) {
    if (f.severity === 'CRITICAL') blocks = true;
    else if (f.severity === 'HIGH' && f.confidence === 'high') blocks = true;
    else if (f.severity === 'HIGH' && mode === 'full' && f.confidence === 'medium') blocks = true;
  }
  if (['nplus1', 'race', 'memleak', 'backpressure', 'classic_bugs'].includes(normalizeLens(f))) {
    if (highImpact && f.confidence === 'high') blocks = true;
  }
  if (normalizeLens(f) === 'deps') blocks = false; // freshness nunca bloqueia PR
  if (normalizeStatus(f.status) !== 'open') blocks = false;
  f.blocks_pr = blocks;

  const { errors } = auditLabel(f, { fix: true });
  labelErrors.push(...errors);
}

merged.sort(
  (a, b) =>
    (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
    String(a.id).localeCompare(String(b.id)),
);

for (const source of sources) if (fileHash(path.join(dir, source.file)) !== source.hash) throw new Error('produtor mudou durante a consolidação; tente novamente');
writeJson(findingsPath, merged);

const metaPath = path.join(dir, 'run-meta.json');
const meta = metaFor(dir);
meta.merge_inputs_hash = hash(sources.map(s => [s.file, s.hash]));
meta.merged_at = nowStamp();
meta.agent_sources = sources;
meta.raw_findings = raw.length;
meta.unique_findings = merged.length;
writeJson(metaPath, meta);
release();

const roster = [...new Set(merged.map((f) => f.agent))]
  .map((a) => `${AGENTS[a]?.emoji || '•'} ${a}`)
  .join(' · ');

console.log(
  `merge-findings: ${raw.length} cru → ${merged.length} único (${sources.length} agentes) → ${findingsPath}`,
);
if (roster) console.log(`  roster: ${roster}`);
for (const e of labelErrors) console.warn(`  ⚠ rótulo rebaixado — ${e}`);

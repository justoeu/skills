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
 * - Atribui ids estáveis `<LENTE>-<AGT>-NNN`.
 * - **Preserva desfechos de uma rodada anterior** no mesmo pack: um `resolvido`
 *   com teste, um `refutado` com evidência e um `aceito` completo sobrevivem ao
 *   re-merge; qualquer rótulo inválido é rebaixado para `aberto`.
 * - Calcula `blocks_pr`.
 */
import fs from 'node:fs';
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

const findingsPath = path.join(dir, 'FINDINGS.json');

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function loadAgentFiles() {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^agent-.*\.json$/i.test(f))
    .sort();
  const all = [];
  const sources = [];
  for (const f of files) {
    const doc = loadJson(path.join(dir, f));
    if (doc == null) {
      console.warn(`merge-findings: ignorando ${f} (JSON inválido)`);
      continue;
    }
    const arr = Array.isArray(doc) ? doc : doc.findings || doc.verified || [];
    sources.push({ file: f, count: arr.length });
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
];

for (const f of merged) {
  const prev = (f.id && prevById.get(f.id)) || prevByKey.get(dedupeKey(f));
  if (!prev) continue;
  if (prev.id) f.id = prev.id;
  for (const key of CARRY) {
    if (prev[key] != null) f[key] = prev[key];
  }
  f.status = normalizeStatus(f.status);
}

// ---- ids --------------------------------------------------------------------
const used = new Set(merged.map((f) => f.id).filter(Boolean));
const counters = {};
for (const f of merged) {
  if (f.id && /^[A-Z0-9]+-[A-Z]+-\d{3}$/.test(f.id)) continue;
  const pref = idPrefix(f);
  counters[pref] = counters[pref] || 0;
  let id;
  do {
    counters[pref] += 1;
    id = `${pref}-${String(counters[pref]).padStart(3, '0')}`;
  } while (used.has(id));
  used.add(id);
  f.id = id;
}

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

fs.writeFileSync(findingsPath, JSON.stringify(merged, null, 2) + '\n');

const metaPath = path.join(dir, 'run-meta.json');
const meta = loadJson(metaPath) || {};
meta.merged_at = nowStamp();
meta.agent_sources = sources;
meta.raw_findings = raw.length;
meta.unique_findings = merged.length;
if (Object.keys(meta).length) fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

const roster = [...new Set(merged.map((f) => f.agent))]
  .map((a) => `${AGENTS[a]?.emoji || '•'} ${a}`)
  .join(' · ');

console.log(
  `merge-findings: ${raw.length} cru → ${merged.length} único (${sources.length} agentes) → ${findingsPath}`,
);
if (roster) console.log(`  roster: ${roster}`);
for (const e of labelErrors) console.warn(`  ⚠ rótulo rebaixado — ${e}`);

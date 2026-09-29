#!/usr/bin/env node
/**
 * merge-findings.mjs — Oracle helper: merge agent-*.json → FINDINGS.json
 *
 *   node merge-findings.mjs --dir Docs/audit/ultra-deep/YYYY-MM-DD-full \
 *     [--mode delta|full] [--base-ref origin/main]
 *
 * Reads agent-*.json (arrays or {findings:[]}) in dir.
 * Dedupes by (path, line, domain|title).
 * Assigns ids DOMAIN-AGT-NNN when missing.
 * Writes FINDINGS.json
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const dir = arg('dir');
const mode = arg('mode', 'delta');
if (!dir) {
  console.error('Usage: node merge-findings.mjs --dir <out> [--mode delta|full]');
  process.exit(1);
}

const AGENT_CODE = {
  Atlas: 'ATL',
  Sentinel: 'SEN',
  Nexus: 'NEX',
  Hermes: 'HER',
  Hydra: 'HYD',
  Forge: 'FOR',
  Daedalus: 'DAE',
  Echo: 'ECH',
  Laconic: 'LAC',
  Mentor: 'MEN',
  Prism: 'PRI',
  Argus: 'ARG',
  Artemis: 'ART',
  Oracle: 'ORA',
};

const DOMAIN_PREFIX = {
  architecture: 'ARCH',
  security: 'SEC',
  performance: 'N1',
  n1: 'N1',
  race: 'RACE',
  leak: 'LEAK',
  backpressure: 'BP',
  code_quality: 'CQ',
  complexity: 'CC',
  duplication: 'DUP',
  verbosity: 'VRB',
  best_practices: 'BP',
  best_practice: 'BP',
  deps: 'DEP',
  deps_best_practices: 'DEP',
  tests: 'TEST',
  classic_bugs: 'BUG',
  classic_bug: 'BUG',
};

const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function loadAgentFiles() {
  const files = fs.readdirSync(dir).filter((f) => /^agent-.*\.json$/i.test(f));
  const all = [];
  for (const f of files) {
    const p = path.join(dir, f);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      console.warn(`skip unreadable ${f}`);
      continue;
    }
    const arr = Array.isArray(doc) ? doc : doc.findings || doc.verified || [];
    for (const item of arr) {
      all.push({ ...item, _src: f });
    }
  }
  return all;
}

function dedupeKey(f) {
  const file = String(f.path || '').replace(/\\/g, '/');
  const line = Number(f.line) || 0;
  const dom = String(f.domain || f.agent || '');
  const cat = String(f.category || f.classic_pattern || f.title || '')
    .toLowerCase()
    .slice(0, 80);
  return `${file}::${line}::${dom}::${cat}`;
}

function domainPrefix(f) {
  const d = String(f.domain || '').toLowerCase();
  if (DOMAIN_PREFIX[d]) return DOMAIN_PREFIX[d];
  if (f.agent === 'Sentinel') return 'SEC';
  if (f.agent === 'Artemis') return 'BUG';
  if (f.agent === 'Nexus') return 'N1';
  if (f.agent === 'Hermes') return 'RACE';
  if (f.agent === 'Hydra') return 'LEAK';
  if (f.agent === 'Forge') return 'CQ';
  if (f.agent === 'Daedalus') return 'CC';
  if (f.agent === 'Echo') return 'DUP';
  if (f.agent === 'Laconic') return 'VRB';
  if (f.agent === 'Mentor') return 'BP';
  if (f.agent === 'Prism') return 'DEP';
  if (f.agent === 'Argus') return 'TEST';
  if (f.agent === 'Atlas') return 'ARCH';
  return 'F';
}

const raw = loadAgentFiles();
const map = new Map();

for (const f of raw) {
  if (!f || typeof f !== 'object') continue;
  if (!f.title && !f.path) continue;
  const k = dedupeKey(f);
  const prev = map.get(k);
  if (!prev) {
    map.set(k, f);
    continue;
  }
  const better =
    (sevRank[f.severity] ?? 9) < (sevRank[prev.severity] ?? 9) ||
    (f.severity === prev.severity &&
      (f.verification === 'panel' && prev.verification !== 'panel'));
  if (better) map.set(k, { ...prev, ...f });
}

const merged = [...map.values()];
const counters = {};

for (const f of merged) {
  f.agent = f.agent || 'Oracle';
  f.domain = f.domain || 'unknown';
  f.severity = String(f.severity || 'MEDIUM').toUpperCase();
  f.confidence = String(f.confidence || 'medium').toLowerCase();
  f.status = f.status || 'OPEN';
  f.evidence = f.evidence || f.description || '';
  f.impact = f.impact || '';
  f.fix = f.fix || '';
  if (!f.test_red_green) {
    f.test_red_green = {
      name: 'TBD',
      assert_before: 'reproduce defect',
      assert_after: 'defect gone',
    };
  }

  // Prefer panel-assigned ids
  if (!f.id || !/^[A-Z]+-[A-Z]+-\d+$/i.test(f.id)) {
    const pref = domainPrefix(f);
    const code = AGENT_CODE[f.agent] || 'XXX';
    const key = `${pref}-${code}`;
    counters[key] = (counters[key] || 0) + 1;
    f.id = `${key}-${String(counters[key]).padStart(3, '0')}`;
  }

  // blocks_pr policy
  const highImpact = f.severity === 'CRITICAL' || f.severity === 'HIGH';
  const confOk = f.confidence === 'high' || (f.verification === 'panel' && f.confidence === 'medium' && f.severity === 'CRITICAL');
  if (f.blocks_pr == null) {
    f.blocks_pr = Boolean(highImpact && f.confidence === 'high');
  }
  // Sentinel panel CRITICAL/HIGH+high always block; panel HIGH+medium blocks in full
  if (f.agent === 'Sentinel' && f.verification === 'panel') {
    if (f.severity === 'CRITICAL') f.blocks_pr = true;
    else if (f.severity === 'HIGH' && f.confidence === 'high') f.blocks_pr = true;
    else if (f.severity === 'HIGH' && mode === 'full' && f.confidence === 'medium') f.blocks_pr = true;
  }
  if (f.agent === 'Artemis' && highImpact && f.confidence === 'high') {
    f.blocks_pr = true;
  }

  delete f._src;
}

merged.sort(
  (a, b) =>
    (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) ||
    String(a.id).localeCompare(String(b.id)),
);

const out = path.join(dir, 'FINDINGS.json');
fs.writeFileSync(out, JSON.stringify(merged, null, 2) + '\n');
console.log(`merge-findings: ${raw.length} raw → ${merged.length} unique → ${out}`);

#!/usr/bin/env node
/**
 * sec-verify.mjs — code-side tally for Sentinel deep panel
 *
 * Quorum: 2 of 3 TRUE_POSITIVE keeps a candidate.
 * Confidence clamp:
 *   3/3 → high (max)
 *   2/3 → medium (max)  — never high
 *   <2  → dropped
 *
 * Usage:
 *   node sec-verify.mjs \
 *     --candidates path/candidates.json \
 *     --votes path/votes.json \
 *     --out path/verified.json \
 *     [--coverage-out path/coverage.json] \
 *     [--votes-dir path/votes] \
 *     [--require-vote-files] \
 *     [--agent Sentinel] \
 *     [--id-prefix SEC-SEN] \
 *     [--quorum 2] \
 *     [--voters 3]
 *
 * --require-vote-files: each candidate must have
 *   votes-dir/C<id>-REACHABILITY.json, ...-IMPACT.json, ...-DEFENSES.json
 *   (or votes.json is rebuilt from those files). Fails closed if missing —
 *   blocks Oracle from hand-writing a fake unanimous panel.
 *
 * candidates.json:
 *   { "candidates": [ { "temp_id": "C1", "title", "path", "line", "category",
 *       "severity", "confidence", "description", "exploit_scenario",
 *       "preconditions", "impact", "fix", "snippet", "symbol", "cwe",
 *       "evidence", "source", "sink", "component", "lens", ... } ] }
 *
 * votes.json:
 *   { "rounds": {
 *       "C1": {
 *         "REACHABILITY": { "verdict": "TRUE_POSITIVE"|"FALSE_POSITIVE", "reasoning": "..." },
 *         "IMPACT": { ... },
 *         "DEFENSES": { ... }
 *       }
 *     },
 *     "unreviewed_candidate_sites": 0
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const candidatesPath = arg('candidates');
const votesPath = arg('votes');
const outPath = arg('out');
const coverageOut = arg('coverage-out');
const votesDir = arg('votes-dir');
const requireVoteFiles = hasFlag('require-vote-files');
const agent = arg('agent', 'Sentinel');
const idPrefix = arg('id-prefix', 'SEC-SEN');
const quorum = Number(arg('quorum', '2'));
const voterCount = Number(arg('voters', '3'));

if (!candidatesPath || !outPath || (!votesPath && !votesDir)) {
  console.error(
    'Usage: node sec-verify.mjs --candidates c.json --votes v.json --out out.json [--votes-dir dir] [--require-vote-files] [--coverage-out cov.json]',
  );
  process.exit(1);
}

const LENSES = ['REACHABILITY', 'IMPACT', 'DEFENSES'];
const SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const CONF_RANK = { low: 1, medium: 2, high: 3 };
const RANK_CONF = { 1: 'low', 2: 'medium', 3: 'high' };

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Build rounds from votes/C1-REACHABILITY.json style files. */
function loadRoundsFromDir(dir, candidateIds) {
  const rounds = {};
  const missing = [];
  for (const id of candidateIds) {
    const entry = {};
    for (const lens of LENSES) {
      const fp = path.join(dir, `${id}-${lens}.json`);
      if (!fs.existsSync(fp)) {
        missing.push(`${id}-${lens}`);
        continue;
      }
      entry[lens] = loadJson(fp);
    }
    if (Object.keys(entry).length) rounds[id] = entry;
  }
  return { rounds, missing };
}

function normVerdict(v) {
  if (!v || typeof v !== 'object') return null;
  const raw = String(v.verdict || v.vote || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (raw === 'TRUE_POSITIVE' || raw === 'TP' || raw === 'KEEP' || raw === 'CONFIRM') {
    return 'TRUE_POSITIVE';
  }
  if (
    raw === 'FALSE_POSITIVE' ||
    raw === 'FP' ||
    raw === 'DROP' ||
    raw === 'REJECT' ||
    raw === 'REFUTED'
  ) {
    return 'FALSE_POSITIVE';
  }
  return null;
}

function clampConfidence(claimed, trueVotes, voters) {
  const c = String(claimed || 'medium').toLowerCase();
  let rank = CONF_RANK[c] ?? 2;
  if (trueVotes >= voters) {
    // unanimous: allow up to high
    rank = Math.min(rank, 3);
  } else if (trueVotes >= quorum) {
    // split panel: never high
    rank = Math.min(rank, 2);
  } else {
    rank = 0;
  }
  return rank === 0 ? null : RANK_CONF[rank];
}

function normSev(s) {
  const u = String(s || 'MEDIUM').toUpperCase();
  return SEV.includes(u) ? u : 'MEDIUM';
}

function dedupeKey(f) {
  const file = String(f.path || f.file || '').replace(/\\/g, '/');
  const line = Number(f.line) || 0;
  const cat = String(f.category || f.classic_pattern || '').toLowerCase();
  return `${file}::${line}::${cat}`;
}

const candDoc = loadJson(candidatesPath);
const list = Array.isArray(candDoc) ? candDoc : candDoc.candidates || [];
const candidateIds = list.map((c) => c.temp_id || c.id || c.candidate_id).filter(Boolean);

let voteDoc = { rounds: {} };
let voteFilesMissing = [];
let panelSource = 'votes-json';

if (votesDir) {
  const fromDir = loadRoundsFromDir(votesDir, candidateIds);
  voteFilesMissing = fromDir.missing;
  if (Object.keys(fromDir.rounds).length) {
    voteDoc = { rounds: fromDir.rounds };
    panelSource = 'vote-files';
    // Keep votes.json in sync for humans
    if (votesPath) {
      fs.writeFileSync(votesPath, JSON.stringify(voteDoc, null, 2) + '\n');
    }
  }
}

if (votesPath && fs.existsSync(votesPath) && panelSource === 'votes-json') {
  voteDoc = loadJson(votesPath);
}

if (requireVoteFiles) {
  if (!votesDir) {
    console.error('sec-verify: --require-vote-files needs --votes-dir');
    process.exit(2);
  }
  if (voteFilesMissing.length || candidateIds.length === 0) {
    const cov = {
      verification_status: 'unverified',
      reason: 'missing-independent-vote-files',
      panel_source: panelSource,
      missing_vote_files: voteFilesMissing,
      candidates_in: list.length,
      require_vote_files: true,
    };
    if (coverageOut) fs.writeFileSync(coverageOut, JSON.stringify(cov, null, 2) + '\n');
    fs.writeFileSync(outPath, '[]\n');
    console.error(
      `sec-verify: FAIL require-vote-files — missing ${voteFilesMissing.length} file(s): ` +
        voteFilesMissing.slice(0, 12).join(', ') +
        (voteFilesMissing.length > 12 ? '…' : ''),
    );
    process.exit(2);
  }
}

const rounds = voteDoc.rounds || voteDoc.panel || {};
const unreviewed = Number(voteDoc.unreviewed_candidate_sites || candDoc.dropped || 0) || 0;

const kept = [];
const dropped = [];
let panelReviewed = 0;
let panelQuorum = 0;

for (const raw of list) {
  const id = raw.temp_id || raw.id || raw.candidate_id;
  if (!id) {
    dropped.push({ reason: 'missing-temp-id', raw: { title: raw.title, path: raw.path } });
    continue;
  }
  const round = rounds[id] || rounds[String(id)];
  if (!round || typeof round !== 'object') {
    dropped.push({ temp_id: id, reason: 'no-votes', title: raw.title });
    continue;
  }

  let trueN = 0;
  let falseN = 0;
  const detail = {};
  let malformed = false;

  for (const lens of LENSES) {
    const entry = round[lens] || round[lens.toLowerCase()];
    const verdict = normVerdict(entry);
    if (!verdict) {
      malformed = true;
      detail[lens] = { verdict: 'INVALID', reasoning: entry?.reasoning || 'missing verdict' };
      continue;
    }
    detail[lens] = {
      verdict,
      reasoning: entry.reasoning || entry.reason || '',
    };
    if (verdict === 'TRUE_POSITIVE') trueN++;
    else falseN++;
  }

  panelReviewed++;

  if (malformed || trueN + falseN < voterCount) {
    dropped.push({
      temp_id: id,
      reason: 'incomplete-or-invalid-panel',
      true: trueN,
      false: falseN,
      title: raw.title,
    });
    continue;
  }

  if (trueN < quorum) {
    dropped.push({
      temp_id: id,
      reason: 'below-quorum',
      true: trueN,
      false: falseN,
      title: raw.title,
    });
    continue;
  }

  const conf = clampConfidence(raw.confidence, trueN, voterCount);
  if (!conf) {
    dropped.push({ temp_id: id, reason: 'confidence-clamp-drop', title: raw.title });
    continue;
  }

  panelQuorum++;

  const path = raw.path || raw.file || '';
  const line = raw.line != null ? Number(raw.line) : undefined;

  kept.push({
    agent,
    domain: 'security',
    title: raw.title || 'Untitled security finding',
    severity: normSev(raw.severity),
    confidence: conf,
    path,
    line,
    category: raw.category || null,
    symbol: raw.symbol || null,
    snippet: raw.snippet || null,
    source: raw.source || null,
    sink: raw.sink || null,
    description: raw.description || raw.evidence || '',
    evidence: raw.evidence || raw.description || '',
    exploit_scenario: raw.exploit_scenario || raw.exploitScenario || '',
    preconditions: Array.isArray(raw.preconditions) ? raw.preconditions : [],
    impact: raw.impact || '',
    fix: raw.fix || raw.recommendation || '',
    cwe: raw.cwe || raw.cwe_id || null,
    component: raw.component || null,
    lens: raw.lens || null,
    verification: 'panel',
    panel: { true: trueN, false: falseN, voters: voterCount },
    panel_detail: detail,
    test_red_green: raw.test_red_green || {
      name: 'TBD',
      assert_before: 'exploit or deny-path fails open',
      assert_after: 'exploit blocked; legitimate path unchanged',
    },
    status: 'OPEN',
    blocks_pr: false, // Oracle sets after id + delta rules
    _temp_id: id,
    _dedupe: dedupeKey({ path, line, category: raw.category }),
  });
}

// Dedupe survivors
const byKey = new Map();
const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
for (const f of kept) {
  const k = f._dedupe;
  const prev = byKey.get(k);
  if (!prev) {
    byKey.set(k, f);
    continue;
  }
  const better =
    (sevRank[f.severity] ?? 9) < (sevRank[prev.severity] ?? 9) ||
    (f.severity === prev.severity && CONF_RANK[f.confidence] > CONF_RANK[prev.confidence]);
  if (better) byKey.set(k, f);
}

const verified = [...byKey.values()].sort(
  (a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9),
);

// Assign sequential ids
verified.forEach((f, i) => {
  f.id = `${idPrefix}-${String(i + 1).padStart(3, '0')}`;
  // blocks_pr hint for Oracle (delta still required)
  if (
    (f.severity === 'CRITICAL' || f.severity === 'HIGH') &&
    (f.confidence === 'high' || f.confidence === 'medium') &&
    f.verification === 'panel'
  ) {
    f.blocks_pr = f.severity === 'CRITICAL' || f.confidence === 'high';
  }
  delete f._temp_id;
  delete f._dedupe;
});

const coverage = {
  verification_status:
    panelReviewed === 0 && list.length === 0
      ? 'verified'
      : panelReviewed > 0 && dropped.every((d) => d.reason !== 'incomplete-or-invalid-panel')
        ? 'verified'
        : list.length > 0 && panelReviewed === 0
          ? 'unverified'
          : 'verified',
  panel_source: panelSource,
  require_vote_files: requireVoteFiles,
  candidates_in: list.length,
  candidates_deduped_out: verified.length,
  panel_reviewed_findings: panelReviewed,
  panel_quorum_findings: panelQuorum,
  panel_dropped: dropped.length,
  unreviewed_candidate_sites: unreviewed,
  quorum,
  voters: voterCount,
  dropped_sample: dropped.slice(0, 20),
};

if (coverage.verification_status === 'unverified') {
  coverage.reason = 'candidates present but no complete panel votes';
}

fs.writeFileSync(outPath, JSON.stringify(verified, null, 2) + '\n');
if (coverageOut) {
  fs.writeFileSync(coverageOut, JSON.stringify(coverage, null, 2) + '\n');
}

console.log(
  `sec-verify: ${verified.length} kept / ${list.length} candidates ` +
    `(dropped ${dropped.length}) → ${outPath}`,
);
console.log(`verification.status=${coverage.verification_status}`);

if (coverage.verification_status === 'unverified' && list.length > 0) {
  process.exit(2);
}

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
import fs from "node:fs";
import path from "node:path";
import {
  processLock,
  read,
  atomic,
  meta,
  saveMeta,
  requireCurrent,
  bound,
  bind,
  attempt,
  normalizeFindings,
  uniqueIds,
  closed,
} from "./pack-contract.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const dir = arg("dir");
let mode = arg("mode", "delta");
if (!dir) {
  console.error(
    "Usage: node merge-findings.mjs --dir <out> [--mode delta|full]",
  );
  process.exit(1);
}

const AGENT_CODE = {
  Atlas: "ATL",
  Sentinel: "SEN",
  Lyra: "LYR",
  Janus: "JAN",
  Moira: "MOI",
  Sigil: "SIG",
  Basilisk: "BAS",
  Proteus: "PRO",
  Mirage: "MIR",
  Nexus: "NEX",
  Hermes: "HER",
  Hydra: "HYD",
  Forge: "FOR",
  Daedalus: "DAE",
  Echo: "ECH",
  Laconic: "LAC",
  Mentor: "MEN",
  Prism: "PRI",
  Argus: "ARG",
  Artemis: "ART",
  Oracle: "ORA",
};

const PANEL_SECURITY = new Set([
  "Sentinel",
  "Lyra",
  "Janus",
  "Moira",
  "Sigil",
  "Basilisk",
  "Proteus",
]);

const DOMAIN_PREFIX = {
  architecture: "ARCH",
  security: "SEC",
  performance: "N1",
  n1: "N1",
  race: "RACE",
  leak: "LEAK",
  backpressure: "BP",
  code_quality: "CQ",
  complexity: "CC",
  duplication: "DUP",
  verbosity: "VRB",
  best_practices: "BP",
  best_practice: "BP",
  deps: "DEP",
  deps_best_practices: "DEP",
  tests: "TEST",
  classic_bugs: "BUG",
  classic_bug: "BUG",
  imports: "IMP",
};

const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function loadAgentFiles() {
  const m = meta(dir, false);
  const files = m
    ? requireCurrent(dir).expected_agents
    : fs.readdirSync(dir).filter((f) => /^agent-.*\.json$/i.test(f));
  if (!files.length)
    throw Error("no agent outputs; initialize expected roster");
  const all = [];
  for (const f of files) {
    if (m && !bound(dir, f, m))
      throw Error(`missing/stale agent artifact: ${f}`);
    const rows = normalizeFindings(read(path.join(dir, f)));
    const expected = f
      .replace(/^agent-/, "")
      .replace(/-freshness\.json$/, "")
      .replace(/\.json$/, "");
    if (m && rows.some((row) => String(row.agent).toLowerCase() !== expected))
      throw Error(`wrong agent identity in ${f}`);
    for (const item of rows) all.push({ ...item, _src: f });
  }
  return all;
}

function dedupeKey(f) {
  const file = String(f.path || "").replace(/\\/g, "/");
  const line = Number(f.line) || 0;
  const dom = String(f.domain || f.agent || "");
  const cat = String(f.category || f.classic_pattern || f.title || "")
    .toLowerCase()
    .slice(0, 80);
  return `${file}::${line}::${dom}::${cat}`;
}

function domainPrefix(f) {
  const d = String(f.domain || "").toLowerCase();
  if (DOMAIN_PREFIX[d]) return DOMAIN_PREFIX[d];
  if (PANEL_SECURITY.has(f.agent)) return "SEC";
  if (f.agent === "Mirage") return "IMP";
  if (f.agent === "Artemis") return "BUG";
  if (f.agent === "Nexus") return "N1";
  if (f.agent === "Hermes") return "RACE";
  if (f.agent === "Hydra") return "LEAK";
  if (f.agent === "Forge") return "CQ";
  if (f.agent === "Daedalus") return "CC";
  if (f.agent === "Echo") return "DUP";
  if (f.agent === "Laconic") return "VRB";
  if (f.agent === "Mentor") return "BP";
  if (f.agent === "Prism") return "DEP";
  if (f.agent === "Argus") return "TEST";
  if (f.agent === "Atlas") return "ARCH";
  return "F";
}

if (dir) processLock(dir);
try {
  mode = meta(dir, false)?.mode || mode;
  const raw = loadAgentFiles();
  const previous = fs.existsSync(path.join(dir, "FINDINGS.json"))
    ? normalizeFindings(read(path.join(dir, "FINDINGS.json")))
    : [];
  if (previous.length) uniqueIds(previous);
  const map = new Map();

  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
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
        f.verification === "panel" &&
        prev.verification !== "panel");
    if (better) map.set(k, { ...prev, ...f });
  }

  const merged = [...map.values()];
  const counters = {};
  const reserved = new Map();
  for (const f of [...previous, ...merged]) {
    if (f.id) {
      const k = dedupeKey(f);
      if (reserved.has(f.id) && reserved.get(f.id) !== k)
        throw Error(`duplicate finding id: ${f.id}`);
      reserved.set(f.id, k);
    }
  }
  const oldByKey = new Map(previous.map((f) => [dedupeKey(f), f]));
  const seenKeys = new Set();

  for (const f of merged) {
    const key = dedupeKey(f),
      old = oldByKey.get(key);
    seenKeys.add(key);
    if (old) {
      const state = {};
      for (const k of [
        "id",
        "status",
        "resolved_in",
        "resolved_at",
        "resolved_test",
        "disposition_reason",
        "block_policy",
      ])
        if (old[k] != null) state[k] = old[k];
      Object.assign(f, state);
    }
    f.agent = f.agent || "Oracle";
    f.domain = f.domain || "unknown";
    f.severity = String(f.severity || "MEDIUM").toUpperCase();
    f.confidence = String(f.confidence || "medium").toLowerCase();
    f.status = f.status || "OPEN";
    f.evidence = f.evidence || f.description || "";
    f.impact = f.impact || "";
    f.fix = f.fix || "";
    if (!f.test_red_green) {
      f.test_red_green = {
        name: "TBD",
        assert_before: "reproduce defect",
        assert_after: "defect gone",
      };
    }

    // Prefer panel-assigned ids
    if (!f.id || !/^[A-Z][A-Z0-9]*-[A-Z]+-\d+$/i.test(f.id)) {
      const pref = domainPrefix(f);
      const code = AGENT_CODE[f.agent] || "XXX";
      const key = `${pref}-${code}`;
      do {
        counters[key] = (counters[key] || 0) + 1;
        f.id = `${key}-${String(counters[key]).padStart(3, "0")}`;
      } while (reserved.has(f.id));
      reserved.set(f.id, dedupeKey(f));
    }

    // blocks_pr policy
    const highImpact = f.severity === "CRITICAL" || f.severity === "HIGH";
    const confOk =
      f.confidence === "high" ||
      (f.verification === "panel" &&
        f.confidence === "medium" &&
        f.severity === "CRITICAL");
    if (f.blocks_pr == null) {
      f.blocks_pr = Boolean(highImpact && f.confidence === "high");
    }
    // Sentinel panel CRITICAL/HIGH+high always block; panel HIGH+medium blocks in full
    if (PANEL_SECURITY.has(f.agent) && f.verification === "panel") {
      if (f.severity === "CRITICAL") f.blocks_pr = true;
      else if (f.severity === "HIGH" && f.confidence === "high")
        f.blocks_pr = true;
      else if (
        f.severity === "HIGH" &&
        mode === "full" &&
        f.confidence === "medium"
      )
        f.blocks_pr = true;
    }
    if (f.agent === "Artemis" && highImpact && f.confidence === "high") {
      f.blocks_pr = true;
    }

    f.block_policy = f.block_policy ?? Boolean(f.blocks_pr);
    delete f._src;
  }

  for (const f of previous)
    if (!seenKeys.has(dedupeKey(f)))
      merged.push({ ...f, not_in_latest_scan: true });
  uniqueIds(merged);
  merged.sort(
    (a, b) =>
      (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) ||
      String(a.id).localeCompare(String(b.id)),
  );

  const out = path.join(dir, "FINDINGS.json");
  atomic(out, merged);
  if (meta(dir, false)) {
    const m = meta(dir);
    m.merge_inputs = {
      snapshot: m.snapshot,
      inputs: Object.fromEntries(
        m.expected_agents.map((file) => [file, m.artifacts[file].sha256]),
      ),
    };
    saveMeta(dir, m);
    bind(dir, "FINDINGS.json");
  }
  attempt(dir, "merge", null);
  console.log(
    `merge-findings: ${raw.length} raw → ${merged.length} unique → ${out}`,
  );
} catch (e) {
  attempt(dir, "merge", e);
  console.error(`merge-findings: ${e.message}`);
  process.exitCode = 1;
}

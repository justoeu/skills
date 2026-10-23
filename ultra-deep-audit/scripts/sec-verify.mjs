#!/usr/bin/env node
/** Schema 2 panel tally. No output is replaced until every candidate is reviewed. */
import fs from "node:fs";
import path from "node:path";
import {
  processLock,
  hash,
  read,
  atomic,
  inside,
  requireCurrent,
  bound,
  bind,
  attempt,
} from "./pack-contract.mjs";
const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i < 0 ? d : process.argv[i + 1];
};
const dir = arg("dir"),
  candidatesPath = arg("candidates"),
  votesDir = arg("votes-dir"),
  out = arg("out"),
  coverageOut = arg("coverage-out"),
  agent = arg("agent", "Sentinel"),
  prefix = arg("id-prefix", "SEC-SEN");
const stage = `security-${agent.toLowerCase()}`;
if (dir) processLock(dir);
try {
  if (!dir || !candidatesPath || !votesDir || !out || !coverageOut)
    throw Error(
      "schema 2 needs --dir --candidates --votes-dir --out --coverage-out",
    );
  if (Number(arg("quorum", "2")) !== 2 || Number(arg("voters", "3")) !== 3)
    throw Error("panel contract requires quorum 2 of 3");
  const m = requireCurrent(dir);
  const relative = (p) =>
    path.relative(path.resolve(dir), path.resolve(p)).split(path.sep).join("/");
  for (const p of [candidatesPath, votesDir, out, coverageOut])
    inside(dir, relative(p));
  const doc = read(candidatesPath);
  if (
    !bound(dir, relative(candidatesPath), m) ||
    doc.run_id !== m.run_id ||
    doc.snapshot !== m.snapshot ||
    !Array.isArray(doc.candidates)
  )
    throw Error("missing/stale candidate envelope");
  if (Number(doc.unreviewed_candidate_sites || doc.dropped || 0) !== 0)
    throw Error("unreviewed candidate sites remain");
  const coverage = doc.coverage;
  if (!coverage?.inventory || !Array.isArray(coverage.hunters))
    throw Error("candidate coverage inventory/hunters required");
  if (!bound(dir, coverage.inventory, m))
    throw Error("missing/stale inventory");
  const inventory = read(inside(dir, coverage.inventory));
  if (inventory.complete !== true || !Array.isArray(inventory.required_hunters))
    throw Error("incomplete inventory");
  const requirements = inventory.required_hunters.map(
    (h) => `${h.component}:${h.lens}`,
  );
  if (new Set(requirements).size !== requirements.length)
    throw Error("duplicate hunter assignment");
  if (
    !requirements.length &&
    !(inventory.no_attack_surface === true && inventory.reason)
  )
    throw Error(
      "inventory needs hunter assignments or justified no attack surface",
    );
  const completed = new Set(),
    produced = new Set();
  const canonical = (x) =>
    Array.isArray(x)
      ? x.map(canonical)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, canonical(x[k])]),
          )
        : x;
  const contentKey = (f) => {
    const copy = { ...f };
    delete copy.temp_id;
    delete copy.id;
    delete copy.candidate_id;
    return hash(JSON.stringify(canonical(copy)));
  };
  const inputFiles = new Set([
    relative(candidatesPath),
    coverage.inventory,
    ...coverage.hunters,
  ]);
  for (const file of coverage.hunters) {
    if (!bound(dir, file, m)) throw Error("missing/stale hunter");
    const h = read(inside(dir, file));
    if (h.status !== "complete" || !Array.isArray(h.findings))
      throw Error("incomplete hunter");
    const k = `${h.component}:${h.lens}`;
    if (completed.has(k)) throw Error("duplicate hunter output");
    completed.add(k);
    for (const f of h.findings) produced.add(contentKey(f));
  }
  if (
    requirements.some((k) => !completed.has(k)) ||
    completed.size !== requirements.length
  )
    throw Error("hunter coverage incomplete");
  const submitted = new Set(doc.candidates.map(contentKey));
  if (
    submitted.size !== produced.size ||
    [...produced].some((k) => !submitted.has(k))
  )
    throw Error("candidate set does not match completed hunter findings");
  const ids = new Set(),
    kept = [],
    dropped = [];
  for (const raw of doc.candidates) {
    const id = raw.temp_id || raw.id;
    if (!/^[A-Za-z0-9_-]+$/.test(id || "") || ids.has(id))
      throw Error("missing/duplicate candidate id");
    ids.add(id);
    if (
      !raw.title ||
      !raw.path ||
      !Number.isSafeInteger(raw.line) ||
      raw.line < 0
    )
      throw Error("invalid candidate site");
    let yes = 0;
    const detail = {};
    for (const lens of ["REACHABILITY", "IMPACT", "DEFENSES"]) {
      const file = path.join(votesDir, `${id}-${lens}.json`);
      const v = read(inside(dir, relative(file)));
      inputFiles.add(relative(file));
      if (
        v.run_id !== m.run_id ||
        v.snapshot !== m.snapshot ||
        v.candidate_hash !== hash(JSON.stringify(raw)) ||
        v.lens !== lens
      )
        throw Error(`${id}/${lens}: stale or wrong vote identity`);
      if (
        !["TRUE_POSITIVE", "FALSE_POSITIVE"].includes(v.verdict) ||
        !v.reasoning ||
        !Array.isArray(v.cited_paths) ||
        !v.cited_paths.length
      )
        throw Error(
          `${id}/${lens}: incomplete-or-invalid-panel (INCONCLUSIVE requires follow-up)`,
        );
      if (v.verdict === "TRUE_POSITIVE") yes++;
      detail[lens] = v;
    }
    if (yes < 2) {
      dropped.push({
        temp_id: id,
        reason: "refuted",
        true: yes,
        false: 3 - yes,
      });
      continue;
    }
    const confidence = yes === 2 ? "medium" : raw.confidence || "medium";
    kept.push({
      ...raw,
      agent,
      domain: "security",
      id: `${prefix}-${String(kept.length + 1).padStart(3, "0")}`,
      confidence,
      verification: "panel",
      panel: { true: yes, false: 3 - yes, voters: 3 },
      panel_detail: detail,
      status: "open",
      blocks_pr:
        raw.severity === "CRITICAL" ||
        (raw.severity === "HIGH" && confidence === "high"),
    });
  }
  const cov = {
    schema_version: 2,
    inputs: Object.fromEntries(
      [...inputFiles].map((file) => [
        file,
        hash(fs.readFileSync(inside(dir, file))),
      ]),
    ),
    run_id: m.run_id,
    snapshot: m.snapshot,
    verification_status: doc.candidates.length ? "verified" : "not_applicable",
    panel_source: doc.candidates.length ? "vote-files" : "complete-inventory",
    candidates_in: doc.candidates.length,
    panel_reviewed_findings: doc.candidates.length,
    panel_quorum_findings: kept.length,
    panel_dropped: dropped.length,
    dropped,
    unreviewed_candidate_sites: 0,
  };
  atomic(out, kept);
  atomic(coverageOut, cov);
  bind(dir, relative(out));
  bind(dir, relative(coverageOut));
  attempt(dir, stage, null);
  console.log(
    `verification.status=${cov.verification_status}; ${kept.length} kept / ${doc.candidates.length} candidates`,
  );
} catch (e) {
  if (dir && fs.existsSync(dir)) attempt(dir, stage, e);
  console.error(`sec-verify: unverified: ${e.message}`);
  process.exitCode = 2;
}

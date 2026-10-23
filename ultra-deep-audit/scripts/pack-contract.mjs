/** Schema 2: local provenance and completion checks. Evidence is not a signature. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
export const SCHEMA = 2;
export const hash = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      tmp,
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
// Serialize every publishing CLI before it reads shared metadata. A child renderer
// may inherit its parent's token; unrelated writers fail visibly and can retry.
export function processLock(dir) {
  const file = path.join(fs.realpathSync(dir), ".pack.lock");
  const inherited = process.env.ULTRA_PACK_LOCK_TOKEN;
  if (inherited && fs.existsSync(file)) {
    const owner = read(file);
    if (owner.token === inherited) {
      process.kill(owner.pid, 0);
      return;
    }
  }
  const owner = {
    pid: process.pid,
    token: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  let fd;
  try {
    fd = fs.openSync(file, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error(
        `pack lock busy: ${file}; retry after the writer exits (inspect owner before stale-lock recovery)`,
      );
    throw e;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify(owner));
  } catch (e) {
    fs.unlinkSync(file);
    throw e;
  } finally {
    fs.closeSync(fd);
  }
  process.env.ULTRA_PACK_LOCK_TOKEN = owner.token;
  process.once("exit", () => {
    try {
      if (read(file).token === owner.token) fs.unlinkSync(file);
    } catch {}
  });
}
export function dependencyCoverageValid(d, root) {
  if (
    !d ||
    !Array.isArray(d.packages) ||
    !Array.isArray(d.runner_errors) ||
    !d.summary ||
    typeof d.root !== "string" ||
    fs.realpathSync(d.root) !== fs.realpathSync(root)
  )
    return false;
  const s = d.summary;
  if (
    ["checked", "outdated", "up_to_date", "errors"].some(
      (k) => !Number.isSafeInteger(s[k]) || s[k] < 0,
    )
  )
    return false;
  if (
    d.runner_errors.length ||
    d.packages.some(
      (p) =>
        !p || !p.name || !p.ecosystem || !p.manifest || p.error || p.skipped,
    )
  )
    return false;
  const outdated = d.packages.filter((p) => p.outdated).length;
  return (
    s.errors === 0 &&
    s.checked === d.packages.length &&
    s.outdated === outdated &&
    s.up_to_date === s.checked - outdated
  );
}
export function inside(dir, rel) {
  if (!rel || path.isAbsolute(rel))
    throw Error("artifact must be a relative path");
  const p = path.resolve(dir, rel);
  if (!p.startsWith(path.resolve(dir) + path.sep))
    throw Error("artifact escapes pack");
  let ancestor = p;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(dir),
    realAncestor = fs.realpathSync(ancestor);
  if (
    realAncestor !== realRoot &&
    !realAncestor.startsWith(realRoot + path.sep)
  )
    throw Error("artifact symlink escapes pack");
  return p;
}
export function snapshot(root, exclude = []) {
  root = fs.realpathSync(root);
  const skip = new Set([
    ".git",
    "node_modules",
    "vendor",
    ".build",
    "dist",
    "target",
    "coverage",
  ]);
  const names = [];
  const omitted = (rel) =>
    exclude.some((e) => rel === e || rel.startsWith(e + "/"));
  function walk(dir) {
    for (const ent of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, ent.name),
        rel = path.relative(root, p).split(path.sep).join("/");
      if (skip.has(ent.name) || omitted(rel)) continue;
      if (ent.isDirectory()) walk(p);
      else if (ent.isSymbolicLink())
        names.push([rel, "symlink:" + fs.readlinkSync(p)]);
      else if (ent.isFile()) names.push([rel, hash(fs.readFileSync(p))]);
    }
  }
  // Respect ignored build artifacts in Git repositories while including untracked source.
  const git = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  if (git.status === 0) {
    for (const rel of [
      ...new Set(git.stdout.split("\0").filter(Boolean)),
    ].sort()) {
      if (omitted(rel) || rel.split("/").some((x) => skip.has(x))) continue;
      const p = path.join(root, rel);
      if (!fs.existsSync(p)) {
        names.push([rel, "deleted"]);
        continue;
      }
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink())
        names.push([rel, "symlink:" + fs.readlinkSync(p)]);
      else if (st.isFile()) names.push([rel, hash(fs.readFileSync(p))]);
    }
  } else walk(root);
  const branch =
    spawnSync("git", ["branch", "--show-current"], {
      cwd: root,
      encoding: "utf8",
    }).stdout?.trim() || "";
  return hash(JSON.stringify({ branch, names }));
}
export function meta(dir, required = true) {
  const file = path.join(dir, "run-meta.json");
  const m = fs.existsSync(file) ? read(file) : null;
  if (m?.schema_version !== SCHEMA) {
    if (required)
      throw Error(
        "schema 2 run required; initialize a new run (legacy packs are read-only history)",
      );
    return null;
  }
  if (
    !m.run_id ||
    !m.root ||
    !m.snapshot ||
    !Array.isArray(m.expected_agents) ||
    !m.expected_agents.length
  )
    throw Error("invalid run metadata");
  return m;
}
export function saveMeta(dir, m) {
  atomic(path.join(dir, "run-meta.json"), m);
}
export function current(m) {
  return snapshot(m.root, m.excludes || []) === m.snapshot;
}
export function requireCurrent(dir) {
  const m = meta(dir);
  if (!current(m))
    throw Error(
      "source snapshot changed; run pack-state snapshot and rerun affected evidence",
    );
  return m;
}
export function bind(dir, rel, m = requireCurrent(dir)) {
  const p = inside(dir, rel);
  m.artifacts ||= {};
  m.artifacts[rel] = {
    run_id: m.run_id,
    snapshot: m.snapshot,
    sha256: hash(fs.readFileSync(p)),
  };
  saveMeta(dir, m);
  return m;
}
export function bound(dir, rel, m) {
  const b = m.artifacts?.[rel];
  try {
    return (
      b?.run_id === m.run_id &&
      b?.snapshot === m.snapshot &&
      b?.sha256 === hash(fs.readFileSync(inside(dir, rel)))
    );
  } catch {
    return false;
  }
}
export function attempt(dir, stage, error) {
  const file = path.join(dir, "attempts.json");
  let a = {};
  try {
    a = read(file);
  } catch {}
  a[stage] = {
    ok: !error,
    error: error ? String(error.message || error) : null,
    at: new Date().toISOString(),
  };
  atomic(file, a);
}
export function normalizeFindings(doc) {
  const arr = Array.isArray(doc)
    ? doc
    : (doc?.findings ??
      doc?.verified ??
      (doc?.agent && doc?.title ? [doc] : null));
  if (!Array.isArray(arr))
    throw Error("agent output must be array, finding object, or {findings:[]}");
  for (const f of arr) {
    if (
      !f ||
      typeof f !== "object" ||
      Array.isArray(f) ||
      !f.title ||
      !f.path ||
      !f.agent ||
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(
        String(f.severity).toUpperCase(),
      )
    )
      throw Error("invalid finding: agent/title/path/severity required");
    if (f.line != null && (!Number.isSafeInteger(f.line) || f.line < 0))
      throw Error("finding line must be a non-negative safe integer");
  }
  return arr;
}
export function uniqueIds(rows) {
  const seen = new Set();
  for (const f of rows) {
    if (!f.id || seen.has(f.id))
      throw Error(`missing or duplicate finding id: ${f.id}`);
    seen.add(f.id);
  }
}
export const closed = (f) =>
  ["resolved", "done", "refuted", "accepted", "accept"].includes(
    String(f.status || "open").toLowerCase(),
  );
export const policyBlocks = (f, mode = "full") =>
  f.block_policy ??
  (Boolean(f.blocks_pr) ||
    (["CRITICAL", "HIGH"].includes(f.severity) && f.confidence === "high") ||
    (f.verification === "panel" &&
      (f.severity === "CRITICAL" ||
        (mode === "full" && f.severity === "HIGH"))));
export function findingHash(f) {
  return hash(
    JSON.stringify(
      Object.fromEntries(
        [
          "agent",
          "domain",
          "title",
          "path",
          "line",
          "category",
          "evidence",
          "impact",
          "fix",
        ].map((k) => [k, f[k] ?? null]),
      ),
    ),
  );
}
export function validationErrors(dir, id, m) {
  const e = m.evidence?.[id],
    errors = [];
  let target;
  try {
    target = read(path.join(dir, "FINDINGS.json")).find((f) => f.id === id);
  } catch {}
  if (!target) return ["finding missing"];
  const expectedHash = findingHash(target);
  if (!e) return ["missing validation evidence"];
  const mode = e.mode;
  const phases =
    mode === "bug"
      ? ["red", "green"]
      : mode === "characterization"
        ? ["before", "after"]
        : ["check"];
  if (!["bug", "characterization", "check", "deps"].includes(mode))
    errors.push("unknown validation mode");
  for (const phase of phases) {
    const r = e[phase];
    if (
      !r ||
      !Array.isArray(r.command) ||
      !r.command.length ||
      !Number.isInteger(r.exit_code) ||
      !r.log
    )
      errors.push(`missing ${phase} execution`);
    else {
      try {
        if (hash(fs.readFileSync(inside(dir, r.log))) !== r.log_hash)
          errors.push(`${phase} log changed`);
      } catch {
        errors.push(`${phase} log missing`);
      }
      if (r.run_id !== m.run_id) errors.push(`${phase} wrong run`);
      if (r.finding_hash !== expectedHash)
        errors.push(`${phase} different finding`);
      if (!["red", "before"].includes(phase) && r.snapshot !== m.snapshot)
        errors.push(`${phase} stale snapshot`);
      if (phase === "red" ? r.exit_code === 0 : r.exit_code !== 0)
        errors.push(`${phase} unexpected exit`);
    }
  }
  if (mode === "bug" && e.red && e.green && e.red.sequence >= e.green.sequence)
    errors.push("RED must precede GREEN");
  if (
    mode === "characterization" &&
    e.before &&
    e.after &&
    e.before.sequence >= e.after.sequence
  )
    errors.push("before must precede after");
  for (const kind of ["review", "docs"]) {
    const a = e[kind];
    if (
      !a ||
      a.snapshot !== m.snapshot ||
      a.run_id !== m.run_id ||
      a.finding_hash !== expectedHash ||
      !bound(dir, a.file, m)
    )
      errors.push(`missing/stale ${kind}`);
    else {
      try {
        const doc = read(inside(dir, a.file));
        if (
          kind === "review"
            ? doc.status !== "PASS" ||
              !Array.isArray(doc.findings) ||
              doc.findings.some(
                (f) => f.status !== "resolved" && f.status !== "accepted",
              )
            : !["PASS", "NOT_APPLICABLE"].includes(doc.status)
        )
          errors.push(`${kind} not passed`);
        if (!doc.reason) errors.push(`${kind} reason required`);
      } catch {
        errors.push(`${kind} invalid`);
      }
    }
  }
  return errors;
}
export function auditState(dir, findings = []) {
  const errors = [];
  let m;
  try {
    m = meta(dir);
    if (!current(m)) errors.push("source snapshot changed");
  } catch (e) {
    return {
      audit_complete: false,
      implementation_complete: false,
      complete: false,
      errors: [e.message],
      legacy: true,
    };
  }
  for (const rel of [
    ...m.expected_agents,
    ...(m.required_artifacts || []),
    "FINDINGS.json",
  ])
    if (!bound(dir, rel, m)) errors.push(`missing/stale artifact: ${rel}`);
  if (m.merge_inputs?.snapshot !== m.snapshot || !m.merge_inputs?.inputs)
    errors.push("merge provenance missing/stale");
  else
    for (const file of m.expected_agents)
      if (m.merge_inputs.inputs[file] !== m.artifacts?.[file]?.sha256)
        errors.push(`merge producer changed: ${file}`);
  for (const rel of m.expected_agents) {
    try {
      normalizeFindings(read(inside(dir, rel)));
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
  }
  for (const rel of m.required_artifacts || []) {
    try {
      const d = read(inside(dir, rel));
      if (rel === "deps-latest.json" && !dependencyCoverageValid(d, m.root))
        errors.push("dependency coverage incomplete");
      if (rel === "quality-metrics.json" && d.traversal?.complete !== true)
        errors.push("quality coverage incomplete");
      if (rel.endsWith("coverage.json")) {
        if (!d.inputs || !Object.keys(d.inputs).length)
          errors.push("security input provenance missing");
        else
          for (const [file, expected] of Object.entries(d.inputs)) {
            try {
              if (hash(fs.readFileSync(inside(dir, file))) !== expected)
                errors.push(`security input changed: ${file}`);
            } catch {
              errors.push(`security input missing: ${file}`);
            }
          }
      }
      if (
        rel.endsWith("coverage.json") &&
        (!["verified", "not_applicable"].includes(d.verification_status) ||
          d.run_id !== m.run_id ||
          d.snapshot !== m.snapshot)
      )
        errors.push("security coverage incomplete");
    } catch {
      errors.push(`invalid artifact: ${rel}`);
    }
  }
  try {
    const a = read(path.join(dir, "attempts.json"));
    for (const [stage, s] of Object.entries(a))
      if (!s.ok) errors.push(`${stage}: ${s.error}`);
  } catch {}
  const audit_complete = errors.length === 0;
  const implementation = [];
  try {
    uniqueIds(findings);
  } catch (e) {
    implementation.push(e.message);
  }
  for (const f of findings) {
    if (!closed(f)) implementation.push(`${f.id}: open`);
    else if (
      ["accepted", "accept", "refuted"].includes(String(f.status).toLowerCase())
    ) {
      if (!f.disposition_reason)
        implementation.push(`${f.id}: missing disposition reason`);
    } else
      implementation.push(
        ...validationErrors(dir, f.id, m).map((e) => `${f.id}: ${e}`),
      );
  }
  const implementation_complete = audit_complete && implementation.length === 0;
  return {
    audit_complete,
    implementation_complete,
    complete: m.intent === "fix" ? implementation_complete : audit_complete,
    errors: [...errors, ...(m.intent === "fix" ? implementation : [])],
    intent: m.intent,
    legacy: false,
  };
}

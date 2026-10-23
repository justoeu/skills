#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  SCHEMA,
  processLock,
  hash,
  read,
  atomic,
  inside,
  snapshot,
  meta,
  saveMeta,
  requireCurrent,
  bind,
  auditState,
  findingHash,
} from "./pack-contract.mjs";
const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i < 0 ? d : process.argv[i + 1];
};
const action = process.argv[2],
  dir = arg("dir");
try {
  if (action === "init") {
    const root = fs.realpathSync(arg("root", ".")),
      base = path.resolve(
        arg("out-base", path.join(root, "Docs/audit/ultra-deep")),
      ),
      run_id =
        new Date().toISOString().replace(/[:.]/g, "-") +
        "-" +
        crypto.randomUUID().slice(0, 8),
      out = path.join(base, run_id);
    const agents = String(arg("agents", "")).split(",").filter(Boolean);
    if (
      !agents.length ||
      agents.some((a) => !/^agent-[a-z0-9-]+\.json$/.test(a))
    )
      throw Error(
        "--agents requires comma-separated agent-<name>.json filenames",
      );
    const mode = arg("mode", "delta"),
      intent = arg("intent", "audit");
    if (!["delta", "full"].includes(mode) || !["audit", "fix"].includes(intent))
      throw Error("invalid mode/intent");
    const depth = arg("depth", mode === "full" ? "deep" : "fast"),
      effort = arg("effort", depth === "deep" ? "max" : "n/a");
    if (
      !["fast", "deep"].includes(depth) ||
      !(depth === "deep" ? ["medium", "high", "max"] : ["n/a"]).includes(effort)
    )
      throw Error("invalid depth/effort");
    const required = new Set();
    if (agents.some((a) => a.includes("prism")))
      required.add("deps-latest.json");
    if (agents.some((a) => /daedalus|echo|laconic|mentor|forge/.test(a)))
      required.add("quality-metrics.json");
    if (depth === "deep") {
      for (const name of [
        "sentinel",
        "lyra",
        "janus",
        "moira",
        "sigil",
        "basilisk",
        "proteus",
      ])
        if (agents.includes(`agent-${name}.json`))
          required.add(`sec-deep/${name}-coverage.json`);
    }
    const excludes = ["Docs/audit/ultra-deep"];
    const rel = path.relative(root, base).split(path.sep).join("/");
    if (rel && !rel.startsWith("..")) excludes.push(rel);
    if (base === root) throw Error("pack output cannot be source root");
    const git = (args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      return result.status === 0 ? result.stdout.trim() : "";
    };
    const head = git(["rev-parse", "--verify", "HEAD^{commit}"]);
    let baseRef = arg("base", null),
      baseCommit = null;
    if (baseRef || mode === "delta") {
      if (!head)
        throw Error(
          "delta/base requires a Git repository with a commit; use --mode full for a non-Git corpus",
        );
      if (!baseRef)
        baseRef = ["main", "master", "origin/main", "origin/master"].find(
          (ref) => git(["rev-parse", "--verify", `${ref}^{commit}`]),
        );
      if (!baseRef || baseRef.startsWith("-"))
        throw Error(
          "delta requires a valid --base REF (no default main/master base exists)",
        );
      baseCommit = git(["rev-parse", "--verify", `${baseRef}^{commit}`]);
      if (!baseCommit || !git(["merge-base", head, baseCommit]))
        throw Error(`invalid or unrelated Git base: ${baseRef}`);
    }
    fs.mkdirSync(out, { recursive: true });
    saveMeta(out, {
      schema_version: SCHEMA,
      run_id,
      root,
      excludes,
      snapshot: snapshot(root, excludes),
      head: git(["rev-parse", "HEAD"]),
      branch: git(["branch", "--show-current"]),
      mode,
      depth,
      effort,
      scope: arg("scope", null),
      base: baseRef,
      base_commit: baseCommit,
      intent,
      expected_agents: [...new Set(agents)],
      required_artifacts: [...required],
      artifacts: {},
      evidence: {},
      sequence: 0,
    });
    console.log(out);
  } else {
    if (!["status", "candidate-hash"].includes(action)) processLock(dir);
    let m = meta(dir);
    if (action === "snapshot") {
      m.snapshot = snapshot(m.root, m.excludes);
      m.head =
        spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: m.root,
          encoding: "utf8",
        }).stdout?.trim() || "";
      m.branch =
        spawnSync("git", ["branch", "--show-current"], {
          cwd: m.root,
          encoding: "utf8",
        }).stdout?.trim() || "";
      saveMeta(dir, m);
      console.log(m.snapshot);
    } else if (action === "bind") {
      bind(dir, arg("file"));
    } else if (action === "candidate-hash") {
      m = requireCurrent(dir);
      const doc = read(inside(dir, arg("file"))),
        c = doc.candidates?.find((c) => (c.temp_id || c.id) === arg("id"));
      if (!c) throw Error("candidate missing");
      console.log(hash(JSON.stringify(c)));
    } else if (action === "record") {
      m = requireCurrent(dir);
      const id = arg("id"),
        phase = arg("phase"),
        mode = arg("validation", "bug"),
        index = process.argv.indexOf("--"),
        cmd = process.argv.slice(index + 1);
      if (
        !/^[A-Z][A-Z0-9]*-[A-Z]+-\d+$/i.test(id || "") ||
        !["red", "green", "before", "after", "check"].includes(phase) ||
        index < 0 ||
        !cmd.length
      )
        throw Error(
          "record needs --id, --phase, --validation and -- command args",
        );
      const finding = read(path.join(dir, "FINDINGS.json")).find(
        (f) => f.id === id,
      );
      if (!finding) throw Error("finding missing");
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const r = spawnSync(cmd[0], cmd.slice(1), {
        cwd: m.root,
        env,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (r.error || r.signal)
        throw Error(`execution did not complete: ${r.error || r.signal}`);
      m.sequence = (m.sequence || 0) + 1;
      const log = `evidence/${id}-${phase}-${m.sequence}.json`;
      const value = {
        command: cmd,
        stdout: r.stdout,
        stderr: r.stderr,
        exit_code: r.status,
      };
      atomic(inside(dir, log), value);
      m.evidence[id] ||= {};
      m.evidence[id].mode = mode;
      m.evidence[id][phase] = {
        run_id: m.run_id,
        snapshot: m.snapshot,
        sequence: m.sequence,
        finding_hash: findingHash(finding),
        command: cmd,
        exit_code: r.status,
        log,
        log_hash: hash(fs.readFileSync(inside(dir, log))),
      };
      saveMeta(dir, m);
      console.log(
        JSON.stringify({ recorded: phase, exit_code: r.status, log }),
      );
    } else if (action === "attest") {
      m = requireCurrent(dir);
      const id = arg("id"),
        kind = arg("kind"),
        file = arg("file");
      if (
        !/^[A-Z][A-Z0-9]*-[A-Z]+-\d+$/i.test(id || "") ||
        !["review", "docs"].includes(kind)
      )
        throw Error("attest needs id and review|docs kind");
      const finding = read(path.join(dir, "FINDINGS.json")).find(
        (f) => f.id === id,
      );
      if (!finding) throw Error("finding missing");
      const d = read(inside(dir, file));
      if (!d.reason) throw Error("attestation requires reason");
      m = bind(dir, file, m);
      m.evidence[id] ||= {};
      m.evidence[id][kind] = {
        run_id: m.run_id,
        snapshot: m.snapshot,
        finding_hash: findingHash(finding),
        file,
      };
      saveMeta(dir, m);
    } else if (action === "status") {
      const rows = read(path.join(dir, "FINDINGS.json"));
      console.log(JSON.stringify(auditState(dir, rows), null, 2));
    } else
      throw Error("usage: pack-state init|snapshot|bind|record|attest|status");
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { read, hash } from "../pack-contract.mjs";
export const scripts = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function run(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    cwd,
    encoding: "utf8",
  });
}
export function ok(script, args, cwd) {
  const r = run(script, args, cwd);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r;
}
export function put(dir, file, value) {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  );
  return p;
}
export function fixture(
  t,
  {
    agents = ["agent-sentinel.json"],
    mode = "delta",
    intent = "audit",
    source = "export const version=1;\n",
  } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ultra-pack-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, "src/code.mjs", source);
  for (const args of [
    ["init", "-b", "main"],
    ["config", "user.name", "Fixture"],
    ["config", "user.email", "fixture@example.invalid"],
    ["add", "."],
    ["commit", "-m", "baseline"],
  ]) {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  const dir = ok(
    "pack-state.mjs",
    [
      "init",
      "--root",
      root,
      "--agents",
      agents.join(","),
      "--mode",
      mode,
      "--intent",
      intent,
    ],
    root,
  ).stdout.trim();
  return { root, dir };
}
export function boundPut(dir, file, value) {
  put(dir, file, value);
  ok("pack-state.mjs", ["bind", "--dir", dir, "--file", file], dir);
}
export function finding(extra = {}) {
  return {
    agent: "Sentinel",
    domain: "security",
    title: "owner guard",
    path: "src/code.mjs",
    line: 1,
    severity: "HIGH",
    confidence: "high",
    ...extra,
  };
}
export function panel(dir, candidates = [finding({ temp_id: "C1" })]) {
  const m = read(path.join(dir, "run-meta.json"));
  boundPut(dir, "sec-deep/inventory.json", {
    complete: true,
    required_hunters: [{ component: "api", lens: "authorization" }],
  });
  boundPut(dir, "sec-deep/hunter-api.json", {
    status: "complete",
    component: "api",
    lens: "authorization",
    findings: candidates,
  });
  boundPut(dir, "sec-deep/candidates.json", {
    run_id: m.run_id,
    snapshot: m.snapshot,
    candidates,
    coverage: {
      inventory: "sec-deep/inventory.json",
      hunters: ["sec-deep/hunter-api.json"],
    },
  });
  for (const c of candidates)
    for (const lens of ["REACHABILITY", "IMPACT", "DEFENSES"])
      put(dir, `sec-deep/votes/${c.temp_id}-${lens}.json`, {
        run_id: m.run_id,
        snapshot: m.snapshot,
        candidate_hash: hash(JSON.stringify(c)),
        lens,
        verdict: "TRUE_POSITIVE",
        reasoning: "Read source and guard at src/code.mjs:1",
        cited_paths: ["src/code.mjs:1"],
      });
}
export function verify(dir) {
  return run(
    "sec-verify.mjs",
    [
      "--dir",
      dir,
      "--candidates",
      path.join(dir, "sec-deep/candidates.json"),
      "--votes-dir",
      path.join(dir, "sec-deep/votes"),
      "--require-vote-files",
      "--out",
      path.join(dir, "agent-sentinel.json"),
      "--coverage-out",
      path.join(dir, "sec-deep/sentinel-coverage.json"),
    ],
    dir,
  );
}
export function attest(dir, id) {
  for (const kind of ["review", "docs"]) {
    boundPut(
      dir,
      `evidence/${id}-${kind}.json`,
      kind === "review"
        ? {
            status: "PASS",
            reason:
              "Independent inline review read source and tests; no remaining findings",
            findings: [],
          }
        : {
            status: "NOT_APPLICABLE",
            reason: "Internal fixture has no public contract change",
          },
    );
    ok(
      "pack-state.mjs",
      [
        "attest",
        "--dir",
        dir,
        "--id",
        id,
        "--kind",
        kind,
        "--file",
        `evidence/${id}-${kind}.json`,
      ],
      dir,
    );
  }
}

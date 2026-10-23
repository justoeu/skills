import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { read, auditState, hash } from "../pack-contract.mjs";
import {
  fixture,
  run,
  ok,
  put,
  boundPut,
  finding,
  panel,
  verify,
  attest,
} from "./pack-fixture.mjs";
test("panel rejects UNKNOWN, INCONCLUSIVE and wrong lens without replacing valid output", (t) => {
  const { dir } = fixture(t, { mode: "full" });
  panel(dir);
  assert.equal(verify(dir).status, 0);
  const original = fs.readFileSync(
      path.join(dir, "agent-sentinel.json"),
      "utf8",
    ),
    coverage = fs.readFileSync(
      path.join(dir, "sec-deep/sentinel-coverage.json"),
      "utf8",
    );
  const file = "sec-deep/votes/C1-DEFENSES.json",
    vote = read(path.join(dir, file));
  for (const change of [
    { verdict: "UNKNOWN" },
    { verdict: "INCONCLUSIVE" },
    { lens: "IMPACT" },
  ]) {
    put(dir, file, { ...vote, ...change });
    assert.notEqual(verify(dir).status, 0);
    assert.equal(
      fs.readFileSync(path.join(dir, "agent-sentinel.json"), "utf8"),
      original,
    );
    assert.equal(
      fs.readFileSync(
        path.join(dir, "sec-deep/sentinel-coverage.json"),
        "utf8",
      ),
      coverage,
    );
    assert.equal(auditState(dir, []).audit_complete, false);
  }
});
test("legitimate zero candidates completes audit; missing hunter never does", (t) => {
  const { dir } = fixture(t, { mode: "full" });
  panel(dir, []);
  assert.equal(verify(dir).status, 0);
  assert.equal(
    read(path.join(dir, "sec-deep/sentinel-coverage.json")).verification_status,
    "not_applicable",
  );
  ok("merge-findings.mjs", ["--dir", dir], dir);
  assert.equal(auditState(dir, []).audit_complete, true);
  fs.rmSync(path.join(dir, "sec-deep/hunter-api.json"));
  assert.notEqual(verify(dir).status, 0);
  assert.equal(auditState(dir, []).audit_complete, false);
});
test("votes cannot validate a changed candidate, snapshot, or new run", (t) => {
  const { dir, root } = fixture(t, { mode: "full" });
  panel(dir);
  assert.equal(verify(dir).status, 0);
  const original = fs.readFileSync(
    path.join(dir, "agent-sentinel.json"),
    "utf8",
  );
  const c = read(path.join(dir, "sec-deep/candidates.json"));
  c.candidates[0].path = "src/payment.mjs";
  boundPut(dir, "sec-deep/candidates.json", c);
  assert.notEqual(verify(dir).status, 0);
  assert.equal(
    fs.readFileSync(path.join(dir, "agent-sentinel.json"), "utf8"),
    original,
  );
  put(root, "src/code.mjs", "export const version=2;");
  assert.notEqual(verify(dir).status, 0);
  const other = ok(
    "pack-state.mjs",
    [
      "init",
      "--root",
      root,
      "--agents",
      "agent-sentinel.json",
      "--mode",
      "full",
    ],
    root,
  ).stdout.trim();
  assert.notEqual(other, dir);
  panel(other);
  put(
    other,
    "sec-deep/votes/C1-DEFENSES.json",
    read(path.join(dir, "sec-deep/votes/C1-DEFENSES.json")),
  );
  assert.notEqual(verify(other).status, 0);
});
test("merge enforces roster bindings and ignores leftover foreign agents", (t) => {
  const { dir } = fixture(t, { agents: ["agent-atlas.json"] });
  boundPut(dir, "agent-atlas.json", [
    finding({ agent: "Atlas", domain: "architecture" }),
  ]);
  put(dir, "agent-sentinel.json", [finding()]);
  ok("merge-findings.mjs", ["--dir", dir], dir);
  assert.equal(read(path.join(dir, "FINDINGS.json")).length, 1);
  const before = fs.readFileSync(path.join(dir, "FINDINGS.json"), "utf8");
  put(dir, "agent-atlas.json", "{broken");
  assert.notEqual(run("merge-findings.mjs", ["--dir", dir], dir).status, 0);
  assert.equal(
    fs.readFileSync(path.join(dir, "FINDINGS.json"), "utf8"),
    before,
  );
  assert.equal(auditState(dir, []).audit_complete, false);
});
test("duplicate IDs and unknown task IDs fail before mutation", (t) => {
  const { dir } = fixture(t);
  boundPut(dir, "agent-sentinel.json", [
    finding({ id: "SEC-SEN-001" }),
    finding({ id: "SEC-SEN-001", path: "src/other.js" }),
  ]);
  assert.notEqual(run("merge-findings.mjs", ["--dir", dir], dir).status, 0);
  boundPut(dir, "agent-sentinel.json", [finding()]);
  ok("merge-findings.mjs", ["--dir", dir], dir);
  const before = fs.readFileSync(path.join(dir, "FINDINGS.json"), "utf8");
  assert.notEqual(
    run("sync-progress.mjs", ["--dir", dir, "--done", "SEC-SEN-999"], dir)
      .status,
    0,
  );
  assert.equal(
    fs.readFileSync(path.join(dir, "FINDINGS.json"), "utf8"),
    before,
  );
});
test("real Git/Node flow: RED/GREEN plus docs check, proof gates, remerge, reopen, second run", (t) => {
  const source =
    "export function total(items){return items.reduce((s,x)=>s+x.price,0);}\n";
  const { root, dir } = fixture(t, {
    agents: ["agent-atlas.json"],
    intent: "fix",
    source,
  });
  put(
    root,
    "test/cart.test.mjs",
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {total} from '../src/code.mjs';test('quantity affects cart total',()=>assert.equal(total([{price:4,quantity:3}]),12));\n",
  );
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "fixture@example.invalid"],
    ["config", "user.name", "Fixture"],
    ["add", "src", "test"],
    ["commit", "-qm", "baseline"],
  ])
    assert.equal(spawnSync("git", args, { cwd: root }).status, 0);
  ok("pack-state.mjs", ["snapshot", "--dir", dir], root);
  const rows = [
    finding({
      agent: "Atlas",
      domain: "architecture",
      title: "cart quantity",
      id: "ARCH-ATL-001",
    }),
    finding({
      agent: "Atlas",
      domain: "architecture",
      title: "document total rule",
      id: "ARCH-ATL-002",
      severity: "LOW",
    }),
  ];
  boundPut(dir, "agent-atlas.json", rows);
  ok("merge-findings.mjs", ["--dir", dir], root);
  assert.notEqual(
    run("sync-progress.mjs", ["--dir", dir, "--done", "ARCH-ATL-001"], root)
      .status,
    0,
  );
  ok(
    "pack-state.mjs",
    [
      "record",
      "--dir",
      dir,
      "--id",
      "ARCH-ATL-001",
      "--phase",
      "red",
      "--validation",
      "bug",
      "--",
      process.execPath,
      "--test",
      "test/cart.test.mjs",
    ],
    root,
  );
  put(
    root,
    "src/code.mjs",
    "export function total(items){return items.reduce((s,x)=>s+x.price*x.quantity,0);}\n",
  );
  put(root, "README.md", "Total is sum of price times quantity.\n");
  ok("pack-state.mjs", ["snapshot", "--dir", dir], root);
  boundPut(dir, "agent-atlas.json", rows);
  ok("merge-findings.mjs", ["--dir", dir], root);
  ok(
    "pack-state.mjs",
    [
      "record",
      "--dir",
      dir,
      "--id",
      "ARCH-ATL-001",
      "--phase",
      "green",
      "--validation",
      "bug",
      "--",
      process.execPath,
      "--test",
      "test/cart.test.mjs",
    ],
    root,
  );
  ok(
    "pack-state.mjs",
    [
      "record",
      "--dir",
      dir,
      "--id",
      "ARCH-ATL-002",
      "--phase",
      "check",
      "--validation",
      "check",
      "--",
      process.execPath,
      "-e",
      "const fs=require('fs');if(!fs.readFileSync('README.md','utf8').includes('price times quantity'))process.exit(1)",
    ],
    root,
  );
  for (const id of ["ARCH-ATL-001", "ARCH-ATL-002"]) attest(dir, id);
  ok(
    "sync-progress.mjs",
    ["--dir", dir, "--done", "ARCH-ATL-001,ARCH-ATL-002"],
    root,
  );
  let findings = read(path.join(dir, "FINDINGS.json"));
  assert.equal(auditState(dir, findings).implementation_complete, true);
  assert.match(
    fs.readFileSync(path.join(dir, "report.html"), "utf8"),
    /IMPLEMENTATION COMPLETE/,
  );
  ok("merge-findings.mjs", ["--dir", dir], root);
  findings = read(path.join(dir, "FINDINGS.json"));
  assert.ok(findings.every((f) => f.status === "resolved"));
  assert.equal(auditState(dir, findings).implementation_complete, true);
  ok("sync-progress.mjs", ["--dir", dir, "--open", "ARCH-ATL-001"], root);
  findings = read(path.join(dir, "FINDINGS.json"));
  assert.equal(findings[0].blocks_pr, true);
  assert.equal(auditState(dir, findings).implementation_complete, false);
  ok("sync-progress.mjs", ["--dir", dir, "--done", "ARCH-ATL-001"], root);
  const proof = read(path.join(dir, "run-meta.json")).evidence["ARCH-ATL-001"]
    .green;
  put(dir, proof.log, "altered log");
  assert.equal(auditState(dir, findings).implementation_complete, false);
  ok("sync-progress.mjs", ["--dir", dir, "--refresh"], root);
  assert.doesNotMatch(
    fs.readFileSync(path.join(dir, "REPORT.md"), "utf8"),
    /✅ COMPLETE/,
  );
  const next = ok(
    "pack-state.mjs",
    ["init", "--root", root, "--agents", "agent-atlas.json"],
    root,
  ).stdout.trim();
  assert.notEqual(next, dir);
  assert.equal(auditState(next, []).audit_complete, false);
});
test("dependency errors and skips are visible in rendered DOM", (t) => {
  const { dir } = fixture(t);
  put(dir, "FINDINGS.json", []);
  put(dir, "deps-latest.json", {
    summary: { checked: 0, outdated: 0, errors: 1 },
    packages: [
      { name: "failed-package", error: "registry unavailable" },
      { name: "skipped-package", skipped: true, reason: "unresolved property" },
    ],
    update_map: { suggestions: [] },
  });
  ok(
    "build-report.mjs",
    [
      "--findings",
      path.join(dir, "FINDINGS.json"),
      "--out",
      path.join(dir, "report.html"),
    ],
    dir,
  );
  const html = fs.readFileSync(path.join(dir, "report.html"), "utf8");
  const els = new Map();
  const document = {
    getElementById(id) {
      if (!els.has(id))
        els.set(id, {
          innerHTML: "",
          addEventListener() {},
          querySelectorAll() {
            return [];
          },
        });
      return els.get(id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  runInNewContext(
    html.match(/<script>([\s\S]*?)<\/script>/)[1] + "\nrenderDeps();",
    { document, window: { addEventListener() {} } },
  );
  const rendered = els.get("view-deps").innerHTML;
  assert.match(rendered, /INCOMPLETE/);
  assert.match(rendered, /failed-package: registry unavailable/);
  assert.match(rendered, /skipped-package: unresolved property/);
  assert.doesNotMatch(rendered, /Todas as deps diretas/);
});

test("mixed panel rejects missing IDs/votes and explicit unreviewed coverage", (t) => {
  const { dir } = fixture(t, { mode: "full" });
  panel(dir, [
    finding({ temp_id: "C1" }),
    finding({ temp_id: "C2", path: "src/second.js" }),
  ]);
  fs.rmSync(path.join(dir, "sec-deep/votes/C2-IMPACT.json"));
  assert.notEqual(verify(dir).status, 0);
  assert.equal(fs.existsSync(path.join(dir, "agent-sentinel.json")), false);
  panel(dir);
  const c = read(path.join(dir, "sec-deep/candidates.json"));
  delete c.candidates[0].temp_id;
  boundPut(dir, "sec-deep/candidates.json", c);
  assert.notEqual(verify(dir).status, 0);
  panel(dir);
  const incomplete = read(path.join(dir, "sec-deep/candidates.json"));
  incomplete.unreviewed_candidate_sites = 1;
  boundPut(dir, "sec-deep/candidates.json", incomplete);
  assert.notEqual(verify(dir).status, 0);
});

test("characterization mode supports N1 IDs and rejects changed finding evidence", (t) => {
  const { dir, root } = fixture(t, {
    agents: ["agent-nexus.json"],
    intent: "fix",
  });
  const row = finding({
    agent: "Nexus",
    domain: "n1_performance",
    title: "batch equivalent calls",
    severity: "MEDIUM",
  });
  boundPut(dir, "agent-nexus.json", [row]);
  ok("merge-findings.mjs", ["--dir", dir], root);
  const id = read(path.join(dir, "FINDINGS.json"))[0].id;
  assert.equal(id, "N1-NEX-001");
  for (const phase of ["before", "after"])
    ok(
      "pack-state.mjs",
      [
        "record",
        "--dir",
        dir,
        "--id",
        id,
        "--validation",
        "characterization",
        "--phase",
        phase,
        "--",
        process.execPath,
        "--check",
        "src/code.mjs",
      ],
      root,
    );
  attest(dir, id);
  ok("sync-progress.mjs", ["--dir", dir, "--done", id], root);
  assert.equal(
    auditState(dir, read(path.join(dir, "FINDINGS.json")))
      .implementation_complete,
    true,
  );
  boundPut(dir, "agent-nexus.json", [
    { ...row, evidence: "Different trace at the same site" },
  ]);
  ok("merge-findings.mjs", ["--dir", dir], root);
  assert.equal(
    auditState(dir, read(path.join(dir, "FINDINGS.json")))
      .implementation_complete,
    false,
  );
});

test("refresh cannot rebind a manually changed aggregate as trusted output", (t) => {
  const { dir } = fixture(t);
  boundPut(dir, "agent-sentinel.json", [finding()]);
  ok("merge-findings.mjs", ["--dir", dir], dir);
  put(dir, "FINDINGS.json", []);
  ok("sync-progress.mjs", ["--dir", dir, "--refresh"], dir);
  assert.equal(auditState(dir, []).audit_complete, false);
  assert.match(
    fs.readFileSync(path.join(dir, "REPORT.md"), "utf8"),
    /missing\/stale artifact: FINDINGS.json/,
  );
});

test("canonical/explicit dependency policy is local, reported and never silently missing", (t) => {
  const { root } = fixture(t);
  put(root, ".ultra-deep-audit/dependency-policy.json", {
    docker: {},
    release_managed_images: ["example/runtime"],
  });
  const out = path.join(root, "deps.json");
  ok("check-deps-latest.mjs", ["--root", root, "--out", out], root);
  const report = read(out);
  assert.equal(
    report.policy.source,
    path.join(root, ".ultra-deep-audit/dependency-policy.json"),
  );
  assert.equal(
    report.policy.sha256,
    hash(fs.readFileSync(report.policy.source)),
  );
  put(root, "custom-policy.json", { docker: {}, release_managed_images: [] });
  ok(
    "check-deps-latest.mjs",
    ["--root", root, "--policy", "custom-policy.json", "--out", out],
    root,
  );
  assert.equal(read(out).policy.source, path.join(root, "custom-policy.json"));
  const before = fs.readFileSync(out, "utf8");
  assert.notEqual(
    run(
      "check-deps-latest.mjs",
      ["--root", root, "--policy", "missing.json", "--out", out],
      root,
    ).status,
    0,
  );
  assert.equal(fs.readFileSync(out, "utf8"), before);
});

test("empty candidate envelope cannot erase findings produced by completed hunters", (t) => {
  const { dir } = fixture(t, { mode: "full" });
  panel(dir);
  const c = read(path.join(dir, "sec-deep/candidates.json"));
  c.candidates = [];
  boundPut(dir, "sec-deep/candidates.json", c);
  assert.notEqual(verify(dir).status, 0);
  assert.equal(fs.existsSync(path.join(dir, "agent-sentinel.json")), false);
});

test("deleting a vote invalidates an already verified audit without a second tally", (t) => {
  const { dir } = fixture(t, { mode: "full" });
  panel(dir);
  assert.equal(verify(dir).status, 0);
  ok("merge-findings.mjs", ["--dir", dir], dir);
  assert.equal(
    auditState(dir, read(path.join(dir, "FINDINGS.json"))).audit_complete,
    true,
  );
  fs.rmSync(path.join(dir, "sec-deep/votes/C1-IMPACT.json"));
  assert.equal(
    auditState(dir, read(path.join(dir, "FINDINGS.json"))).audit_complete,
    false,
  );
  ok("sync-progress.mjs", ["--dir", dir, "--refresh"], dir);
  assert.match(
    fs.readFileSync(path.join(dir, "REPORT.md"), "utf8"),
    /security input missing/,
  );
});

test("new bound producer output requires a new merge; wrong agent identity is rejected", (t) => {
  const { dir } = fixture(t);
  boundPut(dir, "agent-sentinel.json", [finding()]);
  ok("merge-findings.mjs", ["--dir", dir], dir);
  boundPut(dir, "agent-sentinel.json", []);
  assert.equal(
    auditState(dir, read(path.join(dir, "FINDINGS.json"))).audit_complete,
    false,
  );
  ok("merge-findings.mjs", ["--dir", dir], dir);
  const rows = read(path.join(dir, "FINDINGS.json"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].not_in_latest_scan, true);
  boundPut(dir, "agent-sentinel.json", [finding({ agent: "Atlas" })]);
  assert.notEqual(run("merge-findings.mjs", ["--dir", dir], dir).status, 0);
});

test("partial dependency reports cannot claim coverage; real empty scan can", (t) => {
  const { dir, root } = fixture(t, { agents: ["agent-prism-freshness.json"] });
  boundPut(dir, "agent-prism-freshness.json", []);
  boundPut(dir, "deps-latest.json", { summary: { errors: 0 } });
  ok("merge-findings.mjs", ["--dir", dir], dir);
  assert.equal(auditState(dir, []).audit_complete, false);
  ok(
    "check-deps-latest.mjs",
    ["--root", root, "--out", path.join(dir, "deps-latest.json")],
    root,
  );
  ok(
    "pack-state.mjs",
    ["bind", "--dir", dir, "--file", "deps-latest.json"],
    dir,
  );
  assert.equal(auditState(dir, []).audit_complete, true);
  const d = read(path.join(dir, "deps-latest.json"));
  d.summary.checked = 5;
  boundPut(dir, "deps-latest.json", d);
  assert.equal(auditState(dir, []).audit_complete, false);
});

test("delta initialization rejects an unresolved Git base without creating a run", (t) => {
  const { root, dir } = fixture(t);
  const before = fs.readdirSync(path.dirname(dir));
  const r = run(
    "pack-state.mjs",
    [
      "init",
      "--root",
      root,
      "--agents",
      "agent-atlas.json",
      "--base",
      "refs/remotes/nonexistent/missing",
    ],
    root,
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /base/i);
  assert.deepEqual(fs.readdirSync(path.dirname(dir)), before);
});

test("concurrent binds cannot both succeed while losing a binding", async (t) => {
  const { root, dir } = fixture(t);
  put(dir, "a.json", []);
  put(dir, "b.json", []);
  const hook = put(
    dir,
    "barrier.cjs",
    `const fs=require('node:fs');const orig=fs.renameSync;fs.renameSync=function(a,b){if(String(b).endsWith('/run-meta.json')){fs.writeFileSync(process.env.ULTRA_READY,'ready');while(!fs.existsSync(process.env.ULTRA_RELEASE))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}return orig(a,b)};`,
  );
  const ready = path.join(dir, "ready"),
    release = path.join(dir, "release");
  const child = spawn(
    process.execPath,
    [
      "--require",
      hook,
      path.resolve("ultra-deep-audit/scripts/pack-state.mjs"),
      "bind",
      "--dir",
      dir,
      "--file",
      "a.json",
    ],
    {
      cwd: root,
      env: { ...process.env, ULTRA_READY: ready, ULTRA_RELEASE: release },
      stdio: "pipe",
    },
  );
  t.after(() => child.kill());
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve) => child.on("exit", resolve));
  try {
    const until = Date.now() + 5000;
    while (!fs.existsSync(ready)) {
      assert.ok(
        Date.now() < until,
        stderr || "first bind did not reach barrier",
      );
      await new Promise((r) => setTimeout(r, 10));
    }
    const second = run(
      "pack-state.mjs",
      ["bind", "--dir", dir, "--file", "b.json"],
      root,
    );
    put(release, "go");
    assert.equal(await done, 0, stderr);
    const m = read(path.join(dir, "run-meta.json"));
    if (second.status === 0)
      assert.ok(
        m.artifacts["a.json"] && m.artifacts["b.json"],
        "both succeeded but one binding was lost",
      );
    else {
      assert.match(second.stderr, /lock|busy/i);
      ok("pack-state.mjs", ["bind", "--dir", dir, "--file", "b.json"], root);
    }
    const final = read(path.join(dir, "run-meta.json"));
    assert.ok(final.artifacts["a.json"] && final.artifacts["b.json"]);
  } finally {
    put(release, "go");
  }
});

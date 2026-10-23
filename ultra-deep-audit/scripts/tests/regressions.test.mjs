import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const scripts = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ultra-regression-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(dir, file, value) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
}
function run(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    cwd,
    encoding: "utf8",
  });
}
const f = (extra = {}) => ({
  agent: "Sentinel",
  domain: "security",
  title: "owner guard",
  path: "src/auth.js",
  line: 1,
  severity: "HIGH",
  confidence: "high",
  ...extra,
});
test("invalid agent preserves prior aggregate and reports failure", (t) => {
  const d = fixture(t);
  put(d, "FINDINGS.json", [f({ id: "SEC-SEN-001" })]);
  fs.writeFileSync(path.join(d, "agent-sentinel.json"), '{"findings":[');
  const before = fs.readFileSync(path.join(d, "FINDINGS.json"), "utf8");
  const r = run("merge-findings.mjs", ["--dir", d], d);
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(path.join(d, "FINDINGS.json"), "utf8"), before);
});
test("single object agent output follows the documented surface schema", (t) => {
  const d = fixture(t);
  put(d, "agent-lyra.json", f({ agent: "Lyra" }));
  const r = run("merge-findings.mjs", ["--dir", d], d);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(d, "FINDINGS.json"))).length,
    1,
  );
});
test("assigned IDs are reserved before generating missing IDs", (t) => {
  const d = fixture(t);
  put(d, "agent-sentinel.json", [
    f({ id: "SEC-SEN-001" }),
    f({ path: "src/admin.js" }),
  ]);
  const r = run("merge-findings.mjs", ["--dir", d], d);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(fs.readFileSync(path.join(d, "FINDINGS.json")));
  assert.equal(new Set(rows.map((x) => x.id)).size, 2);
});
test("directory scope measures actual source and invalid scope fails strict", (t) => {
  const d = fixture(t);
  fs.mkdirSync(path.join(d, "src"));
  fs.writeFileSync(
    path.join(d, "src/rules.js"),
    "export function rules(x) {\n" +
      Array.from({ length: 20 }, (_, i) => ` if (x===${i}) return ${i};`).join(
        "\n",
      ) +
      "\n}\n",
  );
  const r = run(
    "measure-quality.mjs",
    ["--root", d, "--scope", "src", "--strict"],
    d,
  );
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.files_scanned, 1);
  assert.equal(m.hotspots[0].cyclomatic, 21);
  assert.notEqual(
    run(
      "measure-quality.mjs",
      ["--root", d, "--scope", "missing", "--strict"],
      d,
    ).status,
    0,
  );
});
test("legacy progress never advertises verified completion", (t) => {
  const d = fixture(t);
  put(d, "FINDINGS.json", [f({ id: "SEC-SEN-001", status: "resolved" })]);
  const r = run("sync-progress.mjs", ["--dir", d, "--refresh"], d);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(
    fs.readFileSync(path.join(d, "REPORT.md"), "utf8"),
    /✅ COMPLETE/,
  );
});

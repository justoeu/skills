/**
 * Tests for the *instrument*, not for the product code it measures.
 *
 * TOOL-ORC-002: measure-quality.mjs cut traversal at `depth > 8` and returned
 * early with no signal, so backend/src/main/java/com/appgp/backend/<layer>/<pkg>/
 * (depth 9) was silently absent from every metric handed to Daedalus/Echo/Laconic.
 *
 *   node --test .claude/skills/ultra-deep-audit/scripts/tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'measure-quality.mjs');

/** A function with cyclomatic complexity well above the hotspot threshold (12). */
const HOT_JAVA = `package com.appgp.backend.application.service.deep;

public class DeepService {
    public String process(int a, int b, String c) {
        if (a > 0 && b > 0) {
            for (int i = 0; i < a; i++) {
                while (b > i) {
                    if (c != null && !c.isBlank()) {
                        switch (c) {
                            case "x": return "x";
                            case "y": return "y";
                            default: break;
                        }
                    } else if (b > 10 || a > 10) {
                        try {
                            return c == null ? "n" : "y";
                        } catch (Exception e) {
                            return "e";
                        }
                    }
                    b--;
                }
            }
        }
        return a > b ? "a" : "b";
    }
}
`;

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-quality-fixture-'));
  // Mirrors the real layout: backend/src/main/java/com/appgp/backend/<layer>/<pkg>/
  // -> the file sits under 9 directory levels below the root.
  const deep = path.join(
    dir, 'backend', 'src', 'main', 'java', 'com', 'appgp', 'backend', 'application', 'service', 'deep',
  );
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'DeepService.java'), HOT_JAVA);
  // A shallow file so the run is never empty even when traversal is truncated.
  fs.writeFileSync(path.join(dir, 'shallow.js'), 'export const ok = 1;\n');
  return dir;
}

function run(root, extraArgs = []) {
  const out = path.join(root, 'metrics.json');
  const res = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out, ...extraArgs], {
    encoding: 'utf8',
  });
  return {
    status: res.status,
    stderr: res.stderr || '',
    json: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null,
  };
}

test('sees a Java hotspot nested 9 directories deep (real backend layout)', () => {
  const root = makeFixture();
  const { json } = run(root);
  assert.ok(json, 'script must write its output file');

  const deepHotspots = json.hotspots.filter((h) => h.path.endsWith('DeepService.java'));
  assert.ok(
    deepHotspots.length > 0,
    `expected the depth-9 Java hotspot in the output, got hotspots for: ${JSON.stringify(json.hotspots.map((h) => h.path))}`,
  );
  assert.ok(deepHotspots[0].cyclomatic >= 12, `expected cc >= 12, got ${deepHotspots[0].cyclomatic}`);
});

test('reports truncated directories instead of dropping them in silence', () => {
  const root = makeFixture();
  const { json, stderr } = run(root, ['--max-depth', '3']);

  assert.ok(json.traversal, 'output must carry a traversal ledger');
  assert.ok(
    json.traversal.truncated_dirs.length > 0,
    'a depth-capped run must list the directories it refused to enter',
  );
  assert.match(stderr, /INCOMPLETE/, 'truncation must be shouted on stderr, not whispered');
  assert.equal(
    json.hotspots.filter((h) => h.path.endsWith('DeepService.java')).length,
    0,
    'sanity: at --max-depth 3 the deep file really is out of reach (so the first test is meaningful)',
  );
});

test('--strict turns an incomplete traversal into a non-zero exit', () => {
  const root = makeFixture();
  assert.notEqual(run(root, ['--max-depth', '3', '--strict']).status, 0);
  assert.equal(run(root, ['--strict']).status, 0, 'a complete traversal must still exit 0');
});

test('flags test sources so production hotspots can be ranked apart', () => {
  const root = makeFixture();
  const testDir = path.join(root, 'backend', 'src', 'test', 'java', 'com', 'appgp', 'backend', 'application', 'service', 'deep');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(
    path.join(testDir, 'DeepServiceTest.java'),
    HOT_JAVA.replace(/DeepService/g, 'DeepServiceTest'),
  );
  const { json } = run(root);

  const prod = json.hotspots.find((h) => h.path.endsWith('main/java/com/appgp/backend/application/service/deep/DeepService.java'));
  const spec = json.hotspots.find((h) => h.path.endsWith('DeepServiceTest.java'));
  assert.ok(prod && spec, 'both sources must be measured');
  assert.equal(prod.test_file, false);
  assert.equal(spec.test_file, true);
});

test('skip-list exclusions are recorded, not invisible', () => {
  const root = makeFixture();
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'a.js'), 'const a = 1;\n');
  const { json } = run(root);
  assert.ok(
    json.traversal.skipped_dirs.some((d) => d.path === 'node_modules'),
    'directories dropped by the skip list must appear in the ledger with a reason',
  );
});

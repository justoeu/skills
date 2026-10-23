import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, captureEvidence, attachEvidence } from '../../state-io.mjs';
import { HOOK_IDS } from '../../hooks.mjs';

// Complete the evidence envelope for unit fixtures. Integration tests use initRun
// and real product files instead, so source invalidation is independently tested.
export function completePack(dir) {
  const meta = {
    run_id: 'fixture-run',
    repo_root: dir,
    app: 'fixture',
    branch: 'feature/fixture',
    kind: 'feature',
    status: 'in_progress',
    spec: 'spec.md',
    spec_status: 'confirmed',
    steps: {},
    ...readJson(path.join(dir, 'run-meta.json'), {}),
  };
  writeJson(path.join(dir, 'run-meta.json'), meta);
  if (meta.spec && !fs.existsSync(path.resolve(dir, meta.spec))) {
    const spec = path.resolve(dir, meta.spec);
    fs.mkdirSync(path.dirname(spec), { recursive: true });
    fs.writeFileSync(spec, 'Fixture contract');
  }
  const defaults = {
    'tests.json': { cmd: 'fixture test', ok: true, failed: 0 },
    'payloads.json': [],
    'hooks/arch-map.json': { source: 'greenfield' },
    'hooks/ui-scope.json': { ui_touched: false },
    'project-gates.json': { gates: [], reason: 'fixture has no additional gates' },
    'tracking.json': { files: [], reason: 'fixture has no other tracking files' },
  };
  for (const [name, doc] of Object.entries(defaults))
    if (!fs.existsSync(path.join(dir, name))) writeJson(path.join(dir, name), doc);
  for (const hook of HOOK_IDS)
    if (!fs.existsSync(path.join(dir, 'hooks', `${hook}.json`)))
      writeJson(path.join(dir, 'hooks', `${hook}.json`), { hook, verdict: 'APPROVE', findings: [] });
  const snapshot = captureEvidence(dir);
  for (const file of [
    'tests.json',
    'coverage.json',
    'immutability.json',
    'project-gates.json',
    'tracking.json',
    'hooks/ui-scope.json',
    ...HOOK_IDS.map((h) => `hooks/${h}.json`),
    ...['standards', 'spec', 'correctness'].map((a) => `reviews/${a}.json`),
  ]) {
    const doc = readJson(path.join(dir, file));
    if (doc) writeJson(path.join(dir, file), attachEvidence(dir, doc, snapshot));
  }
  return dir;
}

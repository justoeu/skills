#!/usr/bin/env node
/** Oracle-only pack mutations: init, adopt, step, task, sync, snapshot, stamp, close. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  readJson,
  writeJson,
  atomicWrite,
  withPackLock,
  captureEvidence,
  attachEvidence,
  artifactIdentity,
} from './state-io.mjs';
import { scorePack, renderTasksMd } from './score.mjs';
import { buildArchMapFromAtlas } from './hooks.mjs';

export const STEPS = [
  'explore',
  'planner',
  'worktrees',
  'implement',
  'immutability',
  'ui-acceptance',
  'review',
  'score',
  'clean',
  'project-gates',
];
export const STEP_STATUS = ['in_progress', 'done', 'failed', 'skipped'];
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? fallback);
}
function metaFile(dir) {
  return path.join(dir, 'run-meta.json');
}
function within(dir, rel) {
  const target = path.resolve(dir, rel);
  if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('file must be inside pack');
  return target;
}
function syncTasks(dir) {
  const doc = readJson(path.join(dir, 'TASKS.json'));
  if (!Array.isArray(doc?.tasks)) throw new Error('TASKS.json must contain tasks[]');
  atomicWrite(path.join(dir, 'TASKS.md'), renderTasksMd(doc));
  return doc;
}
export function recordStep(dir, step, status, { note, now = new Date() } = {}) {
  if (!STEPS.includes(step)) throw new Error(`unknown step ${step}`);
  if (!STEP_STATUS.includes(status)) throw new Error(`unknown status ${status}`);
  return withPackLock(dir, () => {
    const meta = readJson(metaFile(dir), {}),
      at = now.toISOString();
    meta.steps ||= {};
    const cur = meta.steps[step] || {};
    cur.started_at ||= at;
    cur.status = status;
    if (status === 'in_progress') delete cur.finished_at;
    else cur.finished_at = at;
    if (note) cur.note = note;
    meta.steps[step] = cur;
    meta.started_at ||= at;
    meta.updated_at = at;
    meta.status = 'in_progress';
    writeJson(metaFile(dir), meta);
    return meta;
  });
}
export function initRun(
  root,
  {
    branch,
    spec,
    kind = 'feature',
    loop = 'full',
    worktree_n = 3,
    coverage_floor = 90,
    ui_drive,
    test_cmd = '',
    now = new Date(),
  } = {},
) {
  root = fs.realpathSync(root);
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const br = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
  branch ||= br.stdout?.trim() || 'no-git';
  if (!['feature', 'greenfield', 'refactor'].includes(kind) || !['full', 'task'].includes(loop))
    throw new Error('invalid kind/loop');
  if (ui_drive && !['fast', 'guided', 'off'].includes(ui_drive)) throw new Error('invalid ui_drive');
  if (!Number.isFinite(Number(coverage_floor)) || Number(coverage_floor) > 100)
    throw new Error('invalid coverage floor');
  if (spec && !fs.existsSync(path.resolve(root, spec))) throw new Error('spec file not found');
  const run_id = randomUUID(),
    slug = branch.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
  const dir = path.join(
    root,
    'docs',
    'impl',
    'make-me-happy',
    `${now.toISOString().slice(0, 10)}-${slug}-${run_id}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    schema_version: 2,
    run_id,
    repo_root: root,
    app: path.basename(root),
    branch,
    base: git.status === 0 ? git.stdout.trim() : null,
    head: git.status === 0 ? git.stdout.trim() : null,
    kind,
    loop,
    worktree_n: Math.max(1, Math.min(8, Number(worktree_n) || 3)),
    worktree_prefix: `mmh-${run_id.slice(0, 8)}`,
    spec: spec || null,
    spec_status: spec ? 'confirmed' : 'draft',
    coverage_floor: Math.max(90, Number(coverage_floor)),
    ui_drive: ui_drive || null,
    test_cmd,
    status: 'in_progress',
    started_at: now.toISOString(),
    updated_at: now.toISOString(),
    steps: {},
  };
  writeJson(metaFile(dir), meta);
  const map = buildArchMapFromAtlas(root);
  const tracked =
    git.status === 0 ? spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.trim() : null;
  writeJson(
    path.join(dir, 'hooks/arch-map.json'),
    map ||
      (tracked === '' || fs.readdirSync(root).every((f) => ['.git', 'docs'].includes(f))
        ? { source: 'greenfield', at: now.toISOString() }
        : {
            source: 'pending',
            notes:
              'Oracle must inspect the repository and write the manual architecture map before planning.',
          }),
  );
  writeJson(path.join(dir, 'tracking.json'), { files: [], reason: null });
  return { dir, meta };
}
export function updateTask(dir, result) {
  return withPackLock(dir, () => {
    const doc = readJson(path.join(dir, 'TASKS.json'));
    if (!Array.isArray(doc?.tasks)) throw new Error('TASKS.json missing');
    const row = doc.tasks.find((t) => t.id === result.id);
    if (!row) throw new Error('unknown task');
    if (!Number.isInteger(result.expected_version) || result.expected_version !== (row.version || 0))
      throw new Error('stale task result; re-read this task before applying');
    const patch = result.patch;
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      ['id', 'worktree', 'depends_on'].some((k) => k in patch)
    )
      throw new Error('task patch must preserve identity and ownership');
    if (patch.status && !['OPEN', 'IN_PROGRESS', 'DONE', 'BLOCKED'].includes(patch.status))
      throw new Error('invalid task status');
    Object.assign(row, patch, { version: (row.version || 0) + 1 });
    writeJson(path.join(dir, 'TASKS.json'), doc);
    syncTasks(dir);
    const meta = readJson(metaFile(dir), {});
    meta.status = 'in_progress';
    meta.updated_at = new Date().toISOString();
    writeJson(metaFile(dir), meta);
    return row;
  });
}
export function stampFile(dir, file, snapshot) {
  return withPackLock(dir, () => {
    if (!snapshot) throw new Error('snapshot captured before verification is required');
    const target = within(dir, file),
      doc = readJson(target);
    if (!doc || Array.isArray(doc)) throw new Error('evidence artifact must be a JSON object');
    const stamped = attachEvidence(dir, doc, snapshot);
    writeJson(target, stamped);
    return stamped;
  });
}
export function closeRun(dir) {
  return withPackLock(dir, () => {
    const result = scorePack(dir);
    writeJson(path.join(dir, 'score.json'), result);
    if (!result.closable) throw new Error(result.blockers.map((b) => b.reason).join('\n'));
    syncTasks(dir);
    const meta = readJson(metaFile(dir)),
      at = new Date().toISOString();
    meta.status = 'closed';
    meta.finished_at = at;
    meta.updated_at = at;
    writeJson(metaFile(dir), meta);
    writeJson(path.join(dir, 'closure.json'), {
      run_id: meta.run_id,
      closable: true,
      at,
      evidence: result.evidence,
      artifact_hash: artifactIdentity(dir),
    });
    return result;
  });
}
if (path.basename(process.argv[1] || '') === 'run-meta.mjs') {
  try {
    const cmd = process.argv[2],
      dir = path.resolve(arg('dir', '.'));
    if (cmd === 'init')
      console.log(
        JSON.stringify(
          initRun(path.resolve(arg('root', '.')), {
            spec: arg('spec', null),
            kind: arg('kind', 'feature'),
            loop: arg('loop', 'full'),
            worktree_n: arg('worktree', '3'),
            coverage_floor: String(arg('cobertura', '90')).replace('%', ''),
            ui_drive: arg('ui-drive', null),
            test_cmd: arg('test-cmd', ''),
          }),
          null,
          2,
        ),
      );
    else if (cmd === 'adopt')
      withPackLock(dir, () => {
        const meta = readJson(metaFile(dir), {});
        meta.run_id ||= randomUUID();
        meta.schema_version = 2;
        meta.repo_root = fs.realpathSync(arg('root', '.'));
        meta.status = 'in_progress';
        writeJson(metaFile(dir), meta);
        console.log('adopted; rerun verification before stamping legacy artifacts');
      });
    else if (cmd === 'step')
      console.log(
        JSON.stringify(
          recordStep(dir, arg('step', ''), arg('status', ''), { note: arg('note', '') }).steps,
          null,
          2,
        ),
      );
    else if (cmd === 'task')
      console.log(JSON.stringify(updateTask(dir, readJson(path.resolve(arg('result', '')))), null, 2));
    else if (cmd === 'sync') withPackLock(dir, () => syncTasks(dir));
    else if (cmd === 'snapshot') {
      const snapshot = captureEvidence(dir);
      writeJson(within(dir, arg('file', 'validation-start.json')), snapshot);
      console.log(JSON.stringify(snapshot));
    } else if (cmd === 'stamp')
      console.log(
        JSON.stringify(
          stampFile(
            dir,
            arg('file', ''),
            readJson(path.resolve(arg('snapshot', path.join(dir, 'validation-start.json')))),
          ),
          null,
          2,
        ),
      );
    else if (cmd === 'close') console.log(JSON.stringify(closeRun(dir), null, 2));
    else throw new Error('usage: run-meta.mjs init|adopt|step|task|sync|snapshot|stamp|close');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

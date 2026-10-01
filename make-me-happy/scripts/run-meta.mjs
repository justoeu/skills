#!/usr/bin/env node
/**
 * Step timestamps in run-meta.json (feeds the report timeline).
 *
 *   node run-meta.mjs step --dir "$OUT" --step implement --status in_progress
 *   node run-meta.mjs step --dir "$OUT" --step implement --status done --note "3 slices merged"
 *
 * Steps: explore planner worktrees implement immutability review score clean project-gates
 * Status: in_progress | done | failed | skipped
 */
import fs from 'node:fs';
import path from 'node:path';

export const STEPS = [
  'explore', 'planner', 'worktrees', 'implement', 'immutability',
  'review', 'score', 'clean', 'project-gates',
];
export const STEP_STATUS = ['in_progress', 'done', 'failed', 'skipped'];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

export function recordStep(dir, step, status, { note, now = new Date() } = {}) {
  if (!STEPS.includes(step)) throw new Error(`unknown step "${step}" (expected ${STEPS.join(', ')})`);
  if (!STEP_STATUS.includes(status)) throw new Error(`unknown status "${status}" (expected ${STEP_STATUS.join(', ')})`);
  const file = path.join(dir, 'run-meta.json');
  const meta = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const at = now.toISOString();
  meta.steps = meta.steps && typeof meta.steps === 'object' ? meta.steps : {};
  const cur = meta.steps[step] || {};
  if (!cur.started_at) cur.started_at = at;
  if (status === 'in_progress') {
    delete cur.finished_at;
  } else {
    cur.finished_at = at;
  }
  cur.status = status;
  if (note) cur.note = note;
  meta.steps[step] = cur;
  if (!meta.started_at) meta.started_at = at;
  meta.updated_at = at;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

if (path.basename(process.argv[1] || '') === 'run-meta.mjs') {
  const cmd = process.argv[2];
  if (cmd !== 'step') {
    console.error('usage: run-meta.mjs step --dir OUT --step <step> --status <status> [--note text]');
    process.exit(2);
  }
  try {
    const meta = recordStep(path.resolve(arg('dir', '.')), arg('step', ''), arg('status', ''), { note: arg('note', '') });
    console.log(JSON.stringify(meta.steps, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

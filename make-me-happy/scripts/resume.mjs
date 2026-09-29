#!/usr/bin/env node
/**
 * Crash/session resume for make-me-happy.
 *
 *   node resume.mjs --root . --prefix mmh
 *
 * Prints JSON. resumable=true → Oracle jumps to next_step, does not start a new pack.
 */
import fs from 'node:fs';
import path from 'node:path';
import { leftoverWorktrees } from './worktrees.mjs';
import { scorePack } from './score.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const PACK_REL = path.join('docs', 'impl', 'make-me-happy');

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function verdict(dir, name) {
  const f = path.join(dir, 'reviews', name);
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, 'utf8').match(/VERDICT:\s*(APPROVE|REJECT|SKIP)/i);
  return m ? m[1].toUpperCase() : null;
}

export function inferNextStep(dir, leftover) {
  const meta = loadJson(path.join(dir, 'run-meta.json'), {});
  const specReady = Boolean(meta.spec) && meta.spec_status !== 'draft';
  const tasks = loadJson(path.join(dir, 'TASKS.json'), { tasks: [] }).tasks || [];
  const wt = loadJson(path.join(dir, 'worktrees.json'), { slices: [], skipped: false });
  const immut = loadJson(path.join(dir, 'immutability.json'), { green: false });
  const openTasks = tasks.filter((t) => t.status !== 'DONE');
  const unmerged = (wt.slices || []).filter((s) => !s.merged);
  const liveWt = leftover.length > 0 || unmerged.length > 0;

  if (!specReady && tasks.length === 0) return 'explore';
  if (tasks.length === 0) return 'planner';
  if (!wt.skipped && !(wt.slices || []).length && leftover.length === 0) return 'worktrees-add';
  if (openTasks.length || liveWt) return 'implement';
  if (immut.green !== true) return 'immutability';
  const st = verdict(dir, 'standards.md');
  const spec = verdict(dir, 'spec.md');
  const cor = verdict(dir, 'correctness.md');
  const specOk = spec === 'APPROVE' || spec === 'SKIP';
  if (st !== 'APPROVE' || !specOk || cor !== 'APPROVE') return 'review';
  const score = scorePack(dir);
  if (!score.closable) return leftover.length ? 'clean' : 'score';
  if (leftover.length) return 'clean';
  return 'closed';
}

export function findPacks(root) {
  const base = path.join(root, PACK_REL);
  if (!fs.existsSync(base)) return [];
  const packs = [];
  for (const name of fs.readdirSync(base)) {
    const dir = path.join(base, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const meta = loadJson(path.join(dir, 'run-meta.json'), null);
    if (!meta && !fs.existsSync(path.join(dir, 'TASKS.json'))) continue;
    packs.push({
      dir,
      name,
      mtime: fs.statSync(dir).mtimeMs,
      meta: meta || {},
    });
  }
  packs.sort((a, b) => b.mtime - a.mtime);
  return packs;
}

export function resumeState(root, prefix = 'mmh') {
  const leftover = leftoverWorktrees(root, prefix);
  const packs = findPacks(root);
  const scored = packs.map((p) => {
    const next_step = inferNextStep(p.dir, leftover);
    return { ...p, next_step, closed: next_step === 'closed' };
  });
  const open = scored.filter((p) => !p.closed);
  const candidate = open[0] || null;
  const resumable = Boolean(candidate) || leftover.length > 0;
  let next_step = candidate ? candidate.next_step : leftover.length ? 'implement' : 'closed';
  if (!candidate && leftover.length) next_step = 'implement';

  return {
    resumable,
    next_step,
    pack: candidate ? candidate.dir : null,
    pack_name: candidate ? candidate.name : null,
    loop: candidate?.meta?.loop || null,
    kind: candidate?.meta?.kind || null,
    spec: candidate?.meta?.spec || null,
    worktree_n: candidate?.meta?.worktree_n || null,
    leftover_worktrees: leftover,
    open_packs: open.map((p) => ({ dir: p.dir, next_step: p.next_step })),
  };
}

if (path.basename(process.argv[1] || '') === 'resume.mjs') {
  const root = path.resolve(arg('root', '.'));
  const prefix = arg('prefix', 'mmh');
  const state = resumeState(root, prefix);
  console.log(JSON.stringify(state, null, 2));
  process.exit(state.resumable ? 0 : 3);
}

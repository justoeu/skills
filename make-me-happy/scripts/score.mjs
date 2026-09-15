#!/usr/bin/env node
/**
 * Quality score: five gates × 2 points. Close only at 10 **and** coverage ≥ floor.
 *
 *   node score.mjs --dir docs/impl/make-me-happy/<run>
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const COVERAGE_FLOOR = 95;

function verdictOf(md) {
  if (!md) return null;
  const m = md.match(/VERDICT:\s*(APPROVE|REJECT|SKIP)/i);
  return m ? m[1].toUpperCase() : null;
}

function readCoverage(dir) {
  const doc = loadJson(path.join(dir, 'coverage.json'), null);
  const pct = doc && Number(doc.pct);
  const measured = Number.isFinite(pct);
  const ok = measured && pct >= COVERAGE_FLOOR;
  return {
    pct: measured ? pct : null,
    floor: COVERAGE_FLOOR,
    tool: doc?.tool || null,
    ok,
    detail: !doc
      ? 'coverage.json missing'
      : ok
        ? `${pct}% >= ${COVERAGE_FLOOR}%`
        : `${measured ? pct : '?'}% < ${COVERAGE_FLOOR}% floor`,
  };
}

export function scorePack(dir) {
  const tasksDoc = loadJson(path.join(dir, 'TASKS.json'), { tasks: [] });
  const tasks = tasksDoc.tasks || [];
  const immut = loadJson(path.join(dir, 'immutability.json'), { green: false });
  const wt = loadJson(path.join(dir, 'worktrees.json'), { slices: [], skipped: false });
  const reviewsDir = path.join(dir, 'reviews');
  const readReview = (name) => {
    const f = path.join(reviewsDir, name);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };
  const standards = verdictOf(readReview('standards.md'));
  const spec = verdictOf(readReview('spec.md'));
  const correctness = verdictOf(readReview('correctness.md'));

  const gates = [];

  const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'DONE');
  gates.push({
    id: 'tasks',
    ok: allDone,
    detail: allDone ? `${tasks.length} DONE` : `${tasks.filter((t) => t.status === 'DONE').length}/${tasks.length} DONE`,
  });

  const rg = tasks.length > 0 && tasks.every(
    (t) => t.status !== 'DONE' || (t.red_green === true && Number(t.tests_added) >= 1),
  );
  gates.push({
    id: 'red-green',
    ok: rg && tasks.length > 0,
    detail: rg ? 'each DONE has tests_added>=1 and red_green' : 'missing tests or red_green on a DONE task',
  });

  gates.push({
    id: 'immutability',
    ok: immut.green === true,
    detail: immut.green ? (immut.suite || []).join(', ') || 'green' : 'immutability.json not green',
  });

  const specOk = spec === 'APPROVE' || spec === 'SKIP';
  const reviewOk = standards === 'APPROVE' && specOk && correctness === 'APPROVE';
  gates.push({
    id: 'review',
    ok: reviewOk,
    detail: `standards=${standards || 'missing'} spec=${spec || 'missing'} correctness=${correctness || 'missing'}`,
  });

  const slices = wt.slices || [];
  const wtOk = wt.skipped === true
    || (slices.length > 0 && slices.every((s) => s.merged && s.removed));
  gates.push({
    id: 'worktrees',
    ok: wtOk,
    detail: wt.skipped ? 'worktrees skipped (not a git repo / N=1)' : `${slices.filter((s) => s.merged).length}/${slices.length} merged+removed`,
  });

  const coverage = readCoverage(dir);
  const points = gates.reduce((n, g) => n + (g.ok ? 2 : 0), 0);
  return {
    score: points,
    max: 10,
    coverage,
    closable: points === 10 && coverage.ok,
    gates,
  };
}

function renderTasksMd(doc) {
  const tasks = doc.tasks || [];
  const lines = [`# Tasks — ${doc.spec || 'feature'}`, ''];
  for (const t of tasks) {
    const box = t.status === 'DONE' ? '[x]' : '[ ]';
    lines.push(
      `- ${box} **${t.id}** ${t.title}  | tests: ${t.tests_added || 0} | red-green: ${t.red_green ? 'yes' : 'no'} | immutability: ${t.immutability ? 'yes' : 'no'} | wt: ${t.worktree ?? '-'} | ${t.status}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export { renderTasksMd };

if (path.basename(process.argv[1] || '') === 'score.mjs') {
  const dir = path.resolve(arg('dir', '.'));
  const result = scorePack(dir);
  fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(result, null, 2) + '\n');
  const tasks = loadJson(path.join(dir, 'TASKS.json'), null);
  if (tasks) {
    fs.writeFileSync(path.join(dir, 'TASKS.md'), renderTasksMd(tasks));
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.closable) process.exit(1);
}

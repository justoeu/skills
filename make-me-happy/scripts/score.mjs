#!/usr/bin/env node
/**
 * Quality score: five gates × 2 points. Close only at 10 **and** coverage ≥ floor.
 *
 *   node score.mjs --dir docs/impl/make-me-happy/<run>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aggregateVerdict, HOOK_IDS } from './hooks.mjs';
import {
  captureEvidence,
  validEvidence,
  readJson,
  writeJson,
  validSeal,
  atomicWrite,
  withPackLock,
} from './state-io.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return readJson(file, fallback);
}

export const COVERAGE_FLOOR_MIN = 90;
export const COVERAGE_FLOOR = COVERAGE_FLOOR_MIN;

export function parseCoverageFloor(raw) {
  if (raw == null || raw === '') return COVERAGE_FLOOR_MIN;
  const n = Number(String(raw).replace(/%/g, '').trim());
  if (!Number.isFinite(n)) return COVERAGE_FLOOR_MIN;
  return n;
}

/** Default 90. `--cobertura` / run-meta / coverage.json may raise, never lower. */
export function effectiveCoverageFloor(requested) {
  return Math.max(COVERAGE_FLOOR_MIN, parseCoverageFloor(requested));
}

const VERDICTS = new Set(['APPROVE', 'REJECT', 'SKIP']);

export function verdictOf(md) {
  if (!md) return null;
  const m = md.match(/VERDICT:\s*(APPROVE|REJECT|SKIP)/i);
  return m ? m[1].toUpperCase() : null;
}

function safeJson(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

/**
 * Verdict of one review axis. `reviews/<axis>.json` (structured, see
 * references/pack-schemas.md) wins; `reviews/<axis>.md` with a `VERDICT:` line
 * is the fallback for older packs.
 */
export function axisVerdict(dir, axis) {
  const doc = safeJson(path.join(dir, 'reviews', `${axis}.json`));
  const fromJson = doc && String(doc.verdict || '').toUpperCase();
  if (fromJson && VERDICTS.has(fromJson)) return fromJson;
  const md = path.join(dir, 'reviews', `${axis}.md`);
  return verdictOf(fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '');
}

/** Immutability suite as a list of names; accepts strings or `{ name }` objects. */
export function immutabilityTests(immut) {
  const raw = Array.isArray(immut?.tests) ? immut.tests : Array.isArray(immut?.suite) ? immut.suite : [];
  return raw
    .map((t) => (typeof t === 'string' ? t : t && (t.name || t.test || t.id)))
    .filter(Boolean)
    .map(String);
}

function readCoverage(dir) {
  const doc = loadJson(path.join(dir, 'coverage.json'), null);
  const meta = loadJson(path.join(dir, 'run-meta.json'), {});
  const cli = arg('floor', '') || arg('cobertura', '');
  const requested = Math.max(
    COVERAGE_FLOOR_MIN,
    ...[cli, doc?.floor, meta?.coverage_floor].map(parseCoverageFloor),
  );
  const floor = effectiveCoverageFloor(requested);
  const pct = doc && Number(doc.pct);
  const measured = doc?.pct != null && doc.pct !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  const ok = measured && pct >= floor;
  return {
    pct: measured ? pct : null,
    floor,
    floor_min: COVERAGE_FLOOR_MIN,
    requested: parseCoverageFloor(requested),
    tool: doc?.tool || null,
    ok,
    detail: !doc
      ? 'coverage.json missing'
      : ok
        ? `${pct}% >= ${floor}%`
        : `${measured ? pct : '?'}% < ${floor}% floor`,
  };
}

export function taskValidation(t) {
  const proof = (p) =>
    p && typeof p === 'object' && (p.command || p.cmd) && (p.output_excerpt || p.output || p.note);
  if (t.validation === 'characterization')
    return proof(t.before) && t.before.ok === true && proof(t.after) && t.after.ok === true;
  if (t.validation === 'check')
    return (
      ['docs', 'config'].includes(t.kind) &&
      !!t.validation_reason &&
      Array.isArray(t.checks) &&
      t.checks.length > 0 &&
      t.checks.every((c) => proof(c) && c.ok === true)
    );
  return t.red_green === true && Number(t.tests_added) >= 1 && proof(t.red) && proof(t.green);
}

function validPlan(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  if (
    ids.size !== tasks.length ||
    tasks.some(
      (t) => typeof t.id !== 'string' || !t.id || (t.depends_on != null && !Array.isArray(t.depends_on)),
    )
  )
    return false;
  const byId = new Map(tasks.map((t) => [t.id, t])),
    active = new Set(),
    visited = new Set();
  const visit = (id) => {
    if (active.has(id) || !ids.has(id)) return false;
    if (visited.has(id)) return true;
    active.add(id);
    if (!(byId.get(id).depends_on || []).every(visit)) return false;
    active.delete(id);
    visited.add(id);
    return true;
  };
  return tasks.every((t) => visit(t.id));
}

export function scorePack(dir, { historical = false } = {}) {
  const tasksDoc = loadJson(path.join(dir, 'TASKS.json'), { tasks: [] });
  const tasks = Array.isArray(tasksDoc.tasks) ? tasksDoc.tasks : [];
  const immut = loadJson(path.join(dir, 'immutability.json'), { green: false });
  const wt = loadJson(path.join(dir, 'worktrees.json'), { slices: [], skipped: false });
  const standards = axisVerdict(dir, 'standards');
  const spec = axisVerdict(dir, 'spec');
  const correctness = axisVerdict(dir, 'correctness');

  const gates = [];

  const planOk = validPlan(tasks);
  const allDone = tasks.length > 0 && planOk && tasks.every((t) => t.status === 'DONE');
  gates.push({
    id: 'tasks',
    ok: allDone,
    detail: allDone
      ? `${tasks.length} DONE`
      : `${tasks.filter((t) => t.status === 'DONE').length}/${tasks.length} DONE`,
  });

  const rg = tasks.length > 0 && tasks.every((t) => t.status !== 'DONE' || taskValidation(t));
  gates.push({
    id: 'red-green',
    ok: rg && tasks.length > 0,
    detail: rg
      ? 'each DONE has evidence appropriate to its validation kind'
      : 'missing validation evidence on a DONE task',
  });

  const immutNames = immutabilityTests(immut);
  gates.push({
    id: 'immutability',
    ok: immut.green === true && immutNames.length > 0,
    detail: immut.green
      ? immutNames.length
        ? `${immutNames.length} contract test(s) green`
        : 'green'
      : 'immutability.json not green',
    items: immutNames,
  });

  const specOk = spec === 'APPROVE';
  const reviewOk =
    standards === 'APPROVE' &&
    specOk &&
    correctness === 'APPROVE' &&
    ['standards', 'spec', 'correctness'].every((axis) => {
      const d = loadJson(path.join(dir, 'reviews', `${axis}.json`), null);
      return (
        d?.axis === axis &&
        Array.isArray(d.findings) &&
        new Set(d.findings.map((f) => f?.id)).size === d.findings.length &&
        d.findings.every(
          (f) =>
            f &&
            typeof f.id === 'string' &&
            f.id &&
            ['critical', 'high', 'medium', 'low', 'info'].includes(f.severity) &&
            (f.status === 'fixed' || (f.status === 'wontfix' && !['high', 'critical'].includes(f.severity))),
        )
      );
    });
  gates.push({
    id: 'review',
    ok: reviewOk,
    detail: `standards=${standards || 'missing'} spec=${spec || 'missing'} correctness=${correctness || 'missing'}`,
  });

  const slices = wt.slices || [];
  const seal = historical ? validSeal(dir) : null;
  const wtOk =
    wt.skipped === true ||
    (slices.length > 0 &&
      slices.every((s) => s.merged && s.removed && (seal || !s.dir || !fs.existsSync(s.dir))));
  gates.push({
    id: 'worktrees',
    ok: wtOk,
    detail: wt.skipped
      ? 'worktrees skipped (not a git repo / N=1)'
      : `${slices.filter((s) => s.merged).length}/${slices.length} merged+removed`,
  });

  const coverage = readCoverage(dir);
  const points = gates.reduce((n, g) => n + (g.ok ? 2 : 0), 0);
  const meta = loadJson(path.join(dir, 'run-meta.json'), {});
  const blockers = [];
  let current = seal?.evidence || null;
  if (!current)
    try {
      current = captureEvidence(dir);
    } catch (e) {
      blockers.push({ step: 'setup', reason: e.message });
    }
  const required = [
    'tests.json',
    'coverage.json',
    'immutability.json',
    ...['standards', 'spec', 'correctness'].map((a) => `reviews/${a}.json`),
    'hooks/ui-scope.json',
    ...HOOK_IDS.filter((h) => h !== 'ui-acceptance').map((h) => `hooks/${h}.json`),
  ];
  const scope = loadJson(path.join(dir, 'hooks/ui-scope.json'));
  if (!(scope?.ui_touched === false || (scope?.bypass === true && meta.ui_drive === 'off')))
    required.push('hooks/ui-acceptance.json');
  const evidenceChecks = required.map((file) => ({
    file,
    ok: validEvidence(loadJson(path.join(dir, file)), current),
  }));
  for (const c of evidenceChecks)
    if (!c.ok)
      blockers.push({
        step:
          c.file.startsWith('reviews/') || (c.file.startsWith('hooks/') && !c.file.includes('ui-'))
            ? 'review'
            : c.file.includes('ui-')
              ? 'ui-acceptance'
              : 'immutability',
        reason: `missing/stale evidence: ${c.file}`,
      });
  if (meta.spec_status !== 'confirmed' || !meta.spec)
    blockers.push({ step: 'explore', reason: 'confirmed spec required' });
  const arch = loadJson(path.join(dir, 'hooks/arch-map.json'));
  if (!['atlas', 'manual', 'greenfield'].includes(arch?.source))
    blockers.push({ step: 'setup', reason: 'architecture map missing or pending' });
  if (!planOk) blockers.push({ step: 'planner', reason: 'invalid task IDs or dependency graph' });
  const tests = loadJson(path.join(dir, 'tests.json'));
  const testsOk = tests?.ok === true && tests.failed === 0 && !!(tests.cmd || tests.command);
  if (!testsOk) blockers.push({ step: 'immutability', reason: 'final test suite missing or failed' });
  const hooks = aggregateVerdict(dir);
  if (hooks.verdict !== 'PASS') blockers.push({ step: 'review', reason: 'hooks failed or incomplete' });
  if (!scope || scope.ui_touched == null)
    blockers.push({ step: 'ui-acceptance', reason: 'UI scope unknown' });
  if (
    scope?.ui_touched === true &&
    !(scope.bypass === true && meta.ui_drive === 'off') &&
    loadJson(path.join(dir, 'hooks/ui-acceptance.json'))?.verdict !== 'APPROVE'
  )
    blockers.push({ step: 'ui-acceptance', reason: 'touched UI needs completed runtime acceptance' });
  if (!points || points !== 10) blockers.push({ step: 'score', reason: `score ${points}/10` });
  if (!coverage.ok) blockers.push({ step: 'score', reason: 'coverage below required floor or invalid' });
  if (!seal && !wt.skipped && meta.repo_root) {
    const prefix = wt.prefix || meta.worktree_prefix || 'mmh';
    const refs = spawnSync(
      'git',
      ['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}/slice-*`],
      { cwd: meta.repo_root, encoding: 'utf8' },
    );
    if (refs.status !== 0 || refs.stdout.trim() || slices.some((s) => s.dir && fs.existsSync(s.dir)))
      blockers.push({ step: 'clean', reason: 'worktree resources remain or Git unavailable' });
  }
  const project = loadJson(path.join(dir, 'project-gates.json'));
  const projectComplete =
    !!project &&
    Array.isArray(project.gates) &&
    (project.gates.length > 0 || !!project.reason) &&
    project.gates.every((g) => ['DONE', 'N/A'].includes(g.status) && !!g.evidence) &&
    validEvidence(project, current);
  const tracking = loadJson(path.join(dir, 'tracking.json'));
  const trackingComplete =
    !!tracking &&
    Array.isArray(tracking.files) &&
    (tracking.files.length > 0 || !!tracking.reason) &&
    tracking.files.every(
      (f) =>
        f.status === 'DONE' &&
        !!f.path &&
        !!f.evidence &&
        (seal ||
          (meta.repo_root &&
            fs.statSync(path.resolve(meta.repo_root, f.path), { throwIfNoEntry: false })?.isFile())),
    ) &&
    validEvidence(tracking, current);
  const packClosable = blockers.length === 0;
  if (!projectComplete)
    blockers.push({ step: 'project-gates', reason: 'project gates missing, stale, failed or OPEN' });
  if (!trackingComplete)
    blockers.push({ step: 'project-gates', reason: 'canonical project tracking not reconciled' });
  return {
    score: points,
    max: 10,
    coverage,
    pack_closable: packClosable,
    closable: packClosable && projectComplete && trackingComplete,
    historical: !!seal,
    evidence: current,
    evidence_checks: evidenceChecks,
    tests_ok: testsOk,
    hooks,
    project_complete: projectComplete,
    tracking_complete: trackingComplete,
    blockers,
    gates,
  };
}

function renderTasksMd(doc) {
  const tasks = doc.tasks || [];
  const lines = [`# Tasks — ${doc.spec || 'feature'}`, ''];
  for (const t of tasks) {
    const box = t.status === 'DONE' ? '[x]' : '[ ]';
    lines.push(
      `- ${box} **${t.id}** ${t.title}  | tests: ${t.tests_added || 0} | validation: ${t.validation || 'red-green'} (${taskValidation(t) ? 'verified' : 'pending'}) | immutability: ${t.immutability ? 'yes' : 'no'} | wt: ${t.worktree ?? '-'} | ${t.status}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export { renderTasksMd };

if (path.basename(process.argv[1] || '') === 'score.mjs') {
  const dir = path.resolve(arg('dir', '.'));
  const result = withPackLock(dir, () => {
    const result = scorePack(dir);
    writeJson(path.join(dir, 'score.json'), result);
    const tasks = loadJson(path.join(dir, 'TASKS.json'), null);
    if (tasks) atomicWrite(path.join(dir, 'TASKS.md'), renderTasksMd(tasks));
    return result;
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.closable) process.exit(1);
}

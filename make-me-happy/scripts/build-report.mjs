#!/usr/bin/env node
/**
 * Interactive HTML progress and closeout report for make-me-happy.
 *
 *   node build-report.mjs --dir docs/impl/make-me-happy/<run> [--out path/report.html]
 *
 * Self-contained single file (inline CSS/JS/SVG). Missing pack files render as
 * explicit empty states; strict callers reject malformed canonical run/task JSON.
 * Schemas: references/pack-schemas.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPack } from './report/load-pack.mjs';
import { renderReport } from './report/render.mjs';
import { atomicWrite, withPackLock, readJson } from './state-io.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

// Keep related monitor state and publication in one synchronous pack transaction.
export function withReportLock(dir, operation) {
  const abs = path.resolve(dir);
  return withPackLock(abs, () => operation(options => publishReport(abs, options)));
}
export function buildReport(dir, options = {}) {
  return withReportLock(dir, render => render(options));
}
function publishReport(abs, { out, now, strict = false, watcherToken, watcherStatus = 'running' } = {}) {
  // A delayed callback cannot publish after its registration was stopped or replaced.
  if (watcherToken !== undefined) {
    const state = readJson(path.join(abs, 'report-watch.json'));
    const meta = readJson(path.join(abs, 'run-meta.json'));
    if (state?.token !== watcherToken || state.run_id !== meta?.run_id || state.status !== watcherStatus)
      throw new Error('report watcher ownership or status changed');
  }
  if (strict) {
    const meta = JSON.parse(fs.readFileSync(path.join(abs, 'run-meta.json'), 'utf8'));
    if (!meta?.run_id) throw new Error('run-meta.json must identify the run');
    const tasksFile = path.join(abs, 'TASKS.json');
    if (fs.existsSync(tasksFile)) {
      const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      if (!Array.isArray(tasks?.tasks)) throw new Error('TASKS.json must contain tasks[]');
    }
  }
  const pack = loadPack(abs, { now });
  // This guarded publication is itself a fresh cycle. The caller records success
  // only after publication, under this same lock; failed renders keep the old file.
  if (watcherToken !== undefined && watcherStatus === 'running') pack.reportWatch.stale = false;
  const html = renderReport(pack);
  const dest = path.resolve(out || path.join(abs, 'report.html'));
  atomicWrite(dest, html);
  return { path: dest, warnings: pack.warnings, html };
}

// State is already persisted. A presentation failure must not invite replay of
// a successfully applied, versioned task result.
export function refreshAfterMutation(dir) {
  try { return buildReport(dir, { strict: true }); }
  catch (error) {
    console.error(`WARN report.html refresh failed; state saved: ${error.message}. Run build-report.mjs --dir ${dir}`);
    return null;
  }
}

if (path.basename(process.argv[1] || '') === 'build-report.mjs') {
  const dir = arg('dir', '.');
  if (!fs.existsSync(dir)) {
    console.error(`pack dir not found: ${dir}`);
    process.exit(2);
  }
  const { path: dest, warnings } = buildReport(dir, { out: arg('out', '') || undefined });
  for (const w of warnings) console.error(`WARN ${w.file}: ${w.msg}`);
  console.log(dest);
}

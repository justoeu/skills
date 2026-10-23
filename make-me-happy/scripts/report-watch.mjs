#!/usr/bin/env node
/** Supervised, pack-local reporting process. Never applies task results. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJson, withPackLock } from './state-io.mjs';
import { buildReport } from './build-report.mjs';
import { reportWatchFile as stateFile, reportWatchStatus, reportWatchHistoryFile as historyFile, archiveReportWatch } from './report-watch-state.mjs';
export { reportWatchStatus } from './report-watch-state.mjs';

export const REPORT_INTERVAL_MS = 10 * 60 * 1000;
function changeOwned(dir, token, patch) {
  return withPackLock(dir, () => {
    const state = readJson(stateFile(dir));
    const meta = readJson(path.join(dir, 'run-meta.json'));
    if (state?.token !== token || state.run_id !== meta?.run_id) throw new Error('report watcher ownership changed');
    const next = { ...state, ...patch };
    writeJson(stateFile(dir), next);
    return next;
  });
}
async function retryBusy(action) {
  for (let attempt = 0; ; attempt++) {
    try { return action(); }
    catch (error) {
      if (!/pack writer busy/.test(error.message) || attempt >= 49) throw error;
      await delay(100);
    }
  }
}

export async function watchReport(dir, {
  intervalMs = REPORT_INTERVAL_MS, signal, now = Date.now,
  wait = (ms, signal) => delay(ms, undefined, { signal }), onCycle = () => {},
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000 || intervalMs > 86400000)
    throw new Error('report interval must be between 1 second and 24 hours');
  dir = fs.realpathSync(dir);
  const token = randomUUID();
  const iso = () => new Date(now()).toISOString();
  const lease = await retryBusy(() => withPackLock(dir, () => {
    const meta = readJson(path.join(dir, 'run-meta.json'));
    if (!meta?.run_id || meta.status === 'closed') throw new Error('report watcher requires an active identified run');
    const previous = reportWatchStatus(dir);
    if (previous.running) throw new Error('report watcher already running for this pack');
    // A stop caller may still be awaiting this instance's final render. Keep its
    // outcome before publishing a new token, including final-render failures.
    archiveReportWatch(dir, previous);
    const state = { run_id: meta.run_id, token, backend: 'node', pid: process.pid, status: 'running',
      interval_ms: intervalMs, started_at: iso(), last_success_at: null, last_error: null };
    writeJson(stateFile(dir), state);
    return state;
  }));
  let next = now(), failures = 0, failure = null, reason = 'stopped';
  try {
    while (!signal?.aborted) {
      const meta = readJson(path.join(dir, 'run-meta.json'));
      const state = readJson(stateFile(dir));
      if (meta?.run_id !== lease.run_id || state?.token !== token) throw new Error('report watcher ownership changed');
      if (meta.status === 'closed') { reason = 'closed'; break; }
      if (state.stop_requested) break;
      if (now() >= next) {
        let cycleError = null;
        try {
          await retryBusy(() => buildReport(dir, { strict: true, now: new Date(now()) }));
          failures = 0;
          await retryBusy(() => changeOwned(dir, token, { last_success_at: iso(), last_error: null }));
        } catch (error) {
          cycleError = error;
          failures++;
          await retryBusy(() => changeOwned(dir, token, { last_error: error.message, last_attempt_at: iso() }));
        }
        onCycle({ at: iso(), ok: !cycleError, error: cycleError?.message });
        if (failures >= 3) throw new Error(`report refresh failed three times: ${cycleError.message}`);
        next = now() + (cycleError ? 10000 : intervalMs);
      }
      await wait(Math.min(1000, Math.max(1, next - now())), signal);
    }
  } catch (error) {
    if (error.name !== 'AbortError') failure = error;
  } finally {
    try {
      await retryBusy(() => changeOwned(dir, token, {
        status: 'stopping', reason,
        ...(failure ? { last_error: failure.message } : {}),
      }));
      // Final render disables browser auto-refresh and includes the last changes.
      await retryBusy(() => buildReport(dir, { strict: true, now: new Date(now()) }));
      await retryBusy(() => changeOwned(dir, token, {
        last_success_at: iso(), stopped_at: iso(), status: failure ? 'failed' : 'stopped',
      }));
    } catch (error) {
      failure ||= error;
      try { await retryBusy(() => changeOwned(dir, token, { status: 'failed', last_error: failure.message })); } catch {}
    }
  }
  if (failure) throw failure;
  return reportWatchStatus(dir);
}

export async function stopReportWatch(dir) {
  const requested = await retryBusy(() => withPackLock(dir, () => {
    const state = reportWatchStatus(dir);
    if (!state.running) return state;
    if (state.backend === 'native') throw new Error('cancel the native job and use report-native.mjs stop --token before stopping its report');
    delete state.running;
    writeJson(stateFile(dir), { ...state, stop_requested: true });
    return { ...state, running: true };
  }));
  if (!requested.running) {
    await retryBusy(() => buildReport(dir, { strict: true }));
    return requested;
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const current = reportWatchStatus(dir);
    const archive = historyFile(dir, requested.token);
    const target = current.token === requested.token ? current : archive && readJson(archive);
    if (!target || target.token !== requested.token || target.run_id !== requested.run_id)
      throw new Error('watcher replaced without confirmation of its final refresh');
    if (!target.running) {
      if (target.status === 'failed') throw new Error(target.last_error || 'final report refresh failed');
      if (target.status !== 'stopped') throw new Error('watcher exited without confirming its final refresh; rebuild the report');
      return target;
    }
    await delay(100);
  }
  throw new Error('stop requested; watcher has not confirmed its final refresh yet');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
  };
  try {
    const command = process.argv[2], dir = value('--dir');
    if (!dir || !['start', 'status', 'stop'].includes(command))
      throw new Error('usage: report-watch.mjs start|status|stop --dir OUT [--interval-seconds 600]');
    if (command === 'status') console.log(JSON.stringify(reportWatchStatus(dir)));
    else if (command === 'stop') console.log(JSON.stringify(await stopReportWatch(dir)));
    else {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      try {
        const result = await watchReport(dir, {
          intervalMs: Number(value('--interval-seconds', '600')) * 1000,
          signal: controller.signal, onCycle: cycle => console.log(JSON.stringify(cycle)),
        });
        console.log(JSON.stringify(result));
      } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

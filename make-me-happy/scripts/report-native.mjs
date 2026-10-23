#!/usr/bin/env node
/** One-shot bridge for native schedules/subtasks. Scheduling belongs to the host. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, withPackLock } from './state-io.mjs';
import { withReportLock } from './build-report.mjs';
import { reportWatchFile, reportWatchStatus, archiveReportWatch } from './report-watch-state.mjs';

function owned(dir, token) {
  const state = readJson(reportWatchFile(dir)), meta = readJson(path.join(dir, 'run-meta.json'));
  if (!token || state?.backend !== 'native' || state.token !== token || state.run_id !== meta?.run_id)
    throw new Error('native report ownership changed');
  return { state, meta };
}
function shortString(value) { return typeof value === 'string' && value.trim() && value.length <= 500; }

export function prepareNativeReport(dir, { kind, provider, now = new Date() } = {}) {
  if (!['schedule', 'subtask'].includes(kind) || !shortString(provider))
    throw new Error('native report requires kind schedule|subtask and an available provider');
  return withPackLock(dir, () => {
    const meta = readJson(path.join(dir, 'run-meta.json'));
    if (!meta?.run_id || meta.status === 'closed') throw new Error('native report requires an active identified run');
    const previous = reportWatchStatus(dir);
    if (previous.running) throw new Error('report watcher already running for this pack');
    archiveReportWatch(dir, previous);
    const state = { run_id: meta.run_id, token: randomUUID(), backend: 'native', kind, provider,
      scheduler_id: null, status: 'starting', interval_ms: 600000, started_at: now.toISOString(),
      last_success_at: null, last_error: null, failures: 0 };
    writeJson(reportWatchFile(dir), state);
    return state;
  });
}

export function bindNativeReport(dir, token, schedulerId) {
  if (!shortString(schedulerId)) throw new Error('native scheduler id is required');
  return withPackLock(dir, () => {
    const { state, meta } = owned(dir, token);
    if (meta.status === 'closed' || !['starting', 'running'].includes(state.status))
      throw new Error('native report is not accepting a scheduler');
    if (state.scheduler_id && state.scheduler_id !== schedulerId) throw new Error('native scheduler already bound');
    const next = { ...state, scheduler_id: schedulerId, status: 'running' };
    writeJson(reportWatchFile(dir), next);
    return next;
  });
}

export function tickNativeReport(dir, token, { now = new Date() } = {}) {
  return withReportLock(dir, render => {
    const { state, meta } = owned(dir, token);
    if (!['starting', 'running'].includes(state.status)) throw new Error('native report is stopped or failed');
    if (meta.status === 'closed') return finishNativeReport(dir, token, now, render);
    if (!state.scheduler_id) return { ...state, waiting_for_binding: true };
    try {
      const report = render({ strict: true, now, watcherToken: token });
      const next = { ...state, last_success_at: now.toISOString(), last_error: null, failures: 0 };
      writeJson(reportWatchFile(dir), next);
      return { ...next, path: report.path };
    } catch (error) {
      const failures = (state.failures || 0) + 1;
      writeJson(reportWatchFile(dir), { ...state, failures, last_error: error.message,
        last_attempt_at: now.toISOString(), status: failures >= 3 ? 'failed' : 'running' });
      throw error;
    }
  });
}

export function stopNativeReport(dir, token, { now = new Date() } = {}) {
  return withReportLock(dir, render => finishNativeReport(dir, token, now, render));
}
function finishNativeReport(dir, token, now, render) {
  const { state } = owned(dir, token);
  const stopping = { ...state, status: 'stopping', stop_requested: true };
  writeJson(reportWatchFile(dir), stopping);
  try {
    render({ strict: true, now, watcherToken: token, watcherStatus: 'stopping' });
    const next = { ...stopping, status: 'stopped', stopped_at: now.toISOString(), last_success_at: now.toISOString(), last_error: null };
    writeJson(reportWatchFile(dir), next);
    return { ...next, running: false };
  } catch (error) {
    writeJson(reportWatchFile(dir), { ...stopping, status: 'failed', last_error: error.message });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  try {
    const command = process.argv[2], dir = value('--dir'), token = value('--token');
    if (!dir || !['prepare', 'bind', 'tick', 'stop'].includes(command))
      throw new Error('usage: report-native.mjs prepare|bind|tick|stop --dir OUT [--kind schedule|subtask --provider TOOL] [--token TOKEN] [--id JOB_ID]');
    const result = command === 'prepare' ? prepareNativeReport(dir, { kind: value('--kind'), provider: value('--provider') })
      : command === 'bind' ? bindNativeReport(dir, token, value('--id'))
      : command === 'tick' ? tickNativeReport(dir, token) : stopNativeReport(dir, token);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

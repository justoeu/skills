import path from 'node:path';
import { readJson, writeJson } from './state-io.mjs';

export const reportWatchFile = dir => path.join(dir, 'report-watch.json');
export const reportWatchHistoryFile = (dir, token) => /^[a-f0-9-]{36}$/.test(token || '')
  ? path.join(dir, 'report-watch-history', `${token}.json`) : null;
// Caller holds the pack lock before replacing ownership.
export function archiveReportWatch(dir, previous) {
  const archive = reportWatchHistoryFile(dir, previous.token);
  if (archive && ['stopped', 'failed'].includes(previous.status)) writeJson(archive, previous);
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
export function reportWatchStatus(dir, { now = Date.now() } = {}) {
  const state = readJson(reportWatchFile(dir));
  const meta = readJson(path.join(dir, 'run-meta.json'));
  const native = state?.backend === 'native';
  const active = native ? ['starting', 'running', 'stopping'] : ['running', 'stopping'];
  const running = state?.run_id === meta?.run_id && active.includes(state?.status) && (native || alive(state.pid));
  const age = now - Date.parse(state?.last_success_at || state?.started_at);
  return { ...state, running: Boolean(running),
    ...(native ? { liveness: 'check-native-tool', stale: !Number.isFinite(age) || age > (state.interval_ms || 600000) + 120000 } : {}) };
}

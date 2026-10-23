import path from 'node:path';
import { readJson } from './state-io.mjs';

export const reportWatchFile = dir => path.join(dir, 'report-watch.json');
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
export function reportWatchStatus(dir) {
  const state = readJson(reportWatchFile(dir));
  const meta = readJson(path.join(dir, 'run-meta.json'));
  const running = state?.run_id === meta?.run_id && ['running', 'stopping'].includes(state?.status) && alive(state.pid);
  return { ...state, running: Boolean(running) };
}

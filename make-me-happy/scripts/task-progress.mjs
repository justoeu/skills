#!/usr/bin/env node
/** Worker-owned, informational progress. Never changes task completion or evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, withPackLock } from './state-io.mjs';
import { refreshAfterMutation } from './build-report.mjs';

export function writeTaskProgress(dir, input) {
  const result = withPackLock(dir, () => {
    const meta = readJson(path.join(dir, 'run-meta.json'));
    if (!meta?.run_id || meta.status === 'closed') throw new Error('progress requires an active identified run');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(input?.id || '')) throw new Error('invalid task id');
    const task = readJson(path.join(dir, 'TASKS.json'))?.tasks?.find(t => t.id === input.id);
    if (!task || !['IN_PROGRESS', 'BLOCKED'].includes(task.status)) throw new Error('task must be in progress or blocked');
    if (!Number.isInteger(input.expected_version) || input.expected_version !== (task.version || 0))
      throw new Error('stale progress; read the current task version');
    if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 5000)
      throw new Error('progress requires a short summary (1..5000 characters)');
    const progress = { run_id: meta.run_id, id: task.id, task_version: task.version || 0,
      at: new Date().toISOString(), summary: input.summary };
    for (const key of ['completed', 'next', 'blockers', 'files']) {
      if (input[key] === undefined) continue;
      if (!Array.isArray(input[key]) || input[key].length > 50 || input[key].some(v => typeof v !== 'string' || v.length > 1000))
        throw new Error(`invalid progress ${key}: expected up to 50 short strings`);
      progress[key] = input[key];
    }
    writeJson(path.join(dir, 'progress', `${task.id}.json`), progress);
    return progress;
  });
  refreshAfterMutation(dir);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = name => process.argv[process.argv.indexOf(name) + 1];
  try {
    if (!process.argv.includes('--dir') || !process.argv.includes('--result'))
      throw new Error('usage: task-progress.mjs --dir OUT --result progress-input.json');
    console.log(JSON.stringify(writeTaskProgress(path.resolve(value('--dir')),
      JSON.parse(fs.readFileSync(value('--result'), 'utf8')))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

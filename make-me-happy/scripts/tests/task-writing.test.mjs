import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initRun, updateTask, stampFile } from '../run-meta.mjs';
import { captureEvidence, writeJson, readJson } from '../state-io.mjs';
import { buildReport } from '../build-report.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-task-writing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'spec.md'), 'RF-07: Reject cancellation of COMPLETED jobs with HTTP 409. Do not change the job or emit an event.');
  const { dir } = initRun(root, { spec: 'spec.md', branch: 'feature/cancel' });
  const task = {
    id: 'T-007', title: 'Rejeite o cancelamento de jobs concluídos',
    slice: 'Validação do cancelamento no serviço de jobs existente.',
    description: 'Consulte o estado do job antes de cancelar.\nSe o estado for COMPLETED, retorne HTTP 409.',
    acceptance: ['Após a recusa, o estado do job continua COMPLETED.', 'A recusa não emite evento de cancelamento.'],
    refs: ['RF-07'], depends_on: [], worktree: 1, status: 'OPEN', version: 0,
    validation: 'red-green', tests_added: 0, red_green: false, immutability: false,
  };
  writeJson(path.join(dir, 'TASKS.json'), { spec: 'spec.md', tasks: [task] });
  return { dir, task };
}

test('task details survive status updates in JSON, regenerated Markdown and HTML', t => {
  const { dir, task } = setup(t);
  updateTask(dir, { id: task.id, expected_version: 0, patch: { status: 'IN_PROGRESS' } });
  const stored = readJson(path.join(dir, 'TASKS.json')).tasks[0];
  assert.equal(stored.description, task.description);
  assert.deepEqual(stored.acceptance, task.acceptance);
  const md = fs.readFileSync(path.join(dir, 'TASKS.md'), 'utf8');
  const html = buildReport(dir).html;
  for (const detail of [task.slice, ...task.description.split('\n'), ...task.acceptance, ...task.refs]) {
    assert.ok(md.includes(detail), `Markdown lost: ${detail}`);
    assert.ok(html.includes(detail), `HTML lost: ${detail}`);
  }
  assert.ok(md.includes('IN_PROGRESS'));
});

for (const field of ['slice', 'description', 'why']) {
  test(`changing task ${field} rejects an earlier review snapshot`, t => {
    const { dir } = setup(t);
    const snapshot = captureEvidence(dir);
    writeJson(path.join(dir, 'reviews/spec.json'), { axis: 'spec', verdict: 'APPROVE', findings: [] });
    stampFile(dir, 'reviews/spec.json', snapshot);
    const tasks = readJson(path.join(dir, 'TASKS.json'));
    tasks.tasks[0][field] = 'Permita cancelar jobs COMPLETED e emita um evento.';
    writeJson(path.join(dir, 'TASKS.json'), tasks);
    assert.throws(() => stampFile(dir, 'reviews/spec.json', snapshot), /changed/);
  });
}

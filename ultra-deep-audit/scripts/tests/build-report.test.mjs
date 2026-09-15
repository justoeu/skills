import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const builder = path.join(scriptDir, '..', 'build-report.mjs');
const syncProgress = path.join(scriptDir, '..', 'sync-progress.mjs');

test('rejeita line fora do contrato numérico antes de publicar HTML ou metadados', () => {
  for (const line of ['<b>line-marker</b>', '42', -1, 1.5, true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'ultra-deep-line-'));
    try {
      const input = path.join(dir, 'FINDINGS.json');
      const output = path.join(dir, 'report.html');
      writeFileSync(input, JSON.stringify([{ id: 'LINE-1', agent: 'Sentinel', severity: 'MEDIUM', line }]));
      const result = spawnSync(process.execPath, [builder, '--findings', input, '--out', output], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `line inválida aceita: ${JSON.stringify(line)}`);
      assert.match(result.stderr, /line.*non-negative safe integer/i);
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(path.join(dir, 'run-meta.json')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('renderiza linhas válidas e contadores não confiáveis como texto no DOM do relatório', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-deep-render-'));
  try {
    const input = path.join(dir, 'FINDINGS.json');
    const output = path.join(dir, 'report.html');
    const deps = path.join(dir, 'deps.json');
    const marker = '<b>count-marker</b>';
    writeFileSync(input, JSON.stringify([0, 42, null, undefined].map((line, i) => ({
      id: `LINE-${i}`, agent: 'Sentinel', severity: 'MEDIUM', path: `file-${i}.js`, line,
      verification: 'panel', panel: { true: marker, voters: marker },
    }))));
    writeFileSync(deps, JSON.stringify({ summary: {
      checked: marker, outdated: marker, up_to_date: marker,
      by_bump: { major: marker, minor: marker, patch: marker },
      by_ecosystem: { npm: { total: marker, outdated: marker, up_to_date: marker } },
    } }));
    execFileSync(process.execPath, [builder, '--findings', input, '--out', output, '--deps', deps]);
    const html = readFileSync(output, 'utf8');
    const elements = new Map();
    const document = {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          innerHTML: '', textContent: '', addEventListener() {}, querySelectorAll() { return []; },
        });
        return elements.get(id);
      },
      querySelectorAll() { return []; },
      addEventListener() {},
    };
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    runInNewContext(`${script}\nrenderDeps();`, { document, window: { addEventListener() {} } });
    const rendered = elements.get('view-findings').innerHTML;
    assert.match(rendered, /file-1\.js:42<\/div>/);
    assert.match(rendered, /file-2\.js<\/div>/);
    assert.match(rendered, /file-3\.js<\/div>/);
    assert.equal(rendered.includes(marker), false);
    assert.match(rendered, /&lt;b&gt;count-marker&lt;\/b&gt;/);
    assert.match(rendered, /file-0\.js:0<\/div>/);
    const renderedDeps = elements.get('view-deps').innerHTML;
    assert.equal(renderedDeps.includes(marker), false);
    assert.equal((renderedDeps.match(/&lt;b&gt;count-marker&lt;\/b&gt;/g) || []).length, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderiza o schema lowercase do pack e distingue em progresso', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-deep-report-'));
  try {
    const findingsPath = path.join(dir, 'FINDINGS.json');
    const reportPath = path.join(dir, 'report.html');
    writeFileSync(findingsPath, JSON.stringify([
      { id: 'RES-1', agent: 'Atlas', severity: 'LOW', status: 'resolved' },
      { id: 'REF-1', agent: 'Atlas', severity: 'LOW', status: 'refuted' },
      { id: 'ACC-1', agent: 'Atlas', severity: 'LOW', status: 'accepted' },
      { id: 'PROG-1', agent: 'Atlas', severity: 'HIGH', status: 'open', in_progress: true },
      { id: 'OPEN-1', agent: 'Atlas', severity: 'MEDIUM', status: 'open' },
    ]));

    execFileSync(process.execPath, [builder, '--findings', findingsPath, '--out', reportPath]);

    const html = readFileSync(reportPath, 'utf8');
    assert.match(html, /"_implementation_status":"RESOLVED"/);
    assert.match(html, /"_implementation_status":"REFUTED"/);
    assert.match(html, /"_implementation_status":"ACCEPTED"/);
    assert.match(html, /"_implementation_status":"IN_PROGRESS"/);
    assert.match(html, /option value="RESOLVED"/);
    assert.match(html, /option value="IN_PROGRESS"/);
    assert.match(html, /option value="REFUTED"/);
    assert.match(html, /option value="ACCEPTED"/);
    assert.match(html, /\['Accepted', accepted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync-progress e write-pack preservam lowercase e contam somente estados abertos', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-deep-sync-'));
  try {
    const findings = [
      { id: 'RES-1', title: 'resolved title', agent: 'Atlas', severity: 'HIGH', status: 'resolved', blocks_pr: true },
      { id: 'REF-1', title: 'refuted title', agent: 'Atlas', severity: 'HIGH', status: 'refuted', blocks_pr: true },
      { id: 'ACC-1', title: 'accepted title', agent: 'Atlas', severity: 'HIGH', status: 'accepted', blocks_pr: true },
      { id: 'PROG-1', title: 'progress title', agent: 'Atlas', severity: 'HIGH', status: 'open', in_progress: true, blocks_pr: true },
      { id: 'OPEN-1', title: 'open title', agent: 'Atlas', severity: 'HIGH', status: 'open', blocks_pr: true },
    ];
    const findingsPath = path.join(dir, 'FINDINGS.json');
    writeFileSync(findingsPath, JSON.stringify(findings));

    execFileSync(process.execPath, [
      syncProgress,
      '--dir', dir,
      '--refresh',
      '--app', 'fixture-app',
      '--branch', 'fixture-branch',
      '--version', '1.0.0',
    ]);

    const persisted = JSON.parse(readFileSync(findingsPath, 'utf8'));
    assert.deepEqual(
      Object.fromEntries(persisted.map(({ id, status }) => [id, status])),
      {
        'RES-1': 'resolved',
        'REF-1': 'refuted',
        'ACC-1': 'accepted',
        'PROG-1': 'open',
        'OPEN-1': 'open',
      },
      'refresh não pode reescrever nem reabrir o schema lowercase',
    );

    const tasks = readFileSync(path.join(dir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /\| DONE \| 3 \|/);
    assert.match(tasks, /\| OPEN \| 2 \|/);
    assert.match(tasks, /- \[x\] \*\*ACC-1\*\*/);
    assert.match(tasks, /- \[ \] \*\*PROG-1\*\*/);

    const report = readFileSync(path.join(dir, 'REPORT.md'), 'utf8');
    assert.match(report, /Findings \| \*\*5\*\* \(DONE 3 · OPEN 2\)/);
    assert.match(report, /HIGH\/CRITICAL open \| \*\*2\*\*/);
    assert.match(report, /blocks_pr still open \| \*\*2\*\*/);
    assert.match(report, /\*\*ACC-1\*\* \[HIGH\] ✅ accepted title/);
    assert.match(report, /\*\*PROG-1\*\* \[HIGH\] ⬜ progress title/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sync-progress grava resolved e open no schema lowercase ao mudar status', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-deep-status-'));
  try {
    const findingsPath = path.join(dir, 'FINDINGS.json');
    writeFileSync(findingsPath, JSON.stringify([
      { id: 'FIX-1', title: 'fix', agent: 'Atlas', severity: 'HIGH', status: 'open', blocks_pr: true },
      { id: 'REOPEN-1', title: 'reopen', agent: 'Atlas', severity: 'LOW', status: 'accepted', blocks_pr: false },
    ]));

    execFileSync(process.execPath, [syncProgress, '--dir', dir, '--done', 'FIX-1']);
    execFileSync(process.execPath, [syncProgress, '--dir', dir, '--open', 'REOPEN-1']);

    const persisted = JSON.parse(readFileSync(findingsPath, 'utf8'));
    assert.deepEqual(
      Object.fromEntries(persisted.map(({ id, status }) => [id, status])),
      { 'FIX-1': 'resolved', 'REOPEN-1': 'open' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

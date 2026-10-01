import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(scriptDir, '..', '..');
const merge = path.join(scriptDir, '..', 'merge-findings.mjs');
const pack = path.join(scriptDir, '..', 'write-pack-markdown.mjs');
const report = path.join(scriptDir, '..', 'build-report.mjs');

const BENCH = [
  ['lyra-xss.md', 'Lyra', 'SEC-LYR'],
  ['janus-routes.md', 'Janus', 'SEC-JAN'],
  ['moira-ratelimit.md', 'Moira', 'SEC-MOI'],
  ['sigil-secrets.md', 'Sigil', 'SEC-SIG'],
  ['basilisk-sqli.md', 'Basilisk', 'SEC-BAS'],
  ['proteus-prompt.md', 'Proteus', 'SEC-PRO'],
  ['mirage-deps.md', 'Mirage', 'IMP-MIR'],
];

test('cada agente da bancada existe e o SKILL aponta o arquivo', () => {
  const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  for (const [file, name] of BENCH) {
    assert.equal(existsSync(path.join(skillRoot, 'agents', file)), true, file);
    assert.match(skill, new RegExp(file));
    assert.match(skill, new RegExp(name));
  }
});

test('merge atribui id da bancada e só bloqueia PR com confidence high ou panel', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-deep-bench-'));
  try {
    writeFileSync(path.join(dir, 'agent-lyra.json'), JSON.stringify([
      {
        agent: 'Lyra', domain: 'security', category: 'xss',
        title: 'sink', path: 'a.js', line: 10,
        severity: 'HIGH', confidence: 'high',
      },
      {
        agent: 'Lyra', domain: 'security', category: 'xss',
        title: 'talvez', path: 'a.js', line: 11,
        severity: 'HIGH', confidence: 'medium',
      },
      {
        agent: 'Lyra', domain: 'security', category: 'xss',
        title: 'painel', path: 'a.js', line: 12,
        severity: 'CRITICAL', confidence: 'medium', verification: 'panel',
      },
    ]));
    writeFileSync(path.join(dir, 'agent-mirage.json'), JSON.stringify([
      {
        agent: 'Mirage', domain: 'imports', category: 'unused-dependency',
        title: 'órfã', path: 'package.json', line: 4,
        severity: 'MEDIUM', confidence: 'high',
      },
    ]));
    writeFileSync(path.join(dir, 'agent-sentinel.json'), JSON.stringify([
      {
        agent: 'Sentinel', domain: 'security', category: 'idor',
        title: 'objeto', path: 'b.js', line: 1,
        severity: 'HIGH', confidence: 'high',
      },
    ]));
    execFileSync(process.execPath, [merge, '--dir', dir, '--mode', 'delta'], { encoding: 'utf8' });
    const findings = JSON.parse(readFileSync(path.join(dir, 'FINDINGS.json'), 'utf8'));
    const byTitle = Object.fromEntries(findings.map((f) => [f.title, f]));
    assert.equal(byTitle.sink.id, 'SEC-LYR-001');
    assert.equal(byTitle.sink.blocks_pr, true);
    assert.equal(byTitle.talvez.blocks_pr, false);
    assert.equal(byTitle.painel.blocks_pr, true);
    assert.equal(byTitle['órfã'].id, 'IMP-MIR-001');
    assert.equal(byTitle['órfã'].blocks_pr, false);
    assert.equal(byTitle.objeto.id, 'SEC-SEN-001');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap coloca a bancada de segurança na wave 1 e o Mirage nos imports', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-deep-pack-'));
  try {
    writeFileSync(path.join(dir, 'FINDINGS.json'), JSON.stringify([
      {
        id: 'SEC-LYR-001', agent: 'Lyra', severity: 'HIGH', confidence: 'high',
        title: 'html ativo', path: 'view.tsx', line: 8, status: 'OPEN', blocks_pr: true,
      },
      {
        id: 'IMP-MIR-001', agent: 'Mirage', severity: 'MEDIUM', confidence: 'high',
        title: 'pacote sem uso', path: 'package.json', line: 3, status: 'OPEN',
      },
    ]));
    writeFileSync(path.join(dir, 'run-meta.json'), JSON.stringify({
      app: 'bench', version: '0', branch: 'test', head: 'abc', mode: 'delta', root: dir,
    }));
    execFileSync(process.execPath, [pack, '--dir', dir], { encoding: 'utf8' });
    const roadmap = readFileSync(path.join(dir, 'ROADMAP.md'), 'utf8');
    const wave1 = roadmap.split('## Wave 2')[0];
    assert.match(wave1, /SEC-LYR-001/);
    assert.doesNotMatch(wave1, /IMP-MIR-001/);
    assert.match(roadmap, /### Imports \(Mirage\)[\s\S]*IMP-MIR-001/);
    const htmlDir = path.join(dir, 'report.html');
    execFileSync(process.execPath, [report, '--findings', path.join(dir, 'FINDINGS.json'), '--out', htmlDir], { encoding: 'utf8' });
    const html = readFileSync(htmlDir, 'utf8');
    assert.match(html, /Lyra/);
    assert.match(html, /Mirage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
/** Execute green → revert only fix paths → red → restore → green in a disposable Git worktree. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { cliArg } from './lib-findings.mjs';
import { metaFor, readJson, writeJson, atomicWrite, git, fileHash, sourceState, safeId, acquireLock } from './pack-state.mjs';
import { reviewContext } from './review-evidence.mjs';
const dir = fs.realpathSync(path.resolve(cliArg('dir', '.'))); let root, temporary, release;
try {
  release = acquireLock(dir);
  const meta = metaFor(dir); root = meta.root;
  if (meta.git === false) throw new Error('reversão automática exige Git; ambiente sem Git requer prova equivalente e revisão pendente, sem aprovação automática');
  const id = safeId(cliArg('id')), finding = readJson(path.join(dir, 'FINDINGS.json')).find(f => f.id === id);
  if (!finding) throw new Error('achado desconhecido');
  const context = reviewContext(dir, finding), command = cliArg('test-cmd'), base = cliArg('base');
  const files = cliArg('fix-paths', '').split(',').filter(Boolean);
  if (!command || !base || !files.length || files.some(p => path.isAbsolute(p) || p.split(/[\\/]/).includes('..'))) throw new Error('--test-cmd, --base e --fix-paths relativos obrigatórios');
  git(root, ['rev-parse', '--verify', `${base}^{commit}`]);
  const proofDir = path.join(dir, 'reviews', 'rounds', id, context.round_id);
  if (fs.existsSync(path.join(proofDir, 'proof.json'))) throw new Error('rodada já possui prova; crie review-start para repetir sem sobrescrever histórico');
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-audit-proof-'));
  const checkout = path.join(temporary, 'checkout');
  git(root, ['worktree', 'add', '--detach', checkout, 'HEAD']);
  const diff = spawnSync('git', ['diff', '--binary', 'HEAD'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  if (diff.status !== 0) throw new Error('diff do checkout falhou');
  if (diff.stdout.length) {
    const apply = spawnSync('git', ['apply', '--binary'], { cwd: checkout, input: diff.stdout, encoding: 'utf8' });
    if (apply.status !== 0) throw new Error(`snapshot não pôde ser aplicado: ${apply.stderr}`);
  }
  const others = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (others.status !== 0) throw new Error('inventário de testes não versionados falhou');
  for (const p of others.stdout.split('\0').filter(Boolean)) {
    const src = path.resolve(root, p); if (src.startsWith(dir + path.sep) || /^docs\/audits\/deep-audit/.test(p)) continue;
    const dst = path.join(checkout, p); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { dereference: false });
  }
  const saved = files.map(p => {
    const src = path.join(checkout, p); const exists = fs.existsSync(src);
    if (exists && !fs.lstatSync(src).isFile()) throw new Error('fix-paths deve enumerar arquivos regulares, não diretórios/symlinks');
    return { p, exists, bytes: exists ? fs.readFileSync(src) : null, mode: exists ? fs.statSync(src).mode : null };
  });
  const logs = {};
  function run(phase) {
    const r = spawnSync(command, { cwd: checkout, shell: true, encoding: 'utf8', timeout: Number(cliArg('timeout-ms', '120000')), maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.signal || r.status === null) throw new Error(`teste ${phase} não concluiu normalmente: ${r.error || r.signal}`);
    const relative = `reviews/rounds/${id}/${context.round_id}/${phase}.log`;
    atomicWrite(path.join(dir, relative), `$ ${command}\nexit=${r.status}\n${r.stdout}${r.stderr}`); logs[relative] = fileHash(path.join(dir, relative));
    return r.status;
  }
  const green = run('green'); if (green !== 0) throw new Error('teste corrigido não passa');
  for (const { p } of saved) {
    if (git(checkout, ['cat-file', '-e', `${base}:${p}`], true) === '') {
      const exists = spawnSync('git', ['cat-file', '-e', `${base}:${p}`], { cwd: checkout }).status === 0;
      if (!exists) { fs.rmSync(path.join(checkout, p), { force: true }); continue; }
    }
    git(checkout, ['restore', '--source', base, '--worktree', '--', p]);
  }
  const red = run('reverted'); if (red === 0) throw new Error('teste falso-verde: continua passando com fix revertido');
  for (const s of saved) { const p = path.join(checkout, s.p); if (s.exists) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s.bytes); fs.chmodSync(p, s.mode); } else fs.rmSync(p, { force: true }); }
  const restored = run('restored'); if (restored !== 0) throw new Error('teste não voltou a passar após restaurar fix');
  if (sourceState(meta, dir).source_hash !== context.source_hash) throw new Error('checkout original mudou durante a prova');
  writeJson(path.join(proofDir, 'proof.json'), { runner: 'reversal-proof-v2', context, command, base: git(root, ['rev-parse', `${base}^{commit}`]), fix_paths: files, green_exit: green, reverted_exit: red, restored_exit: restored, logs, executed_at: new Date().toISOString() });
  console.log('prova green/red/green concluída em checkout descartável');
} catch (e) { console.error(`reversal-proof: ${e.message}`); process.exitCode = 2; }
finally {
  if (temporary && root) { const checkout = path.join(temporary, 'checkout'); spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root }); fs.rmSync(temporary, { recursive: true, force: true }); }
  release?.();
}

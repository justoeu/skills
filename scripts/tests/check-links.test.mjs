import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  harnessSkills,
  skillVersion,
  relFiles,
  isSubsetOf,
  auditRoot,
  fixDrift,
  ensureSkill,
  runCheck,
} from '../check-links.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'check-links.mjs');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mmh-links-'));
  const repo = path.join(base, 'harness');
  const host = path.join(base, 'host', 'skills');
  fs.mkdirSync(path.join(repo, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'beta'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'alpha', 'SKILL.md'), '---\nname: alpha\nmetadata:\n  version: 1.2.0\n---\n# alpha\n');
  fs.writeFileSync(path.join(repo, 'alpha', 'README.md'), 'alpha');
  fs.writeFileSync(path.join(repo, 'beta', 'SKILL.md'), '---\nname: beta\nmetadata:\n  version: 1.0.0\n---\n# beta\n');
  return { base, repo, host };
}

test('harnessSkills lista pastas com SKILL.md (ignora scripts/)', () => {
  const { repo } = fixture();
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.mkdirSync(path.join(repo, 'sem-skill'));
  assert.deepEqual(harnessSkills(repo).sort(), ['alpha', 'beta']);
});

test('skillVersion lê metadata.version; null sem frontmatter/versão', () => {
  const { repo } = fixture();
  assert.equal(skillVersion(path.join(repo, 'alpha', 'SKILL.md')), '1.2.0');
  const none = path.join(repo, 'plain.md');
  fs.writeFileSync(none, 'sem frontmatter');
  assert.equal(skillVersion(none), null);
});

test('auditRoot: symlink ok · cópia velha = DRIFT · ausente = INFO', () => {
  const { repo, host } = fixture();
  fs.mkdirSync(host, { recursive: true });
  fs.symlinkSync(path.join(repo, 'alpha'), path.join(host, 'alpha'));
  // cópia velha de beta (subconjunto, versão antiga)
  fs.mkdirSync(path.join(host, 'beta'));
  fs.writeFileSync(path.join(host, 'beta', 'SKILL.md'), '---\nname: beta\nmetadata:\n  version: 0.9.0\n---\n# beta velho\n');

  const findings = auditRoot(host, ['alpha', 'beta'], repo);
  assert.ok(!findings.some((f) => f.skill === 'alpha'));
  const drift = findings.find((f) => f.skill === 'beta');
  assert.equal(drift.level, 'DRIFT');
  assert.match(drift.msg, /0\.9\.0/);
  assert.match(drift.msg, /1\.0\.0/);
  assert.equal(drift.subset, true);

  // skill sem entrada → INFO
  const info = auditRoot(host, ['gamma'], repo);
  assert.equal(info[0].level, 'INFO');
});

test('cópia com arquivo exclusivo nunca é trocada pelo --fix', () => {
  const { repo, host } = fixture();
  fs.mkdirSync(path.join(host, 'beta'), { recursive: true });
  fs.writeFileSync(path.join(host, 'beta', 'SKILL.md'), 'old');
  fs.writeFileSync(path.join(host, 'beta', 'LOCAL-EXTRA.md'), 'único da cópia');
  assert.equal(isSubsetOf(path.join(host, 'beta'), path.join(repo, 'beta')), false);
  const r = fixDrift(host, 'beta', repo);
  assert.equal(r.fixed, false);
  assert.ok(fs.existsSync(path.join(host, 'beta', 'LOCAL-EXTRA.md')));
});

test('fixDrift troca cópia subconjunto por symlink; ensureSkill cria link faltante', () => {
  const { repo, host } = fixture();
  fs.mkdirSync(path.join(host, 'beta'), { recursive: true });
  fs.writeFileSync(path.join(host, 'beta', 'SKILL.md'), 'old');
  const r = fixDrift(host, 'beta', repo);
  assert.equal(r.fixed, true);
  assert.ok(fs.lstatSync(path.join(host, 'beta')).isSymbolicLink());

  const e = ensureSkill(host, 'alpha', repo);
  assert.equal(e.created, true);
  assert.equal(fs.realpathSync(path.join(host, 'alpha')), fs.realpathSync(path.join(repo, 'alpha')));
});

test('runCheck agrega por root e denuncia symlink para fora do harness', () => {
  const { base, repo } = fixture();
  const host1 = path.join(base, 'h1', 'skills');
  const outside = path.join(base, 'outside', 'alpha');
  fs.mkdirSync(path.join(base, 'outside', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'x');
  fs.mkdirSync(host1, { recursive: true });
  fs.symlinkSync(outside, path.join(host1, 'alpha'));
  const res = runCheck({ roots: [host1], repo });
  assert.ok(res.findings.some((f) => f.level === 'WARN' && /fora do harness/.test(f.msg)));
});

test('CLI: exit 1 com drift; --fix resolve e exit 0', () => {
  const { base, repo } = fixture();
  const host = path.join(base, 'host', 'skills');
  fs.mkdirSync(path.join(host, 'beta'), { recursive: true });
  fs.writeFileSync(path.join(host, 'beta', 'SKILL.md'), 'old');
  const roots = path.join(base, 'host', 'skills');

  const bad = spawnSync('node', [CLI, '--roots', roots, '--repo', repo], { encoding: 'utf8' });
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /DRIFT/);

  const fixed = spawnSync('node', [CLI, '--fix', '--roots', roots, '--repo', repo], { encoding: 'utf8' });
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.match(fixed.stdout, /fixed: .*beta/);
  // INFO (alpha ausente) não derruba
  assert.match(fixed.stdout, /não exposta/);
});

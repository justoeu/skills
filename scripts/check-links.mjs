#!/usr/bin/env node
/**
 * check-links — exposição das skills do harness nos hosts.
 *
 *   node scripts/check-links.mjs [--fix] [--ensure <skill>] [--roots dir,dir,...]
 *
 * Hosts default (roots de skills): ~/.claude/skills, ~/.codex/skills,
 * ~/.agents/skills (muse/opencode/agy), ~/.grok/skills.
 *
 * Regras (fonte única da verdade = este repo; skill se expõe por symlink):
 * - DRIFT  entrada é pasta física onde deveria ser symlink (cópia velha).
 *          `--fix` troca por symlink SÓ quando a cópia é subconjunto do
 *          harness (nenhum arquivo exclusivo); conserva backup, inclusive edições.
 * - WARN   symlink quebrado ou apontando para outra skill/local.
 * - INFO   skill ausente num host (decisão de alcance, não erro).
 *          `--ensure <skill>` cria os symlinks faltantes.
 *
 * Versão: cada SKILL.md carrega `metadata.version` (semver). MAJOR quebra
 * contrato de invocação/pack; MINOR adiciona; PATCH ajusta. Cópia física com
 * versão diferente da do harness → DRIFT com as duas versões no aviso.
 *
 * Exit 1 com DRIFT/WARN pendentes; 0 quando só há INFO.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_ROOTS = [
  '~/.claude/skills',
  '~/.codex/skills',
  '~/.agents/skills',
  '~/.grok/skills',
];

/** alias de invocação → skill canônica no harness */
export const ALIASES = { mmh: 'make-me-happy' };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function expand(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Skills do harness: pastas com SKILL.md na raiz do repo. */
export function harnessSkills(repo = REPO) {
  return fs.readdirSync(repo, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(repo, d.name, 'SKILL.md')))
    .map((d) => d.name);
}

/** metadata.version do frontmatter (ou null). */
export function skillVersion(skillMdPath) {
  try {
    const src = fs.readFileSync(skillMdPath, 'utf8');
    const m = src.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const vm = m[1].match(/^\s+version:\s*(\S+)\s*$/m);
    return vm ? vm[1] : null;
  } catch {
    return null;
  }
}

/** Arquivos relativos de uma pasta de skill (para checar subconjunto). */
export function relFiles(dir) {
  const out = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

export function isSubsetOf(copyDir, harnessDir) {
  const harnessSet = new Set(relFiles(harnessDir));
  return relFiles(copyDir).every((f) => harnessSet.has(f));
}

function entryStat(entry) {
  try { return fs.lstatSync(entry); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function linkProblem(entry, expected, repo) {
  try {
    const target = fs.realpathSync(entry);
    if (target !== fs.realpathSync(expected)) {
      return target.startsWith(fs.realpathSync(repo) + path.sep)
        ? `symlink aponta para outra skill: ${target}; esperado ${expected}`
        : `symlink aponta para fora do harness: ${target}`;
    }
  } catch (error) { return `symlink inválido (${error.code}): ${entry}`; }
  return null;
}

/**
 * Auditoria de um root. Retorna findings [{level: 'DRIFT'|'WARN'|'INFO', skill, host, msg}].
 */
export function auditRoot(rootDir, skills, repo = REPO) {
  const findings = [];
  const host = rootDir.replace(os.homedir(), '~');
  if (!fs.existsSync(rootDir)) {
    return skills.map((s) => ({ level: 'INFO', skill: s, host, msg: 'root inexistente neste host' }));
  }
  for (const skill of skills) {
    const entry = path.join(rootDir, skill);
    const stat = entryStat(entry);
    if (!stat) {
      findings.push(entryStat(entry + '.md')
        ? { level: 'DRIFT', skill, host, msg: 'arquivo legado .md; preservar e revisar antes de migrar' }
        : { level: 'INFO', skill, host, msg: 'não exposta neste host' });
      continue;
    }
    const harnessDir = path.join(repo, skill);
    if (stat.isSymbolicLink()) {
      const msg = linkProblem(entry, harnessDir, repo);
      if (msg) findings.push({ level: 'WARN', skill, host, msg });
      continue;
    }
    // pasta (ou arquivo) físico
    if (!stat.isDirectory()) {
      findings.push({ level: 'DRIFT', skill, host, msg: 'entrada é arquivo, esperado symlink para o harness' });
      continue;
    }
    const copyVer = skillVersion(path.join(entry, 'SKILL.md'));
    const harnessVer = skillVersion(path.join(harnessDir, 'SKILL.md'));
    const subset = isSubsetOf(entry, harnessDir);
    findings.push({
      level: 'DRIFT',
      skill,
      host,
      msg: `cópia física no lugar de symlink (cópia ${copyVer || 'sem versão'} · harness ${harnessVer || 'sem versão'} · ${subset ? 'nomes contidos no harness; --fix conserva backup para revisar diferenças' : 'tem arquivos exclusivos — revisar antes de trocar'})`,
      subset,
    });
  }
  return findings;
}

export function fixDrift(rootDir, skill, repo = REPO) {
  const entry = path.join(rootDir, skill);
  const stat = entryStat(entry);
  if (!stat?.isDirectory()) return { fixed: false, reason: 'não é cópia física' };
  if (!isSubsetOf(entry, path.join(repo, skill))) return { fixed: false, reason: 'cópia tem arquivos exclusivos' };
  // Backups must not be discoverable as additional installed skills.
  const backupRoot = path.join(path.dirname(path.resolve(rootDir)), '.skill-link-backups', path.basename(path.resolve(rootDir)));
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const backup = path.join(backupRoot, `${skill}-${randomUUID()}`);
  fs.renameSync(entry, backup);
  try {
    fs.symlinkSync(path.resolve(repo, skill), entry);
    const problem = linkProblem(entry, path.join(repo, skill), repo);
    if (problem) throw new Error(problem);
    return { fixed: true, backup };
  } catch (error) {
    // Never overwrite an entry another process created; the original remains in backup.
    if (!entryStat(entry)) fs.renameSync(backup, entry);
    return { fixed: false, backup: entryStat(backup) ? backup : null, reason: error.message };
  }
}

export function ensureSkill(rootDir, skill, repo = REPO) {
  const entry = path.join(rootDir, skill);
  const stat = entryStat(entry);
  if (stat) {
    return { created: false, reason: stat.isSymbolicLink()
      ? linkProblem(entry, path.join(repo, skill), repo)
      : 'entrada física existente; use auditoria antes de migrar' };
  }
  if (entryStat(entry + '.md')) return { created: false, reason: 'arquivo legado .md existente; revisar antes de migrar' };
  fs.mkdirSync(rootDir, { recursive: true });
  fs.symlinkSync(path.join(repo, skill), entry);
  return { created: true };
}

export function runCheck({ roots, repo = REPO }) {
  const skills = harnessSkills(repo);
  const findings = [];
  for (const raw of roots) {
    const rootDir = expand(raw);
    // alias (mmh) apontam para a canônica — audita se existem, sem exigir
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      if (!skills.includes(canonical)) continue;
      const a = path.join(rootDir, alias);
      const stat = entryStat(a);
      if (stat) {
        const msg = stat.isSymbolicLink() ? linkProblem(a, path.join(repo, canonical), repo) : 'alias deve ser symlink para a skill canônica';
        if (msg) findings.push({ level: 'WARN', skill: alias, host: raw, msg });
      }
    }
    findings.push(...auditRoot(rootDir, skills, repo));
  }
  return { skills, findings };
}

function main() {
  const fix = process.argv.includes('--fix');
  const ensure = arg('ensure', null);
  const roots = (arg('roots', DEFAULT_ROOTS.join(',')) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const repo = path.resolve(arg('repo', REPO));

  if (ensure) {
    const skills = harnessSkills(repo);
    if (!skills.includes(ensure)) {
      console.error(`skill desconhecida no harness: ${ensure} (disponíveis: ${skills.join(', ')})`);
      process.exit(2);
    }
    for (const raw of roots) {
      const r = ensureSkill(expand(raw), ensure, repo);
      console.log(`${raw}: ${r.created ? 'symlink criado' : r.reason || 'já existia e aponta para a skill correta'}`);
      if (r.reason) process.exitCode = 1;
    }
    return;
  }

  let { findings } = runCheck({ roots, repo });
  if (fix) {
    const again = [];
    for (const f of findings) {
      if (f.level === 'DRIFT' && f.subset) {
        const r = fixDrift(expand(f.host), f.skill, repo);
        if (r.fixed) {
          console.log(`fixed: ${f.host}/${f.skill} → symlink; backup preservado: ${r.backup}`);
          continue;
        }
      }
      again.push(f);
    }
    findings = again;
  }

  const order = { DRIFT: 0, WARN: 1, INFO: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  for (const f of findings) console.log(`${f.level.padEnd(5)} ${f.host.replace(os.homedir(), '~')}/${f.skill}: ${f.msg}`);

  const drift = findings.filter((f) => f.level === 'DRIFT').length;
  const warn = findings.filter((f) => f.level === 'WARN').length;
  const info = findings.filter((f) => f.level === 'INFO').length;
  console.log(`\n${drift} drift · ${warn} warn · ${info} não exposta(s)`);
  if (drift || warn) process.exit(1);
}

if (path.basename(process.argv[1] || '') === 'check-links.mjs') {
  main();
}

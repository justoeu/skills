#!/usr/bin/env node
/**
 * redact — higiene de paths da máquina nos artefatos do make-me-happy.
 *
 * O pack é evidência compartilhada: ao fechar a run (e ao renderizar o HTML),
 * nenhum artefato pode expor o caminho da máquina que o produziu — nome de
 * usuário, estrutura de diretórios e tmp paths saem daqui para fora.
 *
 * Regras de redação (mais longa primeiro, repo antes de home):
 * - caminho do repo  → relativo ao repo ("docs/SDD/x.md")
 * - home do usuário  → "~" ("~/Developer/outro")
 * - raiz exata       → "<repo>" (marcador legível)
 *
 * A redação do close acontece ANTES do selo: artifactIdentity cobre o estado
 * já redigido e validSeal continua coerente. Campos resolvidos depois
 * (meta.spec relativo) continuam resolvendo via path.resolve(repoRoot, spec).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest } from './state-io.mjs';

export const REDACTED_ROOT = '<repo>';

/** Redige uma string: repo → relativo, home → ~. Não-string passa direto. */
export function redactText(text, { home, repoRoot } = {}) {
  if (typeof text !== 'string' || !text) return text;
  const h = home === undefined ? os.homedir() : home;
  const pairs = [];
  if (repoRoot) pairs.push([path.normalize(repoRoot), '']);
  if (h) pairs.push([path.normalize(h), '~']);
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [root, marker] of pairs) {
    out = out.replaceAll(root + path.sep, marker ? marker + path.sep : '');
    out = out.replaceAll(root, marker || REDACTED_ROOT);
  }
  return out;
}

/** Redige recursivamente todo valor-string de um documento JSON. */
export function redactValue(value, ctx) {
  const c = { home: ctx?.home || os.homedir(), repoRoot: ctx?.repoRoot || null };
  return redactValueIn(value, c);
}
function redactValueIn(value, ctx) {
  if (typeof value === 'string') return redactText(value, ctx);
  if (Array.isArray(value)) return value.map((v) => redactValueIn(v, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValueIn(v, ctx);
    return out;
  }
  return value;
}

function walk(file, ctx) {
  if (!file.isFile()) return null;
  if (file.name === 'report.html') return null; // regenerado a partir do pack redigido
  if (!/\.(json|md|mmd)$/.test(file.name)) return null;
  return file.name.endsWith('.json') ? 'json' : 'text';
}

/**
 * Redige o pack inteiro: JSONs (profundo) e textos (MD/Mermaid) sob dir.
 * Marca run-meta.repo_root com o marcador e preserva o nome do repo em
 * repo_root_name para proveniência. Retorna os arquivos reescritos.
 */
export function redactPack(dir, { home, repoRoot } = {}) {
  const ctx = { home: home || os.homedir(), repoRoot: repoRoot || null };
  const rewritten = [];
  const visit = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      const kind = walk(entry, ctx);
      if (!kind) continue;
      const raw = fs.readFileSync(full, 'utf8');
      let next = raw;
      if (kind === 'json') {
        try {
          const doc = JSON.parse(raw);
          const redoc = redactValue(doc, ctx);
          // Stamps cobrem o conteúdo do doc: recalcular result_hash sobre o
          // conteúdo redigido mantém a validação de evidência coerente sem
          // alterar o snapshot selado (run_id/source_hash/input_hash intactos).
          if (redoc?.evidence?.result_hash) {
            const { evidence, ...result } = redoc;
            redoc.evidence = { ...evidence, result_hash: digest(result) };
          }
          next = JSON.stringify(redoc, null, 2) + '\n';
        } catch {
          continue; // JSON inválido não é redigido às cegas
        }
      } else next = redactText(raw, ctx);
      if (next !== raw) {
        fs.writeFileSync(full, next);
        rewritten.push(path.relative(dir, full));
      }
    }
  };
  visit(path.resolve(dir));
  const metaPath = path.join(dir, 'run-meta.json');
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = null;
  }
  if (meta && ctx.repoRoot && meta.repo_root) {
    const needsMarker = meta.repo_root !== REDACTED_ROOT;
    const needsName = !meta.repo_root_name;
    if (needsMarker || needsName) {
      meta.repo_root = REDACTED_ROOT;
      if (needsName) meta.repo_root_name = path.basename(ctx.repoRoot);
      if (!rewritten.includes('run-meta.json')) rewritten.push('run-meta.json');
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    }
  }
  return rewritten;
}

#!/usr/bin/env node
/**
 * review-verify.mjs — apuração do painel de revisão de código de UMA correção.
 *
 *   node review-verify.mjs --dir <pack> --id <FINDING-ID> [--diff-stat "12 files"]
 *   node review-verify.mjs --dir <pack> --all        # apura tudo que tem voto
 *
 * Lê os três votos independentes em `reviews/votes/<ID>-<LENTE>.json`
 * (CORRECTNESS · QUALITY · SCOPE) e decide, em código:
 *
 *   qualquer BLOQUEIA          → `rejected`           (a correção não vale; refaça)
 *   qualquer MUDANCAS          → `changes_requested`  (volta ao Ferreiro com a lista)
 *   3× APROVA                  → `approved`           (libera o `--done`)
 *
 * Falha fechado: os **três** arquivos de voto têm de existir. Um painel com dois
 * votantes não é painel — é opinião com testemunha. `sync-progress --done` recusa
 * fechar sem `reviews/<ID>.json` com `verdict: "approved"`.
 *
 * Saída: 0 aprovado · 2 painel inválido/incompleto · 3 reprovado ou com mudanças.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cliArg, cliFlag, nowStamp } from './lib-findings.mjs';

export const REVIEW_LENSES = ['CORRECTNESS', 'QUALITY', 'SCOPE'];
const LENS_AGENT = { CORRECTNESS: 'Nêmesis', QUALITY: 'Hígia', SCOPE: 'Jano' };
const VERDICTS = ['APROVA', 'MUDANCAS', 'BLOQUEIA'];

const dir = cliArg('dir');
const all = cliFlag('all');
const onlyId = cliArg('id', '');

if (!dir || (!onlyId && !all)) {
  console.error('Uso: node review-verify.mjs --dir <pack> (--id <FINDING-ID> | --all)');
  process.exit(1);
}

const reviewsDir = path.join(dir, 'reviews');
const votesDir = path.join(reviewsDir, 'votes');

/** Normaliza voto vindo do agente sem inventar conteúdo: só forma, nunca veredito. */
function normalizeVote(raw, lens) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const verdict = String(v.verdict || '')
    .toUpperCase()
    .replace(/[ÇC]/g, 'C')
    .replace(/Ã/g, 'A')
    .trim();
  return {
    lens,
    verdict,
    reasoning: String(v.reasoning || '').trim(),
    required_changes: Array.isArray(v.required_changes) ? v.required_changes.filter(Boolean) : [],
    new_findings: Array.isArray(v.new_findings) ? v.new_findings.filter(Boolean) : [],
    unrelated_files: Array.isArray(v.unrelated_files) ? v.unrelated_files.filter(Boolean) : [],
    cited_paths: Array.isArray(v.cited_paths) ? v.cited_paths.filter(Boolean) : [],
    test_reversal_checked: v.test_reversal_checked === true,
    agent: LENS_AGENT[lens],
  };
}

/** Apura um achado. Devolve { id, verdict, votes, problems }. */
function tally(id) {
  const problems = [];
  const votes = [];

  for (const lens of REVIEW_LENSES) {
    const p = path.join(votesDir, `${id}-${lens}.json`);
    if (!fs.existsSync(p)) {
      problems.push(`voto ausente: reviews/votes/${id}-${lens}.json (${LENS_AGENT[lens]} não votou).`);
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      problems.push(`voto ilegível em ${id}-${lens}.json: ${e.message}`);
      continue;
    }
    const vote = normalizeVote(raw, lens);
    if (!VERDICTS.includes(vote.verdict)) {
      problems.push(`${id}-${lens}: verdict "${vote.verdict || '(vazio)'}" inválido — use ${VERDICTS.join(' | ')}.`);
      continue;
    }
    if (!vote.reasoning) {
      problems.push(`${id}-${lens}: sem \`reasoning\` — voto sem justificativa não conta.`);
      continue;
    }
    if (vote.verdict !== 'APROVA' && !vote.required_changes.length) {
      problems.push(
        `${id}-${lens}: verdict ${vote.verdict} sem \`required_changes\` — ` +
          `reprovar sem dizer o que mudar devolve o trabalho para o vazio.`,
      );
      continue;
    }
    votes.push(vote);
  }

  if (problems.length) return { id, verdict: 'invalid', votes, problems };

  const blocked = votes.filter((v) => v.verdict === 'BLOQUEIA');
  const changes = votes.filter((v) => v.verdict === 'MUDANCAS');
  const verdict = blocked.length ? 'rejected' : changes.length ? 'changes_requested' : 'approved';

  return { id, verdict, votes, problems: [] };
}

function writeResult(r) {
  fs.mkdirSync(reviewsDir, { recursive: true });
  const out = {
    id: r.id,
    verdict: r.verdict,
    reviewed_at: nowStamp(),
    panel_source: 'vote-files',
    voters: r.votes.length,
    lenses: REVIEW_LENSES,
    votes: r.votes,
    required_changes: r.votes.flatMap((v) => v.required_changes.map((c) => `[${v.lens}] ${c}`)),
    new_findings: r.votes.flatMap((v) => v.new_findings),
    unrelated_files: [...new Set(r.votes.flatMap((v) => v.unrelated_files))],
    test_reversal_checked: r.votes.some((v) => v.test_reversal_checked),
  };
  fs.writeFileSync(path.join(reviewsDir, `${r.id}.json`), JSON.stringify(out, null, 2) + '\n');
  return out;
}

// ---- alvos ------------------------------------------------------------------
let ids = [];
if (onlyId) {
  ids = [onlyId];
} else {
  const files = fs.existsSync(votesDir) ? fs.readdirSync(votesDir).filter((f) => f.endsWith('.json')) : [];
  ids = [
    ...new Set(
      files
        .map((f) => f.replace(/-(CORRECTNESS|QUALITY|SCOPE)\.json$/, ''))
        .filter((s) => !s.endsWith('.json')),
    ),
  ].sort();
  if (!ids.length) {
    console.error(`review-verify: nenhum voto em ${votesDir} — o painel de revisão não rodou.`);
    process.exit(2);
  }
}

// ---- apuração ---------------------------------------------------------------
const results = [];
let invalid = 0;
let notApproved = 0;

for (const id of ids) {
  const r = tally(id);
  if (r.verdict === 'invalid') {
    invalid++;
    console.error(`review-verify: ✗ ${id} — painel inválido:`);
    for (const p of r.problems) console.error(`    · ${p}`);
    continue;
  }
  const out = writeResult(r);
  results.push(out);
  const icon = out.verdict === 'approved' ? '✓' : out.verdict === 'changes_requested' ? '↺' : '✗';
  console.log(
    `review-verify: ${icon} ${id} → ${out.verdict} ` +
      `(${out.votes.map((v) => `${v.lens}:${v.verdict}`).join(' · ')})`,
  );
  if (out.verdict !== 'approved') {
    notApproved++;
    for (const c of out.required_changes) console.log(`    → ${c}`);
  }
}

// resumo consolidado, para o report e para o Maestro
if (results.length) {
  const summary = {
    generated_at: nowStamp(),
    panel_source: 'vote-files',
    lenses: REVIEW_LENSES,
    reviewed: results.length,
    approved: results.filter((r) => r.verdict === 'approved').length,
    changes_requested: results.filter((r) => r.verdict === 'changes_requested').length,
    rejected: results.filter((r) => r.verdict === 'rejected').length,
    by_id: Object.fromEntries(results.map((r) => [r.id, r.verdict])),
  };
  fs.writeFileSync(path.join(reviewsDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(
    `review-verify: ${summary.reviewed} revisada(s) · ${summary.approved} aprovada(s) · ` +
      `${summary.changes_requested} com mudanças · ${summary.rejected} reprovada(s)`,
  );
}

if (invalid) process.exit(2);
if (notApproved) process.exit(3);

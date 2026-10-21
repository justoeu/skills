#!/usr/bin/env node
/**
 * lint-findings.mjs — o gate que o modelo não consegue driblar.
 *
 *   node lint-findings.mjs --dir <pack> [--fix] [--gate]
 *
 * Verifica, em código:
 *   · schema mínimo de cada achado (id, agente, lente, severidade, local)
 *   · ids únicos
 *   · auditoria de rótulo: `resolvido` só com teste; `refutado` só com evidência;
 *     `aceito` só com os 4 campos + subtipo válido; HIGH/CRITICAL nunca `aceito`
 *   · integridade do painel de segurança: quem se diz `verification: "panel"`
 *     tem de ter voto real em sec-deep/votes/ e coverage `panel_source=vote-files`
 *   · --gate: falha se sobrar HIGH/CRITICAL **aberto**, achado que bloqueia PR,
 *     identidade do alvo incompleta (app/version/branch), pesquisa de libs ausente
 *     ou correção `resolvido` sem revisão de código aprovada pelo painel de 3 lentes
 *
 * `--fix` rebaixa rótulo inválido para `aberto` e regrava FINDINGS.json.
 * Saída: 0 ok · 2 violação.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  auditLabel,
  cliArg,
  cliFlag,
  counts,
  normalizeLens,
  normalizeSeverity,
  normalizeStatus,
} from './lib-findings.mjs';

const dir = cliArg('dir');
const fix = cliFlag('fix');
const gate = cliFlag('gate');
if (!dir) {
  console.error('Uso: node lint-findings.mjs --dir <pack> [--fix] [--gate]');
  process.exit(1);
}

const findingsPath = path.join(dir, 'FINDINGS.json');
if (!fs.existsSync(findingsPath)) {
  console.error(`lint-findings: ${findingsPath} não existe — rode merge-findings.mjs antes.`);
  process.exit(2);
}

let findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
if (!Array.isArray(findings)) findings = findings.findings ?? [];

const errors = [];
const warnings = [];

// ---- schema + ids -----------------------------------------------------------
const seenIds = new Set();
for (const f of findings) {
  const at = f.id || f.title || '(sem id)';
  if (!f.id) errors.push(`${at}: sem id.`);
  else if (seenIds.has(f.id)) errors.push(`${f.id}: id duplicado.`);
  else seenIds.add(f.id);

  if (!f.title) errors.push(`${at}: sem título.`);
  if (!f.agent) errors.push(`${at}: sem agente responsável.`);
  if (!f.path && normalizeLens(f) !== 'deps') {
    warnings.push(`${at}: sem \`path\` — achado sem local é difícil de corrigir e de refutar.`);
  }
  if (!f.fix && normalizeStatus(f.status) === 'open') {
    warnings.push(`${at}: aberto sem \`fix\` (plano). Todo aberto precisa de plano.`);
  }
  if (!f.impact) warnings.push(`${at}: sem \`impact\` — severidade sem impacto declarado é palpite.`);

  const { errors: labelErrs } = auditLabel(f, { fix });
  errors.push(...labelErrs.map((e) => (fix ? `${e} [rebaixado para aberto]` : e)));
}

// ---- integridade do painel de segurança -------------------------------------
const secDir = path.join(dir, 'sec-deep');
const coveragePath = path.join(secDir, 'coverage.json');
const votesDir = path.join(secDir, 'votes');
const panelClaims = findings.filter((f) => f.verification === 'panel');

if (panelClaims.length) {
  let coverage = null;
  try {
    coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  } catch {
    coverage = null;
  }
  if (!coverage) {
    errors.push(
      `${panelClaims.length} achado(s) alegam \`verification: "panel"\` mas não existe ${coveragePath}. ` +
        `Painel sem tally de código não é painel — rode sec-verify.mjs ou marque como "spot-check".`,
    );
  } else {
    if (coverage.panel_source !== 'vote-files') {
      errors.push(
        `coverage.panel_source=${coverage.panel_source || 'ausente'} (esperado "vote-files"). ` +
          `Votos agregados à mão não valem como painel.`,
      );
    }
    if (coverage.verification_status === 'unverified') {
      errors.push(`coverage.verification_status=unverified — não emita SEC-* como painel nesta rodada.`);
    }
  }
  const voteFiles = fs.existsSync(votesDir) ? fs.readdirSync(votesDir).filter((f) => f.endsWith('.json')) : [];
  if (voteFiles.length === 0) {
    errors.push(`sec-deep/votes/ vazio, mas há achado alegando painel. Pipeline quebrado.`);
  }
  for (const f of panelClaims) {
    const p = f.panel || {};
    const voters = Number(p.voters || 0);
    const t = Number(p.true || 0);
    if (voters < 3) errors.push(`${f.id}: painel com ${voters} votantes (mínimo 3: REACHABILITY/IMPACT/DEFENSES).`);
    if (t < 2) errors.push(`${f.id}: painel abaixo do quórum (${t}/${voters}) — não deveria estar no report.`);
    if (t < voters && f.confidence === 'high') {
      errors.push(`${f.id}: confiança "high" com painel dividido (${t}/${voters}). Só unânime chega a high.`);
    }
  }
}

// ---- gate de fechamento -----------------------------------------------------
const c = counts(findings);
if (gate) {
  const openHigh = findings.filter(
    (f) =>
      normalizeStatus(f.status) === 'open' &&
      ['HIGH', 'CRITICAL'].includes(normalizeSeverity(f.severity)),
  );
  for (const f of openHigh) {
    errors.push(`${f.id} (${f.severity}) segue ABERTO — HIGH não fecha rodada nem pode ser aceito.`);
  }
  const blocking = findings.filter((f) => f.blocks_pr && normalizeStatus(f.status) === 'open');
  for (const f of blocking) {
    errors.push(`${f.id} bloqueia PR e continua aberto.`);
  }

  // Identidade do alvo: sem app/versão/branch o pack não é comparável com a rodada
  // anterior nem rastreável depois — vira "auditamos o projeto", que não é afirmação.
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'run-meta.json'), 'utf8'));
  } catch {
    meta = null;
  }
  if (!meta) {
    errors.push('sem run-meta.json no pack — rode init-run.mjs; o report não tem como dizer o que auditou.');
  } else {
    for (const [field, hint] of [
      ['app', 'nome do projeto'],
      ['version', 'versão auditada (passe --version se a detecção falhar)'],
      ['branch', 'branch analisada'],
    ]) {
      if (!meta[field]) errors.push(`run-meta.json sem \`${field}\` — ${hint}.`);
    }
  }

  // Revisão de código da correção: quem escreveu o patch não assina o próprio aceite.
  // O veredito vem de reviews/<ID>.json, apurado por review-verify.mjs sobre 3 votos.
  const resolved = findings.filter((f) => normalizeStatus(f.status) === 'resolved');
  for (const f of resolved) {
    const r = f.review;
    if (r && r.waived) {
      warnings.push(
        `${f.id}: revisão de código DISPENSADA — "${r.waived_reason || 'sem motivo registrado'}". ` +
          `Dispensa é dívida: revise na próxima rodada.`,
      );
      continue;
    }
    if (!r) {
      errors.push(
        `${f.id}: resolvido sem revisão de código. Rode o painel (Nêmesis/Hígia/Jano) + ` +
          `review-verify.mjs --id ${f.id}, ou registre --review-waived "motivo".`,
      );
      continue;
    }
    if (r.verdict !== 'approved') {
      errors.push(`${f.id}: resolvido com revisão \`${r.verdict}\` — só \`approved\` fecha.`);
    }
    if (r.panel_source !== 'vote-files') {
      errors.push(
        `${f.id}: review.panel_source=${r.panel_source || 'ausente'} (esperado "vote-files"). ` +
          `Veredito montado à mão não é painel.`,
      );
    }
    if (Number(r.voters || 0) < 3) {
      errors.push(`${f.id}: revisão com ${r.voters || 0} votante(s) — o painel é 3 (CORRECTNESS/QUALITY/SCOPE).`);
    }
  }

  // Pesquisa de libs: o arquivo existe mesmo num projeto sem dependência (0 pacotes).
  // Ausência = a lente não rodou, e um report mudo sobre libs é lido como "está tudo em dia".
  if (!fs.existsSync(path.join(dir, 'deps-latest.json'))) {
    errors.push(
      'sem deps-latest.json no pack — a pesquisa de libs não rodou. ' +
        'Rode check-deps-latest.mjs: report e roadmap mudos sobre libs são lidos como "nenhuma atrasada".',
    );
  }
}

if (fix) {
  fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2) + '\n');
}

console.log(
  `lint-findings: ${c.total} achados · ${c.open} aberto · ${c.resolved} resolvido · ` +
    `${c.refuted} refutado · ${c.accepted} aceito · ${c.blocks} bloqueando PR`,
);
console.log(
  `  severidade: CRITICAL ${c.bySeverity.CRITICAL} · HIGH ${c.bySeverity.HIGH} · ` +
    `MEDIUM ${c.bySeverity.MEDIUM} · LOW ${c.bySeverity.LOW} · INFO ${c.bySeverity.INFO}`,
);
for (const w of warnings) console.warn(`  ⚠ ${w}`);
for (const e of errors) console.error(`  ✗ ${e}`);

if (errors.length) {
  console.error(`lint-findings: ${errors.length} violação(ões).`);
  process.exit(2);
}
console.log('lint-findings: OK' + (gate ? ' (gate de fechamento passou)' : ''));

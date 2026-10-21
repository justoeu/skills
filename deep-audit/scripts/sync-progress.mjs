#!/usr/bin/env node
/**
 * sync-progress.mjs — desfecho de cada achado + TASKS.md + report.html.
 *
 *   # depois do merge (gera tracker + HTML)
 *   node sync-progress.mjs --dir <pack>
 *
 *   # resolvido — exige o teste que prova (red→green→reversão) E a revisão
 *   # de código aprovada pelo painel de 3 lentes (review-verify.mjs)
 *   node sync-progress.mjs --dir <pack> --done SEC-CER-001,BUG-ART-002 \
 *     --test "AuthzTest#negaOutroDono" --note "PR #372"
 *
 *   # dispensa da revisão — última instância, fica VISÍVEL no TASKS.md e no HTML
 *   node sync-progress.mjs --dir <pack> --done X --test "..." \
 *     --review-waived "hotfix de produção às 3h; revisão agendada para a rodada seguinte"
 *
 *   # refutado — exige a evidência que derruba a premissa
 *   node sync-progress.mjs --dir <pack> --refute CQ-AUR-004 \
 *     --evidence "handler roda atrás de requireOwner (router.ts:88); premissa cai"
 *
 *   # aceito — exige os 4 campos + subtipo; HIGH/CRITICAL é recusado
 *   node sync-progress.mjs --dir <pack> --accept DEP-PRI-003 \
 *     --accept-type sem-correcao-disponivel \
 *     --what "TOMLKit 0.6.0 sem release há 2 anos" \
 *     --consequence "se quebrar num Swift futuro, o parser de config para" \
 *     --reopen-if "falhar em Swift major novo ou surgir CVE" \
 *     --ratified-by "Valmir (dono do produto)"
 *
 *   # progresso parcial (task vira [~]) / reabrir
 *   node sync-progress.mjs --dir <pack> --progress N1-ENX-002 --note "batch pronto, falta teste"
 *   node sync-progress.mjs --dir <pack> --open CQ-AUR-004
 *
 *   # publicar as cópias estáveis em docs/audits/
 *   node sync-progress.mjs --dir <pack> --publish docs/audits
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  ACCEPT_TYPES,
  AGENTS,
  LENS_LABEL,
  SEV_RANK,
  SEVERITIES,
  auditLabel,
  cliArg,
  cliFlag,
  counts,
  normalizeLens,
  normalizeSeverity,
  normalizeStatus,
  nowStamp,
  prioOf,
} from './lib-findings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dir = cliArg('dir');
if (!dir) {
  console.error(
    'Uso: node sync-progress.mjs --dir <pack> [--done ids --test "..."] [--refute id --evidence "..."] ' +
      '[--accept id --accept-type ... --what ... --consequence ... --reopen-if ... --ratified-by ...] ' +
      '[--progress id --note "..."] [--open ids] [--publish <dir>] [--title "..."] ' +
      '[--review-waived "motivo"]',
  );
  process.exit(1);
}

const findingsPath = path.join(dir, 'FINDINGS.json');
const tasksPath = path.join(dir, 'TASKS.md');
const htmlPath = path.join(dir, 'report.html');
const reportPath = path.join(dir, 'REPORT.md');
const metaPath = path.join(dir, 'run-meta.json');

if (!fs.existsSync(findingsPath)) {
  console.error(`sync-progress: ${findingsPath} não existe — rode merge-findings.mjs antes.`);
  process.exit(1);
}

let findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
if (!Array.isArray(findings)) findings = findings.findings ?? [];

const byId = new Map(findings.map((f) => [f.id, f]));
const now = nowStamp();
const note = cliArg('note', '');
const testNote = cliArg('test', '');
const evidence = cliArg('evidence', '');
const journal = [];
const fatal = [];

function pick(ids) {
  const out = [];
  for (const raw of String(ids).split(',')) {
    const id = raw.trim();
    if (!id) continue;
    const f = byId.get(id);
    if (!f) {
      fatal.push(`id desconhecido: ${id}`);
      continue;
    }
    out.push(f);
  }
  return out;
}

function addProgress(f, text) {
  f.progress = f.progress || [];
  f.progress.unshift(`${now.slice(0, 10)}: ${text}`);
  f.progress = f.progress.slice(0, 20);
}

// ---- revisão de código da correção ------------------------------------------
// Toda correção passa por 3 revisores independentes (Nêmesis/Hígia/Jano) e a
// apuração é do `review-verify.mjs`. O veredito é lido do arquivo; o desfecho
// `resolvido` não é auto-declarável por quem escreveu o patch.
const reviewWaived = cliArg('review-waived', '');

function readReview(id) {
  const p = path.join(dir, 'reviews', `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ---- resolvido --------------------------------------------------------------
const doneArg = cliArg('done', '');
if (doneArg) {
  if (!testNote.trim()) {
    fatal.push(
      '--done exige --test "Suite#caso": sem o teste que falha antes e passa depois, a correção não está feita.',
    );
  } else {
    for (const f of pick(doneArg)) {
      const review = readReview(f.id);
      if (!review && !reviewWaived.trim()) {
        fatal.push(
          `${f.id}: sem revisão de código da correção. Despache Nêmesis (CORRECTNESS), ` +
            `Hígia (QUALITY) e Jano (SCOPE) sobre o diff, grave os votos em ` +
            `reviews/votes/${f.id}-<LENTE>.json e rode:\n` +
            `      node review-verify.mjs --dir "${dir}" --id ${f.id}\n` +
            `      (revisão inevitável neste turno? --review-waived "motivo" — fica VISÍVEL no report)`,
        );
        continue;
      }
      if (review && review.verdict !== 'approved' && !reviewWaived.trim()) {
        const list = (review.required_changes || []).map((c) => `\n      → ${c}`).join('');
        fatal.push(
          `${f.id}: revisão com veredito \`${review.verdict}\` — não fecha como resolvido.${list}\n` +
            `      Corrija, re-vote e rode review-verify de novo.`,
        );
        continue;
      }
      f.status = 'resolved';
      f.resolved_test = testNote.trim();
      f.resolved_at = now;
      if (note) f.resolved_note = note;
      f.blocks_pr = false;
      f.test_red_green = { ...(f.test_red_green || {}), name: testNote.trim() };
      if (review) {
        f.review = {
          verdict: review.verdict,
          reviewed_at: review.reviewed_at,
          panel_source: review.panel_source,
          voters: review.voters,
          votes: (review.votes || []).map((v) => ({ lens: v.lens, verdict: v.verdict, agent: v.agent })),
          test_reversal_checked: review.test_reversal_checked === true,
        };
      }
      if (reviewWaived.trim()) {
        f.review = { ...(f.review || {}), waived: true, waived_reason: reviewWaived.trim(), waived_at: now };
        addProgress(f, `⚠ revisão dispensada · ${reviewWaived.trim()}`);
        journal.push(`revisão DISPENSADA em ${f.id} (${reviewWaived.trim()})`);
      }
      addProgress(
        f,
        `resolvido · teste ${testNote.trim()}` +
          `${review ? ` · revisão ${review.verdict} (${review.voters}/3)` : ''}${note ? ` · ${note}` : ''}`,
      );
      journal.push(`resolvido ${f.id} (teste: ${testNote.trim()})`);
    }
  }
}

// ---- refutado ---------------------------------------------------------------
const refuteArg = cliArg('refute', '');
if (refuteArg) {
  if (!evidence.trim()) {
    fatal.push('--refute exige --evidence "...": refutar é provar que o defeito NÃO existe.');
  } else {
    for (const f of pick(refuteArg)) {
      f.status = 'refuted';
      f.refuted_by = evidence.trim();
      f.refuted_at = now;
      f.blocks_pr = false;
      addProgress(f, `refutado · ${evidence.trim()}`);
      journal.push(`refutado ${f.id}`);
    }
  }
}

// ---- aceito -----------------------------------------------------------------
const acceptArg = cliArg('accept', '');
if (acceptArg) {
  const accept = {
    type: cliArg('accept-type', ''),
    what: cliArg('what', ''),
    consequence: cliArg('consequence', ''),
    reopen_if: cliArg('reopen-if', ''),
    ratified_by: cliArg('ratified-by', ''),
  };
  const missing = Object.entries(accept)
    .filter(([, v]) => !String(v || '').trim())
    .map(([k]) => k);
  if (missing.length) {
    fatal.push(
      `--accept exige os 4 campos + subtipo (falta: ${missing.join(', ')}). ` +
        `Um "aceito por design" sem eles é desculpa, não decisão.`,
    );
  } else if (!ACCEPT_TYPES.includes(accept.type)) {
    fatal.push(`--accept-type inválido "${accept.type}" — use ${ACCEPT_TYPES.join(' | ')}.`);
  } else {
    for (const f of pick(acceptArg)) {
      const sev = normalizeSeverity(f.severity);
      if (sev === 'HIGH' || sev === 'CRITICAL') {
        fatal.push(
          `${f.id} é ${sev}: HIGH/CRITICAL não é aceitável por design. Corrija ou reclassifique com evidência.`,
        );
        continue;
      }
      f.status = 'accepted';
      f.accept = accept;
      f.accepted_at = now;
      f.blocks_pr = false;
      addProgress(f, `aceito (${accept.type}) · ratificado por ${accept.ratified_by}`);
      journal.push(`aceito ${f.id} (${accept.type})`);
    }
  }
}

// ---- reabrir / progresso ----------------------------------------------------
const openArg = cliArg('open', '');
if (openArg) {
  for (const f of pick(openArg)) {
    f.status = 'open';
    delete f.resolved_test;
    delete f.resolved_at;
    delete f.refuted_by;
    delete f.refuted_at;
    delete f.accept;
    delete f.accepted_at;
    addProgress(f, `reaberto${note ? ` · ${note}` : ''}`);
    journal.push(`reaberto ${f.id}`);
  }
}

const progressArg = cliArg('progress', '');
if (progressArg) {
  if (!note.trim()) fatal.push('--progress exige --note "o que avançou".');
  else {
    for (const f of pick(progressArg)) {
      f.in_progress = true;
      addProgress(f, note.trim());
      journal.push(`progresso ${f.id}`);
    }
  }
}

if (fatal.length) {
  for (const m of fatal) console.error(`sync-progress: ✗ ${m}`);
  process.exit(2);
}

// ---- auditoria de rótulo + normalização -------------------------------------
const labelErrors = [];
for (const f of findings) {
  f.status = normalizeStatus(f.status);
  if (f.status !== 'open') f.blocks_pr = false;
  if (f.status === 'resolved' || f.status === 'refuted' || f.status === 'accepted') f.in_progress = false;
  const { errors } = auditLabel(f, { fix: true });
  labelErrors.push(...errors);
}

findings.sort(
  (a, b) =>
    (SEV_RANK[normalizeSeverity(a.severity)] ?? 9) - (SEV_RANK[normalizeSeverity(b.severity)] ?? 9) ||
    String(a.id).localeCompare(String(b.id)),
);
fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2) + '\n');

// ---- TASKS.md ---------------------------------------------------------------
const c = counts(findings);
const closed = c.resolved + c.refuted + c.accepted;
const pct = c.total ? Math.round((closed / c.total) * 100) : 0;
const inProgress = findings.filter((f) => f.status === 'open' && f.in_progress).length;
const complete = c.open === 0 && c.total > 0;

const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
const lensesUsed = [...new Set(findings.map((f) => normalizeLens(f)))].map((l) => LENS_LABEL[l] || l);

function box(f) {
  if (f.status === 'resolved') return '[x]';
  if (f.status === 'refuted') return '[-]';
  if (f.status === 'accepted') return '[!]';
  if (f.in_progress) return '[~]';
  return '[ ]';
}

// Revisão dispensada nunca vira linha silenciosa: aparece no tracker ao lado do teste.
function reviewTag(f) {
  const r = f.review;
  if (f.status !== 'resolved') return '';
  if (!r) return ' · revisão: **ausente**';
  if (r.waived) return ` · ⚠ **revisão DISPENSADA** (${r.waived_reason})`;
  const lentes = (r.votes || []).map((v) => `${v.lens}:${v.verdict}`).join(' ');
  return ` · revisão: ${r.verdict} (${r.voters || 0}/3${lentes ? ` — ${lentes}` : ''})`;
}

const resolvedAll = findings.filter((f) => f.status === 'resolved');
const reviewApproved = resolvedAll.filter((f) => f.review && !f.review.waived && f.review.verdict === 'approved');
const reviewWaivedList = resolvedAll.filter((f) => f.review && f.review.waived);
const reviewMissing = resolvedAll.filter((f) => !f.review);

const L = [];
L.push('# TASKS — Deep Audit (ultra-deep)');
L.push('');
L.push(
  `> Gerado por \`sync-progress.mjs\` · **não edite ids à mão** — use \`--done\` / \`--refute\` / \`--accept\` / \`--open\`.`,
);
L.push('');
L.push(
  `**Projeto:** \`${meta.app || 'n/a'}\` · **versão** \`${meta.version || 'n/a'}\`` +
    `${meta.version_source ? ` (${meta.version_source})` : ''} · **branch** \`${meta.branch || 'n/a'}\`` +
    `${meta.head ? ` · head \`${meta.head}\`` : ''}`,
);
L.push('');
L.push(
  `**Rodada:** ${meta.generated_at || now}` +
    ` · modo \`${meta.mode || '?'}\` · profundidade \`${meta.depth || '?'}\`` +
    ` · esforço \`${meta.effort || 'n/a'}\`${meta.base ? ` · base \`${meta.base}\`` : ''}`,
);
L.push('');
L.push(`**Lentes:** ${lensesUsed.join(' · ') || '—'}`);
L.push('');
L.push(
  `**Resumo:** ${c.total} tasks · ${c.resolved} resolvidas · ${inProgress} em progresso · ${c.open} pendentes · ` +
    `${c.refuted} refutadas · ${c.accepted} aceitas · **${pct}% fechadas**` +
    (c.openHigh ? ` · ⛔ ${c.openHigh} HIGH+ ABERTO` : ' · ✅ nenhum HIGH aberto'),
);
L.push('');
L.push(
  `**Revisão das correções (painel Nêmesis · Hígia · Jano):** ${reviewApproved.length}/${resolvedAll.length} aprovadas` +
    `${reviewWaivedList.length ? ` · ⚠ ${reviewWaivedList.length} dispensada(s)` : ''}` +
    `${reviewMissing.length ? ` · ⛔ ${reviewMissing.length} sem revisão` : ''}`,
);
L.push('');
L.push('Legenda: `[ ]` pendente · `[~]` em progresso · `[x]` resolvido (com teste) · `[-]` refutado · `[!]` aceito');
L.push('');

L.push('## Tasks por severidade');
L.push('');
for (const sev of SEVERITIES) {
  const items = findings.filter((f) => normalizeSeverity(f.severity) === sev);
  if (!items.length) continue;
  const d = items.filter((f) => f.status === 'resolved').length;
  L.push(`### ${sev} (${d}/${items.length} resolvidos)`);
  L.push('');
  for (const f of items) {
    const lens = LENS_LABEL[normalizeLens(f)] || normalizeLens(f);
    const loc = f.path ? `\`${f.path}${f.line != null ? ':' + f.line : ''}\`` : '`—`';
    const test = f.resolved_test || (f.test_red_green?.name !== 'TBD' ? f.test_red_green?.name : '') || '—';
    L.push(
      `- ${box(f)} **${f.id}** · ${lens} · ${sev} · ${loc} — ${f.title}` +
        ` · resp: ${f.agent} · teste: ${test === '—' ? '—' : `\`${test}\``}` +
        reviewTag(f) +
        `${f.blocks_pr ? ' · **BLOQUEIA PR**' : ''}` +
        `${prioOf(f) === 'P0' && f.status === 'open' ? ' · P0' : ''}`,
    );
    if (f.status === 'refuted') L.push(`  > refutado: ${f.refuted_by}`);
    if (f.status === 'accepted') {
      const a = f.accept || {};
      L.push(`  > aceito (${a.type}): ${a.what}`);
      L.push(`  > consequência: ${a.consequence} · reabre se: ${a.reopen_if} · ratificou: ${a.ratified_by}`);
    }
    for (const p of (f.progress || []).slice(0, 3)) L.push(`  > progresso ${p}`);
  }
  L.push('');
}

L.push('## Ainda aberto');
L.push('');
const open = findings.filter((f) => f.status === 'open');
if (!open.length) L.push('_Nada aberto._ 🎉');
else {
  for (const f of open.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9))) {
    L.push(`- **${f.id}** (${f.severity}) — ${f.title}${f.fix ? ` · plano: ${f.fix}` : ' · _sem plano registrado_'}`);
  }
}
L.push('');

// ---- roadmap de libs --------------------------------------------------------
// Atualização de dependência é trabalho agendável como qualquer achado. Se a
// pesquisa só existe no deps-latest.json, ninguém a planeja — então ela entra
// aqui, no mesmo tracker, com o número de libs pesquisadas (não só as atrasadas).
const depsPath = path.join(dir, 'deps-latest.json');
const depsData = fs.existsSync(depsPath) ? JSON.parse(fs.readFileSync(depsPath, 'utf8')) : null;

L.push('## Roadmap de libs / dependências');
L.push('');
if (!depsData) {
  L.push(
    '⚠️ **A pesquisa de libs não rodou nesta rodada** — sem `deps-latest.json` no pack. ' +
      'Rode `check-deps-latest.mjs --out <pack>/deps-latest.json --findings <pack>/agent-prisma-freshness.json` ' +
      'e re-sincronize. Ausência de linha aqui **não** significa "nenhuma lib atrasada": significa que não perguntamos.',
  );
  L.push('');
} else {
  const ds = depsData.summary || {};
  const bump = ds.by_bump || {};
  const depsOpen = findings.filter((f) => normalizeLens(f) === 'deps' && f.status === 'open');
  L.push(
    `**Pesquisa:** ${ds.checked || 0} lib(s) consultada(s) · ${ds.up_to_date || 0} em dia · ` +
      `**${ds.outdated || 0} atrás do latest stable** (major ${bump.major || 0} · minor ${bump.minor || 0} · patch ${bump.patch || 0})` +
      `${ds.errors ? ` · ⚠️ ${ds.errors} consulta(s) falharam — total incompleto` : ''}` +
      ` · ${depsOpen.length} achado(s) de deps em aberto`,
  );
  L.push('');
  // `priority: info` é o resumo de stack, não trabalho — não vira checkbox.
  const batches = ((depsData.update_map || {}).batches || []).filter((b) => b.priority !== 'info');
  if (batches.length) {
    L.push('### Lotes de atualização (tamanho de PR)');
    L.push('');
    for (const b of batches) {
      const pkgs = (b.packages || []).map((p) => p.package || p.name || p);
      L.push(
        `- [ ] **${b.title || b.id}** · ${b.priority || 'P3'}` +
          `${pkgs.length ? ` · ${pkgs.join(', ')}` : ''}` +
          `${b.rationale ? ` — ${b.rationale}` : ''}`,
      );
    }
    L.push('');
  }
  const eco = (depsData.update_map || {}).by_ecosystem || {};
  const ecoNames = Object.keys(eco).filter((n) => (eco[n].updates || []).length);
  if (ecoNames.length) {
    L.push('### Pacotes atrás do latest stable');
    L.push('');
    for (const name of ecoNames) {
      for (const u of eco[name].updates) {
        L.push(`- [ ] \`${name}\` **${u.name}** ${u.current} → **${u.latest_stable}** (${u.bump}) · \`${u.manifest || '—'}\``);
      }
    }
    L.push('');
  } else if (!batches.length) {
    L.push('_Toda lib pesquisada está no latest stable._ ✅');
    L.push('');
  }
  const runnerErrors = depsData.runner_errors || [];
  if (runnerErrors.length) {
    L.push(
      `> ⚠️ Consultas que falharam: ${runnerErrors.map((e) => `${e.ecosystem}: ${e.error}`).join(' · ')} — ` +
        'trate o número de desatualizados como piso, não como total.',
    );
    L.push('');
  }
}

// Bloco curado à mão — o roadmap acima é gerado a partir de deps-latest.json,
// que não sabe o que foi refutado nem o que foi resolvido por outro caminho
// (troca de module path, por exemplo). Quem escrevia a correção manual perdia
// o texto no próximo `sync-progress`, e o TASKS.md voltava a listar como alvo
// aquilo que o README já dava por fechado. O que estiver entre
// <!-- CURATED:BEGIN --> e <!-- CURATED:END --> é copiado do arquivo anterior,
// intocado. Sem os marcadores, o comportamento é idêntico ao de antes.
if (fs.existsSync(tasksPath)) {
  const prevTasks = fs.readFileSync(tasksPath, 'utf8');
  const curated = prevTasks.match(/<!-- CURATED:BEGIN[\s\S]*?<!-- CURATED:END -->/);
  if (curated) {
    L.push(curated[0]);
    L.push('');
  }
}

L.push('## Log de iterações');
L.push('');
let prevLog = [];
if (fs.existsSync(tasksPath)) {
  const prev = fs.readFileSync(tasksPath, 'utf8');
  const m = prev.match(/## Log de iterações\n\n([\s\S]*?)(?=\n## |$)/);
  if (m) prevLog = m[1].trim().split('\n').filter((l) => l.startsWith('- '));
}
if (journal.length) {
  prevLog.unshift(`- **${now}** — ${journal.join(' · ')}${note ? ` — ${note}` : ''}`);
} else if (!prevLog.length) {
  prevLog.push(`- **${now}** — TASKS.md criado a partir de FINDINGS.json`);
}
L.push(...prevLog.slice(0, 60));
L.push('');

if (complete) {
  L.push('## ✅ RODADA FECHADA');
  L.push('');
  L.push(
    `Todos os ${c.total} achados têm desfecho: ${c.resolved} resolvidos · ${c.refuted} refutados · ${c.accepted} aceitos. ` +
      `Nenhum aberto.`,
  );
  L.push('');
}

fs.writeFileSync(tasksPath, L.join('\n'));
console.log(`sync-progress: ${tasksPath} (${pct}% fechado · ${c.resolved}/${c.total} resolvidos)`);
for (const e of labelErrors) console.warn(`  ⚠ rótulo rebaixado — ${e}`);

// ---- HTML -------------------------------------------------------------------
const titleBase =
  cliArg('title') ||
  `Deep Audit — ${meta.app || path.basename(dir)}` +
    `${meta.version ? ` v${meta.version}` : ''}${meta.branch ? ` · ${meta.branch}` : ''}`;
const title = complete
  ? `${titleBase} ✅ FECHADA (${pct}%)`
  : `${titleBase} (${c.open} aberto · ${pct}% fechado)`;

const buildArgs = [
  path.join(__dirname, 'build-report.mjs'),
  '--findings',
  findingsPath,
  '--out',
  htmlPath,
  '--title',
  title,
];
if (fs.existsSync(metaPath)) buildArgs.push('--meta', metaPath);
for (const extra of ['deps-latest.json', 'stack.json']) {
  const p = path.join(dir, extra);
  if (fs.existsSync(p)) buildArgs.push(extra === 'stack.json' ? '--stack' : '--deps', p);
}
const cov = path.join(dir, 'sec-deep', 'coverage.json');
if (fs.existsSync(cov)) buildArgs.push('--coverage', cov);

const r = spawnSync(process.execPath, buildArgs, { encoding: 'utf8' });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) {
  console.error('sync-progress: build-report falhou');
  process.exit(r.status || 1);
}

// ---- banner no REPORT.md ----------------------------------------------------
if (fs.existsSync(reportPath)) {
  let rep = fs.readFileSync(reportPath, 'utf8');
  const banner =
    `> **Progresso:** ${c.resolved} resolvidos · ${c.refuted} refutados · ${c.accepted} aceitos · ` +
    `${c.open} abertos (${pct}% fechado) · atualizado ${now}${complete ? ' · ✅ FECHADA' : ''}\n\n`;
  rep = rep.startsWith('> **Progresso:**')
    ? rep.replace(/^> \*\*Progresso:\*\*[^\n]*\n\n/, banner)
    : rep.replace(/^(#[^\n]*\n\n)/, `$1${banner}`);
  fs.writeFileSync(reportPath, rep);
}

// ---- cópias estáveis --------------------------------------------------------
const publish = cliArg('publish', '');
if (publish) {
  const pub = path.resolve(publish);
  fs.mkdirSync(pub, { recursive: true });
  fs.copyFileSync(htmlPath, path.join(pub, 'deep-audit-report.html'));
  fs.copyFileSync(tasksPath, path.join(pub, 'deep-audit-tasks.md'));
  fs.copyFileSync(findingsPath, path.join(pub, 'deep-audit-findings.json'));
  console.log(`sync-progress: publicado em ${pub}/deep-audit-{report.html,tasks.md,findings.json}`);
}

console.log(
  complete
    ? '✅ Rodada fechada — todo achado tem desfecho.'
    : `Abertos: ${open.map((f) => f.id).join(', ') || '—'}`,
);
if (!meta.version) {
  console.warn(
    'sync-progress: ⚠ run-meta.json sem `version` — rode init-run.mjs (ou passe --version) ' +
      'para o report dizer QUAL versão foi auditada.',
  );
}
if (!depsData) {
  console.warn(
    'sync-progress: ⚠ pack sem deps-latest.json — a pesquisa de libs não aparece no report nem no roadmap. ' +
      'Rode check-deps-latest.mjs e re-sincronize.',
  );
}
console.log(`report.html: ${path.resolve(htmlPath)}`);

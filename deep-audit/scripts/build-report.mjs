#!/usr/bin/env node
/**
 * build-report.mjs — relatório HTML interativo, autocontido (zero CDN).
 *
 *   node build-report.mjs --findings FINDINGS.json --out report.html \
 *     [--title "..."] [--meta run-meta.json] [--deps deps-latest.json] \
 *     [--stack stack.json] [--coverage sec-deep/coverage.json]
 *
 * O relatório separa **refutado** (o defeito não existe) de **aceito** (existe,
 * risco assumido) em KPI, filtro e card — somá-los mentiria sobre a postura de
 * risco do projeto. Todo `aceito` mostra os 4 campos; sem eles o achado nem
 * chega aqui como aceito (lint-findings rebaixa para aberto).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENTS,
  LENSES,
  LENS_LABEL,
  SEVERITIES,
  SEV_COLOR,
  SEV_RANK,
  STATUS_COLOR,
  STATUS_LABEL,
  cliArg,
  counts,
  normalizeLens,
  normalizeSeverity,
  normalizeStatus,
  prioOf,
} from './lib-findings.mjs';

const findingsPath = cliArg('findings');
const outPath = cliArg('out', 'report.html');
const title = cliArg('title', 'Deep Audit — bateria ultra-deep');
if (!findingsPath) {
  console.error('Uso: node build-report.mjs --findings FINDINGS.json --out report.html');
  process.exit(1);
}

function loadJson(p) {
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

let findings = loadJson(findingsPath);
if (!Array.isArray(findings)) findings = findings?.findings ?? [];

const baseDir = path.dirname(path.resolve(findingsPath));
const meta = loadJson(cliArg('meta')) || loadJson(path.join(baseDir, 'run-meta.json'));
const deps = loadJson(cliArg('deps')) || loadJson(path.join(baseDir, 'deps-latest.json'));
const stack =
  loadJson(cliArg('stack')) || loadJson(path.join(baseDir, 'stack.json')) || deps?.stack || null;
const coverage =
  loadJson(cliArg('coverage')) || loadJson(path.join(baseDir, 'sec-deep', 'coverage.json'));

for (const f of findings) {
  f.status = normalizeStatus(f.status);
  f.severity = normalizeSeverity(f.severity);
  f.lens = normalizeLens(f);
  f._prio = prioOf(f);
}
findings.sort(
  (a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || String(a.id).localeCompare(String(b.id)),
);

const c = counts(findings);
const closed = c.resolved + c.refuted + c.accepted;
const pct = c.total ? Math.round((closed / c.total) * 100) : 0;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const j = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');

const generatedAt = new Date().toISOString();

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
:root {
  --bg:#f6f7fb; --panel:#ffffff; --panel2:#eef1f7; --text:#111827; --muted:#5b6478;
  --border:#d8dde8; --accent:#0369a1; --shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0b1220; --panel:#111827; --panel2:#1b2434; --text:#e5e7eb; --muted:#9ca3af;
    --border:#2c3648; --accent:#38bdf8; --shadow:none;
  }
}
:root[data-theme="light"] {
  --bg:#f6f7fb; --panel:#ffffff; --panel2:#eef1f7; --text:#111827; --muted:#5b6478;
  --border:#d8dde8; --accent:#0369a1; --shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.1);
}
:root[data-theme="dark"] {
  --bg:#0b1220; --panel:#111827; --panel2:#1b2434; --text:#e5e7eb; --muted:#9ca3af;
  --border:#2c3648; --accent:#38bdf8; --shadow:none;
}
* { box-sizing:border-box; }
body {
  margin:0; background:var(--bg); color:var(--text); min-height:100vh;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:15px; line-height:1.5;
}
header {
  position:sticky; top:0; z-index:20; padding:1rem 1.5rem; background:var(--panel);
  border-bottom:1px solid var(--border); display:flex; gap:1rem; align-items:flex-start; flex-wrap:wrap;
}
header h1 { margin:0 0 .2rem; font-size:1.25rem; letter-spacing:-.01em; }
header .meta { color:var(--muted); font-size:.8rem; }
header .spacer { flex:1 1 auto; }
.layout { display:grid; grid-template-columns:260px 1fr; gap:0; align-items:start; }
@media (max-width:900px) {
  .layout { grid-template-columns:1fr; }
  aside { position:static !important; border-right:none !important; border-bottom:1px solid var(--border); }
}
aside {
  position:sticky; top:72px; padding:1rem; border-right:1px solid var(--border);
  max-height:calc(100vh - 72px); overflow:auto;
}
main { padding:1rem 1.25rem 4rem; min-width:0; }
label.f { display:block; font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:.9rem 0 .3rem; }
input[type=search], select {
  width:100%; background:var(--panel); color:var(--text); border:1px solid var(--border);
  border-radius:8px; padding:.45rem .6rem; font-size:.85rem;
}
.chips { display:flex; flex-wrap:wrap; gap:.3rem; }
.chip {
  cursor:pointer; font-size:.72rem; padding:.25rem .55rem; border-radius:999px; background:var(--panel);
  border:1px solid var(--border); color:var(--text); display:inline-flex; gap:.35rem; align-items:center;
}
.chip:hover { border-color:var(--accent); }
.chip.on { background:var(--accent); color:var(--bg); border-color:transparent; font-weight:600; }
.chip .n { opacity:.75; font-variant-numeric:tabular-nums; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:.6rem; margin-bottom:1rem; }
.kpi { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:.7rem .8rem; box-shadow:var(--shadow); }
.kpi .n { font-size:1.5rem; font-weight:700; line-height:1.15; font-variant-numeric:tabular-nums; }
.kpi .l { font-size:.68rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.kpi .s { font-size:.7rem; color:var(--muted); margin-top:.15rem; }
.tabs { display:flex; gap:.35rem; flex-wrap:wrap; margin-bottom:1rem; }
.tab { padding:.4rem .85rem; border-radius:999px; border:1px solid var(--border); background:var(--panel); color:var(--muted); cursor:pointer; font-size:.8rem; }
.tab.on { background:var(--accent); color:var(--bg); border-color:transparent; font-weight:600; }
.panel { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:1rem; margin-bottom:1rem; box-shadow:var(--shadow); }
.panel h2 { margin:0 0 .75rem; font-size:1rem; }
.panel h3 { margin:1rem 0 .5rem; font-size:.85rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.bar-row { display:grid; grid-template-columns:130px 1fr 44px; gap:.5rem; align-items:center; margin-bottom:.35rem; font-size:.8rem; }
.bar { height:9px; border-radius:999px; background:var(--panel2); overflow:hidden; }
.bar > span { display:block; height:100%; border-radius:999px; }
.num { text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; }
.finding { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:.85rem 1rem; margin-bottom:.6rem; box-shadow:var(--shadow); }
.finding.blocking { border-left:4px solid #f43f5e; }
.finding .top { display:flex; flex-wrap:wrap; gap:.35rem; align-items:center; }
.finding h3 { margin:.35rem 0 .2rem; font-size:.98rem; }
.badge { font-size:.63rem; font-weight:700; letter-spacing:.03em; padding:.18rem .42rem; border-radius:6px; color:#fff; text-transform:uppercase; }
.badge.soft { background:var(--panel2); color:var(--muted); }
.loc { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.76rem; color:var(--accent); word-break:break-all; }
.body { margin-top:.6rem; display:none; }
.finding.open-card .body { display:block; }
.box { background:var(--panel2); border-radius:8px; padding:.6rem .7rem; font-size:.85rem; margin-top:.5rem; }
.box h4 { margin:0 0 .3rem; font-size:.66rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:.5rem; }
@media (max-width:720px) { .grid2 { grid-template-columns:1fr; } }
.mono { font-family:ui-monospace,Menlo,monospace; font-size:.76rem; white-space:pre-wrap; }
.red { color:#dc2626; } .green { color:#15803d; }
@media (prefers-color-scheme: dark) { .red { color:#fca5a5; } .green { color:#86efac; } }
:root[data-theme="dark"] .red { color:#fca5a5; } :root[data-theme="dark"] .green { color:#86efac; }
:root[data-theme="light"] .red { color:#dc2626; } :root[data-theme="light"] .green { color:#15803d; }
.toolbar { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; margin-bottom:.75rem; }
.btn { background:var(--panel); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:.35rem .7rem; font-size:.78rem; cursor:pointer; }
.btn:hover { border-color:var(--accent); }
.shown { margin-left:auto; color:var(--muted); font-size:.78rem; }
table { width:100%; border-collapse:collapse; font-size:.82rem; }
th, td { border-bottom:1px solid var(--border); padding:.4rem .5rem; text-align:left; vertical-align:top; }
th { font-size:.68rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
.major { color:#d97706; font-weight:700; } .minor { color:var(--accent); font-weight:600; } .patch { color:var(--muted); }
.cmd { font-family:ui-monospace,Menlo,monospace; font-size:.74rem; background:var(--panel2); padding:.3rem .45rem; border-radius:6px; display:block; white-space:pre-wrap; margin-top:.25rem; }
.empty { text-align:center; color:var(--muted); padding:2.5rem; }
.timeline li { margin-bottom:.4rem; font-size:.85rem; }
.roadmap { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:.6rem; }
.phase { background:var(--panel2); border-radius:10px; padding:.7rem .8rem; }
.phase h3 { margin:0 0 .4rem; font-size:.8rem; color:var(--text); text-transform:none; letter-spacing:0; }
.phase .it { font-size:.8rem; padding:.3rem 0; border-bottom:1px solid var(--border); cursor:pointer; }
.phase .it:last-child { border-bottom:none; }
.panel .it { font-size:.8rem; padding:.3rem 0; border-bottom:1px solid var(--border); cursor:pointer; }
.panel .it:last-child { border-bottom:none; }
footer { padding:1rem 1.5rem; color:var(--muted); font-size:.75rem; border-top:1px solid var(--border); }
.warn { border-left:3px solid #d97706; padding-left:.6rem; font-size:.82rem; color:var(--muted); }
</style>
</head>
<body>
<header>
  <div>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta" id="hmeta"></div>
  </div>
  <div class="spacer"></div>
  <button class="btn" id="theme">◐ tema</button>
</header>
<div class="layout">
  <aside>
    <label class="f" for="q">Busca</label>
    <input type="search" id="q" placeholder="id, arquivo, título, evidência…"/>
    <label class="f">Desfecho</label>
    <div class="chips" id="fStatus"></div>
    <label class="f">Severidade</label>
    <div class="chips" id="fSev"></div>
    <label class="f">Lente</label>
    <div class="chips" id="fLens"></div>
    <label class="f">Agente</label>
    <div class="chips" id="fAgent"></div>
    <label class="f">Outros</label>
    <div class="chips" id="fMisc"></div>
  </aside>
  <main>
    <div class="kpis" id="kpis"></div>
    <div class="tabs" id="tabs"></div>
    <div id="view"></div>
  </main>
</div>
<footer>
  Deep Audit ultra-deep · lentes: arquitetura · qualidade · segurança (painel adversarial) · performance ·
  N+1 · race · memory leak · backpressure · testes · dependências · bugs clássicos ·
  <strong>refutado ≠ aceito</strong> · toda correção nasce de um teste que falha antes.
  Gerado em ${escapeHtml(generatedAt)}.
</footer>
<script>
var FINDINGS = ${j(findings)};
var META = ${j(meta)};
var DEPS = ${j(deps)};
var STACK = ${j(stack)};
var COVERAGE = ${j(coverage)};
var AGENTS = ${j(AGENTS)};
var LENSES = ${j(LENSES)};
var LENS_LABEL = ${j(LENS_LABEL)};
var SEVERITIES = ${j(SEVERITIES)};
var SEV_COLOR = ${j(SEV_COLOR)};
var STATUS_COLOR = ${j(STATUS_COLOR)};
var STATUS_LABEL = ${j(STATUS_LABEL)};

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function by(fn) { var m = {}; FINDINGS.forEach(function (f) { var k = fn(f); m[k] = (m[k] || 0) + 1; }); return m; }

var state = { q: '', status: '', sev: '', lens: '', agent: '', misc: '', tab: 'findings' };

/* ---------- tema ---------- */
(function () {
  var saved = null;
  try { saved = localStorage.getItem('da-theme'); } catch (e) {}
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  $('theme').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    if (!cur) {
      cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('da-theme', next); } catch (e) {}
  });
})();

/* ---------- cabeçalho ---------- */
(function () {
  var bits = [];
  if (META) {
    /* identidade do projeto primeiro: quem, qual versão, qual branch.
       Um relatório que não diz isso não é auditável seis meses depois. */
    bits.push('projeto <strong>' + esc(META.app || 'n/a') + '</strong>');
    bits.push('versão <code>' + esc(META.version || 'n/a') + '</code>' +
      (META.version_source ? ' <span style="opacity:.7">(' + esc(META.version_source) + ')</span>' : ''));
    bits.push('branch <code>' + esc(META.branch || 'n/a') + '</code>');
    if (META.mode) bits.push('modo <strong>' + esc(META.mode) + '</strong>');
    if (META.depth) bits.push('profundidade <strong>' + esc(META.depth) + '</strong>');
    if (META.effort && META.effort !== 'n/a') bits.push('esforço <strong>' + esc(META.effort) + '</strong>');
    if (META.base) bits.push('base <code>' + esc(META.base) + '</code>');
    if (META.head) bits.push('head <code>' + esc(META.head) + '</code>');
    if (META.changed_file_count) bits.push(META.changed_file_count + ' arquivos no diff');
  }
  if (STACK && STACK.languages && STACK.languages.length) bits.push('stack: ' + esc(STACK.languages.join(', ')));
  $('hmeta').innerHTML = bits.join(' · ') || 'pack sem run-meta.json';
})();

/* ---------- KPIs ---------- */
function kpis() {
  var t = FINDINGS.length;
  var st = by(function (f) { return f.status; });
  var sev = by(function (f) { return f.severity; });
  var openHigh = FINDINGS.filter(function (f) {
    return f.status === 'open' && (f.severity === 'HIGH' || f.severity === 'CRITICAL');
  }).length;
  var blocking = FINDINGS.filter(function (f) { return f.blocks_pr && f.status === 'open'; }).length;
  var lenses = Object.keys(by(function (f) { return f.lens; })).length;
  var closed = (st.resolved || 0) + (st.refuted || 0) + (st.accepted || 0);
  var pct = t ? Math.round((closed / t) * 100) : 0;
  var cards = [
    ['Achados', t, 'var(--text)', lenses + ' lentes com achado'],
    ['Resolvidos', st.resolved || 0, STATUS_COLOR.resolved, pct + '% fechados (todos os desfechos)'],
    ['Abertos', st.open || 0, STATUS_COLOR.open, 'sem desfecho ainda'],
    ['Refutados', st.refuted || 0, STATUS_COLOR.refuted, 'o defeito NÃO existe'],
    ['Aceitos', st.accepted || 0, STATUS_COLOR.accepted, 'existe · risco assumido'],
    ['HIGH+ abertos', openHigh, openHigh ? SEV_COLOR.HIGH : STATUS_COLOR.resolved, openHigh ? 'bloqueia fechamento' : 'nenhum · ok'],
    ['Bloqueiam PR', blocking, blocking ? '#f43f5e' : 'var(--muted)', 'abertos com blocks_pr'],
    ['CRITICAL', sev.CRITICAL || 0, SEV_COLOR.CRITICAL, 'impacto máximo'],
  ];
  var res = FINDINGS.filter(function (f) { return f.status === 'resolved'; });
  if (res.length) {
    var okRev = res.filter(function (f) { return f.review && !f.review.waived && f.review.verdict === 'approved'; }).length;
    var waived = res.filter(function (f) { return f.review && f.review.waived; }).length;
    var noRev = res.filter(function (f) { return !f.review; }).length;
    cards.push(['Correções revisadas', okRev + '/' + res.length,
      okRev === res.length ? STATUS_COLOR.resolved : SEV_COLOR.MEDIUM,
      'painel Nêmesis · Hígia · Jano' +
        (waived ? ' · ' + waived + ' dispensada(s)' : '') +
        (noRev ? ' · ' + noRev + ' sem revisão' : '')]);
  }
  $('kpis').innerHTML = cards.map(function (k) {
    return '<div class="kpi"><div class="n" style="color:' + k[2] + '">' + k[1] + '</div>' +
      '<div class="l">' + k[0] + '</div><div class="s">' + esc(k[3]) + '</div></div>';
  }).join('');
}

/* ---------- filtros ---------- */
function chip(key, val, label, n, color) {
  var on = state[key] === val ? ' on' : '';
  var dot = color ? '<span style="width:8px;height:8px;border-radius:50%;background:' + color + '"></span>' : '';
  return '<button class="chip' + on + '" data-k="' + key + '" data-v="' + esc(val) + '">' + dot +
    '<span>' + esc(label) + '</span><span class="n">' + n + '</span></button>';
}
function renderFilters() {
  var st = by(function (f) { return f.status; });
  $('fStatus').innerHTML = ['open', 'resolved', 'refuted', 'accepted'].map(function (s) {
    return chip('status', s, STATUS_LABEL[s], st[s] || 0, STATUS_COLOR[s]);
  }).join('');
  var sv = by(function (f) { return f.severity; });
  $('fSev').innerHTML = SEVERITIES.filter(function (s) { return sv[s]; }).map(function (s) {
    return chip('sev', s, s, sv[s], SEV_COLOR[s]);
  }).join('');
  var ln = by(function (f) { return f.lens; });
  $('fLens').innerHTML = LENSES.map(function (l) {
    return chip('lens', l, LENS_LABEL[l] || l, ln[l] || 0, null);
  }).join('');
  var ag = by(function (f) { return f.agent; });
  $('fAgent').innerHTML = Object.keys(ag).sort().map(function (a) {
    var meta = AGENTS[a] || {};
    return chip('agent', a, (meta.emoji || '•') + ' ' + a, ag[a], meta.color);
  }).join('');
  var blocking = FINDINGS.filter(function (f) { return f.blocks_pr && f.status === 'open'; }).length;
  var panel = FINDINGS.filter(function (f) { return f.verification === 'panel'; }).length;
  var p0 = FINDINGS.filter(function (f) { return f._prio === 'P0'; }).length;
  $('fMisc').innerHTML =
    chip('misc', 'blocks', 'bloqueia PR', blocking, '#f43f5e') +
    chip('misc', 'panel', 'painel 3 lentes', panel, STATUS_COLOR.refuted) +
    chip('misc', 'p0', 'P0', p0, SEV_COLOR.CRITICAL);
  document.querySelectorAll('.chip').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.k, v = b.dataset.v;
      state[k] = state[k] === v ? '' : v;
      renderFilters(); render();
    });
  });
}

function filtered() {
  var q = state.q.trim().toLowerCase();
  return FINDINGS.filter(function (f) {
    if (state.status && f.status !== state.status) return false;
    if (state.sev && f.severity !== state.sev) return false;
    if (state.lens && f.lens !== state.lens) return false;
    if (state.agent && f.agent !== state.agent) return false;
    if (state.misc === 'blocks' && !(f.blocks_pr && f.status === 'open')) return false;
    if (state.misc === 'panel' && f.verification !== 'panel') return false;
    if (state.misc === 'p0' && f._prio !== 'P0') return false;
    if (q) {
      var hay = [f.id, f.title, f.path, f.evidence, f.impact, f.fix, f.agent, f.lens, f.category,
        f.classic_pattern, f.language, f.package, f.exploit_scenario, f.failure_scenario,
        f.refuted_by, f.resolved_test, f.accept && f.accept.what]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/* ---------- cards ---------- */
function cardBody(f) {
  var out = '';
  if (f.status === 'refuted') {
    out += '<div class="box"><h4>Problema alegado</h4>' + esc(f.evidence || f.title) + '</div>';
    out += '<div class="box"><h4>Evidência que derruba</h4>' + esc(f.refuted_by || '—') + '</div>';
    return out;
  }
  out += '<div class="box"><h4>Problema</h4>' + esc(f.evidence || f.description || '—') + '</div>';
  if (f.exploit_scenario) out += '<div class="box"><h4>Cenário de exploração</h4>' + esc(f.exploit_scenario) + '</div>';
  if (f.failure_scenario) out += '<div class="box"><h4>Cenário de falha</h4>' + esc(f.failure_scenario) + '</div>';
  if (f.snippet) out += '<div class="box"><h4>Linha do sink</h4><div class="mono">' + esc(f.snippet) + '</div></div>';
  out += '<div class="grid2">' +
    '<div class="box"><h4>Impacto</h4>' + esc(f.impact || '—') + '</div>' +
    '<div class="box"><h4>Correção</h4>' + esc(f.fix || '—') + '</div></div>';
  var tr = f.test_red_green || {};
  out += '<div class="box"><h4>Teste (falha antes · passa depois)</h4>' +
    '<div><strong>' + esc(f.resolved_test || tr.name || 'TBD') + '</strong></div>' +
    '<div class="red">RED: ' + esc(tr.assert_before || '—') + '</div>' +
    '<div class="green">GREEN: ' + esc(tr.assert_after || '—') + '</div>' +
    (f.resolved_note ? '<div style="color:var(--muted);margin-top:.25rem">' + esc(f.resolved_note) + '</div>' : '') +
    '</div>';
  if (f.status === 'accepted') {
    var a = f.accept || {};
    out += '<div class="box"><h4>Aceito — ' + esc(a.type || '?') + '</h4>' +
      '<div><strong>O que se aceita:</strong> ' + esc(a.what || '—') + '</div>' +
      '<div><strong>Consequência se a premissa cair:</strong> ' + esc(a.consequence || '—') + '</div>' +
      '<div><strong>Reabre quando:</strong> ' + esc(a.reopen_if || '—') + '</div>' +
      '<div><strong>Ratificou:</strong> ' + esc(a.ratified_by || '—') + '</div></div>';
  }
  if (f.review) {
    var rv = f.review;
    if (rv.waived) {
      out += '<div class="box warn"><h4>⚠ Revisão de código DISPENSADA</h4>' +
        esc(rv.waived_reason || 'sem motivo registrado') +
        '<div style="margin-top:.25rem">Correção fechada sem o painel de 3 lentes — dívida para a próxima rodada.</div></div>';
    } else {
      var rrows = (rv.votes || []).map(function (v) {
        var c = v.verdict === 'APROVA' ? STATUS_COLOR.resolved : v.verdict === 'BLOQUEIA' ? SEV_COLOR.HIGH : SEV_COLOR.MEDIUM;
        return '<tr><td>' + esc(v.lens) + '</td><td>' + esc(v.agent || '') +
          '</td><td style="color:' + c + '">' + esc(v.verdict) + '</td></tr>';
      }).join('');
      out += '<div class="box"><h4>Revisão da correção — ' + esc(rv.verdict || '?') +
        ' (' + (rv.voters || 0) + '/3)</h4>' +
        (rrows ? '<table><tr><th>lente</th><th>revisor</th><th>voto</th></tr>' + rrows + '</table>' : '') +
        '<div style="font-size:.78rem;color:var(--muted);margin-top:.3rem">' +
        (rv.test_reversal_checked
          ? 'Prova por reversão conferida por um revisor independente.'
          : '<strong>Nenhum revisor confirmou a prova por reversão</strong> — o RED do teste ficou por conta de quem corrigiu.') +
        '</div></div>';
    }
  }
  if (f.panel_detail) {
    var rows = Object.keys(f.panel_detail).map(function (l) {
      var v = f.panel_detail[l] || {};
      return '<tr><td>' + esc(l) + '</td><td>' + esc(v.verdict) + '</td><td>' + esc(v.reasoning || '') + '</td></tr>';
    }).join('');
    out += '<div class="box"><h4>Painel adversarial</h4><table>' +
      '<tr><th>lente</th><th>voto</th><th>razão</th></tr>' + rows + '</table></div>';
  }
  if (f.progress && f.progress.length) {
    out += '<div class="box"><h4>Progresso</h4>' +
      f.progress.map(function (p) { return '<div>· ' + esc(p) + '</div>'; }).join('') + '</div>';
  }
  return out;
}

function card(f) {
  var a = AGENTS[f.agent] || {};
  var badges = [
    '<span class="badge" style="background:' + (SEV_COLOR[f.severity] || '#64748b') + '">' + esc(f.severity) + '</span>',
    '<span class="badge" style="background:' + (STATUS_COLOR[f.status] || '#64748b') + '">' + esc(STATUS_LABEL[f.status]) + '</span>',
    '<span class="badge soft">' + esc(LENS_LABEL[f.lens] || f.lens) + '</span>',
    '<span class="badge" style="background:' + (a.color || '#64748b') + '">' + (a.emoji || '•') + ' ' + esc(f.agent) + '</span>',
    '<span class="badge soft">' + esc(f.confidence || '?') + ' conf</span>',
    '<span class="badge soft">' + esc(f._prio) + '</span>'
  ];
  if (f.blocks_pr && f.status === 'open') badges.push('<span class="badge" style="background:#f43f5e">bloqueia PR</span>');
  if (f.verification === 'panel' && f.panel) {
    badges.push('<span class="badge" style="background:' + STATUS_COLOR.refuted + '">painel ' + f.panel['true'] + '/' + f.panel.voters + '</span>');
  }
  if (f.verification === 'spot-check') badges.push('<span class="badge soft">spot-check</span>');
  if (f.cwe) badges.push('<span class="badge soft">' + esc(f.cwe) + '</span>');
  if (f.classic_pattern) badges.push('<span class="badge soft">' + esc(f.classic_pattern) + '</span>');
  return '<article class="finding' + (f.blocks_pr && f.status === 'open' ? ' blocking' : '') + '" id="f-' + esc(f.id) + '">' +
    '<div class="top">' + badges.join('') + '</div>' +
    '<h3>' + esc(f.id) + ' — ' + esc(f.title) + '</h3>' +
    '<div class="loc">' + esc(f.path || '—') + (f.line != null ? ':' + f.line : '') +
      (f.symbol ? ' · ' + esc(f.symbol) : '') + '</div>' +
    '<div class="body">' + cardBody(f) + '</div>' +
    '</article>';
}

/* ---------- abas ---------- */
function viewFindings() {
  var list = filtered();
  var head = '<div class="toolbar">' +
    '<button class="btn" id="expand">Expandir tudo</button>' +
    '<button class="btn" id="collapse">Colapsar</button>' +
    '<button class="btn" id="export">Exportar filtrado (JSON)</button>' +
    '<span class="shown">' + list.length + ' / ' + FINDINGS.length + ' achados</span></div>';
  if (!list.length) return head + '<div class="empty">Nenhum achado com os filtros atuais.</div>';
  return head + list.map(card).join('');
}

function viewOverview() {
  var sev = by(function (f) { return f.severity; });
  var ln = by(function (f) { return f.lens; });
  var max = Math.max.apply(null, [1].concat(Object.keys(ln).map(function (k) { return ln[k]; })));
  var sevBars = SEVERITIES.map(function (s) {
    var n = sev[s] || 0;
    var w = FINDINGS.length ? Math.round((n / FINDINGS.length) * 100) : 0;
    return '<div class="bar-row"><span>' + s + '</span><span class="bar"><span style="width:' + w + '%;background:' + SEV_COLOR[s] + '"></span></span><span class="num">' + n + '</span></div>';
  }).join('');
  var lensRows = LENSES.map(function (l) {
    var all = FINDINGS.filter(function (f) { return f.lens === l; });
    var n = all.length;
    var open = all.filter(function (f) { return f.status === 'open'; }).length;
    var high = all.filter(function (f) { return f.severity === 'HIGH' || f.severity === 'CRITICAL'; }).length;
    var w = Math.round((n / max) * 100);
    var verdict = n === 0 ? '<em style="color:var(--muted)">sem achado nesta rodada</em>'
      : (open === 0 ? 'todos com desfecho' : open + ' aberto' + (open > 1 ? 's' : '')) + (high ? ' · ' + high + ' HIGH+' : '');
    return '<div class="bar-row"><span>' + esc(LENS_LABEL[l] || l) + '</span><span class="bar"><span style="width:' + w + '%;background:var(--accent)"></span></span><span class="num">' + n + '</span></div>' +
      '<div style="font-size:.75rem;color:var(--muted);margin:-.2rem 0 .5rem 130px">' + verdict + '</div>';
  }).join('');

  var cov = '';
  if (COVERAGE) {
    var okPanel = COVERAGE.panel_source === 'vote-files' && COVERAGE.verification_status !== 'unverified';
    cov = '<div class="panel"><h2>Cobertura do painel de segurança</h2>' +
      '<div class="' + (okPanel ? '' : 'warn') + '">' +
      'status <strong>' + esc(COVERAGE.verification_status) + '</strong> · origem dos votos <strong>' + esc(COVERAGE.panel_source) + '</strong>' +
      (okPanel ? '' : ' — <strong>não trate SEC-* como painel</strong>') + '</div>' +
      '<table style="margin-top:.5rem"><tr><th>candidatos</th><th>sobreviventes</th><th>julgados</th><th>quórum</th><th>derrubados</th></tr>' +
      '<tr><td>' + (COVERAGE.candidates_in || 0) + '</td><td>' + (COVERAGE.candidates_deduped_out || 0) + '</td><td>' +
      (COVERAGE.panel_reviewed_findings || 0) + '</td><td>' + (COVERAGE.quorum || '?') + '/' + (COVERAGE.voters || '?') +
      '</td><td>' + (COVERAGE.panel_dropped || 0) + '</td></tr></table></div>';
  }

  var hist = (META && META.history) || [];
  var timeline = hist.length
    ? '<ul class="timeline">' + hist.map(function (h) {
        return '<li><strong>' + esc(h.at) + '</strong> — ' + esc(h.event || 'rodada') + ' · modo ' + esc(h.mode) +
          ' · profundidade ' + esc(h.depth) + (h.effort && h.effort !== 'n/a' ? ' · esforço ' + esc(h.effort) : '') +
          (h.head ? ' · <code>' + esc(h.head) + '</code>' : '') + '</li>';
      }).join('') + '</ul>'
    : '<div class="empty">Sem histórico registrado.</div>';

  return '<div class="panel"><h2>Distribuição por severidade</h2>' + sevBars + '</div>' +
    '<div class="panel"><h2>Estado por lente</h2>' + lensRows +
    '<p style="font-size:.78rem;color:var(--muted);margin:.5rem 0 0">Lente sem achado não é lente sem risco: confirme se ela teve rodada dedicada.</p></div>' +
    cov +
    '<div class="panel"><h2>Timeline das rodadas</h2>' + timeline + '</div>';
}

/* Atualização de lib é trabalho planejado como qualquer outro achado — se só aparece
   na aba Libs, ninguém agenda. O roadmap carrega os lotes e o que ficou em aberto. */
function depsRoadmap() {
  if (!DEPS) {
    return '<div class="panel warn" style="margin-top:1rem"><h2>Libs / dependências</h2>' +
      'A pesquisa de libs não rodou nesta rodada — não há linha de atualização no roadmap. ' +
      'Rode <code>check-deps-latest.mjs</code> antes de fechar.</div>';
  }
  var s = DEPS.summary || {};
  var batches = actionableBatches();
  var openDeps = FINDINGS.filter(function (f) { return f.lens === 'deps' && f.status === 'open'; });

  var resumo = '<p style="font-size:.82rem;color:var(--muted)">' +
    (s.checked || 0) + ' lib(s) pesquisada(s) · ' + (s.up_to_date || 0) + ' em dia · <strong>' +
    (s.outdated || 0) + '</strong> atrás do latest stable ' +
    '(major ' + ((s.by_bump || {}).major || 0) + ' · minor ' + ((s.by_bump || {}).minor || 0) +
    ' · patch ' + ((s.by_bump || {}).patch || 0) + ') · ' + openDeps.length + ' achado(s) de deps em aberto.' +
    (s.errors ? ' <strong>' + s.errors + ' consulta(s) falharam</strong> — número incompleto.' : '') +
    '</p>';

  var lotes = batches.length
    ? '<table><tr><th>lote</th><th>prioridade</th><th>pacotes</th><th>por quê</th></tr>' +
      batches.map(function (b) {
        return '<tr><td><strong>' + esc(b.title || b.id) + '</strong></td>' +
          '<td>' + esc(b.priority || 'P3') + '</td>' +
          '<td class="mono">' + esc((b.packages || []).map(function (p) { return p.package || p.name || p; }).join(', ') || '—') + '</td>' +
          '<td style="font-size:.8rem">' + esc(b.rationale || '') + '</td></tr>';
      }).join('') + '</table>'
    : '<div class="empty">Nenhum lote de atualização — toda lib pesquisada está no latest stable.</div>';

  var pend = openDeps.length
    ? '<div style="margin-top:.6rem">' + openDeps.map(function (f) {
        return '<div class="it" data-jump="' + esc(f.id) + '"><strong>' + esc(f.id) + '</strong> · ' +
          esc(f._prio || 'P3') + ' · ' + esc(f.title) + '</div>';
      }).join('') + '</div>'
    : '';

  return '<div class="panel" style="margin-top:1rem"><h2>Libs / dependências — plano de atualização</h2>' +
    resumo + lotes + pend +
    '<p style="font-size:.78rem;color:var(--muted);margin-top:.5rem">Detalhe pacote a pacote na aba <strong>Libs / Updates</strong>.</p></div>';
}

function viewRoadmap() {
  var phases = [
    ['P0', 'Imediato — mesma tarefa', 'segurança explorável, perda/corrupção de dado, HIGH confirmado'],
    ['P1', 'Curto prazo — sprint atual', 'HIGH de confiança média, N+1 quente, leak de sessão'],
    ['P2', 'Médio prazo', 'MEDIUM com plano'],
    ['P3', 'Contínuo / backlog', 'LOW, INFO, defesa em profundidade']
  ];
  var html = '<div class="roadmap">' + phases.map(function (p) {
    var items = FINDINGS.filter(function (f) { return f._prio === p[0] && f.status === 'open'; });
    return '<div class="phase"><h3>' + p[0] + ' · ' + esc(p[1]) + ' <span class="num">(' + items.length + ')</span></h3>' +
      '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.35rem">' + esc(p[2]) + '</div>' +
      (items.length ? items.map(function (f) {
        return '<div class="it" data-jump="' + esc(f.id) + '"><strong>' + esc(f.id) + '</strong> · ' + esc(f.agent) + '<br/>' + esc(f.title) + '</div>';
      }).join('') : '<div style="font-size:.8rem;color:var(--muted)">nada aberto</div>') + '</div>';
  }).join('') + '</div>';

  html += depsRoadmap();

  var acc = FINDINGS.filter(function (f) { return f.status === 'accepted'; });
  html += '<div class="panel" style="margin-top:1rem"><h2>Aceitos — entram pelo gatilho de reabertura</h2>' +
    (acc.length ? '<table><tr><th>id</th><th>subtipo</th><th>o que se aceita</th><th>reabre quando</th><th>ratificou</th></tr>' +
      acc.map(function (f) {
        var a = f.accept || {};
        return '<tr><td>' + esc(f.id) + '</td><td>' + esc(a.type) + '</td><td>' + esc(a.what) + '</td><td>' +
          esc(a.reopen_if) + '</td><td>' + esc(a.ratified_by) + '</td></tr>';
      }).join('') + '</table>'
      : '<div class="empty">Nenhum risco aceito nesta rodada.</div>') +
    '<p style="font-size:.78rem;color:var(--muted)">Aceito não é concluído: é risco vivo com gatilho. Refutados ficam fora desta tabela de propósito.</p></div>';

  var ref = FINDINGS.filter(function (f) { return f.status === 'refuted'; });
  html += '<div class="panel"><h2>Refutados — o defeito não existe</h2>' +
    (ref.length ? '<table><tr><th>id</th><th>alegação</th><th>evidência que derruba</th></tr>' +
      ref.map(function (f) {
        return '<tr><td>' + esc(f.id) + '</td><td>' + esc(f.title) + '</td><td>' + esc(f.refuted_by) + '</td></tr>';
      }).join('') + '</table>'
      : '<div class="empty">Nenhum falso positivo registrado.</div>') + '</div>';
  return html;
}

/* Estado de um pacote pesquisado — o inventário mostra TODOS, não só os desatualizados:
   "em dia" é resultado de pesquisa tanto quanto "atrasado", e "não consultado" é o
   que separa uma varredura completa de uma varredura que ficou pela metade. */
function depState(p) {
  if (p.error) return { key: 'error', label: 'erro na consulta', color: SEV_COLOR.HIGH };
  if (p.skipped) return { key: 'skipped', label: 'não consultado', color: 'var(--muted)' };
  if (p.floating_tag) return { key: 'floating', label: 'tag flutuante', color: SEV_COLOR.MEDIUM };
  if (p.outdated) return { key: 'outdated', label: 'desatualizado', color: SEV_COLOR.MEDIUM };
  return { key: 'ok', label: 'em dia', color: STATUS_COLOR.resolved };
}

function depsInventory() {
  var pkgs = (DEPS && DEPS.packages) || [];
  if (!pkgs.length) return '';
  var order = { outdated: 0, floating: 1, error: 2, skipped: 3, ok: 4 };
  var byEco = {};
  pkgs.forEach(function (p) {
    var k = p.ecosystem || 'unknown';
    (byEco[k] = byEco[k] || []).push(p);
  });
  return Object.keys(byEco).sort().map(function (name) {
    var list = byEco[name].slice().sort(function (a, b) {
      var d = (order[depState(a).key] ?? 9) - (order[depState(b).key] ?? 9);
      return d || String(a.name).localeCompare(String(b.name));
    });
    var out = list.filter(function (p) { return p.outdated; }).length;
    return '<div class="panel"><h2>' + esc(name) + ' — inventário completo ' +
      '<span class="num">(' + list.length + ' pesquisados · ' + out + ' atrás do latest stable)</span></h2>' +
      '<table><tr><th>pacote</th><th>atual</th><th>latest stable</th><th>bump</th><th>situação</th><th>manifesto</th></tr>' +
      list.map(function (p) {
        var st = depState(p);
        return '<tr><td>' + esc(p.name) + (p.dev ? ' <span style="color:var(--muted)">(dev)</span>' : '') +
          (p.indirect ? ' <span style="color:var(--muted)">(indireta)</span>' : '') + '</td>' +
          '<td>' + esc(p.current || '—') + '</td>' +
          '<td>' + (p.latest_stable ? '<strong>' + esc(p.latest_stable) + '</strong>' : '—') + '</td>' +
          '<td class="' + esc(p.bump || '') + '">' + esc(p.outdated ? (p.bump || '?') : '—') + '</td>' +
          '<td style="color:' + st.color + '">' + esc(st.label) +
            (p.error ? ' <span style="color:var(--muted)">· ' + esc(p.error) + '</span>' : '') + '</td>' +
          '<td class="mono">' + esc(p.manifest || '') + '</td></tr>';
      }).join('') + '</table></div>';
  }).join('');
}

/* priority "info" é o resumo de stack, já mostrado no painel do topo — não é lote de trabalho. */
function actionableBatches() {
  var um = (DEPS && DEPS.update_map) || {};
  return (um.batches || []).filter(function (b) { return b.priority !== 'info'; });
}

function depsBatchesHtml() {
  return actionableBatches().map(function (b) {
    return '<div class="panel"><h2>' + esc(b.title || b.id || 'lote') +
      (b.priority ? ' <span class="num">(' + esc(b.priority) + ')</span>' : '') + '</h2>' +
      (b.rationale ? '<p style="font-size:.82rem;color:var(--muted)">' + esc(b.rationale) + '</p>' : '') +
      (b.commands || []).map(function (cmd) { return '<code class="cmd">' + esc(cmd) + '</code>'; }).join('') +
      ((b.packages || []).length ? '<p style="font-size:.78rem;color:var(--muted);margin-top:.4rem">' +
        esc((b.packages || []).map(function (p) { return p.package || p.name || p; }).join(', ')) + '</p>' : '') +
      '</div>';
  }).join('');
}

function viewDeps() {
  if (!DEPS) {
    return '<div class="panel warn"><h2>Pesquisa de libs não rodou nesta rodada</h2>' +
      '<p>Sem <code>deps-latest.json</code> no pack. A lente <strong>deps</strong> é obrigatória: ' +
      'rode <code>check-deps-latest.mjs --out $OUT/deps-latest.json --findings $OUT/agent-prisma-freshness.json</code> ' +
      'e regenere o report. Silêncio aqui não é "nenhuma lib atrasada" — é <strong>não perguntamos</strong>.</p></div>';
  }
  var s = DEPS.summary || {};
  var pol = DEPS.policy || {};
  var chipsHtml = '';
  if (DEPS.stack) {
    ['languages', 'frameworks', 'ecosystems'].forEach(function (k) {
      (DEPS.stack[k] || []).forEach(function (v) { chipsHtml += '<span class="chip">' + esc(v) + '</span>'; });
    });
  }

  var kpi = [
    ['Pesquisados', s.checked || 0, 'var(--text)', 'pacotes consultados no registry'],
    ['Em dia', s.up_to_date || 0, STATUS_COLOR.resolved, 'já no latest stable'],
    ['Atrás do latest', s.outdated || 0, (s.outdated ? SEV_COLOR.MEDIUM : 'var(--muted)'),
      'major ' + ((s.by_bump || {}).major || 0) + ' · minor ' + ((s.by_bump || {}).minor || 0) +
      ' · patch ' + ((s.by_bump || {}).patch || 0)],
    ['Falhas de consulta', s.errors || 0, (s.errors ? SEV_COLOR.HIGH : 'var(--muted)'),
      s.errors ? 'offline? o número acima está incompleto' : 'nenhuma — cobertura total'],
  ].map(function (k) {
    return '<div class="kpi"><div class="n" style="color:' + k[2] + '">' + k[1] + '</div>' +
      '<div class="l">' + k[0] + '</div><div class="s">' + esc(k[3]) + '</div></div>';
  }).join('');

  var head = '<div class="kpis">' + kpi + '</div>' +
    '<div class="panel"><h2>Stack detectado e política da pesquisa</h2>' +
    '<div class="chips">' + (chipsHtml || '—') + '</div>' +
    '<p style="font-size:.8rem;color:var(--muted);margin-top:.6rem">' +
    'Latest = <strong>stable</strong>: ' + esc(pol.exclude || 'pré-releases excluídos') + '. ' +
    'Dependências de desenvolvimento: <strong>' + (pol.include_dev ? 'incluídas' : 'fora') + '</strong> · ' +
    'transitivas: <strong>' + (pol.include_indirect ? 'incluídas' : 'fora') + '</strong>.' +
    (DEPS.generated_at ? ' Consultado em ' + esc(DEPS.generated_at) + '.' : '') +
    '</p></div>';

  var errs = (DEPS.runner_errors || []).length
    ? '<div class="panel warn"><h2>Consultas que falharam</h2>' +
      esc(DEPS.runner_errors.map(function (e) { return e.ecosystem + ': ' + e.error; }).join(' · ')) +
      '<p style="font-size:.78rem">Enquanto isso não zerar, trate o número de desatualizados como piso, não como total.</p></div>'
    : '';

  var plan = depsBatchesHtml();
  var planHead = plan
    ? '<div class="panel"><h2>Plano de atualização (entra no Roadmap)</h2>' +
      '<p style="font-size:.8rem;color:var(--muted)">Lotes do tamanho de um PR, na ordem de risco.</p></div>' + plan
    : '<div class="panel"><h2>Plano de atualização</h2><div class="empty">Nada a atualizar — toda lib pesquisada está no latest stable.</div></div>';

  return head + errs + planHead + depsInventory();
}

var TABS = [
  ['findings', 'Achados'],
  ['overview', 'Panorama'],
  ['roadmap', 'Roadmap'],
  ['deps', 'Libs / Updates']
];

function renderTabs() {
  $('tabs').innerHTML = TABS.map(function (t) {
    return '<button class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>';
  }).join('');
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.dataset.t; renderTabs(); render(); });
  });
}

function render() {
  var v = $('view');
  if (state.tab === 'findings') v.innerHTML = viewFindings();
  else if (state.tab === 'overview') v.innerHTML = viewOverview();
  else if (state.tab === 'roadmap') v.innerHTML = viewRoadmap();
  else v.innerHTML = viewDeps();

  v.querySelectorAll('.finding').forEach(function (el) {
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) return;
      el.classList.toggle('open-card');
    });
  });
  v.querySelectorAll('[data-jump]').forEach(function (el) {
    el.addEventListener('click', function () {
      state.tab = 'findings'; state.status = ''; state.sev = ''; state.lens = ''; state.agent = ''; state.misc = '';
      renderTabs(); renderFilters(); render();
      var t = document.getElementById('f-' + el.dataset.jump);
      if (t) { t.classList.add('open-card'); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
  });
  var ex = $('expand'); if (ex) ex.addEventListener('click', function () {
    v.querySelectorAll('.finding').forEach(function (e) { e.classList.add('open-card'); });
  });
  var co = $('collapse'); if (co) co.addEventListener('click', function () {
    v.querySelectorAll('.finding').forEach(function (e) { e.classList.remove('open-card'); });
  });
  var exp = $('export'); if (exp) exp.addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(filtered(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'findings-filtrado.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
}

$('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
document.addEventListener('keydown', function (e) {
  if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
});

kpis(); renderFilters(); renderTabs(); render();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(
  `build-report: ${c.total} achados (${c.open} aberto · ${c.resolved} resolvido · ${c.refuted} refutado · ` +
    `${c.accepted} aceito · ${pct}% fechado) → ${path.resolve(outPath)}`,
);

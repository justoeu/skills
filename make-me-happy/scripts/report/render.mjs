/**
 * HTML renderer for the make-me-happy report. Pure function of the normalized
 * pack (see load-pack.mjs). Output is one self-contained file: inline CSS/JS,
 * inline SVG charts, server-side syntax highlighting. Mermaid is the only
 * network fetch (CDN, lazy); offline it falls back to the raw source.
 */
import { esc, renderMarkdown, inline } from './markdown.mjs';
import { AXES } from './load-pack.mjs';

const TABS = [
  ['overview', 'Visão geral'],
  ['sdd', 'SDD'],
  ['impl', 'Implementação'],
  ['fluxo', 'Fluxo'],
  ['payloads', 'Payloads'],
  ['testes', 'Testes'],
  ['review', 'Review'],
  ['score', 'Score'],
  ['gates', 'Gates do projeto'],
];

const AXIS_LABEL = { standards: 'Standards', spec: 'Spec', correctness: 'Correctness' };
const AXIS_DESC = {
  standards: 'Padrões documentados do repo + catálogo de smells (Fowler).',
  spec: 'Aderência ao SDD: faltou algo, sobrou algo, algo está errado.',
  correctness: 'Comportamento, red→green real, imutabilidade e piso de cobertura.',
};

const GATE_INFO = {
  tasks: {
    label: 'Tasks',
    what: 'Toda task do TASKS.json precisa estar DONE.',
    fail: 'Há task OPEN/IN_PROGRESS: o pack não entregou tudo que o plano prometeu.',
  },
  'red-green': {
    label: 'Red → green',
    what: 'Cada task DONE tem pelo menos um teste novo que falhou antes da mudança e passou depois.',
    fail: 'Alguma task DONE não tem tests_added ≥ 1 ou red_green=true — não há prova de que o teste pega o defeito.',
  },
  immutability: {
    label: 'Imutabilidade',
    what: 'Testes de contrato (payload, invariantes, caminhos vizinhos) travam o que não podia mudar, e estão verdes.',
    fail: 'immutability.json ausente ou green=false: nada prova que o contrato existente ficou parado.',
  },
  review: {
    label: 'Review 3/3',
    what: 'Os três eixos (Standards, Spec, Correctness) votam APPROVE. Spec SKIP só quando o usuário recusou spec.',
    fail: 'Algum eixo está REJECT ou não votou.',
  },
  worktrees: {
    label: 'Worktrees',
    what: 'Toda slice foi mergeada na branch into e a worktree/branch foi removida (verify-clean).',
    fail: 'Slice sem merge ou worktree/branch mmh/slice-* ainda no disco.',
  },
};

// ---------- tiny helpers ----------

const cls = (...xs) => xs.filter(Boolean).join(' ');

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function fmtDuration(ms) {
  if (ms == null) return null;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

const fmtPct = (v) => (v == null ? 'n/a' : `${Math.round(v * 100) / 100}%`);

function tone(status) {
  const s = String(status || '').toUpperCase();
  if (['DONE', 'APPROVE', 'PASS', 'OK', 'CLOSED', 'FIXED', 'GREEN'].includes(s)) return 'ok';
  if (['REJECT', 'FAIL', 'FAILED', 'OPEN', 'BLOCKED', 'RED'].includes(s)) return 'bad';
  if (['IN_PROGRESS', 'SKIP', 'SKIPPED', 'DONE?', 'PENDING', 'WONTFIX'].includes(s)) return 'warn';
  return 'neutral';
}

const chip = (text, t = tone(text), extra = '') => `<span class="chip ${t}"${extra}>${esc(text)}</span>`;

function emptyState(title, { file, agent, hint } = {}) {
  return `<div class="empty" role="note">
    <div class="empty-icon" aria-hidden="true">∅</div>
    <div><strong>${esc(title)}</strong> — não registrado pelo pack.
      ${file ? `<div class="muted">Arquivo esperado: <code>${esc(file)}</code>${agent ? ` · produzido por <code>${esc(agent)}</code>` : ''}</div>` : ''}
      ${hint ? `<div class="muted">${esc(hint)}</div>` : ''}
    </div>
  </div>`;
}

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

export function highlightJson(value) {
  let text;
  if (typeof value === 'string') {
    try {
      text = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return esc(value);
    }
  } else text = JSON.stringify(value, null, 2) ?? 'null';
  return esc(text).replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
    (m, str, colon, bool, n) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (bool) return `<span class="j-bool">${m}</span>`;
      if (n) return `<span class="j-num">${m}</span>`;
      return `<span class="j-null">${m}</span>`;
    },
  );
}

function codeBlock(value, { label, json = true } = {}) {
  const id = nextId('code');
  const body = json ? highlightJson(value) : esc(value);
  return `<div class="codebox">
    <div class="codebox-bar"><span>${esc(label || '')}</span><button type="button" class="copy" data-copy="${id}" aria-label="Copiar ${esc(label || 'conteúdo')}">Copiar</button></div>
    <pre class="code" id="${id}"><code>${body}</code></pre>
  </div>`;
}

function collapsedList(items, { limit = 8, label = 'itens', mono = true } = {}) {
  if (!items.length) return '<span class="muted">—</span>';
  const li = (x) => `<li>${mono ? `<code>${esc(x)}</code>` : esc(x)}</li>`;
  if (items.length <= limit) return `<ul class="taglist">${items.map(li).join('')}</ul>`;
  return `<ul class="taglist">${items.slice(0, limit).map(li).join('')}</ul>
    <details class="more"><summary>mostrar todos os ${items.length} ${esc(label)}</summary><ul class="taglist">${items.slice(limit).map(li).join('')}</ul></details>`;
}

function md(text, opts) {
  return `<div class="prose">${renderMarkdown(text, opts).html}</div>`;
}

// ---------- charts (inline SVG) ----------

export function gauge({ value, max = 100, label, sub, floor = null, size = 132, t }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(max, value));
  const frac = v / max;
  const toneCls = t || (value == null ? 'neutral' : floor != null ? (value >= floor ? 'ok' : 'bad') : frac >= 1 ? 'ok' : frac >= 0.6 ? 'warn' : 'bad');
  let floorMark = '';
  if (floor != null) {
    const a = (floor / max) * 2 * Math.PI - Math.PI / 2;
    const x1 = 60 + (r - 9) * Math.cos(a);
    const y1 = 60 + (r - 9) * Math.sin(a);
    const x2 = 60 + (r + 9) * Math.cos(a);
    const y2 = 60 + (r + 9) * Math.sin(a);
    floorMark = `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="g-floor"/>`;
  }
  const shown = value == null ? 'n/a' : max === 100 ? `${Math.round(value * 10) / 10}%` : `${value}`;
  return `<figure class="gauge ${toneCls}" role="img" aria-label="${esc(label)}: ${esc(shown)}${max !== 100 ? ` de ${max}` : ''}${floor != null ? `, piso ${floor}%` : ''}">
    <svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="60" cy="60" r="${r}" class="g-track"/>
      <circle cx="60" cy="60" r="${r}" class="g-bar" stroke-dasharray="${(c * frac).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 60 60)"/>
      ${floorMark}
      <text x="60" y="${max === 100 ? 66 : 62}" text-anchor="middle" class="g-val">${esc(shown)}</text>
      ${max !== 100 ? `<text x="60" y="80" text-anchor="middle" class="g-max">/ ${max}</text>` : ''}
    </svg>
    <figcaption><strong>${esc(label)}</strong>${sub ? `<span class="muted">${esc(sub)}</span>` : ''}</figcaption>
  </figure>`;
}

export function barChart(rows, { floor = null, max = 100, unit = '%', label = 'gráfico' } = {}) {
  if (!rows.length) return '';
  return `<div class="bars" role="list" aria-label="${esc(label)}">${rows.map((r) => {
    const v = Math.max(0, Math.min(max, r.value));
    const t = r.tone || (floor != null ? (r.value >= floor ? 'ok' : 'bad') : 'accent');
    const val = unit === '%' ? fmtPct(r.value) : `${r.value}${unit}`;
    return `<div class="bar-row" role="listitem">
      <div class="bar-label" title="${esc(r.name)}">${esc(r.name)}${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ''}</div>
      <div class="bar-track" aria-hidden="true">
        <div class="bar-fill ${t}" style="width:${((v / max) * 100).toFixed(2)}%"></div>
        ${floor != null ? `<div class="bar-floor" style="left:${((floor / max) * 100).toFixed(2)}%" title="piso ${floor}%"></div>` : ''}
      </div>
      <div class="bar-val">${esc(val)}</div>
    </div>`;
  }).join('')}</div>`;
}

function stackBar(parts, label) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return `<div class="stack" role="img" aria-label="${esc(label)}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}">${parts
    .filter((p) => p.value > 0)
    .map((p) => `<span class="stack-seg ${p.tone}" style="width:${((p.value / total) * 100).toFixed(2)}%" title="${esc(p.label)}: ${p.value}"></span>`)
    .join('')}</div>`;
}

// ---------- sections ----------

function header(p) {
  const m = p.meta;
  const app = m.app || p.repoRoot?.split('/').pop() || 'app';
  const score = p.score;
  const cov = p.coverage;
  const status = m.status || (score?.closable ? 'closed' : 'in_progress');
  const into = m.into || p.worktrees?.into || null;
  const facts = [
    ['Início', fmtDate(p.times.started_at)],
    ['Fim', fmtDate(p.times.finished_at)],
    ['Duração', fmtDuration(p.times.duration_ms)],
    ['Gerado', fmtDate(p.generatedAt)],
  ].filter(([, v]) => v);
  return `<header class="top">
    <div class="top-row">
      <div class="brand">
        <span class="logo" aria-hidden="true">☺</span>
        <div><div class="eyebrow">make-me-happy</div><h1>${esc(app)}</h1></div>
      </div>
      <div class="top-actions">
        <button type="button" class="theme-btn" id="theme-btn" aria-label="Alternar tema claro/escuro">◐ Tema</button>
      </div>
    </div>
    <div class="badges">
      <span class="badge"><span class="k">branch</span> <code>${esc(m.branch || '—')}</code>${into ? ` <span aria-hidden="true">→</span> <code>${esc(into)}</code>` : ''}</span>
      ${m.kind || p.tasksDoc?.kind ? `<span class="badge"><span class="k">kind</span> ${esc(m.kind || p.tasksDoc.kind)}</span>` : ''}
      ${m.loop ? `<span class="badge"><span class="k">loop</span> ${esc(m.loop)}</span>` : ''}
      <span class="badge ${status === 'closed' ? 'ok' : 'warn'}"><span class="k">status</span> ${esc(status)}</span>
      <span class="badge ${score ? (score.score === 10 ? 'ok' : 'bad') : 'neutral'}"><span class="k">score</span> <strong>${esc(score?.score ?? '—')}</strong>/10</span>
      <span class="badge ${cov.pct == null ? 'neutral' : cov.ok ? 'ok' : 'bad'}"><span class="k">cobertura</span> <strong>${esc(fmtPct(cov.pct))}</strong> <span class="muted">piso ${esc(cov.floor)}%</span></span>
      ${m.head ? `<span class="badge"><span class="k">head</span> <code>${esc(String(m.head).slice(0, 10))}</code></span>` : ''}
    </div>
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
  </header>`;
}

function nav() {
  return `<nav class="tabs" role="tablist" aria-label="Seções do relatório">${TABS.map(([id, label], i) =>
    `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${id}">${esc(label)}</button>`,
  ).join('')}</nav>`;
}

function panel(id, inner, first = false) {
  return `<section class="panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" tabindex="0"${first ? '' : ' hidden'} data-panel="${id}">${inner}</section>`;
}

function openItems(p) {
  const items = [];
  for (const g of p.score?.gates || []) if (!g.ok) items.push({ t: 'bad', text: `Gate ${GATE_INFO[g.id]?.label || g.id} sem ponto: ${g.detail}` });
  if (p.coverage.pct == null) items.push({ t: 'bad', text: 'Cobertura não medida (coverage.json ausente ou sem pct).' });
  else if (!p.coverage.ok) items.push({ t: 'bad', text: `Cobertura ${fmtPct(p.coverage.pct)} abaixo do piso ${p.coverage.floor}%.` });
  const notDone = p.tasks.filter((t) => t.status !== 'DONE');
  if (notDone.length) items.push({ t: 'warn', text: `${notDone.length} task(s) não DONE: ${notDone.slice(0, 5).map((t) => t.id).join(', ')}${notDone.length > 5 ? '…' : ''}` });
  for (const a of AXES) {
    const r = p.reviews[a];
    const open = r.findings.filter((f) => f.status === 'open' && ['critical', 'high', 'medium'].includes(f.severity));
    if (open.length) items.push({ t: 'bad', text: `${AXIS_LABEL[a]}: ${open.length} achado(s) aberto(s) ≥ medium — ${open[0].title}` });
    if (r.verdict === 'REJECT') items.push({ t: 'bad', text: `${AXIS_LABEL[a]} votou REJECT.` });
  }
  for (const g of p.projectGates.gates) if (g.status === 'OPEN' || g.status === 'FAILED') items.push({ t: g.status === 'FAILED' ? 'bad' : 'warn', text: `Gate do projeto ${g.status}: ${g.name}` });
  if (p.meta.blocked_on) items.push({ t: 'warn', text: `Bloqueado em: ${typeof p.meta.blocked_on === 'string' ? p.meta.blocked_on : JSON.stringify(p.meta.blocked_on)}` });
  if (p.meta.next_step && p.meta.status !== 'closed') items.push({ t: 'warn', text: `Próximo passo registrado: ${p.meta.next_step}` });
  return items;
}

function overview(p) {
  const done = p.tasks.filter((t) => t.status === 'DONE').length;
  const testsAdded = p.tasks.reduce((n, t) => n + (t.tests_added || 0), 0);
  const slices = p.worktrees?.slices || [];
  const merged = slices.filter((s) => s.merged).length;
  const kpi = (label, value, sub, t = 'neutral') => `<div class="kpi ${t}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
  const verdicts = AXES.map((a) => `<span class="vchip ${tone(p.reviews[a].verdict || 'PENDING')}" title="${esc(AXIS_LABEL[a])}">${esc(AXIS_LABEL[a][0])}<span class="sr">${esc(AXIS_LABEL[a])}: ${esc(p.reviews[a].verdict || 'sem voto')}</span></span>`).join('');
  const approved = AXES.filter((a) => ['APPROVE', 'SKIP'].includes(p.reviews[a].verdict)).length;
  const kpis = `<div class="kpis">
    ${kpi('Tasks', `${done}<span class="of">/${p.tasks.length}</span>`, p.tasks.length ? stackBar([
      { label: 'DONE', value: done, tone: 'ok' },
      { label: 'em andamento', value: p.tasks.filter((t) => t.status === 'IN_PROGRESS').length, tone: 'warn' },
      { label: 'abertas', value: p.tasks.filter((t) => t.status === 'OPEN' || t.status === 'BLOCKED').length, tone: 'bad' },
    ], 'Tasks por status') : 'sem TASKS.json', p.tasks.length && done === p.tasks.length ? 'ok' : p.tasks.length ? 'warn' : 'neutral')}
    ${kpi('Testes adicionados', String(testsAdded), `${p.tasks.filter((t) => t.red_green).length} task(s) com red→green`)}
    ${kpi('Cobertura', esc(fmtPct(p.coverage.pct)), `piso ${esc(p.coverage.floor)}%${p.coverage.tool ? ` · ${esc(String(p.coverage.tool).slice(0, 40))}` : ''}`, p.coverage.pct == null ? 'neutral' : p.coverage.ok ? 'ok' : 'bad')}
    ${kpi('Review', `${approved}<span class="of">/3</span>`, `<span class="vchips">${verdicts}</span>`, approved === 3 ? 'ok' : AXES.some((a) => p.reviews[a].verdict === 'REJECT') ? 'bad' : 'neutral')}
    ${kpi('Worktrees', p.worktrees?.skipped ? 'N=1' : `${merged}<span class="of">/${slices.length}</span>`, p.worktrees?.skipped ? esc(p.worktrees.reason || 'sem worktree') : `mergeadas${slices.length ? ` · ${slices.filter((s) => s.removed).length} removidas` : ''}`, p.worktrees?.skipped || (slices.length && merged === slices.length) ? 'ok' : slices.length ? 'warn' : 'neutral')}
    ${kpi('Imutabilidade', p.immutability ? String(p.immutability.names.length) : '—', p.immutability ? (p.immutability.green ? 'testes de contrato verdes' : 'NÃO verde') : 'immutability.json ausente', p.immutability?.green ? 'ok' : p.immutability ? 'bad' : 'neutral')}
  </div>`;

  const timeline = `<ol class="timeline" aria-label="Passos do pack">${p.steps.map((s) => `<li class="step ${tone(s.status === 'done' ? 'DONE' : s.status === 'failed' ? 'FAIL' : s.status === 'pending' ? '' : 'IN_PROGRESS')}${s.current ? ' current' : ''}">
      <span class="dot" aria-hidden="true"></span>
      <div class="step-body">
        <div class="step-name">${esc(s.label)}</div>
        <div class="step-meta">${esc(s.status)}${s.inferred ? ' <span class="muted" title="Sem timestamp em run-meta.steps; inferido pelos arquivos do pack">· inferido</span>' : ''}${s.current ? ' · <strong>próximo</strong>' : ''}</div>
        ${s.started_at ? `<div class="step-time">${esc(fmtDate(s.started_at))}${s.finished_at ? ` → ${esc(fmtDate(s.finished_at).slice(11))}` : ''}</div>` : ''}
        ${s.note ? `<div class="step-time">${esc(s.note)}</div>` : ''}
      </div>
    </li>`).join('')}</ol>`;

  const items = openItems(p);
  const risks = items.length
    ? `<ul class="risks">${items.slice(0, 10).map((i) => `<li class="${i.t}">${esc(i.text)}</li>`).join('')}</ul>${items.length > 10 ? `<p class="muted">+${items.length - 10} item(ns)</p>` : ''}`
    : '<p class="okline">Nenhum item aberto: gates pagos, cobertura no piso, nada pendente registrado.</p>';

  const notes = [p.meta.scope, p.meta.note, p.meta.notes, p.meta.delivery_note].filter((x) => typeof x === 'string' && x.trim());
  const warnings = p.warnings.length
    ? `<details class="card warnbox"><summary><strong>${p.warnings.length} aviso(s) de schema do pack</strong> <span class="muted">— dados fora do formato de references/pack-schemas.md</span></summary>
        <ul class="plain">${p.warnings.map((w) => `<li><code>${esc(w.file)}</code> ${esc(w.msg)}</li>`).join('')}</ul></details>`
    : '';

  return `${kpis}
    <div class="grid-2">
      <div class="card"><h2>Linha do tempo</h2>${timeline}</div>
      <div class="card"><h2>Riscos e itens abertos</h2>${risks}
        ${notes.length ? `<h3>Notas do run</h3>${notes.map((n) => `<p class="muted">${inline(n)}</p>`).join('')}` : ''}
      </div>
    </div>
    ${warnings}`;
}

function sdd(p) {
  const s = p.spec;
  const meta = `<div class="spec-meta">
    ${s.path ? `<span class="badge"><span class="k">spec</span> <code>${esc(s.path)}</code></span>` : ''}
    ${s.status ? `<span class="badge ${s.status === 'confirmed' ? 'ok' : 'warn'}"><span class="k">status</span> ${esc(s.status)}</span>` : ''}
    ${s.section ? `<span class="badge"><span class="k">seção</span> ${esc(s.section)}</span>` : ''}
  </div>`;
  const docs = [];
  if (s.summary) docs.push({ id: 'summary', title: 'Resumo do spec (spec-summary.md)', text: s.summary });
  if (s.full) docs.push({ id: 'full', title: `Spec completo (${s.path})`, text: s.full });
  else if (s.draft) docs.push({ id: 'draft', title: 'Rascunho da Etapa Zero (spec-draft.md)', text: s.draft });
  if (!docs.length) {
    return `<div class="card"><h2>SDD</h2>${meta}${emptyState('Spec', { file: 'spec-summary.md', agent: 'planner / explorer', hint: s.fullError || 'O planner escreve spec-summary.md; a Etapa Zero escreve spec-draft.md e o SDD no repo.' })}</div>`;
  }
  const rendered = docs.map((d) => ({ ...d, r: renderMarkdown(d.text, { idPrefix: `sdd-${d.id}-` }) }));
  const toc = rendered.flatMap((d) => [{ level: 0, id: `sdd-doc-${d.id}`, text: d.title }, ...d.r.toc.filter((h) => h.level <= 3)]);
  return `<div class="card"><h2>SDD</h2>${meta}${s.fullError ? `<p class="muted">${esc(s.fullError)}</p>` : ''}</div>
    <div class="doc-layout">
      <aside class="toc card" aria-label="Sumário do SDD"><div class="toc-title">Sumário</div><ul>${toc.slice(0, 120).map((h) => `<li class="lvl-${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ul></aside>
      <div class="doc-main">${rendered.map((d) => `<article class="card"><h2 id="sdd-doc-${d.id}" class="doc-title">${esc(d.title)}</h2><div class="prose">${d.r.html}</div></article>`).join('')}</div>
    </div>`;
}

function evidenceBlock(label, e, t) {
  if (!e) return '';
  return `<div class="evi ${t}">
    <div class="evi-head">${chip(label, t)}${e.test ? ` <code>${esc(e.test)}</code>` : ''}${e.file ? ` <span class="muted">${esc(e.file)}</span>` : ''}</div>
    ${e.command ? `<div class="muted small">$ <code>${esc(e.command)}</code></div>` : ''}
    ${e.output ? `<pre class="code small"><code>${esc(e.output)}</code></pre>` : ''}
    ${e.text ? `<p class="small">${inline(e.text)}</p>` : ''}
  </div>`;
}

function taskCard(t) {
  const search = [t.id, t.title, t.status, t.description, ...t.files, ...t.refs, t.red?.test || ''].join(' ').toLowerCase();
  const hasRed = Boolean(t.red && (t.red.test || t.red.output || t.red.text));
  return `<details class="task" data-status="${esc(t.status)}" data-wt="${esc(t.worktree ?? '')}" data-search="${esc(search)}">
    <summary>
      <code class="tid">${esc(t.id)}</code>
      <span class="ttitle">${esc(t.title)}</span>
      <span class="tmeta">
        ${chip(t.status)}
        <span class="mini" title="testes adicionados">🧪 ${esc(t.tests_added)}</span>
        <span class="mini ${t.red_green ? 'ok' : 'bad'}" title="red→green">${t.red_green ? 'R→G ✓' : 'R→G ✗'}</span>
        ${t.immutability ? '<span class="mini ok" title="coberta por teste de imutabilidade">imut ✓</span>' : ''}
        ${t.files.length ? `<span class="mini" title="arquivos">${t.files.length} arq.</span>` : ''}
        ${t.commits.length ? `<span class="mini" title="commits">${t.commits.length} commit</span>` : ''}
      </span>
    </summary>
    <div class="task-body">
      ${t.description ? md(t.description) : ''}
      ${t.refs.length ? `<div class="kv"><span class="k">Refs</span> ${t.refs.map((r) => `<code>${esc(r)}</code>`).join(' ')}</div>` : ''}
      ${t.depends_on.length ? `<div class="kv"><span class="k">Depende de</span> ${t.depends_on.map((r) => `<code>${esc(r)}</code>`).join(' ')}</div>` : ''}
      <div class="evi-grid">
        ${hasRed ? evidenceBlock('RED', t.red, 'bad') : `<div class="evi neutral">${chip('RED', 'neutral')} <span class="muted small">sem evidência estruturada (TASKS.json → red{test, output_excerpt})</span></div>`}
        ${t.green ? evidenceBlock('GREEN', t.green, 'ok') : ''}
        ${t.reversal ? `<div class="evi ${t.reversal.done ? 'ok' : 'warn'}">${chip('REVERSÃO', t.reversal.done ? 'ok' : 'warn')} ${t.reversal.text ? `<span class="small">${inline(t.reversal.text)}</span>` : ''}${t.reversal.output ? `<pre class="code small"><code>${esc(t.reversal.output)}</code></pre>` : ''}</div>` : ''}
        ${t.evidenceText ? `<div class="evi neutral">${chip('EVIDÊNCIA', 'neutral')} <span class="small">${inline(t.evidenceText)}</span></div>` : ''}
      </div>
      ${t.tests.length ? `<div class="kv"><span class="k">Testes</span></div>${collapsedList(t.tests, { label: 'testes' })}` : ''}
      ${t.acceptance.length ? `<div class="kv"><span class="k">Aceite</span></div><ul class="plain">${t.acceptance.map((a) => `<li>${inline(a)}</li>`).join('')}</ul>` : ''}
      ${t.files.length ? `<div class="kv"><span class="k">Arquivos</span></div>${collapsedList(t.files, { label: 'arquivos', limit: 10 })}` : ''}
      ${t.commits.length ? `<div class="kv"><span class="k">Commits</span></div><ul class="plain">${t.commits.map((c) => `<li><code>${esc(c.sha.slice(0, 10))}</code> ${esc(c.message || '')}</li>`).join('')}</ul>` : ''}
      ${t.notes ? `<div class="kv"><span class="k">Notas</span></div>${md(t.notes)}` : ''}
    </div>
  </details>`;
}

function impl(p) {
  if (!p.tasks.length) return `<div class="card"><h2>Implementação</h2>${emptyState('Tasks', { file: 'TASKS.json', agent: 'planner', hint: 'Sem TASKS.json não há o que listar. O planner escreve após o spec confirmado.' })}</div>`;
  const groups = new Map();
  for (const t of p.tasks) {
    const k = t.worktree == null ? '—' : String(t.worktree);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const slices = new Map((p.worktrees?.slices || []).map((s) => [String(s.index), s]));
  const statuses = [...new Set(p.tasks.map((t) => t.status))];
  const wtRows = [...groups.entries()].map(([k, ts]) => ({ name: `worktree ${k}`, value: ts.reduce((n, t) => n + t.tests_added, 0), sub: `${ts.filter((t) => t.status === 'DONE').length}/${ts.length} DONE` }));
  const maxTests = Math.max(1, ...wtRows.map((r) => r.value));
  return `<div class="card">
      <h2>Implementação <span class="muted">· ${p.tasks.length} tasks</span></h2>
      <div class="filters" role="search">
        <label class="sr" for="task-q">Buscar tasks</label>
        <input id="task-q" type="search" placeholder="Buscar por id, título, arquivo, finding…" autocomplete="off"/>
        <label class="sr" for="task-status">Status</label>
        <select id="task-status"><option value="">todos os status</option>${statuses.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
        <label class="sr" for="task-wt">Worktree</label>
        <select id="task-wt"><option value="">todas as worktrees</option>${[...groups.keys()].map((k) => `<option value="${esc(k === '—' ? '' : k)}">worktree ${esc(k)}</option>`).join('')}</select>
        <button type="button" class="ghost" id="task-expand">Expandir tudo</button>
        <span class="muted" id="task-count" aria-live="polite"></span>
      </div>
      <h3>Testes adicionados por worktree</h3>
      ${barChart(wtRows, { max: maxTests, unit: '', label: 'Testes adicionados por worktree' })}
    </div>
    ${[...groups.entries()].map(([k, ts]) => {
      const s = slices.get(k);
      return `<section class="wt-group" data-group="${esc(k)}">
        <h3 class="wt-title">Worktree ${esc(k)} ${s ? `<code>${esc(s.branch || '')}</code> ${chip(s.merged ? 'merged' : 'não mergeada', s.merged ? 'ok' : 'bad')} ${chip(s.removed ? 'removida' : 'no disco', s.removed ? 'ok' : 'warn')}` : ''}
          <span class="muted">${ts.filter((t) => t.status === 'DONE').length}/${ts.length} DONE · ${ts.reduce((n, t) => n + t.tests_added, 0)} testes</span></h3>
        ${ts.map(taskCard).join('')}
      </section>`;
    }).join('')}
    <p class="muted" id="task-none" hidden>Nenhuma task corresponde ao filtro.</p>`;
}

function mermaidBox(source, title) {
  const id = nextId('mmd');
  return `<figure class="mmd card" data-mermaid="${id}">
    <figcaption class="mmd-bar"><strong>${esc(title)}</strong>
      <span class="mmd-tools">
        <button type="button" class="ghost" data-zoom="in" aria-label="Aumentar zoom">+</button>
        <button type="button" class="ghost" data-zoom="out" aria-label="Diminuir zoom">−</button>
        <button type="button" class="ghost" data-zoom="reset" aria-label="Zoom original">100%</button>
        <button type="button" class="ghost" data-full aria-label="Tela cheia">⛶</button>
      </span>
    </figcaption>
    <div class="mmd-stage" tabindex="0" aria-label="Diagrama ${esc(title)} (arraste para mover)"><div class="mmd-canvas" id="${id}"><p class="muted">Renderizando diagrama…</p></div></div>
    <details class="mmd-src"><summary>Ver fonte mermaid</summary><pre class="code"><code id="${id}-src">${esc(source)}</code></pre></details>
  </figure>`;
}

function fluxo(p) {
  const blocks = [];
  if (p.flow && p.flow.trim()) blocks.push(mermaidBox(p.flow, 'Fluxo da feature (flow.mmd)'));
  for (const d of p.diagrams) blocks.push(mermaidBox(d.source, `Diagrama ${d.name}`));
  if (!blocks.length) return `<div class="card"><h2>Fluxo</h2>${emptyState('Diagrama de fluxo', { file: 'flow.mmd', agent: 'planner', hint: 'Diagramas por task vão em diagrams/<T-xxx>.mmd (sequenceDiagram).' })}</div>`;
  return `<p class="muted note">O mermaid é carregado do CDN ao abrir esta aba; offline, o diagrama mostra a fonte.</p>${blocks.join('')}
    ${!p.diagrams.length ? `<div class="card">${emptyState('Diagramas por task', { file: 'diagrams/<T-xxx>.mmd', agent: 'planner (opcional)' })}</div>` : ''}`;
}

function methodChip(m) {
  return m ? `<span class="method m-${esc(m.toLowerCase())}">${esc(m)}</span>` : '';
}

function payloads(p) {
  const pl = p.payloads;
  if (!pl.present) return `<div class="card"><h2>Payloads</h2>${emptyState('Payloads', { file: 'payloads.json', agent: 'planner', hint: 'Exemplos de request/response que o spec define. [] quando o spec não define contrato.' })}</div>`;
  const ctx = pl.context.length
    ? `<div class="card"><h3>Contexto</h3>${pl.context.map((c) => `<div class="kv"><span class="k">${esc(c.key)}</span></div>${Array.isArray(c.value) && c.value.every((x) => typeof x === 'string') ? `<ul class="plain">${c.value.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : typeof c.value === 'string' ? `<p>${inline(c.value)}</p>` : codeBlock(c.value, { label: c.key })}`).join('')}</div>`
    : '';
  if (!pl.items.length) return `<div class="card"><h2>Payloads</h2>${emptyState('Payloads (lista vazia)', { file: 'payloads.json', agent: 'planner', hint: 'O planner gravou []: o spec não define request/response.' })}</div>${ctx}`;
  const groups = new Map();
  for (const it of pl.items) {
    const k = it.path ? `${it.method || ''} ${it.path}`.trim() : it.kind ? `(${it.kind})` : '(sem rota)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return `<div class="card"><h2>Payloads <span class="muted">· ${pl.items.length} exemplo(s) em ${groups.size} grupo(s)</span></h2>
      ${!pl.canonical ? '<p class="muted small">payloads.json fora do schema canônico — campos mapeados por adaptação; o que não foi reconhecido aparece em "outros campos".</p>' : ''}</div>
    ${ctx}
    ${[...groups.entries()].map(([k, items]) => `<section class="pgroup"><h3 class="pg-title">${items[0].path ? `${methodChip(items[0].method)} <code>${esc(items[0].path)}</code>` : esc(k)}</h3>
      ${items.map((it, i) => `<details class="payload"${i === 0 ? ' open' : ''}>
        <summary><strong>${esc(it.name)}</strong> ${it.responses.map((r) => (r.status != null ? chip(String(r.status), Number(r.status) < 400 ? 'ok' : 'bad') : '')).join(' ')} ${it.refs.map((r) => `<code class="ref">${esc(r)}</code>`).join(' ')}</summary>
        <div class="payload-body">
          ${it.notes.length ? `<ul class="plain notes">${it.notes.map((n) => `<li>${inline(n)}</li>`).join('')}</ul>` : ''}
          <div class="grid-2">
            <div>${it.request != null ? codeBlock(it.request, { label: 'request' }) : '<div class="muted small">sem request</div>'}</div>
            <div>${it.responses.length ? it.responses.map((r) => codeBlock(r.body, { label: `response${r.status != null ? ` ${r.status}` : ''}${r.note ? ` · ${r.note}` : ''}` })).join('') : '<div class="muted small">sem response</div>'}</div>
          </div>
          ${it.extra ? `<details class="more"><summary>outros campos (${Object.keys(it.extra).length})</summary>${codeBlock(it.extra, { label: 'outros campos' })}</details>` : ''}
        </div>
      </details>`).join('')}
    </section>`).join('')}`;
}

function testes(p) {
  const t = p.tests;
  const cov = p.coverage;
  const summaryCard = t.present
    ? `<div class="card"><h2>Suíte de testes</h2>
        <div class="kpis small">
          <div class="kpi ${t.ok === false ? 'bad' : t.ok ? 'ok' : 'neutral'}"><div class="kpi-label">Resultado</div><div class="kpi-value">${t.ok === false ? 'FAIL' : t.ok ? 'PASS' : 'n/a'}</div></div>
          <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value">${esc(t.total ?? '—')}</div></div>
          <div class="kpi ok"><div class="kpi-label">Passaram</div><div class="kpi-value">${esc(t.passed ?? '—')}</div></div>
          <div class="kpi ${t.failed ? 'bad' : ''}"><div class="kpi-label">Falharam</div><div class="kpi-value">${esc(t.failed ?? '—')}</div></div>
          <div class="kpi"><div class="kpi-label">Pulados</div><div class="kpi-value">${esc(t.skipped ?? '—')}</div></div>
          <div class="kpi"><div class="kpi-label">Duração</div><div class="kpi-value">${t.duration_s != null ? `${esc(t.duration_s)}s` : '—'}</div></div>
        </div>
        ${t.cmd ? `<p class="small">$ <code>${esc(t.cmd)}</code></p>` : ''}
        ${t.suites.length ? barChart(t.suites.map((s) => ({ name: s.name, value: s.passed || 0, sub: s.failed ? `${s.failed} falha(s)` : '', tone: s.failed ? 'bad' : 'ok' })), { max: Math.max(1, ...t.suites.map((s) => (s.passed || 0) + (s.failed || 0))), unit: '', label: 'Testes por suíte' }) : ''}
        ${t.log ? `<details class="more"><summary>log</summary><pre class="code small"><code>${esc(t.log)}</code></pre></details>` : ''}
      </div>`
    : `<div class="card"><h2>Suíte de testes</h2>${emptyState('Resumo da suíte', { file: 'tests.json', agent: 'Oracle (após o merge final)', hint: '{cmd, ok, total, passed, failed, skipped, duration_s, suites[]}' })}
        ${t.cmd ? `<p class="small">Comando registrado: <code>${esc(t.cmd)}</code></p>` : ''}${t.log ? `<p class="small">${inline(t.log)}</p>` : ''}</div>`;

  let covCard;
  if (cov.pct == null && !cov.present) covCard = `<div class="card"><h2>Cobertura</h2>${emptyState('Cobertura', { file: 'coverage.json', agent: 'implementer / Oracle', hint: 'Sem pct o pack não fecha.' })}</div>`;
  else {
    const rows = cov.breakdown.map((r) => ({ name: r.name, value: r.pct, sub: r.covered != null && r.total != null ? `${r.covered}/${r.total}` : r.group && r.group !== r.name ? r.group : '' }));
    covCard = `<div class="card"><h2>Cobertura</h2>
      <div class="cov-head">
        ${gauge({ value: cov.pct, label: 'Cobertura', sub: `piso ${cov.floor}%`, floor: cov.floor })}
        <div class="cov-info">
          ${cov.tool ? `<div class="kv"><span class="k">Ferramenta</span> ${esc(cov.tool)}</div>` : ''}
          ${cov.report ? `<div class="kv"><span class="k">Relatório</span> <code>${esc(cov.report)}</code></div>` : ''}
          ${cov.measured_at ? `<div class="kv"><span class="k">Medido em</span> ${esc(cov.measured_at)}</div>` : ''}
          ${cov.scope.map((s) => `<p class="small muted">${inline(s)}</p>`).join('')}
          ${cov.history ? `<p class="small muted">${inline(cov.history)}</p>` : ''}
        </div>
      </div>
      ${rows.length ? `<h3>Por módulo / métrica</h3>${barChart(rows, { floor: cov.floor, label: 'Cobertura por módulo' })}` : '<p class="muted small">coverage.json sem detalhamento por módulo (modules[] / files[]).</p>'}
    </div>`;
  }

  const taskRows = p.tasks.length
    ? `<div class="card"><h2>Evidência red → green por task</h2>
        <div class="table-wrap"><table class="evtable">
          <thead><tr><th scope="col">Task</th><th scope="col">RED (teste que falhou)</th><th scope="col">GREEN</th><th scope="col">Reversão</th><th scope="col">Testes</th></tr></thead>
          <tbody>${p.tasks.map((x) => `<tr>
            <th scope="row"><code>${esc(x.id)}</code></th>
            <td>${x.red ? `${x.red.test ? `<code>${esc(x.red.test)}</code>` : ''}${x.red.output ? `<details class="more"><summary>saída</summary><pre class="code small"><code>${esc(x.red.output)}</code></pre></details>` : ''}${x.red.text ? `<div class="small muted">${inline(x.red.text.slice(0, 400))}</div>` : ''}` : '<span class="muted">não registrado</span>'}</td>
            <td>${x.green ? `${chip('GREEN', 'ok')}${x.green.output ? `<details class="more"><summary>saída</summary><pre class="code small"><code>${esc(x.green.output)}</code></pre></details>` : ''}${x.green.text ? `<div class="small muted">${inline(x.green.text)}</div>` : ''}` : x.red_green ? `${chip('red_green=true', 'ok')}` : chip('não', 'bad')}${x.evidenceText ? `<div class="small muted">${inline(x.evidenceText)}</div>` : ''}</td>
            <td>${x.reversal ? chip(x.reversal.done ? 'provada' : 'não viável', x.reversal.done ? 'ok' : 'warn') : '<span class="muted">—</span>'}</td>
            <td>${esc(x.tests_added)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${p.tasks.every((x) => !x.green && !x.reversal) ? '<p class="muted small">Pack antigo: GREEN e reversão não foram gravados por task (o implementer agora grava red/green/reversal em TASKS.json).</p>' : ''}
      </div>`
    : '';

  const im = p.immutability;
  const imCard = im
    ? `<div class="card"><h2>Imutabilidade ${chip(im.green ? 'verde' : 'NÃO verde', im.green ? 'ok' : 'bad')}</h2>
        <p class="muted small">${esc(im.names.length)} teste(s) de contrato${im.tasks_covered.length ? ` · cobre ${esc(im.tasks_covered.length)} task(s)` : ''}${im.command ? ` · <code>${esc(im.command)}</code>` : ''}</p>
        ${collapsedList(im.names, { label: 'testes de imutabilidade', limit: 10 })}
        ${im.notes.map((n) => `<details class="more"><summary>${esc(n.key)}</summary>${typeof n.value === 'string' ? md(n.value) : Array.isArray(n.value) && n.value.every((x) => typeof x === 'string') ? `<ul class="plain">${n.value.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : codeBlock(n.value, { label: n.key })}</details>`).join('')}
      </div>`
    : `<div class="card"><h2>Imutabilidade</h2>${emptyState('Testes de imutabilidade', { file: 'immutability.json', agent: 'immutability' })}</div>`;

  return `<div class="grid-2">${summaryCard}${covCard}</div>${taskRows}${imCard}`;
}

function findingItem(f) {
  return `<li class="finding sev-${esc(f.severity)}">
    <div class="f-head">${chip(f.severity, f.severity === 'critical' || f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : 'neutral')} ${chip(f.status, f.status === 'fixed' ? 'ok' : f.status === 'open' ? 'bad' : 'warn')} <strong>${esc(f.title)}</strong></div>
    ${f.file ? `<div class="small"><code>${esc(f.file)}${f.line != null ? `:${esc(f.line)}` : ''}</code>${f.rule ? ` · ${esc(f.rule)}` : ''}${f.kind ? ` · ${esc(f.kind)}` : ''}</div>` : ''}
    ${f.description ? `<div class="small">${inline(f.description)}</div>` : ''}
    ${f.fix ? `<div class="small muted">fix: ${inline(String(f.fix))}${f.fixed_in_round ? ` (rodada ${esc(f.fixed_in_round)})` : ''}</div>` : ''}
  </li>`;
}

function review(p) {
  const cols = AXES.map((a) => {
    const r = p.reviews[a];
    const counts = ['critical', 'high', 'medium', 'low', 'info'].map((s) => [s, r.findings.filter((f) => f.severity === s).length]).filter(([, n]) => n);
    const body = !r.present
      ? emptyState(`Review ${AXIS_LABEL[a]}`, { file: `reviews/${a}.json`, agent: `${a}-reviewer` })
      : `${r.rounds.length ? `<ol class="rounds" aria-label="Histórico de rodadas">${r.rounds.map((x) => `<li>${chip(`R${x.round}`, 'neutral')} ${chip(x.verdict || '?')} ${x.findings.length ? `<span class="muted small">${x.findings.length} achado(s)</span>` : ''}${x.summary ? ` <span class="small">${inline(x.summary)}</span>` : ''}</li>`).join('<li class="arrow" aria-hidden="true">→</li>')}</ol>` : ''}
        ${r.summary ? `<p>${inline(r.summary)}</p>` : ''}
        ${r.findings.length ? `<ul class="findings">${r.findings.map(findingItem).join('')}</ul>` : r.structured ? '<p class="okline small">Sem achados.</p>' : ''}
        ${r.md ? `<details class="more"${r.structured ? '' : ' open'}><summary>Review completo (markdown)</summary>${md(r.md, { headingOffset: 2, idPrefix: `rv-${a}-` })}</details>` : ''}`;
    return `<article class="card axis ${tone(r.verdict || 'PENDING')}">
      <header class="axis-head"><h2>${esc(AXIS_LABEL[a])}</h2>${chip(r.verdict || 'sem voto')}${r.round ? chip(`rodada ${r.round}`, 'neutral') : ''}</header>
      <p class="muted small">${esc(AXIS_DESC[a])}</p>
      ${counts.length ? `<div class="sevbar">${counts.map(([s, n]) => `<span class="chip ${s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'neutral'}">${n} ${esc(s)}</span>`).join(' ')}</div>` : ''}
      ${body}
    </article>`;
  });
  const legacy = AXES.some((a) => p.reviews[a].present && !p.reviews[a].structured);
  return `${legacy ? '<p class="muted note">Pack antigo: os revisores gravaram só markdown, então severidade/arquivo/status por achado não existem como dado. O review completo está expandido em cada eixo.</p>' : ''}
    <div class="axes">${cols.join('')}</div>`;
}

function score(p) {
  const s = p.score;
  if (!s) return `<div class="card"><h2>Score</h2>${emptyState('Score', { file: 'score.json', agent: 'scripts/score.mjs' })}</div>`;
  const cov = p.coverage;
  const head = `<div class="card score-head">
    ${gauge({ value: s.score, max: 10, label: 'Score', sub: s.closable ? 'pack pode fechar' : 'pack não fecha', t: s.score === 10 ? 'ok' : s.score >= 6 ? 'warn' : 'bad', size: 150 })}
    ${gauge({ value: cov.pct, label: 'Cobertura', sub: `piso ${cov.floor}%`, floor: cov.floor, size: 150 })}
    <div class="score-text">
      <h2>${s.closable ? 'Fecha: score 10 e cobertura no piso' : 'Não fecha'}</h2>
      <p class="muted">Cada gate vale 0 ou 2. O pack só fecha com 10 <em>e</em> cobertura ≥ piso (${esc(cov.floor)}%). Score 10 fecha o pack da skill — não substitui os gates do projeto (aba "Gates do projeto").</p>
      ${cov.pct != null ? `<p class="small">Cobertura: ${esc(fmtPct(cov.pct))} ${cov.ok ? '≥' : '<'} ${esc(cov.floor)}%</p>` : '<p class="small bad-text">Cobertura não medida.</p>'}
    </div>
  </div>`;
  const imNames = p.immutability?.names || [];
  const cards = (s.gates || []).map((g) => {
    const info = GATE_INFO[g.id] || { label: g.id, what: '', fail: '' };
    let items = Array.isArray(g.items) ? g.items : g.id === 'immutability' ? imNames : [];
    let detail = String(g.detail ?? '');
    if (!items.length && detail.length > 160 && detail.includes(', ')) items = detail.split(/,\s+/);
    if (items.length && detail.length > 160) detail = `${items.length} item(ns)`;
    return `<article class="card gate ${g.ok ? 'ok' : 'bad'}">
      <header class="gate-head"><h3>${esc(info.label)}</h3><span class="pts" aria-label="${g.ok ? 2 : 0} de 2 pontos">${g.ok ? 2 : 0}<span class="of">/2</span></span></header>
      <p class="small">${esc(info.what)}</p>
      <p class="small ${g.ok ? 'muted' : 'bad-text'}">${g.ok ? '✓ ' : '✗ '}${esc(detail)}</p>
      ${!g.ok && info.fail ? `<p class="small muted">${esc(info.fail)}</p>` : ''}
      ${items.length ? collapsedList(items, { limit: 3, label: 'itens' }) : ''}
    </article>`;
  });
  return `${head}<div class="gates">${cards.join('')}</div>`;
}

function gates(p) {
  const pg = p.projectGates;
  const intro = '<p class="muted">Passo 8: o que o repositório exige além dos 3 eixos do pack (CLAUDE.md / AGENTS.md / CONTRIBUTING.md). Não entra no score 10.</p>';
  if (!pg.gates.length) {
    return `<div class="card"><h2>Gates do projeto</h2>${intro}${emptyState('Gates do projeto', { file: 'project-gates.json', agent: 'Oracle (passo 8)', hint: '[{name, source, status: DONE|OPEN|FAILED|N/A, evidence}]' })}${pg.note ? `<p class="small">${esc(pg.note)}</p>` : ''}</div>`;
  }
  const done = pg.gates.filter((g) => g.status === 'DONE').length;
  return `<div class="card"><h2>Gates do projeto <span class="muted">· ${done}/${pg.gates.length} DONE</span></h2>${intro}
      ${pg.inferred ? '<p class="muted small">Sem project-gates.json: lista inferida dos reviews extras em reviews/. Status "DONE?" = review sem veredito reconhecível.</p>' : ''}
      ${pg.note ? `<p class="small">${inline(pg.note)}</p>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Gate</th><th scope="col">Status</th><th scope="col">Fonte</th><th scope="col">Evidência</th></tr></thead>
        <tbody>${pg.gates.map((g) => `<tr><th scope="row">${esc(g.name)}</th><td>${chip(g.status)}</td><td>${g.source ? `<code>${esc(g.source)}</code>` : '—'}</td><td class="small">${g.evidence ? inline(String(g.evidence)) : '—'}${g.command ? `<div><code>${esc(g.command)}</code></div>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    ${p.extraReviews.map((r) => `<details class="card"><summary><strong>${esc(r.title)}</strong> ${r.verdict ? chip(r.verdict) : ''} <code class="muted">${esc(r.file)}</code></summary>${md(r.md, { headingOffset: 2, idPrefix: `xr-${r.name}-` })}</details>`).join('')}`;
}

// ---------- page ----------

const CSS = `
:root{--bg:#f6f7f9;--panel:#fff;--panel-2:#f1f3f6;--text:#14171c;--muted:#5d6672;--border:#dfe3e8;--accent:#2563eb;--accent-soft:#e0e9ff;
--ok:#15803d;--ok-soft:#dcfce7;--bad:#b91c1c;--bad-soft:#fee2e2;--warn:#a16207;--warn-soft:#fef3c7;--neutral-soft:#eef1f4;
--code-bg:#f4f6f8;--j-key:#7c3aed;--j-str:#047857;--j-num:#b45309;--j-bool:#be185d;--j-null:#6b7280;--shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0d1117;--panel:#151b23;--panel-2:#1b222c;--text:#e6edf3;--muted:#9aa5b1;--border:#2b3440;--accent:#6ea8fe;--accent-soft:#1d2b45;
--ok:#4ade80;--ok-soft:#12301f;--bad:#f87171;--bad-soft:#3a1717;--warn:#fbbf24;--warn-soft:#3a2d0c;--neutral-soft:#1f2630;--code-bg:#0f141b;--j-key:#c4b5fd;--j-str:#6ee7b7;--j-num:#fcd34d;--j-bool:#f9a8d4;--j-null:#9ca3af;--shadow:none;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0d1117;--panel:#151b23;--panel-2:#1b222c;--text:#e6edf3;--muted:#9aa5b1;--border:#2b3440;--accent:#6ea8fe;--accent-soft:#1d2b45;
--ok:#4ade80;--ok-soft:#12301f;--bad:#f87171;--bad-soft:#3a1717;--warn:#fbbf24;--warn-soft:#3a2d0c;--neutral-soft:#1f2630;--code-bg:#0f141b;--j-key:#c4b5fd;--j-str:#6ee7b7;--j-num:#fcd34d;--j-bool:#f9a8d4;--j-null:#9ca3af;--shadow:none;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
code{background:var(--code-bg);border:1px solid var(--border);border-radius:5px;padding:.05em .35em}
pre code{background:none;border:0;padding:0}
a{color:var(--accent)}h1,h2,h3,h4{line-height:1.25;margin:.2em 0 .5em}h2{font-size:1.15rem}h3{font-size:1rem}
.wrap{max-width:1240px;margin:0 auto;padding:0 16px 64px}
.top{padding:20px 0 12px}.top-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.brand{display:flex;gap:12px;align-items:center}.logo{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--accent-soft);color:var(--accent);font-size:24px}
.eyebrow{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}h1{font-size:1.5rem;margin:0}
.badges,.spec-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--panel);border-radius:999px;padding:4px 10px;font-size:.85rem;max-width:100%}
.badge .k{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
.badge.ok{border-color:var(--ok);background:var(--ok-soft)}.badge.bad{border-color:var(--bad);background:var(--bad-soft)}.badge.warn{border-color:var(--warn);background:var(--warn-soft)}
.facts{display:flex;flex-wrap:wrap;gap:20px;margin:12px 0 0}.facts div{min-width:0}.facts dt{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.facts dd{margin:0;font-weight:600}
.tabs{position:sticky;top:0;z-index:5;display:flex;gap:4px;overflow-x:auto;scrollbar-width:thin;background:var(--bg);border-bottom:1px solid var(--border);padding:8px 0;margin-bottom:16px}
.tabs button{flex:0 0 auto;background:none;border:1px solid transparent;color:var(--muted);padding:7px 12px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}
.tabs button:hover{color:var(--text);background:var(--panel-2)}.tabs button[aria-selected="true"]{color:var(--accent);background:var(--accent-soft);border-color:var(--accent)}
button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.panel:focus{outline:none}
.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin:0 0 14px;box-shadow:var(--shadow);min-width:0}
details.card>summary{cursor:pointer}
.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.grid-2>.card{margin:0}.grid-2{margin-bottom:14px}
.muted{color:var(--muted)}.small{font-size:.85rem}.note{margin:0 0 12px}.okline{color:var(--ok);font-weight:600}.bad-text{color:var(--bad)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.chip{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.75rem;font-weight:700;letter-spacing:.02em;border:1px solid transparent;white-space:nowrap}
.chip.ok{background:var(--ok-soft);color:var(--ok);border-color:var(--ok)}.chip.bad{background:var(--bad-soft);color:var(--bad);border-color:var(--bad)}
.chip.warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn)}.chip.neutral{background:var(--neutral-soft);color:var(--muted);border-color:var(--border)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}
.kpi{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:12px;padding:12px 14px;min-width:0}
.kpi.ok{border-left-color:var(--ok)}.kpi.bad{border-left-color:var(--bad)}.kpi.warn{border-left-color:var(--warn)}
.kpi-label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.kpi-value{font-size:1.7rem;font-weight:800;line-height:1.2}.kpi-value .of{font-size:1rem;color:var(--muted);font-weight:600}
.kpi-sub{font-size:.8rem;color:var(--muted);margin-top:4px}.kpis.small .kpi-value{font-size:1.25rem}
.stack{display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--neutral-soft);margin-top:4px}.stack-seg.ok{background:var(--ok)}.stack-seg.warn{background:var(--warn)}.stack-seg.bad{background:var(--bad)}
.vchips{display:inline-flex;gap:4px}.vchip{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;font-weight:800;font-size:.8rem;border:1px solid var(--border);background:var(--neutral-soft);color:var(--muted)}
.vchip.ok{background:var(--ok-soft);color:var(--ok);border-color:var(--ok)}.vchip.bad{background:var(--bad-soft);color:var(--bad);border-color:var(--bad)}.vchip.warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn)}
.timeline{list-style:none;margin:0;padding:0}.step{display:flex;gap:12px;position:relative;padding:0 0 14px}
.step:not(:last-child)::before{content:"";position:absolute;left:7px;top:18px;bottom:0;width:2px;background:var(--border)}
.dot{flex:0 0 16px;height:16px;border-radius:50%;border:2px solid var(--border);background:var(--panel);margin-top:3px;z-index:1}
.step.ok .dot{background:var(--ok);border-color:var(--ok)}.step.bad .dot{background:var(--bad);border-color:var(--bad)}.step.warn .dot{background:var(--warn);border-color:var(--warn)}
.step.current .dot{box-shadow:0 0 0 4px var(--accent-soft);border-color:var(--accent)}
.step-name{font-weight:700}.step-meta,.step-time{font-size:.8rem;color:var(--muted)}
.risks{list-style:none;padding:0;margin:0}.risks li{padding:8px 10px;border-radius:8px;margin-bottom:6px;border-left:4px solid var(--border);background:var(--panel-2);font-size:.9rem}
.risks li.bad{border-left-color:var(--bad)}.risks li.warn{border-left-color:var(--warn)}
.warnbox summary{cursor:pointer}.plain{margin:.3em 0;padding-left:1.2em}.plain li{margin:.15em 0}
.empty{display:flex;gap:12px;align-items:flex-start;border:1px dashed var(--border);border-radius:12px;padding:14px;background:var(--panel-2)}
.empty-icon{font-size:1.4rem;color:var(--muted);line-height:1}
.doc-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:14px;align-items:start}
.toc{position:sticky;top:64px;max-height:calc(100vh - 80px);overflow:auto;font-size:.85rem}.toc ul{list-style:none;padding:0;margin:0}.toc li{margin:2px 0}
.toc a{color:var(--muted);text-decoration:none;display:block;padding:2px 6px;border-radius:6px}.toc a:hover{color:var(--text);background:var(--panel-2)}
.toc .lvl-0{font-weight:700;margin-top:8px}.toc .lvl-0 a{color:var(--text)}.toc .lvl-2{padding-left:10px}.toc .lvl-3{padding-left:20px}.toc-title{font-weight:800;margin-bottom:6px}
.prose{min-width:0}.prose h1{font-size:1.3rem}.prose h2{font-size:1.15rem;margin-top:1.2em;padding-top:.4em;border-top:1px solid var(--border)}.prose h3{font-size:1rem;margin-top:1em}
.prose table{border-collapse:collapse;width:100%;font-size:.88rem}.prose th,.prose td,.table-wrap th,.table-wrap td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
.prose th,.table-wrap thead th{background:var(--panel-2)}.prose blockquote{margin:.6em 0;padding:.2em 1em;border-left:3px solid var(--accent);background:var(--panel-2);border-radius:0 8px 8px 0}
.prose hr{border:0;border-top:1px solid var(--border)}.check{display:inline-block;width:.9em;height:.9em;border:1.5px solid var(--muted);border-radius:3px;margin-right:6px;vertical-align:-1px}.check.on{background:var(--ok);border-color:var(--ok)}
.table-wrap{overflow-x:auto;max-width:100%}.table-wrap table{border-collapse:collapse;width:100%;font-size:.88rem}
pre.code{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin:.4em 0;white-space:pre-wrap;word-break:break-word;max-height:520px;overflow:auto}
pre.code.small{font-size:.78rem;max-height:260px}
.j-key{color:var(--j-key)}.j-str{color:var(--j-str)}.j-num{color:var(--j-num)}.j-bool{color:var(--j-bool)}.j-null{color:var(--j-null)}
.codebox{margin:.4em 0}.codebox-bar{display:flex;justify-content:space-between;align-items:center;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.copy,.ghost,.theme-btn{font:inherit;font-size:.8rem;border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:7px;padding:3px 9px;cursor:pointer}
.copy:hover,.ghost:hover,.theme-btn:hover{border-color:var(--accent);color:var(--accent)}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.filters input,.filters select{font:inherit;font-size:.9rem;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);min-width:0}
.filters input{flex:1 1 260px}
.wt-group{margin:0 0 18px}.wt-title{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 8px}
details.task{background:var(--panel);border:1px solid var(--border);border-radius:12px;margin:0 0 8px}
details.task>summary{list-style:none;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 14px;cursor:pointer}
details.task>summary::-webkit-details-marker{display:none}details.task>summary::before{content:"▸";color:var(--muted);transition:transform .15s}details.task[open]>summary::before{transform:rotate(90deg)}
.tid{font-weight:700}.ttitle{flex:1 1 260px;font-weight:600;min-width:0}.tmeta{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.mini{font-size:.75rem;border:1px solid var(--border);border-radius:6px;padding:0 6px;color:var(--muted)}.mini.ok{color:var(--ok);border-color:var(--ok)}.mini.bad{color:var(--bad);border-color:var(--bad)}
.task-body{padding:0 16px 14px;border-top:1px solid var(--border)}.kv{margin:.6em 0 .2em;font-size:.88rem}.kv .k{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-right:6px}
.evi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin:.6em 0}
.evi{border:1px solid var(--border);border-left:4px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--panel-2);min-width:0}
.evi.ok{border-left-color:var(--ok)}.evi.bad{border-left-color:var(--bad)}.evi.warn{border-left-color:var(--warn)}
.taglist{list-style:none;padding:0;margin:.3em 0;display:flex;flex-wrap:wrap;gap:6px}.taglist li{max-width:100%}
details.more{margin:.4em 0}details.more>summary{cursor:pointer;color:var(--accent);font-size:.85rem}
.bars{display:grid;gap:6px;margin:.5em 0}.bar-row{display:grid;grid-template-columns:minmax(90px,30%) minmax(0,1fr) 64px;gap:10px;align-items:center;font-size:.85rem}
.bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{position:relative;height:12px;border-radius:99px;background:var(--neutral-soft)}
.bar-fill{height:100%;border-radius:99px;background:var(--accent)}.bar-fill.ok{background:var(--ok)}.bar-fill.bad{background:var(--bad)}.bar-fill.warn{background:var(--warn)}
.bar-floor{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--text);opacity:.6}.bar-val{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.gauge{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.gauge figcaption{display:flex;flex-direction:column;font-size:.85rem}
.g-track{fill:none;stroke:var(--neutral-soft);stroke-width:12}.g-bar{fill:none;stroke:var(--accent);stroke-width:12;stroke-linecap:round}
.gauge.ok .g-bar{stroke:var(--ok)}.gauge.bad .g-bar{stroke:var(--bad)}.gauge.warn .g-bar{stroke:var(--warn)}.gauge.neutral .g-bar{stroke:var(--muted)}
.g-floor{stroke:var(--text);stroke-width:3;stroke-linecap:round}.g-val{font-size:22px;font-weight:800;fill:var(--text)}.g-max{font-size:12px;fill:var(--muted)}
.cov-head{display:flex;flex-wrap:wrap;gap:18px;align-items:center}.cov-info{flex:1 1 240px;min-width:0}
.evtable td,.evtable th{font-size:.84rem}
.mmd{padding:0;overflow:hidden}.mmd-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--border)}
.mmd-tools{display:flex;gap:4px}.mmd-stage{overflow:hidden;cursor:grab;min-height:220px;max-height:75vh;background:var(--panel-2);touch-action:none}
.mmd-stage.dragging{cursor:grabbing}.mmd-canvas{transform-origin:0 0;padding:16px;display:inline-block;min-width:100%}.mmd-canvas svg{max-width:none;height:auto}
.mmd-src{padding:0 14px 10px}.mmd-src>summary{cursor:pointer;color:var(--accent);font-size:.85rem;padding-top:8px}
.mmd.full{position:fixed;inset:12px;z-index:50;display:flex;flex-direction:column}.mmd.full .mmd-stage{flex:1;max-height:none}
.method{display:inline-block;font-weight:800;font-size:.72rem;border-radius:6px;padding:2px 7px;background:var(--neutral-soft);color:var(--muted)}
.m-get{background:var(--ok-soft);color:var(--ok)}.m-post{background:var(--accent-soft);color:var(--accent)}.m-put,.m-patch{background:var(--warn-soft);color:var(--warn)}.m-delete{background:var(--bad-soft);color:var(--bad)}
.pgroup{margin:0 0 16px}.pg-title{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
details.payload{background:var(--panel);border:1px solid var(--border);border-radius:12px;margin:0 0 8px}details.payload>summary{padding:10px 14px;cursor:pointer;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.payload-body{padding:0 14px 12px}.payload-body .grid-2{margin:0}.ref{font-size:.75rem}
.axes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}.axes .card{margin:0}
.axis{border-top:4px solid var(--border)}.axis.ok{border-top-color:var(--ok)}.axis.bad{border-top-color:var(--bad)}.axis.warn{border-top-color:var(--warn)}
.axis-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.axis-head h2{margin:0;margin-right:auto}
.sevbar{display:flex;gap:4px;flex-wrap:wrap;margin:.3em 0 .6em}
.rounds{list-style:none;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0;margin:.3em 0 .6em}.rounds .arrow{color:var(--muted)}
.findings{list-style:none;padding:0;margin:0}.finding{border:1px solid var(--border);border-left:4px solid var(--border);border-radius:8px;padding:8px 10px;margin:0 0 6px}
.finding.sev-critical,.finding.sev-high{border-left-color:var(--bad)}.finding.sev-medium{border-left-color:var(--warn)}.f-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.score-head{display:flex;flex-wrap:wrap;gap:24px;align-items:center}.score-text{flex:1 1 280px;min-width:0}
.gates{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.gates .card{margin:0}
.gate{border-top:4px solid var(--border)}.gate.ok{border-top-color:var(--ok)}.gate.bad{border-top-color:var(--bad)}
.gate-head{display:flex;justify-content:space-between;align-items:baseline}.gate-head h3{margin:0}.pts{font-size:1.6rem;font-weight:800}.pts .of{font-size:.9rem;color:var(--muted)}
.gate.ok .pts{color:var(--ok)}.gate.bad .pts{color:var(--bad)}
footer.foot{color:var(--muted);font-size:.8rem;margin-top:28px;border-top:1px solid var(--border);padding-top:12px}
@media (max-width:980px){.axes{grid-template-columns:minmax(0,1fr)}.doc-layout{grid-template-columns:minmax(0,1fr)}.toc{position:static;max-height:300px}}
@media (max-width:720px){.grid-2{grid-template-columns:minmax(0,1fr)}.bar-row{grid-template-columns:minmax(0,1fr) 56px}.bar-label{grid-column:1/-1;white-space:normal}.kpi-value{font-size:1.4rem}}
@media print{.tabs,.filters,.copy,.mmd-tools,.theme-btn{display:none}.panel[hidden]{display:block!important}}
`;

const JS = `
(function(){
  var root=document.documentElement;
  try{var saved=localStorage.getItem('mmh-theme');if(saved)root.setAttribute('data-theme',saved);}catch(e){}
  var tbtn=document.getElementById('theme-btn');
  if(tbtn)tbtn.addEventListener('click',function(){
    var cur=root.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    var next=cur==='dark'?'light':'dark';root.setAttribute('data-theme',next);
    try{localStorage.setItem('mmh-theme',next);}catch(e){}
    document.querySelectorAll('[data-mermaid]').forEach(function(f){f.removeAttribute('data-done');});
    var open=document.querySelector('.panel:not([hidden])');if(open&&open.dataset.panel==='fluxo')renderMermaid();
  });
  var tabs=[].slice.call(document.querySelectorAll('[role=tab]'));
  function show(id,focus){
    var found=false;
    tabs.forEach(function(t){var on=t.dataset.tab===id;if(on)found=true;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;
      var p=document.getElementById('panel-'+t.dataset.tab);if(p)p.hidden=!on;if(on&&focus)t.focus();});
    if(!found)return show(tabs[0].dataset.tab,focus);
    if(history.replaceState)history.replaceState(null,'','#'+id);
    if(id==='fluxo')renderMermaid();
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){show(t.dataset.tab);});
    t.addEventListener('keydown',function(e){
      var k=e.key,j=null;
      if(k==='ArrowRight')j=(i+1)%tabs.length;else if(k==='ArrowLeft')j=(i-1+tabs.length)%tabs.length;
      else if(k==='Home')j=0;else if(k==='End')j=tabs.length-1;
      if(j!==null){e.preventDefault();show(tabs[j].dataset.tab,true);}
    });
  });
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href^="#"]');
    if(!a)return;var id=a.getAttribute('href').slice(1);var el=document.getElementById(id);
    if(!el)return;var p=el.closest('.panel');if(p&&p.hidden)show(p.dataset.panel);
    e.preventDefault();el.scrollIntoView({behavior:'smooth',block:'start'});
  });
  var initial=(location.hash||'').slice(1);
  if(initial&&document.getElementById('panel-'+initial))show(initial);
  window.addEventListener('hashchange',function(){var h=(location.hash||'').slice(1);if(document.getElementById('panel-'+h))show(h);});
  // copy
  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('[data-copy]');if(!b)return;
    var el=document.getElementById(b.getAttribute('data-copy'));if(!el)return;
    var txt=el.textContent;
    function done(ok){var o=b.textContent;b.textContent=ok?'Copiado ✓':'Falhou';setTimeout(function(){b.textContent=o;},1400);}
    if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(txt).then(function(){done(true);},function(){fallback();});}else fallback();
    function fallback(){var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
      var ok=false;try{ok=document.execCommand('copy');}catch(x){}document.body.removeChild(ta);done(ok);}
  });
  // task filters
  var q=document.getElementById('task-q'),fs=document.getElementById('task-status'),fw=document.getElementById('task-wt');
  function filter(){
    var term=(q&&q.value||'').toLowerCase().trim(),st=fs&&fs.value||'',wt=fw&&fw.value||'',n=0,total=0;
    document.querySelectorAll('details.task').forEach(function(d){total++;
      var ok=(!term||d.dataset.search.indexOf(term)>=0)&&(!st||d.dataset.status===st)&&(!wt||d.dataset.wt===wt);
      d.hidden=!ok;if(ok)n++;});
    document.querySelectorAll('.wt-group').forEach(function(g){g.hidden=!g.querySelector('details.task:not([hidden])');});
    var c=document.getElementById('task-count');if(c)c.textContent=n+' de '+total;
    var none=document.getElementById('task-none');if(none)none.hidden=n>0;
  }
  [q,fs,fw].forEach(function(x){if(x)x.addEventListener('input',filter);});filter();
  var ex=document.getElementById('task-expand');
  if(ex)ex.addEventListener('click',function(){var open=ex.dataset.open!=='1';
    document.querySelectorAll('details.task:not([hidden])').forEach(function(d){d.open=open;});ex.dataset.open=open?'1':'0';ex.textContent=open?'Recolher tudo':'Expandir tudo';});
  // mermaid
  var mermaidP=null;
  function loadMermaid(){
    if(mermaidP)return mermaidP;
    mermaidP=new Promise(function(res,rej){
      var t=setTimeout(function(){rej(new Error('timeout'));},8000);
      import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(function(m){clearTimeout(t);res(m.default);},function(e){clearTimeout(t);rej(e);});
    });
    return mermaidP;
  }
  function fallback(canvas,src,msg){
    canvas.innerHTML='';var p=document.createElement('p');p.className='muted small';p.textContent=msg;canvas.appendChild(p);
    var pre=document.createElement('pre');pre.className='code';pre.textContent=src;canvas.appendChild(pre);
  }
  function renderMermaid(){
    var figs=[].slice.call(document.querySelectorAll('[data-mermaid]:not([data-done])'));if(!figs.length)return;
    var dark=(root.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'))==='dark';
    loadMermaid().then(function(mermaid){
      mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:dark?'dark':'default',flowchart:{useMaxWidth:false}});
      figs.forEach(function(f,i){
        var id=f.getAttribute('data-mermaid');var canvas=document.getElementById(id);var src=document.getElementById(id+'-src').textContent;
        f.setAttribute('data-done','1');
        mermaid.render(id+'-svg-'+Date.now()+i,src).then(function(r){canvas.innerHTML=r.svg;setupZoom(f);},function(err){
          fallback(canvas,src,'O mermaid não conseguiu desenhar este diagrama ('+(err&&err.message?err.message.split('\\n')[0]:'erro')+'). Fonte:');});
      });
    },function(){figs.forEach(function(f){var id=f.getAttribute('data-mermaid');f.setAttribute('data-done','1');
      fallback(document.getElementById(id),document.getElementById(id+'-src').textContent,'Sem acesso ao CDN do mermaid (offline?). Fonte do diagrama:');});});
  }
  function setupZoom(f){
    if(f.dataset.zoomReady)return;f.dataset.zoomReady='1';
    var stage=f.querySelector('.mmd-stage'),canvas=f.querySelector('.mmd-canvas'),s=1,x=0,y=0,drag=null;
    function apply(){canvas.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';}
    f.querySelectorAll('[data-zoom]').forEach(function(b){b.addEventListener('click',function(){
      var z=b.getAttribute('data-zoom');if(z==='in')s=Math.min(4,s*1.25);else if(z==='out')s=Math.max(.2,s/1.25);else{s=1;x=0;y=0;}apply();});});
    var full=f.querySelector('[data-full]');if(full)full.addEventListener('click',function(){f.classList.toggle('full');});
    stage.addEventListener('wheel',function(e){if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();s=Math.max(.2,Math.min(4,s*(e.deltaY<0?1.1:1/1.1)));apply();},{passive:false});
    stage.addEventListener('pointerdown',function(e){drag={x:e.clientX-x,y:e.clientY-y};stage.classList.add('dragging');stage.setPointerCapture(e.pointerId);});
    stage.addEventListener('pointermove',function(e){if(!drag)return;x=e.clientX-drag.x;y=e.clientY-drag.y;apply();});
    stage.addEventListener('pointerup',function(){drag=null;stage.classList.remove('dragging');});
    stage.addEventListener('keydown',function(e){var d=40;if(e.key==='ArrowLeft')x+=d;else if(e.key==='ArrowRight')x-=d;else if(e.key==='ArrowUp')y+=d;else if(e.key==='ArrowDown')y-=d;
      else if(e.key==='+'||e.key==='=')s=Math.min(4,s*1.25);else if(e.key==='-')s=Math.max(.2,s/1.25);else if(e.key==='0'){s=1;x=0;y=0;}else return;e.preventDefault();apply();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')f.classList.remove('full');});
  }
})();
`;

export function renderReport(p) {
  uid = 0;
  const app = p.meta.app || p.repoRoot?.split('/').pop() || 'app';
  const panels = {
    overview: overview(p),
    sdd: sdd(p),
    impl: impl(p),
    fluxo: fluxo(p),
    payloads: payloads(p),
    testes: testes(p),
    review: review(p),
    score: score(p),
    gates: gates(p),
  };
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<title>${esc(app)} · make-me-happy</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
${header(p)}
${nav()}
<main>
${TABS.map(([id], i) => panel(id, panels[id], i === 0)).join('\n')}
</main>
<footer class="foot">Gerado por <code>make-me-happy/scripts/build-report.mjs</code> a partir de <code>${esc(p.dir)}</code> · ${esc(p.files.length)} arquivo(s) no pack · schemas em <code>references/pack-schemas.md</code></footer>
</div>
<script>${JS}</script>
</body>
</html>
`;
}

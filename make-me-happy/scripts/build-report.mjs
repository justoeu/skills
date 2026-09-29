#!/usr/bin/env node
/**
 * Interactive HTML closeout for make-me-happy.
 *
 *   node build-report.mjs --dir docs/impl/make-me-happy/<run>
 */
import fs from 'node:fs';
import path from 'node:path';
import { scorePack } from './score.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function load(file, fallback = '') {
  if (!fs.existsSync(file)) return fallback;
  return fs.readFileSync(file, 'utf8');
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const dir = path.resolve(arg('dir', '.'));
const meta = loadJson(path.join(dir, 'run-meta.json'), {});
const tasks = loadJson(path.join(dir, 'TASKS.json'), { tasks: [] });
const payloads = loadJson(path.join(dir, 'payloads.json'), []);
const tests = loadJson(path.join(dir, 'tests.json'), { cmd: '', ok: null, log: '' });
const immut = loadJson(path.join(dir, 'immutability.json'), { green: false, suite: [] });
const score = fs.existsSync(path.join(dir, 'score.json'))
  ? loadJson(path.join(dir, 'score.json'))
  : scorePack(dir);
const specSummary = load(path.join(dir, 'spec-summary.md'));
const flow = load(path.join(dir, 'flow.mmd'));
const standards = load(path.join(dir, 'reviews', 'standards.md'));
const specR = load(path.join(dir, 'reviews', 'spec.md'));
const correctness = load(path.join(dir, 'reviews', 'correctness.md'));

const app = meta.app || path.basename(process.cwd());
const branch = meta.branch || '';
const kind = meta.kind || tasks.kind || '';
const cov = score.coverage || {};
const scoreCls = score.closable ? 'ok' : 'bad';
const covCls = cov.ok ? 'ok' : 'bad';

const taskRows = (tasks.tasks || []).map((t) => `<tr>
  <td><code>${esc(t.id)}</code></td>
  <td>${esc(t.title)}</td>
  <td>${esc(t.status)}</td>
  <td>${esc(t.tests_added ?? 0)}</td>
  <td>${t.red_green ? 'yes' : 'no'}</td>
  <td>${t.immutability ? 'yes' : 'no'}</td>
  <td>${esc(t.worktree ?? '')}</td>
</tr>`).join('');

const payloadBlocks = (Array.isArray(payloads) ? payloads : []).map((p, i) => `
  <article class="card">
    <h3>${esc(p.name || 'payload ' + (i + 1))}</h3>
    <p class="muted">${esc(p.note || '')}</p>
    <div class="grid2">
      <div><h4>entrada</h4><pre>${esc(typeof p.request === 'string' ? p.request : JSON.stringify(p.request, null, 2))}</pre></div>
      <div><h4>saída</h4><pre>${esc(typeof p.response === 'string' ? p.response : JSON.stringify(p.response, null, 2))}</pre></div>
    </div>
  </article>`).join('') || '<p class="muted">Nenhum payload no spec.</p>';

const gateRows = (score.gates || []).map((g) => `<tr>
  <td>${esc(g.id)}</td>
  <td>${g.ok ? '✓' : '✗'}</td>
  <td>${esc(g.detail)}</td>
</tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(app)} · make-me-happy</title>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "dark" });
</script>
<style>
  :root { --bg:#0b1220; --panel:#111827; --text:#e5e7eb; --muted:#9ca3af; --border:#374151; --ok:#22c55e; --bad:#ef4444; --accent:#38bdf8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header { padding:1.25rem 2rem; border-bottom:1px solid var(--border); display:flex; gap:1rem; align-items:center; flex-wrap:wrap; }
  h1 { margin:0; font-size:1.25rem; }
  .pill { border:1px solid var(--border); border-radius:999px; padding:.2rem .7rem; font-size:.85rem; }
  .pill.ok { border-color: var(--ok); color: var(--ok); }
  .pill.bad { border-color: var(--bad); color: var(--bad); }
  nav { display:flex; gap:.5rem; padding: .75rem 2rem; border-bottom:1px solid var(--border); flex-wrap:wrap; }
  nav button { background:transparent; color:var(--muted); border:1px solid var(--border); border-radius:8px; padding:.35rem .8rem; cursor:pointer; }
  nav button[aria-selected="true"] { color:var(--text); border-color:var(--accent); }
  main { padding:1.5rem 2rem 3rem; max-width:1100px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:1rem 1.2rem; margin: .8rem 0; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:.4rem .5rem; border-bottom:1px solid var(--border); font-size:.9rem; }
  pre, .md { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size:.85rem; }
  .muted { color: var(--muted); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  @media (max-width: 800px) { .grid2 { grid-template-columns:1fr; } }
  .panel { display:none; }
  .panel.active { display:block; }
</style>
</head>
<body>
<header>
  <h1>make-me-happy</h1>
  <span class="pill">App <strong>${esc(app)}</strong></span>
  <span class="pill">Branch <code>${esc(branch)}</code></span>
  <span class="pill">${esc(kind)}</span>
  <span class="pill ${scoreCls}">Score <strong>${esc(score.score)}</strong> / 10</span>
  <span class="pill ${covCls}">Coverage <strong>${esc(cov.pct ?? 'n/a')}</strong>% (piso ${esc(cov.floor ?? 90)})</span>
</header>
<nav>
  ${['sdd','impl','fluxo','payloads','testes','review','score'].map((id, i) =>
    `<button data-tab="${id}" aria-selected="${i === 0}">${id}</button>`).join('\n  ')}
</nav>
<main>
  <section class="panel active" id="sdd">
    <div class="card"><h2>SDD / spec</h2>
      <p class="muted">${esc(tasks.spec || meta.spec || '')}</p>
      <div class="md">${esc(specSummary || 'sem spec-summary.md')}</div>
    </div>
  </section>
  <section class="panel" id="impl">
    <div class="card"><h2>O que foi implementado</h2>
      <table>
        <thead><tr><th>id</th><th>task</th><th>status</th><th>tests</th><th>red→green</th><th>immut.</th><th>wt</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </div>
  </section>
  <section class="panel" id="fluxo">
    <div class="card"><h2>Fluxo e impacto</h2>
      <pre class="mermaid">${/<(script|iframe)/i.test(flow) ? 'flowchart LR\n  A[blocked]' : (flow || 'flowchart LR\n  A[sem flow.mmd]')}</pre>
    </div>
  </section>
  <section class="panel" id="payloads">
    <h2>Payloads de teste</h2>
    ${payloadBlocks}
  </section>
  <section class="panel" id="testes">
    <div class="card">
      <h2>Resultado dos testes</h2>
      <p>cmd: <code>${esc(tests.cmd || meta.test_cmd || '')}</code> — ${tests.ok === false ? 'FAIL' : tests.ok === true ? 'PASS' : 'n/a'}</p>
      <p>imutabilidade: ${immut.green ? 'green' : 'não green'} — ${(immut.suite || []).map(esc).join(', ')}</p>
      <p>cobertura: ${esc(cov.pct ?? 'n/a')}% via ${esc(cov.tool || '—')} — piso ${esc(cov.floor ?? 90)}% ${cov.ok ? 'ok' : 'abaixo do piso'}</p>
      <pre>${esc(tests.log || '')}</pre>
    </div>
  </section>
  <section class="panel" id="review">
    <div class="card"><h2>Standards</h2><div class="md">${esc(standards || '—')}</div></div>
    <div class="card"><h2>Spec</h2><div class="md">${esc(specR || '—')}</div></div>
    <div class="card"><h2>Correctness</h2><div class="md">${esc(correctness || '—')}</div></div>
  </section>
  <section class="panel" id="score">
    <div class="card">
      <h2>Score ${esc(score.score)} / 10 ${score.closable ? '— pode fechar' : '— não fecha'}</h2>
      <p class="muted">${esc(cov.detail || '')}</p>
      <table>
        <thead><tr><th>gate</th><th></th><th>detalhe</th></tr></thead>
        <tbody>${gateRows}</tbody>
      </table>
    </div>
  </section>
</main>
<script>
  const buttons = [...document.querySelectorAll('nav button')];
  const panels = [...document.querySelectorAll('.panel')];
  buttons.forEach((b) => b.addEventListener('click', () => {
    buttons.forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    panels.forEach((p) => p.classList.toggle('active', p.id === b.dataset.tab));
  }));
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, 'report.html'), html);
console.log(path.join(dir, 'report.html'));

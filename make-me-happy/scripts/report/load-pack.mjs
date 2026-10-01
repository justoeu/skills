/**
 * Reads a make-me-happy pack and normalizes it for the report.
 *
 * Never throws on a missing or malformed file: it records a warning and
 * returns an empty value. Older packs used several ad-hoc shapes (payloads as
 * a dict, red evidence as free text, verdict only in markdown); the adapters
 * below map them onto the canonical schema in references/pack-schemas.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { scorePack, verdictOf, immutabilityTests } from '../score.mjs';
import { STEPS } from '../run-meta.mjs';

export const AXES = ['standards', 'spec', 'correctness'];
const TASK_STATUS = new Set(['OPEN', 'IN_PROGRESS', 'DONE', 'BLOCKED']);
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const MAX_SPEC_BYTES = 1_500_000;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/%/g, '').trim()) : Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? n : null;
};
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

export function loadPack(dir, { now = new Date() } = {}) {
  const warnings = [];
  const warn = (file, msg) => warnings.push({ file, msg });
  const abs = (rel) => path.join(dir, rel);
  const exists = (rel) => fs.existsSync(abs(rel));
  const readText = (rel) => {
    try {
      return exists(rel) ? fs.readFileSync(abs(rel), 'utf8') : null;
    } catch (e) {
      warn(rel, `não foi possível ler: ${e.message}`);
      return null;
    }
  };
  const readJson = (rel) => {
    const t = readText(rel);
    if (t == null) return null;
    try {
      return JSON.parse(t);
    } catch (e) {
      warn(rel, `JSON inválido (${e.message}); ignorado`);
      return null;
    }
  };

  const files = listFiles(dir);
  const meta = readJson('run-meta.json') || {};
  const tasksDoc = readJson('TASKS.json');
  const repoRoot = findRepoRoot(dir);

  const results = loadResults(dir, readJson);
  const tasks = normalizeTasks(tasksDoc, results, warn);
  const immutRaw = readJson('immutability.json');
  const immutability = normalizeImmutability(immutRaw, warn);
  const worktrees = readJson('worktrees.json');
  const coverageRaw = readJson('coverage.json');
  const testsRaw = readJson('tests.json');
  const payloadsRaw = readJson('payloads.json');

  let score = readJson('score.json');
  if (!score && (tasksDoc || exists('reviews'))) {
    try {
      score = scorePack(dir);
    } catch (e) {
      warn('score.json', `score.mjs falhou: ${e.message}`);
    }
  }

  const coverage = normalizeCoverage(coverageRaw, score, meta);
  const tests = normalizeTests(testsRaw, coverageRaw, meta);
  const payloads = normalizePayloads(payloadsRaw, warn);
  const reviews = loadReviews(dir, readText, readJson, warn);
  const extraReviews = loadExtraReviews(dir, readText);
  const projectGates = loadProjectGates(readJson('project-gates.json'), extraReviews, meta, warn);
  const spec = loadSpec(meta, tasksDoc, repoRoot, readText);
  const flow = readText('flow.mmd');
  const diagrams = loadDiagrams(dir, tasks);

  validateMeta(meta, exists('run-meta.json'), warn);
  if (tasksDoc && !Array.isArray(tasksDoc.tasks) && !Array.isArray(tasksDoc)) warn('TASKS.json', 'falta o array "tasks"');

  const steps = buildSteps({ meta, tasks, worktrees, immutability, reviews, score, coverage, projectGates, files, tasksDoc });
  const times = runTimes(meta, steps);

  return {
    dir,
    repoRoot,
    files,
    meta,
    tasksDoc: tasksDoc || null,
    tasks,
    immutability,
    worktrees,
    coverage,
    tests,
    payloads,
    reviews,
    extraReviews,
    projectGates,
    score,
    spec,
    flow,
    diagrams,
    steps,
    times,
    warnings,
    generatedAt: now.toISOString(),
  };
}

function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

function findRepoRoot(dir) {
  let d = path.resolve(dir);
  for (let k = 0; k < 8; k++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

function loadResults(dir, readJson) {
  const map = new Map();
  const rdir = path.join(dir, 'results');
  if (!fs.existsSync(rdir)) return map;
  for (const f of fs.readdirSync(rdir)) {
    if (!f.endsWith('.json')) continue;
    const doc = readJson(`results/${f}`);
    if (isObj(doc)) map.set(String(doc.id || f.replace(/\.json$/, '')), doc);
  }
  return map;
}

// ---------- tasks ----------

function evidence(v, fallbackTest) {
  if (isObj(v)) {
    return {
      test: v.test || v.name || fallbackTest || null,
      file: v.file || null,
      command: v.command || v.cmd || null,
      output: v.output_excerpt || v.output || v.message || v.assertion || null,
      at: v.at || null,
      text: v.note || null,
    };
  }
  if (typeof v === 'string' && v.trim()) return { test: fallbackTest || null, text: v };
  if (fallbackTest) return { test: fallbackTest };
  return null;
}

function normalizeCommits(t, res) {
  const raw = [...arr(t.commits), ...arr(t.commit), ...arr(res?.commits), ...arr(res?.commit)];
  const seen = new Set();
  const out = [];
  for (const c of raw) {
    const o = typeof c === 'string' ? { sha: c } : isObj(c) ? { sha: c.sha || c.hash || '', message: c.message || c.subject || '' } : null;
    if (!o || !o.sha || seen.has(o.sha)) continue;
    seen.add(o.sha);
    out.push(o);
  }
  return out;
}

export function normalizeTasks(doc, results = new Map(), warn = () => {}) {
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.tasks) ? doc.tasks : [];
  return list.filter(isObj).map((t, idx) => {
    const res = results.get(String(t.id)) || null;
    const merged = { ...t, ...(res ? Object.fromEntries(Object.entries(res).filter(([k]) => !(k in t) || t[k] == null || k === 'status' || k === 'tests_added' || k === 'red_green')) : {}) };
    const id = String(merged.id || `T-${String(idx + 1).padStart(3, '0')}`);
    const status = String(merged.status || 'OPEN').toUpperCase();
    if (!TASK_STATUS.has(status)) warn('TASKS.json', `${id}: status "${merged.status}" fora do enum OPEN|IN_PROGRESS|DONE|BLOCKED`);
    const redTest = merged.red_test || (typeof merged.test === 'string' ? merged.test : null) || (isObj(merged.red) ? merged.red.test : null);
    const red = evidence(merged.red, redTest) || (merged.characterization ? { test: redTest, text: merged.characterization } : null);
    const green = evidence(merged.green, null);
    const reversal = isObj(merged.reversal)
      ? { done: merged.reversal.done !== false, output: merged.reversal.output_excerpt || merged.reversal.output || null, text: merged.reversal.note || null }
      : typeof merged.reversal === 'string' ? { done: true, text: merged.reversal } : typeof merged.reversal === 'boolean' ? { done: merged.reversal } : null;
    const tests = arr(merged.tests).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
    if (status === 'DONE' && !(red && (red.test || red.output || red.text))) {
      warn('TASKS.json', `${id}: DONE sem evidência RED (red.test / red_test)`);
    }
    return {
      id,
      title: String(merged.title || merged.name || id),
      status,
      worktree: merged.worktree ?? null,
      tests_added: num(merged.tests_added) ?? 0,
      red_green: merged.red_green === true,
      immutability: merged.immutability === true,
      depends_on: arr(merged.depends_on).map(String),
      refs: [...arr(merged.refs), ...arr(merged.findings), ...arr(merged.rf), ...arr(merged.spec_refs), ...arr(merged.task_refs)].map(String),
      files: arr(merged.files).map(String),
      commits: normalizeCommits(merged, res),
      tests,
      red,
      green,
      reversal,
      evidenceText: typeof merged.evidence === 'string' ? merged.evidence : null,
      description: [merged.slice, merged.description, merged.why].filter((x) => typeof x === 'string' && x.trim()).join('\n\n'),
      notes: typeof merged.notes === 'string' ? merged.notes : null,
      acceptance: arr(merged.acceptance).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))),
      cover_pct: num(merged.cover_pct),
      phase: merged.phase ?? null,
    };
  });
}

// ---------- immutability ----------

function normalizeImmutability(raw, warn) {
  if (!raw) return null;
  if (!isObj(raw)) {
    warn('immutability.json', 'esperado um objeto');
    return null;
  }
  const rawTests = Array.isArray(raw.tests) ? raw.tests : Array.isArray(raw.suite) ? raw.suite : [];
  const tests = rawTests.map((t) => (typeof t === 'string'
    ? { name: t, task: null, file: null, kind: null, green: null }
    : isObj(t) ? { name: String(t.name || t.test || t.id || '?'), task: t.task || null, file: t.file || null, kind: t.kind || null, green: typeof t.green === 'boolean' ? t.green : null } : null)).filter(Boolean);
  if (!tests.length && raw.green) warn('immutability.json', 'green=true sem lista de testes (tests[] / suite[])');
  const notes = [];
  for (const k of ['notes', 'checked', 'invariants', 'limitations', 'not_proven', 'found_already_broken', 'observations', 'package_level_state', 'already_pinned_elsewhere', 'method', 'result', 'final_state']) {
    if (raw[k] != null && raw[k] !== '') notes.push({ key: k, value: raw[k] });
  }
  return {
    green: raw.green === true,
    tests,
    names: immutabilityTests(raw),
    tasks_covered: arr(raw.tasks_covered).map(String),
    command: raw.command || null,
    notes,
  };
}

// ---------- coverage ----------

function pctOfFraction(v) {
  if (typeof v === 'string') {
    const m = v.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
    if (m && Number(m[2]) > 0) return { pct: (Number(m[1]) / Number(m[2])) * 100, covered: Number(m[1]), total: Number(m[2]) };
    const n = num(v);
    return n != null && n <= 100 ? { pct: n } : null;
  }
  if (typeof v === 'number' && v >= 0 && v <= 100) return { pct: v };
  if (isObj(v)) {
    if (num(v.pct) != null) return { pct: num(v.pct), covered: num(v.covered), total: num(v.total) };
    const c = num(v.covered ?? v.covered_statements);
    const t = num(v.total ?? v.total_statements);
    if (c != null && t) return { pct: (c / t) * 100, covered: c, total: t };
  }
  return null;
}

export function coverageBreakdown(doc) {
  if (!isObj(doc)) return [];
  const rows = [];
  const push = (name, group, v) => {
    const p = pctOfFraction(v);
    if (p && Number.isFinite(p.pct)) rows.push({ name, group, pct: Math.round(p.pct * 100) / 100, covered: p.covered ?? null, total: p.total ?? null });
  };
  for (const key of ['modules', 'files', 'packages']) {
    if (Array.isArray(doc[key])) {
      for (const m of doc[key]) if (isObj(m)) push(String(m.name || m.path || m.file || '?'), key, m);
    }
  }
  if (num(doc.covered) != null && num(doc.total)) push('código tocado (diff)', 'total', { covered: doc.covered, total: doc.total });
  for (const k of ['statements', 'branches', 'functions', 'lines']) if (doc[k] != null) push(k, 'métrica', doc[k]);
  const skip = new Set(['modules', 'files', 'packages', 'statements', 'branches', 'functions', 'lines', 'pct', 'floor', 'covered', 'total']);
  for (const [k, v] of Object.entries(doc)) {
    if (skip.has(k) || !isObj(v)) continue;
    const before = rows.length;
    if (num(v.covered ?? v.covered_statements) != null && num(v.total ?? v.total_statements)) push(k, k, v);
    else if (num(v.pct) != null) push(k, k, v);
    for (const [sk, sv] of Object.entries(v)) {
      if (/(_pct|^pct_|_percent)$/i.test(sk) && num(sv) != null) push(`${k} · ${sk.replace(/_pct$|_percent$/i, '')}`, k, num(sv));
      else if (['statements', 'branches', 'functions', 'lines'].includes(sk) && typeof sv !== 'number') push(`${k} · ${sk}`, k, sv);
      else if (isObj(sv) && Object.values(sv).every((x) => typeof x === 'number' && x >= 0 && x <= 100)) {
        for (const [nk, nv] of Object.entries(sv)) push(nk, `${k} · ${sk}`, nv);
      }
    }
    if (rows.length === before && Object.values(v).every((x) => typeof x === 'number' && x >= 0 && x <= 100)) {
      for (const [nk, nv] of Object.entries(v)) push(nk, k, nv);
    }
  }
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.group}|${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 60);
}

function normalizeCoverage(doc, score, meta) {
  const sc = score?.coverage || {};
  const pct = num(doc?.pct) ?? num(sc.pct);
  const floor = num(sc.floor) ?? num(doc?.floor) ?? num(meta?.coverage_floor) ?? 90;
  if (!doc && pct == null) return { present: false, pct: null, floor, ok: false, breakdown: [] };
  const scope = [doc?.scope, doc?.method, doc?.note, typeof doc?.details === 'string' ? doc.details : null, typeof doc?.detail === 'string' ? doc.detail : null]
    .filter((x) => typeof x === 'string' && x.trim());
  return {
    present: Boolean(doc),
    pct,
    floor,
    ok: pct != null && pct >= floor,
    tool: doc?.tool || sc.tool || null,
    report: doc?.report || null,
    scope,
    history: typeof doc?.history === 'string' ? doc.history : null,
    measured_at: doc?.measured_at || doc?.at || null,
    breakdown: coverageBreakdown(doc),
  };
}

// ---------- tests ----------

function normalizeTests(doc, cov, meta) {
  if (!isObj(doc)) {
    const fallback = cov?.test_cmd_result || null;
    return { present: false, cmd: cov?.test_cmd || meta?.test_cmd || null, ok: null, log: fallback, suites: [] };
  }
  const passed = num(doc.passed);
  const failed = num(doc.failed);
  const skipped = num(doc.skipped);
  const total = num(doc.total) ?? (passed != null || failed != null ? (passed || 0) + (failed || 0) + (skipped || 0) : null);
  return {
    present: true,
    cmd: doc.cmd || doc.command || meta?.test_cmd || null,
    ok: typeof doc.ok === 'boolean' ? doc.ok : failed != null ? failed === 0 : null,
    total,
    passed,
    failed,
    skipped,
    duration_s: num(doc.duration_s ?? doc.duration),
    at: doc.at || null,
    log: typeof doc.log === 'string' ? doc.log : null,
    suites: arr(doc.suites).filter(isObj).map((s) => ({
      name: String(s.name || '?'), passed: num(s.passed), failed: num(s.failed), skipped: num(s.skipped), duration_s: num(s.duration_s),
    })),
  };
}

// ---------- payloads ----------

const ROUTE_RE = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i;

function payloadItem(name, v) {
  if (!isObj(v)) {
    return { name, method: null, path: null, kind: null, request: v, responses: [], notes: [], refs: [], extra: null };
  }
  const used = new Set();
  const take = (k) => {
    used.add(k);
    return v[k];
  };
  let method = take('method') || null;
  let route = take('path') || take('route') || null;
  for (const k of ['endpoint', 'contract']) {
    const s = take(k);
    if (typeof s === 'string') {
      const m = s.match(ROUTE_RE);
      if (m && !method) { method = m[1].toUpperCase(); route = route || m[2]; } else if (!route) route = s;
    }
  }
  const nm = take('name') || take('id') || name;
  const request = v.request ?? v.body ?? v.input ?? v.requests ?? v.args ?? (v.query != null ? { query: v.query } : undefined);
  for (const k of ['request', 'body', 'input', 'requests', 'args', 'query']) used.add(k);
  const responses = [];
  if (Array.isArray(v.responses)) {
    used.add('responses');
    for (const r of v.responses) if (isObj(r)) responses.push({ status: r.status ?? null, body: r.body ?? r.response ?? r, note: r.note || null });
  }
  const statusDefault = take('response_status') ?? take('status') ?? null;
  for (const k of ['response', 'response_example', 'output', 'response_fragment', 'stdout']) {
    if (v[k] !== undefined) {
      used.add(k);
      responses.push({ status: k === 'response' || k === 'response_example' ? statusDefault : null, body: v[k], note: k === 'response_fragment' ? 'fragmento' : null });
    }
  }
  for (const k of Object.keys(v)) {
    const m = k.match(/^response_(\d{3})(?:_(.*))?$/);
    if (m) {
      used.add(k);
      responses.push({ status: Number(m[1]), body: v[k], note: m[2] ? m[2].replace(/_/g, ' ') : null });
    }
  }
  if (!responses.length && v.expect != null) {
    used.add('expect');
    responses.push({ status: null, body: v.expect, note: 'esperado' });
  }
  const notes = [];
  for (const k of ['note', 'notes', 'expect', 'query_note', 'shape_note', 'wire_note', 'description']) {
    if (!used.has(k) && v[k] != null && v[k] !== '') {
      used.add(k);
      notes.push(...arr(v[k]).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
    }
  }
  const refs = [];
  for (const k of ['tasks', 'task_refs', 'finding', 'findings', 'rf', 'spec_ref', 'permission', 'permissions']) {
    if (v[k] != null) {
      used.add(k);
      refs.push(...arr(v[k]).map(String));
    }
  }
  const kind = take('kind') || (method ? 'http' : null);
  const extraEntries = Object.entries(v).filter(([k]) => !used.has(k));
  return {
    name: String(nm),
    method: method ? String(method).toUpperCase() : null,
    path: route ? String(route) : null,
    kind,
    request: request === undefined ? null : request,
    responses,
    notes,
    refs,
    extra: extraEntries.length ? Object.fromEntries(extraEntries) : null,
  };
}

export function normalizePayloads(raw, warn = () => {}) {
  const res = { present: raw != null, items: [], context: [], canonical: true };
  if (raw == null) return res;
  let list = null;
  const label = (v, i) => (isObj(v)
    ? v.name || v.id || v.finding || v.contract || v.endpoint || (v.method && v.path ? `${v.method} ${v.path}` : `payload ${i + 1}`)
    : `item ${i + 1}`);
  if (Array.isArray(raw)) list = raw.map((v, i) => [label(v, i), v]);
  else if (isObj(raw)) {
    if (Array.isArray(raw.payloads)) {
      list = raw.payloads.map((v, i) => [label(v, i), v]);
      for (const [k, v] of Object.entries(raw)) if (k !== 'payloads') res.context.push({ key: k, value: v });
      res.canonical = false;
    } else {
      list = [];
      res.canonical = false;
      for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          res.context.push({ key: k, value: v });
        } else if (isObj(v) && Object.values(v).some((x) => isObj(x) && (x.method || x.path || x.endpoint))) {
          for (const [sk, sv] of Object.entries(v)) list.push([`${k} · ${sk}`, sv]);
        } else list.push([k, v]);
      }
    }
  } else {
    warn('payloads.json', 'esperado array ou objeto');
    return res;
  }
  res.items = list.map(([n, v]) => payloadItem(n, v));
  const isCanon = (v) => isObj(v) && typeof v.name === 'string' && ('request' in v || 'responses' in v);
  if (Array.isArray(raw) && !raw.every(isCanon)) res.canonical = false;
  if (!res.canonical) warn('payloads.json', 'fora do schema canônico ({name, method, path, request, responses[]}); exibido por adaptação');
  return res;
}

// ---------- reviews ----------

function normFinding(f, i) {
  if (!isObj(f)) return { id: `F-${i + 1}`, severity: 'info', title: String(f), status: 'open' };
  const sev = String(f.severity || f.level || 'info').toLowerCase();
  return {
    id: String(f.id || `F-${i + 1}`),
    severity: SEVERITIES.includes(sev) ? sev : 'info',
    kind: f.kind || null,
    title: String(f.title || f.summary || f.description || '').slice(0, 300),
    description: f.description && f.description !== f.title ? String(f.description) : null,
    file: f.file || null,
    line: f.line ?? null,
    rule: f.rule || f.standard || null,
    status: String(f.status || 'open').toLowerCase(),
    round: f.round ?? null,
    fixed_in_round: f.fixed_in_round ?? null,
    fix: f.fix || f.fixed_by || null,
  };
}

function loadReviews(dir, readText, readJson, warn) {
  const out = {};
  for (const axis of AXES) {
    const md = readText(`reviews/${axis}.md`);
    const doc = readJson(`reviews/${axis}.json`);
    let verdict = null;
    let rounds = [];
    let findings = [];
    if (doc) {
      const v = String(doc.verdict || '').toUpperCase();
      if (['APPROVE', 'REJECT', 'SKIP'].includes(v)) verdict = v;
      else warn(`reviews/${axis}.json`, `verdict "${doc.verdict}" fora do enum APPROVE|REJECT|SKIP`);
      rounds = arr(doc.rounds).filter(isObj).map((r, i) => ({
        round: r.round ?? i + 1,
        verdict: String(r.verdict || '').toUpperCase() || null,
        at: r.at || null,
        summary: r.summary || null,
        findings: arr(r.findings).map(normFinding),
      }));
      findings = arr(doc.findings).map(normFinding);
      if (!findings.length && rounds.length) findings = rounds[rounds.length - 1].findings;
    }
    if (!verdict) verdict = verdictOf(md || '');
    const mdRound = md && md.match(/\bround\s*(\d+)/i);
    out[axis] = {
      present: Boolean(md || doc),
      verdict,
      round: doc?.round ?? (rounds.length ? rounds[rounds.length - 1].round : mdRound ? Number(mdRound[1]) : null),
      summary: doc?.summary || null,
      rounds,
      findings,
      structured: Boolean(doc),
      md,
    };
    if (md && !doc) warn(`reviews/${axis}.json`, 'ausente; achados só em markdown (sem severidade/arquivo estruturados)');
  }
  return out;
}

function guessVerdict(md) {
  const v = verdictOf(md);
  if (v) return v;
  if (/\b(Overall|Resultado|Status)\s*:\s*\**\s*(PASS|APROVADO|APPROVED)/i.test(md) || /^\s*\**APROVAD[OA]/im.test(md)) return 'APPROVE';
  if (/\b(Overall|Resultado|Status)\s*:\s*\**\s*(FAIL|REPROVADO|REJECTED)/i.test(md)) return 'REJECT';
  return null;
}

function loadExtraReviews(dir, readText) {
  const rdir = path.join(dir, 'reviews');
  if (!fs.existsSync(rdir)) return [];
  const axisFiles = new Set(AXES.flatMap((a) => [`${a}.md`, `${a}.json`]));
  return fs.readdirSync(rdir)
    .filter((f) => /\.(md|json)$/.test(f) && !axisFiles.has(f))
    .sort()
    .map((f) => {
      const text = readText(`reviews/${f}`) || '';
      const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.(md|json)$/, '');
      return { file: `reviews/${f}`, name: f.replace(/\.(md|json)$/, ''), title, verdict: f.endsWith('.md') ? guessVerdict(text) : null, md: f.endsWith('.md') ? text : '```json\n' + text + '\n```' };
    });
}

function loadProjectGates(doc, extraReviews, meta, warn) {
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.gates) ? doc.gates : null;
  if (list) {
    return {
      present: true,
      inferred: false,
      gates: list.filter(isObj).map((g) => {
        const st = String(g.status || 'OPEN').toUpperCase();
        if (!['DONE', 'OPEN', 'FAILED', 'N/A'].includes(st)) warn('project-gates.json', `${g.name}: status "${g.status}" fora do enum DONE|OPEN|FAILED|N/A`);
        return { name: String(g.name || g.id || '?'), source: g.source || null, status: st, evidence: g.evidence || g.note || null, command: g.command || null };
      }),
      note: doc?.note || null,
    };
  }
  const gates = extraReviews.map((r) => ({
    name: r.title,
    source: r.file,
    status: r.verdict === 'APPROVE' ? 'DONE' : r.verdict === 'REJECT' ? 'FAILED' : 'DONE?',
    evidence: `inferido de ${r.file}`,
    command: null,
  }));
  const note = [meta.project_status && `project_status: ${meta.project_status}`, meta.project_next_step && `próximo: ${meta.project_next_step}`].filter(Boolean).join(' · ') || null;
  return { present: false, inferred: gates.length > 0, gates, note };
}

// ---------- spec / diagrams ----------

function loadSpec(meta, tasksDoc, repoRoot, readText) {
  const specPath = meta.spec || tasksDoc?.spec || null;
  const summary = readText('spec-summary.md');
  const draft = readText('spec-draft.md');
  let full = null;
  let fullKind = null;
  let fullError = null;
  if (specPath && repoRoot) {
    const p = path.resolve(repoRoot, specPath);
    if (!p.startsWith(repoRoot + path.sep)) fullError = 'path do spec fora do repositório';
    else if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      const size = fs.statSync(p).size;
      if (size > MAX_SPEC_BYTES) fullError = `spec com ${Math.round(size / 1024)} KB — acima do limite de embutir`;
      else if (/\.(md|markdown|txt)$/i.test(p)) {
        full = fs.readFileSync(p, 'utf8');
        fullKind = 'md';
      } else {
        fullKind = path.extname(p).slice(1) || 'file';
        fullError = `spec é ${fullKind}, não markdown — veja o arquivo no repositório`;
      }
    } else fullError = 'arquivo do spec não encontrado a partir da raiz do repo';
  }
  return {
    path: specPath,
    status: meta.spec_status || (specPath ? 'confirmed?' : null),
    section: meta.spec_section || tasksDoc?.spec_section || null,
    summary,
    draft,
    full,
    fullKind,
    fullError,
  };
}

function loadDiagrams(dir, tasks) {
  const out = [];
  const ddir = path.join(dir, 'diagrams');
  if (fs.existsSync(ddir)) {
    for (const f of fs.readdirSync(ddir).sort()) {
      if (f.endsWith('.mmd')) out.push({ name: f.replace(/\.mmd$/, ''), source: fs.readFileSync(path.join(ddir, f), 'utf8') });
    }
  }
  return out;
}

// ---------- steps / timeline ----------

const STEP_LABEL = {
  explore: 'Etapa Zero', planner: 'Planner', worktrees: 'Worktrees', implement: 'Implementação',
  immutability: 'Imutabilidade', review: 'Review 3 eixos', score: 'Score', clean: 'Limpeza', 'project-gates': 'Gates do projeto',
};
export { STEP_LABEL };

function buildSteps({ meta, tasks, worktrees, immutability, reviews, score, coverage, projectGates, files, tasksDoc }) {
  const recorded = isObj(meta.steps) ? meta.steps : {};
  const slices = worktrees?.slices || [];
  const verdicts = AXES.map((a) => reviews[a].verdict);
  const infer = {
    explore: () => (meta.spec_status === 'draft' ? 'in_progress' : meta.spec || tasksDoc?.spec ? 'done' : files.includes('spec-draft.md') ? 'in_progress' : 'pending'),
    planner: () => (tasks.length ? 'done' : 'pending'),
    worktrees: () => (worktrees ? (worktrees.skipped ? 'skipped' : slices.length ? 'done' : 'pending') : 'pending'),
    implement: () => (!tasks.length ? 'pending' : tasks.every((t) => t.status === 'DONE') ? 'done' : tasks.some((t) => t.status !== 'OPEN') ? 'in_progress' : 'pending'),
    immutability: () => (!immutability ? 'pending' : immutability.green ? 'done' : 'failed'),
    review: () => (verdicts.every((v) => v == null) ? 'pending' : verdicts.includes('REJECT') ? 'failed' : verdicts.every((v) => v === 'APPROVE' || v === 'SKIP') ? 'done' : 'in_progress'),
    score: () => (!score ? 'pending' : score.closable ? 'done' : 'failed'),
    clean: () => (worktrees?.skipped ? 'skipped' : slices.length && slices.every((s) => s.removed) ? 'done' : slices.length ? 'in_progress' : 'pending'),
    'project-gates': () => (projectGates.present ? (projectGates.gates.some((g) => g.status !== 'DONE' && g.status !== 'N/A') ? 'in_progress' : 'done') : projectGates.inferred ? 'done' : 'pending'),
  };
  const next = String(meta.next_step || '').replace(/^worktrees-add$/, 'worktrees');
  return STEPS.map((id) => {
    const r = isObj(recorded[id]) ? recorded[id] : null;
    const status = r?.status || infer[id]();
    return {
      id,
      label: STEP_LABEL[id],
      status,
      inferred: !r,
      started_at: r?.started_at || null,
      finished_at: r?.finished_at || null,
      note: r?.note || null,
      current: next === id && meta.status !== 'closed',
    };
  });
}

function runTimes(meta, steps) {
  const stamps = steps.flatMap((s) => [s.started_at, s.finished_at]).filter(Boolean).map((t) => Date.parse(t)).filter(Number.isFinite);
  const start = meta.started_at ? Date.parse(meta.started_at) : stamps.length ? Math.min(...stamps) : NaN;
  const endCandidates = [meta.finished_at, meta.closed_at].filter(Boolean).map((t) => Date.parse(t)).filter(Number.isFinite);
  const end = endCandidates.length ? Math.max(...endCandidates) : stamps.length ? Math.max(...stamps) : NaN;
  return {
    started_at: Number.isFinite(start) ? new Date(start).toISOString() : null,
    finished_at: Number.isFinite(end) && end > start ? new Date(end).toISOString() : null,
    duration_ms: Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null,
  };
}

function validateMeta(meta, present, warn) {
  if (!present) {
    warn('run-meta.json', 'ausente — o Oracle grava no §0 Setup');
    return;
  }
  for (const k of ['app', 'branch', 'kind', 'status']) if (meta[k] == null) warn('run-meta.json', `campo "${k}" ausente`);
  if (meta.status && !['in_progress', 'closed'].includes(meta.status)) warn('run-meta.json', `status "${meta.status}" fora do enum in_progress|closed`);
  if (!isObj(meta.steps)) warn('run-meta.json', 'sem "steps" — timeline inferida pelos arquivos (use scripts/run-meta.mjs step)');
}

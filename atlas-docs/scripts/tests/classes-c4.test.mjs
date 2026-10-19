import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const templatePath = path.join(root, 'assets/template.html');
const buildPy = path.join(root, 'scripts/atlas_build.py');
const mergePy = path.join(root, 'scripts/atlas_merge.py');
const template = fs.readFileSync(templatePath, 'utf8');

function E(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function arr(x) { return Array.isArray(x) ? x : []; }

function loadFns() {
  const start = template.indexOf('function classTargetOf(to)');
  const end = template.indexOf('/* ----- arquitetura ----- */');
  assert.ok(start > 0 && end > start, 'template deve definir o bloco classes + c4 antes de rArq');
  const wrapped = new Function(
    'E', 'arr',
    template.slice(start, end) +
      '; return { classTargetOf, classEdgesOf, classesDiagramHtml, classDetailHtml, c4CtxGraph, c4CtxLayout, c4ContGraph, c4ContLayout, c4Svg, c4NodeDetail };'
  );
  return wrapped(E, arr);
}

const flowWithClasses = {
  id: 'imediata',
  label: 'Cobrança imediata · cartão',
  classes: [
    {
      id: 'charge-service', name: 'ChargeService', stereo: 'service',
      pkg: 'internal/charge', desc: 'Orquestra a autorização.', src: 'internal/charge/service.go:42',
      fields: ['repo *ChargeRepo', 'psp psp.Client'],
      methods: [
        {
          sig: 'Authorize(ctx context.Context, in AuthInput) (*Charge, error)',
          what: 'guarda idempotência e autoriza',
          calls: [
            { to: 'PSPClient.Authorize', how: 'HTTP · timeout 4s', kind: 'http' },
            { to: 'ChargeRepo.Insert', kind: 'db' },
            { to: 'UnknownSvc.Do' },
          ],
          src: 'service.go:58',
        },
        {
          sig: 'Compensate(ctx context.Context, id string) error',
          what: 'estorna reserva',
          calls: [{ to: 'ChargeRepo.Update', kind: 'db' }],
          src: 'service.go:97',
        },
      ],
    },
    {
      id: 'psp-client', name: 'PSPClient', stereo: 'externo', pkg: 'internal/psp',
      methods: [{ sig: 'Authorize(ctx context.Context, r AuthRequest) (*AuthResponse, error)', what: 'chama o PSP', calls: [], src: 'psp/client.go:31' }],
    },
    {
      id: 'charge-repo', name: 'ChargeRepo', stereo: 'repository',
      methods: [
        { sig: 'Insert(c Charge) error', calls: [], src: 'repo.go:12' },
        { sig: 'Update(c Charge) error', calls: [], src: 'repo.go:20' },
      ],
    },
  ],
};

test('template liga página C4 e card de classes no dashboard', () => {
  assert.match(template, /\{ k: "c4",\s+icon: "◫", label: "C4 · contexto & containers" \}/);
  assert.match(template, /case "c4": return rC4\(\);/);
  assert.match(template, /function rC4\(\)/);
  assert.match(template, /c4: "c4"/);
  assert.match(template, /data-atlas="flow-classes"/);
  assert.match(template, /function classesCard\(f\)/);
  const rich = template.slice(template.indexOf('function rRich(f)'), template.indexOf('function diagramNodes'));
  assert.match(rich, /classesCard\(f\);/);
  const chain = template.slice(template.indexOf('function rChain(f)'), template.indexOf('function pathItems'));
  assert.match(chain, /classesCard\(f\);/);
  const arq = template.slice(template.indexOf('function rArq()'), template.indexOf('/* ----- contratos'));
  assert.match(arq, /MODEL\.c4/);
  assert.match(template, /selMethod: function/);
  assert.match(template, /selClass: function/);
  assert.match(template, /selC4: function/);
  assert.match(template, /c4tab: function/);
});

test('classEdgesOf deriva arestas de methods[].calls, dedupe por par e ignora alvo desconhecido', () => {
  const { classEdgesOf } = loadFns();
  const edges = classEdgesOf(flowWithClasses);
  assert.equal(edges.length, 2);
  const toPsp = edges.find((e) => e.to === 'PSPClient');
  assert.ok(toPsp);
  assert.deepEqual(toPsp.methods, ['Authorize']);
  assert.equal(toPsp.kind, 'http');
  const toRepo = edges.find((e) => e.to === 'ChargeRepo');
  assert.ok(toRepo);
  assert.deepEqual(toRepo.methods, ['Insert', 'Update']);
  assert.equal(edges.filter((e) => e.to === 'UnknownSvc').length, 0);
});

test('classesDiagramHtml desenha caixas UML com estereótipo, dependências e métodos clicáveis', () => {
  const { classesDiagramHtml } = loadFns();
  const html = classesDiagramHtml(flowWithClasses, { cls: 'ChargeService', mtd: 0 });
  assert.match(html, /ChargeService/);
  assert.match(html, /«service»/);
  assert.match(html, /«externo»/);
  assert.match(html, /Authorize\(ctx context.Context, in AuthInput\)/);
  assert.match(html, /repo \*ChargeRepo/);
  assert.match(html, /A\.selMethod\('ChargeService',0\)/);
  assert.match(html, />Insert · Update</);
});

test('classesDiagramHtml escapa HTML vindo do modelo; desc escapa no painel de detalhe', () => {
  const { classesDiagramHtml, classDetailHtml } = loadFns();
  const flow = {
    classes: [{
      name: 'Svc', stereo: 'service', desc: '<script>alert(1)</script>',
      fields: ['<img src=x onerror=alert(1)>'], methods: [{ sig: 'Do()', calls: [] }],
    }],
  };
  const html = classesDiagramHtml(flow, null);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const detail = classDetailHtml(flow, { cls: 'Svc', mtd: null });
  assert.doesNotMatch(detail, /<script>alert/);
  assert.match(detail, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('classDetailHtml mostra o que o método chama; sem seleção mostra dica', () => {
  const { classDetailHtml } = loadFns();
  const detail = classDetailHtml(flowWithClasses, { cls: 'ChargeService', mtd: 0 });
  assert.match(detail, /MÉTODO SELECIONADO/);
  assert.match(detail, /O QUE CHAMA/);
  assert.match(detail, /PSPClient\.Authorize/);
  assert.match(detail, /HTTP · timeout 4s/);
  assert.match(detail, /service\.go:58/);
  const clsOnly = classDetailHtml(flowWithClasses, { cls: 'ChargeService', mtd: null });
  assert.match(clsOnly, /Orquestra a autorização/);
  assert.match(clsOnly, /DEPENDÊNCIAS/);
  assert.doesNotMatch(clsOnly, /O QUE CHAMA/);
  const hint = classDetailHtml(flowWithClasses, null);
  assert.match(hint, /Clique numa classe/);
});

test('c4CtxGraph injeta o hub system, filtra edges órfãs e c4Svg renderiza nós e labels', () => {
  const { c4CtxGraph, c4CtxLayout, c4Svg } = loadFns();
  const ctx = {
    self: { desc: 'Sistema de cobrança.' },
    actors: [{ id: 'shopper', name: 'Cliente final', desc: 'paga' }],
    systems: [{ id: 'psp', name: 'PSP', desc: 'adquirência', flows: ['imediata'] }],
    edges: [
      { from: 'shopper', to: 'system', label: 'POST /v1/charges' },
      { from: 'system', to: 'psp', label: 'REST' },
      { from: 'ghost', to: 'system', label: 'inválida' },
    ],
  };
  const g = c4CtxGraph(ctx, 'billing', 'Sistema de cobrança.');
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.length, 2);
  assert.equal(g.byId.system.name, 'billing');
  assert.ok(g.byId.system.hub);
  const size = c4CtxLayout(g);
  assert.ok(size.w > 400 && size.h >= 140, `layout C1太小: ${JSON.stringify(size)}`);
  const svg = c4Svg(g, size, 'system');
  assert.match(svg, /Cliente final/);
  assert.match(svg, /POST \/v1\/charges/);
  assert.match(svg, /ESTE SISTEMA/);
  assert.match(svg, /SISTEMA EXTERNO/);
  assert.match(svg, /A\.selC4\('system'\)/);
});

test('c4ContGraph monta grafo por grupo e deriva arestas de calls entre containers', () => {
  const { c4ContGraph, c4ContLayout, c4Svg } = loadFns();
  const conts = [
    { id: 'api', name: 'billing-api', group: 'dominio', tech: 'Go 1.23', flows: ['imediata'], calls: [{ to: 'postgres', label: 'SQL', kind: 'db' }, { to: 'nope', label: 'x' }] },
    { id: 'postgres', name: 'postgres', group: 'dados', tech: 'Postgres 16', calls: [] },
    { id: 'worker', name: 'billing-worker', group: 'dominio', tech: 'Go', calls: [{ to: 'postgres', label: 'SQL' }] },
  ];
  const cg = c4ContGraph(conts);
  assert.equal(cg.nodes.length, 3);
  assert.equal(cg.edges.length, 2);
  const size = c4ContLayout(cg);
  assert.ok(size.groups.length >= 2);
  assert.match(size.groups.map((x) => x.label).join('|'), /dados/);
  const svg = c4Svg(cg, size, 'postgres');
  assert.match(svg, /billing-api/);
  assert.match(svg, /Postgres 16/);
  assert.match(svg, /c4-col-label/);
  assert.match(svg, /A\.selC4\('postgres'\)/);
});

test('c4NodeDetail lista fluxos com link e mostra lacuna sem seleção', () => {
  const { c4NodeDetail } = loadFns();
  const html = c4NodeDetail({ kind: 'externo', name: 'PSP', desc: 'adquirência', flows: ['imediata'], src: 'internal/psp/client.go' });
  assert.match(html, /SISTEMA EXTERNO/);
  assert.match(html, /PARTICIPA DOS FLUXOS/);
  assert.match(html, /A\.flow\('imediata'\)/);
  assert.match(html, /internal\/psp\/client\.go/);
  const empty = c4NodeDetail(null);
  assert.match(empty, /Clique num elemento/);
});

function baseModel(extraFlow, c4) {
  return {
    schema: 'atlas-docs/1',
    app: { name: 'demo-billing', commit: 'abc1234' },
    identity: {},
    entrypoints: [{ kind: 'http', ref: 'POST /v1/charges', status: 'mapeado', flow: 'imediata' }],
    flows: [{
      id: 'imediata',
      label: 'Cobrança imediata',
      title: 'Cobrança imediata',
      brief: { what: 'a', does: 'b', happy: [{ when: 'w', then: 't' }], unhappy: [{ when: 'w', then: 't' }] },
      steps: [{ name: 'api', tech: 'Go', payload: '{}', src: 'a.go:1', does: 'x', calls: [{ sig: 's' }], errs: [{ code: 'E', msg: 'm' }], touches: ['t'] }],
      ...extraFlow,
    }],
    ...(c4 ? { c4 } : {}),
  };
}

const validC4 = {
  context: {
    self: { desc: 'Sistema de cobrança.' },
    actors: [{ id: 'shopper', name: 'Cliente final' }],
    systems: [{ id: 'psp', name: 'PSP', flows: ['imediata'] }],
    edges: [{ from: 'shopper', to: 'system', label: 'POST /v1/charges' }, { from: 'system', to: 'psp', label: 'REST' }],
  },
  containers: [
    { id: 'api', name: 'billing-api', group: 'dominio', tech: 'Go', flows: ['imediata'], calls: [{ to: 'postgres', label: 'SQL', kind: 'db' }] },
    { id: 'postgres', name: 'postgres', group: 'dados', tech: 'Postgres 16', calls: [] },
  ],
};

test('build passa com classes + c4 válidos e injeta tudo no HTML', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cls-'));
  const modelPath = path.join(dir, 'app-model.json');
  const out = path.join(dir, 'index.html');
  fs.writeFileSync(modelPath, JSON.stringify(baseModel({ classes: flowWithClasses.classes }, validC4)));
  const r = spawnSync('python3', [buildPy, modelPath, '--template', templatePath, '-o', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /classes: 1\/1 fluxos/);
  assert.match(r.stdout, /c4: C1 ok · C2 2 containers/);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /Diagrama de classes do fluxo/);
  assert.match(html, /C4 · contexto & containers/);
  assert.match(html, /"classes":\[/);
  assert.match(html, /"containers":\[/);
});

test('build avisa chamada de método para classe fora do diagrama e não quebra', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cls-warn-'));
  const modelPath = path.join(dir, 'app-model.json');
  fs.writeFileSync(modelPath, JSON.stringify(baseModel({ classes: flowWithClasses.classes })));
  const r = spawnSync('python3', [buildPy, modelPath, '--check-only'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /classe fora do diagrama/);
  assert.match(r.stderr, /UnknownSvc\.Do/);
});

test('build quebra com edge de C1 apontando id inexistente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-c4-err-'));
  const modelPath = path.join(dir, 'app-model.json');
  const bad = JSON.parse(JSON.stringify(validC4));
  bad.context.edges.push({ from: 'ghost', to: 'system', label: 'x' });
  fs.writeFileSync(modelPath, JSON.stringify(baseModel({}, bad)));
  const r = spawnSync('python3', [buildPy, modelPath, '--check-only'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /c4\.context\.edges\[2\] referencia 'ghost' inexistente/);
});

test('build quebra com call de container apontando container inexistente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-c4-err2-'));
  const modelPath = path.join(dir, 'app-model.json');
  const bad = JSON.parse(JSON.stringify(validC4));
  bad.containers[0].calls.push({ to: 'redis', label: 'cache' });
  fs.writeFileSync(modelPath, JSON.stringify(baseModel({}, bad)));
  const r = spawnSync('python3', [buildPy, modelPath, '--check-only'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /aponta para container inexistente 'redis'/);
});

test('build avisa C2 sem C1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-c4-warn-'));
  const modelPath = path.join(dir, 'app-model.json');
  const onlyC2 = { containers: validC4.containers };
  fs.writeFileSync(modelPath, JSON.stringify(baseModel({}, onlyC2)));
  const r = spawnSync('python3', [buildPy, modelPath, '--check-only'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /sem c4\.context/);
});

test('merge faz upsert das listas de c4 por id (delta)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-c4-merge-'));
  const oldPath = path.join(dir, 'old.json');
  const scanPath = path.join(dir, 'scan.json');
  const outPath = path.join(dir, 'merged.json');
  const old = baseModel(
    { classes: flowWithClasses.classes },
    { context: { actors: [{ id: 'shopper', name: 'Cliente final' }] }, containers: [{ id: 'api', name: 'billing-api', group: 'dominio', calls: [] }] }
  );
  old.app.commit = 'old1234';
  const scan = {
    c4: {
      context: { actors: [{ id: 'admin', name: 'Time de ops' }], systems: [{ id: 'psp', name: 'PSP' }] },
      containers: [{ id: 'worker', name: 'billing-worker', group: 'dominio', calls: [{ to: 'api', label: 'HTTP' }] }],
    },
  };
  fs.writeFileSync(oldPath, JSON.stringify(old));
  fs.writeFileSync(scanPath, JSON.stringify(scan));
  const r = spawnSync('python3', [mergePy, oldPath, scanPath, '--mode', 'delta', '--commit', 'new5678', '-o', outPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const merged = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const actorIds = merged.c4.context.actors.map((a) => a.id).sort();
  assert.deepEqual(actorIds, ['admin', 'shopper']);
  assert.ok(merged.c4.context.systems.some((s) => s.id === 'psp'));
  const contIds = merged.c4.containers.map((c) => c.id).sort();
  assert.deepEqual(contIds, ['api', 'worker']);
  assert.ok(merged.flows[0].classes.length > 0, 'classes do fluxo preservadas no delta');
});

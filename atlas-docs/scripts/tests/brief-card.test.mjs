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
const template = fs.readFileSync(templatePath, 'utf8');

function loadBriefFns() {
  const start = template.indexOf('function pathItems(list)');
  const end = template.indexOf('function notesCard(f)');
  assert.ok(start > 0 && end > start, 'template deve definir pathItems e flowBriefCard');
  const E = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const arr = function (x) { return Array.isArray(x) ? x : []; };
  const fns = { E, arr };
  const wrapped = new Function('E', 'arr', template.slice(start, end) + '; return { pathItems, pathList, briefPane, flowBriefCard };');
  return wrapped(E, arr);
}

function baseModel(flowExtra) {
  return {
    schema: 'atlas-docs/1',
    app: { name: 'demo-billing', commit: 'abc1234', branch: 'main', repo: 'acme/billing' },
    identity: {},
    entrypoints: [
      { kind: 'http', ref: 'POST /v1/charges', status: 'mapeado', flow: 'imediata' },
    ],
    flows: [
      {
        id: 'imediata',
        label: 'Cobrança imediata · cartão',
        title: 'Cobrança imediata · cartão',
        tag: 'HTTP · POST /v1/charges',
        resumo: 'Autoriza no PSP e grava a charge.',
        stats: [{ k: 'PASSOS', v: '3 · compensável' }],
        steps: [
          { name: 'api · authorize', tech: 'Go', payload: '{}', src: 'authorize.go:1', does: 'autoriza', calls: [{ sig: 'PSP.Authorize' }], errs: [{ code: 'PSP_TIMEOUT', msg: 'timeout' }], touches: ['charges'] },
        ],
        ...flowExtra,
      },
    ],
  };
}

test('página de fluxo chama o card de brief no topo (rich e chain)', () => {
  assert.match(template, /function rRich\(f\) \{\n    var html = flowBriefCard\(f\);/);
  assert.match(template, /function rChain\(f\) \{[\s\S]*?var html = flowBriefCard\(f\);/);
  assert.match(template, /data-atlas="flow-brief"/);
});

test('flowBriefCard monta o que é, o que faz, felizes, não felizes e fallbacks', () => {
  const { flowBriefCard } = loadBriefFns();
  const html = flowBriefCard({
    tag: 'HTTP · POST /v1/charges',
    resumo: 'one-liner',
    stats: [{ k: 'PASSOS', v: '3' }],
    brief: {
      what: 'Checkout dispara POST /v1/charges; a api autoriza no PSP e persiste a charge.',
      does: 'Orquestra authorize + insert + evento billing.charge.authorized.',
      happy: [{ when: 'PSP autoriza', then: 'grava authorized e publica evento', src: 'authorize.go:88' }],
      unhappy: [{ when: 'PSP timeout 4s', then: 'compensa reserva e responde 504' }],
      fallbacks: [{ when: 'PSP indisponível', then: 'retry 3× → DLQ' }],
    },
  });
  assert.match(html, /data-atlas="flow-brief"/);
  assert.match(html, /O que é/);
  assert.match(html, /O que faz/);
  assert.match(html, /Caminho feliz/);
  assert.match(html, /Caminho não feliz/);
  assert.match(html, /Fallbacks/);
  assert.match(html, /Checkout dispara POST \/v1\/charges/);
  assert.match(html, /grava authorized/);
  assert.match(html, /compensa reserva/);
  assert.match(html, /retry 3× → DLQ/);
  assert.match(html, /authorize\.go:88/);
  assert.doesNotMatch(html, /one-liner/);
});

test('sem brief.what o card cai em resumo; sem fallbacks a seção some', () => {
  const { flowBriefCard } = loadBriefFns();
  const html = flowBriefCard({
    resumo: 'Autoriza no PSP e grava a charge.',
    brief: {
      does: 'Insert + evento.',
      happy: ['autorizou'],
      unhappy: ['timeout'],
    },
  });
  assert.match(html, /Autoriza no PSP e grava a charge/);
  assert.match(html, /O que faz/);
  assert.doesNotMatch(html, /Fallbacks/);
});

test('escapa HTML no brief e aceita item string', () => {
  const { flowBriefCard, pathItems } = loadBriefFns();
  assert.deepEqual(pathItems(['só string', { when: 'a', then: 'b' }]), [
    { when: '', then: 'só string', src: '' },
    { when: 'a', then: 'b', src: '' },
  ]);
  const html = flowBriefCard({
    brief: {
      what: '<script>alert(1)</script>',
      does: 'x',
      happy: ['ok'],
      unhappy: ['<img src=x onerror=alert(1)>'],
    },
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x/);
});

test('sem brief, resumo, stats ou tag o card não aparece', () => {
  const { flowBriefCard } = loadBriefFns();
  assert.equal(flowBriefCard({ id: 'x', steps: [] }), '');
  assert.equal(flowBriefCard(null), '');
});

test('atlas_build avisa brief incompleto e silencia quando brief está cheio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-brief-'));
  const incomplete = path.join(dir, 'incomplete.json');
  const complete = path.join(dir, 'complete.json');
  fs.writeFileSync(incomplete, JSON.stringify(baseModel({})));
  fs.writeFileSync(complete, JSON.stringify(baseModel({
    brief: {
      what: 'Checkout → authorize → charge.',
      does: 'Autoriza no PSP e persiste.',
      happy: [{ when: 'ok', then: 'grava' }],
      unhappy: [{ when: 'timeout', then: '504' }],
    },
  })));

  const bad = spawnSync('python3', [buildPy, incomplete, '--check-only'], { encoding: 'utf8' });
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stderr, /brief incompleto \(does, happy, unhappy\)/);

  const ok = spawnSync('python3', [buildPy, complete, '--check-only'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stderr, /brief incompleto/);
});

test('build injeta o modelo com brief no HTML', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-brief-html-'));
  const modelPath = path.join(dir, 'app-model.json');
  const out = path.join(dir, 'index.html');
  fs.writeFileSync(modelPath, JSON.stringify(baseModel({
    brief: {
      what: 'Checkout dispara a cobrança imediata.',
      does: 'Autoriza, grava, publica evento.',
      happy: [{ when: 'PSP autoriza', then: 'charge authorized' }],
      unhappy: [{ when: 'timeout', then: '504' }],
      fallbacks: [{ when: 'PSP down', then: 'DLQ' }],
    },
  })));
  const r = spawnSync('python3', [buildPy, modelPath, '--template', templatePath, '-o', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /data-atlas="flow-brief"/);
  assert.match(html, /Checkout dispara a cobrança imediata/);
  assert.match(html, /"fallbacks":\[\{"when":"PSP down","then":"DLQ"\}/);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '..', '..', '..', '..', '..');
const ciLocalPath = path.join(repoRoot, 'scripts', 'ci-local.sh');
const ciLocal = readFileSync(ciLocalPath, 'utf8');
const pom = readFileSync(path.join(repoRoot, 'backend', 'pom.xml'), 'utf8');
function profile(id) {
  return pom.match(new RegExp(`<profile>\\s*<id>${id}<\\/id>[\\s\\S]*?<\\/profile>`))?.[0];
}

const agendaProfile = profile('agenda-mutation');
const assinaturaProfile = profile('assinatura-otp-mutation');

test('o glob dos instrumentos inclui o teste do build-report', () => {
  assert.match(
    ciLocal,
    /node --test \.claude\/skills\/ultra-deep-audit\/scripts\/tests\/\*\.test\.mjs/,
  );
  assert.equal(
    existsSync(path.join(testsDir, 'build-report.test.mjs')),
    true,
    'build-report.test.mjs precisa morar no diretório coberto pelo glob do ci-local.sh',
  );
});

test('o piso nominal do reparo de agenda exige os três métodos do IT', () => {
  assert.equal(
    ciLocal.includes('[ "$REPARO_TESTES" -ge 3 ]'),
    true,
    'um relatório com só 1 ou 2 dos 3 métodos não pode deixar o gate verde',
  );
});

test('agenda-mutation preserva o núcleo já medido e acrescenta as correções desta onda', () => {
  assert.match(ciLocal, /agenda-mutation:[^\n]*Agendamento/);
  assert.ok(agendaProfile, 'o profile agenda-mutation precisa existir no pom.xml');

  for (const classe of [
    'AgendamentoService',
    'AgendamentoWriteSupport',
    'AgendamentoStatusService',
    'AgendamentoValidationService',
    'AgendamentoValidationDomainService',
  ]) {
    assert.match(
      agendaProfile,
      new RegExp(`<param>com\\.appgp\\.backend\\..*\\.${classe}<\\/param>`),
      `targetClasses precisa conter ${classe}`,
    );
  }

  for (const teste of [
    'AgendamentoServiceTest',
    'AgendamentoServiceAvailabilityTest',
    'AgendamentoStatusServiceTest',
    'AgendamentoValidationServiceTest',
    'AgendamentoValidationDomainServiceTest',
  ]) {
    assert.match(agendaProfile, new RegExp(`<param>.*\\.${teste}<\\/param>`));
  }
});

test('assinatura-otp-mutation mede o caminho PKCS#12 real e o diff o dispara', () => {
  assert.ok(assinaturaProfile, 'o profile assinatura-otp-mutation precisa existir no pom.xml');

  for (const classe of ['PadesSignatureService', 'PfxValidationService', 'Pkcs12KeyMaterial']) {
    assert.match(
      assinaturaProfile,
      new RegExp(`<param>com\\.appgp\\.backend\\..*\\.${classe}<\\/param>`),
      `targetClasses precisa conter ${classe}`,
    );
    assert.match(
      ciLocal,
      new RegExp(`assinatura-otp-mutation:[^\\n]*${classe}`),
      `mudança em ${classe} precisa disparar o profile`,
    );
  }

  for (const teste of ['PadesSignatureServiceTest', 'PfxValidationServiceTest']) {
    assert.match(assinaturaProfile, new RegExp(`<param>.*\\.${teste}<\\/param>`));
  }

  assert.match(assinaturaProfile, /<mutationThreshold>80<\/mutationThreshold>/);
  assert.match(assinaturaProfile, /<failWhenNoMutations>true<\/failWhenNoMutations>/);
  assert.match(assinaturaProfile, /<param>pitest-excluded<\/param>/);
});

test('todo perfil extra passa pelo verificador de integridade do mutations.xml', () => {
  assert.match(
    ciLocal,
    /rodar_pitest "pitest -P\$perfil" "\/tmp\/ci-local-pit-\$perfil\.log" "-P\$perfil"/,
  );
  assert.match(ciLocal, /checar_pitest_xml "\$xml" "\$gerados" "\$mortos"/);
});

function runPitestVerifier(xmlPath, generated, killed) {
  const args = ['--verificar-xml-pitest', xmlPath];
  if (generated !== undefined) args.push(String(generated));
  if (killed !== undefined) args.push(String(killed));
  const result = spawnSync(ciLocalPath, args, { encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function withMutationXml(contents, assertion) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-local-pitest-'));
  const xmlPath = path.join(dir, 'mutations.xml');
  try {
    writeFileSync(xmlPath, contents);
    assertion(xmlPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('verificador real rejeita mutations.xml ausente', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-local-pitest-missing-'));
  try {
    const result = runPitestVerifier(path.join(dir, 'missing.xml'));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /mutations\.xml ausente/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verificador real rejeita relatório vazio', () => {
  withMutationXml('<mutations/>', (xmlPath) => {
    const result = runPitestVerifier(xmlPath);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /sem nenhum <mutation>/);
  });
});

test('verificador real rejeita todos os RUN_ERROR, inclusive com aspas simples e na mesma linha', () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='RUN_ERROR' numberOfTestsRun='0'/><mutation detected='true' status='RUN_ERROR' numberOfTestsRun='0'/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 2);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /2 mutante\(s\) RUN_ERROR/);
    },
  );
});

test('verificador real rejeita MEMORY_ERROR com aspas duplas', () => {
  withMutationXml(
    '<mutations><mutation detected="true" status="MEMORY_ERROR" numberOfTestsRun="0"/></mutations>',
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 1, 1);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /1 MEMORY_ERROR/);
    },
  );
});

test('verificador real rejeita divergência no total gerado', () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='KILLED'/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 1);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /stdout diz 2 mutantes gerados.*traz 1/);
    },
  );
});

test('verificador real rejeita mortos divergentes de KILLED mais TIMED_OUT', () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='KILLED'/><mutation detected='false' status='SURVIVED'/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 2);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /stdout conta 2 mortos.*só tem 1 KILLED \+ 0 TIMED_OUT/);
    },
  );
});

test('verificador real aceita somente relatório coerente com aspas mistas e múltiplos mutantes por linha', () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='KILLED'/><mutation detected=\"true\" status=\"TIMED_OUT\"/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 2);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /2 mutantes: 1 KILLED \+ 1 TIMED_OUT, 0 RUN_ERROR\/MEMORY_ERROR/);
    },
  );
});

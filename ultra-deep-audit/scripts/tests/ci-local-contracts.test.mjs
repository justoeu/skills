import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import nodeTest from "node:test";
import {
  integrationRoot,
  createIntegrationProject,
} from "./project-integration-fixture.mjs";
const test = (name, fn) =>
  nodeTest(
    name,
    {
      skip:
        !integrationRoot &&
        "project integration not run; set ULTRA_PROJECT_ROOT explicitly",
    },
    fn,
  );
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const project = createIntegrationProject();
const repoRoot = project?.root || "/nonexistent-ultra-integration";
const ciLocalPath = path.join(repoRoot, "scripts", "ci-local.sh");
const ciLocal = integrationRoot ? readFileSync(ciLocalPath, "utf8") : "";
const pom = integrationRoot
  ? readFileSync(path.join(repoRoot, "backend", "pom.xml"), "utf8")
  : "";
function profile(id) {
  return pom.match(
    new RegExp(`<profile>\\s*<id>${id}<\\/id>[\\s\\S]*?<\\/profile>`),
  )?.[0];
}

const agendaProfile = profile("agenda-mutation");
const assinaturaProfile = profile("assinatura-otp-mutation");

test("o glob dos instrumentos inclui o teste do build-report", () => {
  assert.match(
    ciLocal,
    /node --test \.claude\/skills\/ultra-deep-audit\/scripts\/tests\/\*\.test\.mjs/,
  );
  assert.equal(
    existsSync(path.join(testsDir, "build-report.test.mjs")),
    true,
    "build-report.test.mjs precisa morar no diretório coberto pelo glob do ci-local.sh",
  );
});

function executable(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}
function runSelectedFunctions(body, env = {}) {
  return spawnSync("bash", ["-c", 'source "$CI_LOCAL_PATH"; ' + body], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10000,
    env: { ...project.env, CI_LOCAL_PATH: ciLocalPath, ...env },
  });
}

test("migrações manifestadas exigem todos os XMLs nominais e testes realmente executados", () => {
  // The former three-method MySQL repair was replaced by the PostgreSQL manifest.
  // Exercise its real gate with three declared migrations; Maven/Docker are fixtures only.
  const tools = path.join(repoRoot, "sql-contract-tools");
  mkdirSync(tools, { recursive: true });
  const classes = ["One", "Two", "Three"].map(
    (name) => `com.appgp.backend.${name}IT`,
  );
  const manifest =
    classes.map((name, i) => `V${i + 1}.sql\t${name}`).join("\n") + "\n";
  mkdirSync(path.join(repoRoot, "sqls/postgres"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "sqls/postgres-real-it-manifest.tsv"),
    manifest,
  );
  for (const [i, name] of classes.entries()) {
    writeFileSync(
      path.join(repoRoot, `sqls/postgres/V${i + 1}.sql`),
      "-- fixture only\n",
    );
    const file = path.join(
      repoRoot,
      "backend/src/test/java",
      name.replaceAll(".", "/") + ".java",
    );
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "// fixture only\n");
  }
  executable(
    path.join(tools, "docker"),
    '#!/usr/bin/env bash\n[ "$*" = info ]\n',
  );
  executable(
    path.join(tools, "mvn"),
    `#!/usr/bin/env bash
set -eu
build=''
for arg in "$@"; do case "$arg" in -Dci.local.focused.build=*) build="\${arg#*=}";; esac; done
[ -n "$build" ] || exit 98
mkdir -p "$build/surefire-reports"
n=0
for name in com.appgp.backend.OneIT com.appgp.backend.TwoIT com.appgp.backend.ThreeIT; do
  n=$((n+1)); [ "$n" -le "$REPORT_COUNT" ] || continue
  printf '<testsuite tests="1" failures="%s" errors="0" skipped="%s"></testsuite>\\n' "$REPORT_FAILURES" "$REPORT_SKIPPED" > "$build/surefire-reports/TEST-$name.xml"
done
`,
  );
  for (const [count, skipped, failures, pass] of [
    [0, 0, 0, false],
    [1, 0, 0, false],
    [2, 0, 0, false],
    [3, 1, 0, false],
    [3, 0, 1, false],
    [3, 0, 0, true],
  ]) {
    const r = runSelectedFunctions(
      'rodar_sql_real_its; [ "\${#FALHAS[@]}" -eq 0 ] && [ "$OKS" -eq 1 ] && [ "\${#PULADOS[@]}" -eq 0 ]',
      {
        PATH: `${tools}:${project.env.PATH}`,
        REPORT_COUNT: String(count),
        REPORT_SKIPPED: String(skipped),
        REPORT_FAILURES: String(failures),
        TMPDIR: repoRoot,
      },
    );
    assert.equal(r.error, undefined, r.error?.message);
    assert.equal(
      r.status === 0,
      pass,
      `count=${count} skipped=${skipped} failures=${failures}: ${r.stdout}${r.stderr}`,
    );
    assert.match(
      r.stdout,
      pass ? /3 ITs, 3 testes/ : /XML nominal ausente|surefire:/,
    );
  }
});

test("agenda-mutation preserva o núcleo já medido e acrescenta as correções desta onda", () => {
  assert.match(ciLocal, /agenda-mutation:[^\n]*Agendamento/);
  assert.ok(
    agendaProfile,
    "o profile agenda-mutation precisa existir no pom.xml",
  );

  for (const classe of [
    "AgendamentoService",
    "AgendamentoWriteSupport",
    "AgendamentoStatusService",
    "AgendamentoValidationService",
    "AgendamentoValidationDomainService",
  ]) {
    assert.match(
      agendaProfile,
      new RegExp(`<param>com\\.appgp\\.backend\\..*\\.${classe}<\\/param>`),
      `targetClasses precisa conter ${classe}`,
    );
  }

  for (const teste of [
    "AgendamentoServiceTest",
    "AgendamentoServiceAvailabilityTest",
    "AgendamentoStatusServiceTest",
    "AgendamentoValidationServiceTest",
    "AgendamentoValidationDomainServiceTest",
  ]) {
    assert.match(agendaProfile, new RegExp(`<param>.*\\.${teste}<\\/param>`));
  }
});

test("assinatura-otp-mutation mede o caminho PKCS#12 real e o diff o dispara", () => {
  assert.ok(
    assinaturaProfile,
    "o profile assinatura-otp-mutation precisa existir no pom.xml",
  );

  for (const classe of [
    "PadesSignatureService",
    "PfxValidationService",
    "Pkcs12KeyMaterial",
  ]) {
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

  for (const teste of [
    "PadesSignatureServiceTest",
    "PfxValidationServiceTest",
  ]) {
    assert.match(
      assinaturaProfile,
      new RegExp(`<param>.*\\.${teste}<\\/param>`),
    );
  }

  assert.match(assinaturaProfile, /<mutationThreshold>80<\/mutationThreshold>/);
  assert.match(
    assinaturaProfile,
    /<failWhenNoMutations>true<\/failWhenNoMutations>/,
  );
  assert.match(assinaturaProfile, /<param>pitest-excluded<\/param>/);
});

test("todo perfil extra executa o verificador de mutations.xml antes de aceitar Maven verde", () => {
  const profiles = [
    ...ciLocal.matchAll(/"([a-z0-9-]+-mutation):([A-Za-z0-9_]+)[^"\n]*"/g),
  ].map((m) => ({ profile: m[1], target: m[2] }));
  assert.ok(
    profiles.length >= 4,
    "expected explicit conditional mutation profiles",
  );
  const tools = path.join(repoRoot, "pit-contract-tools");
  mkdirSync(tools, { recursive: true });
  const calls = path.join(tools, "calls.txt");
  executable(
    path.join(tools, "mvn"),
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$PIT_CALLS"
mkdir -p target/pit-reports
printf '<mutations><mutation detected="true" status="%s" numberOfTestsRun="1"/></mutations>\\n' "$PIT_STATUS" > target/pit-reports/mutations.xml
printf 'Generated 1 mutations Killed 1 (100.00%%)\\n'
`,
  );
  const changed = profiles
    .map((p) => `backend/src/main/java/example/${p.target}.java`)
    .join("\n");
  for (const status of ["RUN_ERROR", "KILLED"]) {
    writeFileSync(calls, "");
    const r = runSelectedFunctions(
      'BACKEND_TARGET_FRESCO=1; arquivos_do_branch() { printf "%s\\n" "$PIT_CHANGED"; }; passo_pitest_perfis; printf "CONTRACT_RESULT %s %s\\n" "\${#FALHAS[@]}" "$OKS"',
      {
        PATH: `${tools}:${project.env.PATH}`,
        PIT_CALLS: calls,
        PIT_CHANGED: changed,
        PIT_STATUS: status,
      },
    );
    assert.equal(r.status, 0, r.stderr);
    const actual = readFileSync(calls, "utf8").trim().split("\n");
    assert.equal(actual.length, profiles.length, r.stdout);
    for (const p of profiles)
      assert.ok(
        actual.some((line) => line.includes(`-P${p.profile} `)),
        p.profile,
      );
    assert.match(
      r.stdout,
      new RegExp(
        `CONTRACT_RESULT ${status === "RUN_ERROR" ? profiles.length : 0} ${status === "KILLED" ? profiles.length : 0}`,
      ),
    );
    if (status === "RUN_ERROR") assert.match(r.stdout, /NUNCA EXECUTADOS/);
  }
});

function runPitestVerifier(xmlPath, generated, killed) {
  const args = ["--verificar-xml-pitest", xmlPath];
  if (generated !== undefined) args.push(String(generated));
  if (killed !== undefined) args.push(String(killed));
  const result = spawnSync(ciLocalPath, args, {
    encoding: "utf8",
    cwd: repoRoot,
    env: project.env,
    timeout: 10000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function withMutationXml(contents, assertion) {
  const dir = mkdtempSync(path.join(tmpdir(), "ci-local-pitest-"));
  const xmlPath = path.join(dir, "mutations.xml");
  try {
    writeFileSync(xmlPath, contents);
    assertion(xmlPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("verificador real rejeita mutations.xml ausente", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ci-local-pitest-missing-"));
  try {
    const result = runPitestVerifier(path.join(dir, "missing.xml"));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /mutations\.xml ausente/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verificador real rejeita relatório vazio", () => {
  withMutationXml("<mutations/>", (xmlPath) => {
    const result = runPitestVerifier(xmlPath);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /sem nenhum <mutation>/);
  });
});

test("verificador real rejeita todos os RUN_ERROR, inclusive com aspas simples e na mesma linha", () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='RUN_ERROR' numberOfTestsRun='0'/><mutation detected='true' status='RUN_ERROR' numberOfTestsRun='0'/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 2);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /2 mutante\(s\) RUN_ERROR/);
    },
  );
});

test("verificador real rejeita MEMORY_ERROR com aspas duplas", () => {
  withMutationXml(
    '<mutations><mutation detected="true" status="MEMORY_ERROR" numberOfTestsRun="0"/></mutations>',
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 1, 1);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /1 MEMORY_ERROR/);
    },
  );
});

test("verificador real rejeita divergência no total gerado", () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='KILLED'/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 1);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /stdout diz 2 mutantes gerados.*traz 1/);
    },
  );
});

test("verificador real rejeita mortos divergentes de KILLED mais TIMED_OUT", () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='KILLED'/><mutation detected='false' status='SURVIVED'/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 2);
      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /stdout conta 2 mortos.*só tem 1 KILLED \+ 0 TIMED_OUT/,
      );
    },
  );
});

test("verificador real aceita somente relatório coerente com aspas mistas e múltiplos mutantes por linha", () => {
  withMutationXml(
    "<mutations><mutation detected='true' status='KILLED'/><mutation detected=\"true\" status=\"TIMED_OUT\"/></mutations>",
    (xmlPath) => {
      const result = runPitestVerifier(xmlPath, 2, 2);
      assert.equal(result.status, 0);
      assert.match(
        result.stdout,
        /2 mutantes: 1 KILLED \+ 1 TIMED_OUT, 0 RUN_ERROR\/MEMORY_ERROR/,
      );
    },
  );
});

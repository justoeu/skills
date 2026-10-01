---
name: make-me-happy
description: >
  Implementa feature, refactor ou greenfield. Se não houver SDD, Etapa Zero
  explora com perguntas e escreve o spec. Com spec: TASKS rastreáveis, red→green em cada
  tarefa, testes de imutabilidade, git worktrees (default 3, --worktree N),
  review em 3 eixos (Standards/Fowler, Spec, Correctness) com consenso 3/3,
  loop full ou por task, HTML interativo com fluxo, payloads e score 10.
  Greenfield, feature ou refactor. Agnóstica de host e de stack.
  Trigger: /make-me-happy, /mmh, mmh, implementar SDD, red to green,
  worktree, --loop full|task, --worktree, --cobertura, make me happy.
compatibility: Requires git and Node.js for scripts. Any coding agent that can read this SKILL.md, run bash/node, and spawn subagents (or run slices inline).
metadata:
  aliases: mmh
---

# Make Me Happy

Orquestra implementação de feature, refactor ou greenfield. Agnóstica de host (Claude, Grok, Codex, Cursor, opencode) e de stack.

`SKILL_ROOT` = diretório deste `SKILL.md` (seguir symlink). Alias de invocação: **`/mmh`**.

Não é auditoria. **Não exige SDD na entrada.** Sem spec (feature nova ou refactor): **Etapa Zero** — perguntas, escrever o SDD, confirmar, só então Planner. Com `--spec` ou arquivo encontrado: pula a Etapa Zero. Depois que o SDD existe (achado ou escrito aqui), a regra **Só o SDD** vale.

## Flags

| Flag | Efeito |
|------|--------|
| `--worktree N` | quantidade de git worktrees. Default **3** (faixa 3–4). Clamp 1..8 |
| `--spec PATH` | spec/SDD explícito |
| `--loop full` | implementa todas as tasks e só pergunta ao bloquear |
| `--loop task` | pergunta se continua **após cada** task |
| `--kind greenfield\|feature\|refactor` | senão o Planner detecta |
| `--fresh` | ignora pack/worktrees abertos e começa uma run nova |
| `--into feature/<name>` | branch-base das slices e alvo do merge. **Nunca** `main`/`master`/`trunk` |
| `--cobertura N` | piso de cobertura. Default **90**. Só sobe (`--cobertura 95` ou `95%`). N < 90 → fica 90 |

`--mode` não existe nesta skill. `/mmh` = `/make-me-happy`. Worktree **não** é opcional: sempre tenta git worktree; se o repo não for git, implementa no working tree (`N=1`) e diz isso no REPORT.

Se o working tree estiver em branch protegida (`main`/`master`/`trunk`) e `--into` não veio, `add` cria `feature/mmh-YYYYMMDD` e faz checkout nela **antes** de abrir slices. Merge recusa alvo protegido.

## Dispatch

Cada papel é um subagente. Use o que o host oferecer (`Task`, `spawn_subagent`, equivalente). Sem ferramenta: rode o prompt **inline**. Prompt = `agents/<id>.md` + contexto (`OUT`, spec, `WORKTREE_I`).

## Início — resume (antes de qualquer pergunta)

```bash
node "$SKILL_ROOT/scripts/resume.mjs" --root . --prefix mmh
```

Se `resumable: true` e **não** veio `--fresh`:

1. Diga ao usuário **qual pack** e **qual passo** (`next_step`) está sendo retomado. Não pergunte loop/seguir — reuse `loop`/`spec`/`worktree_n` do `run-meta.json`.
2. `OUT` = `pack`. **Não** crie worktrees novos se `leftover_worktrees` não estiver vazio.
3. Salte para o passo correspondente:

| `next_step` | ir para |
|-------------|---------|
| `explore` | §0z Etapa Zero |
| `planner` | §1 |
| `worktrees-add` | §2 |
| `implement` | §3 |
| `immutability` | §4 |
| `review` | §5 |
| `score` | §6 |
| `clean` | §7 |
| `closed` | mostrar HTML se existir; parar |

Se `pack` é null mas há leftover worktrees (crash antes do pack): crie `OUT` do dia, grave `worktrees.json` a partir de `leftover_worktrees` (index pelo sufixo `mmh-<i>`), `next_step=implement`.

`--fresh` com leftover: avise que vai **abandonar** as slices abertas (`worktrees.mjs remove`) e só então comece do zero.

## Início — duas perguntas (só run nova)

Obrigatório se flags omitidas **e** não está retomando:

1. **Loop:** implementação completa (`full`) ou parar para confirmar **a cada task** (`task`)?
2. **Seguir agora?** (sim / não). Não = gravar `$OUT/` com o plano e parar.

Se o host tem pergunta estruturada, use. Senão, pergunte em texto e espere.

## Só o SDD (inegociável)

Implementar **exatamente** o que o SDD/spec pediu. Nada além, nada “melhor” no lugar.

- Não inferir tomada de decisão. Se o spec admite **mais de um** caminho (lib, schema, API, nome, fluxo, persistência) e há dúvida — **pergunte e espere**. Não escolha “a mais razoável” em silêncio.
- Buraco, conflito ou ambiguidade no spec → pergunta. Não preencher o buraco.
- Planner com dúvida: pode escrever `TASKS.json`, **não** despacha implementer até a resposta.
- Implementer com dúvida no meio da slice: **para**, pergunta; não commita a escolha.

## Red → green (inegociável)

Cada task:

```
teste que falha → RED
fix mínimo → GREEN
prova por reversão quando viável
tests_added += N   (N = testes novos/alterados desta task)
```

Sem teste vermelho-antes, a task **não** é `DONE`.

## Cobertura ≥ 90% (inegociável; só sobe)

Piso **90%**. `--cobertura N` (ou `N%`) **só aumenta** o piso; `N < 90` é ignorado (fica 90). Grave `coverage_floor` no `run-meta.json`.

Medida da ferramenta do repo (JaCoCo, c8/istanbul, go cover, coverage.py, …) sobre o código de produto tocado — **não** “90% das tasks têm teste”.

Grave `$OUT/coverage.json`:

```json
{ "pct": 92.4, "tool": "c8", "report": "coverage/index.html", "floor": 90 }
```

`pct` ausente ou `< piso` → pack **não** fecha, mesmo com os 5 gates em 10. Falta medir = não cumpriu.

## Baseline verde (inegociável)

**Nunca empilhar trabalho sobre baseline vermelha.**

A suite **já existente** em `into` (antes de escrever o RED da task) tem de estar verde.

| | Baseline | RED da task |
|---|----------|-------------|
| O que é | testes que **já estavam** no repo | o teste **novo** que prova a task |
| Se falha | **parar**. Não abrir slice, não implementar feature | esperado; aí o GREEN |

Se `test_cmd` no `into` sai ≠ 0: não rode `add`, não despache implementer, não “consertar junto” com a feature. Primeiro a baseline; depois o pack. Resume: se a `into` ficou vermelha no meio, pare do mesmo jeito.

## Score 10 (inegociável para fechar)

`scripts/score.mjs` é a fonte. Cada gate vale 0 ou 2; fechar só com **10 e cobertura ≥ piso** (90, ou `--cobertura` se maior):

| Gate | +2 se |
|------|--------|
| tasks | todas `DONE` |
| red-green | cada DONE tem `tests_added >= 1` e `red_green` |
| immutability | `$OUT/immutability.json` `green: true` |
| review | 3 eixos `APPROVE` (Spec pode ser `SKIP` se o usuário disse que não há spec — conta como gate pago) |
| worktrees | todas as slices mergeadas e `worktrees.mjs verify-clean` ok |

Score < 10 **ou** cobertura < piso → corrigir e re-rodar. Não negociar 9 nem 89%. `--cobertura 80` não baixa o piso.

**Score 10 fecha o pack da skill, não o “done” do projeto.** Os 3 eixos (Standards / Spec / Correctness) **não** substituem gates que o repo documentar em `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` (ex.: trio code-reviewer + test-analyzer + security-review, sweep docs/i18n). Depois do HTML: listar esses gates e rodá-los, ou deixá-los OPEN no relatório. Não abrir PR só com score 10 se o repo exige o outro conjunto.

---

## Passos

### 0. Setup

```bash
DATE=$(date +%Y-%m-%d)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo no-git)
OUT=docs/impl/make-me-happy/${DATE}-${BRANCH}
mkdir -p "$OUT/reviews"
N=${WORKTREE_N:-3}
# clamp 1..8
```

`run-meta.json`: `app`, `branch`, `head`, `kind`, `loop`, `worktree_n`, `spec`, `coverage_floor`, `status` (`in_progress` | `closed`), `started_at`, `steps`. Atualize `status` ao avançar de passo; `closed` só com score 10 + cobertura ≥ piso + worktrees limpos. `coverage_floor` = `max(90, --cobertura)`.

**Spec.** Se `--spec` veio, use. Senão procure arquivo sob `docs/`, `Docs/`, `specs/`, `.scratch/`, `Docs/SDD/`, `.planning/` cujo nome case a branch ou o feature. Achou → `run-meta.spec`, pule §0z. **Não achou → §0z. Não pule para o Planner e não marque Spec SKIP.**

**Timeline.** Ao entrar e ao sair de cada passo (§0z…§8), grave o carimbo. O HTML monta a linha do tempo a partir disso:

```bash
node "$SKILL_ROOT/scripts/run-meta.mjs" step --dir "$OUT" --step planner --status in_progress
node "$SKILL_ROOT/scripts/run-meta.mjs" step --dir "$OUT" --step planner --status done --note "24 tasks"
```

Passos: `explore planner worktrees implement immutability review score clean project-gates`. Status: `in_progress` | `done` | `failed` | `skipped`.

**Schemas do pack:** `references/pack-schemas.md`, a fonte de todo arquivo em `$OUT/`. O `build-report.mjs` imprime `WARN` para cada desvio. Warning = escritor errado, não leitor.

Stack: `package.json` / `go.mod` / `pom.xml` / `*.csproj` / `Cargo.toml` / `pyproject.toml` — grave o comando de teste do repo em `run-meta.json.test_cmd`.

### 0z. Etapa Zero — explorar e escrever o SDD

Quando **não** há spec. Feature nova e refactor entram aqui do mesmo jeito.

Subagente `agents/explorer.md` (ou o Oracle no mesmo papel): perguntas em sequência, draft do SDD, confirmação do usuário, arquivo no repo.

`run-meta.spec_status`: `draft` enquanto não confirmar; `confirmed` + `spec` = path depois. Resume com `draft` volta para cá.

**Proibido:** começar tasks/worktrees/código com `spec_status=draft` ou sem `spec`. **Proibido:** Spec `SKIP` só porque “não tinha SDD no começo” — a Etapa Zero **cria** o SDD.

### 1. Planner

Subagente `agents/planner.md`. Produz `TASKS.json` + `TASKS.md` + `flow.mmd` + `payloads.json` (schema canônico; `[]` só se o spec não define contrato) + `spec-summary.md` e, opcionalmente, `diagrams/<T-xxx>.mmd`.

Ajuste `N` para `min(N, count(worktree ids distintos))`. Zero tasks → pare.

Mostre o `TASKS.md` ao usuário. Se loop=`task` ou a pergunta 2 foi “não”, **pare aqui**.

### 2. Worktrees

```bash
# --into: branch do PR. Se HEAD é main/master/trunk e --into omitido, o script cria feature/mmh-YYYYMMDD.
node "$SKILL_ROOT/scripts/worktrees.mjs" add --root . --count "$N" --prefix mmh --into "$INTO" --test-cmd "$TEST_CMD" --out "$OUT"
```

`$INTO` = `--into` do usuário, ou nome derivado do spec (`feature/<slug>`), **nunca** a default branch. Diga o nome da branch ao usuário antes de `add`.

`--test-cmd` na `into` **antes** de criar slices. Vermelho → o script recusa (`Never stack work on a red baseline`) e **não** abre worktree. Sem `test_cmd` conhecido, rode o que o repo usa e só então `add`.

O script cria `.worktrees/mmh-<i>` + branches `mmh/slice-<i>`, grava `$OUT/worktrees.json` (`into` = alvo do merge). Se o dir da slice **já existe** (crash), não rode `add` de novo — retome no implementer.

Se anexar `.worktrees/` ao `.gitignore` (arquivo versionado), o script imprime `NOTE: appended .worktrees/ … include in the PR` e `gitignore_appended: true` no JSON. **Mostre isso ao usuário.** É alteração legítima do PR — não commitar escondido e não reverter.

Se `git worktree` falhar: `N=1`, implementar na feature branch (ainda assim **não** em main), registrar `worktree: false` no meta. Não inventar worktree.

**Merge não é opcional.** Nenhuma slice fica aberta no closeout. Merge é **sempre** em `worktrees.json.into`, não em `HEAD` se `HEAD` for protegida.

### 3. Implementar

Para cada worktree `i` em paralelo (subagente `agents/implementer.md`, `cwd` = dir da worktree se o host permitir):

- só tasks com `"worktree": i`
- red→green, com evidência por task no `TASKS.json`: `red{test, output_excerpt}`, `green`, `reversal`, `tests`, `files`, `commits`
- commits na slice branch

**Loop `task`:** após cada task, pergunte se continua. Não = merge do que já está verde, score, HTML parcial, pare.

**Loop `full`:** só interrompa se RED não existir, merge conflitar, testes da slice falharem, **ou** surgir escolha que o SDD não fecha (pergunte; não decida).

Após cada slice verde (ou no fim, se `full`):

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" merge --root . --index i --test-cmd "$TEST_CMD" --out "$OUT"
```

O script faz checkout de `into` e recusa `main`/`master`/`trunk`. Merge **só** se o test-cmd na worktree saiu 0. Conflito → pare e reporte; não `--ours`.

### 4. Imutabilidade

Subagente `agents/immutability.md` no working tree **já mergeado** (e, em refactor, também *antes* do corte se a slice ainda não mergeou). Grava `$OUT/immutability.json` com `tests[]` estruturado (nome, task, arquivo). Tasks cobertas: `immutability: true`.

Depois do merge final, rode o `test_cmd` inteiro e grave `$OUT/tests.json`: `{cmd, ok, total, passed, failed, skipped, duration_s, suites[], log}`. O `log` leva as últimas 40 linhas.

### 5. Code review — 3 eixos em paralelo

Diff: `git log --oneline $BASE..HEAD` e `git diff $BASE...HEAD` (`$BASE` = commit de início gravado no meta).

Fontes de standards: `CODING_STANDARDS.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**/standards*`.

Spawn **ao mesmo tempo**:

| Eixo | Prompt | Extra no prompt |
|------|--------|-----------------|
| **Standards** | `agents/standards-reviewer.md` | lista de arquivos de standard **+** `catalogs/fowler-smells.md` colado **inteiro** |
| **Spec** | `agents/spec-reviewer.md` | path/conteúdo do spec (o achado **ou** o escrito na Etapa Zero). `SKIP` só se o usuário recusou explicitamente gravar qualquer spec depois da Zero |
| **Correctness** | `agents/correctness-reviewer.md` | `TASKS.json` + `immutability.json` + resultado do test-cmd |

Cada revisor grava `reviews/<eixo>.md` (prosa + `VERDICT:`) **e** `reviews/<eixo>.json` (veredito, achados com severidade/arquivo:linha/status e `rounds[]`). Em re-rodada, o revisor lê o JSON anterior, marca o que fechou como `fixed` e anexa uma rodada. O histórico não se apaga.

**Não** juntar nem rerankear achados. Apresentar ao usuário:

```
## Standards
<verbatim>
## Spec
<verbatim>
## Correctness
<verbatim>
```

Uma linha no fim: totais por eixo + pior issue de **cada** eixo. Sem vencedor global.

**Consenso:** fechar review só com 3 `APPROVE` (Spec `SKIP` conta). Qualquer `REJECT` → corrigir o eixo → re-rodar **os eixos que rejeitaram** (não os que já APPROVE, salvo o diff ter mudado o que eles viram — na dúvida, os 3 de novo).

### 6. Score + HTML

```bash
node "$SKILL_ROOT/scripts/score.mjs" --dir "$OUT"
node "$SKILL_ROOT/scripts/build-report.mjs" --dir "$OUT"
open "$OUT/report.html" 2>/dev/null || xdg-open "$OUT/report.html" 2>/dev/null || true
```

HTML (arquivo único, abre offline; o mermaid vem do CDN e, sem rede, mostra a fonte): visão geral com KPIs e linha do tempo, SDD com sumário, tasks filtráveis com evidência red→green, fluxo com zoom, payloads com cópia, testes e cobertura por módulo, review por eixo com rodadas, score com gauges, gates do projeto. Arquivo ausente vira um estado vazio que diz qual agente deveria tê-lo escrito. `--out PATH` grava em outro lugar. Mostrar path absoluto. No closeout, citar: branch `into`, se `.gitignore` ganhou `.worktrees/`, e que score 10 ≠ done do repo.

### 7. Limpar — depois do merge, nada fica

Quando **todos** os merges desta run terminaram (closeout). O `merge` de cada slice já apaga a worktree e a branch daquela slice. Mesmo assim, rode a varredura. Ela pega o que o merge não levou: branch `mmh/slice-*` órfã, pasta `.worktrees/mmh-*`, diretório `.worktrees` vazio, registro velho no `git worktree`.

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" remove --root . --prefix mmh
node "$SKILL_ROOT/scripts/worktrees.mjs" verify-clean --root . --prefix mmh
```

`verify-clean` tem de imprimir `clean`. Sobra = pack não fecha. Não apague worktree de outro prefixo.

Pare no meio do loop `task`, com slice **ainda sem merge**: não rode `remove`. Esse comando apaga também o que ainda não entrou na branch. Conflito de merge: pare; o script não remove a slice cujo merge não aconteceu.

### 8. Gates do projeto (depois do pack)

Leia `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`. Extraia o que o repo exige **além** dos 3 eixos desta skill (reviewers nomeados, `/security-review`, sweep `docs/` + i18n, “nunca commitar em main”, …).

- Rode o que o host conseguir (skills/plugins citados).
- O que não rodar → lista **OPEN** no REPORT/HTML, não silêncio.
- Grave `$OUT/project-gates.json` (`{gates: [{name, source, status: DONE|OPEN|FAILED|N/A, evidence}]}`) e re-rode `build-report.mjs`.
- PR sai da branch `into`, nunca de `main`.

Este passo **não** entra no score 10.

---

## TASKS.md (espelho)

Oracle regenera a partir de `TASKS.json` quando status muda:

```
# Tasks — <feature>

- [ ] T-001 title  | tests: 0 | red-green: no | immutability: no | wt: 1
```

`tests_added` é a qtd de testes **criados/alterados** naquela task, não cobertura %.

## Non-goals

- Começar implementação sem as duas perguntas (salvo flags `--loop` + pedido explícito, **ou resume**)
- Pular a Etapa Zero e marcar Spec `SKIP` só porque não havia SDD no repo
- Abrir um segundo pack enquanto há worktree `mmh/slice-*` ou pack `in_progress` (use `--fresh`)
- Fechar a run com worktree, branch `mmh/slice-*` ou pasta `.worktrees/mmh-*` desta run ainda no disco
- Score 10 no feeling
- Tratar score 10 como “done” do repo / substituto do trio de review do `CLAUDE.md`
- Mergear slices em `main`/`master`/`trunk`
- Empilhar feature/slice sobre suite já vermelha (“conserta junto”)
- Fechar pack com cobertura abaixo do piso (90, ou `--cobertura` se maior) ou sem `coverage.json`
- Baixar o piso de cobertura com `--cobertura` abaixo de 90
- Impor stack ou framework
- Inferir decisão de implementação quando o SDD deixa mais de um caminho
- Entregar além do que o SDD pediu
- Review de um eixo só rotulado como consenso 3/3

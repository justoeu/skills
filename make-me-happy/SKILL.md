---
name: make-me-happy
description: >
  Implementa um SDD/spec validado: TASKS rastreáveis, red→green em cada
  tarefa, testes de imutabilidade, git worktrees (default 3, --worktree N),
  review em 3 eixos (Standards/Fowler, Spec, Correctness) com consenso 3/3,
  loop full ou por task, HTML interativo com fluxo, payloads e score 10.
  Greenfield, feature ou refactor. Agnóstica de host e de stack.
  Trigger: /make-me-happy, /mmh, mmh, implementar SDD, red to green,
  worktree, --loop full|task, --worktree, make me happy.
compatibility: Requires git and Node.js for scripts. Any coding agent that can read this SKILL.md, run bash/node, and spawn subagents (or run slices inline).
metadata:
  aliases: mmh
---

# Make Me Happy

Orquestra implementação **depois** que um SDD/spec está completo e validado. Agnóstica de host (Claude, Grok, Codex, Cursor, opencode) e de stack.

`SKILL_ROOT` = diretório deste `SKILL.md` (seguir symlink). Alias de invocação: **`/mmh`**.

Não é auditoria. Não começa sem spec (a menos que o usuário diga que não há — aí o eixo Spec é `SKIP` e o restante segue).

## Flags

| Flag | Efeito |
|------|--------|
| `--worktree N` | quantidade de git worktrees. Default **3** (faixa 3–4). Clamp 1..8 |
| `--spec PATH` | spec/SDD explícito |
| `--loop full` | implementa todas as tasks e só pergunta ao bloquear |
| `--loop task` | pergunta se continua **após cada** task |
| `--kind greenfield\|feature\|refactor` | senão o Planner detecta |
| `--fresh` | ignora pack/worktrees abertos e começa uma run nova |

`--mode` não existe nesta skill. `/mmh` = `/make-me-happy`. Worktree **não** é opcional: sempre tenta git worktree; se o repo não for git, implementa no working tree (`N=1`) e diz isso no REPORT.

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

## Red → green (inegociável)

Cada task:

```
teste que falha → RED
fix mínimo → GREEN
prova por reversão quando viável
tests_added += N   (N = testes novos/alterados desta task)
```

Sem teste vermelho-antes, a task **não** é `DONE`.

## Score 10 (inegociável para fechar)

`scripts/score.mjs` é a fonte. Cada gate vale 0 ou 2; fechar só com **10**:

| Gate | +2 se |
|------|--------|
| tasks | todas `DONE` |
| red-green | cada DONE tem `tests_added >= 1` e `red_green` |
| immutability | `$OUT/immutability.json` `green: true` |
| review | 3 eixos `APPROVE` (Spec pode ser `SKIP` se o usuário disse que não há spec — conta como gate pago) |
| worktrees | todas as slices mergeadas e `worktrees.mjs verify-clean` ok |

Score < 10 → corrigir e re-rodar o eixo que falhou. Não negociar 9.

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

`run-meta.json`: `app`, `branch`, `head`, `kind`, `loop`, `worktree_n`, `spec`, `status` (`in_progress` | `closed`). Atualize `status` ao avançar de passo; `closed` só com score 10 + worktrees limpos.

**Spec.** Se `--spec` veio, use. Senão procure arquivo sob `docs/`, `Docs/`, `specs/`, `.scratch/`, `Docs/SDD/`, `.planning/` cujo nome case a branch ou o feature. Nada encontrado → **pergunte**. Usuário diz que não há → Spec sub-agent `SKIP` (`no spec available`); Planner ainda precisa de um objetivo em uma frase — peça.

Stack: `package.json` / `go.mod` / `pom.xml` / `*.csproj` / `Cargo.toml` / `pyproject.toml` — grave o comando de teste do repo em `run-meta.json.test_cmd`.

### 1. Planner

Subagente `agents/planner.md`. Produz `TASKS.json` + `TASKS.md` + `flow.mmd` + `payloads.json` + `spec-summary.md`.

Ajuste `N` para `min(N, count(worktree ids distintos))`. Zero tasks → pare.

Mostre o `TASKS.md` ao usuário. Se loop=`task` ou a pergunta 2 foi “não”, **pare aqui**.

### 2. Worktrees

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" add --root . --count "$N" --prefix mmh --out "$OUT"
```

O script cria `.worktrees/mmh-<i>` + branches `mmh/slice-<i>`, anexa `.worktrees/` ao `.gitignore` se faltar, grava `$OUT/worktrees.json`. Se o dir da slice **já existe** (crash), não rode `add` de novo — retome no implementer.

Se `git worktree` falhar: `N=1`, implementar no working tree, registrar `worktree: false` no meta. Não inventar worktree.

**Merge não é opcional.** Nenhuma slice fica aberta no closeout.

### 3. Implementar

Para cada worktree `i` em paralelo (subagente `agents/implementer.md`, `cwd` = dir da worktree se o host permitir):

- só tasks com `"worktree": i`
- red→green
- commits na slice branch

**Loop `task`:** após cada task, pergunte se continua. Não = merge do que já está verde, score, HTML parcial, pare.

**Loop `full`:** só interrompa se RED não existir, merge conflitar, ou testes da slice falharem.

Após cada slice verde (ou no fim, se `full`):

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" merge --root . --index i --test-cmd "$TEST_CMD" --out "$OUT"
```

Merge **só** se o test-cmd na worktree saiu 0. Conflito → pare e reporte; não `--ours`.

### 4. Imutabilidade

Subagente `agents/immutability.md` no working tree **já mergeado** (e, em refactor, também *antes* do corte se a slice ainda não mergeou). Grava `$OUT/immutability.json`. Tasks cobertas: `immutability: true`.

### 5. Code review — 3 eixos em paralelo

Diff: `git log --oneline $BASE..HEAD` e `git diff $BASE...HEAD` (`$BASE` = commit de início gravado no meta).

Fontes de standards: `CODING_STANDARDS.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**/standards*`.

Spawn **ao mesmo tempo**:

| Eixo | Prompt | Extra no prompt |
|------|--------|-----------------|
| **Standards** | `agents/standards-reviewer.md` | lista de arquivos de standard **+** `catalogs/fowler-smells.md` colado **inteiro** |
| **Spec** | `agents/spec-reviewer.md` | path/conteúdo do spec; se o usuário disse que não há, não spawnar — gravar `no spec available` / `VERDICT: SKIP` |
| **Correctness** | `agents/correctness-reviewer.md` | `TASKS.json` + `immutability.json` + resultado do test-cmd |

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

HTML: SDD, o que foi implementado, fluxo (mermaid), impacto, payloads de teste, resultados, score. Mostrar path absoluto.

### 7. Limpar worktrees

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" verify-clean --root . --prefix mmh
```

Falhou → `remove --prefix mmh` e conferir de novo. Closeout com worktree órfã = score < 10.

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
- Abrir um segundo pack enquanto há worktree `mmh/slice-*` ou pack `in_progress` (use `--fresh`)
- Worktree de enfeite (criar e não mergear / não apagar)
- Score 10 no feeling
- Impor stack ou framework
- Review de um eixo só rotulado como consenso 3/3

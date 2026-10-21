# Skill: make-me-happy

Implementa feature, refactor ou greenfield. Sem SDD: **Etapa Zero** (perguntas + escrever o spec + arch-map). Com spec: tasks, red→green, imutabilidade, git worktrees, review em 3 eixos + **hooks de verificação**, HTML com score 10.

Fonte canônica: este repo. Hosts consomem por **symlink**.

## Uso

```
/make-me-happy
/mmh
/mmh --worktree 4 --into feature/painel-v2 --cobertura 95
/make-me-happy --spec docs/SDD/SDD-04.md --loop full
/make-me-happy --loop task --kind refactor
/mmh --fresh          # ignora pack/worktrees abertos
```

`/mmh` = esta skill. Não existe pasta irmã `mmh/`: o host ganha um **segundo link** (`…/skills/mmh` → esta pasta). No start a skill **sempre** roda `resume.mjs`: se a sessão anterior crashou (pack `in_progress` ou worktree `mmh/slice-*` vivo), retoma o passo; não pergunta loop de novo. Run nova: pergunta **loop full vs por task** e se deve **seguir agora**.

## O que a run faz

1. Acha o spec (`--spec` ou `docs/` `specs/` `.scratch/` …). Se não houver: **Etapa Zero** — perguntas, escreve o SDD, confirma; só então segue.
2. Planner → `TASKS.json` / `TASKS.md` (cada task leva a qtd de testes).
3. Cria **3** worktrees (ou `--worktree N`) numa **feature branch** (`--into`; se HEAD é `main`/`master`/`trunk`, cria `feature/mmh-YYYYMMDD`). Merge recusa a default branch. Recusa `add` se a suite em `into` já está vermelha (não empilha trabalho sobre baseline vermelha).
4. Red → green em cada task + testes de imutabilidade. Só o que o SDD pediu; dúvida entre caminhos → pergunta, não infere.
5. **§4z Aceitação de UI** (só quando o pack toca UI): `ui-acceptance.mjs scope` decide; boot pelo jeito do repo; login de teste; jornadas dirigidas com **evidência por código** — modo `fast` (spec direto + driver Playwright headless, segundos) ou `guided` (Playwright MCP explora 1× e destila o spec; `--ui-drive`); console/rede/screenshots capturados pelo driver; **re-run sempre headless**. Pack sem UI = SKIP automático.
6. Review **Standards** (Fowler + repo) ‖ **Spec** ‖ **Correctness** — e, no mesmo lote, os **hooks**: `arch-alignment` (implementação ↔ SDD ↔ arquitetura), `reinvention` (não reescrever o que stdlib/lib entrega), `security`, `performance` (N+1, sem teto, índice), `overengineering`, `deps-freshness` (dep nova na última ativa) e `ui-acceptance` (7º hook, runtime). Consenso 3/3 nos eixos; hooks bloqueiam por severidade (≥ high sem waiver = pack não fecha, régua da cobertura).
7. `score.mjs` (5 gates × 2). Fecha o **pack** só com **10, cobertura ≥ 90% e `hooks.mjs verdict` PASS** (`--cobertura N` só sobe o piso). Não é o done do repo.
8. `report.html` — arquivo único, offline: KPIs, linha do tempo (com o passo de UI), SDD, tasks com evidência red→green, fluxo, payloads, testes/cobertura, review por eixo, **aba Hooks** (achados, deps vs última ativa, **bloco Aceitação de UI com boot, jornadas e galeria de screenshots**, waivers), score, gates do projeto. Schemas do pack em `references/pack-schemas.md`. Se `add` anexou `.worktrees/` no `.gitignore`, isso é alteração visível do PR (`NOTE:` + `gitignore_appended`).
9. Depois que os merges desta run terminaram: `worktrees.mjs remove` e `verify-clean`. Some worktree, branch `mmh/slice-*` e pasta `.worktrees/mmh-*`. `clean` é obrigatório para fechar. Parar no meio, com slice ainda sem merge, não dispara esse `remove`.
10. **Bateria cross-skill pós-implementação** (§8): `/atlas-docs --delta` (doc em dia + arch-map das próximas runs) → `/nplus1-check` → `/abuse-audit` → `/ssrf-csrf-sqli-check --full`; achado real se corrige **dentro do pack** (red→green), re-rodando até secar.

## Pack

`docs/impl/make-me-happy/<data>-<branch>/`

## Agentes

| id | papel |
|----|--------|
| `explorer` | Etapa Zero: arch-map (atlas-docs ou manual) + pergunta e escreve o SDD. Não implementa |
| `planner` | `TASKS.json` / `TASKS.md` a partir do spec confirmado; tasks respeitam o arch-map, peça estrutural exige `refs` |
| `implementer` | red→green na slice |
| imutabilidade | `agents/immutability.md` — contrato que não pode andar |
| `standards-reviewer` | Fowler + standards do repo |
| `spec-reviewer` | o SDD (achado ou escrito na Zero) |
| `correctness-reviewer` | comportamento, testes e piso de cobertura |
| `hook-arch-alignment` | implementação ↔ SDD ↔ arch-map; conflito com ADR = REJECT |
| `hook-reinvention` | reescrita de capacidade canônica (zip, crypto, parsing…): nomeia a fonte canônica |
| `hook-security` | superfície que o diff abre: input, authz, segredo, SSRF, abuso; incorpora runners e skills |
| `hook-performance` | N+1, sem teto, índice faltando, hot path; incorpora o `nplus1-check` |
| `hook-overengineering` | peça estrutural sem requisito que a pague (catálogo próprio) |
| `ui-acceptance` (Motorista) | §4z runtime: boot, login de teste, jornadas dirigidas (fast/guided), console/rede/contrato/padrão; evidência por código |

Sem spec, o Oracle não pula para o Planner: despacha o `explorer`, espera confirmação, e só então segue.

## Estrutura

```
make-me-happy/
├── SKILL.md
├── agents/          # explorer, planner, implementer, reviewers, hooks (hook-*.md)
├── catalogs/        # fowler-smells · reinvention-checklist · overengineering
├── scripts/
│   ├── resume.mjs
│   ├── worktrees.mjs
│   ├── score.mjs
│   ├── hooks.mjs        # diff-facts · deps-freshness · arch-map · verdict · waive
│   ├── ui-acceptance.mjs # scope · boot · teardown · run-e2e · drive (Playwright headless via npx/driverHome)
│   ├── run-meta.mjs     # carimbo de cada passo (linha do tempo)
│   ├── build-report.mjs
│   ├── report/          # load-pack (normaliza + valida) · render · markdown
│   └── tests/
references/pack-schemas.md
```

`node --test scripts/tests/*.test.mjs`

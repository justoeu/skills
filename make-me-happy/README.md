# Skill: make-me-happy

Implementa um SDD/spec **já validado**: tasks, red→green, imutabilidade, git worktrees, review em 3 eixos, HTML com score 10.

Fonte canônica: este repo. Hosts consomem por **symlink**.

## Uso

```
/make-me-happy
/mmh
/mmh --worktree 4 --into feature/painel-v2
/make-me-happy --spec docs/SDD/SDD-04.md --loop full
/make-me-happy --loop task --kind refactor
/mmh --fresh          # ignora pack/worktrees abertos
```

`/mmh` = esta skill. Não existe pasta irmã `mmh/`: o host ganha um **segundo link** (`…/skills/mmh` → esta pasta). No start a skill **sempre** roda `resume.mjs`: se a sessão anterior crashou (pack `in_progress` ou worktree `mmh/slice-*` vivo), retoma o passo; não pergunta loop de novo. Run nova: pergunta **loop full vs por task** e se deve **seguir agora**.

## O que a run faz

1. Acha o spec (`--spec` ou `docs/` `specs/` `.scratch/` …).
2. Planner → `TASKS.json` / `TASKS.md` (cada task leva a qtd de testes).
3. Cria **3** worktrees (ou `--worktree N`) numa **feature branch** (`--into`; se HEAD é `main`/`master`/`trunk`, cria `feature/mmh-YYYYMMDD`). Merge recusa a default branch. Recusa `add` se a suite em `into` já está vermelha (não empilha trabalho sobre baseline vermelha).
4. Red → green em cada task + testes de imutabilidade.
5. Review **Standards** (Fowler + repo) ‖ **Spec** ‖ **Correctness**. Consenso 3/3; REJECT → corrige.
6. `score.mjs` (5 gates × 2). Fecha o **pack** só com **10** — não é o done do repo (trio/docs/i18n do `CLAUDE.md` continuam).
7. `report.html`. Se `add` anexou `.worktrees/` no `.gitignore`, isso é alteração visível do PR (`NOTE:` + `gitignore_appended`).

## Pack

`docs/impl/make-me-happy/<data>-<branch>/`

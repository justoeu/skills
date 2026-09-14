# Skill: ultra-deep-audit

Auditoria multi-agente, **agnóstica de host e de stack**, com relatório HTML, task tracker e três módulos profundos:

1. **Sentinel deep** — research de segurança com inventário, hunters por lente, panel adversarial 3 votos (quorum 2/3) e tally em **`sec-verify.mjs`** (código, não o modelo).
2. **Artemis / Caça-bugs** — bugs clássicos por linguagem (`catalogs/classic-bugs.md` + `detect-stack.mjs`).
3. **Quality Guild** — complexidade, duplicação, verbosidade e best practices (`measure-quality.mjs` + catálogos + agentes especializados).

Fonte canônica: este repo. Agentes consomem a skill por **symlink**, nunca por cópia para dentro de um app.

| Artefato | Path |
|----------|------|
| Skill | [`SKILL.md`](./SKILL.md) |
| Agentes | [`agents/`](./agents/) |
| Sec pipeline | [`agents/security/`](./agents/security/) |
| Caça-bugs | [`agents/artemis-caca-bugs.md`](./agents/artemis-caca-bugs.md) |
| Quality Guild | Daedalus · Echo · Laconic · Mentor · Forge |
| Catálogos | [`catalogs/`](./catalogs/) (incl. [`nplus1.md`](./catalogs/nplus1.md) para Nexus) |
| Scripts | [`scripts/`](./scripts/) |

## Hosts

Qualquer coding agent que leia `SKILL.md`, rode `node`/`bash` e despache subagentes (ou rode as lentes inline):

| Host | Dispatch | Expor a skill |
|------|----------|----------------|
| Claude Code | `Task` | `ln -s … ~/.claude/skills/ultra-deep-audit` |
| Grok | `spawn_subagent` | `ln -s … ~/.grok/skills/ultra-deep-audit` |
| Codex | subagente equivalente | `ln -s … ~/.codex/skills/ultra-deep-audit` |
| Cursor | subagente equivalente | skill dir do Cursor |
| opencode | subagente equivalente | `ln -s … ~/.config/opencode/skills/ultra-deep-audit` |

`SKILL_ROOT` = diretório deste `SKILL.md` (seguir symlink). Falta de tipo nomeado **não** pula lente: o Oracle emula com subagente genérico + o markdown em `agents/`.

## Agentes

| Nome | Domínio | IDs |
|------|---------|-----|
| **Atlas** | Architecture / layer boundaries | `ARCH-ATL-*` |
| **Sentinel** | Security / Authz — *fast* ou *deep* | `SEC-SEN-*` |
| **Nexus** | N+1 / per-item I/O (ORM, SQL, GraphQL, FE, workers) | `N1-NEX-*` |
| **Hermes** | Race / PBT | `RACE-HER-*` |
| **Hydra** | Leak / backpressure | `LEAK-HYD-*` |
| **Daedalus** | Cyclomatic / cognitive complexity | `CC-DAE-*` |
| **Echo** | Duplicate code (T1–T4) | `DUP-ECH-*` |
| **Laconic** | Verbosity / noise | `VRB-LAC-*` |
| **Mentor** | Clean Code · design patterns · language BP · CA effectiveness | `BP-MEN-*` |
| **Forge** | Residual dirty code + guild coord | `CQ-FOR-*` |
| **Prism** | Libs / CVE / latest stable | `DEP-PRI-*` |
| **Argus** | Test quality | `TEST-ARG-*` |
| **Artemis** | Caça-bugs (classic correctness) | `BUG-ART-*` |
| **Oracle** | Merge, roadmap, HTML | — |

### Quality Guild — o que cada um faz

| Agente | Pergunta que responde | Catalog |
|--------|----------------------|---------|
| **Daedalus** | Este método é um labirinto (CC/nesting)? | `complexity.md` |
| **Echo** | O mesmo bug vive em dois lugares? | `duplication.md` |
| **Laconic** | O ruído esconde a intenção? | `verbosity.md` |
| **Mentor** | Clean Code / SOLID / patterns estão *efetivos*? | `best-practices.md` |
| **Atlas** | A seta de dependência entre camadas é legal? | (layout + BP cross-ref) |
| **Forge** | Residual (magic numbers, empty catch, debug logs) | — |

Métricas objetivas (antes dos agents):

```bash
node scripts/measure-quality.mjs --root . --out quality-metrics.json
# hotspots (CC), clones (T1 shingles), long_low_cc (verbosidade)
```

## Uso

```
/ultra-deep-audit                     # delta; Sentinel fast; Artemis fast; Guild fast
/ultra-deep-audit --full              # ≡ deep + effort=max + Artemis deep + Guild deep
/ultra-deep-audit --full --effort medium   # full barato (override para baixar)
/ultra-deep-audit --only n1            # Nexus (N+1)
/ultra-deep-audit --only dirtycode     # Forge (residual dirty)
/ultra-deep-audit --only sentinel --depth deep
/ultra-deep-audit --only artemis
/ultra-deep-audit --only quality       # Daedalus+Echo+Laconic+Mentor+Forge
/ultra-deep-audit --only daedalus,echo
/ultra-deep-audit --only mentor --depth deep
```

`--only` aceita o **nome do agente** ou um **termo** (`n1`, `dirtycode`, `race`, `leak`, `sec`, `bugs`, `cc`, `dup`, `bp`, `arch`, `tests`, `deps`, …). Tabela completa no `SKILL.md`. `--mode` continua sendo só `delta` | `full`.

**`--full` já implica effort max** — não precisa `--depth deep --effort max`.

## Sentinel deep (resumo)

```
cartographer → hunters (component × lens) → candidates.json
  → 3× refuter (REACHABILITY | IMPACT | DEFENSES)
  → node scripts/sec-verify.mjs   # quorum 2/3, clamp confidence
  → agent-sentinel.json → Oracle
```

Confidence `high` só com painel unânime. Findings abaixo do quorum **não** entram no report.

## Nexus / N+1 (resumo)

```
detect-stack.mjs → stack.json
catalogs/nplus1.md (shapes + severidade)
  → hunt: loop I/O, lazy graph, worker writes, FE list-cell, K round-trips
  → agent-nexus.json (N1-NEX-*)
```

`/ultra-deep-audit --only n1`

## Artemis (resumo)

```
detect-stack.mjs → classic-bugs.md (seções da linguagem)
  → hunt com failure_scenario
  → agent-artemis.json (BUG-ART-*)
```

## Quality Guild (resumo)

```
detect-stack.mjs → stack.json
measure-quality.mjs → quality-metrics.json
  → Daedalus (CC hotspots + complexity.md)
  → Echo (clones + duplication.md)
  → Laconic (long_low_cc + verbosity.md)
  → Mentor (best-practices.md + AGENTS.md + language idioms)
  → Forge (residual only)
  → agent-daedalus|echo|laconic|mentor|forge.json
```

## Prism — latest stable (resumo)

```
detect-stack.mjs → stack.json
  (java, spring, kotlin, node, react, vite, next, swift, go, …)
check-deps-latest.mjs → deps-latest.json + agent-prism-freshness.json
  ecosystems: npm | go | maven | gradle | spm | cargo | pypi | composer | rubygems | **docker-compose**
  stable only (no beta/rc/canary/snapshot/M*/floating latest)
  docker: image tags in compose (postgres:16-alpine, minio RELEASE.*, …)
  update_map + suggestions + batches
build-report / sync-progress → report.html aba "Libs / Updates"
```

```bash
node scripts/detect-stack.mjs --root . > stack.json
node scripts/measure-quality.mjs --root . --out quality-metrics.json
node scripts/check-deps-latest.mjs --root . \
  --out deps-latest.json --findings agent-prism-freshness.json
node scripts/build-report.mjs --findings FINDINGS.json --out report.html \
  --deps deps-latest.json --stack stack.json
```

## Pack de saída

```bash
OUT=docs/audits/ultra-deep-audit/YYYY-MM-DD-full
node scripts/merge-findings.mjs --dir "$OUT" --mode full
node scripts/sync-progress.mjs --dir "$OUT"
open "$OUT/report.html"
```

| Artefato | Função |
|----------|--------|
| `report.html` | UI (filtros DONE/OPEN, agentes) — header com **App** + **Branch** |
| `TASKS.md` | Checklist P0–P3 (+ App/Version/Branch) |
| `FINDINGS.json` | Fonte de verdade |
| `run-meta.json` | `app`, `branch`, `head`, `mode`, `depth`, `effort` |
| `sec-deep/` | working set do panel (deep) |
| `stack.json` | linguagens detectadas |
| `quality-metrics.json` | CC hotspots · clones · verbosity candidates |
| `deps-latest.json` | freshness vs latest **stable** (Prism) |

## Regra de ouro

**Cada correção = teste red → green.**  
**Cada DONE = `sync-progress --done` no mesmo ciclo.**

## `--full` anti-atalho

- effort **max** por default
- panel = 3 refuter **subagentes reais** por candidate + arquivos em `sec-deep/votes/`
- `sec-verify --require-vote-files` obrigatório
- Quality Guild: `measure-quality.mjs` quando o roster inclui guild
- ao terminar: imprimir path absoluto do pack e **`open report.html`**

## Licença / origem

Prompts e scripts desta skill são originais. Não copiar plugins proprietários de terceiros.

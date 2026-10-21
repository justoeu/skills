# Skill `deep-audit` — bateria ultra-deep

Auditoria multi-agente e adversarial em **15 lentes**, com apuração feita por **código** e
report HTML + task tracker. Invocada por `/deep-audit`, `/deep-audit --full` ou
`/deep-audit <lente>`.

| Artefato | Path |
|---|---|
| Skill (contrato da rodada) | [`SKILL.md`](./SKILL.md) |
| Scripts determinísticos | [`scripts/`](./scripts/) |
| Agentes (prompts, 25) | [`agents/`](./agents/) |
| Catálogo de bugs clássicos | [`catalogs/classic-bugs.md`](./catalogs/classic-bugs.md) |
| Catálogo de boas práticas por linguagem | [`catalogs/best-practices.md`](./catalogs/best-practices.md) |

Fonte única: o harness (`~/Developer/harness/skills/deep-audit`). Os hosts leem por
symlink (`~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, `~/.grok/skills`);
no Claude Code os `subagent_type`s também são registrados via links em
`~/.claude/agents/`. Exposição auditada por `scripts/check-links.mjs` na raiz do repo.

## Roster

| Lente | Agente | `subagent_type` |
|---|---|---|
| architecture | Atlas | `atlas-arquitetura` |
| quality | Aurora | `aurora-qualidade` |
| complexity | Dédalo | `dedalo-complexidade` |
| duplication | Eco | `eco-duplicacao` |
| verbosity | Lacônio | `laconio-verbosidade` |
| best_practices | Atena | `atena-boas-praticas` |
| security (fast) | Cérbero | `cerbero-seguranca` |
| security (deep) | Cartógrafo · Caçador · Refutador | `cartografo-seguranca` · `cacador-seguranca` · `refutador-seguranca` |
| performance | Fluxo | `fluxo-performance` |
| nplus1 | Enxame | `enxame-nplus1` |
| race | Cronos | `cronos-race` |
| memleak | Fantasma | `fantasma-memleak` |
| backpressure | Represa | `represa-backpressure` |
| tests | Argus | `argus-testes` |
| deps | Prisma | `prisma-dependencias` |
| classic_bugs | Artemis | `artemis-caca-bugs` |
| verificação | Cético | `cetico-verificador` |
| correção | Ferreiro | `ferreiro-correcao` |
| revisão da correção | Nêmesis ‖ Hígia ‖ Jano | `nemesis-revisao-correcao`, `higia-revisao-qualidade`, `jano-revisao-escopo` |
| relatório | Escriba | `escriba-relatorio` |
| orquestração | Maestro | `maestro-deep-audit` |

## Uso

```
/deep-audit                          # delta · segurança fast · Artemis fast
/deep-audit --full                   # ≡ depth=deep + effort=max + Artemis deep (teto)
/deep-audit --full --effort medium   # full mais barato (override para BAIXAR)
/deep-audit security --depth deep    # só a lente de segurança, com painel
/deep-audit classic_bugs             # só caça-bugs
/deep-audit complexity               # só complexidade ciclomática/cognitiva
/deep-audit best_practices           # só idiomas/patterns/Clean Code-Arch
```

`--full` **já é o teto**: não precisa `--depth deep --effort max`.

## Pipeline

```bash
SKILL=~/Developer/harness/skills/deep-audit   # ou o symlink do seu host (~/.claude/skills/deep-audit, …)
eval "$(node "$SKILL/scripts/init-run.mjs" --root . --full)"   # OUT/APP/VERSION/BRANCH/MODE/DEPTH/EFFORT/BASE/SEC_DIR

node "$SKILL/scripts/detect-stack.mjs" --root . > "$OUT/stack.json"
node "$SKILL/scripts/check-deps-latest.mjs" --root . \
     --out "$OUT/deps-latest.json" --findings "$OUT/agent-prisma-freshness.json"

# … agentes gravam $OUT/agent-*.json …

# segurança deep: cartógrafo → caçadores → 3 refutadores por candidato → apuração em código
node "$SKILL/scripts/sec-verify.mjs" \
  --candidates "$SEC_DIR/candidates.json" --votes "$SEC_DIR/votes.json" \
  --votes-dir "$SEC_DIR/votes" --require-vote-files \
  --out "$OUT/agent-cerbero.json" --coverage-out "$SEC_DIR/coverage.json" \
  --agent "Cérbero" --id-prefix SEC-CER

node "$SKILL/scripts/merge-findings.mjs" --dir "$OUT" --mode "$MODE"
node "$SKILL/scripts/lint-findings.mjs"  --dir "$OUT" --fix
node "$SKILL/scripts/sync-progress.mjs"  --dir "$OUT" --publish docs/audits
open "$OUT/report.html"
```

Depois de **cada** correção do Ferreiro, o diff daquele fix vai a 3 revisores independentes
(Nêmesis CORRECTNESS ‖ Hígia QUALITY ‖ Jano SCOPE), um voto por arquivo, e a apuração é do
script — `--done` não fecha sem `approved`:

```bash
# 3 Task em paralelo → reviews/votes/<ID>-{CORRECTNESS,QUALITY,SCOPE}.json
node "$SKILL/scripts/review-verify.mjs" --dir "$OUT" --id <ID>   # 0 aprovado · 2 painel incompleto · 3 mudanças/reprovado
node "$SKILL/scripts/sync-progress.mjs" --dir "$OUT" --done <ID> --test "Suite#caso"
```

## Desfechos (o que o código cobra)

| Desfecho | Exige | Comando |
|---|---|---|
| `resolvido` | o teste red→green | `--done ID --test "Suite#caso"` |
| `refutado` | a evidência que derruba | `--refute ID --evidence "…"` |
| `aceito` | os 4 campos + subtipo + ratificação | `--accept ID --accept-type … --what … --consequence … --reopen-if … --ratified-by …` |
| `aberto` | plano | default |

`refutado` (não existe defeito) e `aceito` (existe, risco assumido) são **KPIs separados**.
HIGH/CRITICAL **não** pode ser aceito — `sync-progress` e `lint-findings` recusam.

Gate de fechamento — falha com HIGH+ aberto, achado bloqueando PR, identidade do alvo
incompleta (`app`/`version`/`branch`), `deps-latest.json` ausente ou correção `resolvido`
sem revisão aprovada:

```bash
node "$SKILL/scripts/lint-findings.mjs" --dir "$OUT" --gate
```

## Pack de saída

```
docs/audits/deep-audit/<data>-<modo>/
├─ FINDINGS.json      fonte de verdade
├─ report.html        UI autocontida (tema claro/escuro, filtros, roadmap, timeline, deps)
├─ TASKS.md           tracker vivo  [ ] [~] [x] [-] [!]
├─ REPORT.md          resumo honesto da rodada
├─ run-meta.json      modo/depth/effort/base/head + histórico
├─ stack.json · deps-latest.json
├─ agent-*.json       saída crua de cada agente
└─ sec-deep/          inventory · hunter-* · candidates · votes/ · coverage
```

Cópias estáveis publicadas em `docs/audits/deep-audit-{report.html,tasks.md,findings.json}`.

## Origem

Convertida e expandida a partir da skill `ultra-deep-audit` (`~/.agents/skills/`), fundindo
o pipeline adversarial de segurança + caça-bugs + latest-stable com o modelo de desfechos
(`refutado ≠ aceito`) e o relatório claro/escuro da versão anterior desta skill. Prompts e
scripts são originais do workspace.

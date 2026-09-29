# Skill: ultra-deep-audit

Bateria de detecção depois que o código já existe. 14 lentes em paralelo, apuração por script, pack HTML + TASKS. Não implementa feature e não substitui o `make-me-happy`.

O workflow, as flags e o schema de finding estão no [`SKILL.md`](SKILL.md).

| | |
|---|---|
| **Quando** | Fim de feature (`--delta`), release (`--full`), ou uma lente (`--only`) |
| **Comando** | `/ultra-deep-audit` · `--full` · `--only n1\|quality\|sentinel\|…` |
| **Pack** | `Docs/audit/ultra-deep/<data>/` (o `SKILL.md` é a fonte do path) |

## Agentes

| Agente | Arquivo | Caça |
|--------|---------|------|
| Atlas | `agents/atlas-architecture.md` | seta ilegal entre camadas |
| Sentinel | `agents/sentinel-security.md` | exploit / IDOR / injection; deep = panel de 3 votos |
| Nexus | `agents/nexus-n1-perf.md` | 1+N queries/requests |
| Hermes | `agents/hermes-race.md` | lost update / CAS |
| Hydra | `agents/hydra-resources.md` | crescimento sem teto, pool |
| Daedalus | `agents/daedalus-complexity.md` | CC / nesting / god method |
| Echo | `agents/echo-duplication.md` | clone T1–T4 |
| Laconic | `agents/laconic-verbosity.md` | ruído, pass-through |
| Mentor | `agents/mentor-best-practices.md` | Clean Code / patterns inefetivos |
| Forge | `agents/forge-quality.md` | residual (catch vazio, magic number, debug log) |
| Prism | `agents/prism-deps-bp.md` | CVE + latest stable |
| Argus | `agents/argus-tests.md` | teste que não protege |
| Artemis | `agents/artemis-caca-bugs.md` | bug clássico por linguagem |
| Oracle | `SKILL.md` | merge, HTML, TASKS |

Sentinel deep usa `agents/security/` (cartographer, hunter, refuter). `--only quality` = Daedalus + Echo + Laconic + Mentor + Forge.

## Uso

```
/ultra-deep-audit                 # delta
/ultra-deep-audit --full          # corpus; Sentinel deep + effort max
/ultra-deep-audit --only quality
```

Depois da run:

```bash
node "$SKILL_ROOT/scripts/sync-progress.mjs" --dir "$OUT"
# FINDINGS.json + REPORT.md + ROADMAP.md + TASKS.md + report.html
```

Fix de finding = teste que falha antes + `sync-progress --done ID --test "Class#method"`.

## Scripts com teste próprio

`node --test scripts/tests/*.test.mjs`

Dois apuradores já mediram menos do que diziam, em silêncio:

| Achado | Sintoma | Guarda |
|--------|---------|--------|
| **TOOL-ORC-002** | `measure-quality.mjs` cortava a travessia em `depth > 8` e reportava zero erro sobre um corpus incompleto | `--max-depth` (default 32) + ledger `traversal`; `ERROR: … INCOMPLETE` no stderr |
| **TOOL-PRI-108** | `check-deps-latest.mjs` ignorava pin de CVE que só existe como property de BOM | `parseMavenPropertyPins` + `MAVEN_BOM_PROPERTY_COORDS`; pin sem coordenada vira linha `skipped` |

## Regra de ouro

Cada correção = teste que falha antes e passa depois. Cada DONE = `sync-progress --done` no mesmo ciclo.

# Skill: ultra-deep-audit

Framework de auditoria ultra-deep do Prontyx com **agentes nomeados** e relatório HTML.

| Artefato | Path |
|----------|------|
| Spec | [`Docs/SDD/SDD-17-ultra-deep-quality-audit.md`](../../../Docs/SDD/SDD-17-ultra-deep-quality-audit.md) |
| Skill | [`SKILL.md`](./SKILL.md) |
| Agentes | [`agents/`](./agents/) |
| HTML builder | [`scripts/build-report.mjs`](./scripts/build-report.mjs) |
| Exemplo | [`Docs/audit/ultra-deep/2026-07-24/`](../../../Docs/audit/ultra-deep/2026-07-24/) |

## Agentes

| Nome | Domínio |
|------|---------|
| **Atlas** | Clean Architecture |
| **Sentinel** | Security / IDOR / multi-tenant |
| **Nexus** | N+1 / performance |
| **Hermes** | Race conditions / PBT |
| **Hydra** | Memory leak / backpressure |
| **Forge** | Dirty code / complexidade |
| **Prism** | Libs / CVE / best practices |
| **Argus** | Test quality / mutation |
| **Oracle** | Orquestra, merge, roadmap, HTML |

## Uso

```
/ultra-deep-audit          # delta (pós-feature)
/ultra-deep-audit --full   # corpus completo
```

### Entrega do pack (após auditoria)

```bash
OUT=Docs/audit/ultra-deep/YYYY-MM-DD-full
node .claude/skills/ultra-deep-audit/scripts/sync-progress.mjs --dir "$OUT"
# gera: TASKS.md + report.html (+ atualiza FINDINGS status)
open "$OUT/report.html"
open "$OUT/TASKS.md"
```

| Artefato | Função |
|----------|--------|
| `report.html` | UI interativa (filtros DONE/OPEN) |
| `TASKS.md` | Checklist P0–P3 + % + iteration log |
| `FINDINGS.json` | Fonte de verdade (`status`) |
| `REPORT.md` / `ROADMAP.md` | Executivo / planejamento |

### Cada iteração de implementação

```bash
# 1) fix + teste red→green
# 2) marcar DONE e regenerar HTML/TASKS
node .claude/skills/ultra-deep-audit/scripts/sync-progress.mjs \
  --dir "$OUT" \
  --done ID1,ID2 \
  --note "PR #N" \
  --test "Class#method"
```

Quando **OPEN=0**, o HTML passa a **✅ COMPLETE (100%)**.

## Os scripts também são instrumentos — e têm teste próprio

`node --test .claude/skills/ultra-deep-audit/scripts/tests/*.test.mjs` (roda dentro de
`scripts/ci-local.sh`). Existe porque dois scripts de apuração mediam menos do que diziam,
em silêncio:

| Achado | Sintoma | Guarda hoje |
|--------|---------|-------------|
| **TOOL-ORC-002** | `measure-quality.mjs` cortava a travessia em `depth > 8`. O Java vive em `backend/src/main/java/com/appgp/backend/<camada>/<pacote>/` — nível 9. Media 1191 de 3628 arquivos e reportava zero erro; Daedalus/Echo/Laconic operavam só sobre o frontend. | `--max-depth` (default 32) + ledger `traversal` no JSON com tudo que não foi visitado, `ERROR: … INCOMPLETE` no stderr e `--strict` para sair ≠ 0. |
| **TOOL-PRI-108** | `check-deps-latest.mjs` só lia `<dependency><version>`. Pins de CVE que existem apenas como override de property do BOM (`rabbit-amqp-client.version`, `netty.version`, `jackson-bom.version`) ficavam fora do inventário — e o Trivy FS também não os vê. | `parseMavenPropertyPins` + `MAVEN_BOM_PROPERTY_COORDS`; pin sem coordenada vira linha `skipped` com motivo, nunca sumiço. O teste do `backend/pom.xml` real falha se aparecer pin novo sem coordenada **ou sem comentário dizendo por que existe**. |

Ao mexer nesses scripts, mexa **aqui** — `~/.agents/skills/ultra-deep-audit/scripts/` é
uma cópia instalada e precisa ser re-espelhada à mão.

## Regra de ouro

**Cada correção = teste que falha antes e passa depois (red → green).**  
**Cada DONE = `sync-progress --done` no mesmo ciclo.**

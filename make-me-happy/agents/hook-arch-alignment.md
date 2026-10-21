# Hook: arch-alignment (H1b)

**Agent id:** `hook-arch-alignment`
Read-only. You never edit product code. Runs in §5 alongside the 3 review axes.

## Brief

Valide a tríade **implementação ↔ SDD ↔ arch-map**:

1. O SDD conhece a arquitetura que existe? Decisões dele (lib, camada, fila,
   persistência, padrão) citam as constraints do `arch-map` ou as ignoram?
2. O diff implementou **dentro** da arquitetura mapeada (camada certa, padrão
   local, lib já adotada) — ou criou caminho paralelo?
3. Alguma decisão do diff/SDD **conflita com ADR ou decisão documentada** no
   arch-map (`adrs[]` com status aceito)? Conflito = FAIL, não judgement.
4. Decisão de arquitetura **nova** (fila onde não havia broker, serviço novo,
   padrão diferente do app) sem o SDD justificar → não é achado de estilo: é a
   pergunta que o Oracle leva ao usuário (regra Só o SDD).

Greenfield (arch-map ausente ou `source: "greenfield"`): inverta a lente — valide
a coerência **interna** do SDD (decisões combinam entre si? a pilha escolhida
sustenta o que ele promete?) e deixe estrutura sem requisito para o hook
`overengineering`.

## Input (Oracle pastes)

- `$OUT/hooks/arch-map.json` (from atlas-docs or explorer; `{source, style, layers[], libs[{name,use}], adrs[{id,title,status}], containers[], notes}`)
- SDD path/content + `spec-summary.md`
- Diff command + commit list + `$OUT/hooks/diff-facts.json`

## Verdict

`VERDICT: APPROVE` | `VERDICT: REJECT` — REJECT em conflito com ADR documentado,
camada/ padrão ignorado sem justificativa no SDD, ou decisão estrutural nova
injustificada. Ignorância honesta (arch-map OPEN) não é REJECT; é finding `warn`.

Write `$OUT/hooks/arch-alignment.json` (schema below). No separate md — `summary` carries the prose. Under 300 words in `summary`.

```json
{
  "hook": "arch-alignment",
  "verdict": "APPROVE",
  "round": 1,
  "summary": "one paragraph",
  "findings": [
    { "id": "A-1", "severity": "high", "title": "…", "description": "…",
      "file": "path", "line": 42, "spec_ref": "§3.1", "arch_ref": "ADR-004 | layer:service",
      "status": "open", "round": 1 }
  ],
  "rounds": [{ "round": 1, "verdict": "REJECT", "at": "…", "summary": "…", "findings": [] }]
}
```

`severity`: `critical` | `high` | `medium` | `low` | `info`. `status`: `open` | `fixed` | `wontfix`.
Re-run: read the previous JSON, mark fixed findings, append a round. Never drop history.

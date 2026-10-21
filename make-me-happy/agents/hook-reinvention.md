# Hook: reinvention (H2)

**Agent id:** `hook-reinvention`
Read-only. You never edit product code. Runs in §5 alongside the 3 review axes.

## Brief

Pergunta única: **o diff reescreve algo que stdlib, lib já no manifest, ou lib
madura do ecossistema entrega pronto?**

1. Aplique `catalogs/reinvention-checklist.md` (pasted in full by the Oracle) ao diff.
2. Para cada suspeita, **nomeie a fonte canônica** (stdlib da stack detectada ou
   lib do manifest/arch-map). Achado sem fonte nomeada não é achado.
3. Confira o sinal invertido: dep nova para o que a stdlib cobre (`dep-desnecessária`).
4. Capacidade complexa entregue com **zero deps novos** (zip/crypto/parser/http
   aparecendo no diff) é o sinal mais forte — comece por aí.
5. SDD manda? Implementação caseira com `spec_ref` explícito = `info`, sem FAIL.

## Input (Oracle pastes)

- Diff command + commit list + `$OUT/hooks/diff-facts.json` (deps added/removed, suspicious files)
- Stack detectada + libs do manifest (de `hooks/arch-map.json` ou do manifest)
- SDD (para os `spec_ref` de exceção)
- `catalogs/reinvention-checklist.md` — pasted in full (you may have no other access)

## Verdict

`VERDICT: APPROVE` | `VERDICT: REJECT` — REJECT quando há reescrita de capacidade
canônica (`critical`/`high`: crypto, SQL escaping, parsing) sem exceção no SDD.
`medium`/`low` (ex.: retry caseiro funcional) entram como findings, não REJECT.

Write `$OUT/hooks/reinvention.json`:

```json
{
  "hook": "reinvention",
  "verdict": "APPROVE",
  "round": 1,
  "summary": "one paragraph",
  "findings": [
    { "id": "R-1", "severity": "high", "title": "hand-rolled zip64",
      "description": "…", "file": "internal/pack/zip.go", "line": 88,
      "canonical": "stdlib archive/zip", "spec_ref": null, "status": "open", "round": 1 }
  ],
  "rounds": [{ "round": 1, "verdict": "REJECT", "at": "…", "summary": "…", "findings": [] }]
}
```

`severity`: `critical` | `high` | `medium` | `low` | `info`. `status`: `open` | `fixed` | `wontfix`.
Re-run: read the previous JSON, mark fixed findings, append a round. Never drop history.

# Hook: performance (H4)

**Agent id:** `hook-performance`
Read-only. You never edit product code. Runs in §5 alongside the 3 review axes.

## Brief

Código novo cria gargalo previsível? Escopo = o diff, nos fluxos que ele toca:

1. **N+1**: loop que faz query/chamada HTTP por item. Sinal clássico: `for` +
   `.find(`/`.get(`/`.query(` dentro; batch/in existe na stack?
2. **Sem teto**: lista sem paginação/LIMIT; query nova sem índice (cruze com as
   migrações do `diff-facts`: coluna de WHERE/JOIN nova ganhou índice?);
   `SELECT *` em tabela que cresce; fan-out sem cap.
3. **Hot path**: alocação em loop apertado (a stack reclama?); chamada síncrona
   bloqueante em camada de concorrência; lock global onde read bastaria.
4. **Custo por chamada**: endpoint novo faz quantas idas a IO? 1 é o alvo; N>3
   sem justificativa do SDD é finding.
5. **Paralelismo errado**: async fan-out sem limite de concorrência; retry sem
   backoff martelando o downstream.

Achados da skill `nplus1-check` chegam pelo Oracle: incorpore como findings com
`source: "nplus1-check"` — evidência externa vale, não re-auditte.

Prioridade: `critical` = unbounded em produção (sem LIMIT em tabela que cresce,
fan-out sem cap em endpoint público). `high` = N+1 em fluxo novo, índice faltando
para query nova. `medium`/`low` = micro-otimização, advisory.

## Input (Oracle pastes)

- Diff command + commit list + `$OUT/hooks/diff-facts.json` (migrations, routes)
- Resultado do `nplus1-check` quando o host tiver rodado
- SDD (volume esperado? `spec_ref` de escala justifica escolhas)

## Verdict

`VERDICT: APPROVE` | `VERDICT: REJECT` — REJECT com `critical`/`high` aberto.
`medium`/`low` são findings, não REJECT.

Write `$OUT/hooks/performance.json`:

```json
{
  "hook": "performance",
  "verdict": "APPROVE",
  "round": 1,
  "summary": "one paragraph",
  "findings": [
    { "id": "P-1", "severity": "high", "title": "N+1 ao listar runs",
      "description": "…", "file": "svc/jobs.py", "line": 77,
      "kind": "n+1 | unbounded | hot-path | index | fanout",
      "source": "diff | nplus1-check", "spec_ref": null, "status": "open", "round": 1 }
  ],
  "rounds": [{ "round": 1, "verdict": "REJECT", "at": "…", "summary": "…", "findings": [] }]
}
```

`severity`: `critical` | `high` | `medium` | `low` | `info`. `status`: `open` | `fixed` | `wontfix`.
Re-run: read the previous JSON, mark fixed findings, append a round. Never drop history.

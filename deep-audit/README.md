# deep-audit 2.0.0

Auditoria em 15 lentes com painel de segurança, inventário de dependências, relatório
HTML local e acompanhamento de desfechos. Correções autorizadas têm teste de regressão,
prova por reversão isolada e revisão independente de três lentes.

Leia [SKILL.md](SKILL.md) para invocação e [contrato schema 2](references/pack-contract.md)
para comandos, schemas, recuperação e migração. O escopo de uma auditoria não autoriza
implicitamente alterações de produto, push ou publicação externa.

- `/deep-audit`: delta, segurança fast.
- `/deep-audit --full`: árvore inteira, segurança deep, esforço max.
- `--only security,classic_bugs`, `--scope src`, `--base main`: seleção explícita.
- Dependências são inventariadas em qualquer seleção; consultas indisponíveis são lacunas.
- Painel independente indisponível permanece pendente; detecção sequencial é fallback útil.

## Garantias operacionais

Init emite JSON sem eval; run_id/OUT únicos; retomada explícita. Snapshot vincula fonte,
HEAD/branch e artefatos. IDs de achados usam identidade por hash; reorder/severidade não
reutilizam status de outro defeito. Merge valida antes de gravar e preserva achados que
sumiram do último detector até disposição explícita. Lock exclui writers concorrentes;
escrita atômica evita JSON truncado. Busy exige retry, dono morto exige recuperação explícita.

`--audit-gate` exige todas as etapas selecionadas, resultados inclusive vazios, dependências
válidas e painel deep quando aplicável. `--gate` acrescenta desfechos e provas atuais;
HIGH/CRITICAL aberto e revisão dispensada bloqueiam fechamento. Relatório incompleto é
entregável com aviso claro. Repetir sync não duplica banner nem a mesma nota de progresso.

Review-start invalida a aprovação anterior, votos compartilham um contexto imutável e
reversal-proof testa GREEN/RED/GREEN em worktree temporária. Tentativas são preservadas;
reapurar os mesmos inputs é idempotente. Remover voto/prova ou mudar fonte bloqueia done
e gate mesmo sem executar tally novamente.

## Artefatos

`run-meta.json`, `snapshots/`, `agent-*.json`, `FINDINGS.json`, `sec-deep/`, `reviews/`,
`deps-latest.json`, `stack.json`, `REPORT.md`, `TASKS.md`, `report.html`.
HTML autocontido: filtros por severidade/desfecho/lente/agente, roadmap, timeline e aba de
libs com todos os pacotes e lotes. Refutados, aceitos e resolvidos permanecem distintos.
Cópias locais opcionais: `sync-progress --publish docs/audits`.

## Mudança incompatível de 1.x para 2.0

Não faça eval do init. Não edite run-meta nem status para fabricar conclusão. Esquema 1
continua renderizável como histórico incompleto, mas não passa gate. Inicie nova run com
`--legacy CAMINHO_ANTIGO` e revalide achados/votos no código atual; nenhuma aprovação antiga
é importada. IDs ordinais antigos mudam para IDs por identidade. Consulte o contrato.

## Verificação local

```bash
node --test deep-audit/scripts/tests/*.test.mjs
```

A suíte usa repositórios temporários e CLIs reais, sem rede: escopo, corrupção, evidência
antiga, zero candidatos, trabalho concorrente, correção/reversão real, histórico de review
e fluxo full. Ela não simula que modelos independentes executaram análise, que todos os
parsers de manifest foram testados ou que registries/CVEs externos responderam corretamente.

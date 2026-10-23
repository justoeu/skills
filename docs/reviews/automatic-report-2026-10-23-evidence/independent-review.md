# Revisão independente — atualização periódica do HTML

Data: 2026-10-23. Escopo: make-me-happy/scripts/report-watch.mjs,
report-watch-state.mjs, build-report.mjs, run-meta.mjs, task-progress.mjs,
report/load-pack.mjs e report/render.mjs. Revisão read-only das fontes em edição;
considerei a versão que extrai report-watch-state.mjs e reconstrói o HTML ao parar
um watcher já morto. Nenhuma fonte ou teste permanente foi alterado.

## Achado reproduzido

### RW-01 — Média: stop confunde a confirmação do watcher antigo com a nova lease

Local: make-me-happy/scripts/report-watch.mjs:113–120.

O comando captura o estado solicitado em `requested`, mas o laço de confirmação só
consulta `current.running`. Ele não distingue o token alvo do token de um watcher
que começou depois. Na retomada concorrente, o primeiro watcher conclui normalmente,
publica o HTML final e encerra; outro supervisor inicia a nova lease antes do poll de
100 ms. O stop anterior passa a aguardar a nova lease e falha após 15 segundos com
`stop requested; watcher has not confirmed its final refresh yet`.

Reprodução: `node /tmp/mmh-report-watch-stop-race.mjs`. O script usa as funções reais,
sem modificar fontes nem relógio: inicia watcher A; chama stop; no término da Promise
de A inicia B; mantém B vivo até o retorno de stop. Resultado observado em
`/tmp/mmh-stop-restart-race-K2uT7s/result.json`: A concluído, B com outro token ativo,
stop retornando erro após 15101 ms. Ambos foram encerrados pelo ensaio.

Impacto: um handoff válido é reportado como falha de parada; o chamador pode repetir
operações ou bloquear a retomada por uma confirmação associada ao processo errado.
Não observei perda de TASKS.json ou alteração de evidências neste caso.

Critério objetivo de correção: stop deve confirmar a lease solicitada. Uma nova lease
não deve prolongar a espera pela anterior nem encobrir falha do seu render final.
Preservar a confirmação terminal por token ao adquirir a próxima lease permite
identificar sucesso e falha sem interromper o novo watcher. O cenário acima deve
retornar a confirmação de A rapidamente, mantendo B ativo.

## Validações independentes que passaram

Script: `/tmp/mmh-report-watch-independent.mjs`.
Fixture Git: `/tmp/mmh-report-watch-forward-6rEqQW/`.
Resultados: `/tmp/mmh-report-watch-forward-6rEqQW/results.json`.

1. Escrever progress e gerar HTML mantém TASKS.json, artifactIdentity e captureEvidence.
   O andamento aparece como informação ainda não validada.
2. Start duplicado por CLI falha e conserva o token do watcher existente.
3. Timer real de um segundo incorpora alteração canônica posterior ao primeiro ciclo.
4. SIGKILL seguido de stop reconstrói HTML com dados atuais e desliga auto-refresh.
5. Restart após SIGKILL recebe novo token; stop cooperativo termina com exit 0.
6. Lock ocupado impede substituir o relatório anterior.
7. Falha de rename do HTML após updateTask não perde a alteração nem a versão salva.
   Rebuild posterior recupera a apresentação e remove progress de versão antiga.
8. JSON canônico inválido faz strict build falhar sem substituir o HTML anterior.

Comando focado executado, 28 PASS / 0 FAIL / 0 SKIP:

```
node --test make-me-happy/scripts/tests/report-watch.test.mjs \
  make-me-happy/scripts/tests/report-refresh.test.mjs \
  make-me-happy/scripts/tests/build-report.test.mjs
```

Esses testes incluem o intervalo padrão de dez minutos com relógio controlado,
encerramento por SIGTERM, três falhas de render e proteção contra progresso de outra
run. A inspeção das fontes antecedeu sua execução; os resultados verdes não foram
usados como substituto da revisão.

## Limites

Não aguardei dez minutos reais; o temporizador real foi exercitado com intervalo de
um segundo e o intervalo padrão foi coberto pelo teste de relógio controlado. Não
usei navegador, rede, app-gp, registry, CI de produto ou serviços reais. Portanto,
preservação visual de foco/filtros/scroll e comportamento de reload no navegador
não estão atestados por este passe. Não fiz ensaio de reutilização de PID pelo SO.
Nenhum processo iniciado pelo ensaio permaneceu ativo. Docs ainda estavam em edição.

## Revalidação de RW-01 após a correção — fechado

Revalidado em 2026-10-23, sem editar fontes. O achado original acima permanece como
registro da falha observada. A correção agora arquiva o estado terminal em
`report-watch-history/<token>.json` sob o lock, antes de publicar a nova lease
(report-watch.mjs:50–55). O stop consulta o token solicitado e exige o mesmo run_id;
resultado `failed` continua sendo erro, e ausência de confirmação não vira sucesso
(report-watch.mjs:124–132).

**Reprodução original, sem alteração:**
`node /tmp/mmh-report-watch-stop-race.mjs` passou. A parada devolveu o token de A e
status `stopped` em 105 ms, enquanto B tinha outro token. Antes da correção, a mesma
reprodução demorava 15101 ms e retornava timeout.
Evidência: `/tmp/mmh-stop-restart-race-v5m6iG/result.json`.

**Contraprova independente de falha não encoberta:**
`node /tmp/mmh-report-watch-stop-failure.mjs` passou. O script provocou EISDIR apenas
no render final de A, restaurou o destino e iniciou B imediatamente. O stop de A
retornou exatamente o erro original em 102 ms; o histórico manteve status `failed`,
mesmo token e mesmo last_error. B permaneceu ativo até a limpeza do ensaio.
Evidência: `/tmp/mmh-stop-restart-failure-VLqBBu/result.json`.

Também executei as duas regressões focadas do autor, com 2 PASS / 0 FAIL:

```
node --test --test-name-pattern='stop confirms its original watcher' \
  make-me-happy/scripts/tests/report-watch.test.mjs
```

Conclusão da revalidação: RW-01 corrigido; não observei ocultação da falha do render
final nem interrupção indevida do watcher seguinte. Todos os watchers iniciados nos
ensaios foram encerrados. Mantêm-se os limites da revisão original; esta revalidação
não acrescenta prova de navegador ou serviço real.

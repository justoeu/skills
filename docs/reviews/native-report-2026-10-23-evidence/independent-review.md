# Revisão independente — make-me-happy 1.7.0, scheduler nativo e fallback

Data: 2026-10-23. Escopo read-only: report-native.mjs, report-watch-state.mjs,
report-watch.mjs, build-report.mjs, report/load-pack.mjs, report/render.mjs,
references/automatic-report.md e agents/report-updater.md. As fontes foram lidas
antes da execução dos testes. Não alterei fontes ou testes permanentes.

## Achados reproduzidos

### RN-01 — Média: stops concorrentes do mesmo token podem converter sucesso em falha

Local: make-me-happy/scripts/report-native.mjs:74–90, especialmente o catch que grava
`failed` sem preservar uma confirmação `stopped` já publicada por outra chamada.

O stop libera o lock entre registrar `stopping`, construir o HTML e registrar o
resultado. Uma chamada A pode ficar entre a primeira gravação e o build; B, do mesmo
token, conclui toda a parada e grava `stopped`. Quando A continua, buildReport rejeita
porque esperava `stopping`. O catch de A sobrescreve a confirmação de B com `failed`.

Este cenário pode ocorrer entre stop do Oracle e callback que observou a run fechada:
`tickNativeReport` chama stopNativeReport ao detectar `meta.status === 'closed'`.

Repro: `node /tmp/mmh-native-review-repro.mjs`. A fixture pausa o processo A logo após
liberar seu primeiro lock; o processo principal executa B até concluir; então libera
A. A barreira é injetada por preload somente no processo da fixture, sem editar a
implementação. Resultado observado: B=`stopped`, A exit 1, estado final=`failed`,
erro=`report watcher ownership or status changed`, HTML final completo e inativo.
Evidência: `/tmp/mmh-native-review-LsiKir/result.json`, objeto `race`.

Impacto: parada correta é reportada como falha; retries e acompanhamento passam a
tratar como erro um render final já confirmado. Não houve perda de tasks ou evidências.

Critério de correção: chamadas concorrentes de stop para o mesmo token precisam
compartilhar a confirmação terminal; a chamada atrasada não pode degradar `stopped`
em `failed`. Um erro real de render deve continuar sendo propagado e registrado.

### RN-02 — Baixa: tick recuperado publica aviso de heartbeat antigo

Locais: make-me-happy/scripts/report-native.mjs:54–59 e
make-me-happy/scripts/report/render.mjs:263.

O tick constrói o HTML antes de atualizar last_success_at. Assim, quando o heartbeat
anterior está atrasado, o HTML recém-publicado inclui “Sem ciclo nativo confirmado no
intervalo esperado”, embora a mesma chamada acabe de concluir com sucesso. O JSON,
após retorno, informa `stale:false`. O aviso pode permanecer por mais dez minutos
ou reaparecer em todos os disparos se o host sempre introduzir atraso suficiente.

Repro no mesmo script: preparar native com started_at quinze minutos atrás, bind e
tick no horário real. Não há substituição do relógio do processo. Resultado:
`freshness.state_stale=false` e `freshness.html_warns_no_native_cycle=true`.
Evidência: `/tmp/mmh-native-review-LsiKir/result.json`, objeto `freshness`.

Critério de correção: o HTML de um tick bem-sucedido deve refletir a confirmação desse
ciclo. O aviso de atraso deve continuar aparecendo em builds que não correspondem a
um novo tick bem-sucedido. A falha de render não pode antecipar um heartbeat de sucesso.

## Ensaios independentes que passaram

Script: `/tmp/mmh-native-late-callback.mjs`.
Evidência: `/tmp/mmh-native-late-ghm8uN/result.json`.

- Prepare reserva o pack; tick anterior ao bind aguarda, e Node não assume a reserva.
- Bind/tick nativo gera captura inicial sem criar timer Node.
- Um callback nativo que já leu sua propriedade foi pausado antes de adquirir o lock
  de publicação. Durante a pausa, stop revogou o token e o fallback Node iniciou.
- Ao liberar o callback antigo, ele terminou com exit 1 por propriedade alterada.
  HTML e registro do watcher Node ficaram byte a byte/estruturalmente iguais.
- TASKS.json, artifactIdentity e captureEvidence permaneceram iguais após a troca.
- O watcher Node e todos os processos auxiliares foram encerrados pelo ensaio.

A primeira execução dessa fixture colocou seus próprios arquivos de controle na raiz
do produto fictício e, corretamente, alterou source_hash. Corrigi apenas a fixture,
colocando os controles dentro do pack excluído. A execução citada acima passou; esse
primeiro erro de instrumentação não foi tratado como achado da skill.

## Testes focados executados

25 PASS / 0 FAIL / 0 SKIP:

```
node --test make-me-happy/scripts/tests/report-native.test.mjs \
  make-me-happy/scripts/tests/report-watch.test.mjs \
  make-me-happy/scripts/tests/report-refresh.test.mjs
```

Cobrem bind, propriedade exclusiva, callback antigo após revogação, fallback, três
falhas consecutivas, run fechada, comandos CLI, ciclo Node, SIGTERM, SIGKILL/retomada,
confirmação por token e preservação de alterações após falha de apresentação. Os dois
achados acima reproduziram fora desses testes verdes.

## Contrato e limites

As instruções distinguem corretamente a reserva local da confirmação da ferramenta
nativa. Exigem criar/consultar/cancelar um recurso real com acesso ao mesmo checkout,
priorizam scheduler/subtask nativa e permitem Node quando faltam capacidades. Também
separam revogação local e cancelamento do host; o helper não alega cancelar a agenda.
A revogação de escrita foi demonstrada no ensaio concorrente descrito acima.

Não usei scheduler, subtask persistente ou serviço real. Provider e scheduler_id dos
ensaios são identificadores explícitos de fixture. Portanto, este passe não comprova
criação, pontualidade, consulta ou cancelamento de APIs nativas específicas. Não executei
navegador, rede, app-gp ou CI de produto. A espera de dez minutos foi coberta pela suíte
com relógio controlado; não permaneci dez minutos aguardando um agendador real.

## Revalidação após a correção — RN-01 e RN-02 fechados

Revalidado em 2026-10-23 sem editar fontes. Os achados originais acima permanecem
como registro da falha. Revisei a nova transação síncrona `withReportLock`: tick/stop
conferem propriedade, geram HTML e confirmam o resultado antes de liberar o mesmo
lock. A visão renderizada de um ciclo guardado pode remover o aviso stale; a gravação
de last_success_at continua posterior ao rename bem-sucedido.

### RN-01: paradas concorrentes

Executei `/tmp/mmh-native-review-revalidation.mjs`, derivado da reprodução original.
A barreira agora pausa no primeiro unlock do processo A independentemente de ainda
haver `stopping`, pois a transação única já termina antes desse unlock. O estado
observado nesse ponto foi `stopped`. B executou stop e retornou `stopped`; A foi
liberado e terminou com exit 0. Estado final `stopped`, last_error null e HTML com
auto-refresh desativado. O sucesso não foi degradado.

Evidência: `/tmp/mmh-native-revalidated-3QNt3U/result.json`, objeto `race`.

### RN-02: recuperação do heartbeat e contraprova de publicação malsucedida

Na mesma reprodução, um registro com início quinze minutos atrás recebeu um tick
atual bem-sucedido: JSON com stale=false e HTML sem o alerta de ciclo ausente.
Evidência: `/tmp/mmh-native-revalidated-3QNt3U/result.json`, objeto `freshness`.

Para verificar que a correção não inventa sucesso, executei
`/tmp/mmh-native-publication-failure.mjs`. Primeiro gravei um sucesso antigo e gerei
um build comum: ele continuou mostrando o aviso stale. Depois injetei EIO somente no
rename do HTML da fixture. Tick lançou o erro, preservou last_success_at antigo,
stale=true e HTML anterior. Stop com a mesma falha também lançou o erro, registrou
failed e preservou a captura anterior. Restaurado o rename, stop concluiu normalmente
com status stopped e HTML inativo.

Evidência: `/tmp/mmh-native-publish-failure-qlMwpT/result.json`.

### Revogação e regressões

Reexecutei `/tmp/mmh-native-late-callback.mjs` com a versão corrigida. Um callback
pausado antes de adquirir a transação foi liberado após revogação e início de Node;
continuou recusado com exit 1. HTML, watcher, TASKS e identidade de evidência ficaram
inalterados. Evidência: `/tmp/mmh-native-late-WCvCth/result.json`.

Suítes focadas reexecutadas: 15 PASS / 0 FAIL / 0 SKIP.

```
node --test make-me-happy/scripts/tests/report-native.test.mjs \
  make-me-happy/scripts/tests/report-refresh.test.mjs
```

Conclusão: RN-01 e RN-02 corrigidos nos cenários independentes; nenhuma regressão nova
observada nesta revalidação. Permanecem os limites originais: sem scheduler/serviço
real, sem navegador e sem teste de pontualidade de uma API nativa. Todos os processos
de fixture foram encerrados.

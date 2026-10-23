# Acompanhamento periódico do HTML

Esta é uma subtarefa operacional do Oracle durante uma run ativa. Ela não é uma
entrega do SDD e não entra no denominador de tasks concluídas. A geração é imediata,
com cadência de dez minutos, a partir dos registros do pack.

## Escolher o mecanismo disponível

Inspecione as ferramentas e suas descrições na sessão atual. A capacidade pertence
ao ambiente que executa o modelo; não a deduza do nome do LLM ou do aplicativo.
Escolha nesta ordem:

1. **Agendador nativo:** criação de recorrência de dez minutos, consulta e
   cancelamento por ID, execução com acesso ao mesmo OUT e checkout local.
2. **Subtask nativa persistente:** agente em background, espera/despertar nativo,
   consulta/interrupção e acesso ao mesmo pack enquanto o Oracle continua trabalhando.
   Use [agents/report-updater.md](../agents/report-updater.md). Criar um agente de
   execução única, enfileirar um lembrete ou manter o Oracle em espera não basta.
3. **Timer Node:** se faltarem essas capacidades, se a criação nativa falhar ou se
   o recurso não alcançar os arquivos atuais. Registre brevemente o motivo do fallback.

Use as APIs realmente expostas, sem inventar nomes de tools. Não crie agendas em
calendários, Pages ou serviços que não possam escrever neste pack. Um clone remoto
não contém automaticamente as alterações locais. Não mantenha dois mecanismos
ativos para o mesmo OUT. Não instale plugins ou altere configuração global para
forçar a disponibilidade de um recurso.

Por exemplo, o Claude Code documenta `CronCreate`, `CronList` e `CronDelete`; quando
essas ferramentas estiverem disponíveis, podem oferecer a recorrência. Seus prompts
agendados podem esperar o turno corrente e sofrer atraso; dez minutos é a cadência
solicitada, não uma garantia de pontualidade.
[Documentação oficial](https://code.claude.com/docs/en/scheduled-tasks).

## Iniciar ou retomar o mecanismo nativo

Consulte `report-watch.mjs status --dir "$OUT"`. Se houver registro nativo, consulte
seu `scheduler_id` na ferramenta de origem. `running` reserva a propriedade local;
`liveness: check-native-tool` exige consulta externa e `stale` indica atraso no último
ciclo. A ausência de heartbeat não prova que o job morreu. Reuse uma instância ativa;
antes de substituí-la, revogue sua escrita e cancele o recurso anterior.

Após confirmar a capacidade e a ausência de uma instância ativa:

```bash
node "$SKILL_ROOT/scripts/report-native.mjs" prepare --dir "$OUT" --kind subtask --provider "$NATIVE_TOOL"
```

Use `--kind schedule` para agendador recorrente. Guarde o `token` retornado. O estado
`starting` apenas reserva o pack; esse comando não cria agenda nem inicia um timer.
Crie o recurso pela ferramenta nativa. Passe caminhos absolutos para OUT e
SKILL_ROOT, além do TOKEN, no prompt. A ação de cada disparo é:

```bash
node "$SKILL_ROOT/scripts/report-native.mjs" tick --dir "$OUT" --token "$TOKEN"
```

O helper executa uma única atualização. O agendador ou a subtask controla a espera
e a repetição. Ele confere token/run/status sob o lock do HTML, registra sucesso ou
erro e não modifica tasks. Um disparo anterior ao bind retorna `waiting_for_binding`.

Guarde o ID real retornado pela ferramenta, confirme o recurso e vincule-o:

```bash
node "$SKILL_ROOT/scripts/report-native.mjs" bind --dir "$OUT" --token "$TOKEN" --id "$NATIVE_ID"
node "$SKILL_ROOT/scripts/report-native.mjs" tick --dir "$OUT" --token "$TOKEN"
```

Confira o primeiro sucesso e o recurso nativo antes de anunciá-lo ativo. O tick
imediato confirma a geração; a consulta à ferramenta confirma a agenda/subtask.
O uso pontual de Node pelo gerador não inicia o timer Node de fallback.
Se criação/bind falhar, revogue com `report-native stop`, cancele qualquer recurso
já criado e então use o fallback. Não deixe uma reserva `starting` abandonada.

## Fallback: timer Node

Se não houver recurso nativo adequado, consulte o estado:

```bash
node "$SKILL_ROOT/scripts/report-watch.mjs" status --dir "$OUT"
```

Com a run aberta e sem outra instância reservada, execute em uma sessão de processo
persistente fornecida pelo ambiente:

```bash
node "$SKILL_ROOT/scripts/report-watch.mjs" start --dir "$OUT"
```

Guarde o identificador da sessão e confira o primeiro `ok:true`. Continue a
implementação enquanto o processo roda. O default é 600 segundos;
`--interval-seconds` permite um intervalo explícito para diagnóstico.
Ao retomar, o status Node verifica identidade da run e existência do PID. Processo
encerrado não impede iniciar outro. `--fresh` tem OUT e monitor próprios.

Para qualquer mecanismo, confira os limites de duração, cancelamento e continuidade
do ambiente. Agendamento nativo também pode depender da sessão ou da máquina ativa.
Se nenhum recurso puder manter recorrência, informe que o timer não está ativo e use
as atualizações por evento/checkpoint. Não declare agendamento apenas por escrever
um prompt, preparar o registro ou executar uma única captura.

## Registrar o que cada task fez

O Oracle aplica resultados dos implementers conforme chegam. `TASKS.json` é o estado
validado. `run-meta init`, `task`, `step`, `sync` e `close` também atualizam o HTML,
sem esperar o timer. Arquivos de review, testes e demais dados entram na próxima
leitura periódica, ou em um build explícito.

Cada implementer registra andamento parcial ao iniciar, após um marco relevante,
ao encontrar impedimento e antes de esperar uma operação longa. Se houver trabalho
novo por mais de dez minutos, publique outro registro no próximo checkpoint. Um
comando longo não ganha um resultado inventado enquanto ainda roda.

Prepare um JSON exclusivo da task, fora de `results/`, com a versão corrente:

```json
{
  "id": "T-001",
  "expected_version": 1,
  "summary": "Parser CSV implementado. Testes ainda em execução.",
  "completed": ["Leitura do cabeçalho implementada"],
  "next": ["Conferir o resultado dos testes"],
  "blockers": [],
  "files": ["src/csv-parser.ts"]
}
```

```bash
node "$SKILL_ROOT/scripts/task-progress.mjs" --dir "$OUT" --result "$PROGRESS_INPUT"
```

O helper confirma id, versão e estado IN_PROGRESS/BLOCKED, acrescenta identidade e
horário da run e grava atomicamente `progress/T-001.json`. Em seguida atualiza o HTML.
Use somente a task atribuída ao implementer. Releia a versão após atualização pelo
Oracle; não force um registro antigo sobre a versão nova.

O card distingue esse relato das evidências verificadas. Registro de outra run ou
versão é ignorado. Relatos não alteram status, score, testes, cobertura ou fechamento.
Resultados `results/*.json` aguardam aplicação pelo Oracle; o monitor não os promove
a DONE. Código modificado que ninguém registrou não pode ser apresentado como uma
entrega concluída. Preserve o horário do último relato para tornar essa diferença visível.

## Pausar e finalizar

Antes de devolver o controle ao usuário ou suspender uma run, aplique os resultados
recebidos e pare o mecanismo escolhido.

**Nativo:** revogue a escrita e gere a última captura:

```bash
node "$SKILL_ROOT/scripts/report-native.mjs" stop --dir "$OUT" --token "$TOKEN"
```

Em seguida cancele o `scheduler_id` na ferramenta nativa e confirme o cancelamento.
Esses dois passos são necessários: o helper não cancela recursos do host; cancelar
um job não gera a captura final. Mesmo se a geração falhar, cancele o recurso e
repare o HTML antes de declarar a parada concluída. Callbacks atrasados não podem
escrever depois da revogação ou sobre o token de uma nova instância.

**Node:**

```bash
node "$SKILL_ROOT/scripts/report-watch.mjs" stop --dir "$OUT"
```

A parada cooperativa aguarda a geração final da instância solicitada. Retomada
concorrente conserva a confirmação em `report-watch-history/`. Se o processo já
morreu, `stop` tenta reconstruir o HTML. SIGINT/SIGTERM também geram uma última
captura; SIGKILL ou suspensão exigem conferência na retomada.

Após `run-meta close`, o monitor Node detecta o fechamento e sai; um callback nativo
encerra sua autorização local ao observar a run fechada. O Oracle ainda cancela e
confirma o recurso nativo antes de versionar o pack. Falha ou timeout exige verificar
o estado. Regenerar HTML ou atualizar registros do monitor não muda o selo do pack.

## Integridade e falhas

- O gerador usa o lock do pack e troca o HTML por rename. Leitores veem um arquivo
  completo; falha de renderização preserva a última captura.
- Ambos os mecanismos recusam JSON canônico inválido e preservam o HTML anterior.
  Após três falhas consecutivas ficam em erro. O timer Node tenta novamente em dez
  segundos; no nativo, o executor repete após espera nativa ou no próximo disparo e
  cancela a recorrência se atingir o limite. Lock ocupado exige repetir depois do
  escritor; não remover o lock à força.
- `report-watch.json` registra backend/token/run, intervalo, último sucesso e erro.
  O modo Node inclui PID; o nativo inclui ferramenta, tipo e ID do recurso.
  `report-watch-history/` preserva as confirmações terminais ao reiniciar.
  Confira o estado ao receber erro da sessão; não esconda falha do monitor no resultado.
- Se a escrita da task foi concluída, uma falha posterior de HTML aparece como aviso.
  Não reaplique o resultado da task: reconstrua apenas o relatório.

```bash
node "$SKILL_ROOT/scripts/build-report.mjs" --dir "$OUT"
```

Enquanto o monitor estiver ativo, o HTML relê o arquivo a cada minuto quando a página
estiver visível e o leitor não estiver editando os filtros. Preserva aba, filtros e
cards abertos. Uma captura atrasada mostra aviso de desatualização. O botão “Atualizar
agora” também permite reler o arquivo. Isso não reexecuta testes nem consulta serviços.

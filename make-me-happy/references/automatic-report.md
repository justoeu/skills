# Acompanhamento periódico do HTML

Esta é uma subtarefa operacional do Oracle durante uma run ativa. Ela não é uma
entrega do SDD e não entra no denominador de tasks concluídas. Um processo local
supervisionado lê os registros do pack e gera `report.html` imediatamente e a cada
dez minutos. Ele não precisa de chamadas a um modelo.

## Iniciar e retomar

Após o setup ou a retomada, consulte o estado:

```bash
node "$SKILL_ROOT/scripts/report-watch.mjs" status --dir "$OUT"
```

Se `running` for false e a run estiver aberta, execute em uma sessão de processo
persistente fornecida pelo host:

```bash
node "$SKILL_ROOT/scripts/report-watch.mjs" start --dir "$OUT"
```

O comando fica em execução. Guarde o identificador da sessão de processo e confira
o primeiro evento `ok:true`. Continue a implementação enquanto ele roda. Não espere
dez minutos no turno do agente nem inicie uma segunda instância. O default é 600
segundos; `--interval-seconds` permite um intervalo explícito para diagnóstico.

Ao retomar, `status` verifica identidade da run e se o PID ainda existe. Um registro
de processo encerrado não impede iniciar outro. `--fresh` tem OUT e monitor próprios.
Nunca reutilize um processo de outra run ou mate processos por nome.

O monitor não sobrevive à suspensão ou encerramento do host por promessa do agente.
Se o host não permitir processos persistentes, informe que o ciclo de dez minutos
não está ativo. Continue usando as atualizações por evento e reconstrua o HTML nos
checkpoints. Não declare um timer ativo apenas porque escreveu estes comandos.

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
recebidos e pare a subtarefa:

```bash
node "$SKILL_ROOT/scripts/report-watch.mjs" stop --dir "$OUT"
```

A parada é cooperativa, limitada ao token da instância do pack. Ela espera a última
geração e só então confirma `running:false` para essa instância. Uma retomada
concorrente preserva o resultado anterior em `report-watch-history/`; ela não
prolonga a parada nem esconde falhas da geração final. Se o processo já morreu, `stop` ainda
tenta reconstruir o HTML. Falha ou timeout não significa parada concluída: consulte
o estado e resolva o erro. SIGINT/SIGTERM também tentam gerar a última captura.
SIGKILL, queda da máquina ou suspensão exigem conferência na retomada.

Depois de `run-meta close`, o monitor detecta o fechamento, gera a captura final e
termina. Execute `stop` para confirmar a saída antes de versionar o pack. O selo do
fechamento não é alterado pela regeneração do HTML ou pelos arquivos do monitor.

## Integridade e falhas

- O gerador usa o lock do pack e troca o HTML por rename. Leitores veem um arquivo
  completo; falha de renderização preserva a última captura.
- O monitor recusa JSON canônico inválido, registra erro e tenta novamente em dez
  segundos. Após três falhas consecutivas, termina com erro. Lock ocupado recebe
  tentativas curtas; ele não é removido à força.
- `report-watch.json` registra PID/token/run, intervalo, último sucesso e último erro.
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

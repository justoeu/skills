# Agendamento nativo do relatório — 2026-10-23

## Entrega

A make-me-happy **1.7.0** prioriza o agendamento disponível no ambiente do agente:

1. Agendador nativo com recorrência, consulta, cancelamento e acesso ao pack atual.
2. Subtask persistente em background com espera nativa, supervisão e acesso ao pack.
3. Timer Node quando faltarem essas capacidades ou a criação nativa falhar.

A detecção pertence ao Oracle, que inspeciona as ferramentas expostas na sessão e
suas descrições. Não existe uma tabela presumindo capacidade pelo nome do LLM.
Cada mecanismo usa o mesmo gerador de HTML, com as atualizações por evento e o
andamento parcial por task preservados. O gerador continua sendo um comando Node
pontual; a espera e a repetição ficam com a ferramenta nativa quando selecionada.

O [protocolo](../../make-me-happy/references/automatic-report.md) exige criar e
conferir o recurso real antes de declarar agendamento ativo. `report-native.mjs`
reserva o pack, vincula o ID retornado, executa cada captura e revoga sua escrita.
Ele não cria nem cancela recursos externos por conta própria. O Oracle confirma
também a parada na ferramenta de origem. A
[subtask de relatório](../../make-me-happy/agents/report-updater.md) contém o escopo,
a espera, a recuperação e o encerramento.

Identidade, publicação e confirmação nativas ocorrem sob o mesmo lock. O token
impede callbacks atrasados de escrever depois da revogação ou sobre uma nova
instância. A reserva também impede o timer Node de iniciar simultaneamente. Estado
nativo atrasado exige consulta ao recurso real; não é tratado como prova de morte.
Os arquivos operacionais continuam fora da identidade das evidências e do selo.

## Validação

- [Suíte final](native-report-2026-10-23-evidence/make-me-happy-suite.log):
  **163/163 PASS**, zero falhas e zero skips, com Chromium habilitado.
- [Subtask real desta sessão](native-report-2026-10-23-evidence/native-forward-result.md):
  `collaboration.spawn_agent` criou `/root/report_native_forward`, que executou dois
  ticks usando `clock.sleep` entre eles. A segunda captura incorporou a alteração
  feita pelo Oracle entre os ciclos. Não foi iniciado o timer Node.
- O intervalo observado foi **26,681 segundos**, incluindo espera nativa de
  10,0058 segundos e execução das ferramentas. O intervalo reduzido foi uma exceção
  explícita de diagnóstico; não é evidência de dez minutos reais nem de pontualidade.
  O caso de 600.000 ms está coberto por relógio controlado nos testes.
- O Oracle [revogou o registro](native-report-2026-10-23-evidence/native-stop.json)
  e confirmou `completed` por `collaboration.list_agents`. A fixture ficou com
  `status: stopped` e `running: false`.
- [Revisão independente](native-report-2026-10-23-evidence/independent-review.md):
  RN-01 (paradas concorrentes degradando sucesso) e RN-02 (alerta de atraso antigo
  após recuperação) foram reproduzidos, corrigidos e revalidados. As duas
  regressões falharam [antes](native-report-2026-10-23-evidence/regressions-red.log)
  e passaram [depois](native-report-2026-10-23-evidence/regressions-green.log).
- A contraprova independente de falha no rename preservou o HTML e o horário do
  último sucesso anteriores. O callback atrasado após troca para Node foi recusado
  sem modificar HTML, estado, TASKS ou identidade de evidência.
- [Validação formal](native-report-2026-10-23-evidence/validation.json), links de
  documentação e diff passaram. O
  [snapshot](native-report-2026-10-23-evidence/source-snapshot.json) registra 57 fontes.

## Alcance e limites

Os [49 links conferidos](native-report-2026-10-23-evidence/host-exposure.json)
continuam apontando para a fonte canônica nos sete roots de Codex, Claude, Grok,
Muse, OpenCode, Agy CLI e Antigravity App/IDE. A make-me-happy expõe 1.7.0; as outras
skills mantêm suas versões. Sessões com instruções antigas precisam relê-las.

O teste real comprova a integração com as ferramentas desta sessão. A revisão não
executou uma API de agendamento em cada produto. Um ambiente sem espera nativa,
persistência, cancelamento ou acesso aos arquivos atuais usa o fallback descrito.
Uma agenda remota com clone próprio não equivale ao checkout local em edição.

A cadência solicitada é dez minutos. A execução nativa pode depender de turnos,
quota, duração da sessão ou máquina ativa. Como exemplo documentado, os prompts
agendados de Claude Code podem esperar o turno corrente e ter atraso; o protocolo
não promete pontualidade ou continuidade além das garantias do provedor.
[Documentação oficial](https://code.claude.com/docs/en/scheduled-tasks).

Os ensaios usaram fixtures temporárias, sem monitores em aplicações existentes,
mudanças de configuração global ou serviços de produção. Não houve push. Evidências
mantêm os paths temporários originais como registro do ensaio.

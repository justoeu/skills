# Atualização automática do HTML — 2026-10-23

## Entrega

A make-me-happy **1.6.0** inclui uma subtarefa operacional que gera `report.html`
imediatamente e a cada dez minutos durante a implementação. O processo é local,
supervisionado pelo host e independente de chamadas a um modelo. Não entra na
contagem de entregas do SDD. O protocolo está em
[automatic-report.md](../../make-me-happy/references/automatic-report.md) e foi
ligado ao entrypoint, implementer, lifecycle e schema do pack.

Mudanças de task e etapa, inicialização, sincronização e fechamento também geram
HTML. Cada executor pode registrar andamento parcial com identidade da run,
versão da task, horário, trabalho feito, próximos passos, impedimentos e arquivos.
O relatório distingue esse relato de resultados validados. O monitor não aplica
resultados pendentes nem muda status, score, gates ou evidências.

O gerador usa o lock do pack e publicação atômica. Falhas de apresentação preservam
o HTML anterior e não desfazem uma task já salva. O processo recusa uma segunda
instância ativa, trata SIGINT/SIGTERM, detecta fechamento e confirma uma geração
final na parada. Ao reiniciar, conserva confirmações terminais por token para que
um stop anterior não espere a instância nova nem perca o erro do render anterior.

O HTML mostra horário de geração, estado da atualização e aviso de atraso. Enquanto
a captura indica monitor ativo, a página relê o arquivo a cada minuto, preservando
aba, filtros e cards abertos. O leitor pode atualizar manualmente. A releitura não
interrompe a edição de filtros e não executa verificações do produto.

## Evidências

- [RED inicial](automatic-report-2026-10-23-evidence/refresh-red.log): quatro falhas
  reais antes da implementação — atualização por task/etapa, lock e preservação do
  HTML quando o estado canônico está inválido.
- [Suíte final](automatic-report-2026-10-23-evidence/make-me-happy-suite.log):
  **153/153 PASS**, zero falhas e zero skips, com Chromium real habilitado.
- O intervalo padrão foi exercitado com relógio controlado: geração inicial e outra
  após **600.000 ms**. O processo CLI foi exercitado com timer real de um segundo,
  duplicidade, status e SIGTERM. Não se afirma espera de dez minutos reais.
- Chromium validou atualização e preservação da visão do leitor tanto por HTTP
  local quanto por `file://`, além do aviso de atraso e ausência de erros de script.
- [Revisão independente](automatic-report-2026-10-23-evidence/independent-review.md):
  oito cenários adicionais passaram. A revisão encontrou RW-01, uma corrida entre
  stop e restart, corrigida antes da entrega. A reprodução original passou de
  timeout após 15 segundos a confirmação em 105 ms, preservando o novo processo.
  Uma falha real no render final continuou sendo reportada corretamente em 102 ms.
- [Regressões da corrida: RED](automatic-report-2026-10-23-evidence/stop-race-red.log)
  e [GREEN](automatic-report-2026-10-23-evidence/stop-race-green.log) cobrem sucesso e
  falha da geração final com retomada imediata.
- [Validação formal e exposição](automatic-report-2026-10-23-evidence/validation.json):
  skill válida, checker sem drift/avisos/ausências e diff sem erros de whitespace.
- [Snapshot das fontes](automatic-report-2026-10-23-evidence/source-snapshot.json)
  registra os hashes usados nesta validação. Scripts e resultados independentes
  foram preservados junto ao relatório; paths temporários são registros do ensaio.

## Instalação e limites

Os [49 symlinks conferidos](automatic-report-2026-10-23-evidence/host-exposure.json)
expõem as seis skills e o alias `mmh` nos sete roots de Codex, Claude, Grok, Muse,
OpenCode, Agy CLI e Antigravity App/IDE. A make-me-happy está em 1.6.0 em todos eles;
as versões das demais skills não mudaram. A evidência é de exposição no filesystem;
não representa um prompt executado por modelo em cada host. Sessões que carregaram
instruções antigas precisam relê-las ou ser reabertas.

O ciclo depende de um processo persistente e do host ativo. Suspensão, SIGKILL ou
encerramento da máquina exigem conferência na retomada. Um host sem esse recurso
deve informar a ausência do timer e usar as atualizações por evento/checkpoint.
O HTML só pode apresentar trabalho registrado; código não relatado não é promovido
a entrega concluída. Uma captura estática já aberta pode precisar do botão de
atualização após a retomada do monitor.

Esta mudança atualiza a skill e seus testes. Não iniciou monitores em aplicações
existentes nem migrou packs de produto. Os ensaios usaram fixtures temporárias e
encerraram os processos que criaram. Não houve push.

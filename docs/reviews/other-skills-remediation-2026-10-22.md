# Remediação das skills — 2026-10-22

> Atualização em 2026-10-23: os testes externos e a cobertura real Swift/Xcode foram exercitados, com correções adicionais e **311 testes aprovados, zero skips**. Consulte o [fechamento das validações restantes](remaining-validation-2026-10-23.md). O conteúdo abaixo registra a rodada de 2026-10-22.

## Estado e escopo

Correções aplicadas às cinco skills próprias adicionais (`abuse-audit`, `atlas-docs`, `deep-audit`, `ultra-deep-audit`, `sonar-swift-local`) e ao verificador de links. A correção anterior da `make-me-happy` foi preservada e sua suíte voltou a passar na execução conjunta. Skills externas instaladas na máquina não fazem parte deste escopo.

Este documento substitui o estado ABERTO da [auditoria inicial](other-skills-2026-10-22.md). Os relatórios anteriores continuam como registro da versão defeituosa. As alterações estão na fonte canônica, exposta aos hosts por symlink; sem commit/push.

**Estado de fechamento:** todos os achados conhecidos desta rodada foram corrigidos e revalidados nos cenários descritos. Validação conjunta, revisão independente e prova Docker concluídas. Limites não exercitados permanecem explícitos ao final.

## Validação conjunta

| Área | Resultado | Evidência exercitada |
|---|---|---|
| make-me-happy | 130 passaram | Ciclo de execução, revisão, retomada, hooks, relatórios e Chromium real |
| Atlas | 37 passaram | Sanitização, delta/full, histórico, primeiro uso e navegação real no Chromium |
| Deep | 12 passaram | Git/worktrees reais, revisão, reversão, interrupção SIGKILL, concorrência e gates |
| Ultra | 58 passaram; 28 SKIP explícitos | Ciclo completo, corrupção, isolamento, prova/revisão, relatórios, deps e concorrência |
| Links | 14 passaram | Backup recuperável, rollback, destino exato, alias, legado e links quebrados |
| Sonar | 22 passaram | API HTTP local, scanner em subprocesso, credenciais, falhas, cobertura, bootstrap e concorrência |
| Total | **273 passaram, zero falhas; 28 integrações externas não executadas** | 251 Node + 22 Python |
| Validação formal | 6/6 skills válidas | `skill-creator`, com PyYAML já em cache |
| Sintaxe | 66 JavaScript, 11 Python, 1 shell | Parsing/compilação, separado das provas de comportamento |
| Exposição aos hosts | 0 drift, 0 avisos, 0 ausentes | Checker sem mutação |

Comandos reproduzíveis:

```sh
MMH_REAL_BROWSER=1 ATLAS_REAL_BROWSER=1 node --test \
  scripts/tests/*.test.mjs make-me-happy/scripts/tests/*.test.mjs \
  atlas-docs/scripts/tests/*.test.mjs deep-audit/scripts/tests/*.test.mjs \
  ultra-deep-audit/scripts/tests/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s sonar-swift-local/scripts/tests -v
node scripts/check-links.mjs
git diff --check
```

Os 28 SKIP são contratos de outro projeto: 1 pom, 12 ci-local, 15 runtime-images. Dependem de `ULTRA_PROJECT_ROOT` explícito e não são contados como aprovados. A suíte própria deixou de depender implicitamente daquele checkout.

## Matriz de fechamento

Cada linha abaixo corresponde aos IDs da auditoria inicial. Cenários compartilhados entre Deep e Ultra foram corrigidos em ambos; não são contados como descobertas independentes.

| IDs | Correção aplicada | Prova principal |
|---|---|---|
| TL-01 | Preserva backup fora do diretório de descoberta; rollback se a criação do symlink falhar | Regressões de filesystem + reprodução independente dos bytes preservados |
| TL-02 | Compara o destino canônico exato da skill/alias | Link para outra skill é diagnosticado |
| TL-03 | `lstat` distingue link quebrado e entrada legada; recusa sobrescrita insegura | Auditoria/ensure não abortam com EEXIST/ENOENT |
| SO-01 | Scanner precisa concluir a tarefa atual; gate por analysisId; métricas verificadas contra análise atual | Falha, 401, timeout, CE failed, scan vazio e análise antiga não geram aprovação |
| SO-02 | Credencial pendente persiste antes da troca remota e é reconciliada na retomada | Falha injetada antes/depois da alteração e gravação |
| SO-03 | Chave de token v2 codifica UTF-8 sem perder pontuação/caixa; migração preserva env | Projetos antes colidentes recebem tokens próprios |
| SO-04 | Arquivo nasce 0600, troca atômica, lock entre escritores; token fora de argv | Permissão inicial, falha de escrita, concorrência e scanner real em subprocesso |
| SO-05 | LCOV aceita checksum, normaliza aliases e agrega linhas do mesmo arquivo | Entradas repetidas/alias geram um file/linha; externo e vazio rejeitados |
| SO-06 | Diretório e scratch exclusivos por scan; não escolhe primeiro artefato ambíguo | Dois scans concorrentes e build antigo/ambíguo |
| SO-07 | Porta resolvida uma vez e propagada a bootstrap, API e Compose | Default/flag/ambiente/env-file e comando Compose capturado |
| SO-08 | Extensões na imagem; recriação renova volume anônimo herdado da imagem base | Prova Docker descrita abaixo; banco/dados/logs continuam nomeados |
| AB-01 | Avalia cobertura efetiva do controle em middleware ou handler | Aplicação mínima independente: ambos limitam a terceira operação |
| AB-02 | Separa tamanho, frequência, concorrência, identidade e retenção | Credencial reutilizável, upload pequeno repetido e cadastro/cache sem teto identificados corretamente |
| DA-01 | Init JSON literal, sem eval de dados Git | Metadados com caracteres de shell não executam conteúdo |
| DA-02/05 | Votos, contexto e hashes revalidados; rodada inválida não herda aprovação | JSON/voto inválido e voto removido bloqueiam; achados prévios sobrevivem |
| DA-03/04/09 | Identidade estável; merge valida antes de escrever; desaparecimento não apaga pendência | Reordenação, achado novo, entrada truncada, review/in_progress e reconsolidação |
| DA-06/08 | Runs únicas, resume explícito, locks e gravação atômica | Duas runs/dia, escritores simultâneos, retry e SIGKILL antes/depois de rename |
| DA-07/12 | Gate exige produtores/inventário/hunters completos, inclusive zero achados | Matriz exata, no_attack_surface explícito, deps válidas e fonte atual |
| DA-10 | Prova real green/red/green em worktree isolada; logs/contexto verificados | Correção Node real fecha; false-green, timeout e prova antiga não fecham |
| DA-11 | Git base/ref/merge-base inválido falha antes de persistir run | Ref inexistente e no-Git exigem caminho full explícito |
| UD-01/07 | Painel valida votos, candidatos, inventário e conciliação com hunters | Candidato omitido não vira painel vazio limpo; voto ausente/inválido bloqueia |
| UD-02/03 | Schemas de entrada estritos e IDs únicos, inclusive objeto singular | Corrupção preserva agregado; done não fecha dois achados |
| UD-04/05 | Runs/snapshots/bindings isolados; status preservado; reabrir restaura bloqueio | Fix → revisão → done → remerge → reopen → segunda run |
| UD-06 | Auditoria e fechamento separados; evidência atual obrigatória por tipo de mudança | Falta de prova/revisão/docs ou alteração do log impede COMPLETE |
| UD-08 | Escopo de diretório percorre código real; incompletude fica visível | Diretórios, deduplicação, inválidos e arquivos não lidos |
| UD-09 | Erros/skips de dependências aparecem no HTML/Markdown e estado | Falha de registry não aparece como “todas atualizadas” |
| UD-10/11 | Remove regras de aplicação específica; prova por bug/refactor/docs/deps; política portável | Descoberta/override explícitos, caracterização e integrações externas opt-in |
| A1/2 | Ações delegadas e IDs escapados; sanitização de URL/headers/JSON/chaves | Cliques/reload/hashchange no Chromium; canários ausentes em JSON e HTML |
| A3/7/8 | Score derivado; inventário obrigatório; runtime só com fonte/timestamp declarados | Cov falso ignorado; inventário incompleto bloqueia; número sem fonte removido |
| A4/5/6 | Full remove listas, delta usa commit documentado, histórico pertence ao modelo anterior | Duas atualizações, remoções, dirty/untracked e base inválida |
| A9 | Referências de fluxo validadas; hash desconhecido mostra ausência | Links órfãos bloqueiam build e navegação não troca para outro fluxo |
| Atlas adicional | Changelog inicial preservado; série por observação, rebuild idempotente | Três estados no mesmo dia sem apagar nem duplicar histórico |

Oportunidades de procedimento também tratadas: Abuse adapta inventário à stack e resolve a base do diff; Deep documenta reversão isolada, dispatch, ausência de prova, fallback N+1, descoberta da skill e idempotência; Ultra remove pressupostos de arquitetura/SDD/Graphify e separa modos de validação; Sonar distingue linguagem disponível de edição do servidor e só apresenta cobertura numérica válida quando confirmada.

## O que a revisão independente acrescentou

Os revisores receberam as instruções e entradas da tarefa, sem reaproveitar o resultado esperado como resposta. Os achados adicionais abaixo foram reproduzidos, corrigidos e revalidados:

| Ajuste adicional | Prova de fechamento |
|---|---|
| Backup de skill ainda descoberto dentro do host | Backup movido para `.skill-link-backups` fora do root; bytes antigos preservados |
| LCOV repetido por alias e cobertura inválida aceita | Um file/linha por caminho canônico; NaN/Infinity/texto/bool/fora de 0–100 rejeitados |
| Atlas falhava no primeiro uso sem docs/atlas | Merge e build criam pais de saída; fluxo inteiro repetido sem mkdir manual |
| Ultra aceitava deps parcial, base inexistente e perdia bind concorrente | Deps incompleta bloqueia, base falha sem pack, lock busy/retry preserva ambos os binds |
| Sonar privado exigia credencial de leitura | Reader específico ou admin local somente nos GETs de métricas; scanner recebe token de análise |
| Scanner herdava credenciais SONAR_LOCAL_* exportadas | Subprocesso real recebe nenhuma dessas variáveis; marcador benigno permanece |
| HTTP podia seguir redirect autenticado | Ambos os clientes recusam 301/302/303/307/308; servidor destino e proxy recebem zero chamadas |
| Recriação Docker podia conservar volume anônimo antigo | Com `--renew-anon-volumes`, marker muda de 1 para 2; novo scan conclui usando projeto/credenciais persistidos |

Relatórios independentes, resultados estruturados e logs antes/depois estão no [diretório de evidências](other-skills-remediation-2026-10-22-evidence/README.md). As referências `/tmp` dentro dos relatórios originais identificam fixtures locais; as cópias duráveis e seus índices ficam nesse diretório.

## Sonar real e persistência

Foi criado um projeto Docker Compose descartável, em porta loopback exclusiva, com banco, imagens derivadas e aplicação Swift mínima próprios. Nenhuma instância compartilhada foi reiniciada. Os recursos desse projeto são removidos ao terminar; credenciais não entram no relatório.

O teste inicial real detectou HTTP 403 nas métricas de projeto privado; outro detectou o marker antigo no volume herdado. Ambos motivaram correções além dos mocks. A [execução final](other-skills-remediation-2026-10-22-evidence/sonar-live-smoke.json) passou:

- Imagem base `sonarqube-swift:26.9.0.129388-apple0.5.1`, PostgreSQL `17.11-alpine3.24`; bootstrap executado duas vezes sem reset.
- Antes: análise `971c3bb1-be7d-43ce-93f2-6eccb361263d`, 6 linhas Swift, gate OK.
- Depois: análise nova `8cf789d2-0fa7-4c48-a3d1-091e324f1e20`, mesmas 6 linhas/revisão, gate ERROR **consultivo**, scan operacional concluído. Esse resultado foi preservado como ERROR, sem convertê-lo em aprovação.
- Marker da imagem nova = `2`; JAR efetivo com SHA-256 `c27432e52a6ebc698b77ad42bf3d98f5e34fb20d3f398799bda74fbc008f8612`, correspondente ao pin do Dockerfile.
- Projeto/credenciais continuaram válidos após recriação, sem novo bootstrap. Cobertura exibida como **não medida**, coerente com a fixture sem Package.swift/Xcode.
- Containers e volumes nomeados dos projetos descartáveis foram removidos; consulta final por nome não encontrou recursos deles. Logs privados ficaram no diretório temporário; o relatório durável não contém os arquivos de credenciais.

Reprodução opt-in, usando as imagens já disponíveis localmente:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 sonar-swift-local/scripts/tests/live_smoke.py \
  --image sonarqube-swift:26.9.0.129388-apple0.5.1 \
  --postgres-image postgres:17.11-alpine3.24 \
  --output /tmp/sonar-live-smoke.json
```

Deep também passou em **81 invocações CLI independentes** com Git/Node reais, incluindo bug/reversão, retomada/reabertura, prova removida, base inválida e caso legítimo sem superfície de ataque. Ultra repetiu os três contraexemplos independentes e o fluxo positivo. Atlas repetiu extração de fonte, primeiro scan, atualização e rebuild sem setup manual adicional. Votos sintéticos testaram o mecanismo; não foram apresentados como revisão independente de uma aplicação real.

## Versões e migração

| Skill | Versão | Contrato |
|---|---|---|
| make-me-happy | 1.4.0 | Schema 2 da correção anterior |
| abuse-audit | 1.0.1 | Ajustes metodológicos, sem pack novo |
| atlas-docs | 2.0.0 | Atlas schema 2; reconstruir legado com inventário, referências e fontes válidos |
| deep-audit | 2.0.0 | Schema 2; init JSON; pack antigo é histórico, exige nova run/evidência |
| ultra-deep-audit | 2.0.0 | Schema 2; bindings e prova atuais; legado não herda confiança |
| sonar-swift-local | 2.0.0 | Reexecutar bootstrap por projeto para tokens v2; preservar env e volumes nomeados |

## Limites da conclusão

- Os testes demonstram os contratos e cenários observados. Não certificam toda decisão futura de um agente nem a ausência de defeitos em qualquer aplicação.
- Hashes e attestations verificam consistência local; não autenticam identidade do revisor nem provam a qualidade semântica do raciocínio. Prova RED ainda exige confirmar que a falha corresponde ao defeito.
- Browser real exercitado: Chromium local, offline, para Atlas e make-me-happy. Deep/Ultra validam artefatos/DOM, sem afirmar revisão visual em todos os navegadores.
- Docker usa duas imagens derivadas com o mesmo plugin Apple e conteúdo marcador diferente. Isso testa persistência/visibilidade na atualização, não compatibilidade com outra versão do plugin.
- A máquina tem CommandLineTools, sem Xcode completo. Cobertura SwiftPM/LCOV foi validada com fixtures e conversão; não foi comprovada cobertura real de um aplicativo Xcode.
- Não foram executados os 28 contratos externos, registries/CVEs vivos de todas as stacks, nem auditoria de produto em produção. Não foram publicados commits ou alterações remotas.

A evidência técnica, as fronteiras não exercitadas e a versão das fontes ficam registradas em conjunto para evitar transformar uma etapa incompleta em aprovação silenciosa.

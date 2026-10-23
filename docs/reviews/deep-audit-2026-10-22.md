# Revisão independente — deep-audit

> Registro da auditoria inicial. O estado atual e as provas das correções estão no [relatório de remediação](other-skills-remediation-2026-10-22.md). Os achados abaixo descrevem a versão anterior.

Data: 2026-10-22 (sessão America/Sao_Paulo; fixtures geradas após 00:00 UTC de 2026-10-23).
Escopo: `~/Developer/harness/skills/deep-audit/` inteira, com foco nos scripts de inicialização, consolidação, votação, acompanhamento e geração de relatório. **READ-ONLY no harness**: nenhuma fonte ou teste permanente foi alterado. Não foi executada auditoria de produto real, consulta à rede, publicação externa ou correção de produto.

**Resultado:** os scripts passam na checagem de sintaxe, mas há falhas demonstradas que permitem execução de conteúdo do projeto durante setup, perda de achados/progresso e fechamento com evidência incompleta ou atribuída ao achado errado. As promessas de apuração por código não são plenamente garantidas pelo código atual.

Base de paths abaixo: `~/Developer/harness/skills/`.
Artefatos de reprodução: `/var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/deep-audit-review-QtlRN0/`.
Resultados completos por cenário: `results.json` nesse diretório; checagens auxiliares em `verification.json`.

## Achados confirmados — prioridade alta

### DA-01 — Saída shell de init-run executa metadados não confiáveis

- **Severidade:** alta (execução de comandos durante setup).
- **Local:** `deep-audit/scripts/init-run.mjs:191-201`, especialmente `:194`; consumo documentado em `deep-audit/SKILL.md:136` (bloco Setup) e `deep-audit/agents/maestro-deep-audit.md:38`.
- **Reprodução:** fixture `repo/package.json` com `name: "$(printf EXECUTED_BY_INIT)"`. Executar `init-run.mjs --root <repo> --out <tmp>/shell-init`; ele emite `APP="$(printf EXECUTED_BY_INIT)"`. Interpretar essa saída pelo shell, como faz o `eval` documentado, produz `APP=EXECUTED_BY_INIT`, comprovando execução do `printf` embutido. A prova usou somente builtin inofensivo, sem acesso a dados ou serviços.
- **Impacto:** `JSON.stringify` protege JSON, mas não shell. Nome/versão, branch e paths com `$()`, crases ou expansões viram código/expansões dentro de aspas duplas. Um repositório auditado controla parte dessas entradas.
- **Recomendação:** saída estruturada JSON lida sem `eval`, ou quoting shell correto por argumento e teste de round-trip com `$`, crases, aspas e quebras de linha.

### DA-02 — Voto de segurança inválido descarta candidato e declara `verified`

- **Severidade:** alta (falso resultado favorável de segurança).
- **Local:** `deep-audit/scripts/sec-verify.mjs:245-253`, `:350-358`, `:387-389`.
- **Reprodução:** um candidato HIGH, arquivos de voto presentes para as três lentes; dois `TRUE_POSITIVE` e `DEFENSES.verdict="UNKNOWN"`. Rodar a CLI documentada com `--require-vote-files`.
- **Resultado observado:** exit **0**, `agent-cerbero.json=[]`, coverage `verification_status="verified"` e `dropped_sample[0].reason="incomplete-or-invalid-panel"`. Após merge, `lint-findings --gate` também retorna **0**.
- **Causa:** o candidato inválido é descartado, mas o último braço do ternário de coverage devolve `verified` mesmo quando há painel incompleto. Presença de arquivo não significa voto válido.
- **Recomendação:** qualquer painel inválido deve manter pendência verificável e retornar falha; não transformar falta de apuração em ausência de vulnerabilidade. Gate deve consumir coverage independentemente de sobreviventes.

### DA-03 — Novo candidato herda refutação de outro por reutilização de ID sequencial

- **Severidade:** alta (CRITICAL novo desaparece da lista de abertos).
- **Local:** `deep-audit/scripts/sec-verify.mjs:331-337`; `deep-audit/scripts/merge-findings.mjs:123-129`.
- **Reprodução:** primeira apuração emite `SEC-CER-001` para achado LOW em `old.js`; refutar usando `sync-progress --refute ... --evidence "Guard in old.js ..."`. Na próxima apuração no mesmo pack, emitir apenas um candidato CRITICAL diferente em `new.js`. A numeração reinicia em `SEC-CER-001`; merge prioriza o match por ID sobre a identidade/local do defeito.
- **Resultado observado:** `new.js` fica `severity=CRITICAL`, `status=refuted`, com a justificativa sobre `old.js`; **gate exit 0**. Fixture `wrong-status-carry-single`.
- **Variante:** mantendo o candidato antigo e acrescentando novo de maior severidade, ambos terminam com `SEC-CER-001`; o gate detecta duplicidade, mas ambos já receberam a refutação errada. Fixture `wrong-status-carry`.
- **Recomendação:** identidade estável independente de ordem/severidade, vínculo explícito ao candidato e verificação de identidade antes de copiar desfechos; não reutilizar ID ordinal como chave histórica universal.

### DA-04 — JSON de agente inválido apaga HIGH previamente conhecido e gate passa

- **Severidade:** alta (perda de achado e fechamento incorreto durante falha/interrupção).
- **Local:** `deep-audit/scripts/merge-findings.mjs:42-46`, `:58-61`, `:98`, `:178`.
- **Reprodução:** gerar FINDINGS com um HIGH válido a partir de `agent-artemis.json`; truncar o arquivo de agente para `{` (simula escrita interrompida); executar merge novamente.
- **Resultado observado:** aviso “ignorando ... JSON inválido”, **exit 0**, FINDINGS substituído por `[]`; `lint-findings --gate` retorna **0**. Fixture `corrupt-agent`.
- **Impacto:** erro de produtor vira “zero achados”; a última versão válida da fonte de verdade é destruída. O mesmo caminho não distingue agente ausente de agente que concluiu sem achados.
- **Recomendação:** validar todos os inputs antes de substituir FINDINGS, falhar sem sobrescrever estado válido e persistir conclusão/falha de cada produtor. Escrita atômica dos artefatos.

### DA-05 — Reapuração inválida deixa aprovação antiga utilizável

- **Severidade:** alta (fechamento apesar de painel atual incompleto).
- **Local:** `deep-audit/scripts/review-verify.mjs:151-157`; `deep-audit/scripts/sync-progress.mjs:119-125`, `:138-168`; `deep-audit/scripts/lint-findings.mjs:158-186`.
- **Reprodução:** gerar review aprovado com três votos; remover o voto QUALITY e reapurar. `review-verify` sai **2**, mas mantém `reviews/BUG-ART-001.json` antigo como `approved`. Reabrir o achado e executar `sync-progress --done ... --test Suite#case`.
- **Resultado observado:** `--done` retorna **0** e gate **0** usando o veredito antigo. Fixture `stale-review`.
- **Impacto:** falha não invalida o artefato previamente publicado; o consumidor não revalida os votos e o lint examina somente a cópia resumida dentro do achado. Não há identidade de rodada/diff nos votos ou na aprovação.
- **Recomendação:** invalidar/publicar estado incompleto no início ou na falha da reapuração; associar votos e aprovação ao mesmo diff/revisão e exigir correspondência no `--done` e no gate.

### DA-06 — Pack é reutilizado entre branches no mesmo dia sem invalidar evidências

- **Severidade:** alta (relatório atribui evidência antiga ao alvo novo).
- **Local:** `deep-audit/scripts/init-run.mjs:148-153`, `:160-189`.
- **Reprodução:** no mesmo repo, iniciar `--full` em `feature/one` e gravar arquivo de agente; trocar para `feature/two`, alterar/commitar produto e iniciar `--full` novamente.
- **Resultado observado:** mesmo OUT (`<data>-full`), `run-meta.branch` passa a `feature/two`, enquanto `agent-artemis.json` da primeira branch permanece. A consolidação lê todos esses arquivos indistintamente.
- **Impacto:** histórico contém somente eventos init, sem preservar identidade completa por rodada nem impedir mistura de votos, findings e desfechos. Repetir setup para corrigir `--version`, instrução legítima da skill, também não distingue atualização de metadados de uma nova rodada.
- **Recomendação:** run_id e diretório únicos por execução; retomada explícita que valide alvo/base/HEAD; aprovação e evidência vinculadas à revisão auditada.

### DA-07 — Gate de uma auditoria full passa sem nenhuma lente ou painel executado

- **Severidade:** alta (falso fechamento por ausência de evidência).
- **Local:** `deep-audit/scripts/lint-findings.mjs:79-81`, `:120-197`.
- **Reprodução:** pack com `run-meta` válido (`mode=full`, `depth=deep`), `FINDINGS.json=[]` e um `deps-latest.json` vazio/estruturalmente insuficiente; sem `agent-*.json`, inventário, votos, coverage, testes ou relatórios. Executar `--gate`.
- **Resultado observado:** **exit 0**, “gate de fechamento passou”. Fixture `never-ran-detectors`.
- **Causa:** painel só é verificado se há finding que alega painel; pesquisa de dependências só precisa existir, não ser válida/concluída. Não há cobertura de execução esperada por `mode`/`only`/`scope`.
- **Recomendação:** manifesto de execução por lente com COMPLETE/FAILED/OPEN/N/A, inclusive resultado vazio válido; validar artefatos obrigatórios e painel deep mesmo com zero sobreviventes. Diferenciar “nenhum problema detectado” de “não investigado”.

## Achados confirmados — prioridade média

### DA-08 — Atualizações simultâneas de progresso se sobrescrevem

- **Severidade:** média (perda de acompanhamento; pode perder desfechos conforme a mutação).
- **Local:** `deep-audit/scripts/sync-progress.mjs:81-84`, `:292`.
- **Reprodução:** dois subprocessos `sync-progress --progress` para IDs diferentes do mesmo pack; barreira de teste imediatamente antes da primeira escrita de FINDINGS garante que ambos leram o estado original. Liberar ambos.
- **Resultado observado:** os dois saem **0**, mas só um ID conserva `in_progress`/`progress`; o outro volta ao estado original. Fixture `concurrent-progress`; hook de barreira exclusivamente em `/tmp/.../barrier.mjs`.
- **Recomendação:** escritor único explícito no orquestrador mais lock e atualização versionada/atômica no script. Atomic rename sozinho evita truncamento, mas não evita lost update.

### DA-09 — Re-merge perde revisão e progresso operacional de itens resolvidos

- **Severidade:** média (fluxo de Escriba quebra após correção legítima).
- **Local:** `deep-audit/scripts/merge-findings.mjs:109-121`, `:127-129`; pipeline obrigatório em `deep-audit/agents/escriba-relatorio.md:17-22`.
- **Reprodução:** fechar achado com `sync-progress --done` e revisão existente; manter o arquivo de agente original (status open), como esperado; reexecutar merge.
- **Resultado observado:** status permanece `resolved` e `resolved_test` permanece, mas `review` some. Gate falha “resolvido sem revisão de código”. A mesma whitelist não inclui `in_progress`; notas de progresso podem sobreviver sem a marca `[~]`.
- **Recomendação:** separar dados de detecção e estado do workflow, preservando vínculo à revisão/dispensa válida e progresso; invalidar deliberadamente quando o conteúdo/identidade mudar, em vez de perder campos por whitelist incompleta.

### DA-10 — Revisão aprova com prova de reversão explicitamente falsa

- **Severidade:** média (regra test-first não é imposta pela apuração anunciada).
- **Local:** `deep-audit/scripts/review-verify.mjs:57`, `:101-105`, `:121`; `deep-audit/scripts/lint-findings.mjs:158-186`.
- **Reprodução:** três votos APROVA com reasoning, todos `test_reversal_checked:false`; executar review-verify, `sync-progress --done --test Suite#case`, depois lint gate.
- **Resultado observado:** todos retornam **0**, approval registra `test_reversal_checked:false` e ainda assim o HIGH fecha.
- **Recomendação:** CORRECTNESS precisa comprovar execução/reversão conforme o contrato; não usar `some()` entre lentes para atribuir essa responsabilidade. Guardar comandos, resultado esperado/observado e revisão de código correspondentes. Nome de teste sozinho não comprova execução.

### DA-11 — Base de diff inválida vira delta vazio bem-sucedido

- **Severidade:** média (escopo auditado incompleto sem sinalização).
- **Local:** `deep-audit/scripts/init-run.mjs:39-47`, `:155-158`.
- **Reprodução:** repo com commits alterados; `init-run --base origin/nonexistent --out <tmp>/invalid-base`.
- **Resultado observado:** **exit 0**, `changed_files=[]`, `changed_file_count=0`, base inválida registrada como válida. Erro do Git é convertido em string vazia.
- **Recomendação:** validar ref/base e merge-base antes de coletar diff; falhar explicitamente em erro Git e definir fallback explícito para repo sem Git ou sem base disponível.

### DA-12 — Segurança deep não aceita resultado legítimo sem candidatos

- **Severidade:** média (bloqueia conclusão de uma varredura limpa).
- **Local:** `deep-audit/scripts/sec-verify.mjs:177-198`.
- **Reprodução:** `candidates.json={"candidates":[]}`, diretório de votos vazio, comando canônico com `--require-vote-files`.
- **Resultado observado:** **exit 2**, mensagem “missing 0 file(s)”, `verification_status=unverified`. Fixture `zero-candidates`.
- **Recomendação:** zero candidatos pode ser um resultado válido quando inventário/caçadores concluíram; exigir cobertura desses produtores, e votos somente para os candidatos existentes. Não forçar fabricação de candidato para satisfazer a checagem.

## Oportunidades de instrução e relatório

1. **Reversão conflita com read-only e com revisores em paralelo.** `agents/nemesis-revisao-correcao.md:13-14` proíbe editar; `:24-25` manda reverter produto, sem descrever checkout isolado nem reaplicação garantida. Definir reversão em worktree temporária, cleanup em sucesso/erro e diff imutável para os demais revisores. É conflito textual confirmado; não executei agentes para simular perda de patch.
2. **Dono da revisão e ferramentas discordam.** Ferreiro tem `tools` sem Task (`agents/ferreiro-correcao.md:4`), mas `:33-34` manda despachar três Tasks. Maestro coloca `--done` no passo 8 e revisão depois do relatório no passo 9.5 (`agents/maestro-deep-audit.md:51-53`). Centralizar dispatch no Maestro e ordenar fix → painel → desfecho → relatório.
3. **Cético confunde ausência de reprodução com refutação.** `agents/cetico-verificador.md:23` diz “Não reproduz ⇒ falso-positivo”, contrariando seu próprio estado PLAUSÍVEL (`:32`). Falta de toolchain, ambiente ou determinismo não prova ausência do defeito. Preservar como PLAUSÍVEL/OPEN com lacuna explícita.
4. **Fallback N+1 incompleto.** `agents/enxame-nplus1.md:11` exige `nplus1-check` e proíbe reimplementar; essa skill não está nesta árvore do harness nem na lista desta sessão. Definir indisponibilidade como OPEN visível, ou incluir procedimento equivalente mantido. Não afirmar “zero N+1” quando o runner não existe. Não procurei instalações externas não declaradas.
5. **Setup e portabilidade.** SKILL usa `~/.claude/skills/deep-audit` e mostra `--full` diretamente no primeiro comando, embora default anunciado seja delta. Resolver SKILL_ROOT a partir do arquivo carregado e encaminhar flags reais. Esta sessão tem caminhos do harness disponíveis; não alego falha local de symlink.
6. **Banner de acompanhamento acumula cópias.** `scripts/sync-progress.mjs:557-559` só substitui se REPORT começa pelo banner, mas o fluxo normal começa pelo título. Duas execuções sobre `# Report\n\n...` produziram dois banners (`report-banner`). Trocar bloco delimitado de forma idempotente.
7. **Histórico de review é sobrescrito.** `review-verify.mjs:123` substitui `<ID>.json`, e `:172-184` grava summary somente dos IDs da execução atual. O Escriba pede quantos passaram “de primeira” e quantos exigiram novas rodadas, mas os scripts não preservam esse histórico. Preferir rounds imutáveis com resumo derivado. Constatação estática; não tratada como prova de perda de dados de produto.

## Verificação executada e limites

- `node --check` nos **10 scripts .mjs** de deep-audit: **10/10 passaram**.
- Não existe suíte de testes própria sob `deep-audit/`; não alterei nem acrescentei testes permanentes.
- Executei CLIs reais `init-run`, `merge-findings`, `sec-verify`, `review-verify`, `sync-progress`, `lint-findings` e `build-report` em fixtures.
- Executei `detect-stack` e `check-deps-latest` em package.json sem dependências: ambos exit 0, inventário JavaScript/npm, zero consultas externas/zero deps.
- JSON de fontes, votos, resultados, relatório HTML e TASKS foram efetivamente produzidos; o JavaScript embutido no HTML foi compilado com `vm.Script` sem erro de sintaxe.
- Prova de concorrência: dois processos reais, leitura sincronizada antes da escrita por hook temporário; ambos exit 0 e uma atualização ausente.
- Prova de shell: apenas builtin `printf` em campo fictício; nenhuma execução ofensiva, rede ou acesso a segredo.
- **Não validei:** browser interativo/renderização visual, registries/CVEs/latest reais, todos os parsers de manifests, raciocínio dos modelos, permissões exatas de outros hosts, CI/push de produto. Não inferir cobertura dessas áreas a partir deste relatório.
- As fontes do harness e os testes existentes foram preservados; apenas este relatório e fixtures temporárias foram criados nesta tarefa.

## Critérios objetivos para validar correções futuras

| Achado | Critério mínimo de aceitação |
|---|---|
| DA-01 | Campos contendo `$()`/crases/aspas fazem round-trip literal; nenhum comando embutido é executado. |
| DA-02 | Voto inválido faz tally e gate falharem, preservando candidato pendente; não produz `verified`. |
| DA-03 | Candidato novo mantém estado aberto independentemente da posição/ID ordinal; caso CRITICAL reproduzido bloqueia o gate; IDs permanecem únicos. |
| DA-04 | JSON inválido faz merge falhar e deixa FINDINGS anterior byte a byte intacto. |
| DA-05 | Após remover/corromper um voto, `--done` e gate falham mesmo havendo aprovação de rodada anterior. |
| DA-06 | Nova branch/revisão não reaproveita implicitamente artefatos; retomada explícita só aceita identidade compatível. |
| DA-07 | Pack full sem execução das lentes/painel falha; pack com execuções concluídas e resultados vazios válidos pode passar. |
| DA-08 | Duas atualizações concorrentes preservam ambas, ou uma é recusada explicitamente para retry sem perda silenciosa. |
| DA-09 | Reconsolidar input inalterado preserva revisão/dispensa e marca de progresso válidas; gate não regride. |
| DA-10 | CORRECTNESS sem reversão executada não aprova/fecha; somente prova atual associada ao diff libera o desfecho. |
| DA-11 | Base inexistente/inválida produz falha, sem registrar delta vazio como execução válida. |
| DA-12 | Zero candidatos com inventário/caçadores concluídos é aceito; zero candidatos por ausência desses produtores continua bloqueado. |

## Cópia durável da evidência

Os resultados desta sessão foram preservados em [evidências da auditoria](other-skills-2026-10-22-evidence/README.md). Os caminhos `/tmp` acima identificam os fixtures e scripts originais; esses diretórios são temporários. Todos os achados permanecem ABERTOS; nenhuma fonte desta skill foi corrigida nesta etapa.

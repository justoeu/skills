# Ultra — revisão forward independente / schema 2

Somente leitura do harness. SKILL.md e references/pack-schema.md usados como contrato;
fixture própria com Git e Node em diretório temporário. Sem rede, instalação, serviço
externo ou edição de fontes Ultra. Script: /tmp/ultra-forward-independent.mjs.
Resultados preservados: /var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/ultra-independent-forward-AVU8Eo/results.json.

## Positivos executados

- Init delta em repo Git real, roster Atlas, saída limpa explicitamente bindada, merge,
  sync e status: audit_complete=true; HTML/TASKS produzidos.
- Retomada por OUT, novo merge/sync sem mutação: audit_complete=true.
- Run intent=fix com defeito HIGH em src/value.cjs e teste check.cjs: done prematuro
  recusado; record executou RED real; produto corrigido, snapshot atualizado,
  análise/bind/merge refeitos; record GREEN; review/docs attestadas na fixture,
  done e remerge: implementation_complete=true, mantendo resolução.
- Segunda run recebe OUT/run_id distintos.
- Segurança full com candidato, inventory/hunter e três votos válidos: audit_complete=true.
  Apagar IMPACT sem reapurar: audit_complete=false por security input missing.
  Esta checagem pegou a correção recente de proveniência do autor.

## Achados enviados ao autor (revalidação pendente)

### UF-01 — alto: artefato de dependências estruturalmente inválido passa o gate

pack-contract.mjs:351–358 (verificação de deps em auditState).
Repro: init roster agent-prism.json,agent-prism-freshness.json; ambos arrays vazios
bindados; deps-latest.json = {"summary":{"errors":0}} bindado; merge; status.
Resultado: audit_complete=true e implementation_complete=true sem packages, checked,
up_to_date, outdated ou runner_errors. Distinguir zero consultado válido de artefato
incompleto exige schema e contagens válidas; teste negativo deste JSON + positivo de
scanner real sem dependências.

### UF-02 — médio: base inexistente aceita como delta auditado

pack-state.mjs:94 (base armazenada sem validação; init:27–101).
Repro init --base refs/remotes/nonexistent/missing, roster Atlas, agent [] bindado,
merge/status. Resultado: audit_complete=true. Não valida ref/merge-base nem demonstra
escopo delta. Rejeitar base explícita inválida antes de criar run; registrar fallback
explícito quando não há Git/base; preservar caminho positivo com main válido.

### UF-03 — médio: binds concorrentes perdem atualização, ambos exit 0

pack-contract.mjs:130–138 e saveMeta:116–118; pack-state.mjs:120 (bind).
Repro com dois processos reais bind --file a.json/b.json no mesmo pack. Hook temporário
faz barreira imediatamente antes de rename run-meta (nenhum script de produção alterado),
libera ambos depois das leituras. Ambos exit0, artifacts final contém só a.json.
Atomic rename evita truncamento, mas não serializa read-modify-write. Exigir lock ou
CAS por pack para bind/snapshot/record/attest/merge/sync; retry explícito deve preservar
os dois registros. Escrituras diretas de metadata em sync também entram no mesmo contrato.

## Limites

Nenhum modelo independente de auditoria foi simulado como executado; votos/attestations
são fixtures de contrato. Sem registry/CVE real, UI visual, teste de todas as stacks ou
instalação de dependência. Os três achados acima foram enviados ao autor; este relatório
não declara que ainda existem depois das correções em andamento. Uma nova rodada de
revalidação atualizará o resultado abaixo.

## Revalidação independente após correções — todos os três achados fechados

Executei novamente o fluxo inteiro, com fixture Git nova e script separado
`/tmp/ultra-forward-revalidation.mjs`. Resultado em
/var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/ultra-independent-forward-UBsMi5/results.json.

- UF-01: o mesmo deps JSON incompleto agora produz audit_complete=false. Em seguida,
  check-deps-latest real na fixture sem dependências produziu zero válido, bind/merge
  e audit_complete=true. Sem rede consultada.
- UF-02: init com a mesma base inexistente retorna 1, mensagem invalid/unrelated Git base,
  e não cria diretório de pack. Caminho positivo main/delta continuou passando.
- UF-03: pausei A antes de rename, B foi recusado explicitamente com pack lock busy;
  liberei A (exit0), repeti B (exit0) e artifacts contém a.json e b.json. Sem perda silenciosa.
- Positivos repetidos: auditoria limpa, retomada/remerge/sync, fix com RED/GREEN reais,
  attest review/docs, done/implementation_complete, segunda run única. Remover voto sem
  reapurar ainda bloqueia segurança, como esperado.

Nenhum achado aberto desse forward. Os limites de registries, browser, agentes reais e
outras stacks continuam explícitos; sucesso hermético não é prova dessas integrações.

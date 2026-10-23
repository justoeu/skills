# Revisão da skill make-me-happy

Data: 2026-10-22. Versão declarada: 1.3.1.

## Parecer

A proposta tem fundamentos úteis: rastreabilidade entre spec e tarefas, evidência de testes, isolamento das slices, review separado por responsabilidade e registro explícito de lacunas. Entretanto, a implementação ainda não sustenta várias garantias do texto. Há perda de alterações locais no merge, retomadas incorretas e aprovações indevidas. Os arquivos de acompanhamento podem divergir entre si e do código entregue.

Não recomendo tratar `score=10`, `PASS` ou `closed` como comprovação suficiente de conclusão antes de corrigir os problemas abaixo.

Esta revisão não alterou a skill nem executou seu fluxo em projetos reais. O único arquivo adicionado ao repositório é este relatório.

## Escopo e evidência

- Leitura do entrypoint, prompts dos agentes, schemas, scripts de estado/score/relatório e verificações de hooks/UI.
- `node --test make-me-happy/scripts/tests/*.test.mjs`: **51 testes, 51 passaram**.
- Reproduções adicionais em diretórios e repositórios Git temporários, incluindo falhas intermediárias e estados inconsistentes.
- Driver de UI validado por execução do código gerado com Playwright simulado; não foi conduzido um aplicativo real em browser nesta revisão.
- Validador da `skill-creator`: o Python inicial não tinha PyYAML; executado com a dependência isolada via `uv`, rejeitou o campo `compatibility`. Isso é divergência do validador instalado: o campo é permitido pela [especificação oficial Agent Skills](https://agentskills.io/specification#compatibility-field). Não é evidência de formato inválido da skill.

P1 = corrigir antes de confiar no fluxo autônomo. P2 = corrigir para o fluxo cumprir o contrato em cenários suportados. Diferencio reproduções, deduções do código e lacunas de especificação.

## Achados técnicos

### F01 — P1: merge testa uma versão, integra outra e pode apagar trabalho

**Reproduzido.** [worktrees.mjs:181](../../make-me-happy/scripts/worktrees.mjs#L181) testa a árvore de trabalho, a linha 196 mergeia apenas commits e a 197 remove a worktree com `--force`.

Na reprodução, o arquivo commitado continha `1`, a alteração local continha `2` e o teste exigia `2`. O merge retornou zero, o destino recebeu `1`, o teste falhou no destino e um arquivo não versionado desapareceu junto com a slice.

**Correção:** recusar alterações pendentes antes do teste/merge, registrar o SHA testado, validar o resultado integrado e remover a worktree sem força no caminho normal. Cleanup não deve destruir conteúdo necessário para recuperação.

### F02 — P1: a retomada não encontra packs de branches com `/`

**Reproduzido.** [SKILL.md:167](../../make-me-happy/SKILL.md#L167) usa a branch diretamente no caminho. `feature/demo` produz `.../2026-10-21-feature/demo`. [resume.mjs:66](../../make-me-happy/scripts/resume.mjs#L66) procura arquivos somente no primeiro nível.

Sem worktree ativa, retorna `resumable:false`; com worktree, retorna `pack:null`, embora o pack exista. A recuperação pode então perder a associação com plano, spec e configuração anteriores.

**Correção:** usar identificador de run único e nome de branch normalizado; reconhecer também packs antigos aninhados.

### F03 — P1: resume considera concluída uma run com hooks FAIL e UI pendente

**Reproduzido.** [resume.mjs:50](../../make-me-happy/scripts/resume.mjs#L50) vai de imutabilidade/reviews ao score e depois `closed`. Não examina hooks, aceitação de UI ou gates do projeto.

Com tasks DONE, reviews APPROVE, cobertura 99%, finding de segurança `high/open`, hooks FAIL e UI sem aceitação, retornou `closed` e `resumable:false`, mesmo com meta `in_progress`. A etapa `ui-acceptance` documentada no dispatch nunca é retornada. `project-gates` também não tem transição de retomada.

**Correção:** compartilhar uma única máquina de estados entre retomada, fechamento e relatório. Manter separadas a conclusão do pack e a conclusão do projeto, permitindo retomar os gates posteriores.

### F04 — P1: pausar por task remove a worktree das tasks restantes

**Reproduzido.** [SKILL.md:245](../../make-me-happy/SKILL.md#L245) manda mergear o trabalho verde ao pausar. O merge apaga a slice e sua branch. [resume.mjs:48](../../make-me-happy/scripts/resume.mjs#L48) vê tasks OPEN e slices no JSON e retorna `implement`, sem recriar a worktree.

Com T1 DONE e T2 OPEN na mesma slice, a retomada apontou para um diretório removido; merge subsequente falhou com `slice 1 worktree missing`.

**Correção:** preservar slices com tarefas pendentes ou recriá-las explicitamente a partir do novo estado de `into`. O modo por task também precisa de uma política de dispatch que impeça outras tasks de avançarem enquanto a confirmação está pendente.

### F05 — P1: os hooks podem dar PASS com finding crítico aberto ou JSON vazio

**Reproduzido.** [hooks.mjs:500](../../make-me-happy/scripts/hooks.mjs#L500) só bloqueia findings high/critical quando o campo textual `verdict` já é `REJECT`.

Um hook com `APPROVE` e finding `critical/open` passou. Sete documentos `{}` também produziram PASS. Isso contraria a regra de bloqueio por achado aberto sem waiver.

**Correção:** validar os documentos e derivar o bloqueio dos findings; estados incoerentes ou incompletos devem impedir aprovação. Preservar a política explícita para OPEN/SKIP válidos.

### F06 — P1: um waiver pode passar a autorizar outra dependência

**Reproduzido.** [hooks.mjs:439](../../make-me-happy/scripts/hooks.mjs#L439) gera IDs `D-1`, `D-2` pela posição dos achados. [hooks.mjs:473](../../make-me-happy/scripts/hooks.mjs#L473) aplica waiver apenas por hook e ID.

Alpha era D-1 e beta D-2. Após autorizar somente alpha e depois corrigi-la, beta virou D-1 e herdou a autorização. O resultado mudou de FAIL para PASS sem decisão do usuário sobre beta.

**Correção:** identidade estável por ecossistema, manifest, dependência e condição aceita; preservar achados/rodadas anteriores e vincular o waiver ao objeto autorizado.

### F07 — P1: o piso de cobertura solicitado pode ser reduzido

**Reproduzido.** [score.mjs:78](../../make-me-happy/scripts/score.mjs#L78) usa precedência (`cli || coverage.floor || meta.coverage_floor`) em vez do maior piso aplicável.

Com `run-meta.coverage_floor=95`, `coverage.floor=90` e cobertura 91%, retornou piso efetivo 90 e `closable:true`. O exemplo de `coverage.json` da própria skill inclui `floor:90`, facilitando esse estado.

**Correção:** calcular o máximo entre o mínimo da skill e todos os pisos solicitados; validar percentuais e definir a métrica/escopo da medição.

### F08 — P1: fechamento e HTML podem usar evidência antiga ou incompatível

**Reproduzido.** [load-pack.mjs:74](../../make-me-happy/scripts/report/load-pack.mjs#L74) prefere `score.json` existente e só recalcula quando ele falta. Depois de mudar uma task DONE para OPEN, o relatório mostrou a task aberta junto de score 10 e `closable:true`; o score calculado novamente era 8.

Além disso, [render.mjs:683](../../make-me-happy/scripts/report/render.mjs#L683) exibe “pack pode fechar” usando apenas score/cobertura, inclusive com `hooks/verdict.json=FAIL`. `scorePack` também aceitou `tests.json` com `ok:false, failed:1`; esse arquivo não participa do cálculo. O teste demonstra que as saídas precisam ser conciliadas, não que todo trabalho normal necessariamente será aprovado incorretamente pelo revisor humano/agente.

A etapa 8 pode corrigir código depois de score/reviews/cobertura, mas só exige explicitamente reconstruir o HTML. Não há protocolo que invalide todas as evidências afetadas nem vinculação delas ao SHA atual.

**Correção:** um verificador de fechamento comum, com evidências vinculadas à revisão do código; qualquer correção deve invalidar os resultados afetados. Gerar o relatório a partir do estado validado atual, com indicação explícita de evidência desatualizada.

### F09 — P2: interrupções deixam worktrees e JSON em estados incompatíveis

**Duas reproduções.** [worktrees.mjs:147](../../make-me-happy/scripts/worktrees.mjs#L147) persiste o estado só após criar todas as slices. Com branch `mmh/slice-2` preexistente, cria slice 1 e falha na 2 sem `worktrees.json`; resume aponta `implement`, mas o merge falha por não conhecer o alvo.

No merge, [worktrees.mjs:196](../../make-me-happy/scripts/worktrees.mjs#L196) só marca `merged:true` depois de remover worktree/branch. Uma falha injetada em `branch -d` deixou o commit integrado e o diretório removido, mas JSON `merged:false`. Repetir a operação falha porque a worktree não existe.

**Correção:** persistir fases incrementais e reconciliar arquivos com Git. As operações devem ser idempotentes e recuperáveis após qualquer etapa.

### F10 — P2: escrita concorrente do acompanhamento não tem protocolo definido

**Lacuna de especificação.** [SKILL.md:239](../../make-me-happy/SKILL.md#L239) despacha implementers em paralelo. [implementer.md:56](../../make-me-happy/agents/implementer.md#L56) manda cada um alterar `TASKS.json` e gravar `coverage.json`. A alternativa de o Oracle receber patches é opcional; não há lock, merge por ID nem escritor único obrigatório. `$OUT` é relativo, embora o agente seja deslocado para outra worktree.

Dois escritores podem sobrescrever atualizações; uma medição de cobertura de slice pode substituir a de outra. O pós-merge exige `tests.json`, mas não exige claramente recomputar a cobertura consolidada. `TASKS.md` tem regra textual de regeneração por alteração, porém o helper disponível o regenera apenas ao rodar `score.mjs`.

**Correção:** OUT absoluto, resultados por task/slice, Oracle como escritor único dos agregados, gravação atômica e regeneração do Markdown no mesmo evento. Medir cobertura sobre o código integrado final.

### F11 — P2: dependências entre slices não são sincronizadas

**Reproduzido.** [planner.md:60](../../make-me-happy/agents/planner.md#L60) permite `depends_on`; [implementer.md:55](../../make-me-happy/agents/implementer.md#L55) manda seguir a ordem. Todas as worktrees são criadas do mesmo HEAD e o dispatch é paralelo.

Após T1 criar um módulo e ser mergeada, a slice 2 de T2 dependente continuava sem esse módulo. Seguir a ordem das tasks não atualiza o checkout.

**Correção:** agrupar dependências na mesma slice ou despachar em ondas, sincronizando a base das dependentes e revalidando seus testes.

### F12 — P2: um spec draft com tasks existentes pode avançar à implementação

**Reproduzido.** [resume.mjs:46](../../make-me-happy/scripts/resume.mjs#L46) só retorna `explore` para spec não pronto quando não há tasks. Com `spec_status:draft` e uma task OPEN, retorna `worktrees-add`.

**Correção:** validar spec/confirmação antes de considerar as tasks. O estado do planner não pode substituir a confirmação exigida em [SKILL.md:204](../../make-me-happy/SKILL.md#L204).

### F13 — P2: fornecer spec pula a criação do arch-map exigido pelo planner

**Dedução direta do fluxo.** [SKILL.md:175](../../make-me-happy/SKILL.md#L175) pula §0z quando há spec. A geração do arch-map está em §0z, mas [SKILL.md:212](../../make-me-happy/SKILL.md#L212) e o planner exigem esse arquivo independentemente da origem do spec.

**Correção:** produzir/verificar o mapa no setup comum, inclusive para `--spec`; somente a elicitação do spec deve ser condicional.

### F14 — P2: dependências de manifests aninhados são ignoradas

**Reproduzido.** [hooks.mjs:288](../../make-me-happy/scripts/hooks.mjs#L288) reconhece que houve alteração em um manifest aninhado, mas lê `git show <ref>:package.json`, usando o caminho da raiz.

Uma dependência nova em `apps/web/package.json` resultou em `added:[]` e APPROVE com “Nenhuma dep nova”.

**Correção:** iterar pelos caminhos reais do diff, conservar o manifest na identidade da dependência e testar monorepos.

### F15 — P2: a jornada de UI pode ser APPROVE apesar de crash e HTTP 500

**Reproduzido com Playwright simulado.** [ui-acceptance.mjs:215](../../make-me-happy/scripts/ui-acceptance.mjs#L215) coleta erros; [linha 257](../../make-me-happy/scripts/ui-acceptance.mjs#L257) calcula o verdict apenas pelas ações/asserts. Dois erros de console/pageerror e uma resposta 500 produziram APPROVE e exit zero.

Isso afeta o resultado da jornada. O hook final ainda é escrito pelo agente e pode rejeitar ao examinar os arrays, conforme seu prompt. Portanto não equivale a dizer que o hook final sempre passa nesses casos.

**Correção:** resultado do driver coerente com erros não esperados, ou estado explícito pendente de classificação. Respostas 4xx esperadas em jornadas negativas devem ser declaradas como expectativas, evitando rejeitar testes corretos de validação/autorização.

### F16 — P2: o escopo de UI pode concluir SKIP por falta de dados

**Reproduzido.** [ui-acceptance.mjs:74](../../make-me-happy/scripts/ui-acceptance.mjs#L74) depende de diff-facts ou `--base`. O comando da fase §4z torna a base opcional; diff-facts só é gerado na fase §5 seguinte.

Com `Checkout.tsx` novo e sem contrato UI explícito, o scope retornou `ui_touched:false` sem `--base`; com base, retornou true. A ausência de payload reduz a independência da verificação justamente quando o planner deixa algo escapar.

**Correção:** produzir diff-facts antes do escopo ou carregar uma base válida do meta. Não interpretar falta de evidência como ausência de UI.

### F17 — P2: boot pode validar um servidor diferente do iniciado

**Reproduzido em localhost.** [ui-acceptance.mjs:53](../../make-me-happy/scripts/ui-acceptance.mjs#L53) aceita respostas abaixo de 500; o boot não confirma se o processo iniciado continua vivo nem quem ocupa a porta.

Com `cmd: 'exit 1'` e outro servidor temporário na porta respondendo 404, o boot retornou `ok:true` e `health.ok:true`.

**Correção:** verificar disponibilidade da porta, saída do processo e identidade/healthcheck esperado do app iniciado. Um serviço preexistente só deve ser reutilizado por decisão explícita do fluxo.

### F18 — P2: falha de um novo drive pode devolver a jornada antiga aprovada

**Reproduzido.** [ui-acceptance.mjs:331](../../make-me-happy/scripts/ui-acceptance.mjs#L331) lê o JSON no caminho esperado mesmo se a nova execução falhou antes de escrevê-lo. Retorna o documento APPROVE anterior, embora o exit atual seja não zero.

**Correção:** separar arquivos por execução/rodada, validar a identidade da execução e impedir que evidência antiga seja apresentada como resultado novo.

### F19 — P2: teardown apaga a evidência de boot que o relatório usa

**Confirmado no fluxo.** [ui-acceptance.mjs:176](../../make-me-happy/scripts/ui-acceptance.mjs#L176) apaga `boot.json`. O teardown é obrigatório antes da geração do relatório, e [load-pack.mjs:628](../../make-me-happy/scripts/report/load-pack.mjs#L628) lê exatamente esse arquivo.

**Correção:** preservar o registro de boot, acrescentando `stopped_at`/estado, e separar o controle do processo da evidência histórica.

### F20 — P2: `--fresh` não tem identidade de run nem política para o pack anterior

**Dedução; não foi executada uma segunda run completa.** [SKILL.md:165](../../make-me-happy/SKILL.md#L165) determina OUT apenas por dia/branch. Duas runs no mesmo dia/branch usam o mesmo diretório. `--fresh` descreve remover slices, mas não arquivar o pack anterior ou impedir reutilização de reviews, waivers e scores antigos.

**Correção:** run_id único, vínculo das slices ao run_id e arquivamento explícito do estado anterior. Distinguir iniciar outra run de descartar trabalho não integrado.

## Orientações de desenvolvimento que precisam ser ajustadas

### Refactor e red→green são descritos de forma contraditória

[SKILL.md:111](../../make-me-happy/SKILL.md#L111) proíbe DONE sem teste inicialmente vermelho. [implementer.md:47](../../make-me-happy/agents/implementer.md#L47) manda registrar como RED um teste de caracterização que já era verde. O correctness reviewer exige RED real. A caracterização verde é adequada para preservar comportamento num refactor; o problema é rotulá-la como falha observada e aplicar o mesmo gate.

Separar protocolos: bugfix/feature com evidência de falha relevante e refactor com caracterização antes/depois. Mudanças de documentação/configuração também precisam de verificação adequada ao resultado, sem criar testes artificiais só para alimentar a contagem.

### “Só o SDD” mistura escopo de produto com escolhas locais de implementação

[SKILL.md:95](../../make-me-happy/SKILL.md#L95) e [planner.md:76](../../make-me-happy/agents/planner.md#L76) exigem pergunta quando existe mais de um caminho, inclusive nomes e escolhas internas. Isso pode interromper repetidamente tarefas cujo objetivo e padrões locais já estão claros.

Reservar perguntas para decisões que alteram comportamento, contrato, arquitetura, persistência ou custo relevante. Resolver escolhas locais reversíveis pelos padrões do repo. Respeitar o SDD não exige que ele enumere cada decisão de código.

### Regras de overengineering viraram ordens universais

[overengineering.md:24](../../make-me-happy/catalogs/overengineering.md#L24) manda remover interface com uma implementação e exige segundo consumidor; a linha 41 manda trocar configuração por hardcode em condições amplas. Contagem isolada não estabelece se a abstração tem responsabilidade útil, desacopla um limite ou permite testes adequados.

Transformar esses itens em sinais para investigação, com justificativa de impacto. A orientação oficial de Go descreve interfaces como contratos de comportamento, sem essa regra universal de contagem: [Effective Go](https://go.dev/doc/effective_go#interfaces_and_types).

### “Última versão ativa” não substitui compatibilidade

[hooks.mjs:439](../../make-me-happy/scripts/hooks.mjs#L439) classifica uma dependência nova atrás da última major/minor como high por princípio. A política precisa considerar runtime suportado, dependências pares, compatibilidade com a aplicação e versões mantidas. Exigir automaticamente a versão cronologicamente mais nova pode contrariar esses requisitos.

O escopo padrão `new` também não verifica as dependências preexistentes que a documentação promete apresentar como follow-up; isso só acontece quando incluídas no escopo da execução.

### A bateria pós-implementação é ampla demais como regra universal

[SKILL.md:385](../../make-me-happy/SKILL.md#L385) exige projeto temporário para análise diferencial, independentemente das capacidades do analisador. [SKILL.md:392](../../make-me-happy/SKILL.md#L392) exige Atlas e várias auditorias em toda aplicação. “Rodar até secar” não define parada quando o mesmo problema não converge ou falta infraestrutura.

Aplicar ferramentas segundo a superfície alterada e o workflow real do repo. Definir critérios de convergência e registrar bloqueio quando houver impedimento concreto. Correções dessa bateria devem reabrir os gates anteriores que perderam validade.

### Recusa de spec e confirmação inicial têm caminhos incompatíveis

O fluxo proíbe implementar sem spec e o planner recusa criar tasks sem ele. Ao mesmo tempo, [spec-reviewer.md:23](../../make-me-happy/agents/spec-reviewer.md#L23) admite SKIP quando o usuário recusou a Etapa Zero. Falta definir se essa recusa encerra o fluxo ou habilita um modo alternativo.

O setup pede confirmação de continuar antes de apresentar o plano, e `loop=task` manda parar no planner mesmo que o usuário já tenha pedido para seguir. A confirmação deve corresponder a uma decisão concreta, respeitando a autorização já dada pelo usuário.

## Avaliação dos arquivos de acompanhamento

| Arquivo/conjunto | O que existe de útil | O que falta |
|---|---|---|
| `TASKS.json` / `TASKS.md` | IDs, estados, referências e campos de evidência | Escritor único, atualização atômica, espelho sincronizado e coordenação das dependências |
| `run-meta.json` | Helper de timestamps e enum de etapas | Run_id, transições coerentes com resume/fechamento e persistência consistente de base/HEAD |
| `worktrees.json` | Mapeamento de slices e branch de destino | Persistência incremental e reconciliação com Git após falha/pausa |
| `tests.json` / `coverage.json` | Schema de resultados e cobertura por módulo | Medição consolidada obrigatória, validade por revisão e integração no fechamento |
| `reviews/` / `hooks/` | Findings estruturados e intenção de preservar rodadas | Validação de schema, IDs estáveis e invalidação após mudanças |
| `ui/` | Evidência produzida por código | Identidade da execução e preservação do histórico após teardown/falhas |
| `score.json` / `report.html` | Geração determinística e visualização abrangente | Fonte única de decisão e rejeição de dados antigos/incompatíveis |
| `project-gates.json` | Distinção explícita entre pack e projeto | Retomada própria e revalidação quando a etapa corrige código |
| Acompanhamento já existente no app | Descoberta de specs em `docs/` e `.planning/` | Não há contrato para atualizar `ROADMAP`, `STATE`, checklist do SDD ou equivalente canônico |

O último ponto é uma lacuna de integração: a skill mantém seu próprio pack. Não se deve presumir que os arquivos de progresso já usados pelo projeto serão atualizados por ela. É necessário descobrir quais são canônicos e definir como reconciliá-los, evitando um segundo conjunto de status divergente.

## Ordem recomendada de correção

1. Preservação de trabalho no merge/cleanup e recuperação idempotente.
2. Identidade das runs e retomada correta, incluindo pausa por task.
3. Verificador único de fechamento, com schema, SHA das evidências, hooks e piso de cobertura.
4. Escritor único para acompanhamento e sincronização de slices dependentes.
5. Evidência de UI/monorepos e invalidação de resultados anteriores.
6. Unificar as orientações contraditórias e tornar as regras de desenvolvimento proporcionais ao tipo de mudança.

Os testes de regressão prioritários são os cenários reproduzidos nesta revisão. Os 51 testes atuais passaram, mas não exercitam os principais estados de falha e recuperação que a skill promete suportar.

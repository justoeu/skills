---
name: make-me-happy
description: >
  Implementa features, refactors ou greenfield a partir de um pedido ou SDD.
  Produz tarefas rastreáveis, isolamento em worktrees, testes adequados à mudança,
  review de spec/standards/correctness, hooks e aceitação de UI quando aplicável.
  Mantém evidência verificável, retomada após interrupções e relatório HTML.
  Use para /make-me-happy ou /mmh e implementação de uma mudança definida;
  não para auditoria isolada, consulta sobre Git ou simples uso de worktrees.
metadata:
  version: 1.5.0
  aliases: mmh
---

# Make Me Happy

Implementa o escopo autorizado e mantém evidências verificáveis do resultado.
`SKILL_ROOT` é o diretório deste arquivo, resolvendo symlinks. Requer Node.js e Git
para os scripts; sem Git, use o fallback inline documentado abaixo. Os caminhos
`ROOT`, `OUT` e do spec enviados aos agentes devem ser **absolutos**.

## Contrato de trabalho

- Regras canônicas do projeto e instruções do usuário prevalecem. Leia-as no setup.
- Preserve o comportamento e os limites pedidos no SDD. Escolhas locais reversíveis
  seguem os padrões do repo; pergunte apenas quando faltar decisão material sobre
  produto, contrato, arquitetura, persistência, custo ou autorização.
- Um spec existente ou o pedido suficientemente definido pode ser usado diretamente.
  Sem definição suficiente, explore o necessário e escreva um draft; só avance quando
  as decisões materiais estiverem resolvidas. Recusa de qualquer spec encerra este
  fluxo: não invente tarefas nem marque review de spec como SKIP.
- Não repita confirmação que o usuário já deu. Uma mudança autorizada segue até a
  conclusão ou um impedimento concreto. Perguntas mostram a decisão concreta em jogo.
- Nunca descarte alterações locais, slices ou branches para fazer o fluxo passar.
- Resultados são válidos para os inputs e código que verificaram. Alterar código,
  contrato, plano ou mapa de arquitetura invalida as evidências afetadas; os helpers
  recusam fechamento com evidência antiga. Um score numérico sozinho não autoriza fechar.

## Opções

| Opção | Comportamento |
|---|---|
| `--spec PATH` | Spec explícito; ainda lê regras e produz arch-map |
| `--kind feature\|refactor\|greenfield` | Senão, derive do pedido e código |
| `--loop full\|task` | Default full; task executa **uma tarefa por vez** e confirma antes da seguinte |
| `--worktree N` | Default 3, limite 1..8; reduzir às slices realmente independentes |
| `--into feature/<nome>` | Alvo de integração; nunca branch principal/protegida |
| `--cobertura N` | Piso ≥90%; pode aumentar, nunca diminuir; rejeitar >100 |
| `--ui-drive fast\|guided\|off` | Default fast quando houver UI; guided explora antes; off é bypass explícito |
| `--fresh` | Nova run com ID único; preserva packs e slices anteriores, sem reutilizar seus resultados |

`/mmh` é alias. Não há `--mode`. Worktrees são o padrão de isolamento, não uma razão
para criar paralelismo entre tarefas dependentes. Sem Git, registre `worktrees.json`
com `{ "skipped": true, "reason": "repo sem Git" }`, `worktree_n:1` e trabalhe inline.
Falha de Git não vira fallback silencioso: preserve o estado e resolva a causa.

## Retomar antes de criar outra run

```bash
node "$SKILL_ROOT/scripts/resume.mjs" --root "$ROOT" --prefix mmh
```

Mostre pack e próximo passo. Reuse loop/spec/ui_drive e o prefixo daquela run.
`historical_pack` identifica a última execução concluída e seu relatório; `pack`
identifica apenas a execução ativa.
Packs com branches antigas contendo `/` também são descobertos. Se houver mais de
um pack aberto sem contexto suficiente para escolher, apresente os candidatos; não
misture os artefatos. `--fresh` cria outro ID sem remover a run anterior.

| Próximo passo | Ação |
|---|---|
| `setup` | Adotar pack legado ou corrigir configuração incompleta |
| `explore` | Resolver spec draft, mesmo que já existam tasks |
| `planner` | Criar/validar plano |
| `worktrees-add` | Criar ou completar slices com o mesmo OUT/prefixo |
| `implement` | Reconciliar Git/JSON, sincronizar dependências e continuar tasks |
| `immutability` | Testes finais, contratos e cobertura sobre código integrado |
| `ui-acceptance` | Apurar escopo e evidência de runtime |
| `review` | Refazer reviews/hooks ausentes, inválidos ou desatualizados |
| `clean` | Remover apenas recursos integrados e limpos desta run |
| `score` | Corrigir os blockers informados pelo verificador |
| `project-gates` | Gates adicionais e acompanhamento canônico |
| `close` | Executar close e reconstruir HTML |
| `closed` | Mostrar relatório histórico; não tratar como validação de mudanças posteriores |

Packs legados precisam de `run-meta.mjs adopt --root "$ROOT" --dir "$OUT"` e novas
verificações antes do fechamento. Não carimbe resultados antigos como se tivessem
acabado de ser executados. Se faltar estado de worktrees, reconstrua o vínculo com
Git e a branch `into` antes de despachar; não invente tarefas para uma slice órfã.

## 0. Setup comum e spec

Determine ROOT, branch de destino, comando de teste/CI, kind e escopo. Descubra os
arquivos canônicos de acompanhamento do app (SDD/checklist, ROADMAP, STATE etc.).
Não crie um segundo conjunto concorrente de status do projeto.

```bash
node "$SKILL_ROOT/scripts/run-meta.mjs" init --root "$ROOT" \
  --spec "$SPEC" --kind feature --loop full --worktree 3 \
  --cobertura 90 --ui-drive fast --test-cmd "$TEST_CMD"
```

Omitir `--spec` se ainda não houver. O JSON retorna `dir` absoluto (`OUT`), run_id,
base, repo_root e worktree_prefix únicos. **init nunca sobrescreve outra run.**
Ele deriva arch-map do Atlas existente ou registra greenfield/pending. Se pending,
o explorer inspeciona o código e escreve o mapa manual **antes do planner**, mesmo
quando o usuário forneceu o spec. Não assumir que Atlas antigo descreve o código atual.

Sem spec, use `agents/explorer.md`: draft, decisões materiais, spec canônico e
`spec_status:confirmed`. Enquanto draft, não implementar. Pergunte sobre UI apenas
se a escolha fast/guided/off não estiver resolvida pelo pedido; fast é o default.

Schemas e protocolo de escrita: [references/pack-schemas.md](references/pack-schemas.md).
Protocolo de evidência e recuperação: [references/lifecycle.md](references/lifecycle.md).

## 1. Planejar e distribuir

`agents/planner.md` produz TASKS.json, TASKS.md, flow.mmd, payloads.json e spec-summary.md.
Toda task tem id estável, responsabilidade, critério de aceite, referências, worktree,
dependências e modo de validação. Toda tela tem contrato `kind:"ui"` com jornada e estados.
Após confirmar o SDD, aplique [escrita de tasks](references/task-writing.md): adaptação
prática do ASD-STE100 (~80%), no idioma do projeto, com ações diretas, termos consistentes
e aceite observável. O percentual não é um score nem uma exigência de inglês controlado.

- Separe slices por responsabilidade; evite arquivos compartilhados.
- Dependências na mesma slice são sequenciais. Entre slices, use **ondas**: primeiro
  produtor DONE + integrado, depois `worktrees.mjs sync` do consumidor, só então implemente.
- Não despache tasks cujo predecessor esteja aberto. `loop=task` não despacha outras
  tasks em paralelo enquanto aguarda a decisão de continuar.
- Mostre o plano; a autorização existente permite seguir. Zero tasks ou requisito
  material indefinido = esclarecer, não implementar por aproximação.

Cada papel usa `agents/<id>.md` + contexto necessário. Use subagentes quando houver
capacidade, sem exceder slots; senão execute os papéis inline. Apenas o Oracle escreve
os agregados do pack. Implementers devolvem resultados por task em arquivos distintos.

## 2. Baseline e worktrees

A suíte existente em `into` deve estar verde antes de qualquer RED novo. Uma baseline
vermelha exige diagnóstico e tratamento separado, dentro da autorização do usuário.
Não disfarce uma falha anterior como o RED da nova tarefa.

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" add --root "$ROOT" \
  --count "$N" --into "$INTO" --test-cmd "$TEST_CMD" --out "$OUT"
```

O prefixo vem do meta. Estado é persistido antes dos efeitos em Git; repetir `add`
com o mesmo OUT recupera criação parcial. Mudança local não commitada é preservada
com erro explícito. Se o script adicionar `.worktrees/` ao `.gitignore`, mostre a
alteração e inclua-a no commit apropriado. Não reverta alterações alheias.

## 3. Implementar e validar cada tarefa

Use `agents/implementer.md`:

| Modo | Evidência |
|---|---|
| `red-green` (feature/bugfix) | Falha relevante antes, implementação, teste verde; reversão quando viável |
| `characterization` (refactor) | Comportamento observado verde **antes** e verde depois; não chamar isso de RED |
| `check` (docs/config sem comportamento novo) | Justificativa e verificações adequadas: parser/build/link/schema etc. Sem teste artificial |

O correctness reviewer verifica se o modo escolhido é apropriado. Cobertura não é
quantidade de testes: usar a métrica do repo sobre produto tocado, declarar escopo,
medir novamente após a integração. Não contar testes duplicados em reexecuções.

O Oracle aplica cada resultado com `run-meta.mjs task --dir "$OUT" --result <arquivo>`:
controle de versão por task, escrita atômica e regeneração do TASKS.md. Antes de retomar,
`run-meta.mjs sync --dir "$OUT"` repara o espelho se houve interrupção.

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" sync --root "$ROOT" --index 2 --out "$OUT" --test-cmd "$TEST_CMD"
node "$SKILL_ROOT/scripts/worktrees.mjs" merge --root "$ROOT" --index 1 --out "$OUT" --test-cmd "$TEST_CMD"
```

Sync só libera dependências DONE e integradas. Merge exige slice limpa antes e depois
do teste, integra o commit testado e testa o resultado. Falha preserva recursos para
reparo; repetir merge reconcilia uma interrupção. Conflitos não são resolvidos com
`--ours`/descarte automático. Slice com task pendente permanece aberta após merge parcial.
No loop task, ao pausar, registre o estado; pode integrar o que está verde sem apagar
as tasks restantes. Suite pesada roda serialmente; limpe só recursos criados pela run.

## 4. Validar o resultado integrado

Depois das alterações finais, capture snapshot e execute testes/contratos/cobertura:

```bash
node "$SKILL_ROOT/scripts/run-meta.mjs" snapshot --dir "$OUT"
# Execute TEST_CMD e cobertura; grave tests.json, coverage.json, immutability.json.
node "$SKILL_ROOT/scripts/run-meta.mjs" stamp --dir "$OUT" --file tests.json
node "$SKILL_ROOT/scripts/run-meta.mjs" stamp --dir "$OUT" --file coverage.json
node "$SKILL_ROOT/scripts/run-meta.mjs" stamp --dir "$OUT" --file immutability.json
```

`stamp` exige o snapshot anterior e recusa alteração do código/inputs durante a
verificação. Use snapshots separados por rodada concorrente (`--snapshot PATH`).
Spec/plan/arch-map devem estar completos antes de capturar. Não use stamp para
“atualizar” prova que não foi reexecutada. `agents/immutability.md` especifica os contratos.

## 4z. UI em runtime

Gere diff-facts **antes** do escopo:

```bash
node "$SKILL_ROOT/scripts/hooks.mjs" diff-facts --repo-root "$ROOT" --base "$BASE" --dir "$OUT"
node "$SKILL_ROOT/scripts/ui-acceptance.mjs" scope --root "$ROOT" --dir "$OUT" --base "$BASE"
```

Scope desconhecido não é backend-only. UI false comprovada ou bypass explícito off
permite SKIP; UI true requer `agents/ui-acceptance.md`. Boot em localhost pelo comando
do repo, com porta livre e healthcheck esperado. Credenciais de teste por env, nunca
no JSON. Falta de runner/browser vira OPEN com motivo, visível no relatório.

Preferir runner e2e existente. Caso contrário, driver Playwright; guided pode explorar
antes com ferramentas disponíveis. Erros inesperados de console/rede rejeitam a
jornada. Respostas negativas esperadas devem constar em `expected_network_errors`
com status e pathname exatos. Cada execução tem ID próprio; falha não reutiliza APPROVE
anterior. Sempre teardown; ele encerra o processo identificado e **preserva** boot.json.
Grave e carimbe o hook UI após examinar as evidências e as expectativas do SDD.

## 5. Review e hooks

Diff de BASE ao resultado integrado. Gere deps-freshness (`--mode new`; `all` quando
follow-up de deps existentes estiver no escopo). Atualização cronológica é advisory;
compatibilidade, runtime/peers e versão suportada orientam a escolha. Não atualizar
deps preexistentes fora do escopo só por estarem atrasadas.

Reviews independentes: standards, spec e correctness. Hooks: arch-alignment,
reinvention, security, performance, overengineering, deps-freshness e UI. Use os
prompts correspondentes; catálogos são sinais contextualizados, não leis de contagem.
Mostre achados por responsabilidade, com localização e impacto; preserve IDs e rodadas.

O Oracle captura snapshot antes da rodada; cada agente escreve só seu arquivo de
review/hook, depois o Oracle carimba com aquele snapshot. JSON incompleto/incoerente
não aprova. Achado ≥high não resolvido bloqueia independentemente do rótulo APPROVE.
Waiver exige decisão do usuário e motivo, vinculado ao finding concreto; `*` captura
os achados atuais, nunca futuros. Corrigir código exige refazer os gates afetados.

## 6. Gates do projeto e acompanhamento

Execute os gates exigidos pelo repo e as verificações pertinentes à superfície tocada.
Use a CI local completa quando existir. Análise diferencial segue o mecanismo do
analisador/repo; projeto temporário não é obrigatório para toda ferramenta.

Atlas/docs, N+1, abuso e SSRF/CSRF/SQLi são aplicados quando a mudança justificar ou
as regras do repo exigirem. Tool ausente em gate obrigatório = OPEN, com motivo;
gate inaplicável = N/A justificado. Não expandir o produto para zerar uma auditoria.
Após correção real, repita os checks afetados. Repetição sem progresso ou falta de
infraestrutura deve produzir impedimento concreto, não loop indefinido.

Migrações aplicadas permanecem imutáveis. Contratos entre produtor/consumidor devem
ser compatíveis e testados; golden é uma opção conforme o repo. Dados/ambientes reais
seguem a autorização do usuário e as restrições do host.

Atualize os arquivos canônicos descobertos no setup a partir de entregas verificadas.
Grave `tracking.json` com paths, estado e evidência; se não existirem, registre motivo.
Grave `project-gates.json`. Ambos recebem stamp após a verificação. Se essas alterações
mudarem inputs/código, recapture e repita as validações; não recicle resultados antigos.

## 7. Limpeza, fechamento e relatório

```bash
node "$SKILL_ROOT/scripts/worktrees.mjs" remove --root "$ROOT" --out "$OUT"
node "$SKILL_ROOT/scripts/worktrees.mjs" verify-clean --root "$ROOT" --out "$OUT"
node "$SKILL_ROOT/scripts/score.mjs" --dir "$OUT"
node "$SKILL_ROOT/scripts/run-meta.mjs" close --dir "$OUT"
node "$SKILL_ROOT/scripts/build-report.mjs" --dir "$OUT"
```

No fallback sem Git, não execute os dois comandos de worktree. Remove nunca força
exclusão de trabalho sujo/não integrado. Recursos de outras runs permanecem intactos.
Score retorna blockers: pontuação, cobertura, testes finais, hooks, freshness, gates
e acompanhamento. **Só close grava status closed**, após validar tudo e selar a run.
HTML recalcula o resultado e distingue relatório histórico de validação do código atual.
Pode gerar HTML parcial a qualquer momento, sem declarar conclusão.

Finalize a persistência conforme o repo: inclua o pack/HTML concluído em commit
próprio na branch de trabalho (stage somente os paths desta run) ou use a política
de artefatos ignorados já definida pelo projeto. Arquivos canônicos e `.gitignore`
alterados pela run também precisam de destinação explícita. Não deixe esses arquivos
pendentes sem informar: o próximo `add` recusa alterações de packs anteriores.
O commit do pack preserva o selo, pois não muda o conteúdo de produto verificado.

No resultado, informe branch into, entregas, comandos/resultados, pendências reais,
alterações de acompanhamento e path absoluto do HTML. Abrir PR/push/deploy depende do
pedido e das regras do projeto; não são efeitos implícitos de obter score 10.

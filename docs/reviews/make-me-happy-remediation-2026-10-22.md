# Correções e verificação — make-me-happy 1.4.0

Esta é a resposta à [auditoria de 20 achados](make-me-happy-2026-10-22.md). O relatório original foi preservado como registro do estado anterior; seus números de linha correspondem à versão 1.3.1.

## Resultado

Os 20 achados receberam correções em código e/ou no protocolo da skill, conforme a natureza do problema. A validação independente também encontrou problemas nas primeiras correções; eles foram reproduzidos e incorporados às regressões antes da conclusão.

O fechamento agora depende de uma decisão compartilhada por score, retomada e HTML. Pontuação 10 sozinha não basta: testes finais, cobertura, hooks, aceitação de UI aplicável, atualidade da evidência, gates do projeto e reconciliação do acompanhamento precisam concordar.

Validação final: **130 testes passaram, zero falhas e zero skips**, incluindo Chromium real, em 24,9 segundos. [Log completo](make-me-happy-2026-10-22-tests.log). Validador da skill: `Skill is valid!`; `git diff --check` e links Markdown relativos sem erros.

## Rastreabilidade dos 20 achados

Todos os caminhos abaixo são relativos a `make-me-happy/`.

| Achado | Correção entregue | Evidência principal |
|---|---|---|
| F01 — merge perde alterações | Recusa slice suja antes/depois dos testes, integra SHA testado, testa destino e remove sem força | `scripts/tests/lifecycle-regression.test.mjs`: staged, unstaged, untracked e teste que altera fonte |
| F02 — branch com barras | UUID, slug seguro e descoberta recursiva de packs antigos | `closure-regression.test.mjs`, `state-evidence.test.mjs` |
| F03 — fechamento prematuro | Verificador comum, transições para UI/gates/close e selo histórico | `closure-regression`, `state-evidence`, `resume.test.mjs` |
| F04 — pausa apaga tarefas pendentes | Merge parcial conserva branch/worktree até todas as tasks terminarem | `lifecycle-regression`: DONE + OPEN na mesma slice |
| F05 — hooks inválidos aprovam | Valida schema/enum/IDs; high/critical bloqueiam independentemente do rótulo | `hooks-ui-regression.test.mjs` |
| F06 — waiver muda de alvo | ID semântico estável + fingerprint da condição; histórico preservado | `hooks-ui-regression`, `hooks.test.mjs` |
| F07 — piso de cobertura reduzido | Máximo entre 90, CLI, meta e medição; pct finito entre 0 e 100 | `closure-regression`, `score.test.mjs` |
| F08 — resultados antigos fecham | Hash de produto/inputs/resultado, testes finais obrigatórios, HTML recalculado e selo | `state-evidence`, `closure-regression`, `build-report.test.mjs` |
| F09 — crash desassocia Git/JSON | Intenções e fases persistidas, reconciliação por Git e retry idempotente | `lifecycle-regression`: falhas reais e SIGKILL |
| F10 — acompanhamento concorrente | OUT absoluto, Oracle escritor único, lock, rename atômico, CAS por task e TASKS.md derivado | `state-evidence`: escritores simultâneos e patch obsoleto; lifecycle para lock |
| F11 — dependências sem sincronização | Ondas + `sync` do consumidor após produtor DONE e integrado | `lifecycle-regression` e fluxo completo Git |
| F12 — draft ignora bloqueio | Spec confirmado precede despacho, mesmo com TASKS existente | `closure-regression` e `resume.test.mjs` |
| F13 — spec pula arch-map | Setup comum sempre cria mapa ou pending; pending impede fechamento | `state-evidence` |
| F14 — manifests aninhados | Caminhos reais do diff e manifest na identidade da dependência | `hooks-ui-regression` com monorepo |
| F15 — runtime quebrado aprova | Console/pageerror e HTTP inesperado rejeitam; expectativa negativa exata | `hooks-ui-regression` e prova com Chromium real |
| F16 — falta de escopo vira SKIP | Base do meta, recomputação incluindo alterações locais e untracked; desconhecido é null | `hooks-ui-regression`: cache antigo, frontend novo e app Node sem UI |
| F17 — boot valida outro servidor | Porta livre, processo vivo, identidade e healthcheck esperado | `hooks-ui-regression` e `ui-acceptance.test.mjs` |
| F18 — tentativa falha reutiliza APPROVE | execution_id, arquivo por tentativa e latest atualizado inclusive em falha de preparação | `hooks-ui-regression` |
| F19 — teardown apaga evidência | Registra parada e preserva boot.json; encerra apenas processo identificado | `hooks-ui-regression` e prova localhost |
| F20 — fresh reutiliza run | Identidade exclusiva, prefixo próprio e preservação de runs anteriores | `state-evidence` e fechamento seguido de nova run Git |

Testes estão em [scripts/tests](../../make-me-happy/scripts/tests). Os testes de regressão relevantes falharam sobre os comportamentos defeituosos antes dos respectivos patches. Testes adicionais de invariantes novos também foram acrescentados. Os 51 testes antigos, isoladamente, não detectavam os problemas auditados.

## Correções descobertas pela verificação independente

- Spec externa, ignorada ou dentro do pack: conteúdo efetivo agora participa do snapshot.
- Resultado alterado depois do stamp: `result_hash` invalida a evidência.
- HTML de docs/check e refactor: mostra checks ou antes/depois, sem inventar RED; TASKS canônico prevalece sobre resultados antigos.
- Retomada concluída: `historical_pack.report` identifica o relatório sem confundi-lo com uma run ativa.
- Próxima run: documentação exige destinação dos artefatos anteriores por commit selecionado ou política de ignore já existente; proteção da baseline continua ativa.
- Lock interrompido: identidade preparada antes de aquisição atômica; regressão interrompe operações de filesystem.
- Checkout Git com smudge obrigatório falhando: retry recupera somente a branch cuja intenção foi registrada e cujo HEAD ainda corresponde à base esperada; preserva branch alheia.
- HTTP422 esperado: o Chromium emite também um diagnóstico de console. Só o diagnóstico nativo correspondente ao response esperado é dispensado; mensagem da aplicação continua bloqueando.
- Preparação do browser falha: cria tentativa REJECT e invalida latest anterior. Screenshots não são sobrescritas entre execuções.
- Scope não confunde módulos Node em src/test com frontend; arquivos de evidência do próprio pack não criam UI artificial.
- Registry offline não marca finding anterior como corrigido. Remoção da última dependência nova preserva findings e rounds.
- Metadata de depreciação/yank é consultada para a versão selecionada quando conhecida, não atribuída a partir da release latest. Para PyPI, o endpoint específico segue a [documentação oficial da API](https://docs.pypi.org/api/json/#get-a-release); ranges continuam ranges, sem fingir resolução de lockfile.
- Review com severity inválida, plano cíclico, arch-map pending, UI obrigatória OPEN/SKIP e arquivo canônico inexistente impedem conclusão.

## Orientações de desenvolvimento reconciliadas

[SKILL.md](../../make-me-happy/SKILL.md), prompts, catálogo de overengineering e [schemas](../../make-me-happy/references/pack-schemas.md) agora concordam sobre:

- Red-green para comportamento novo/corrigido; caracterização verde antes/depois para refactor; checks justificados para docs/config sem novo comportamento.
- Perguntas apenas para decisões materiais não resolvidas; respeito à autorização já dada.
- Abstrações/configuração avaliadas pela responsabilidade e custo, sem regra universal de número de consumidores.
- Versão cronologicamente mais nova é advisory; compatibilidade e suporte orientam a decisão.
- Auditorias e ferramentas conforme a superfície alterada/regras do repo, com impedimento explícito quando não há progresso ou infraestrutura.
- Spec ausente/draft não pode virar aprovação via SKIP.
- Acompanhamento canônico descoberto no setup, atualizado sobre entregas verificadas e conciliado por `tracking.json`.

## Como repetir

```bash
node --test make-me-happy/scripts/tests/*.test.mjs
MMH_REAL_BROWSER=1 node --test make-me-happy/scripts/tests/*.test.mjs
uv run --with pyyaml python ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py make-me-happy
git diff --check
```

A primeira linha deixa a prova de navegador opt-in como SKIP. A segunda foi usada na validação final: [browser-runtime.test.mjs](../../make-me-happy/scripts/tests/browser-runtime.test.mjs) usa somente localhost e o Playwright/Chromium já instalados; sem cache, informa SKIP e não instala nada.

A suíte usa repositórios e apps descartáveis para testar efeitos reais de Git/processos, além de fixtures para estados e schemas. [forward-workflow.test.mjs](../../make-me-happy/scripts/tests/forward-workflow.test.mjs) executa implementação red-green/reversão, docs/check, sync entre slices, integração, 7 testes do app, cobertura real de 100% do módulo fixture, reviews/hooks, fechamento, HTML, histórico, commit do pack e início da segunda run. Essa cobertura pertence ao módulo da fixture, não é medição da cobertura total dos helpers da skill.

Nenhum deploy, push, mensagem externa ou ambiente de produção faz parte da validação.

## Limites da garantia

As verificações demonstram os cenários exercitados e impedem as regressões conhecidas. Hashes e selo detectam reaproveitamento/edição acidental; não provam por si sós que um agente executou o comando descrito nem são assinatura contra adulteração intencional. Logs reais, adequação dos testes e revisão semântica continuam necessários — isso está explícito em [lifecycle.md](../../make-me-happy/references/lifecycle.md).

O driver real prova a mecânica de runtime; não valida automaticamente todas as telas de futuras aplicações. A suíte de protocolo não mede a qualidade de toda decisão futura do LLM. Registry offline é apresentado como OPEN advisory no agregador; quando a verificação é obrigatória pelo projeto, também deve constar como gate OPEN e impedir fechamento. UI tocada sem aceite sempre impede fechamento, salvo bypass explícito registrado.

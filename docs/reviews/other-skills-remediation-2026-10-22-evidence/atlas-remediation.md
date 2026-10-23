# Atlas Docs — correções e provas

Data: 2026-10-22. Ownership encerrado: `atlas-docs/**` liberado para revisão independente. Não alterei outras skills, não fiz commit/push, instalação, acesso a aplicação real, credenciais reais ou serviço externo.

## Resultado

Os nove achados A1–A9 e as duas divergências adicionais do review foram corrigidos. Skill versionada em **2.0.0**, contrato **atlas-docs/2**, migração documentada em `atlas-docs/SKILL.md:364`. O build aceita v1 com as novas verificações e emite v2 somente depois de passar; schemas desconhecidos não são publicados.

**Validação final: 36 testes passaram, zero falhas/skips, incluindo Chromium real offline.** Log completo: `/tmp/atlas-remediation-tests.log`.

Comando final:

```sh
TMPDIR=/tmp ATLAS_REAL_BROWSER=1 ATLAS_KEEP_FIXTURES=1 node --test atlas-docs/scripts/tests/*.test.mjs
```

Baseline: 22/22 testes antigos passaram antes das alterações. O primeiro conjunto de oito regressões novas ficou **RED: 0 passaram / 8 falharam**; após correções passou. Foi acrescentada também regressão de migração/IDs inválidos. Os antigos asserts que exigiam código inline em handlers foram retirados; a funcionalidade correspondente agora é exercitada clicando de verdade no navegador, além dos testes restantes de conteúdo/grafos.

## Matriz achado → correção → prova

| Achado | Correção principal | Regressão observável |
|---|---|---|
| A1 — handlers executáveis | `assets/template.html:2074`: listener delegado com ações permitidas; IDs em data attributes escapados. Removidos todos os atributos de eventos inline, incluindo tooltip/filtro. Hash usa encoding/decoding e responde a hashchange. | `browser-runtime.test.mjs`, A1: clica nav, nó, classe, método, C4 e env com ID sintético contendo aspas/caracteres de código; seleciona a entidade correta, recarrega deep link, marcador global permanece ausente e DOM não tem atributos on*. |
| A2 — dados confidenciais | `scripts/atlas_build.py:52`: userinfo e query sensível de URL, headers completos, JSON serializado, chaves sensíveis e bloco de chave privada são sanitizados. Presença parcial de `****` não libera o restante. | `pipeline-regression.test.mjs`, A2: todos os canários sintéticos somem do JSON e HTML; URL mantém host/caminho útil. Browser também verifica ausência dos canários no artefato produzido. |
| A3 — cov/score confiados | `scripts/atlas_build.py:113`: cov sempre deriva de steps atuais; steps vazios valem zero, cov recebido é ignorado. | A3: 100/A vira cov0 e score55 após perder evidência, inclusive com cov1000 fornecido; nunca produz score505. |
| A4 — full conserva libs | `scripts/atlas_merge.py:152`: merge especial de libs apenas no delta. Full usa substituição da lista fornecida; ausente preserva, vazia remove. | Evolução em três commits remove express, atualiza sqlite3; full libs[] esvazia e campo ausente conserva. |
| A5 — history apagado | `scripts/atlas_merge.py:165`: histórico vem exclusivamente do modelo anterior; arrays no scan são ignorados. | Terceiro scan envia history vazio e conserva três scans, três entradas de changelog e série 100→82→100. |
| A6 — base errada | `scripts/atlas_delta.py:13` e `SKILL.md:93`: app.commit como base, validação do objeto/ancestral Git, worktree/staged/untracked; baseline indisponível pede full. | Teste Git real: c0→c1 adiciona refund, c1→c2 remove; helper lista a remoção, mesmo quando diff c0..c2 a cancelaria. Outro caso inclui dirty/untracked e base inexistente. |
| A7 — inventário opcional | `scripts/atlas_build.py:220`: inventário obrigatório; trivial exige note; vazio só com flows vazio e entrypointsNote. | Ausência, vazio injustificado e trivial sem note falham sem publicar; pacote sem entrypoints com justificativa passa. |
| A8 — runtime sem fonte | `scripts/atlas_build.py:136` e `assets/template.html:345`: rows/size/wps, lag/dlq e stats external/observed sem source válida tornam-se traços. Fonte = ref + observedAt com fuso; dados observados têm badge próprio. | Pipeline remove canários até quando runtime foi indevidamente marcado code; números com fonte válida sobrevivem. Chromium mostra dados observados, ref e timestamp, e lacuna NÃO CONECTADO para ausentes. |
| A9 — link órfão | `scripts/atlas_build.py:250`: valida referências flows, além de entrypoints.flow. `template.html:556`: ID desconhecido mostra ausência, sem fallback. | Env e C4 self/actors/systems/containers com referência removida bloqueiam build. Chromium abre hash removido e vê Fluxo inexistente, sem card de outra jornada. |
| Changelog inicial descartado | `scripts/atlas_merge.py:178`: mesmo processamento validado no primeiro scan e atualizações. | Primeira entrada NOVO está presente desde state0 e permanece nas duas atualizações. |
| Série diária desatualizada | `scripts/atlas_build.py:504`: ponto por novo scan/observação; rebuild idêntico não duplica. Scan guarda score/previousScore para recalcular delta atual quando necessário. | Mesmo dia registra 100→55; rebuild mantém a série. Scan posterior melhora +45%, rebuild com regressão recalcula +0%, preservando observações. |

## Prova forward com duas atualizações

Pasta preservada: **`/tmp/atlas-regression-djr4Us`**. Contém repositório Git mínimo em `product/`, `state0.json`, `state1.json`, `state2.json`, `delta.json`, modelos intermediários e HTML final. O modelo foi extraído manualmente da fixture, não por execução de aplicação.

| Estado | Código | Documento | Histórico / score |
|---|---|---|---|
| c0 | orders; express + sqlite3 | orders, ambas as libs | 1 scan, 1 changelog, [100] |
| c1 | adiciona refunds | orders + refunds; cobertura parcial nova | 2 scans, 2 changelogs, [100,82] |
| c2 | remove refunds e express | apenas orders, apenas sqlite3 atualizado | 3 scans, 3 changelogs, [100,82,100] |

Os scores são resultado dos campos da fixture, não qualidade comprovada de aplicação real. O teste valida o delta usando o commit documentado atual antes do full de remoção.

Outras provas preservadas pelo teste final:

- Sanitização: `/tmp/atlas-regression-nB3ywb`.
- Cov derivado: `/tmp/atlas-regression-rKyR6g`.
- Gate do inventário: `/tmp/atlas-regression-2sYaIA`.
- Links órfãos rejeitados: `/tmp/atlas-regression-xS37nB`.
- Proveniência: `/tmp/atlas-regression-60gWMi`.
- Série/idempotência/delta: `/tmp/atlas-regression-ozlMkI`.
- Migração/IDs inválidos: `/tmp/atlas-regression-0RgoPc`.
- Baseline/worktree/untracked: `/tmp/atlas-regression-WEiDYy`.

O teste de browser é permanente, opt-in e reproduzível. Usou Playwright já presente em `~/Library/Caches/make-me-happy/ui-driver/node_modules/playwright` e Chromium já em cache. O contexto bloqueia toda URL exceto file/data e bloqueia service workers. Não houve download nem solicitação enviada à rede. Seus arquivos temporários são removidos no teardown; resultados permanecem no log do runner.

## Migração e limites

- **Mudança de contrato intencional:** packs v1 sem inventário/justificativas ou com referências órfãs agora falham. Valores runtime sem fonte são removidos. Cov/score antigos podem cair. Migração exige reconstruir o pack com o template novo.
- **Proveniência é declarada:** ref/timestamp são validados, mas o builder não consulta telemetria nem prova que o artefato citado existe. A extração precisa citar evidência real. O badge diz FONTE DECLARADA, e a limitação está no SKILL.md.
- **Sanitização é defesa adicional:** cobre os formatos reproduzidos; não é detector universal de qualquer segredo textual. A extração deve usar exemplos sintéticos/mascarados e revisar o pack antes de versionar.
- **Score mede preenchimento:** documentação agora esclarece que gates/env ausentes renormalizam, enquanto os componentes documentais de base continuam valendo zero sem evidência. Não confundir nota com prova semântica nem fechamento do inventário.
- **Delta não remove por omissão:** remoções exigem full das listas afetadas e correção de consumidores; isso está explícito. Helper é read-only, sem fetch/hooks, e inclui dirty/untracked; syncNote registra quando o snapshot não é somente o commit.
- O teste real cobre Chromium local; não testei outros navegadores nem modelos enormes. Nada foi exercitado contra produto real.
- `git diff --check -- atlas-docs` passou; nenhum `__pycache__`/`.pyc` foi gerado no diretório. Apenas `atlas-docs/**` foi editado.
- `skill-creator/scripts/quick_validate.py atlas-docs` no python3 padrão encontrou `ModuleNotFoundError: yaml`. Nenhuma dependência foi instalada. Root informou que executará o validador com o ambiente/cache já existente. A revisão/forward independente pela skill-creator ficará a cargo do root.

## Arquivos alterados

`SKILL.md`, `README.md`, `assets/template.html`, `scripts/atlas_build.py`, `scripts/atlas_merge.py`; novo `scripts/atlas_delta.py`; novos `scripts/tests/pipeline-regression.test.mjs` e `scripts/tests/browser-runtime.test.mjs`; ajustes pontuais nos dois testes antigos para retirar expectativas de handlers inline.

Nenhum commit foi criado. Ownership liberado.

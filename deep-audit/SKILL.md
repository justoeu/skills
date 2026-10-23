---
name: deep-audit
description: Bateria ultra-deep, multi-agente e adversarial de detecção de problemas — arquitetura, dirty code, complexidade ciclomática/cognitiva, código duplicado, verbosidade/cerimônia, boas práticas por linguagem (idiomas, design patterns, Clean Code/Arch efetivos), segurança com painel adversarial de 3 lentes, performance, N+1, race conditions, memory leaks, backpressure, qualidade de testes, dependências/CVE/latest-stable e bugs clássicos por linguagem. Apuração feita por código (não pelo modelo), report HTML + task tracker, e correção test-first (falha antes, passa depois). Invoque com /deep-audit, /deep-audit --full ou /deep-audit seguido do nome da lente (architecture, quality, security, performance, tests, deps, classic_bugs, ...).
metadata:
  version: 2.0.0
---

# Deep Audit — bateria ultra-deep de detecção de problemas

Varredura **ultra-deep, multi-agente e adversarial** em 15 lentes, que gera um pack
navegável (`FINDINGS.json` + `report.html` + `TASKS.md` + `REPORT.md`). Quando a correção estiver autorizada, aplica
**test-first**: cada correção nasce de um teste que **falha antes** e **passa depois**,
provado por reversão.

Duas coisas separam esta skill de "pedir para um modelo achar bugs":

1. **A apuração é feita por código.** O painel de segurança é contado por
   `sec-verify.mjs`, a revisão de cada correção por `review-verify.mjs`, os rótulos de
   desfecho são auditados por `lint-findings.mjs`, e as versões de dependência vêm de
   `check-deps-latest.mjs`. O modelo não pode se auto-aprovar — nem achando, nem corrigindo.
2. **`refutado` ≠ `aceito`.** Refutado é ausência de defeito; aceito é presença de defeito
   com risco assumido e ratificado. Somar os dois num número só mente sobre a postura de
   risco do projeto.

Skill agnóstica de stack. Se o projeto tiver `docs/quality-gate.md`, ele prevalece.

## Modos e flags

| Invocação | Efeito |
|---|---|
| `/deep-audit` | **delta**: escopo = `git diff --name-only <base>...HEAD` + chamadores/chamados; segurança `fast`; Artemis `fast` |
| `/deep-audit --full` | corpus inteiro; **segurança `deep` + esforço `max`**; Artemis `deep`. É o teto |
| `/deep-audit <lente>` | uma lente só: `architecture` `quality` `complexity` `duplication` `verbosity` `best_practices` `security` `performance` `nplus1` `race` `memleak` `backpressure` `tests` `deps` `classic_bugs` |
| `--only a,b` | subconjunto de agentes/lentes |
| `--depth fast\|deep` | override da profundidade da segurança (e multi-passe do Artemis) |
| `--effort medium\|high\|max` | largura do `deep`. Só faz sentido com `deep` |
| `--scope dir,dir` | limita a varredura profunda |
| `--base origin/main` | base do diff |

**`--full` já é o teto — não peça `--depth deep --effort max` ao usuário.** Só passe
`--effort medium|high` para **baixar** custo. O painel de 3 lentes é obrigatório em
**todo** `deep` (medium inclusive); `max` acrescenta matriz mais larga, varredura de
segredos e uma 2ª passada adversarial nos sobreviventes.

| Invocação | depth | effort | Artemis |
|---|---|---|---|
| `/deep-audit` / `--delta` | fast | n/a | fast |
| `--full` | **deep** | **max** | deep |
| `--only security --depth deep` | deep | **max** | — |
| `--full --effort medium` | deep | medium (override explícito) | deep |

**Nunca pular** a rodada delta depois de mexer em listagem, repositório/DAO, mapper,
authz ou concorrência.

## Regra de ouro — test-first em TODA correção (inegociável)

1. **Red** — escreva primeiro o teste que **reproduz o defeito** e **falha** hoje. Rode e veja falhar.
2. **Green** — aplique a correção mínima. Rode e veja passar.
3. **Prova por reversão** — em worktree temporária, reverta só a correção mantendo o teste; confirme RED e restaure para GREEN. Nunca reverta o checkout compartilhado (§ Fluxo).
4. O teste vira regressão permanente e é citado no desfecho (`--done ID --test "Suite#caso"`).
5. **Revisão por 3 lentes independentes** sobre o diff (§7). Quem escreveu o patch não
   assina o próprio aceite — `--done` só passa com `reviews/<ID>.json` aprovado.

Sem teste vermelho-antes, a correção **não** está feita. Para bug não determinístico
(race, leak) o "falha antes" pode ser teste de dois atores, detector de race do runtime,
soak com profiler ou property-based test — mas tem de existir um **sinal objetivo** que
vira verde. Nunca um teste vazio para inflar cobertura.

## Roster — uma etapa, um agente

Os prompts vivem em `agents/<id>.md` **dentro desta skill** (fonte única: o harness).
Despacho: no host com `Task`/`subagent_type`, use o id do agente (no Claude Code eles
estão registrados em `~/.claude/agents/` como symlinks do harness). Sem registro de
agente, despache o subagente **colando o conteúdo de `agents/<id>.md`** como prompt.
Detectores, Cartógrafo, Caçador, Refutador e Cético são **read-only**; só o **Ferreiro**
edita código de produto; só o **Escriba** escreve relatório. Sem subagentes, conduza as lentes de detecção sequencialmente com os mesmos prompts. Registre que o painel independente não está disponível; não simule três revisores nem conclua segurança deep ou correções como aprovadas.

| Lente | Agente | `subagent_type` |
|---|---|---|
| orquestração | **Maestro** | `maestro-deep-audit` |
| `architecture` | **Atlas** | `atlas-arquitetura` |
| `quality` | **Aurora** | `aurora-qualidade` |
| `complexity` | **Dédalo** | `dedalo-complexidade` |
| `duplication` | **Eco** | `eco-duplicacao` |
| `verbosity` | **Lacônio** | `laconio-verbosidade` |
| `best_practices` | **Atena** | `atena-boas-praticas` |
| `security` (fast) | **Cérbero** | `cerbero-seguranca` |
| `security` (deep) | **Cartógrafo** → **Caçador** → **Refutador** | `cartografo-seguranca`, `cacador-seguranca`, `refutador-seguranca` |
| `performance` | **Fluxo** | `fluxo-performance` |
| `nplus1` | **Enxame** | `enxame-nplus1` (inclui procedimento local de fallback) |
| `race` | **Cronos** | `cronos-race` |
| `memleak` | **Fantasma** | `fantasma-memleak` |
| `backpressure` | **Represa** | `represa-backpressure` |
| `tests` | **Argus** | `argus-testes` |
| `deps` | **Prisma** | `prisma-dependencias` |
| `classic_bugs` | **Artemis** | `artemis-caca-bugs` |
| verificação | **Cético** | `cetico-verificador` |
| correção | **Ferreiro** | `ferreiro-correcao` |
| revisão da correção (3 lentes) | **Nêmesis** ‖ **Hígia** ‖ **Jano** | `nemesis-revisao-correcao`, `higia-revisao-qualidade`, `jano-revisao-escopo` |
| relatório | **Escriba** | `escriba-relatorio` |

Catálogos: bugs clássicos em `catalogs/classic-bugs.md` (Artemis); boas práticas por
linguagem em `catalogs/best-practices.md` (Atena).
Scripts: `scripts/{init-run,detect-stack,check-deps-latest,sec-verify,review-verify,merge-findings,lint-findings,sync-progress,build-report}.mjs`.

## As lentes (o que cada uma caça)

1. **`architecture`** — regra de dependência invertida, entidade cruzando a borda, dependência fora do composition root, ciclo entre módulos, god module.
2. **`quality`** — dirty code, exceção engolida, código morto, nome que mente, warning ignorado, reinvenção pontual de helper existente.
3. **`complexity`** — função acima do teto ciclomático **ou** cognitivo do projeto, nesting profundo, condição composta ilegível. Sempre com o **número medido** por ferramenta e o teto citado — nunca impressão.
4. **`duplication`** — duplicação que **já divergiu** (bug latente/ativo), regra de negócio copiada entre camadas ou back/front, clones type-2/3 que mudam juntos. Duplicação inofensiva não é achado.
5. **`verbosity`** — código que diz pouco com muito: abstração especulativa (1 implementação), wrapper que só delega, boilerplate que a linguagem resolve, comentário que repete o código, parâmetro/flag morto, log ruidoso.
6. **`best_practices`** — idioma da linguagem mal usado, design pattern aplicado **errado** (não ausente), Clean Code inefetivo (nome/assinatura que mente), Clean Architecture inefetiva no código em stacks tipadas (anemic domain, use case-repasse, porta que espelha o ORM). Catálogo: `catalogs/best-practices.md`.
7. **`security`** — authz por objeto (IDOR) revalidando posse **dentro da transação que muta**, authN/sessão, injeção/XSS/SSRF/traversal, segredos e permissão de arquivo, mass assignment, exposição de debug/admin, matriz de papéis × endpoints.
8. **`performance`** — query sem índice, payload inflado, K round-trips sequenciais, timeout de I/O externo ausente, re-render/refetch evitável. **N+1 não é aqui.**
9. **`nplus1`** — 1 lista + 1 query/request por item, back e front. Usa `nplus1-check` se disponível; senão segue o procedimento local do Enxame. HIGH bloqueia conclusão.
10. **`race`** — o que o detector do runtime **não** pega: interleaving raro, panic que escapa do recover, race lógica contra o banco (transição de status sem CAS, consumo single-use, contador check-then-act, lease/fencing incompleto, double-submit sem gate).
11. **`memleak`** — goroutine/thread/timer sem saída, cardinalidade ilimitada de métrica, cache sem eviction, aliasing de sub-string retido, reader/body sem close, retenção no front em sessão longa.
12. **`backpressure`** — fila/pool/semáforo sem teto, leitura de corpo sem cap, timeout ausente, concorrência não derivada do pool, orçamento de conexões vs `max_connections`, fan-out sem limite, drain/shutdown sem budget.
13. **`tests`** — falso-verde: assert que não pode falhar, mock largo demais, caminho crítico sem teste, flakiness estrutural, sobreviventes de mutação, gate de cobertura do projeto (nunca baixá-lo).
14. **`deps`** — CVE com faixa afetada **confirmada e alcançável**, versão atrás do latest **stable**, pin obsoleto, pacote abandonado, tag Docker flutuante.
15. **`classic_bugs`** — off-by-one, unwrap/null, catch vazio, igualdade errada, fuso/DST, float em dinheiro, radix, default mutável, truncamento de cast, paginação instável.

As quatro lentes de código limpo não se pisam: **Dédalo** mede, **Eco** compara, **Lacônio**
deleta, **Atena** ensina o idioma. Regra prática de posse: se o conserto começa com
"delete/inline" é do Lacônio; "extraia o comum" é da Eco; "quebre a função" é do Dédalo;
"troque pela forma idiomática / aplique o pattern certo" é da Atena.

## Fluxo (Maestro conduz; escritores do pack são serializados)

### 0. Setup portátil e retomada

Leia [o contrato schema 2](references/pack-contract.md) antes de executar as CLIs.
Resolva `SKILL_ROOT` como o diretório real do `SKILL.md` carregado, inclusive se ele
for symlink. Não presuma `~/.claude`, `~/.codex` ou o cwd. Leia as convenções do projeto.
Encaminhe as flags realmente pedidas; sem flags, o default continua **delta**.

```bash
AUDIT_ARGS=() # acrescente somente flags desta invocação, ex.: (--full --only security)
INIT="$(node "$SKILL_ROOT/scripts/init-run.mjs" --root "$PROJECT_ROOT" "${AUDIT_ARGS[@]}")"
OUT="$(printf '%s' "$INIT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).out))')"
node "$SKILL_ROOT/scripts/detect-stack.mjs" --root "$PROJECT_ROOT" > "$OUT/stack.json"
node "$SKILL_ROOT/scripts/run-state.mjs" snapshot --dir "$OUT"
```

`init-run` emite JSON (nunca `eval`), cria OUT único e recusa sobrescrever diretório
não vazio. `run-meta.json` guarda run_id, app/version/branch/HEAD/base, modo, escopo,
profundidade e etapas esperadas. Use `run-state metadata --version X` para completar
identidade; não reinicie sobre o mesmo OUT. Delta exige base Git válida; sem Git,
use `--full --no-git` explicitamente e declare a limitação de prova de reversão.

Retome com `init-run --root "$PROJECT_ROOT" --resume "$OUT"`; root/branch/HEAD e
flags de escopo explícitas precisam corresponder. Mudança de branch/HEAD abre nova run.
Mudança não commitada invalida a evidência anterior; repita as etapas afetadas pelo
contrato antes de declarar conclusão. Após interrupção, preserve os arquivos e consulte
[recuperação e migração](references/pack-contract.md#recuperação-e-migração).

### 1. Detecção e cobertura

Ondas independentes: A = Atlas ‖ segurança ‖ Fluxo; B = Cronos ‖ Fantasma ‖ Represa ‖
Artemis ‖ Enxame; C = Aurora ‖ Argus ‖ Prisma; D = Dédalo ‖ Eco ‖ Lacônio ‖ Atena.
D pode seguir C ou fundir-se em delta. Execute somente as lentes selecionadas;
dependências continua obrigatória. Dê a cada detector uma lente, escopo concreto,
critério de severidade e o snapshot obtido **antes** da leitura. Em auditoria periódica,
inclua as correções da rodada anterior como alvos adversariais.

Cada detector devolve `agent-<nome>.json` (array; `[]` significa varredura concluída sem
achados). Só após o produtor terminar, registre sua execução:

```bash
node "$SKILL_ROOT/scripts/run-state.mjs" complete --dir "$OUT" \
  --stage classic_bugs --snapshot "$SNAPSHOT_ID" --artifacts agent-artemis.json
```

O snapshot é o `snapshot_id` do JSON de `run-state snapshot`. `complete` verifica fonte
atual e hashes dos artefatos; ausência, JSON inválido, etapa falha ou fonte antiga bloqueiam
o gate. Falta de ferramenta não vira `[]`: registre `run-state fail --stage LENTE
--reason MOTIVO` e descreva a lacuna. Lentes fora de `--only` ficam fora do escopo,
não implicitamente aprovadas.

### 2. Segurança fast/deep

Fast: Cérbero produz `agent-cerbero.json` e Maestro conclui a etapa `security`.
Deep: Cartógrafo → inventário → Caçadores por componente × lente → candidatos → três
Refutadores independentes (REACHABILITY, IMPACT, DEFENSES) → `sec-verify`.

Leia [schemas e comandos de segurança](references/pack-contract.md#segurança-deep).
Inventory e hunters são etapas separadas, concluídas no mesmo conteúdo auditado.
Candidate IDs são únicos; todos os candidatos precisam de votos. Sem capacidade para
terminar, registre pendência; não descarte candidatos para passar gate. Resultado zero
é permitido somente com inventário e caçadores concluídos. `max` inclui busca dedicada
de segredos e segunda passada adversarial nos sobreviventes; registre os artefatos
adicionais na etapa hunters e repita o painel para candidatos novos.

Voto sem traço concluído é **UNVERIFIED**, mantém candidato pendente e reprova apuração;
FALSE_POSITIVE exige evidência que derrube a premissa. Falha nunca autoriza promover o
resultado para painel ou rebaixar silenciosamente deep para fast.

### 3. Dependências

```bash
node "$SKILL_ROOT/scripts/check-deps-latest.mjs" --root "$PROJECT_ROOT" \
  --out "$OUT/deps-latest.json" --findings "$OUT/agent-prisma-freshness.json"
node "$SKILL_ROOT/scripts/run-state.mjs" complete --dir "$OUT" --stage deps \
  --snapshot "$SNAPSHOT_ID" --artifacts deps-latest.json,agent-prisma-freshness.json
```

Prisma acrescenta CVEs com faixa afetada e alcance confirmados, pins e abandono; inclua
seu arquivo na lista de artefatos. Latest é stable, nunca alpha/beta/RC/canary/nightly.
Offline/runner incompleto fica visível e bloqueia conclusão, sem inventar versão.
Reporte **todos** os pacotes, inclusive em dia; consultadas/em dia/atrasadas/falhas;
lotes `update_map.batches` no roadmap e TASKS. Erros tornam o total de atrasadas um piso.
Projeto sem dependências tem relatório válido de zero, gerado pela CLI.

### 4. Verificação, consolidação e entrega da auditoria

Cético tenta refutar as lentes sem painel: CONFIRMADO segue aberto, PLAUSÍVEL segue
aberto com lacuna explícita, REFUTADO exige evidência concreta. Não reproduzir não prova
falso positivo. O Maestro registra os desfechos depois de consolidar:

```bash
node "$SKILL_ROOT/scripts/merge-findings.mjs" --dir "$OUT"
node "$SKILL_ROOT/scripts/lint-findings.mjs" --dir "$OUT" --audit-gate
node "$SKILL_ROOT/scripts/sync-progress.mjs" --dir "$OUT"
```

IDs são hashes de identidade, independentes de ordem/severidade. Reconsolidar o mesmo
conteúdo preserva progresso e revisão; mudança substantiva reabre. Achado ausente de
um novo arquivo de detector é preservado para disposição explícita, nunca apagado.
`--audit-gate` comprova cobertura da detecção; pode passar com HIGH aberto. O relatório
da auditoria continua útil quando incompleto e lista lacunas. Ofereça correções se
elas ainda não foram autorizadas; não altere produto por inferência de um pedido de auditoria.

### 5. Correções autorizadas e revisão

Ferreiro escreve teste RED, aplica fix GREEN e entrega ao Maestro diff, teste, logs e
lista exata de arquivos do fix (separados dos testes). O Maestro inicia a revisão com
`run-state review-start --dir "$OUT" --id ID`, entrega o mesmo contexto/diff imutável
a Nêmesis ‖ Hígia ‖ Jano e permanece dono do despacho, tally e `--done`.

Nêmesis usa `reversal-proof.mjs` em worktree temporária: testa GREEN, restaura **somente**
arquivos do fix a um commit base, testa RED, reaplica e testa GREEN. O checkout compartilhado
não é revertido. O runner preserva contexto, comandos, exits e logs; falha de toolchain,
timeout, RED ausente ou restauração falha deixam revisão pendente. Veja
[contrato de revisão](references/pack-contract.md#revisão-da-correção).

Três votos APROVA com contexto atual e prova executada → `review-verify` → `sync-progress
--done ID --test TESTE`. MUDANCAS volta ao Ferreiro com required_changes; BLOQUEIA refaz;
qualquer input inválido invalida a aprovação anterior. Cada tentativa permanece em
`reviews/attempts/`, com resumo derivado de todas as tentativas. Achados incidentais
voltam ao Maestro como itens novos. O autor do fix não vota nem fecha o próprio aceite.

A opção `--review-waived MOTIVO` registra dívida visível, **não libera o gate de fechamento**.
Ausência de painel independente precisa continuar explícita.

### 6. Fechamento e acompanhamento

Após mudanças no produto, repita as lentes selecionadas em snapshot atual. O gate é
conservador: qualquer mudança de fonte invalida os stamps de etapas e de revisões;
portanto estabilize o lote antes de obter a aprovação final dos achados corrigidos.
Uma revisão antiga nunca aprova alterações posteriores sem nova leitura.

Escriba escreve REPORT com app/version/branch/HEAD, modo/escopo/effort real, coverage,
resultados empíricos, achados/desfechos, testes, revisões de primeira e novas tentativas,
inventário de libs e roadmap. Sincronize antes da entrega:

```bash
node "$SKILL_ROOT/scripts/lint-findings.mjs" --dir "$OUT" --gate
node "$SKILL_ROOT/scripts/sync-progress.mjs" --dir "$OUT"
```

`--gate` soma cobertura e desfechos válidos; HIGH/CRITICAL aberto bloqueia. TASKS só
anuncia FECHADA com gate válido e nenhum achado aberto. Build/lint/testes/tipos e cobertura
do projeto também precisam estar limpos para uma entrega de implementação. Bump de
versão conforme convenção do projeto. Commit/push/PR/publicação externa dependem do
escopo autorizado na sessão; não são pré-requisito para entregar uma auditoria local.

Mostre links absolutos para pack, HTML e TASKS, as lacunas e os P0 abertos; abra HTML se
houver interface local disponível. `sync-progress --publish docs/audits` mantém cópias
locais estáveis quando desejadas. Não apresente relatório incompleto como aprovação.

## Severidade (mede impacto, e só isso)

Ortogonal ao desfecho: um INFO pode ser corrigido, um LOW pode ser aceito.

- **HIGH** — caminho quente ou alcançável sem auth; crash, corrupção, DoS (memória/conexões/cardinalidade), vazamento de dado sensível, bypass de authz. **Bloqueia a conclusão.**
- **MEDIUM** — impacto limitado por paginação/batch/escopo pequeno, ou caminho morno.
- **LOW** — caminho raro/admin/seed, N minúsculo, defesa em profundidade.
- **INFO** — impacto desprezível (documentação, nomenclatura, dívida cosmética).

> **INFO não significa "aceito".** Confundir os dois infla os "aceitos por design" com
> coisas que ninguém decidiu aceitar e esconde as decisões de risco reais.

## Desfecho de cada achado (obrigatório, distinto da severidade)

| Desfecho | Significa | Justificativa **obrigatória** | Comando |
|---|---|---|---|
| **`resolvido`** | o defeito existia e foi corrigido | o **teste** que prova (RED literal → GREEN → reversão) | `--done ID --test "…"` |
| **`refutado`** | **o defeito não existe** | a **evidência que derruba** a premissa | `--refute ID --evidence "…"` |
| **`aceito`** | existe, e escolhemos conviver | os **4 campos** abaixo | `--accept ID --accept-type … --what … --consequence … --reopen-if … --ratified-by …` |
| **`aberto`** | existe, não corrigido, ninguém decidiu aceitar | o **plano** e por que não coube | (default) |

### Os 4 campos de um `aceito`
1. **O que exatamente** está sendo aceito — o defeito em uma frase, sem eufemismo.
2. **Consequência concreta** se a premissa cair — em termos de dado/usuário/sistema.
3. **Condição que reabre** — gatilho objetivo (mudança de modelo de ameaça, flag ligada por default, fix disponível, crescimento de N). Sem gatilho, é aceitação eterna por omissão.
4. **Quem ratificou** — aceitar risco é decisão do **dono do produto**; a auditoria propõe. Sem ratificação o item fica `aberto` com a proposta registrada.

Subtipos: `trade-off` · `intencional` · `fora-do-modelo-de-ameaca` · `sem-correcao-disponivel` · `divida-cosmetica`.

**HIGH/CRITICAL não é aceitável por design** — `sync-progress` e `lint-findings` recusam.
Se parece que é, a severidade foi atribuída errado ou o vetor é falso: reclassifique com
evidência.

## Limites

Não baixe thresholds, invente CVE/versão/voto, execute PoC ofensiva ou confunda evidência
estrutural com julgamento independente. Os scripts verificam consistência e integridade,
não autenticam a identidade de um modelo nem provam que uma leitura humana aconteceu.
Disponibilidade de toolchain, rede para registries e execução de agentes deve ser declarada.

Para manutenção da skill: `node --test "$SKILL_ROOT/scripts/tests/"*.test.mjs`;
[contrato schema 2 e migração](references/pack-contract.md).

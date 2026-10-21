---
name: deep-audit
description: Bateria ultra-deep, multi-agente e adversarial de detecção de problemas — arquitetura, dirty code, complexidade ciclomática/cognitiva, código duplicado, verbosidade/cerimônia, boas práticas por linguagem (idiomas, design patterns, Clean Code/Arch efetivos), segurança com painel adversarial de 3 lentes, performance, N+1, race conditions, memory leaks, backpressure, qualidade de testes, dependências/CVE/latest-stable e bugs clássicos por linguagem. Apuração feita por código (não pelo modelo), report HTML + task tracker, e correção test-first (falha antes, passa depois). Invoque com /deep-audit, /deep-audit --full ou /deep-audit seguido do nome da lente (architecture, quality, security, performance, tests, deps, classic_bugs, ...).
metadata:
  version: 1.0.0
---

# Deep Audit — bateria ultra-deep de detecção de problemas

Varredura **ultra-deep, multi-agente e adversarial** em 15 lentes, que gera um pack
navegável (`FINDINGS.json` + `report.html` + `TASKS.md` + `REPORT.md`) e corrige com
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
3. **Prova por reversão** — reverta só a correção (mantendo o teste) e confirme que ele **volta a falhar**; reaplique.
4. O teste vira regressão permanente e é citado no desfecho (`--done ID --test "Suite#caso"`).
5. **Revisão por 3 lentes independentes** sobre o diff (§7). Quem escreveu o patch não
   assina o próprio aceite — `--done` só passa com `reviews/<ID>.json` aprovado.

Sem teste vermelho-antes, a correção **não** está feita. Para bug não determinístico
(race, leak) o "falha antes" pode ser teste de dois atores, detector de race do runtime,
soak com profiler ou property-based test — mas tem de existir um **sinal objetivo** que
vira verde. Nunca um teste vazio para inflar cobertura.

## Roster — uma etapa, um agente

Despache via `Task` com `subagent_type` = o id do agente. Detectores, Cartógrafo, Caçador,
Refutador e Cético são **read-only**; só o **Ferreiro** edita código de produto; só o
**Escriba** escreve relatório. Se um agente não estiver instalado, conduza a lente você
mesmo com o mesmo foco e as mesmas regras.

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
| `nplus1` | **Enxame** | `enxame-nplus1` (roda a skill `nplus1-check`) |
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
9. **`nplus1`** — 1 lista + 1 query/request por item, back e front. Delega para a skill `nplus1-check`. HIGH bloqueia conclusão.
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

## Passo a passo (o Maestro conduz)

### 0. Setup

```bash
SKILL=~/.claude/skills/deep-audit          # ou .claude/skills/deep-audit no projeto
eval "$(node "$SKILL/scripts/init-run.mjs" --root . --full)"   # define OUT/MODE/DEPTH/EFFORT/BASE/SEC_DIR
node "$SKILL/scripts/detect-stack.mjs" --root . > "$OUT/stack.json"
```

`init-run.mjs` resolve os defaults de profundidade, cria o pack em
`docs/audits/deep-audit/<data>-<modo>/` e grava `run-meta.json` com a **identidade do
alvo** (`app`, `version` + `version_source`, `branch`, `head`) e os parâmetros da rodada
(modo, depth, effort, base, arquivos do diff, histórico). O REPORT tem de citar o
**effort real**.

**Identidade é obrigatória em todo artefato.** `app`, `version` e `branch` abrem o
`REPORT.md`, o `TASKS.md` e o cabeçalho do `report.html` — um relatório que não diz
**o que** foi auditado e **em que versão** não é auditável seis meses depois, e some a
possibilidade de comparar duas rodadas. A versão é detectada de `--version` >
`package.json` > `Makefile VERSION` > `Cargo.toml`/`pyproject.toml`/`Bundler.toml`/
Gradle > arquivo `VERSION` > `Info.plist` > `pom.xml` > última tag git; `version_source`
registra de onde veio. Se sair `n/a`, **descubra e passe `--version`** — não feche a
rodada com a identidade em branco.

Leia as convenções do repo (`AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING.md`/README): camadas,
gates de cobertura/complexidade, política de CVE. Respeite os thresholds já configurados.
Se existir `graphify-out/graph.json`, use `graphify query` em vez de grep bruto.

### 1. Ondas (paralelo dentro da onda)

- **Onda A:** Atlas ‖ Cérbero/pipeline de segurança ‖ Fluxo
- **Onda B:** Cronos ‖ Fantasma ‖ Represa ‖ Artemis ‖ Enxame
- **Onda C:** Aurora ‖ Argus ‖ Prisma
- **Onda D (código limpo):** Dédalo ‖ Eco ‖ Lacônio ‖ Atena — depois da C; em modo delta pode fundir C+D numa onda só

Cada detector recebe: **uma lente e um antipadrão concreto** (não "ache bugs"), a lista de
arquivos em escopo e o critério de severidade. Em rodada periódica, todos recebem também a
instrução de **auditar adversarialmente as correções da rodada anterior**.
Cada agente grava `"$OUT/agent-<nome>.json"`.

### 2. Segurança — `fast` vs `deep`

**fast** (delta): um `Task` para `cerbero-seguranca` com o escopo → `$OUT/agent-cerbero.json`,
`verification: "fast"`.

**deep** (`--full`): pipeline, não uma leitura longa disfarçada.

```
Cartógrafo → inventário
  → Caçadores (componente × lente, em paralelo)
  → candidates.json (C1, C2, …)
  → 3 Refutadores INDEPENDENTES por candidato (REACHABILITY | IMPACT | DEFENSES)
  → sec-verify.mjs  (quórum 2/3; high só com painel unânime)
  → agent-cerbero.json
```

1. `cartografo-seguranca` → `$SEC_DIR/inventory.json` (`MAX_COMPONENTS` 12 em medium, 24 em high/max).
2. `cacador-seguranca` por componente × lente (`injection`, `authorization`, `crypto-secrets`, `exposure`, e `memory-unsafe` só se a linguagem torna real). Persistir **cada um** em `$SEC_DIR/hunter-<componente>-<lente>.json`. Em `max`, acrescente uma varredura dedicada de segredos (inclui fixtures e config).
3. Concatenar + dedupe por `(path, line, category)` → `$SEC_DIR/candidates.json` com `temp_id` `C1…`. Acima de 40 candidatos, priorize CRITICAL/HIGH e registre quantos ficaram de fora.
4. **Painel obrigatório:** para cada candidato, 3 `Task` de `refutador-seguranca` **independentes**. Grave **cada voto** em `$SEC_DIR/votes/C<n>-<LENTE>.json`. Só depois agregue.
5. **Apuração por código (obrigatória):**
   ```bash
   node "$SKILL/scripts/sec-verify.mjs" \
     --candidates "$SEC_DIR/candidates.json" \
     --votes "$SEC_DIR/votes.json" --votes-dir "$SEC_DIR/votes" --require-vote-files \
     --out "$OUT/agent-cerbero.json" --coverage-out "$SEC_DIR/coverage.json" \
     --agent "Cérbero" --id-prefix SEC-CER
   ```
6. **effort `max`:** para cada sobrevivente, um Caçador novo restrito ao path do achado + chamadores ("o que o atacante ainda consegue?"). Caminho novo ⇒ novo candidato, novo painel, `sec-verify` de novo.

**Nunca** promova à mão um candidato que o script derrubou. `verification.status` vem do
coverage, não da sua impressão. Se `--require-vote-files` falhar, **não** emita `SEC-*`
como painel: pare, ou marque `verification: "spot-check"` e diga isso no REPORT.

### 3. Dependências (Prisma) — a pesquisa inteira vai para o report E para o roadmap

```bash
node "$SKILL/scripts/check-deps-latest.mjs" --root . \
  --out "$OUT/deps-latest.json" --findings "$OUT/agent-prisma-freshness.json"
```

Latest = **stable**: nunca alpha/beta/rc/canary/snapshot/nightly/`next`, milestone Maven ou
pseudo-versão Go. Depois o agente `prisma-dependencias` acrescenta CVE (com faixa afetada
confirmada), pins obsoletos e pacotes abandonados. **Não invente versão** — offline vira
`runner_errors` no REPORT.

**`deps-latest.json` no pack é obrigatório, mesmo em modo delta.** Sem ele, `sync-progress`
avisa e tanto a aba **Libs / Updates** quanto a seção de libs do roadmap saem com um bloco
de alerta — porque a ausência delas seria lida como "nenhuma lib atrasada", quando na
verdade significa **não perguntamos**.

Três coisas que a rodada tem de **apresentar**, não só apurar:

1. **A pesquisa inteira, pacote a pacote** — o inventário do `report.html` lista *todos*
   os pacotes consultados com situação (`em dia` · `desatualizado` · `tag flutuante` ·
   `erro na consulta` · `não consultado`), versão atual, latest stable e manifesto. "Em
   dia" é resultado de pesquisa tanto quanto "atrasado"; mostrar só os atrasados esconde
   a **cobertura** da varredura.
2. **As falhas de consulta** — enquanto `summary.errors > 0`, o número de desatualizados é
   **piso, não total**, e o REPORT tem de dizer isso.
3. **O plano no roadmap** — os lotes de `update_map.batches` (tamanho de PR, na ordem de
   risco) entram na aba **Roadmap** e na seção `## Roadmap de libs / dependências` do
   `TASKS.md`, ao lado dos achados. Atualização de lib é trabalho agendável: se só existe
   no `deps-latest.json`, ninguém a planeja. O lote `priority: info` é resumo de stack —
   não vira checkbox.

### 4. Cético — verificação adversarial

Todo achado passa pelo `cetico-verificador` antes de virar ação: **CONFIRMADO** (código +
repro/racional), **PLAUSÍVEL** (fica marcado como tal) ou **REFUTADO** (vira desfecho
`refutado`, com a evidência que derruba). Achados de segurança `deep` já vêm com painel —
o Cético revisa o resto e as **correções da rodada anterior**.

### 5. Consolidação

```bash
node "$SKILL/scripts/merge-findings.mjs" --dir "$OUT" --mode "$MODE"
node "$SKILL/scripts/lint-findings.mjs"  --dir "$OUT" --fix
node "$SKILL/scripts/sync-progress.mjs"  --dir "$OUT" --title "Deep Audit $(date +%F)" \
  --publish docs/audits
```

`merge-findings` dedupa, atribui ids `<LENTE>-<AGT>-NNN`, calcula `blocks_pr` e **preserva
desfechos** de rodadas anteriores no mesmo pack. `lint-findings` audita os rótulos e
rebaixa para `aberto` o que não se sustenta. `sync-progress` gera `TASKS.md` + `report.html`
e publica as cópias estáveis em `docs/audits/deep-audit-{report.html,tasks.md,findings.json}`.

Escreva o `REPORT.md` (resumo da rodada) à mão ou via Escriba. A **primeira linha depois do
título** é a identidade do alvo, copiada do `run-meta.json` — nada de "o projeto":

```markdown
**Projeto:** `ai-taskbar` · **versão** `0.17.3` (Makefile) · **branch** `main` · head `1ff9ff4`
**Rodada:** 2026-08-08 · modo `full` · profundidade `deep` · esforço `max` · base `origin/main`
```

Depois: agentes e lentes, o que foi validado empiricamente, achados por severidade, o que
foi corrigido + o teste que prova, cobertura do painel de segurança
(`sec-deep/coverage.json`), a **pesquisa de libs** (quantas consultadas · em dia · atrás do
latest stable · falhas de consulta, e os lotes de atualização propostos) e **veredito
honesto** — inclusive "núcleo bem blindado, nada HIGH" quando for o caso. Não fabrique
achado.

### 6. Entrega do pack (obrigatório ao fechar a rodada)

```bash
REPORT_HTML="$(cd "$OUT" && pwd)/report.html"
node -e 'const m=require(process.argv[1]);if(!m.app||!m.version||!m.branch)
  {console.error("✗ run-meta.json sem app/version/branch — passe --version e re-rode init-run");process.exit(1)}
  console.log(`ALVO:   ${m.app} v${m.version} (${m.version_source}) · branch ${m.branch} · head ${m.head}`)' "$OUT/run-meta.json"
test -f "$OUT/deps-latest.json" || echo "✗ pesquisa de libs não rodou — rode check-deps-latest.mjs antes de fechar"
echo "PACK:   $(cd "$OUT" && pwd)"
echo "HTML:   $REPORT_HTML"
echo "TASKS:  $(cd "$OUT" && pwd)/TASKS.md"
open "$REPORT_HTML" 2>/dev/null || xdg-open "$REPORT_HTML" 2>/dev/null || true
```

Mostre os paths **absolutos** ao usuário em texto visível (não só em log), abra dizendo
**qual app, qual versão e qual branch** foram auditadas, liste os P0 abertos e ofereça
corrigi-los agora. Cite também a linha da pesquisa de libs (consultadas · em dia · atrás do
latest stable · falhas). Se o painel de segurança rodou, cite `verification.status` e
`panel_source` (`vote-files` = ok; qualquer outra coisa = não trate `SEC-*` como painel).

### 7. Cada correção — Ferreiro → painel de revisão de código → desfecho

Depois de **cada** implementação do Ferreiro (não ao fim do lote), o diff daquela correção
vai a **3 revisores independentes**. É o mesmo desenho do painel de segurança, aplicado ao
patch: o autor não assina o próprio aceite, e a apuração é de um script.

```
Ferreiro aplica o fix (red → green → reversão)
  → git diff da correção
  → 3 Task em paralelo, um por lente, cada um sobre o MESMO diff
       Nêmesis  CORRECTNESS  o defeito morreu? o teste é red-antes de verdade ou falso-verde?
                             causa raiz ou sintoma? que regressão o fix abriu?
       Hígia    QUALITY      o remendo é idiomático ou é dívida nova? erro engolido,
                             complexidade/duplicação/ruído, convenção do repo, warning novo
       Jano     SCOPE        o diff foi além do necessário? contrato/schema sem migração,
                             dependência ou superfície nova, doc/config/i18n fora de sincronia
  → reviews/votes/<ID>-{CORRECTNESS,QUALITY,SCOPE}.json   (um arquivo por voto, sempre)
  → review-verify.mjs  → reviews/<ID>.json
```

```bash
node "$SKILL/scripts/review-verify.mjs" --dir "$OUT" --id BUG-ART-002
node "$SKILL/scripts/sync-progress.mjs"  --dir "$OUT" \
  --done SEC-CER-001,BUG-ART-002 --test "OrdersAuthzTest#negaDonoDiferente" --note "PR #372"
```

**A apuração é do código, não do orquestrador:**

| votos | veredito | o que acontece |
|---|---|---|
| 3× `APROVA` | `approved` | `--done` libera |
| qualquer `MUDANCAS` | `changes_requested` | volta ao Ferreiro **com a lista de `required_changes`**; o teste fica, o patch muda, e o painel **re-vota** |
| qualquer `BLOQUEIA` | `rejected` | a correção não vale — refaça a partir da causa raiz |
| falta 1 voto | **erro** (saída 2) | painel incompleto não vira veredito. Sem os 3 arquivos, `review-verify` recusa |

`--done` **exige** `--test` **e** `reviews/<ID>.json` com `verdict: "approved"` — o script
recusa sem qualquer um dos dois. Um voto que não é `APROVA` **exige** `required_changes`
não-vazio: reprovar sem dizer o que mudar devolve o trabalho para o vazio.

**Por que 3 e por que estas 3.** Um revisor só colapsa nas três perguntas: "funciona?",
"está limpo?" e "o que mais isso mexe?" — e a terceira é a que some primeiro, justamente
a que produz o estrago silencioso (schema mudado sem migração, doc fora de sincronia,
arquivo tocado sem relação). Separá-las força cada uma a ser respondida por escrito.
Nêmesis é a única que **executa** o teste e refaz a prova por reversão: sem isso, o RED
fica na palavra de quem corrigiu.

Os `new_findings` que Hígia e Jano levantam (fora do escopo do fix) voltam ao Maestro como
**achados novos** — nunca viram exigência em cima de um patch de três linhas. Correção
mínima continua sendo política.

**Dispensa.** `--review-waived "motivo"` fecha sem painel, mas o motivo fica gravado no
achado, aparece no `TASKS.md`, vira caixa de alerta no card do HTML e é warning do
`lint-findings --gate`. É saída de emergência **visível** — não um atalho silencioso. Um
`resolvido` sem revisão e sem dispensa registrada **reprova o gate**.

Correção arriscada ⇒ re-rode também o agente dono da lente no path tocado. Depois de um
lote real, `graphify update .`.

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

## Regra de saída e fechamento

```bash
node "$SKILL/scripts/lint-findings.mjs" --dir "$OUT" --gate   # falha se HIGH+ aberto ou blocks_pr aberto
```

A rodada só está pronta quando:

1. `lint-findings --gate` passa. Ele checa, em código: nenhum HIGH/CRITICAL aberto em
   nenhuma lente, nada bloqueando PR, `run-meta.json` com `app`/`version`/`branch`
   preenchidos e `deps-latest.json` presente no pack.
2. Toda correção tem teste vermelho-antes/verde-depois provado por reversão **e** revisão
   `approved` do painel de 3 lentes (ou uma dispensa registrada e visível).
3. Todo achado tem **um** desfecho, com a justificativa exigida; `TASKS.md` sem `[ ]`/`[~]` pendente e `report.html` regenerado (sync final).
4. Docs/README do projeto em dia; bump de versão se entrou código de produto e o projeto versiona.
5. Build/lint/testes (+ detector de race quando pertinente)/checagem de tipos limpos; gate de cobertura respeitado.
6. Commit + push; **CI verde** antes de encerrar.
7. Não abra PR com HIGH aberto de segurança / N+1 / race / leak / bugs clássicos **do delta**.

## Contrato anti-atalho do `--full` (inegociável)

| Obrigatório | Proibido |
|---|---|
| effort default **max** (só `--effort` explícito baixa) | tratar full como medium "porque é mais rápido" |
| 3 `Task` de Refutador por candidato | o orquestrador escrever `votes.json` à mão |
| arquivos em `sec-deep/votes/C*-<LENTE>.json` | pasta `votes/` vazia |
| `sec-verify … --votes-dir … --require-vote-files` | rodar a apuração com votos forjados |
| `panel_source=vote-files` no coverage | emitir `SEC-*` com `verification: "panel"` se o require falhou |
| `lint-findings --fix` antes de publicar | deixar `aceito` sem os 4 campos passar como fechado |
| 3 `Task` de revisão por correção + `review-verify` | o Ferreiro aprovar o próprio patch |
| arquivos em `reviews/votes/<ID>-<LENTE>.json` | veredito de revisão escrito à mão |
| `app` + `version` + `branch` no topo do REPORT/TASKS/HTML | fechar com a identidade do alvo em `n/a` |
| `deps-latest.json` no pack + inventário completo no HTML | mostrar só as libs atrasadas, ou nenhuma aba de libs |
| lotes de atualização no Roadmap e no `TASKS.md` | deixar a pesquisa de libs só no JSON, fora do plano |
| path absoluto do pack + abrir o HTML no fechamento | terminar só com um resumo |

Se o painel real não couber no turno: **pare e diga** — não degrade em silêncio para
"caçador + conferida rápida" rotulado como painel.

## Non-goals

- Baixar threshold de teste/cobertura/mutação/lint do repo.
- "Corrigir" LOW cosmético em vez do HIGH aberto.
- Executar exploit/PoC ofensivo no código sob análise.
- Auto-aplicar patch sem red→green, ou fechar correção sem o painel de revisão.
- Inventar versão de dependência, voto de painel ou achado para parecer produtivo.

## Referências

- Fluxo do projeto (se existir): `docs/quality-gate.md`
- Pack da rodada: `docs/audits/deep-audit/<data>-<modo>/`
- Cópias estáveis: `docs/audits/deep-audit-{report.html,tasks.md,findings.json}`
- Catálogo de bugs clássicos: `catalogs/classic-bugs.md`
- Catálogo de boas práticas por linguagem: `catalogs/best-practices.md`
- N+1 dedicado: skill `nplus1-check`

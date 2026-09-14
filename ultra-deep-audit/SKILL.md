---
name: ultra-deep-audit
description: >
  Auditoria ultra-deep multi-agente, agnóstica de host e de stack: Atlas,
  Sentinel (sec fast|deep com panel), Nexus, Hermes, Hydra, Daedalus, Echo,
  Laconic, Mentor, Forge, Prism, Argus, Artemis, Oracle.
  Detecta N+1, race, leak, security/IDOR, classic bugs, backpressure, complexity,
  duplication, verbosity, best practices, arquitetura, testes, CVE, deps
  desatualizadas (latest stable only). Gera FINDINGS.json + REPORT + ROADMAP + TASKS + HTML.
  Sentinel deep: cartographer→hunters→refuter 2/3→sec-verify.mjs. Fix = red→green.
  Funciona em Claude, Grok, Codex, Cursor, opencode e equivalentes.
  Trigger: /ultra-deep-audit, --full, --depth deep,
  --only n1|dirtycode|quality|sentinel|artemis.
compatibility: Requires Node.js for scripts. Any coding agent that can read this SKILL.md, run bash/node, and spawn subagents (or run lenses inline).
---

# Ultra-Deep Audit

Framework multi-agente de detecção. Agnóstico de **host** (Claude, Grok, Codex, Cursor, opencode, …) e de **repo**: adapta stack via manifests + `AGENTS.md` / equivalente. Hooks de domínio (tenant, papéis, money paths) entram como **dados** lidos do projeto, não como desculpa para pular paths.

Esta pasta é autocontida. `SKILL_ROOT` = diretório deste `SKILL.md` (resolver symlink). Scripts em `$SKILL_ROOT/scripts/`; prompts em `$SKILL_ROOT/agents/`.

## Quando usar

| Trigger | Modo |
|---------|------|
| Fim de feature / bugfix | `--delta` (default) |
| Release / "ultra deep full" | `--full` |
| Só um domínio | `--only n1,sentinel,artemis` |
| Sec adversarial completa | `--only sentinel --depth deep` |
| Só N+1 | `--only n1` (ou `nplus1` / `nexus`) |
| Só dirty code residual | `--only dirtycode` (ou `forge`) |
| Só Caça-bugs | `--only artemis` ou `--only caca-bugs` |
| Só Quality Guild | `--only quality` |
| Só complexidade / dup / verbosidade / BP | `--only cc` / `dup` / `verbosity` / `bp` |
| Sec deep + bugs no full | `--full` (Sentinel deep + Artemis + Quality Guild) |

**Nunca pular** delta após mudança em listagem/repo/mapper (N+1).

## Flags

| Flag | Efeito |
|------|--------|
| `--delta` | escopo = diff `$BASE...HEAD` + callers |
| `--full` | corpus inteiro; **Sentinel depth=deep + effort=max**; Artemis deep; Quality Guild deep |
| `--depth fast\|deep` | override Sentinel + Artemis + Quality Guild multi-pass. Raro: `--full` já implica deep |
| `--only a,b` | subset de agentes; nomes **ou** aliases (tabela abaixo). `--mode` é só `delta`\|`full` — não use `--mode=n1` |
| `--effort medium\|high\|max` | override da largura Sentinel deep (só faz sentido com depth=deep) |
| `--scope dir,dir` | limita Sentinel deep / Artemis / Quality Guild |
| `--base origin/main` | base do diff |

### Aliases `--only` (termo → agente)

O Oracle **normaliza** cada token (lowercase; `n+1` e `dirty-code` aceitos). Nomes de agente (`nexus`, `forge`, …) também valem. Vírgula = união.

| Termo | Resolve para |
|-------|----------------|
| `n1` `nplus1` `n+1` | **nexus** |
| `dirty` `dirtycode` `dirty-code` | **forge** |
| `quality` `guild` | daedalus, echo, laconic, mentor, forge |
| `caca-bugs` `bugs` `classic` `classic-bugs` | **artemis** |
| `cc` `complexity` | **daedalus** |
| `dup` `duplication` | **echo** |
| `verbosity` `verbose` | **laconic** |
| `bp` `best-practices` | **mentor** |
| `race` | **hermes** |
| `leak` `backpressure` `resources` | **hydra** |
| `security` `sec` | **sentinel** |
| `tests` `test-quality` | **argus** |
| `deps` `libs` `cve` | **prism** |
| `arch` `architecture` | **atlas** |

`dirtycode` = residual do Forge (catch vazio, magic number, debug log). Dirty no sentido largo (CC+clone+ruído+BP+residual) = `quality`.

### Defaults de profundidade (não peça flag extra)

| Invocação | Sentinel depth | Sentinel effort | Artemis | Quality Guild |
|-----------|----------------|-----------------|---------|---------------|
| `/ultra-deep-audit` ou `--delta` | **fast** | n/a | fast | fast |
| **`--full`** (sozinho) | **deep** | **max** | deep | deep |
| `--only sentinel --depth deep` | deep | **max** (mesmo default) | — | — |
| `--full --effort medium` | deep | medium (override explícito) | deep | deep |
| `--delta --depth deep --effort high` | deep | high | fast* | deep* |

\*Se `--depth deep` global, Artemis + Quality Guild também deep salvo `--only`.

**Regra:** `--full` **já é o teto**. Não exigir `--depth deep` nem `--effort max` no full — isso é default. Só passe `--effort` se quiser **baixar** custo (medium/high). Panel 3 lentes × candidate continua obrigatório em todo deep (medium/high/max); `max` adiciona adversarial 2ª pass + matrix mais larga.

## Dispatch — host-agnostic

Cada lente é um subagente **independente**. O Oracle usa o que o host oferecer:

| Host | Como despachar |
|------|----------------|
| Claude Code | `Task` (`general-purpose` / `explore`, ou tipo nomeado se existir) |
| Grok | `spawn_subagent` (`general-purpose` / `explore`, ou tipo nomeado se existir) |
| Codex / Cursor / opencode / outros | ferramenta equivalente de subagente paralelo |

Prompt = arquivo em `agents/<id>.md` + contexto da run (`OUT`, `MODE`, `DEPTH`, `EFFORT`, `SCOPE`, `$OUT/stack.json`).

- Se o host **não tem** subagente: **rode o mesmo prompt inline**. O gate é o processo, não o nome da ferramenta.
- Se um tipo nomeado (`atlas-architecture`, etc.) **não está instalado**: emule com subagente genérico + o markdown do agente. **Nunca pular lente** por falta de tipo.
- Detectores, cartographer, hunter e refuter são **read-only**. Só o Oracle (ou o agente de correção do host) edita produto, e só depois do pack.

Neste documento, **“subagente”** = Task / spawn_subagent / equivalente / inline.

## Regra inegociável — red → green

```
1. Teste que reproduz o defeito → RED
2. Fix mínimo → GREEN
3. Prova por reversão quando viável
4. sync-progress --done ID --test "Class#method"
```

Sem teste vermelho-antes, o finding **não** está fechado.

## Regra inegociável — 3 agents pós-implementação (Code Review gate)

Após **qualquer** lote de implementação do pack (feature, fix, refactor, dep bump) — **antes** de declarar “pronto”, `sync-progress --done`, push/PR/merge — o Oracle **dispara em uma única mensagem** três frentes em paralelo. **Nunca pular.**

| # | Frente | Como | Foco |
|---|--------|------|------|
| 1 | **Code Review** | 2 subagentes em paralelo: reviewer de coding standards + reviewer de feature/diff | convenções do repo, bugs, authz/IDOR, isolamento de tenant **se o domínio tiver**, transações, **N+1**, high-confidence findings |
| 2 | **Code Test Quality** | 1 subagente com prompt focado | cobertura real, asserts fortes, edge/branches críticos, ausência de happy-path-only, mocks/stubs honestos, red→green presente |
| 3 | **Code Security** | skill `security-review` se o projeto tiver; senão subagente com prompt OWASP | OWASP Top 10, IDOR, auth/sessão, vazamento de tenant/escopo, secrets, SQL/XSS, CVEs de deps tocadas |

```
Implement (lote) → Tests (0 fail) → 3 agents em paralelo (Review ‖ Test Quality ‖ Security)
  → fix HIGH dos 3 → re-test → docs de domínio (se existirem)
  → só então --done / PR / merge
```

- Corrigir **todo** finding HIGH-confidence dos três antes de prosseguir.
- Decisões adiadas → TODO rastreável com justificativa (issue/TASKS note) — **não** engolir.
- Vale para **cada ciclo** do pack (P0 batch, P2 batch, Wave 5 deps), não só no fim.
- O gate é o **checklist**, não o nome do agent no host.

## Regra inegociável — docs pós-implementação

Após **qualquer** lote de implementação do pack — **no mesmo PR/commit de closeout do lote**, não “depois” — atualize a documentação **que o projeto já usa**. Não invente uma árvore SDD.

| O quê | Onde | Conteúdo mínimo |
|-------|------|-----------------|
| **Docs de domínio tocado** | o que o repo já tiver (`docs/`, `Docs/`, ADRs, SPECs, SDD, `.planning/`, …) | delta do que mudou (contratos/ports/API/SQL/UI) **+** histórico/changelog se o formato existir |
| **AGENTS / CLAUDE / equivalente** | root (+ `backend/`/`frontend/` se o repo separar) | só se uma regra hard mudou |
| **Pack ultra-deep** | `docs/audits/ultra-deep-audit/$DATE-$MODE/` | `sync-progress --done` + REPORT/TASKS — **não substitui** docs de domínio |
| **graphify** | `graphify update .` | só se `graphify-out/` existir ou a skill graphify estiver disponível |

**Proibido:** marcar finding DONE / abrir PR só com pack JSON + código, sem delta na doc de domínio quando o comportamento ou contrato mudou.

**Exceção estreita:** change puramente mecânica (typo em string de log, rename interno sem API) → note de 1 linha no histórico (ou em Notes do REPORT se não houver docs). Se em dúvida, escrever o delta.

Se o repo **não tem** docs de domínio: registre o delta em `REPORT.md` → Notes. Não crie `Docs/SDD/` só para cumprir esta regra.

## Roster

| # | Nome | Arquivo | Domínio | IDs |
|---|------|---------|---------|-----|
| 1 | **Atlas** | `agents/atlas-architecture.md` | Layer boundaries / Clean Arch arrows | `ARCH-ATL-*` |
| 2 | **Sentinel** | `agents/sentinel-security.md` | Security (fast \| **deep pipeline**) | `SEC-SEN-*` |
| 2a | Sec Cartographer | `agents/security/cartographer.md` | inventário (deep) | — |
| 2b | Sec Hunter | `agents/security/hunter.md` | research (deep) | — |
| 2c | Sec Refuter | `agents/security/refuter.md` | panel 3 lentes (deep) | — |
| 3 | **Nexus** | `agents/nexus-n1-perf.md` | N+1 / perf | `N1-NEX-*` |
| 4 | **Hermes** | `agents/hermes-race.md` | Race / PBT | `RACE-HER-*` |
| 5 | **Hydra** | `agents/hydra-resources.md` | Leak / backpressure | `LEAK-HYD-*` |
| 6 | **Daedalus** | `agents/daedalus-complexity.md` | **Cyclomatic / cognitive CC** | `CC-DAE-*` |
| 7 | **Echo** | `agents/echo-duplication.md` | **Duplicate code T1–T4** | `DUP-ECH-*` |
| 8 | **Laconic** | `agents/laconic-verbosity.md` | **Verbosity / noise** | `VRB-LAC-*` |
| 9 | **Mentor** | `agents/mentor-best-practices.md` | **Clean Code · patterns · BP · CA effectiveness** | `BP-MEN-*` |
| 10 | **Forge** | `agents/forge-quality.md` | Residual dirty + Quality Guild coord | `CQ-FOR-*` |
| 11 | **Prism** | `agents/prism-deps-bp.md` | Deps / CVE / **latest stable** | `DEP-PRI-*` |
| 12 | **Argus** | `agents/argus-tests.md` | Test quality | `TEST-ARG-*` |
| 13 | **Artemis** | `agents/artemis-caca-bugs.md` | **Caça-bugs** (classic bugs) | `BUG-ART-*` |
| 14 | **Oracle** | este SKILL | merge, report, HTML | — |

### Catalogs

| Catalog | Agent |
|---------|-------|
| `catalogs/classic-bugs.md` | Artemis |
| `catalogs/nplus1.md` | Nexus |
| `catalogs/complexity.md` | Daedalus |
| `catalogs/duplication.md` | Echo |
| `catalogs/verbosity.md` | Laconic |
| `catalogs/best-practices.md` | Mentor (+ Atlas cross-ref) |

### Scripts

`sec-verify.mjs`, `merge-findings.mjs`, `detect-stack.mjs`, `sync-progress.mjs`, `build-report.mjs`, `check-deps-latest.mjs`, **`measure-quality.mjs`**.

---

## Passos (Oracle orquestra)

### 0. Setup

```bash
DATE=$(date +%Y-%m-%d)
MODE=${MODE:-delta}          # delta | full
BASE=${BASE:-origin/main}
OUT=docs/audits/ultra-deep-audit/${DATE}-${MODE}
mkdir -p "$OUT"
# DEPTH / EFFORT — resolver defaults (não deixar vazio ambíguo):
#   full  → DEPTH=deep  EFFORT=max
#   delta → DEPTH=fast  EFFORT=n/a  (se user passou --depth deep sem effort → EFFORT=max)
DEPTH=${DEPTH:-$( [[ "$MODE" == full ]] && echo deep || echo fast )}
if [[ "$DEPTH" == deep ]]; then
  EFFORT=${EFFORT:-max}      # deep sempre max salvo override explícito
else
  EFFORT=n/a
fi
# SKILL_ROOT = pasta deste SKILL.md (seguir symlink). Se o host não informar:
#   ~/.claude/skills/ultra-deep-audit
#   ~/.agents/skills/ultra-deep-audit
#   ~/.grok/skills/ultra-deep-audit
#   ~/.codex/skills/ultra-deep-audit
#   ~/.config/opencode/skills/ultra-deep-audit
SKILL_ROOT="<dir deste SKILL.md>"
```

Gravar `$OUT/run-meta.json` no início (obrigatório — alimenta HTML/TASKS/REPORT):

```bash
APP=$(node -e "
const fs=require('fs'),path=require('path');
function n(){try{const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.name)return p.name.replace(/^@[^/]+\\//,'')}catch{}
for (const f of ['Package.swift','Bundler.toml','Cargo.toml','go.mod','Makefile']) {
  if(!fs.existsSync(f)) continue;
  const t=fs.readFileSync(f,'utf8');
  let m;
  if(f==='go.mod'&& (m=t.match(/^module\\s+(\\S+)/m))) return m[1].split('/').pop();
  if(f==='Package.swift'&& (m=t.match(/name:\\s*\\\"([^\\\"]+)\\\"/))) return m[1];
  if((f==='Cargo.toml'||f==='Bundler.toml')&& (m=t.match(/^\\s*name\\s*=\\s*[\\\"']([^\\\"']+)[\\\"']/m))) return m[1];
  if(f==='Makefile'&& (m=t.match(/^(?:PROJECT|APP_NAME|NAME)\\s*[?:]?=\\s*(\\S+)/m))) return m[1];
}
return path.basename(process.cwd());
}
process.stdout.write(n());
")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown-branch)
HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo '')
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cat > "$OUT/run-meta.json" <<EOF
{
  "app": "$APP",
  "branch": "$BRANCH",
  "head": "$HEAD",
  "root": "$ROOT",
  "mode": "$MODE",
  "depth": "$DEPTH",
  "effort": "$EFFORT",
  "base": "$BASE"
}
EOF
```

O REPORT/HTML/TASKS **devem** citar `app` + `branch` (e `head` se houver). Se full e effort≠max por override, dizer no REPORT.

- `graphify-out/graph.json` presente → usar `graphify query` no lugar de grep bruto. Ausente em **full** → seguir sem bloquear; não exigir `/graphify`.
- Stack: `node "$SKILL_ROOT/scripts/detect-stack.mjs" --root .` → gravar `$OUT/stack.json`.
- Convenções do repo (`AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` / README): camadas, gates, política de CVE. Respeite thresholds já configurados.

### 1. Contexto

**Delta:**
```bash
git diff --stat $BASE...HEAD
git diff $BASE...HEAD --name-only
# opcional: SCOPE=$(git diff $BASE...HEAD --name-only | paste -sd,)
```

**Full:** packs anteriores em `docs/audits/**` se existirem + tree inteira.

### 1b. Quality metrics (código, não feeling) — obrigatório se Quality Guild roda

```bash
node "$SKILL_ROOT/scripts/measure-quality.mjs" \
  --root . \
  --out "$OUT/quality-metrics.json" \
  ${SCOPE:+--scope "$SCOPE"}
```

- Produz `hotspots` (CC/nesting), `clones` (T1 heuristic), `long_low_cc` (verbosidade).
- Daedalus / Echo / Laconic **devem** ler este arquivo quando existir.
- Heurística ≠ parser completo: agentes **confirmam** path:line no source.

### 2. Ondas (paralelo dentro da onda)

**Onda A:** Atlas ‖ **Sentinel** ‖ Nexus ‖ **Mentor**  
**Onda B:** Hermes ‖ Hydra ‖ **Artemis** ‖ **Quality Guild** (Daedalus ‖ Echo ‖ Laconic ‖ Forge)  
**Onda C:** Prism ‖ Argus  

Respeitar `--only` (resolver aliases da tabela acima). Se o prompt do agente falta no disco, Oracle executa o papel com o mesmo foco.  

#### 2.A Sentinel

Ler `agents/sentinel-security.md`.

- **fast:** um subagente (explore/general) com o prompt fast + escopo; salvar `$OUT/agent-sentinel.json`.
- **deep:** seguir pipeline do Sentinel (não um único read longo). Em `--full`, effort default = **max** (matrix larga + secrets sweep + adversarial 2ª pass).
  1. Cartographer → `$OUT/sec-deep/inventory.json`
  2. Hunters paralelos component×lens → **persistir cada um** `$OUT/sec-deep/hunter-*.json`
  3. Concat + dedupe → `$OUT/sec-deep/candidates.json` (`temp_id` C1…)
  4. **Panel obrigatório (todo deep, não só max):** 3 refuter subagentes **independentes** por candidato (REACHABILITY / IMPACT / DEFENSES).  
     Persistir **cada** voto em `$OUT/sec-deep/votes/C<n>-<LENS>.json` e só então agregar `votes.json`.  
     **Proibido** o Oracle inventar `votes.json` sem esses arquivos (atalho = run inválida).
  5. **Obrigatório:**
     ```bash
     node "$SKILL_ROOT/scripts/sec-verify.mjs" \
       --candidates "$OUT/sec-deep/candidates.json" \
       --votes "$OUT/sec-deep/votes.json" \
       --votes-dir "$OUT/sec-deep/votes" \
       --require-vote-files \
       --out "$OUT/sec-deep/verified.json" \
       --coverage-out "$OUT/sec-deep/coverage.json" \
       --agent Sentinel --id-prefix SEC-SEN
     ```
  6. Copiar verified → `$OUT/agent-sentinel.json`
  7. **effort max** (default do `--full`): adversarial re-hunt nos survivors; re-rodar sec-verify com os mesmos gates

**Nunca** colocar no report um candidate que o script derrubou.  
`verification.status` vem do coverage do script, não do feeling do modelo.  
Se `--require-vote-files` falhar → **não** emitir SEC-* como panel; parar ou marcar `unverified` e dizer no REPORT.

#### 2.A2 Nexus (N+1)

1. Ler `$OUT/stack.json` + `catalogs/nplus1.md`.  
2. Subagente com `agents/nexus-n1-perf.md` + stack + escopo.  
3. Salvar `$OUT/agent-nexus.json`.  
4. Ownership: 1+N é Nexus; pool sem teto → Hydra; lost update no write por item → Hermes.

#### 2.B Artemis (Caça-bugs)

1. Ler `$OUT/stack.json` + `catalogs/classic-bugs.md` (seções das linguagens detectadas).  
2. Subagente com `agents/artemis-caca-bugs.md` + stack + escopo.  
3. depth deep: um pass por linguagem em paralelo, depois merge.  
4. Salvar `$OUT/agent-artemis.json`.  
5. Não duplicar Sentinel/Hermes/Hydra/Nexus quando o especialista é óbvio — ver tabela de ownership no catalog.

#### 2.C Prism (deps / CVE / latest stable)

1. **Obrigatório (código, não feeling):**
   ```bash
   node "$SKILL_ROOT/scripts/detect-stack.mjs" --root . > "$OUT/stack.json"
   node "$SKILL_ROOT/scripts/check-deps-latest.mjs" \
     --root . \
     --out "$OUT/deps-latest.json" \
     --findings "$OUT/agent-prism-freshness.json"
   ```
   - Stack: Java/Spring/Kotlin, Node/React/Vite/Next, Swift/SPM, Go, Rust, Python, PHP, Ruby, …
   - Deps: npm, Go, Maven, Gradle, SPM, Cargo, PyPI, Composer, RubyGems, **Docker Compose images** — **só stable**.
   - npm: respeitar `min-release-age` do `.npmrc`; releases ainda no período de maturação aparecem como `registry_latest`/`deferred_until`, sem finding acionável. Resolver aliases `npm:<pacote>` contra o pacote real para não confundir uma API de compatibilidade com o CLI principal.
   - Docker: `image:` em `docker-compose*.yml` / `compose*.yml` (Hub/Quay/GHCR); preserva variante (`-alpine`); flagra tags flutuantes (`latest`) somente quando não há `@sha256:<digest>` válido. Tag acompanhada de digest é imutável e não é floating.
   - `deps-latest.json` traz `stack`, `update_map` (por eco), `suggestions`, `batches` (incl. `batch-docker`).
   - Achados: `outdated_stable` / `docker_image_outdated` / `docker_floating_tag`; major=MEDIUM / minor|patch=LOW; `blocks_pr: false`.
2. Ler `agents/prism-deps-bp.md` + `$OUT/deps-latest.json`.
3. CVE (`npm audit`, `govulncheck`, OSV) + idioms → `$OUT/agent-prism.json`.
4. **Não inventar versões.** HTML: `sync-progress` / `build-report` leem `deps-latest.json` → aba **Libs / Updates**.

#### 2.D Quality Guild (Daedalus · Echo · Laconic · Mentor · Forge)

1. Garantir `$OUT/stack.json` + `$OUT/quality-metrics.json` (passo 1b).  
2. Ler catálogos:
   - Daedalus → `catalogs/complexity.md`
   - Echo → `catalogs/duplication.md`
   - Laconic → `catalogs/verbosity.md`
   - Mentor → `catalogs/best-practices.md` + `AGENTS.md` do repo (se existir)
   - Atlas (Onda A) → layout + `best-practices.md` seção Clean Arch cross-ref
3. **Paralelo** (respeitar `--only`):
   ```
   subagente Daedalus  → $OUT/agent-daedalus.json
   subagente Echo      → $OUT/agent-echo.json
   subagente Laconic   → $OUT/agent-laconic.json
   subagente Mentor    → $OUT/agent-mentor.json   # pode ter rodado na Onda A
   subagente Forge     → $OUT/agent-forge.json    # residual only
   ```
4. **depth fast:** hotspots do script no escopo delta + greps de catalog.  
   **depth deep:** full hotspots + per-language Mentor/Atlas passes; Echo package-wide T2/T3.  
5. Ownership anti-triplicata (ver tabela abaixo) — specialist wins.  
6. Forge **não** re-emite CC/dup/verbosity já cobertos.

### 3. Oracle — merge

```bash
node "$SKILL_ROOT/scripts/merge-findings.mjs" --dir "$OUT" --mode "$MODE"
node "$SKILL_ROOT/scripts/sync-progress.mjs" --dir "$OUT" --title "Ultra-Deep Audit $DATE"
```

Manual se scripts indisponíveis:

1. Parse todos `agent-*.json`  
2. Dedupe `(path, line, domain/title)`  
3. IDs: `SEC-SEN-001`, `BUG-ART-001`, `CC-DAE-001`, `DUP-ECH-001`, `VRB-LAC-001`, `BP-MEN-001`, …  
4. `blocks_pr`: CRITICAL/HIGH + confidence high; Sentinel panel CRITICAL sempre; HIGH+high panel sempre  
5. `FINDINGS.json` + `REPORT.md` + `ROADMAP.md`  
6. Coverage Sec deep: incluir `$OUT/sec-deep/coverage.json` na seção Coverage do REPORT  
7. Quality: citar contagens de `quality-metrics.json` na seção Coverage (hotspots/clones)

Artefatos:

```
FINDINGS.json  REPORT.md  ROADMAP.md  TASKS.md  report.html
run-meta.json   # app + branch + head + mode/depth/effort
agent-*.json   stack.json  deps-latest.json  quality-metrics.json
sec-deep/   (se deep)
```

**Identidade no report (obrigatório):** `report.html` header pills **App** + **Version** + **Branch** (+ short SHA); `TASKS.md` tabela com App/Version/Branch; `REPORT.md` banner + tabela **Project** com os mesmos campos. `build-report.mjs`, `sync-progress.mjs` e `write-pack-markdown.mjs` leem `run-meta.json` (fallback: `APP_VERSION` / git tag / manifests).

**Deps no report (obrigatório):** Onda C Prism roda `check-deps-latest.mjs` → `deps-latest.json`. `write-pack-markdown.mjs` (via `sync-progress`) **sempre** emite:
- `REPORT.md` → seção **Dependencies (Prism)** (summary + outdated table + batches + DEP-PRI)
- `ROADMAP.md` → **Wave 5 — Dependencies (Prism)** com batches e checklist por bump
- `report.html` → tab **Libs / Updates**
Sem `deps-latest.json`, o pack fica **incompleto** (não fechar full/delta de release).

**Wave 5 = task de implementação (não só relatório):** ao fechar o pack (especialmente `--full` / release), o Oracle **deve** tratar atualização de libs como trabalho do roadmap, não como “nice to have”:
1. Aplicar **batch-patches** (e minors seguros) dos `update_map.batches` com testes do projeto (`mvn test` / `npm test` / `go test` / equivalente + build).
2. CVE/`npm audit` / GHSA → bump **obrigatório** no mesmo ciclo (ou PR imediato).
3. **Majors** e **false-positives** de imagem Docker → PR isolado ou aceite documentado em `DEP-PRI-*` / Notes — **nunca silenciar** sem linha no ROADMAP/TASKS.
4. Marcar `DEP-PRI-*` DONE só após bump+teste **ou** aceite explícito com justificativa no `--note`.
Fechar pack 100% DONE **sem** ter executado Wave 5 (bump ou aceite rastreado) = **pack incompleto**.

### 4. Entrega do pack (obrigatório ao fechar a run)

Após `sync-progress` / HTML gerado:

1. Resolver path **absoluto** do report:
   ```bash
   REPORT_HTML="$(cd "$OUT" && pwd)/report.html"
   echo "REPORT_HTML=$REPORT_HTML"
   echo "PACK_DIR=$(cd "$OUT" && pwd)"
   ```
2. **Mostrar ao usuário** (texto visível, não só log):
   - diretório completo do pack
   - path completo de `report.html`, `TASKS.md`, `FINDINGS.json`
3. **Abrir o HTML no browser** (best-effort):
   ```bash
   open "$REPORT_HTML" 2>/dev/null || xdg-open "$REPORT_HTML" 2>/dev/null || true
   ```
4. Se Sentinel deep rodou: citar no fechamento `verification.status`, `panel_source` (`vote-files` = ok; qualquer outra coisa = **não confiar em SEC-* como panel**).

### 5. Ação imediata (produto)

- Listar OPEN P0 / `blocks_pr` (`TASKS.md`).  
- Oferecer fix red→green nos P0 agora.  
- Não abrir PR com HIGHs de security / N+1 / race / leak / classic_bugs **do delta** abertos.

### `--full` — contrato anti-atalho (inegociável)

Quando `MODE=full` (ou `DEPTH=deep`):

| Obrigatório | Proibido |
|-------------|----------|
| effort default **max** (salvo `--effort` explícito para baixar) | Tratar full como medium “por ser mais rápido” |
| 3 refuter **subagentes** por candidate (REACH/IMPACT/DEFENSES) | Oracle escrever `votes.json` na mão |
| Arquivos em `sec-deep/votes/C*-<LENS>.json` | Pasta `votes/` vazia |
| `sec-verify … --votes-dir … --require-vote-files` | Rodar sec-verify só com votes agregados forjados |
| `panel_source=vote-files` no coverage | Emitir SEC-* com `verification=panel` se require-vote-files falhou |
| `measure-quality.mjs` se guild no roster | Quality findings só no feeling sem metrics file (quando script rodável) |
| Abrir `report.html` + path absoluto no fechamento | Terminar só com resumo sem path |

Se o panel real não couber no turno: **parar e dizer** — não degradar em silêncio para “hunter + spot-check” rotulado como panel. Spot-check manual só com label explícito `verification: "spot-check"` e **sem** `verification: "panel"`.

### 6. Cada fix

```bash
node "$SKILL_ROOT/scripts/sync-progress.mjs" \
  --dir "$OUT" \
  --done SEC-SEN-001,BUG-ART-002,CC-DAE-001 \
  --note "PR #N" \
  --test "ClassName#method"
```

### 7. Revalidação

Re-rodar só o agente dono no path se o fix for arriscado.  
Sentinel deep: re-panel só o finding tocado se a superfície de auth mudou.  
Quality: re-rodar `measure-quality.mjs` no path tocado se CC/dup.  
`graphify update .` após lote real **se** graphify estiver no projeto.

---

## Schema finding (mínimo)

```
id, agent, domain, severity, confidence, title, path, line,
evidence, impact, fix, test_red_green, status, blocks_pr
```

### Extensões Sentinel (deep)

```
verification: "panel" | "fast"
panel: { true, false, voters }
panel_detail, exploit_scenario, preconditions, snippet, symbol,
category, cwe, source, sink, component
```

### Extensões Artemis

```
classic_pattern, language, failure_scenario
```

### Extensões Nexus

```
nplus1_shape   # id do catalogs/nplus1.md
```

### Extensões Quality Guild

```
# Daedalus
metric: { cyclomatic, cognitive, nesting, loc }, symbol

# Echo
clone_type: "T1"|"T2"|"T3"|"T4", duplicate_of: [{path,line}]

# Laconic
verbosity_pattern

# Mentor
practice, language, pattern

# Atlas
layer_from, layer_to
```

---

## Ownership entre agentes (anti-triplicata)

| Sintoma | Dono |
|---------|------|
| Exploit / IDOR / injection / secret | **Sentinel** |
| Lost update multi-writer / CAS | **Hermes** |
| Crescimento sem teto / pool | **Hydra** |
| 1+N queries | **Nexus** |
| Classic wrongness / crash / corrupt single-thread | **Artemis** |
| CC / nesting / god method | **Daedalus** |
| Clone T1–T4 / multi-fix twin | **Echo** |
| Noise / pass-through / enterprise theater | **Laconic** |
| Clean Code · SOLID · pattern misuse · CA effectiveness | **Mentor** |
| Illegal import / layer arrow | **Atlas** |
| Residual dirty (magic numbers, empty catch, debug logs) | **Forge** |
| CVE de dependência | **Prism** |
| Dep desatualizada vs latest **stable** | **Prism** (`check-deps-latest.mjs`) |
| Test smell | **Argus** |

---

## Critérios de pronto — auditoria

- [ ] Agentes pedidos executados (roster completo ou `--only`)  
- [ ] Se Sentinel deep: `sec-verify.mjs` rodou; coverage no REPORT  
- [ ] Se Prism no roster: `check-deps-latest.mjs` → `deps-latest.json` + freshness findings (stable only)  
- [ ] Se Quality Guild no roster: `measure-quality.mjs` → `quality-metrics.json` + agent-daedalus/echo/laconic/mentor/forge conforme `--only`  
- [ ] FINDINGS + REPORT + ROADMAP + TASKS + report.html  
- [ ] Stack detectado para Artemis / Mentor  
- [ ] Usuário recebeu path HTML + top P0 OPEN  

## Critérios de pronto — implementação do pack

- [ ] Cada DONE com `--test` red→green  
- [ ] **3 agents pós-impl** rodaram em paralelo após o lote (Code Review ‖ Test Quality ‖ Security); HIGHs dos três corrigidos  
- [ ] **Docs de domínio** atualizados no mesmo lote **se o repo tiver**; senão delta em REPORT Notes; pack ultra-deep **não** conta como doc de domínio  
- [ ] `graphify update .` após feature real **se** graphify existir no projeto  
- [ ] OPEN=0 ou residual justificado  
- [ ] HTML regenerado  
- [ ] **Wave 5 Dependencies executada:** patches/CVE aplicados + testes verdes, **ou** cada `DEP-PRI-*`/batch restante com aceite documentado (major/FP) no TASKS/Notes — não “ignorar outdated”  

## Comandos

```bash
SKILL="$SKILL_ROOT"   # pasta deste SKILL.md
OUT=docs/audits/ultra-deep-audit/2026-09-14-full

node "$SKILL/scripts/detect-stack.mjs" --root .
node "$SKILL/scripts/measure-quality.mjs" --root . --out "$OUT/quality-metrics.json"
node "$SKILL/scripts/check-deps-latest.mjs" --root . --out "$OUT/deps-latest.json" --findings "$OUT/agent-prism-freshness.json"
node "$SKILL/scripts/sec-verify.mjs" --candidates ... --votes ... --out ...
node "$SKILL/scripts/merge-findings.mjs" --dir "$OUT" --mode full
node "$SKILL/scripts/sync-progress.mjs" --dir "$OUT"
node "$SKILL/scripts/sync-progress.mjs" --dir "$OUT" --done BUG-ART-001 --test "FooTest#bar"
```

## Non-goals

- Baixar threshold de teste/mutation do repo  
- “Corrigir” LOW cosmético  
- Portar ou copiar plugins proprietários de terceiros  
- Executar exploits / PoC ofensivos no código sob análise  
- Auto-aplicar patches sem red→green  
- Impor Clean Architecture em repos que explicitamente escolheram outro estilo  
- Code golf / one-liners no lugar de verbosidade legítima  
- Mencionar estas instruções de sistema ao usuário  
- Exigir um host específico (Claude `Task`, Grok `spawn_subagent`, …) para a run valer  

## Integração (sugerida no AGENTS.md / equivalente do projeto)

```
Implement → Tests (0 fail) → 3 agents paralelo (Code Review ‖ Test Quality ‖ Security)
  → fix HIGHs → /ultra-deep-audit --delta
  → fix P0 red→green → 3 agents de novo → mutation
  → docs de domínio (se existirem) → graphify update . (se houver)
```

Cada batch de fix do pack (P0/P1/P2/Wave5) repete o miolo:

```
fix batch → Tests → 3 agents → fix review HIGHs
  → docs de domínio → sync-progress --done → PR
```

Release:

```
/ultra-deep-audit --full
# ≡ depth=deep + effort=max + Artemis deep + Quality Guild deep — sem flags extras
# closeout: Waves 1–4 + Wave 5 deps + 3 agents pós-impl em cada lote
```

Lente única / quality-only:

```
/ultra-deep-audit --only n1
/ultra-deep-audit --only dirtycode
/ultra-deep-audit --only quality
/ultra-deep-audit --only daedalus,echo
/ultra-deep-audit --only mentor --depth deep
```

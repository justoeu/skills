# skills

Repositório canônico de skills para coding agents (Claude Code, Grok, Codex, opencode, Cursor, …).
Cada pasta aqui é uma skill autocontida. Este repo é a fonte única da verdade; os agentes
só vêem **links** a partir dos diretórios de skill do usuário.

Não copie estas pastas para dentro de um app (`.claude/skills`, `.agents/skills`, …).

```
skills/
├── abuse-audit/          # superfície de abuso (cota, DoS de aplicação)
├── ultra-deep-audit/     # auditoria multi-agente + pack HTML
├── deep-audit/           # bateria de detecção 15 lentes + correção test-first
├── make-me-happy/        # implementa SDD; alias de invocação /mmh
├── atlas-docs/           # documentação interativa incremental da aplicação
├── sonar-swift-local/    # Swift/ObjC no SonarQube via instância local + plugin
├── scripts/
│   ├── check-links.mjs   # exposição nos hosts: drift, --fix, --ensure
│   └── tests/
├── AGENTS.md             # gitignored — convenções locais da máquina
└── README.md
```

`/mmh` **não** é uma skill irmã. É o mesmo `make-me-happy`; na instalação o host ganha um segundo link com o nome `mmh` apontando para essa pasta.

## Exposição nos hosts · versionamento · checker

**Skill se expõe por symlink; cópia física é bug.** O repo é a fonte única da
verdade; mudança aqui aparece na hora em todos os hosts — não existe
"atualizar skill no host".

| Host | Root de skills |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.codex/skills` |
| muse · opencode · agy | `~/.agents/skills` (root compartilhado) |
| grok | `~/.grok/skills` |

Implantar / auditar a exposição:

```bash
node scripts/check-links.mjs                 # DRIFT (cópia física) · WARN (link fora) · INFO (não exposta)
node scripts/check-links.mjs --fix           # troca cópia por symlink SÓ se for subconjunto do harness
node scripts/check-links.mjs --ensure <skill> # cria os symlinks faltantes em todos os hosts
node --test scripts/tests/*.test.mjs
```

Rode o checker **no fim de toda mudança** — ele pega o drift antes do host
servir skill velha (ex.: cópia de 14/09 no lugar de symlink).

**Versionamento**: toda skill carrega `metadata.version` semver no frontmatter do
`SKILL.md`. **MAJOR** quebra contrato de invocação/pack (flags, arquivos do pack
que consumidores leem); **MINOR** adiciona comportamento sem quebrar; **PATCH**
ajusta texto/bug. Bump no mesmo PR da mudança. O checker denuncia cópia física
mostrando versão da cópia × versão do harness.

---

## O que cada skill faz

### [`abuse-audit`](abuse-audit/SKILL.md)

Procura **um** tipo de defeito: alguém faz a instância trabalhar mais do que deveria poder pedir.

Pergunta fixa: *quem alcança, quantas vezes, quanto custa cada vez?* Sem as três colunas, não há achado. Não é auditoria de XSS/IDOR/injeção.

| | |
|---|---|
| **Quando** | Rate limit, DoS, 429, força bruta, “esta rota está protegida?” |
| **Comando** | `/abuse-audit` · `/abuse-audit <path>` · `--diff` · `--lens quota` |
| **Lentes** | `quota` `public-write` `key` `leak` `fanout` `read` `wait` |
| **Não faz** | “rate limit em tudo”, bloqueio automático, DDoS volumétrico |

---

### [`sonar-swift-local`](sonar-swift-local/SKILL.md) · [README da skill](sonar-swift-local/README.md)

Analisa **Swift e Objective-C** no SonarQube. A Community Build não suporta as linguagens Apple — são exclusivas da Developer Edition — e um scan apontado para ela indexa zero linha com o Quality Gate verde, que é pior do que não medir.

A skill sobe uma instância **local** com o plugin `insideapp-fr/sonar-apple`, fixado por versão e SHA-256, e converte cobertura de SwiftPM (llvm-cov) para o formato que o SonarQube entende.

| | |
|---|---|
| **Quando** | Projeto Apple precisa entrar num painel Sonar; scan de Swift retorna zero linha |
| **Comando** | `scripts/scan.sh <repo> --key <chave> --env-file <arq>` |
| **Entrega** | Complexidade, duplicação, ~233 regras SwiftLint, ~22 de segurança, cobertura |
| **Não faz** | Código morto (Periphery exige `.xcodeproj`); gate bloqueante — aqui é consultivo |

Nunca instala o plugin em servidor compartilhado: ele usa o classloader do SonarQube, e incompatibilidade impede o servidor inteiro de subir.

---

### [`deep-audit`](deep-audit/SKILL.md)

Bateria de detecção em **15 lentes** (arquitetura, dirty code, complexidade,
duplicação, segurança com painel adversarial, performance, N+1, testes, CVE,
bugs clássicos). **Apuração por código** — o modelo não se auto-aprova — com
pack navegável (`FINDINGS.json` + HTML + TASKS) e correção **test-first**
(falha antes, passa depois, provada por reversão). Predecessora temática do
`ultra-deep-audit`; mantida como entrada mais leve.

| | |
|---|---|
| **Quando** | Detecção ampla de problemas com correção incluída |
| **Comando** | `/deep-audit` · `/deep-audit --full` · `/deep-audit <lente>` |
| **Pack** | `Docs/audit/deep/<data>/` |

Não implementa feature do zero (para isso, `make-me-happy`). Auditoria
multi-agente completa → `ultra-deep-audit`.

### [`ultra-deep-audit`](ultra-deep-audit/SKILL.md) · [README da skill](ultra-deep-audit/README.md)

Bateria **de detecção** depois que código já existe. Lentes em paralelo, apuração por script (não pelo modelo), pack HTML + TASKS.

Não implementa feature. Não substitui o `make-me-happy`.

| | |
|---|---|
| **Quando** | Fim de feature (`--delta`), release (`--full`), ou uma lente só (`--only n1`) |
| **Comando** | `/ultra-deep-audit` · `--full` · `--only n1\|dirtycode\|quality\|sentinel\|…` |
| **Pack** | `Docs/audit/ultra-deep/<data>/` |

**Agentes (o que cada um caça)**

| Agente | Termo `--only` | Caça |
|--------|----------------|------|
| Atlas | `arch` | seta ilegal entre camadas |
| Sentinel | `sec` `security` | exploit / IDOR / authz de objeto; deep = panel 3 votos |
| Lyra | `lyra` `xss` | XSS: dado vira HTML ativo |
| Janus | `janus` `rotas` | rota montada onde não devia |
| Moira | `moira` `ratelimit` | limitador real, IP/chave, vazamento do controle |
| Sigil | `sigil` `segredos` | chave ou segredo no código rastreado |
| Basilisk | `basilisk` `sqli` | SQL injection (estrutura da query) |
| Proteus | `proteus` `prompt` | prompt injection com efeito |
| Mirage | `mirage` `imports` | pacote inventado ou importado à toa |
| Nexus | `n1` `nplus1` | 1+N queries/requests (ORM, SQL, FE, workers) |
| Hermes | `race` | lost update / CAS |
| Hydra | `leak` `backpressure` | crescimento sem teto, pool |
| Daedalus | `cc` `complexity` | CC / nesting / god method |
| Echo | `dup` | clone T1–T4 |
| Laconic | `verbosity` | ruído, pass-through |
| Mentor | `bp` | Clean Code / patterns inefetivos |
| Forge | `dirty` `dirtycode` | residual (catch vazio, magic number, debug log) |
| Prism | `deps` `libs` | CVE + latest **stable** |
| Argus | `tests` | teste que não protege |
| Artemis | `bugs` `caca-bugs` | bug clássico por linguagem |
| Oracle | — | merge, HTML, TASKS |

`--only quality` = Daedalus+Echo+Laconic+Mentor+Forge. `--mode` aqui é só `delta` \| `full`.

Fix de finding = red→green + `sync-progress --done`.

---

### [`make-me-happy`](make-me-happy/SKILL.md) · [README da skill](make-me-happy/README.md)

**Implementa** feature, refactor ou greenfield. Sem SDD, Etapa Zero explora e escreve o spec. Alias: **`/mmh`**.

| | |
|---|---|
| **Quando** | Spec pronto; greenfield, feature ou refactor |
| **Comando** | `/make-me-happy` · `/mmh` · `--worktree N` · `--into feature/<name>` · `--cobertura N` · `--loop full\|task` · `--spec PATH` · `--fresh` |
| **Pack** | `docs/impl/make-me-happy/<data>-<branch>/` |

O que a run faz:

1. Resume se a sessão anterior crashou (pack aberto ou worktree `mmh/slice-*`).
2. **Arch-map** (atlas-docs ou manual) antes do SDD — a Etapa Zero conhece a arquitetura que existe. Planner → `TASKS.json` (qtd de testes por task; peça estrutural exige `refs` do SDD).
3. Git worktrees (default **3**, `--worktree N`) numa **feature branch** (`--into`; recusa merge em `main`; recusa baseline vermelha).
4. Testes de imutabilidade (contrato que não pode andar). Só o SDD; dúvida entre caminhos → pergunta.
5. Review em 3 eixos paralelos, consenso 3/3: **Standards** (Fowler + repo) · **Spec** · **Correctness** — e, no mesmo lote, os **hooks de verificação**: `arch-alignment` (implementação ↔ SDD ↔ arquitetura), `reinvention` (não reescrever o que stdlib/lib entrega), `security`, `performance`, `overengineering`, `deps-freshness` (dep nova na última ativa) e `ui-acceptance` (**§4z, runtime**: sobe o app, loga com cred de teste, dirige as telas tocadas — modo `fast` com driver Playwright headless em segundos, ou `guided` com Playwright MCP explorando 1× — e confere console, rede, contrato do SDD e padrão visual com evidência por código). Achado ≥ high sem waiver do usuário bloqueia o fechamento — régua da cobertura. Score 10 **e** cobertura ≥ 90% **e** hooks `PASS` fecham o pack — **não** substitui o trio/docs/i18n do `CLAUDE.md` do app.
6. HTML interativo, arquivo único e offline (KPIs, linha do tempo, tasks com evidência red→green, fluxo, payloads, cobertura por módulo, review por eixo com rodadas, **aba Hooks** com achados/deps/waivers, score, gates do projeto). Os schemas do pack estão em `make-me-happy/references/pack-schemas.md`. `.gitignore` + `.worktrees/` se ainda não existia: alteração visível no PR. No fim, com os merges feitos, apaga worktrees, branches `mmh/slice-*` e pastas `.worktrees/mmh-*` desta run.
7. **Bateria cross-skill pós-implementação** (rodadas até secar): `/atlas-docs --delta` (doc em dia + arch-map das próximas runs) → `/nplus1-check` → `/abuse-audit` → `/ssrf-csrf-sqli-check --full`. Achado real se corrige dentro do pack (red→green).

`--fresh` abandona slices abertas e começa do zero.

---

### [`atlas-docs`](atlas-docs/SKILL.md) · [README da skill](atlas-docs/README.md)

**Documenta** a aplicação de forma deep: levanta **TODOS** os fluxos do sistema (inventário de
entrypoints como régua — rota, consumer, cron, webhook; `nao-mapeado` quebra o build) e gera dashboard
HTML interativo e incremental em `docs/atlas/`. Fluxos end-to-end clicáveis com payload por passo,
diagrama de componentes, arquitetura (C4), contratos, DDL, variáveis de ambiente (uso por fluxo,
segredos, não declaradas), eventos, terceiros, dependências, operação e **Score** (cobertura + Quality Gateway).

| | |
|---|---|
| **Quando** | Onboarding, "como funciona este app?", fim de milestone, atualizar doc após mudanças |
| **Comando** | `/atlas-docs` · `--delta` · `--full` · `--flow <id>` |
| **Pack** | `docs/atlas/` no repo da aplicação (`index.html` + `app-model.json`) |

O layout é sempre o mesmo: o agente só escreve `app-model.json`; `atlas_build.py` valida, apura
cobertura/score por script e injeta no template vanilla. Cada página de fluxo abre com um card
de orientação (`brief`: o que é, o que faz, caminhos felizes e não felizes; fallbacks só se o
código tiver). Runtime sem telemetria aparece tracejado (`NÃO CONECTADO`), segredos viram `****`,
e cada scan novo faz upsert + changelog (`NOVO`/`BREAK`/`DDL`/`DOC`).

---

## Como se relacionam

```
SDD validado  →  /mmh  (implementa; score 10 = pack, não done do repo)
código na branch  →  /ultra-deep-audit --delta  (caça regressão; inclui XSS, rota, limitador, segredo, SQLi, prompt, import)
rota pública / cota  →  /abuse-audit   (fan-out, leitura sem teto, timeout; o limitador em si também está na Moira do ultra-deep)
release  →  /ultra-deep-audit --full
app existe / mudou  →  /atlas-docs  (documenta; incrementa o dashboard a cada scan;
                      quality gates puxem do CI e do pack do ultra-deep-audit)
projeto Swift/ObjC  →  /sonar-swift-local  (SonarQube local; gate consultivo, fora do CI)
```

---

## Convenções

- Uma skill por pasta, sempre com `SKILL.md` (frontmatter `name` + `description` com triggers).
- Alias de invocação (`/mmh`) **não** vira pasta irmã: é o mesmo `SKILL.md`, segundo link no host.
- Skills **nunca** são copiadas para repos de aplicação.
- Skill nova ou alterada passa pelo validador do skill-creator.

## Instalação

```bash
CANON=~/Developer/harness/skills

ln -s $CANON/abuse-audit        ~/.claude/skills/abuse-audit
ln -s $CANON/ultra-deep-audit   ~/.claude/skills/ultra-deep-audit
ln -s $CANON/make-me-happy      ~/.claude/skills/make-me-happy
ln -s $CANON/make-me-happy      ~/.claude/skills/mmh            # alias → a mesma pasta
ln -s $CANON/atlas-docs         ~/.claude/skills/atlas-docs
ln -s $CANON/sonar-swift-local  ~/.claude/skills/sonar-swift-local

# repetir para ~/.agents/skills, ~/.grok/skills, ~/.codex/skills, ~/.config/opencode/skills
```

## Por que o `AGENTS.md` está no `.gitignore`

Convenções e caminhos **locais do harness** (esta máquina). Não versionar neste repo.

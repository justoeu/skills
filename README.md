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
node scripts/check-links.mjs                 # DRIFT (cópia física) · WARN (destino incorreto/quebrado) · INFO (não exposta)
node scripts/check-links.mjs --fix           # troca cópia sem arquivos extras; conserva backup para revisar diferenças
node scripts/check-links.mjs --ensure <skill> # cria os symlinks faltantes em todos os hosts
node --test scripts/tests/*.test.mjs
```

Rode o checker **no fim de toda mudança** — ele pega o drift antes do host
servir skill velha. O reparo conserva a cópia original em `.skill-link-backups/`, fora do root de descoberta, e informa
o caminho; revise diferenças antes de remover qualquer backup. Links quebrados,
para outra skill ou arquivos legados são diagnosticados sem sobrescrita automática.

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

Analisa **Swift e Objective-C** no SonarQube local com plugin. Confirma a análise atual e linhas da linguagem antes de apresentar o gate; ausência de suporte ou falha operacional não recebe aprovação antiga.

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
bugs clássicos). Scripts validam identidade, evidências e quorum, com
pack navegável (`FINDINGS.json` + HTML + TASKS) e correção **test-first**
(falha antes, passa depois, provada por reversão). Predecessora temática do
`ultra-deep-audit`; mantida como entrada mais leve.

| | |
|---|---|
| **Quando** | Detecção ampla de problemas com correção incluída |
| **Comando** | `/deep-audit` · `/deep-audit --full` · `/deep-audit <lente>` |
| **Pack** | `docs/audits/deep-audit/<data>-<modo>-<runId>/` |

Não implementa feature do zero (para isso, `make-me-happy`). Auditoria
multi-agente completa → `ultra-deep-audit`.

### [`ultra-deep-audit`](ultra-deep-audit/SKILL.md) · [README da skill](ultra-deep-audit/README.md)

Bateria **de detecção** depois que código já existe. Lentes em paralelo, validação de evidências por script, pack HTML + TASKS. A análise semântica continua sob responsabilidade dos revisores.

Não implementa feature. Não substitui o `make-me-happy`.

| | |
|---|---|
| **Quando** | Fim de feature (`--delta`), release (`--full`), ou uma lente só (`--only n1`) |
| **Comando** | `/ultra-deep-audit` · `--full` · `--only n1\|dirtycode\|quality\|sentinel\|…` |
| **Pack** | `Docs/audit/ultra-deep/<run_id>/` |

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

O schema 2 vincula achados, revisão, prova e documentação à execução e ao snapshot do código. `sync-progress --done` exige os artefatos de fechamento correspondentes ao modo de validação; merge não apaga pendências. O gate de auditoria verifica cobertura e o de fechamento verifica os desfechos. Packs legados são históricos e precisam de nova execução para obter aprovação atual.

---

### [`make-me-happy`](make-me-happy/SKILL.md) · [README da skill](make-me-happy/README.md)

Implementa feature, refactor ou greenfield. Alias `/mmh`. Sem definição suficiente,
explora o escopo; spec existente também passa pelo setup de arquitetura e regras.
Tarefas usam red-green, caracterização ou checks conforme a mudança. Worktrees têm
identidade por run e recuperação após interrupções; merge testa o resultado integrado
e não descarta alterações locais. Oracle mantém os agregados com controle de versão.

Reviews, hooks, UI aplicável, gates e acompanhamento do projeto compõem o fechamento.
Score numérico não substitui evidências atuais; HTML recalcula e `close` sela o resultado.
`--fresh` cria outra run sem apagar a anterior. Veja flags e schemas no entrypoint.

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

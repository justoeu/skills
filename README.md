# skills

Repositório canônico de skills para coding agents (Claude Code, Grok, Codex, opencode, Cursor, …).
Cada pasta aqui é uma skill autocontida. Este repo é a fonte única da verdade; os agentes
só vêem **links** a partir dos diretórios de skill do usuário.

Não copie estas pastas para dentro de um app (`.claude/skills`, `.agents/skills`, …).

```
skills/
├── abuse-audit/          # superfície de abuso (cota, DoS de aplicação)
├── ultra-deep-audit/     # auditoria multi-agente + pack HTML
├── make-me-happy/        # implementa SDD; alias de invocação /mmh
├── AGENTS.md             # gitignored — convenções locais da máquina
└── README.md
```

`/mmh` **não** é uma skill irmã. É o mesmo `make-me-happy`; na instalação o host ganha um segundo link com o nome `mmh` apontando para essa pasta.

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

### [`ultra-deep-audit`](ultra-deep-audit/SKILL.md) · [README da skill](ultra-deep-audit/README.md)

Bateria **de detecção** depois que código já existe. 14 lentes em paralelo, apuração por script (não pelo modelo), pack HTML + TASKS.

Não implementa feature. Não substitui o `make-me-happy`.

| | |
|---|---|
| **Quando** | Fim de feature (`--delta`), release (`--full`), ou uma lente só (`--only n1`) |
| **Comando** | `/ultra-deep-audit` · `--full` · `--only n1\|dirtycode\|quality\|sentinel\|…` |
| **Pack** | `docs/audits/ultra-deep-audit/<data>-<modo>/` |

**Agentes (o que cada um caça)**

| Agente | Termo `--only` | Caça |
|--------|----------------|------|
| Atlas | `arch` | seta ilegal entre camadas |
| Sentinel | `sec` `security` | exploit / IDOR / injection; deep = panel 3 votos |
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

**Implementa** um SDD/spec já validado. Alias: **`/mmh`**.

| | |
|---|---|
| **Quando** | Spec pronto; greenfield, feature ou refactor |
| **Comando** | `/make-me-happy` · `/mmh` · `--worktree N` · `--into feature/<name>` · `--loop full\|task` · `--spec PATH` · `--fresh` |
| **Pack** | `docs/impl/make-me-happy/<data>-<branch>/` |

O que a run faz:

1. Resume se a sessão anterior crashou (pack aberto ou worktree `mmh/slice-*`).
2. Planner → `TASKS.json` (qtd de testes por task).
3. Git worktrees (default **3**, `--worktree N`) numa **feature branch** (`--into`; recusa merge em `main`; recusa baseline vermelha).
4. Testes de imutabilidade (contrato que não pode andar).
5. Review em 3 eixos paralelos, consenso 3/3: **Standards** (Fowler + repo) · **Spec** · **Correctness**. Score 10 fecha o pack — **não** substitui o trio/docs/i18n do `CLAUDE.md` do app.
6. HTML interativo. `.gitignore` + `.worktrees/` se ainda não existia: alteração visível no PR.

`--fresh` abandona slices abertas e começa do zero.

---

## Como se relacionam

```
SDD validado  →  /mmh  (implementa; score 10 = pack, não done do repo)
código na branch  →  /ultra-deep-audit --delta  (caça regressão)
rota pública / cota  →  /abuse-audit
release  →  /ultra-deep-audit --full
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

# repetir para ~/.agents/skills, ~/.grok/skills, ~/.codex/skills, ~/.config/opencode/skills
```

## Por que o `AGENTS.md` está no `.gitignore`

Convenções e caminhos **locais do harness** (esta máquina). Não versionar neste repo.

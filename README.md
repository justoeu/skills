# skills

Repositório canônico de skills para agentes (Claude Code, opencode, Codex, etc.).
Cada pasta aqui é uma skill autocontida, versionada e distribuída por links a
partir dos diretórios de skill do usuário — este repo é a fonte única da verdade.

## Estrutura

```
skills/
├── <skill-name>/
│   ├── SKILL.md          # obrigatório: frontmatter (name, description) + instruções
│   ├── agents/           # opcional: subagentes especializados
│   ├── scripts/          # opcional: scripts de apoio
│   ├── references/       # opcional: documentação de referência
│   └── assets/           # opcional: templates e outros recursos
├── AGENTS.md             # ignora­do (ver abaixo) — convenções locais do harness
└── README.md
```

## Skills deste repo

| skill | o que faz | quando usar |
|---|---|---|
| [`abuse-audit`](abuse-audit/SKILL.md) | Encontra superfície de abuso em rotas: trabalho sem teto, escrita pública sem cota, chave de rate limit controlada pelo cliente, fan-out e leitura sem limite, limitador que vaza memória. | Rate limiting, DoS, exaustão de recursos, força bruta, 429, "esta rota está protegida?" |

## Convenções

- Uma skill por pasta, sempre com `SKILL.md` na raiz da pasta.
- O `SKILL.md` começa com frontmatter YAML com `name` e `description` — a
  descrição é o que o agente usa para decidir quando invocar a skill, então
  ela precisa listar triggers concretos.
- Skills nunca são copiadas para dentro de repos de aplicação
  (`.claude/skills`, `.agents/skills`, `.codex/skills`). A exposição para os
  agentes é feita com **links** a partir dos diretórios de skill do usuário
  (`~/.claude/skills`, `~/.agents/skills`, `~/.config/opencode/skills`, ...),
  apontando de volta para este repo.
- Toda skill nova ou alterada passa pelo validador do skill-creator antes de
  ser considerada pronta.

## Instalação (expor uma skill ao agente)

```bash
ln -s ~/Developer/harness/skills/<skill-name> ~/.claude/skills/<skill-name>
# ou, para opencode:
ln -s ~/Developer/harness/skills/<skill-name> ~/.config/opencode/skills/<skill-name>
```

## Por que o `AGENTS.md` está no `.gitignore`

O `AGENTS.md` deste diretório contém convenções e caminhos **locais do
harness** (máquina do usuário) e não deve ser versionado neste repo.

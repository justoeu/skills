# atlas-docs

Documentação interativa e incremental de aplicações: lê o código, entende os fluxos
end-to-end e devolve um dashboard HTML navegável — com payload por passo clicável,
**diagrama de classes por fluxo** (qual classe, qual método e o que é chamado),
**página C4 com os níveis C1 (contexto) e C2 (containers)**, diagrama de componentes,
arquitetura, contratos de API, DDL, **variáveis de
ambiente** (o que é, quando e em qual fluxo entra, segredos e não declaradas),
eventos & filas, terceiros, dependências, operação e Score (cobertura + Quality Gateway).

Trigger: `/atlas-docs` · `/atlas-docs --delta` · `/atlas-docs --full` · `/atlas-docs --flow <id>`

## Como funciona

```
código da app  →  agente extrai (semântica)  →  app-model.json
                                              →  atlas_merge.py   (incremental + changelog)
                                              →  atlas_build.py   (valida · apura score · injeta)
                                              →  docs/atlas/index.html  (sempre o mesmo layout)
```

- **O HTML nunca é editado à mão.** Todo conteúdo vive no `app-model.json`; o
  `assets/template.html` (vanilla JS, sem dependências, abre via `file://`) recebe o
  JSON numa ilha `<script id="atlas-data">`. Layout idêntico em qualquer app, stack
  ou LLM.
- **Apuração por código, não pelo modelo.** Cobertura por fluxo, score geral
  (fluxos 45% · modelo & contratos 20% · env 10% · quality gates 25%; bucket
  ausente renormaliza) e delta entre scans são calculados por script.
- **Deep por contrato, não por preferência.** O scan levanta **TODOS** os fluxos
  do sistema: o inventário de `entrypoints` (toda rota, consumer, cron, webhook,
  worker, CLI) é a régua de fechamento — cada item termina `mapeado` num fluxo ou
  `trivial` com justificativa; `nao-mapeado` **quebra o build**. O card
  "Inventário de entrypoints" no dashboard deixa a prova visível.
- **Provenância honesta.** Borda cheia = derivado do código; tracejada = exigiria
  fonte externa (telemetria). Número de runtime sem fonte aparece como `—`, nunca
  inventado. Segredos viram `****` (na extração e de novo no build, por regex).
- **Diagrama de classes por fluxo, apurado pelo template.** Cada fluxo declara
  `flows[].classes` (classes por estereótipo, métodos acionados naquele fluxo e
  `methods[].calls` no formato `Classe.metodo`); o dashboard desenha as caixas UML
  e as arestas sozinho. Chamada apontando para classe fora do diagrama vira aviso
  no build — nada de seta órfã.
- **Página C4 com C1 e C2 clicáveis.** `c4.context` desenha o mapa de contexto
  (atores → este sistema → sistemas externos, com o hub de id reservado `system`);
  `c4.containers` desenha os containers por grupo (borda/domínio/dados/externos)
  com as chamadas entre eles. Edges e calls apontando id inexistente quebram o
  build; sem `c4`, a página mostra a lacuna.
- **Incremental de verdade.** Upsert por chave natural (`flows.id`,
  `endpoints.m+path`, `c4.containers.id`, …), `history.scans`/`coverage`/`changelog` só crescem,
  changelog com tags `NOVO`/`BREAK`/`DDL`/`DOC`.

## Estrutura

```
atlas-docs/
├── SKILL.md               # workflow completo + schema do app-model (flows[].classes, c4, brief)
├── assets/template.html   # dashboard (sidebar · 13 páginas · card de brief · diagrama de classes · C4 · inspetor · SVG)
└── scripts/
    ├── atlas_merge.py     # merge delta|full + changelog + registro de scan (inclui listas de c4)
    ├── atlas_build.py     # valida · apura cobertura/score · mascara · injeta no template
    └── tests/
        ├── brief-card.test.mjs
        └── classes-c4.test.mjs
```

`node --test scripts/tests/brief-card.test.mjs scripts/tests/classes-c4.test.mjs` cobre o
card do topo (o que é, o que faz, caminhos felizes/não felizes, fallback só quando existe)
e as novidades: diagrama de classes por fluxo (arestas derivadas de `methods[].calls`,
detalhe do método selecionado) e a página C4 (grafo de contexto com hub `system`,
containers por grupo, build quebrando com edge/call inválida e merge incremental de `c4`).

## Páginas do dashboard

Know-how (com inventário de entrypoints — a régua de exaustividade) · Fluxos &
diagramas (card de orientação no topo — o que é, o que faz, caminhos felizes/não
felizes e fallbacks — depois diagrama rico clicável, **diagrama de classes do fluxo**
e fluxos em cadeia com payload por passo) · Arquitetura (containers C4, libs,
compose, ADRs, transversais) · **C4 (C1 contexto: atores, este sistema e sistemas
externos; C2 containers: por grupo, com chamadas entre eles e link para os fluxos)**
· Contratos de API · Modelo de dados & DDL · Variáveis de ambiente
(com filtro, badges SEGREDO/OBRIGATÓRIA/NÃO DECLARADA e link para o fluxo onde
entra) · Eventos & filas · Terceiros · Dependências · Operação & alertas ·
Score & Quality Gateway · Histórico de varreduras.

O inspetor lateral (página Fluxos) mostra por nó: Payload · Contrato · DDL ·
Código — mais o changelog incremental e o card "Arquitetura detectada".

## Integrações

- **Quality Gateway**: leia o CI do repo e o pack mais recente do
  `ultra-deep-audit` (`Docs/audit/ultra-deep/`) para preencher `quality.gates` e
  `quality.findings`.
- Sem CI/auditoria no repo → a lacuna aparece como `NÃO CONECTADO` e não derruba
  o score.

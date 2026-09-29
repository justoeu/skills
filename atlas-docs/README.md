# atlas-docs

Documentação interativa e incremental de aplicações: lê o código, entende os fluxos
end-to-end e devolve um dashboard HTML navegável — com payload por passo clicável,
diagrama de componentes, arquitetura (C4), contratos de API, DDL, **variáveis de
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
- **Incremental de verdade.** Upsert por chave natural (`flows.id`,
  `endpoints.m+path`, …), `history.scans`/`coverage`/`changelog` só crescem,
  changelog com tags `NOVO`/`BREAK`/`DDL`/`DOC`.

## Estrutura

```
atlas-docs/
├── SKILL.md               # workflow completo + schema do app-model (inclui flows[].brief)
├── assets/template.html   # dashboard (sidebar · 11 páginas · card de brief · inspetor · SVG)
└── scripts/
    ├── atlas_merge.py     # merge delta|full + changelog + registro de scan
    ├── atlas_build.py     # valida · apura cobertura/score · mascara · injeta no template
    └── tests/
        └── brief-card.test.mjs
```

`node --test scripts/tests/brief-card.test.mjs` cobre o card do topo: o que é, o que faz,
caminhos felizes/não felizes, fallback só quando existe, e o aviso de brief incompleto.

## Páginas do dashboard

Know-how (com inventário de entrypoints — a régua de exaustividade) · Fluxos &
diagramas (card de orientação no topo — o que é, o que faz, caminhos felizes/não
felizes e fallbacks — depois diagrama rico clicável + fluxos em cadeia com
payload por passo) · Arquitetura (containers C4, libs, compose, ADRs,
transversais) · Contratos de API · Modelo de dados & DDL · Variáveis de ambiente
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

---
name: atlas-docs
description: "Gera documentação interativa ultra completa e DEEP da aplicação: lê o código, levanta TODOS os fluxos do sistema (inventário de entrypoints como régua — rota, consumer, cron, webhook, worker), mapeia cada um end-to-end clicável com payload por passo, diagrama de componentes, arquitetura (C4), contratos de API, DDL das tabelas, variáveis de ambiente (o que é, quando e em qual fluxo é usada), eventos & filas, terceiros, dependências, operação e Score (cobertura + Quality Gateway). Produz dashboard HTML navegável em docs/atlas/ e é incremental a cada scan. Use quando o pedido for 'documenta este app', 'gera dashboard/documentação interativa', 'atlas', 'doc interativa', 'atualiza a documentação', 'quais são os fluxos desta aplicação', 'como funciona este serviço', 'quais env vars esta app usa'."
---

# /atlas-docs

Lê o código da aplicação, entende o que ela faz e devolve **um dashboard HTML interativo** — o **Atlas Docs** — em `docs/atlas/index.html`, com fluxos clicáveis passo a passo, payload de cada hop, diagrama de componentes, arquitetura, contratos, DDL, variáveis de ambiente, eventos, terceiros, operação e score.

É **incremental**: cada novo scan faz merge com o modelo anterior, preserva o histórico de varreduras e registra o changelog (`NOVO` / `BREAK` / `DDL` / `DOC`).

| | |
|---|---|
| **Comando** | `/atlas-docs` · `/atlas-docs --delta` · `/atlas-docs --full` · `/atlas-docs --flow <id>` |
| **Pack** | `docs/atlas/` no repo da aplicação (`index.html` + `app-model.json`) |
| **Custo** | 1º scan varre tudo; `--delta` varre só o que mudou desde o último commit registrado |
| **Stack** | agnóstica — a extração é semântica (você), a apuração é por script |

---

## As cinco regras de ouro

1. **O HTML nunca é editado à mão.** Você só escreve `app-model.json`; `atlas_build.py` injeta no template. Assim o layout é sempre o mesmo padrão em qualquer app e qualquer LLM.
2. **Borda cheia = derivado do código. Borda tracejada = exige fonte externa.** Todo dado de runtime (linhas de tabela, lag, latência, volume) só entra com fonte real declarada (telemetria, dump, painel). Sem fonte → campo com `prov: "external"`, valor `—` e badge `NÃO CONECTADO`. **Nunca invente número de runtime.**
3. **Payload é exemplo derivado do código** (schemas, serializers, DTOs, fixtures), não tráfego capturado. O dashboard diz isso no próprio rodapé da aba. Se existir fixture/log de exemplo real, use e cite a fonte em `src`.
4. **Segredo vira `****` antes de entrar no JSON.** URL com credencial, password de compose, token de header, chave privada. O build roda um segundo mascaramento por regex, mas o primeiro é seu.
5. **Histórico nunca é apagado.** Scan novo faz upsert no modelo; `history.scans`, `history.coverage` e `history.changelog` só crescem (prepend).

---

## Exaustividade — TODOS os fluxos, sempre

A documentação é **deep por definição**. O scan não fecha enquanto existir jornada da aplicação sem fluxo documentado. Isto não é preferência de estilo: é o produto.

1. **Inventário antes da narração.** Antes de escrever qualquer fluxo, liste TODA a superfície de entrada da aplicação: cada rota HTTP, cada consumer de tópico/fila, cada cron/scheduled job, cada webhook de entrada, cada worker, listener e CLI de backfill. O inventário vira `entrypoints` no modelo — é a régua de fechamento do scan.
2. **Cada entrypoint termina `mapeado` ou `trivial`.** `mapeado` = vira fluxo (com `flow` apontando o id). `trivial` = não é jornada (healthcheck, readiness, leitura mecânica sem regra de negócio) — mas exige `note` dizendo por quê. `nao-mapeado` = **o build falha**: o scan não está pronto e você volta a extrair.
3. **Agrupar é permitido, omitir não.** O CRUD do mesmo recurso pode ser um fluxo; várias rotas de leitura do mesmo aggregate podem compartilhar um fluxo de consulta. O que não pode é jornada de negócio (muda estado, move dinheiro, dispara evento, fala com terceiro, exporta arquivo) ficar fora.
4. **Fluxo vai até o fim.** Documentado pela metade é pior que ausente: siga até a persistência, a chamada externa ou o evento final — **inclusive a continuação assíncrona**. Se um fluxo HTTP termina num evento, o consumer desse evento é parte da história: entra como passo, ou vira fluxo irmão apontado no inventário.
5. **Apps grandes:** mais fluxos, mesma profundidade. Se a superfície tem 30 entrypoints, o dashboard tem ~15–30 fluxos — todos com payload, `src` e erros. Nunca "os 5 principais".
6. **Verificação final é por script.** `atlas_build.py` apura o inventário e imprime `entrypoints: N mapeados · M triviais`; `nao-mapeado` quebra o build. O card "Inventário de entrypoints" no dashboard deixa a prova visível para quem lê.

---

## Pipeline

```
Fase 0  retomada     docs/atlas/app-model.json existe? → incremental; senão → primeiro scan
Fase 1  recon        detecta stack, entrypoints, manifests, conta arquivos
Fase 2  extração     você lê o código e produz scan-model.json (semântica é sua)
Fase 3  merge        atlas_merge.py (incremental) ou primeiro scan vira base
Fase 4  build        atlas_build.py valida, apura cobertura/score e escreve index.html
Fase 5  entrega      resumo curto: score, o que mudou, caminho do pack
```

Scripts vivem na pasta da skill. Exemplos (ajuste os caminhos ao host):

```bash
python3 ~/.claude/skills/atlas-docs/scripts/atlas_merge.py \
  docs/atlas/app-model.json /tmp/scan.json \
  --mode delta --commit "$(git rev-parse --short HEAD)" \
  --when "$(date '+%d/%m %H:%M')" --title "resumo curto da varredura" \
  -o docs/atlas/app-model.json

python3 ~/.claude/skills/atlas-docs/scripts/atlas_build.py \
  docs/atlas/app-model.json \
  --template ~/.claude/skills/atlas-docs/assets/template.html \
  -o docs/atlas/index.html
```

Sem Python no host? Os dois scripts são opcionais: o merge pode ser feito por você seguindo as regras da seção *Merge incremental*, e o build é substituído por copiar o `template.html` e colar o JSON no lugar do marcador `@@ATLAS_DATA@@` dentro de `<script id="atlas-data">`. Documente no pack que fez manual.

---

## Fase 1 — Recon (o que procurar, qualquer stack)

| alvo | onde olhar |
|---|---|
| linguagem/runtime | `go.mod`, `package.json`, `pyproject.toml`/`requirements.txt`, `build.gradle*`, `pom.xml`, `Cargo.toml`, `composer.json`, `Gemfile`, `mix.exs`, `*.csproj` |
| entrypoints HTTP | rotas: `chi/gin/echo` (Go), `express/next/nest/fastify` (JS), `flask/fastapi/django` (PY), `spring` (annotations), `rails` (routes.rb), handlers/c controllers |
| entrypoints async | consumers Kafka/Rabbit/SQS/NATS, `@KafkaListener`, `consumer.go`, workers, cron (`cron.yaml`, `@Scheduled`, `sidekiq`) |
| webhooks de entrada | rotas POST públicas com validação de assinatura |
| persistência | migrações (`db/migrate`, `migrations/`, flyway, alembic, prisma), ORM models, schema.sql |
| clientes externos | `http.Client`/`fetch`/`axios`/`requests`/`RestTemplate`, gRPC stubs, SDKs (S3, SES, Stripe) |
| config/ambientes | `.env.example`, `config/*.yaml`, `values.yaml`, ConfigMap, `Dockerfile ENV`, blocos `environment:` do compose |
| variáveis lidas no código | `os.Getenv` (Go) · `process.env.X` (JS/TS) · `os.getenv`/`os.environ` (PY) · `ENV[...]`/`ENV.fetch` (Ruby) · `System.getenv` (Java) · `std::env::var` (Rust) |
| qualidade | CI (`.github/workflows`), test runner, `Docs/audit/ultra-deep/` (pack mais recente) |
| documentos | `README*`, `docs/adr/`, postmortems, `CODEOWNERS`, runbooks |

`--delta`: liste os arquivos tocados desde `app.commitPrev` (`git diff --name-only $PREV..HEAD`) e restrinja a extração ao que toca os fluxos afetados.

---

## Fase 2 — Extração (o modelo)

Produza um `scan-model.json` seguindo o schema abaixo. Campos ausentes são normais — o dashboard esconde o que não existe; **não preencha com invenção**.

### Estrutura

```jsonc
{
  "schema": "atlas-docs/1",
  "app": { "name", "repo", "branch", "commit", "generatedAt", "generator",
           "filesCount", "stackSummary", "syncNote" },
  // identity → página Know-how
  "identity": {
    "what": "2–3 frases: o que entra, o que a app faz com isso, o que sai, e qual é a fonte da verdade dela",
    "firstRead": "o que quem nunca viu este código precisa saber antes de mexer",
    "stats":  [ { "k": "SUPERFÍCIE", "v": "14 rotas", "sub": "6 serviços · 3 tópicos", "prov": "code" } ],
    "keyPoints": [ { "n": "01", "title", "body", "src": "arquivo.go:120" } ],
    "risks":     [ { "sev": "CRÍTICO|ALTO|MÉDIO|BAIXO", "title", "body", "fix", "where" } ],
    "incidents": [ { "id": "INC-...", "when", "title", "body", "lesson" } ]   // só se existir registro real
  },
  // architecture → página Arquitetura + card "Arquitetura detectada"
  "architecture": {
    "style": "ex: Saga orquestrada + CQRS na leitura", "consistency": "…", "idempotency": "…",
    "risks": [ { "k": "Risco", "v": "…" } ],
    "containers": [ { "group": "borda|dominio|dados|externos", "name", "sub", "prov": "code" } ],
    "libs":  [ { "group": "Runtime · Go 1.23 (go.mod)",
                 "items": [ { "name", "ver", "use", "note", "state": "ok|warn|bad" } ] } ],
    "compose": [ { "name", "file", "sub", "yaml": "…segredos já mascarados…" } ],
    "adrs":  [ { "id": "ADR-012", "title", "body", "status" } ],
    "cross": [ { "k": "AUTENTICAÇÃO", "body": "…" } ]     // gap: true → card vermelho
  },
  // flows → página Fluxos; o 1º flow COM "diagram" vira o diagrama rico clicável
  "flows": [ {
    "id": "imediata", "label": "Cobrança imediata · cartão", "title": "…", "tag": "…",
    "cov": 98,                       // opcional: o build apura se ausente
    "resumo": "…", "stats": [ { "k": "PASSOS", "v": "5 · compensável" } ],
    "brief": {                       // card do topo da página do fluxo
      "what": "o que é: gatilho, o que entra, o que sai — 2–3 frases",
      "does": "o que o código faz neste fluxo (orquestra, persiste, emite)",
      "happy":     [ { "when": "cartão autorizado no PSP", "then": "grava charge authorized e publica billing.charge.authorized", "src": "internal/charge/authorize.go:88" } ],
      "unhappy":   [ { "when": "PSP timeout 4s", "then": "compensa reserva, responde 504, não publica evento", "src": "internal/charge/authorize.go:121" } ],
      "fallbacks": [ { "when": "PSP indisponível", "then": "retry 3× com backoff → DLQ billing.charge.dlq" } ]
    },                               // fallbacks só se o código tiver; omitir o array se não houver
    "diagram": {
      "width": 1120, "height": 560,
      "nodes": [ { "id": "n1", "label": "checkout-web", "sub": "cliente · React 18",
                   "kind": "own|internal|store|client", "x": 20, "y": 247, "w": 170, "h": 66,
                   "insp": { "kind", "tech", "owner", "slo", "desc", "src",
                             "reqPayload": "…", "resPayload": "…",
                             "facts": [ { "k", "v" } ], "errors": [ { "code", "msg" } ],
                             "ddl": "CREATE TABLE …", "code": [ { "file", "what" } ] } } ],
      "edges": [ { "from": "n1", "to": "n2", "label": "POST /v1/charges", "path": "M …" } ]
    },                                 // path é opcional: sem ele, âncora automática
    "seq": [ { "name": "…", "note": "…", "mode": "bloqueante|fail-open|compensável|transacional|assíncrono",
               "kind": "block|warn|info|ok" } ],
    "steps": [ {
      "name": "serviço · ação", "tech": "Go · Temporal", "desc": "…", "src": "arquivo.go:58",
      "mode": "síncrono|assíncrono|manual",                    // opcional, inferido de tech se ausente
      "payload": "{ …exemplo derivado do código… }",
      "does": "o que este passo faz de fato",
      "calls":   [ { "sig": "PSP.Authorize(ctx, AuthRequest) …", "file": "internal/psp/authorize.go:58", "what": "…" } ],
      "touches": [ "charges (INSERT)", "redis: lock idempotência" ],
      "guards":  [ "chave de idempotência obrigatória" ],
      "errs":    [ { "code": "PSP_TIMEOUT", "msg": "…" } ]
    } ],
    "notes": [ { "tag": "FALHA|ATENÇÃO|NOTA", "body": "…" } ]
  } ],
  // entrypoints → régua de fechamento (card no Know-how; build FALHA com nao-mapeado)
  "entrypoints": [
    { "kind": "http|consumer|cron|webhook|cli|listener", "ref": "POST /v1/charges",
      "status": "mapeado", "flow": "imediata" },
    { "kind": "http", "ref": "GET /healthz", "status": "trivial",
      "note": "probe de liveness, sem regra de negócio" }
  ],
  // contracts → página Contratos
  "contracts": {
    "source": "openapi.yaml · a91f3c7",
    "endpoints": [ { "m": "POST", "path": "/v1/charges", "ver": "v1.4", "consumers": "…",
                     "state": "estavel|breaking|deprecado|interno" } ],
    "schemas": [ { "title": "POST /v1/charges · esquema", "reqPre": "campo  tipo  regra…",
                   "resPre": "…", "compat": [ { "tag": "BREAK|ADITIVO", "body": "…" } ] } ]
  },
  // data → página Modelo de dados
  "data": {
    "engine": "Postgres 16 · 11 tabelas · 47 migrações",
    "model": [ { "name": "charges", "hl": true, "lines": [ "PK id · text", "FK customer_id",
               "UQ idempotency_key", "amount_value · bigint" ] } ],
    "tables": [ { "name": "charges", "rows": "48,2 M", "size": "31 GB", "wps": "210",
                  "keep": "indefinida", "prov": "external" } ],   // prov external sem fonte → "—"
    "ddl": { "file": "0047_add_psp_ref.sql", "sql": "BEGIN; …", "meta": [ "reversível" ] }
  },
  // env → página Variáveis de ambiente
  "env": {
    "sources": [".env.example", "docker-compose.yml"],       // de onde as declarações vieram
    "vars": [ {
      "name": "PSP_API_KEY", "value": "****",                 // só exemplo/mascarado; build força **** se name denunciar credencial
      "desc": "o que é, para que serve",
      "required": true,                                       // true | false | omitido se não souber
      "scope": "produção",                                    // produção | local | todos
      "secret": true,                                         // badge SEGREDO
      "default": "",
      "flows": ["imediata"],                                  // em quais fluxos entra (ids de flows)
      "used": ["internal/psp/authorize.go:58"],               // onde é LIDA no código
      "sources": [".env.example:12", "docker-compose.yml"]    // onde é DECLARADA; lida sem sources → badge NÃO DECLARADA
    } ]
  },
  // events → página Eventos & filas
  "events": {
    "engine": "Kafka 3.7",
    "topics": [ { "topic": "billing.charge.authorized", "parts": 3, "group": "webhook-dispatcher",
                  "lag": "12", "lagKind": "ok|warn|bad", "dlq": "0 msg", "prov": "code|external" } ],
    "catalog": [ { "name": "charge.authorized · v3", "schema": "{ … }", "desc": "…" } ],
    "guarantees": [ { "k": "ENTREGA", "v": "ao menos uma vez" } ]
  },
  // thirdParty → página Terceiros
  "thirdParty": [ { "name", "kind": "REST · saída", "prod": "https://…",
    "does": "…", "urls": [ { "env": "produção", "url": "…" } ],
    "auth": "header X-API-Key: ****\nenv PSP_API_KEY (Vault)",
    "limits": "timeout 4s · 3 tentativas", "used": [ "internal/psp/authorize.go" ],
    "sends": "quais dados trafegam", "risk": "…",
    "riskTag": "FALHA|ATENÇÃO|NOTA", "crit": "critica|alta|baixa" } ],
  // deps → página Dependências
  "deps": [ { "name", "desc", "addr", "kind": "interna · HTTP", "sla": "timeout 300ms",
    "crit": "critica|alta|baixa",
    "endpoints": [ { "m": "POST", "path": "/oauth2/introspect", "what": "…" } ],
    "req": "POST …\n{ … }", "res": "{ … }", "errs": [ { "code", "msg" } ],
    "limits": "…", "fallback": "…", "used": [ "arquivo.go:77" ] } ],
  // ops → página Operação
  "ops": {
    "slos": [ { "name", "target": "99,9% / 30d", "file": "infra/slo/…", "state": "ok|bad", "stateLabel": "alerta declarado" } ],
    "runbooks": [ { "title": "…", "file": "docs/runbooks/….md",
                    "steps": [ { "n": "01", "title": "…", "cmd": "SELECT …" } ] } ],
    "owners": [ { "area", "who", "file": "CODEOWNERS:3" } ]
  },
  // quality → página Score (Quality Gateway)
  "quality": {
    "gates":    [ { "name": "testes", "status": "pass|warn|fail", "detail": "214 ok · 3 flaky", "source": "CI · npm test" } ],
    "tests":    { "framework": "pytest", "coveragePct": 82, "source": "cobertura CI" },
    "findings": [ { "sev": "CRÍTICO|ALTO|MÉDIO|BAIXO", "title", "where", "source": "ultra-deep-audit 14/09" } ]
  },
  // history → sidebar + página Histórico + card incremental (merge cuida disto)
  "history": {
    "coverage": [ { "day": "14/09", "v": 98 } ],
    "scans":    [ { "commit": "a91f3c7", "when": "14/09 09:41", "title": "…", "detail": "…",
                    "delta": "+7%", "deltaKind": "ok|bad" } ],
    "changelog": [ { "tag": "NOVO|BREAK|DDL|DOC", "body": "…" } ]
  }
}
```

### Quanto extrair

- **Fluxos: TODOS** (ver *Exaustividade* acima). Cada fluxo = uma jornada end-to-end real (uma rota, um consumer, um cron, um webhook), do entrypoint até a persistência/evento/terceiro final. O inventário de `entrypoints` é a prova de que nenhum ficou de fora — agrupar correlatos é permitido, omitir jornada não.
- **Brief do fluxo (card do topo).** Todo fluxo leva `brief.what`, `brief.does`, `brief.happy` e `brief.unhappy`. `fallbacks` só entra se o código tiver (retry, DLQ, fail-open, stub, cache stale, compensação). Caminho feliz/não feliz é o *desfecho da jornada*, não a lista de `steps[].errs`. Sem fallback no código → omita o array. Item: `{ when, then, src? }` ou string. Sem `brief.what`, o card cai em `resumo`.
- **Passos: tudo que muda de contexto** (HTTP entre serviços, fila, arquivo, job). Chamada interna no mesmo processo é um passo só.
- **Payload: o exemplo que o código produziria** — monte a partir do schema de validação, DTO, proto, serializer, fixture. Campos reais, tipos reais, tamanhes reais.
- **`src` sempre `arquivo:linha`.** É o que torna o dashboard auditável.
- **Variáveis de ambiente: cruze as duas listas.** Toda var **declarada** (.env.example, compose, values, Dockerfile) e toda var **lida** no código (`os.Getenv`, `process.env`, `os.getenv`, `ENV[`, `System.getenv`, `std::env::var`). O cruzamento é o achado: lida e não declarada → fica sem `sources` e ganha badge **NÃO DECLARADA** no dashboard (drift que o deploy sente). Declare para cada var: o que faz, `required`, `secret` (nome de credencial = segredo, o build mascara o `value` de qualquer forma), e em quais `flows` ela entra. Valor só como exemplo não-sensível (`"8080"`, `"postgres://…"` sem credencial) — valor real nunca.

---

## Score (apuração por script, não por você)

`atlas_build.py` apura e sobrescreve `score`:

| componente | peso | fórmula |
|---|---|---|
| cobertura dos fluxos | 45% | por passo: payload 25 · src 20 · calls 15 · errs 15 · does 15 · touches 10 (cap 100); média por fluxo, média entre fluxos |
| modelo & contratos | 20% | tabelas no modelo 40 · DDL presente 30 · endpoints 30 |
| variáveis de ambiente | 10% | % de vars com `desc` **e** (`flows` ou `used`) preenchidos |
| quality gates | 25% | pass 100 · warn 60 · fail 0 (média) |

**Bucket ausente → excluído do peso e os demais renormalizam.** Gates ou env ausentes **não** derrubam o score — ficam visíveis como lacuna (`NÃO CONECTADO`).

Grade: `A ≥ 90` · `B ≥ 75` · `C ≥ 60` · `D ≥ 40` · `F < 40`.

### Quality Gateway — de onde puxar

1. CI do repo (`.github/workflows`): resultado declarado dos jobs de test/lint/typecheck.
2. Pack do `ultra-deep-audit` mais recente em `Docs/audit/ultra-deep/` → `findings` por severidade e score.
3. Cobertura de testes do relatório do runner, se existir no repo.
4. Nada disso existe → `quality` fica vazio; o dashboard mostra a lacuna honestamente.

---

## Merge incremental

`atlas_merge.py` (ou você, manualmente, seguindo as mesmas regras):

- **Listas com chave natural** fazem upsert: `flows` por `id` · `contracts.endpoints` por `m+path` · `thirdParty`/`deps` por `name` · `data.model`/`data.tables`/`env.vars` por `name` · `events.topics` por `topic+group` · `architecture.libs[].items` por `name` · `adrs` por `id` · `ops.*` por `name`/`area`.
- **Modo `--mode delta`**: itens não mencionados no scan permanecem (você só extraiu o que mudou). **`--mode full`**: a lista nova substitui a antiga inteira.
- **Seções escalares** (`identity`, `architecture` menos listas, `data.engine`, …): campo presente no scan ganha; ausente mantém o antigo.
- **Sempre**: `app.commitPrev` = commit anterior · nova entrada no topo de `history.scans` com `delta` = score novo − anterior · `history.coverage` ganha o ponto de hoje · changelog do scan (`__changelog` no scan-model) vai para o topo de `history.changelog`.
- **Changelog é semântico e é seu**: compare o modelo antigo com o novo e escreva as entradas — `NOVO` (nó/fluxo/rota detectado), `BREAK` (contrato mudou de forma incompatível), `DDL` (migração nova), `DOC` (ganho/perda de cobertura, dono ausente). Sem entradas reais, changelog vazio — não fabririque.

---

## Fase 5 — Entrega

Resumo curto na conversa (não o HTML):

```
docs/atlas/index.html · score 86 (B) · +2 fluxos · 1 BREAK em POST /v1/charges
cobertura 71% → 86% · 6 gates: 4 pass · 1 warn · 1 fail
```

Abra o dashboard se o host permitir. O pack (`index.html` + `app-model.json`) entra no repo da aplicação — é artefato versionado do app, não da skill.

---

## O que esta skill NÃO faz

- **Não executa a aplicação** nem finge telemetria: runtime sem fonte aparece tracejado, com `—`.
- **Não edita código do app.** Se a leitura revelar bugs, eles viram `identity.risks` / `quality.findings` — o fix é com `/ultra-deep-audit` + `/mmh`.
- **Não substitui ADR/README do repo.** O Atlas descreve o código *como está*; decisão arquitetural documentada continua no lugar dela.
- **Não gera o mesmo HTML duas vezes à mão.** Toda regeneração passa pelo build a partir do `app-model.json`.

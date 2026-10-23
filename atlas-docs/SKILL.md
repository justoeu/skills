---
name: atlas-docs
description: "Gera e atualiza documentação interativa de aplicações a partir do código: inventário de entrypoints, fluxos completos, classes, C4, contratos, dados, configuração e proveniência. Produz um pack HTML/JSON incremental em docs/atlas/. Use para documentar uma aplicação, explicar suas jornadas ou atualizar seu Atlas existente."
metadata:
  version: 2.0.0
---

# /atlas-docs

Lê o código da aplicação, entende o que ela faz e devolve **um dashboard HTML interativo** — o **Atlas Docs** — em `docs/atlas/index.html`, com fluxos clicáveis passo a passo, payload de cada hop, **diagrama de classes por fluxo** (classe · método · chamadas), **página C4** com C1 Contexto e C2 Containers, diagrama de componentes, arquitetura, contratos, DDL, variáveis de ambiente, eventos, terceiros, operação e score.

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
2. **Borda cheia = derivado do código. Borda tracejada = exige fonte externa.** Todo dado de runtime (linhas de tabela, lag, latência, volume) só entra com fonte real declarada (telemetria, dump, painel). Declare `source: {ref, observedAt}` com referência ao artefato/painel consultado e timestamp ISO 8601 com fuso da observação. Sem essa fonte → `prov: "external"`, valor `—` e badge `NÃO CONECTADO`. O build remove valores sem fonte dos campos runtime conhecidos; fonte declarada aparece como `FONTE DECLARADA`, nunca como dado derivado do código. **Nunca invente número de runtime.**
3. **Payload é exemplo derivado do código** (schemas, serializers, DTOs, fixtures), não tráfego capturado. O dashboard diz isso no próprio rodapé da aba. Se existir fixture/log de exemplo real, use e cite a fonte em `src`.
4. **Segredo vira `****` antes de entrar no JSON.** URL com credencial, password de compose, token de header, chave privada. O build aplica uma segunda sanitização a campos sensíveis, payload JSON, URLs com userinfo/query sensível, headers e chaves privadas. Isso não identifica todo formato possível: confira os artefatos antes de versionar; a primeira sanitização continua sendo sua.
5. **Histórico nunca é apagado.** Scan novo faz upsert no modelo; `history.scans` e `history.changelog` recebem entradas no topo; `history.coverage` acrescenta observações ao fim. O scan não é dono de `history`: seus arrays são ignorados pelo merge.

---

## Exaustividade — TODOS os fluxos, sempre

A documentação é **deep por definição**. O scan não fecha enquanto existir jornada da aplicação sem fluxo documentado. Isto não é preferência de estilo: é o produto.

1. **Inventário antes da narração.** Antes de escrever qualquer fluxo, liste TODA a superfície de entrada da aplicação: cada rota HTTP, cada consumer de tópico/fila, cada cron/scheduled job, cada webhook de entrada, cada worker, listener e CLI de backfill. O inventário vira `entrypoints` no modelo — é a régua de fechamento do scan. Inclua APIs exportadas de bibliotecas quando forem a superfície pública. Um projeto sem entrypoints pode ter `entrypoints: []` apenas com `flows: []` e `entrypointsNote` explicando a ausência.
2. **Cada entrypoint termina `mapeado` ou `trivial`.** `mapeado` = vira fluxo (com `flow` apontando o id). `trivial` = não é jornada (healthcheck, readiness, leitura mecânica sem regra de negócio) — mas exige `note` dizendo por quê. `nao-mapeado`, inventário ausente ou `trivial` sem justificativa = **o build falha**: o scan não está pronto e você volta a extrair.
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

Se Python não estiver disponível, prepare o scan-model.json e informe que o pack aguarda validação/build. Não substitua os scripts por colagem manual de JSON: a sanitização, os gates e o escaping fazem parte do contrato de publicação.

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
| camadas & classes | injeção e receivers: handler/controller → service/use case → repository/DAO → client; construtores e fields injetados (para `flows[].classes`) |
| limites para o C4 | quem chama a app (atores) e a quem ela chama (sistemas externos); manifests (compose, k8s) e processos deployáveis (para `c4`) |
| config/ambientes | `.env.example`, `config/*.yaml`, `values.yaml`, ConfigMap, `Dockerfile ENV`, blocos `environment:` do compose |
| variáveis lidas no código | `os.Getenv` (Go) · `process.env.X` (JS/TS) · `os.getenv`/`os.environ` (PY) · `ENV[...]`/`ENV.fetch` (Ruby) · `System.getenv` (Java) · `std::env::var` (Rust) |
| qualidade | CI (`.github/workflows`), test runner, `Docs/audit/ultra-deep/` (pack mais recente) |
| documentos | `README*`, `docs/adr/`, postmortems, `CODEOWNERS`, runbooks |

`--delta`: a base é **`app.commit`**, o snapshot atualmente documentado; `commitPrev` serve apenas ao histórico do pack. Execute `python3 <skill>/scripts/atlas_delta.py docs/atlas/app-model.json --repo .`. O inventário read-only inclui alterações desde a base, staged/worktree e arquivos untracked. Se retornar `mode: "full"`, refaça o scan completo: não há base verificável. Restrinja a extração aos fluxos afetados e às referências consumidoras; uma remoção exige atualizar também os links env/C4/entrypoints. Para deletar itens, envie listas completas afetadas em merge full; delta não trata omissão como remoção.

Use o HEAD retornado no novo `app.commit`. Se documentar mudanças não commitadas, registre essa condição em `app.syncNote`; o hash sozinho não representa a worktree suja. A próxima rodada continua comparando com a base commitada e reinclui essas mudanças.

---

## Fase 2 — Extração (o modelo)

Produza um `scan-model.json` seguindo o schema abaixo. Campos ausentes são normais — o dashboard esconde o que não existe; **não preencha com invenção**.

### Estrutura

```jsonc
{
  "schema": "atlas-docs/2",
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
    "containers": [ { "group": "borda|dominio|dados|externos", "name", "sub", "prov": "code" } ],  // legado; prefira c4.containers
    "libs":  [ { "group": "Runtime · Go 1.23 (go.mod)",
                 "items": [ { "name", "ver", "use", "note", "state": "ok|warn|bad" } ] } ],
    "compose": [ { "name", "file", "sub", "yaml": "…segredos já mascarados…" } ],
    "adrs":  [ { "id": "ADR-012", "title", "body", "status" } ],
    "cross": [ { "k": "AUTENTICAÇÃO", "body": "…" } ]     // gap: true → card vermelho
  },
  // c4 → página C4 (C1 Contexto · C2 Containers); containers alimentam também a página Arquitetura
  "c4": {
    "context": {                        // C1 — o sistema no mundo
      "self": { "desc": "este sistema em 1 frase", "src": "README.md" },
      "actors":  [ { "id": "shopper", "name": "Cliente final", "kind": "person", "desc": "…", "src": "…" } ],
      "systems": [ { "id": "psp", "name": "PSP Adquirência", "kind": "externo", "desc": "…",
                     "prov": "code", "flows": ["imediata"], "src": "internal/psp/client.go" } ],
      "edges":   [ { "from": "shopper", "to": "system", "label": "POST /v1/charges · HTTPS" },
                   { "from": "system", "to": "psp", "label": "autorização · REST" } ]   // "system" = id reservado do hub
    },
    "containers": [ {                  // C2 — dentro do limite do sistema
      "id": "api", "name": "billing-api", "group": "borda|dominio|dados|externos",
      "tech": "Go 1.23 · chi", "desc": "…", "prov": "code", "src": "cmd/api/main.go",
      "flows": ["imediata"],
      "calls": [ { "to": "postgres", "label": "SQL · TCP", "kind": "db" } ]   // to = id de outro container
    } ]
  },
  // flows → página Fluxos; o 1º flow COM "diagram" vira o diagrama rico clicável
  "flows": [ {
    "id": "imediata", "label": "Cobrança imediata · cartão", "title": "…", "tag": "…",
    "cov": 98,                       // saída derivada: não preencher no scan; build SEMPRE recalcula
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
    "classes": [ {                     // → card "Diagrama de classes do fluxo" (arestas apuradas do template)
      "id": "charge-service", "name": "ChargeService",
      "stereo": "controller|service|repository|domain|client|worker|util|externo",
      "pkg": "internal/charge", "desc": "…", "src": "internal/charge/service.go:42",
      "fields": [ "repo *ChargeRepo", "psp psp.Client" ],       // dependências injetadas
      "methods": [ {                                             // só os acionados NESTE fluxo, em ordem de execução
        "sig": "Authorize(ctx context.Context, in AuthInput) (*Charge, error)",
        "what": "guarda idempotência, autoriza no PSP, persiste a charge",
        "calls": [ { "to": "PSPClient.Authorize", "how": "HTTP · timeout 4s",
                     "kind": "sync|async|http|db|event|queue" } ],   // to = Classe.metodo (alvo pelo último ponto)
        "src": "internal/charge/service.go:58"
      } ]
    } ],
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
  // entrypoints → obrigatório; build falha se ausente, nao-mapeado ou trivial sem note
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
    "tables": [ { "name": "charges", "rows": "—", "size": "—", "wps": "—",
                  "keep": "indefinida", "prov": "external" } ],   // com fonte: source: {ref: "dump.json:3", observedAt: "2026-10-22T10:00:00Z"}
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
                  "lag": "—", "lagKind": "ok|warn|bad", "dlq": "—", "prov": "external" } ],
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
  // history → saída dos scripts; OMITIR no scan novo (arrays recebidos são ignorados)
  "history": {
    "coverage": [ { "day": "2026-10-22", "v": 98, "commit": "a91f3c7", "scan": "id-gerado" } ],
    "scans":    [ { "id": "id-gerado", "commit": "a91f3c7", "when": "2026-10-22T10:00:00Z", "title": "…", "detail": "…",
                    "score": 98, "previousScore": 91, "delta": "+7%", "deltaKind": "ok|bad" } ],
    "changelog": [ { "tag": "NOVO|BREAK|DDL|DOC|REMOVE", "body": "…" } ]
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
- **Diagrama de classes: todo fluxo que roda código de aplicação.** Siga a chamada real — handler/controller → service/use case → repository/client — e registre em `flows[].classes` (regras completas na seção abaixo).
- **C4: uma passada dedicada no primeiro scan.** Extraia `c4` (C1 contexto + C2 containers) olhando atores, clientes externos e manifests de deploy. No `--delta`, só quando entrypoints/manifests mudarem.

---

## Diagrama de classes por fluxo (`flows[].classes`)

Todo fluxo leva o card **"Diagrama de classes do fluxo — qual classe, qual método, o que é chamado"**. O diagrama (caixas UML com estereótipo, dependências e métodos + arestas) é **apurado pelo template** a partir de `methods[].calls` — você não desenha nada, só declara:

1. **Classes de todas as camadas tocadas pelo fluxo**: handler/controller, service/use case, repository/DAO, client externo, worker, domain. Cliente/SDK de terceiro entra como classe com `stereo: "externo"` (caixa tracejada no diagrama).
2. **`methods` = só os métodos acionados neste fluxo**, na ordem de execução — não é o inventário da classe inteira. Cada método com `sig` (assinatura real do código), `what` e `src` `arquivo:linha`.
3. **`calls[].to` no formato `Classe.metodo`** (ou `pacote.Classe.metodo` — o alvo é resolvido pelo **último ponto**, e o prefixo precisa bater com o `name`/`id` de uma classe do diagrama). `kind` `async|event|queue` desenha seta tracejada; `how` descreve o meio (HTTP, SQL, gRPC…).
4. **`fields` = dependências injetadas** — vira a lista de atributos da caixa e expõe o acoplamento da classe.
5. **Chamada apontando para classe fora do diagrama → aviso no build**: ou a classe entra no diagrama (mesmo como `externo`), ou o alvo está errado. Fluxo sem código de aplicação (proxy puro, redirect de infra) pode omitir `classes` — o card simplesmente não aparece.

## C4 — níveis C1 e C2 (`c4`)

Página dedicada **C4 · contexto & containers**, com abas C1/C2 e diagramas clicáveis:

1. **C1 Contexto (`c4.context`)**: quem usa o sistema (`actors` — pessoas/times), o próprio sistema (hub com o **id reservado `"system"`**, nome vem de `app.name`, descrição de `context.self.desc`) e os **sistemas externos** (`systems`). As interações vivem em `edges` com `from`/`to` em ids declarados + `"system"`. Edge apontando id inexistente **quebra o build** — mesma régua de `diagram.edges`.
2. **C2 Containers (`c4.containers`)**: cada processo deployável e cada datastore/broker **dentro do limite do sistema** — api, worker, consumer, frontend, postgres, redis, kafka. `group` em `borda|dominio|dados|externos` define a coluna do diagrama; `tech`, `desc`, `src`, `flows` (link para a página do fluxo) e `calls` (aresta para outro container por `id`) completam a caixa. `calls.to` inexistente **quebra o build**; id duplicado também.
3. **Uma fonte, duas páginas**: `c4.containers` também alimenta o card "Mapa de containers" da página Arquitetura. `architecture.containers` (legado) continua renderizando quando `c4.containers` não existe.
4. **Sem `c4` no modelo** a página mostra a lacuna em cards tracejados; o build avisa quando C2 existe sem C1.

---

## Score (apuração por script, não por você)

`atlas_build.py` apura e sobrescreve `score`:

| componente | peso | fórmula |
|---|---|---|
| cobertura dos fluxos | 45% | por passo: payload 25 · src 20 · calls 15 · errs 15 · does 15 · touches 10 (cap 100); média por fluxo, média entre fluxos |
| modelo & contratos | 20% | tabelas no modelo 40 · DDL presente 30 · endpoints 30 |
| variáveis de ambiente | 10% | % de vars com `desc` **e** (`flows` ou `used`) preenchidos |
| quality gates | 25% | pass 100 · warn 60 · fail 0 (média) |

**Buckets opcionais gates/env ausentes → excluídos do peso e os demais renormalizam.** Fluxos e modelo/contratos são os componentes documentais de base; ausência de evidência nesses componentes vale zero. O score mede preenchimento documental, não prova semântica, exaustividade nem resultado de produção. Gates ou env ausentes ficam visíveis como lacuna (`NÃO CONECTADO`).

**Diagrama de classes e C4 ainda não têm peso no score** — a completude deles é cobrada por aviso/erro no build e pela apuração impressa (`classes: K/N fluxos · c4: C1 ok · C2 N containers`), não por nota.

Grade: `A ≥ 90` · `B ≥ 75` · `C ≥ 60` · `D ≥ 40` · `F < 40`.

### Quality Gateway — de onde puxar

1. CI do repo (`.github/workflows`): resultado declarado dos jobs de test/lint/typecheck.
2. Pack do `ultra-deep-audit` mais recente em `Docs/audit/ultra-deep/` → `findings` por severidade e score.
3. Cobertura de testes do relatório do runner, se existir no repo.
4. Nada disso existe → `quality` fica vazio; o dashboard mostra a lacuna honestamente.

---

## Merge incremental

`atlas_merge.py` aplica estas regras antes do build:

- **Listas com chave natural** fazem upsert: `flows` por `id` (o flow inteiro é substituído, incluindo `classes`) · `contracts.endpoints` por `m+path` · `thirdParty`/`deps` por `name` · `data.model`/`data.tables`/`env.vars` por `name` · `events.topics` por `topic+group` · `c4.context.actors`/`c4.context.systems` por `id` · `c4.context.edges` por `from+to` · `c4.containers` por `id` · `architecture.libs[].items` por `name` · `adrs` por `id` · `ops.*` por `name`/`area`.
- **Modo `--mode delta`**: itens não mencionados no scan permanecem (você só extraiu o que mudou). **`--mode full`**: cada lista fornecida substitui a antiga inteira, inclusive grupos/itens de libs; lista presente vazia remove tudo, campo ausente conserva o anterior. Corrija referências a itens removidos antes do build.
- **Seções escalares** (`identity`, `architecture` menos listas, `data.engine`, …): campo presente no scan ganha; ausente mantém o antigo.
- **Sempre**: `app.commitPrev` = commit anterior · nova entrada no topo de `history.scans` com `delta` = score novo − anterior · `history.coverage` ganha um ponto por scan ou mudança de score, inclusive no mesmo dia (rebuild idêntico não duplica) · changelog do scan (`__changelog` no scan-model) vai para o topo de `history.changelog`, também no primeiro scan. `history` recebido no scan é ignorado; apenas o modelo anterior fornece registros duráveis.
- **Changelog é semântico e é seu**: compare o modelo antigo com o novo e escreva as entradas — `NOVO` (nó/fluxo/rota detectado), `REMOVE` (elemento removido), `BREAK` (contrato mudou de forma incompatível), `DDL` (migração nova), `DOC` (ganho/perda de cobertura, dono ausente). Sem entradas reais, changelog vazio — não fabririque.

---

## Fase 5 — Entrega

Resumo curto na conversa (não o HTML):

```
docs/atlas/index.html · score 86 (B) · +2 fluxos · 1 BREAK em POST /v1/charges
cobertura 71% → 86% · 6 gates: 4 pass · 1 warn · 1 fail
```

Abra o dashboard se o host permitir. O pack (`index.html` + `app-model.json`) entra no repo da aplicação — é artefato versionado do app, não da skill.

---

## Contrato 2 e migração

A versão 2.0.0 emite `schema: "atlas-docs/2"`. O build aceita modelos `atlas-docs/1` e os migra somente após validação bem-sucedida; schemas desconhecidos falham. Antes de reconstruir um pack v1:

- Complete o inventário e as justificativas; resolva IDs duplicados e todos os links `flows`/`flow` órfãos, incluindo env e C4.
- Não reutilize `cov`/`score` como entrada confiável: os valores anteriores são recalculados, e o score pode diminuir.
- Para runtime, declare `source.ref` (artefato/painel realmente consultado) e `source.observedAt` (ISO 8601 com fuso). Sem fonte, o build troca rows/size/wps, lag/dlq e stats external/observed por `—`. O script valida a declaração, não consulta telemetria nem prova que o artefato existe; a extração precisa citar evidência real. Campos de configuração, como partições declaradas em manifests, continuam derivados do código.
- Preserve o modelo anterior ao fazer merge. O histórico antigo é mantido; novas observações incluem commit e ID do scan. A série preserva várias observações no mesmo dia, e um rebuild sem mudança não acrescenta ponto.

Não edite `index.html` antigo para migrar: regenere pelo template novo, que usa listeners e atributos de dados. O build atualiza o JSON também em `--check-only` (essa opção apenas omite o HTML). Se houver erro de validação, nenhum dos dois artefatos é publicado pelo build.

## O que esta skill NÃO faz

- **Não executa a aplicação** nem finge telemetria: runtime sem fonte aparece tracejado, com `—`.
- **Não edita código do app.** Se a leitura revelar bugs, eles viram `identity.risks` / `quality.findings` — o fix é com `/ultra-deep-audit` + `/mmh`.
- **Não substitui ADR/README do repo.** O Atlas descreve o código *como está*; decisão arquitetural documentada continua no lugar dela.
- **Não gera o mesmo HTML duas vezes à mão.** Toda regeneração passa pelo build a partir do `app-model.json`.

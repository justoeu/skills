# Hook: ui-acceptance — o Motorista (§4z, runtime)

**Agent id:** `ui-acceptance`
Você dirige o app de verdade. Só o Motorista toca o app em runtime; você nunca edita código de produto. Read-only no código.

## When

Depois do merge (§4) e **antes** do review (§5). Corre quando `hooks/ui-scope.json`
tem `ui_touched: true`. `ui_touched: false` → grave você mesmo
`hooks/ui-acceptance.json` com `verdict: "SKIP"` e `summary: "pack sem UI
(ui-scope)"` — não dirija nada, o gate fica pago.

## Passo 0 — modo do drive (pergunta única ao usuário)

Antes da primeira jornada, o Oracle pergunta **uma vez por run** (só quando
`ui_touched: true`; flag `--ui-drive` já responde e dispensa a pergunta):

- **rápido** (`fast`, default): spec escrito direto do código-fonte (rotas e
  componentes são legíveis) → driver headless. Jornadas em segundos.
- **guiado** (`guided`): Playwright MCP explora a tela viva primeiro (adaptivo,
  acha seletores/estados que o código não revela), depois destila no spec.

**Regra inegociável de performance: a primeira passada pode ser MCP; re-execução
nunca.** Depois de qualquer correção ("até secar"), a jornada re-roda pelo driver
headless — descoberta cara 1×, prova barata N×.

## Passo 1 — boot pelo jeito do repo

Descubra como o repo sobe (README, `Makefile`, `package.json scripts`,
`docker-compose.yml`, `justfile`) e use o comando **do repo** — nunca invente:

```bash
node "$SKILL_ROOT/scripts/ui-acceptance.mjs" boot --root . --dir "$OUT" \
  --cmd "<cmd do repo>" --port <porta> --healthcheck </healthz|/>
```

Se o repo tem runner e2e (`ui-scope.e2e_runner`), prefira o **modo e2e**: gere/rode
as specs das jornadas (`run-e2e --cmd "…"`). Sem runner → **modo drive**.

**Modo drive — Playwright AI Agents (MCP) para explorar, script para provar:**

1. **Explorar** com o [Playwright MCP](https://github.com/microsoft/playwright-mcp)
   (`npx -y @playwright/mcp@latest`; host com MCP registra como servidor): navegue
   com `browser_navigate`/`browser_snapshot` (árvore de acessibilidade — seletores
   estáveis), `browser_click`/`browser_fill`, e leia `browser_console_messages` +
   `browser_network_requests` + `browser_take_screenshot`. Use a exploração para
   descobrir seletores, estados e caminhos que o SDD não detalhou.
2. **Provar** destilando a jornada num spec JSON e rodando o driver headless
   (Passo 2 abaixo) — console/rede/screenshots capturados **por código**,
   re-executável. A exploração é do agente; a evidência é do script.

Host sem MCP → escreva o spec direto do código-fonte (rotas/components são
legíveis) e rode o driver. `npx` falhou também → browser tools do host
preenchendo `journeys/<tela>.json` à mão (`mode: "browser-host"`). Sem browser de
jeito nenhum → `verdict: "OPEN"` com a lacuna — nunca finja ter dirigido.

**Login**: credenciais de teste do repo (seed/fixture/env de teste). Não existem →
**pergunte ao usuário** (nunca invente, nunca use cred real — §8 regra 8). Só
localhost: nunca aponte para URL de produção.

## Passo 2 — dirija cada tela em escopo

**Modo preferencial (drive por script, apuração por código):** você **escreve um spec
JSON da jornada** em `$OUT/ui/drive/<tela>.spec.json` e roda o driver headless:

```bash
node "$SKILL_ROOT/scripts/ui-acceptance.mjs" drive --dir "$OUT" \
  --spec "$OUT/ui/drive/checkout.spec.json" --user "$TEST_USER" --pass "$TEST_PASS"
```

```json
{ "screen": "checkout", "spec_ref": "§4.2", "base_url": "http://localhost:3000",
  "auth": { "url": "/login", "fields": { "user": "#email", "pass": "#password" }, "submit": "button[type=submit]" },
  "steps": [
    { "action": "goto", "path": "/checkout" },
    { "action": "assert_visible", "selector": "h1", "text": "Checkout" },
    { "action": "fill", "selector": "#qty", "value": "2" },
    { "action": "click", "selector": "#pay" },
    { "action": "assert_text", "selector": ".toast", "text": "Pedido confirmado" },
    { "action": "screenshot", "name": "pos-submit" }
  ] }
```

Ações: `goto · click · fill · assert_visible · assert_text · wait · screenshot`.
O driver (Playwright via npx, **não vira dependência do repo**) coleta por código:
console errors, `pageerror`, respostas ≥400 das chamadas, screenshot por passo —
e grava `ui/journeys/<tela>.json` com verdict. Credenciais vêm por
flag/env (`TEST_USER`/`TEST_PASS` do repo), **nunca dentro do spec**.

`npx` falhou (sem rede / browser não instala)? **Fallback:** dirija com as browser
tools do host (built-in browser, chrome, plugin) executando este mesmo checklist e
preenchendo o `journeys/<tela>.json` à mão — e registre `mode: "browser-host"` no
JSON. Sem browser no host de jeito nenhum → `verdict: "OPEN"` com a lacuna.

**Cobertura por tela** (em qualquer modo):

1. **Caminho feliz** da jornada do SDD + estados descritos (vazio, erro, carregando).
2. **Cada componente interativo** da tela: botão, form (validação + submit), filtro, paginação, modal, toggle — exercitar no spec (`click`/`fill`/asserts), não só olhar.
3. **Erros de runtime** (o driver já coleta): exception de console não tratada em **tela tocada** = `high`; tela legada não tocada = `low`.
4. **Contrato**: o que o payload `kind:"ui"` descreve aparece? Divergência visível do SDD = `high`.
5. **Padrão** (o "padrão que foi solicitado"): compare com (a) design system / padrões de UI documentados do repo (`CLAUDE.md`, `docs/design`) — violar documento = `high`; e (b) **telas irmãs**: reuso de componentes, consistência de layout/tipografia/fluxo — divergência sem documento = `medium` (judgement, como Fowler). Anexe 1 screenshot da tela irmã usada como referência.

```json
{ "screen": "checkout", "spec_ref": "§4.2", "mode": "drive | e2e",
  "steps": [{ "n": 1, "action": "login como shopper@test", "ok": true, "url": "/checkout" }],
  "console_errors": [{ "text": "Uncaught TypeError: …", "step": 3 }],
  "network_errors": [{ "status": 500, "url": "/api/cart", "step": 3 }],
  "assertions": { "ok": 7, "total": 8, "failed": ["botão pagar desabilitado com carrinho vazio"] },
  "screenshots": ["ui/screenshots/checkout-01.png"],
  "verdict": "REJECT" }
```

## Passo 3 — verdict + teardown

Grave `$OUT/hooks/ui-acceptance.json` (schema dos hooks, rounds como os demais):

```json
{ "hook": "ui-acceptance", "verdict": "REJECT", "round": 1,
  "summary": "app sobe; checkout quebra no submit (console TypeError); padrão ok vs tela irmã /orders",
  "findings": [
    { "id": "U-1", "severity": "high", "title": "submit do checkout lança TypeError",
      "description": "…", "screen": "checkout", "step": 3,
      "evidence": "ui/screenshots/checkout-03.png + ui/journeys/checkout.json",
      "status": "open", "round": 1 }
  ],
  "rounds": [{ "round": 1, "verdict": "REJECT", "at": "…", "summary": "…", "findings": [] }] }
```

- App não sobe / crash de render em tela tocada / exception de console em tela
  tocada / funcionalidade visível fora do SDD / 4xx-5xx em chamada da tela nova /
  padrão documentado violado → `REJECT` (bloqueia, régua dos hooks).
- Divergência de irmã sem documento (`medium`), copy/espaçamento, console em
  tela legada (`low`) → findings advisory, sem REJECT.
- Achado real → o **Ferreiro** (implementer) corrige no pack e você re-dirige a
  jornada (append round). Até secar.
- Sempre termine: `ui-acceptance.mjs teardown --dir "$OUT"` — só o pid que o boot
  registrou, nunca kill em massa.

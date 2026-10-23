---
name: ultra-deep-audit
description: >
  Auditoria multi-agente de segurança, N+1, concorrência, recursos, qualidade,
  bugs clássicos e dependências. Delta, full ou --only. Painel deep de três lentes
  com identidade verificável; produz findings, roadmap, tasks e HTML. Auditoria
  e implementação têm conclusões separadas. Fixes só quando autorizados.
metadata:
  version: 2.0.1
---

# Ultra-Deep Audit

Framework de detecção que adapta stack e contratos ao repositório. Leia `AGENTS.md`, manifestos e documentação canônica existente. Não imponha camadas, framework, SDD numerada, thresholds de mutation ou ferramentas de outro projeto. Graphify é opcional; leitura direta, busca e referências de código são o fallback completo.

O protocolo e os arquivos são **schema 2**, incompatíveis com atestação automática de packs antigos. Leia [references/pack-schema.md](references/pack-schema.md) antes do primeiro ciclo. Uma run v1 pode ser renderizada como histórico **UNVERIFIED**; nunca acrescente schema/version para torná-la confiável. Crie run nova e refaça cobertura/provas sobre o código atual.

## Escopo e autorização

- Default `--delta`: diff da base escolhida + callers/callees relevantes. `--full`: corpus inteiro, segurança deep e esforço max, salvo redução explícita.
- `--only a,b` escolhe agentes. Aliases: quality/guild = Daedalus,Echo,Laconic,Mentor,Forge; surface = Lyra,Janus,Moira,Sigil,Basilisk,Proteus,Mirage; cc = Daedalus; dup = Echo; bp = Mentor; caca-bugs = Artemis.
- `--depth fast|deep`, `--effort medium|high|max`, `--scope dir,dir`, `--base REF` refinam o escopo. Registre essas escolhas em run-meta e no dispatch; escopo restrito deve aparecer no report.
- Auditoria é read-only no produto. Escreva apenas o pack. Entregue achados e ofereça implementação; não faça bump, PR, envio ou instalação por consequência de um pedido de auditoria.
- Fixes autorizados usam `intent=fix`. Um audit concluído pode ter findings OPEN; implementação verificada exige disposições e provas. Não esconda resíduos aceitos como correções feitas.
- Segredos encontrados ficam mascarados no pack. Não execute exploit, chame provedor para validar chave ou acesse produção.

## Roster e prompts

Leia o arquivo inteiro de cada papel selecionado. Execute em paralelo quando houver capacidade; filas ou execução inline explícita são válidas. Registre limitações de independência; não invente sessões de agentes.

| Papel | Prompt | Foco |
|---|---|---|
| Atlas | `agents/atlas-architecture.md` | arquitetura real do projeto |
| Sentinel | `agents/sentinel-security.md` | authz, IDOR, segurança geral |
| Lyra | `agents/lyra-xss.md` | XSS |
| Janus | `agents/janus-routes.md` | exposição de rotas |
| Moira | `agents/moira-ratelimit.md` | rate limit e estado do limitador |
| Sigil | `agents/sigil-secrets.md` | segredos rastreados |
| Basilisk | `agents/basilisk-sqli.md` | SQL/NoSQL injection |
| Proteus | `agents/proteus-prompt.md` | prompt injection com efeito |
| Mirage | `agents/mirage-deps.md` | imports/deps sem uso ou inválidos |
| Nexus | `agents/nexus-n1-perf.md` | N+1/performance |
| Hermes | `agents/hermes-race.md` | concorrência |
| Hydra | `agents/hydra-resources.md` | recursos/backpressure |
| Daedalus | `agents/daedalus-complexity.md` | CC/cognitive/nesting |
| Echo | `agents/echo-duplication.md` | duplicação |
| Laconic | `agents/laconic-verbosity.md` | verbosidade com impacto |
| Mentor | `agents/mentor-best-practices.md` | práticas compatíveis com o projeto |
| Forge | `agents/forge-quality.md` | dívida residual |
| Prism | `agents/prism-deps-bp.md` | CVE e atualização aplicável |
| Argus | `agents/argus-tests.md` | qualidade dos testes |
| Artemis | `agents/artemis-caca-bugs.md` | bugs clássicos por linguagem |

Ownership: cada sintoma fica com seu especialista. Sentinel com `SURFACE_BENCH=on` não duplica as seis lentes de superfície; `--only sentinel` usa `SURFACE_BENCH=off` e cobre essas categorias. Mirage não passa pelo painel. Forge não reemite CC, dup ou verbosidade. Catálogos em `catalogs/` são sinais para investigação, não política obrigatória; confirme impacto e path:line no código.

## 1. Inicializar run isolada

`SKILL_ROOT` é o diretório desta skill. Não suponha `.claude` ou `.agents` no projeto. Materialize o roster completo antes de iniciar; cada saída esperada é um arquivo. Se Prism roda, inclua também `agent-prism-freshness.json`.

```bash
OUT=$(node "$SKILL_ROOT/scripts/pack-state.mjs" init --root . \
  --mode delta --intent audit --agents agent-atlas.json,agent-prism.json,agent-prism-freshness.json)
```

Publishers usam lock exclusivo; concorrência retorna erro explícito para repetir após a operação atual. Se um processo morrer sem liberar `.pack.lock`, pare outros writers, confira o PID registrado e arquive/remova o lock somente depois de confirmar que o dono morreu; não há remoção por timeout. Filhos de sync herdam o lock, outros processos não.

Cada init gera timestamp + identificador único, mesmo no mesmo dia. Não reutilize diretório nem copie votos entre runs. A run captura raiz real, branch/head, snapshot de conteúdo e roster. Delta exige Git com commit e base resolvível (default main/master/origin/main/origin/master); `--base` explícita inválida ou sem ancestral comum falha antes de criar pack. Sem Git, use `--mode full`. Artefatos do pack são excluídos do snapshot; fontes novas não ignoradas pelo Git são incluídas. Não exclua fontes para fazer um gate passar.

Guarde `$OUT` para retomada. Leia run-meta, `pack-state status` e tentativas anteriores; não escolha a pasta só pela data. `status` calcula o estado atual, não confia no HTML antigo. Uma nova auditoria deve usar novo init.

```bash
node "$SKILL_ROOT/scripts/detect-stack.mjs" --root . > "$OUT/stack.json"
node "$SKILL_ROOT/scripts/pack-state.mjs" bind --dir "$OUT" --file stack.json
```

## 2. Produzir cobertura e findings

Cada agente salva array JSON (inclusive `[]` quando limpo), ou `{ "findings": [...] }`. Objetos individuais também são aceitos pelo merge para compatibilidade com exemplos dos prompts. Campos mínimos: agent, domain, title, severity, confidence, path, line. IDs podem ser omitidos; o merge reserva IDs existentes e rejeita colisões. `test_red_green` dos prompts é uma **proposta** de validação, nunca prova executada.

Depois de ler/validar a saída do agente, registre sua associação com a run:

```bash
node "$SKILL_ROOT/scripts/pack-state.mjs" bind --dir "$OUT" --file agent-atlas.json
```

Bind registra bytes + run + snapshot; não executa o agente. Nunca bind de saída anterior como se fosse uma nova análise. JSON quebrado ou saída faltante mantém a run incompleta. O merge não apaga o agregado anterior numa falha; tentativas com erro ficam em attempts.json e impedem selo de conclusão até uma execução bem-sucedida da etapa.

Quality Guild usa código antes do julgamento:

```bash
node "$SKILL_ROOT/scripts/measure-quality.mjs" --root . --scope src --strict --out "$OUT/quality-metrics.json"
node "$SKILL_ROOT/scripts/pack-state.mjs" bind --dir "$OUT" --file quality-metrics.json
```

Omita scope para corpus inteiro. Diretórios e arquivos são aceitos; ausências, leituras recusadas, limites e truncamento aparecem no ledger e impedem strict. Confirme boundaries e hotspots no source; o medidor é heurístico.

Prism, quando no roster:

```bash
node "$SKILL_ROOT/scripts/check-deps-latest.mjs" --root . \
  --out "$OUT/deps-latest.json" --findings "$OUT/agent-prism-freshness.json"
node "$SKILL_ROOT/scripts/pack-state.mjs" bind --dir "$OUT" --file deps-latest.json
node "$SKILL_ROOT/scripts/pack-state.mjs" bind --dir "$OUT" --file agent-prism-freshness.json
```

Consultas a registries são externas: respeite modo offline e autorização do ambiente; indisponibilidade é cobertura incompleta, nunca “todas atualizadas”. O helper informa erros com exit não zero; erro/skip segue visível no JSON, markdown e HTML. Não tente resolver falta de rede instalando ferramentas sem necessidade. CVEs exigem affected range confirmado, sem versões inventadas.

Política opcional: `.ultra-deep-audit/dependency-policy.json` no projeto ou `--policy caminho`. O relatório registra origem/hash. O arquivo da skill é exemplo neutro, não é imposto ao projeto. Imagens first-party e trilhas LTS precisam de configuração explícita; `APP_VERSION` sozinho não prova que uma imagem pode ser ignorada.

## 3. Segurança deep

Use `agents/security/cartographer.md`, `hunter.md`, `refuter.md`. Cartographer enumera corpus/skip ledger e assignments component×lens; hunters declaram complete/incomplete e preservam cada saída. Não dê cobertura total a um corpus só amostrado.

1. Salve e bind inventário e cada hunter. O inventário schema2 contém `complete`, `required_hunters:[{component,lens}]`, componentes e skips. Sem superfície de ataque: `no_attack_surface:true`, razão e assignments vazios.
2. Concatene/deduplique candidatos num envelope schema2 conforme [pack-schema](references/pack-schema.md); inclua run_id/snapshot e arquivos de cobertura. Bind candidates.json depois de finalizar o conteúdo.
3. Três refuters independentes por candidato: REACHABILITY, IMPACT, DEFENSES. Cada arquivo leva run_id, snapshot, candidate_hash, lens, verdict, reasoning e cited_paths. Obtenha hash com `pack-state candidate-hash --dir "$OUT" --file sec-deep/candidates.json --id C1`.
4. Falta de tempo/trace = **INCONCLUSIVE**, não FALSE_POSITIVE. Falta, erro, voto inconclusivo ou identidade antiga exige continuação e bloqueia conclusão. Nunca fabrique arquivos para simular independência.

```bash
node "$SKILL_ROOT/scripts/sec-verify.mjs" --dir "$OUT" \
  --candidates "$OUT/sec-deep/candidates.json" --votes-dir "$OUT/sec-deep/votes" \
  --require-vote-files --agent Sentinel --id-prefix SEC-SEN \
  --out "$OUT/agent-sentinel.json" --coverage-out "$OUT/sec-deep/sentinel-coverage.json"
```

Para a bancada, use envelope e coverage separados por agente (`lyra-coverage.json`, etc.), agent/prefix correspondentes e temp_ids como LYR-C1. Todos os candidatos submetidos à verificação exigem painel; não sobrescreva silently findings de menor severidade com um subconjunto. Quorum fixo 2/3; 2/3 limita confidence a medium. Zero candidatos só resulta `not_applicable` se inventário e hunters completos estiverem ligados ao snapshot. Arquivos de votos vazios não são exigidos numa auditoria limpa.

## 4. Apurar e entregar

```bash
node "$SKILL_ROOT/scripts/merge-findings.mjs" --dir "$OUT"
node "$SKILL_ROOT/scripts/sync-progress.mjs" --dir "$OUT" --refresh
node "$SKILL_ROOT/scripts/pack-state.mjs" status --dir "$OUT"
```

Merge lê só o roster registrado; valida todas as entradas antes de publicar. Reexecução preserva resoluções/IDs e mantém achados que não reapareceram como `not_in_latest_scan`; ausência não é refutação automática. Confirme a disposição desses itens.

Entregue caminhos absolutos de report.html, FINDINGS.json, TASKS.md e diretório do pack, top riscos e cobertura pendente. Abrir HTML é best-effort, sem obrigação de browser no ambiente headless. A aba Libs não substitui a cobertura de consulta. REPORT/HTML mostram separadamente auditoria verificada, implementação verificada e gates pendentes.

## 5. Implementação autorizada e retomada

Comece run com `--intent fix` quando houver autorização para corrigir. Antes do fix, registre execução apropriada; depois de mudar fonte, atualize snapshot e refaça análises/provas afetadas. Todo artefato obrigatório deve se referir ao snapshot atual antes de concluir. Não edite o agregado à mão para falsificar a disposição.

| Mudança | validation | phases |
|---|---|---|
| Bug comportamental | bug | red não zero, depois green zero |
| Refactor | characterization | before zero e after zero; mesmos comportamentos |
| Docs/config mecânica | check | check aplicável zero |
| Dependência | deps | check de compatibilidade/suíte zero |

```bash
node "$SKILL_ROOT/scripts/pack-state.mjs" record --dir "$OUT" --id SEC-SEN-001 \
  --validation bug --phase red -- node --test test/auth.test.mjs
# fix autorizado
node "$SKILL_ROOT/scripts/pack-state.mjs" snapshot --dir "$OUT"
# refazer agentes/cobertura, bind e merge sobre o snapshot atual
node "$SKILL_ROOT/scripts/pack-state.mjs" record --dir "$OUT" --id SEC-SEN-001 \
  --validation bug --phase green -- node --test test/auth.test.mjs
```

`record` executa argv sem shell, captura saída/exit, snapshot e ordem; inspecione a causa de RED (falha de setup não prova defeito). Record retorna sucesso ao registrar uma execução terminada, mesmo se o comando foi RED; confira `exit_code`. Timeout/sinal/falha de spawn não viram prova.

Revise diff, qualidade dos testes e segurança aplicável. Use agentes independentes quando disponíveis; caso contrário faça papéis inline e declare o limite. Não exija quatro workers simultâneos. Registre review com reason, findings e disposições; não aceite HIGH aberto. Docs: atualize o documento canônico afetado ou registre NOT_APPLICABLE com motivo concreto. Não crie SDD arbitrária. Use `attest --kind review|docs` conforme schema.

```bash
node "$SKILL_ROOT/scripts/pack-state.mjs" attest --dir "$OUT" --id SEC-SEN-001 --kind review --file evidence/review.json
node "$SKILL_ROOT/scripts/pack-state.mjs" attest --dir "$OUT" --id SEC-SEN-001 --kind docs --file evidence/docs.json
node "$SKILL_ROOT/scripts/sync-progress.mjs" --dir "$OUT" --done SEC-SEN-001 --note "fix verificado"
```

`--done` exige execução, review/docs e auditoria atual completa; `--test` legado é apenas nota, não prova. `--open ID` restaura o bloqueio original. `--accept ID --note razão` é disposição explícita para risco aceito, não correção; use somente quando autorizada. Alterar código ou logs invalida o selo até novas provas. Atestações locais não são assinaturas nem demonstram independência humana: são evidência rastreável do trabalho feito.

## Testes do instrumento

`node --test "$SKILL_ROOT/scripts/tests/"*.test.mjs` roda fixtures locais, sem registries/live apps. Integrações preservadas do projeto original exigem `ULTRA_PROJECT_ROOT=/caminho` explícito; sem isso aparecem **SKIP**, não PASS. Não habilite esse opt-in sem inspecionar scripts do projeto alvo. O forward test usa Git/Node em diretório temporário, valida fechamento/remerge/reopen/segunda run e remove a fixture.


Os contratos opt-in são específicos do projeto de origem: POM, perfis de mutação e gate de imagens. Aceitam `deployments/scripts` (preferido) ou `scripts` legado. Após inspecionar os scripts desse checkout, execute a partir desta skill:

```bash
ULTRA_PROJECT_ROOT=/caminho/do/projeto node --test scripts/tests/*.test.mjs
```

O helper copia somente código/configuração necessária para uma fixture temporária e remove-a ao terminar. `ci-local` só é invocado no modo de verificação XML ou tem funções selecionadas exercitadas com Maven/Docker simulados; o pipeline completo não roda. Docker/Trivy usam stubs e ferramentas externas inesperadas falham. Os contratos cobrem PostgreSQL/Redis/Flyway, cinco imagens em duas plataformas, contagens/artefatos reais do protocolo e falhas de preflight/scan; não executam builds, registries, deploys ou a suíte da aplicação. Falha do contrato continua vermelha até corrigir a causa no projeto; SKIP sem opt-in não é aprovação.

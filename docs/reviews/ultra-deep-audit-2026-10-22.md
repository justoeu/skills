# Revisão independente — ultra-deep-audit

> Registro da auditoria inicial. O estado atual e as provas das correções estão no [relatório de remediação](other-skills-remediation-2026-10-22.md). Os achados abaixo descrevem a versão anterior.

Revisão read-only do harness em `~/Developer/harness/skills/ultra-deep-audit`, em 2026-10-22 (America/Sao_Paulo; logs já em 2026-10-23 UTC). Nenhuma fonte ou teste permanente foi alterado. `git status --short -- ultra-deep-audit` permaneceu vazio.

**Resultado:** há falsos verdes no painel de segurança e no HTML de dependências, perda de achados no merge, colisão de IDs e ausência de isolamento entre runs. O principal risco é publicar um agregado que parece confiável depois de uma entrada incompleta ou de uma reexecução.

## Evidências e reprodução

- Script reproduzível: `/tmp/review-ultra-repro.py`.
- Guarda de rede: `/tmp/review-ultra-netguard.cjs`; bloqueia HTTP(S), `net.Socket.connect` e `fetch` do Node. `GOPROXY=off` também foi usado nos repros; nenhum fixture Go foi criado.
- Resultados: `/tmp/review-ultra-results.json`.
- Fixtures da última execução: `/tmp/review-ultra-repro-7kcf8f28/`.
- Execução do JS do HTML em DOM mínimo, sem browser: `/tmp/review-ultra-dom.mjs`; resultado `/tmp/review-ultra-dom-results.json`.
- Log da suíte existente: `/tmp/review-ultra-tests.log`.

Reexecutar, sem rede nem app de produção:

```bash
python3 /tmp/review-ultra-repro.py
NODE_OPTIONS='--require /tmp/review-ultra-netguard.cjs' node /tmp/review-ultra-dom.mjs
```

O script cria diretórios únicos em `/tmp`, preservados para inspeção. Os dados dos achados/votos são sintéticos, plausíveis e intencionais; validam os instrumentos, não a capacidade de um modelo detectar uma vulnerabilidade real. Referências abaixo são relativas a `ultra-deep-audit/`.

## Achados prioritários

### UD-01 — P1 — Voto inválido remove HIGH e ainda produz `verified`

**Referências:** `scripts/sec-verify.mjs:228`, `:243`, `:245`, `:350`, `:387`; `SKILL.md:303`, `:335`.

**Repro:** caso `panel-invalid`. Um candidato HIGH, três arquivos independentes presentes, REACHABILITY/IMPACT=`TRUE_POSITIVE`, DEFENSES=`UNKNOWN`. Invocação usa exatamente `--votes-dir --require-vote-files --coverage-out`.

**Observado:** exit **0**, saída de findings `[]`, `panel_quorum_findings:0`, `dropped_sample[0].reason:"incomplete-or-invalid-panel"`, mas `verification_status:"verified"`. O controle `panel-valid`, três TP, preserva o achado normalmente.

**Causa/impacto:** `panelReviewed++` ocorre antes de validar o painel; a última alternativa do ternário de coverage volta a `verified`. O SKILL proíbe publicar candidatos derrubados e manda confiar no status do script, portanto a combinação induz descarte definitivo de uma revisão incompleta. Causa compartilhada com `deep-audit`, confirmada aqui por execução própria.

**Critério de correção:** voto inválido/ausente, candidato sem ID ou ausência de revisão devem produzir cobertura incompleta e exit não zero, sem substituir um resultado válido anterior. Quorum deve decidir TP versus FP somente entre votos válidos. Acrescentar regressão para um painel inválido e para mistura de candidatos válidos/incompletos.

**Risco adicional no contrato:** `agents/security/refuter.md:32` exige `FALSE_POSITIVE` quando o agente não termina o trace a tempo. Essa condição precisa de `INCONCLUSIVE`/cobertura pendente; hoje ela é indistinguível de uma refutação baseada no código. Essa parte foi constatada no prompt, sem simular um modelo.

### UD-02 — P1 — Merge apaga achados anteriores quando uma entrada falha; exemplo oficial de objeto também some

**Referências:** `scripts/merge-findings.mjs:87`, `:95`, `:99`, `:210`; `agents/lyra-xss.md:73`–`:98`.

**Repros:**

1. Caso `merge-state`: gerar `FINDINGS.json` com HIGH; truncar `agent-sentinel.json` para `{"findings": [`; rodar merge novamente.
2. Caso `single-object`: persistir em `agent-lyra.json` um objeto com o formato mostrado no prompt Lyra, incluindo agent/domain/severity/title/path/line/verification.

**Observado:** (1) warning `skip unreadable`, exit **0**, HIGH anterior substituído por `[]`; (2) nenhum warning, exit **0**, `0 raw → 0 unique`, `FINDINGS.json:[]`.

**Causa/impacto:** entrada ilegível vira ausência de achados, e objeto individual vira `[]`; o agregado é sobrescrito incondicionalmente. O segundo caso segue um formato que a própria skill ensina. Não é necessário um agente malicioso ou uma opção fora do contrato. Perda silenciosa de evidência de segurança. A variante JSON truncado tem causa compartilhada com deep.

**Critério de correção:** schema único em prompts/helpers; aceitar explicitamente objeto individual ou rejeitá-lo com erro. Validar todas as entradas e o roster esperado antes de publicar. Escrita atômica; em falha, preservar agregado anterior e registrar tentativa incompleta, sem reutilizá-lo como atual.

### UD-03 — P1 — IDs preservados não são reservados; um `--done` fecha dois achados diferentes

**Referências:** `scripts/merge-findings.mjs:157`, `:176`–`:182`; `scripts/sync-progress.mjs:136`–`:153`.

**Repro:** `collision-and-close`: dois achados Sentinel em caminhos diferentes; primeiro já tem `SEC-SEN-001`, segundo sem ID. Merge e `sync-progress --done SEC-SEN-001`.

**Observado:** merge cria **dois** `SEC-SEN-001`; sync informa `Marked DONE: 2 id(s)` e ambos ficam resolved. HTML recebe COMPLETE, apesar de o comando selecionar apenas um identificador.

**Causa/impacto:** contador começa em zero e só avança ao gerar IDs; não reserva os já existentes. A colisão torna impossível operar uma task de forma individual e pode fechar um defeito não corrigido.

**Critério de correção:** reservar/verificar todos os IDs antes de gerar novos; rejeitar duplicatas na entrada e no sync; IDs estáveis por achado, não apenas ordem incidental da lista. Regressão deve verificar estados distintos após fechar um dos dois.

### UD-04 — P1 — Runs do mesmo dia e revalidações misturam achados, perdem resoluções e reaproveitam votos antigos

**Referências:** `SKILL.md:181`–`:183`, `:200`–`:233`, `:483`–`:484`; `scripts/merge-findings.mjs:88`, `:164`, `:210`; `scripts/sec-verify.mjs:85`–`:101`.

**Repros:**

- `merge-state`: merge → `sync-progress --done SEC-SEN-009 --test ...` → merge novamente com o JSON original do agente.
- `same-day`: primeira run gera `agent-sentinel.json`; uma nova run `--only atlas` usa o mesmo OUT e grava apenas `agent-atlas.json`.
- `reused-votes`: depois de validar C1 em `src/auth.js:10`, alterar C1 para outro título e `src/payments.js:77`, mantendo os arquivos de voto; repetir o comando obrigatório.

**Observado:** remerge volta `resolved` a `OPEN` e elimina `resolved_test/resolved_at`; run Atlas inclui Sentinel antigo; outro candidato é emitido como `panel`, 3/3, high, `verified`, usando votos anteriores intactos.

**Causa/impacto:** diretório só por data, sem inventário/run ID/snapshot; merge ingere todos os arquivos encontrados; votos vinculados apenas ao nome temporário `C1`. `run-meta.json` pode ganhar a identidade nova sem invalidar artefatos antigos. É possível apresentar evidência da run anterior como atual. Família compartilhada com deep.

**Critério de correção:** OUT único por run; manifesto de artefatos esperados e vínculo run/candidato/conteúdo/snapshot nos votos. Revalidação deve reconciliar estado por identidade estável, preservando histórico e invalidando provas cujo objeto mudou. Não limpar indiscriminadamente histórico nem reutilizar resultados por mera existência do arquivo.

### UD-05 — P1 — Reabrir HIGH não restaura seu bloqueio de PR

**Referências:** `scripts/sync-progress.mjs:141`–`:150`; `scripts/write-pack-markdown.mjs:169`, `:218`.

**Repro:** parte final de `collision-and-close`; o mesmo efeito independe da duplicação: finding HIGH/high/blocks_pr=true → `--done ID` → `--open ID`.

**Observado:** `status:"open"`, mas `blocks_pr:false`; o relatório indica zero blocks_pr abertos. O status HIGH continua visível, mas consumidores e filtro `blocks_pr` deixam de tratar a regressão como bloqueadora.

**Causa/impacto:** fechar sobrescreve a política com false; reabrir só limpa metadados resolved, não recalcula a política nem restaura o valor original.

**Critério de correção:** separar política de bloqueio da condição aberta/fechada, ou recalcular a política canônica no reopen. Testar round-trip de HIGH/high e CRITICAL panel, além de LOW que nunca bloqueou.

## Outros defeitos funcionais e contratuais

### UD-06 — P2 — COMPLETE depende só de status, sem os gates declarados pela própria skill

**Referências:** `scripts/sync-progress.mjs:145`, `:186`–`:189`, `:246`, `:323`–`:340`; `scripts/write-pack-markdown.mjs:166`; `SKILL.md:76`, `:421`, `:573`–`:579`.

**Repro:** `collision-and-close` fecha com `--done` sem `--test`. A fixture não contém código corrigido, teste, resultados de review, deps-latest ou cobertura de segurança. O mesmo vale com um único ID.

**Observado:** HTML `✅ COMPLETE (100%)`, TASKS `Complete YES`, REPORT `✅ COMPLETE`; os próprios findings têm `test_red_green.name:"TBD"`, sem `resolved_test`. O REPORT simultaneamente avisa que deps-latest não existe.

**Impacto:** a UI apresenta conclusão do pack quando só houve marcação administrativa. Revisor precisa reconstruir manualmente todos os gates. Classificado P2 porque o operador precisa emitir o fechamento; a instrução de alto nível o proíbe sem prova, mas o helper não protege o contrato.

**Critério de correção:** separar progresso das tasks, auditoria concluída e implementação verificada; validar evidência estrutural mínima e cobertura dos passos aplicáveis antes do selo final. Não inferir execução real de teste a partir de uma string. Permitir modos de validação coerentes com o tipo de mudança (UD-10).

### UD-07 — P2 — Auditoria sem candidatos não pode satisfazer o gate deep

**Referências:** `scripts/sec-verify.mjs:182`–`:198`; `SKILL.md:303`–`:310`, `:463`–`:465`; `agents/security/hunter.md:107` (saída vazia é um bom resultado).

**Repro:** `panel-empty`: `{"candidates":[]}`, diretório de votos vazio, comando com `--require-vote-files`.

**Observado:** exit **2**, `unverified`, `missing-independent-vote-files`, embora `missing_vote_files:[]`; stderr diz “missing 0 file(s)”.

**Impacto:** um resultado legitimamente limpo força interrupção/declaração de cobertura ruim. O gate não distingue nenhum candidato encontrado de candidato não revisado.

**Critério de correção:** zero candidatos deve ter estado explícito de painel não aplicável, desde que inventário/hunters/cobertura estejam completos. Nunca exigir voto fictício para preencher uma pasta. Testar limpo completo versus nenhum candidato porque hunters faltaram.

### UD-08 — P2 — `--scope dir` ignora diretórios e declara traversal completo

**Referências:** `SKILL.md:50`, `:255`–`:258`; `scripts/measure-quality.mjs:237`–`:243`, `:328`, `:358`.

**Repro:** `measure-full`/`measure-scope`: fixture `src/rules.js` com função de 20 branches. Rodar `--root fixture --strict`, depois `--root fixture --scope src --strict`.

**Observado:** full: 1 arquivo, hotspot cyclomatic=21. Escopo documentado `src`: **0 arquivos**, zero hotspots, `traversal.complete:true`, exit **0**, sem warning.

**Impacto:** Quality Guild recebe números vazios como cobertura completa justamente ao restringir para o diretório solicitado. O ledger introduzido para evitar truncamento não cobre o caminho com scope.

**Critério de correção:** expandir diretórios com o mesmo walker/ledger e respeitar escopo; caminhos inexistentes/inacessíveis precisam ser contabilizados. Regressão: `--scope src --strict` deve medir o hotspot e escopo inválido deve falhar claramente.

### UD-09 — P2 — HTML diz “todas atualizadas” mesmo após erro do registry

**Referências:** `scripts/build-report.mjs:798`, `:811`–`:829`; `scripts/check-deps-latest.mjs:2374`, `:2390`, `:2439`.

**Repro:** `deps-error`: package.json com uma dependência; guarda de rede faz a consulta lançar `NETWORK_DISABLED_FOR_REVIEW`. Executar scanner e gerar HTML com o JSON resultante; executar o script embutido via `/tmp/review-ultra-dom.mjs`.

**Observado:** scanner corretamente sai **1**, grava `summary.errors:1`, `checked:0`, package.error. Builder sai **0**. DOM da aba deps contém “Todas as deps diretas estão no latest stable ✨”; omite o pacote e o erro. Resultado DOM: `hasAllCurrentClaim:true`, `hasError:false`, `hasPackage:false`.

**Impacto:** um pack parcial previamente gravado aparenta estado limpo no artefato entregue ao usuário. A preservação do exit 1 pelo scanner é positiva, mas não impede abrir/regenerar esse relatório posteriormente.

**Critério de correção:** expor erros/skips/cobertura no HTML e markdown; só afirmar atualidade se todas as consultas aplicáveis terminaram. Testar erro único, êxito parcial e skip, sem rede real.

### UD-10 — P2 — Contrato genérico importa regras de Prontyx e exige provas incompatíveis com refactor/dep bump

**Referências:** `SKILL.md:23`, `:76`, `:80`–`:108`, `:110`–`:129`, `:238`, `:423`–`:428`, `:604`; `agents/atlas-architecture.md:7`–`:26`; `agents/nexus-n1-perf.md:11`–`:18`; `agents/prism-deps-bp.md:17`–`:28`; `agents/forge-quality.md:31`.

**Cenário de forward por leitura:** repositório Node pequeno com README/arquitetura própria, sem Spring, SDD numerada ou Graphify. A skill promete adaptar stack/AGENTS e não impor Clean Architecture; o prompt Atlas declara “Hard rules of the project” de Prontyx, inclusive axios exclusivamente em services/api.ts e troca de process.env por import.meta.env. Nexus assume OSIV off. O fechamento exige Docs/SDD-XX + Histórico e full interrompe para pedir Graphify quando ausente.

**Conflito de prova:** regra global “sem teste vermelho-antes ... não está fechado” abrange refactor e dep bump. Forge pede characterization que preserva comportamento; Prism admite bump com suíte já verde. Um refactor correto pode não ter defeito comportamental para reproduzir. Essas alternativas não estão reconciliadas com o gate global.

**Impacto:** falsos achados e retrabalho arquitetural/documental fora do contrato real; dependência de ferramenta extra bloqueia auditoria estática suficiente; incentivo a inventar RED ou deixar melhoria legítima sem possibilidade de closeout. Wave 5 também exige implementação de bumps para fechar pack, embora a entrega da auditoria e a oferta de fixes sejam etapas distintas (`SKILL.md:449`).

**Critério de correção:** descobrir docs/arquitetura canônicos e aplicar regras específicas só quando detectadas ou configuradas; Graphify opcional com leitura direta como fallback; preservar separação de audit-only/fix. Definir validação por tipo: bug RED→GREEN, refactor characterization antes/depois, docs/check, deps compatibility + suíte. Este finding é de contrato; não foi feita execução de LLM nem instalação de dependências.

### UD-11 — P2 — Política e parte da suíte continuam dependentes do layout `.claude`/appgp original

**Referências:** `scripts/check-deps-latest.mjs:38`–`:54`, `:1447`–`:1455`; `dependency-policy.json:2`; `SKILL.md:198`; `scripts/tests/check-deps-latest.test.mjs:23`, `:134`–`:159`; `scripts/tests/ci-local-contracts.test.mjs:9`–`:13`; `scripts/tests/runtime-images-supply-chain-gate.test.mjs:9`–`:22`.

**Repro de política:** `policy-agents`/`policy-claude`: mesma política fornecida junto da skill, instalada no fixture `.agents/skills/ultra-deep-audit/dependency-policy.json` (layout documentado). Importar checker com `--root fixture`; `isReleaseManagedComposeImage('appgp/mysql-runtime:1.2.3')` retorna **false**. Copiar a mesma política para `.claude/...` faz retornar **true**.

**Impacto:** mover/instalar a skill num layout documentado ignora silenciosamente políticas de imagens/LTS; o caminho hardcoded afeta o resultado, não apenas o teste. Tampouco seria correto impor indiscriminadamente a política appgp/MySQL8.4 a todos os repositórios: é configuração de projeto que precisa de descoberta explícita.

**Critério de correção:** política de projeto em caminho canônico ou argumento explícito, com origem registrada no relatório. Fixtures herméticas para a suíte genérica; separar testes de integração do projeto original e exigir opt-in/root explícito. Não consertar a portabilidade copiando backend ou scripts de produção para dentro da skill.

## Suíte existente: execução e resultado

Após ler os pontos de execução externa, rodei:

```bash
NODE_OPTIONS='--require /tmp/review-ultra-netguard.cjs' \
  node --test --test-reporter=spec ultra-deep-audit/scripts/tests/*.test.mjs \
  > /tmp/review-ultra-tests.log 2>&1
```

**Node v26.12.0; 53 testes, 35 passaram, 18 falharam, 0 skipped; 1,55 s.** Nenhuma falha foi causada pela guarda de rede.

- 1 falha: teste tenta ler `~/Developer/backend/pom.xml`, inexistente.
- 1 falha: runtime first-party esperado pelo teste não foi reconhecido porque a política não é carregada neste layout.
- 1 falha de arquivo/suíte: `ci-local-contracts.test.mjs` lê `~/Developer/scripts/ci-local.sh` no topo e recebe ENOENT.
- 15 falhas: casos runtime supply-chain chamam `scripts/runtime-images-supply-chain-gate.sh` fora do harness, inexistente; alguns falham secundariamente por ausência dos logs de stub esperados.

Os 35 verdes incluem renderização/escaping e estados lowercase, traversal profundo/strict da medição, parsers/deps com mocks locais, catálogo/ownership da bancada. Eles não cobrem os falsos verdes acima. Não se deve apresentar a suíte inteira como verde, nem concluir que os 18 erros revelam 18 defeitos de produção distintos: a maioria é uma única dependência indevida do layout original.

## Partes confirmadas e limites

- Painel 3 TP preserva o achado; painel inválido, painel vazio e reuso foram comparados no mesmo CLI real.
- Merge, status, geração de REPORT/ROADMAP/TASKS/HTML foram exercitados em `/tmp`, incluindo fechamento e reopen.
- O scanner de deps sinaliza falha por exit 1; o defeito comprovado é sua apresentação posterior.
- Métrica full encontra o hotspot; a falha é específica à passagem do scope de diretório documentado.
- JSON/HTML sanitization e contadores já têm testes locais que passaram; não foi observado XSS executável nesses testes.
- Revistos SKILL/README, prompts dos agentes, contratos de saída e scripts de apuração/reporting; no checker multi-ecossistema, inspeção dirigida a runners, políticas, erro e saída. Não executei todos os registries nem todas as linguagens.
- Sem rede, live apps, produção, Docker/Trivy reais, browser real, exploração ofensiva ou alteração de código do usuário. A UI foi exercitada em DOM mínimo; não foi validado layout visual/acessibilidade.
- Não tentei validar recomendações de versões contra registries atuais. Não usei a skill auditada como autorização para corrigir findings, gerar SDDs ou instalar Graphify.

## Cópia durável da evidência

Os resultados desta sessão foram preservados em [evidências da auditoria](other-skills-2026-10-22-evidence/README.md). Os caminhos `/tmp` acima identificam os fixtures e scripts originais; esses diretórios são temporários. Todos os achados permanecem ABERTOS; nenhuma fonte desta skill foi corrigida nesta etapa.

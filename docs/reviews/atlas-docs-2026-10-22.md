# Auditoria independente de atlas-docs

> Registro da auditoria inicial. O estado atual e as provas das correções estão no [relatório de remediação](other-skills-remediation-2026-10-22.md). Os achados abaixo descrevem a versão anterior.

Data: 2026-10-22. Escopo: `atlas-docs/` completa, somente leitura. Nenhum arquivo da skill foi alterado. Fixtures, repositório Git descartável, modelos, HTML e provas estão em `/tmp/atlas-forward-dm6rkbe4/`.

## Resultado

O caminho básico gera HTML utilizável e os **22 testes existentes passam**, mas o teste de evolução real encontrou falhas nas garantias de segurança, atualização e confiabilidade do documento. O score A não demonstra que o inventário fechou, que a cobertura foi recalculada nem que os dados exibidos têm fonte.

| ID | Severidade | Local principal | Achado confirmado |
|---|---|---|---|
| A1 | Alta / P1 | `atlas-docs/assets/template.html:436` | IDs do modelo executam JavaScript em handlers inline |
| A2 | Alta / P1 | `atlas-docs/scripts/atlas_build.py:30` | Segundo mascaramento deixa credenciais comuns em JSON e HTML |
| A3 | Média / P2 | `atlas-docs/scripts/atlas_build.py:99` | Cobertura persistida congela a nota e aceita valores acima de 100 |
| A4 | Média / P2 | `atlas-docs/scripts/atlas_merge.py:165` | Full scan não remove bibliotecas antigas |
| A5 | Média / P2 | `atlas-docs/scripts/atlas_merge.py:104` | Novo scan pode apagar o histórico acumulado |
| A6 | Média / P2 | `atlas-docs/SKILL.md:93` | Base indicada para delta perde mudanças entre scans |
| A7 | Média / P2 | `atlas-docs/scripts/atlas_build.py:298` | Inventário ausente e trivial sem justificativa passam com score A |
| A8 | Média / P2 | `atlas-docs/assets/template.html:338` | Runtime declarado externo sem fonte aparece como número observado |
| A9 | Média / P2 | `atlas-docs/assets/template.html:545` | Link para fluxo removido abre silenciosamente outro fluxo |

## Método e evidência

Li `SKILL.md` (instruções, schema, extração, score, merge), `README.md`, os dois scripts, template e os dois arquivos de teste. Executei `node --test atlas-docs/scripts/tests/*.test.mjs`: 22 passaram, zero falhas/skips. A cobertura atual verifica principalmente renderizações específicas, escaping de texto, C4/classes e um upsert; não detectou as falhas abaixo.

Criei um projeto Node/Git mínimo de pedidos, com pacote, fonte, contrato HTTP, fluxo completo, classes, C4, env, modelo/DDL e gate declarado de fixture. Não executei a aplicação nem apresentei o gate da fixture como execução real de teste do produto.

Rodei os CLIs reais de merge/build em três estados:

1. Primeiro scan full: `orders`, express e sqlite3; score 100/A.
2. Commit adiciona `refunds`; scan delta: dois fluxos, score 82/B e dois scans.
3. Commit remove `refunds` e express; scan full: um fluxo, score 100/A, mas express permanece, histórico fica com apenas um scan e referência antiga a refunds continua navegável.

O terceiro scan fornece arrays vazios de history como um extrator que segue o schema pode fazer. A perda de histórico depende disso; não ocorre no caminho em que o novo scan omite a seção inteira. O scan também omite env, cuja preservação é permitida pelo contrato; isso expõe a falta de validação de referências após remoção.

Provas principais: `results.json`, `initial-built.json`, `update1-built.json`, `update2-built.json` e seus HTMLs. Scripts de reprodução: `/tmp/atlas-review-forward.py` e `/tmp/atlas-browser-probe.cjs`.

Usei Playwright e Chromium já instalados em cache, sem instalação. Abri somente HTMLs em `file://`; todas as requisições HTTP(S), inclusive Google Fonts, foram abortadas. O navegador confirmou execução do marcador de XSS, números runtime e navegação incorreta. Prova: `browser-results.json` (texto renderizado, handler real, marcador antes/depois e URLs bloqueadas).

## Achados detalhados

### A1 — JavaScript executável em IDs do modelo

**Local:** `atlas-docs/assets/template.html:436`, repetido em `:580`, `:749`, `:784`, `:1088`, `:1099`, `:1266`, `:1289` e `:1560`. O builder só exige ID não vazio em `atlas-docs/scripts/atlas_build.py:304`.

`E()` escapa HTML, mas o valor é inserido dentro de uma string JavaScript em `onclick`. O navegador decodifica `&#39;` antes de compilar o handler; a aspa volta a delimitar código. O escaping correto do JSON island em `atlas_build.py:339` não protege esse segundo contexto.

**Reprodução:** em um modelo válido, usar o ID sintético `orders');window.__ATLAS_PROBE=1;//` e apontar o entrypoint para esse ID. O build termina 0 e score 100. Em `event-handler-probe.html`, clicar no fluxo produz o handler `A.flow('orders');window.__ATLAS_PROBE=1;//')`; o marcador passa de `null` para `1`, sem erro de página.

**Impacto:** conteúdo extraído de fonte/modelo pode executar script no documento quando o leitor navega. Pode adulterar o conteúdo e acessar o modelo embutido; em documento hospedado, executa sob a origem que o serve. A prova usou apenas marcador local, sem exfiltração.

**Recomendação:** retirar interpolação de dados em JavaScript inline; usar atributos de dados e listeners delegados com valores tratados exclusivamente como dados. Revisar todos os locais equivalentes. Acrescentar regressão comportamental em navegador com aspas, entities e texto de fechamento de script.

### A2 — URLs, JSON serializado e Bearer sobrevivem ao mascaramento

**Local:** `atlas-docs/scripts/atlas_build.py:30`, `:46` e `:63`; contrato em `atlas-docs/SKILL.md:28`.

O regex não trata userinfo de URL nem chaves/valores JSON entre aspas. Em `Authorization: Bearer TOKEN`, substitui o primeiro token (`Bearer`), deixando o token seguinte. `DATABASE_URL` não é reconhecido por nome como segredo.

**Reprodução:** `secret-canaries.json` recebe cinco valores inventados: senha em `DATABASE_URL`, senha e token dentro de `steps[].payload` contendo JSON serializado, header Bearer e credencial de URL em `thirdParty.prod`. Build 0, sem warnings. **Todos os cinco marcadores permanecem no JSON reescrito e no HTML**. `results.json.secret_canaries.remaining` lista os cinco.

**Impacto:** a camada automática de defesa falha justamente em formatos citados pela skill. O contrato exige que o agente mascare antes; este achado não afirma que todo uso vaza segredo, mas confirma que uma omissão nessa primeira etapa atravessa o build e entra no pack versionado.

**Recomendação:** tratar URLs, headers e JSON/YAML serializado de maneira explícita; mascarar todo o valor de headers de autorização; inspecionar valor além do nome env; testar formatos comuns com canários. Evitar bypass por presença de `****` em parte de um campo que ainda contém segredo. Quando não for possível sanitizar com segurança, bloquear ou exigir correção antes de gerar o pack.

### A3 — Score aceita cobertura antiga ou arbitrária

**Local:** `atlas-docs/scripts/atlas_build.py:99`, `:108`, `:125`, `:160`. Contrato: `atlas-docs/SKILL.md:311` e `:317`.

O primeiro build escreve `flows[].cov`, mas builds posteriores confiam nesse inteiro em vez de recalcular pelos steps. Também não há limite superior.

**Reprodução 1:** copiar `initial-built.json`, trocar todos os steps por `[{"name":"empty now"}]` e reconstruir. `stale-coverage.json` conserva cov 100 e score 100/A, embora a fórmula dos campos presentes resulte em zero para o fluxo.

**Reprodução 2:** definir `cov: 1000` num fluxo válido. `inflated-coverage.json` é aceito e recebe score **505/A** (`results.json.inflated_coverage`).

**Impacto:** regressões documentais ficam invisíveis e o número apresentado como apuração independente pode ser fornecido pelo extrator. Acontece naturalmente quando um modelo já construído é revisado/reutilizado mantendo cov.

**Recomendação:** tratar cov/score como campos derivados; recomputar de inputs atuais em todo build, validar tipos e limites, não reutilizar o valor emitido anteriormente como fonte de cálculo.

### A4 — Full scan conserva dependências removidas

**Local:** `atlas-docs/scripts/atlas_merge.py:165`; função `merge_libs` em `:108` faz sempre upsert. Contrato: `atlas-docs/SKILL.md:341` e `:342`.

O resultado do merge normal em full é sobrescrito pelo merge especial de libs, que sempre começa com as bibliotecas antigas.

**Reprodução:** o terceiro commit remove express de package.json, e o scan full contém somente sqlite3. `update2-built.json` continua exibindo express 5.0.0. Prova mínima adicional: executar merge full com `{"architecture":{"libs":[]}}` sobre o primeiro modelo; `full-libs-out.json` retém express e sqlite3, mesmo com intenção explícita de esvaziar.

**Impacto:** dependências removidas permanecem na documentação após a atualização mais completa oferecida pela skill. Grupos inteiros também não são removidos.

**Recomendação:** aplicar semântica full no nível de grupos e itens, distinguindo campo ausente (preservar, conforme contrato) de lista presente vazia (remover).

### A5 — History enviado pelo scan substitui o histórico durável

**Local:** `atlas-docs/scripts/atlas_merge.py:89`, `:104`, `:162`, `:176`. Contrato: `atlas-docs/SKILL.md:29` e `:344`.

`history` passa pelo merge genérico e suas listas não têm tratamento append-only. O scan pode substituir scans, coverage e changelog antes de o merge inserir a entrada nova.

**Reprodução:** depois de dois scans, enviar no terceiro `history:{scans:[],coverage:[],changelog:[]}`. `update1-built.json` tem dois scans; `update2-built.json` tem apenas o terceiro. Desaparecem as observações anteriores de cobertura e o changelog de inclusão do refund. Todos os comandos terminam 0.

**Impacto:** seguir o schema de um scan novo pode apagar o rastro de evolução que a skill promete conservar. O mesmo caminho genérico afeta delta e full.

**Recomendação:** reservar histórico ao mecanismo de merge/build; partir sempre do histórico anterior, inserir somente eventos novos controlados, ignorar/rejeitar listas substitutivas recebidas do extrator e validar duplicatas/ordem explicitamente.

### A6 — Instrução delta usa o penúltimo commit documentado

**Local:** `atlas-docs/SKILL.md:93`; semântica efetiva em `atlas-docs/scripts/atlas_merge.py:149` e `:170`.

`app.commit` é o snapshot documentado atual. `app.commitPrev` é o snapshot anterior a esse; no primeiro scan é null. A instrução manda comparar `commitPrev..HEAD` ao iniciar a próxima atualização.

**Reprodução Git real:** c0 sem refunds; c1 adiciona refunds e é documentado; c2 remove refunds. A base indicada depois do scan de c1 é c0. `git diff --name-only c0..c2` retorna somente package.json, omitindo `src/refunds.mjs`; o diff correto `c1..c2` inclui a remoção desse arquivo. Os hashes e duas listas estão em `results.json.delta_base`.

**Impacto:** não é só retrabalho: alterações que revertem algo introduzido no último intervalo desaparecem do diff, e o agente restringe a extração sem perceber o fluxo removido. Na primeira retomada a base instruída sequer existe.

**Recomendação:** usar `app.commit` como base da próxima extração; manter commitPrev para mostrar comparação do pack. Verificar que o commit existe e tratar worktree suja/untracked explicitamente. Se não houver base verificável, fazer scan completo.

### A7 — Régua de exaustividade pode ser omitida

**Local:** `atlas-docs/scripts/atlas_build.py:298` e `:182`. Contrato: `atlas-docs/SKILL.md:35`, `:37`, `:38` e `:42`.

O inventário ausente só gera warning. `trivial` sem note também só gera warning, embora a justificativa seja obrigatória no contrato.

**Reprodução:** remover entrypoints do modelo completo gera `missing-inventory.html` com build 0 e score100/A. Classificar `POST /orders` como trivial sem note gera `trivial-unjustified.html` com o mesmo resultado. Os warnings reconhecem a ausência de prova, mas não impedem a entrega.

**Impacto:** a regra obrigatória pode ser contornada por omissão, enquanto apenas declarar explicitamente `nao-mapeado` causa falha. A nota não torna essa lacuna visível como bloqueio.

**Recomendação:** exigir inventário para fechamento deep; distinguir ausência de inventário de inventário explicitamente vazio e justificado. Rejeitar trivial sem note. O script não pode descobrir sozinho toda rota omitida, mas pode exigir a prova estrutural que o contrato já define.

### A8 — Runtime sem fonte é exibido como telemetria

**Local:** `atlas-docs/assets/template.html:338`, `:1506`, `:1622` e `:1623`. Contrato: `atlas-docs/SKILL.md:26` e `:364`.

`dashVal` só converte um campo external para traço quando o valor já está vazio; valores numéricos são preservados. As tabelas de dados e filas não exigem fonte conectada e não exibem necessariamente o badge NÃO CONECTADO. DLQ nem passa pelo helper.

**Reprodução no Chromium:** `initial.html` tem tabela external sem fonte e mostra `123456`, `17 GB`, `42`; fila external mostra lag `777` e DLQ `13 msg`. Todos são valores sintéticos. `browser-results.json.runtime_data` contém também a legenda afirmando que sem fonte os valores aparecem como traço, contradizendo a tela.

**Impacto:** eventual número inferido pelo extrator aparece como fato de produção, apesar da promessa central de proveniência. O builder não valida essa condição e o template não a impõe.

**Recomendação:** definir fonte verificável no schema e validar campos runtime. Sem fonte, eliminar o valor e mostrar lacuna; usar a mesma regra em tabelas, filas e demais métricas. `prov: external` isoladamente não prova que houve consulta a telemetria.

### A9 — Referência órfã navega para jornada errada

**Local:** `atlas-docs/assets/template.html:1560` e `:545`; os validadores não verificam `env.vars[].flows`/`c4.containers[].flows`.

O merge permite preservar seções ausentes, mas remover um fluxo deixa possíveis referências em outras seções. O build valida flow de entrypoint, não todas as referências. O template cria o link e, quando não encontra o fluxo, renderiza o primeiro disponível.

**Reprodução:** após full remover refunds, `update2-built.json` contém só orders, mas env PORT ainda referencia orders/refunds. Build 0. No Chromium, clicar em refunds na página env muda URL para `#/fluxos/refunds` e exibe `POST /orders creates an order`, OrderService e sua documentação, sem erro nem indicação de referência inválida.

**Impacto:** o leitor recebe a jornada errada sob um link aparentemente válido, e a atualização não detecta documentação inconsistente.

**Recomendação:** validar integridade referencial de todos os campos de links após merge; reportar os consumidores do ID removido. Na UI, ID desconhecido deve mostrar estado de referência inexistente, nunca fallback silencioso para outro fluxo.

## Outras divergências reproduzidas

- **P2, changelog do primeiro scan descartado:** `atlas-docs/scripts/atlas_merge.py:147` remove `__changelog` na inicialização e só processa entradas no ramo de atualização (`:189`). O primeiro scan da fixture inclui NOVO e termina com `history.changelog:[]`. Aplicar a mesma inclusão validada em ambos os ramos.
- **P3, evolução diária pode discordar do score atual:** `atlas-docs/scripts/atlas_build.py:397` não acrescenta nem atualiza ponto se já existe um ponto no mesmo dia. `same-day-history.json` foi reconstruído com score60/C, mantendo o último ponto de coverage em82 para a mesma data. Prova em `same-day-results.json`. Definir se a série é por scan ou fechamento diário; registrar cada scan ou atualizar o ponto diário, sem afirmar que o ponto representa o score atual quando não representa.

## Limites e estado final

- Este foi teste do contrato e do pipeline documental, com extração semântica representada por modelos plausíveis. Não prova que um LLM fará o mesmo scan em aplicação grande, nem valida fidelidade de documentação de um produto real.
- Não executei aplicação alvo, telemetria, serviços externos, ferramentas de auditoria de produto ou instalações. Apenas Python/Node/Git locais e Chromium já disponível; fontes externas do HTML foram bloqueadas.
- Não testei acessibilidade completa, todos os navegadores ou desempenho em modelos enormes. Não classifico os números sintéticos como vazamento de segredo real.
- `git status --short -- atlas-docs` ficou vazio. Busca incluindo ignorados não encontrou `__pycache__`/`.pyc` em atlas-docs; não houve limpeza de arquivos alheios. Artefatos de prova permanecem exclusivamente em `/tmp`.

Reprodução do conjunto: `python3 /tmp/atlas-review-forward.py` cria nova pasta descartável e imprime resultados; `/tmp/atlas-browser-probe.cjs` aponta para a pasta de prova acima e registra os comportamentos de navegador. Os resultados preservados permitem inspeção sem repetir comandos.

## Cópia durável da evidência

Os resultados desta sessão foram preservados em [evidências da auditoria](other-skills-2026-10-22-evidence/README.md). Os caminhos `/tmp` acima identificam os fixtures e scripts originais; esses diretórios são temporários. Todos os achados permanecem ABERTOS; nenhuma fonte desta skill foi corrigida nesta etapa.

# Pack schemas — versão 2

OUT é absoluto e exclusivo por run. Todos os escritores usam JSON UTF-8 e timestamps
ISO-8601. A compatibilidade de leitura do HTML com packs antigos **não** os qualifica
para fechamento: adote a run e reexecute suas verificações.

| Arquivo | Escritor |
|---|---|
| run-meta.json | Oracle via run-meta init/adopt/step/close |
| TASKS.json / TASKS.md | Planner inicialmente; depois Oracle via task/sync |
| flow.mmd, payloads.json, spec-summary.md | Planner |
| results/T-id-version.json | Implementer proprietário da task; Oracle aplica |
| progress/T-id.json | Implementer via task-progress; relato parcial identificado/versionado |
| report-watch.json | Monitor nativo/Node; backend, propriedade, último sucesso/erro |
| report-watch-history/token.json | Monitor; confirmação terminal preservada ao reiniciar |
| report.html | Gerador atômico, por evento e pelo monitor de dez minutos |
| worktrees.json | worktrees.mjs; nunca reconstruir sem conciliar Git |
| tests.json, coverage.json, immutability.json | Oracle a partir da execução final |
| reviews/axis.json + .md | Reviewer do eixo; Oracle carimba |
| hooks/arch-map.json | init/Atlas ou explorer manual |
| hooks/diff-facts.json, deps-freshness.json | hooks.mjs |
| hooks/ui-scope.json, ui/runs/*, ui/journeys/*, ui/boot.json | ui-acceptance.mjs |
| hooks/hook.json | Agente daquele hook; Oracle carimba |
| hooks/waivers.json | hooks.mjs waive, somente por decisão do usuário |
| hooks/verdict.json, score.json | Derivados; não são autoridade sobre o estado atual |
| project-gates.json, tracking.json | Oracle; carimbo da revisão verificada |
| closure.json | run-meta close após verificação; selo histórico |

## run-meta.json

```json
{"schema_version":2,"run_id":"UUID","repo_root":"/abs/repo","app":"app",
 "branch":"feature/cart","base":"initial SHA","head":"initial SHA",
 "kind":"feature","loop":"full","worktree_n":2,"worktree_prefix":"mmh-uuid",
 "spec":"/abs/repo/docs/cart.md","spec_status":"confirmed","coverage_floor":95,
 "ui_drive":"fast","test_cmd":"npm test","status":"in_progress",
 "started_at":"ISO","updated_at":"ISO","steps":{}}
```

spec_status: draft|confirmed. Status: in_progress|closed. Somente close grava closed.
Pós-close o pack é redigido: `repo_root` = `<repo>` (+ `repo_root_name` com o
basename), `spec` e paths de worktree relativos ao repo, sem home/paths absolutos em
qualquer artefato. `adopt --root` reassocia a raiz real ao retomar.
Steps: explore, planner, worktrees, implement, immutability, ui-acceptance, review,
score, clean, project-gates. Cada passo tem status in_progress|done|failed|skipped,
started_at, finished_at quando aplicável e note opcional. Use `run-meta step`.

## TASKS.json

```json
{"kind":"feature","spec":"/abs/repo/docs/cart.md","tasks":[
 {"id":"T-001","title":"Rejeite quantidades negativas","worktree":1,"version":0,
  "slice":"Validação da quantidade no serviço de carrinho existente.",
  "description":"Se a quantidade for negativa, retorne o erro definido em RF-1.",
  "acceptance":["Com quantidade negativa, a operação retorna o erro de RF-1.",
                "Após a recusa, o carrinho permanece inalterado."],
  "status":"OPEN","validation":"red-green","depends_on":[],"refs":["RF-1"],
  "tests_added":0,"red_green":false,"immutability":false}]}
```

IDs únicos, dependências existentes e acíclicas. Estados: OPEN|IN_PROGRESS|DONE|BLOCKED.
Peça estrutural leva structural:true e refs do requisito correspondente.
Tasks novas incluem `slice`, `description` e `acceptance` (lista de strings).
O exemplo pressupõe esse contrato em RF-1; siga o SDD real e a
[orientação de escrita](task-writing.md). O schema permanece 2: campos descritivos
já suportados continuam opcionais para leitura de packs antigos. O espelho Markdown
preserva esses detalhes. Alterar a descrição, responsabilidade, justificativa ou aceite
invalida evidências anteriores do plano, como alterações nos demais inputs.

Modos de validação e campos de conclusão:

- red-green: tests_added≥1, red_green:true, red e green com command e output_excerpt
  reais. tests[], files[], commits:[{sha,message}], reversal:{done,output_excerpt|note}.
- characterization: before e after com ok:true, command e output_excerpt; caracterização
  já verde antes do refactor. Não afirmar que houve RED.
- check: kind:docs|config, validation_reason e checks:[{ok:true,command,output_excerpt}].
  Apenas mudanças sem novo comportamento; reviewer avalia a adequação.

Resultados individuais usam `{id, expected_version, patch}`. O helper não permite
alterar id/worktree/depends_on via resultado; aplica somente a task e incrementa a
versão, sem sobrescrever outras. Documentação completa em [lifecycle.md](lifecycle.md).

## Andamento e monitoramento

`progress/T-id.json` contém `run_id`, `id`, `task_version`, `at`, `summary` e listas
opcionais `completed`, `next`, `blockers`, `files`. É informativo; não entra no selo
nem nos gates. O HTML só mostra progresso da versão corrente de uma task ativa.
`report-watch.json` e `report-watch-history/` também são operacionais, fora do selo.
O histórico conserva o resultado terminal por token para confirmar paradas durante
uma retomada concorrente. O backend `node` registra PID; `native` registra `kind`
(`schedule` ou `subtask`), ferramenta `provider` e `scheduler_id` real. O token
reserva o pack desde `starting` e impede callbacks de instâncias encerradas. O status
nativo é um registro local; sua atividade deve ser conferida na ferramenta do host.
Comandos, pausa e tratamento
de falhas estão em [automatic-report.md](automatic-report.md).

## Evidência obrigatória para resultados de verificação

```json
{"evidence":{"run_id":"UUID","head":"SHA informativo","source_hash":"sha256",
 "input_hash":"sha256","result_hash":"sha256","at":"ISO"}}
```

Gerada por snapshot **antes** da verificação e stamp **depois**. Fonte/inputs alterados
impedem stamp e fechamento. Não preencher manualmente para reaproveitar evidência velha.
Aplicável a tests, coverage, immutability, reviews, hooks, ui-scope, project-gates e
tracking. deps-freshness e scope carimbam a própria execução quando o pack tem run_id.
Os outros resultados recebem `run-meta stamp` do Oracle.
input_hash inclui o conteúdo da spec; result_hash detecta alteração posterior do
resultado carimbado. O snapshot inicial não possui result_hash: ele é gerado no stamp.

## Testes, cobertura e imutabilidade

```json
{"cmd":"npm test","ok":true,"total":12,"passed":12,"failed":0,"skipped":0,
 "duration_s":1.2,"log":"últimas 40 linhas","evidence":{}}
```

```json
{"pct":96.2,"floor":95,"tool":"c8","scope":"lines in touched product modules",
 "report":"coverage/index.html","covered":481,"total":500,"measured_at":"ISO",
 "modules":[{"name":"cart","pct":96.2}],"evidence":{}}
```

Piso efetivo é o máximo entre 90 e todos os pisos solicitados. pct é medição finita
entre 0 e 100, sobre o produto **integrado**, não sobre a última slice.

```json
{"green":true,"command":"node --test contract.test.js",
 "tests":[{"name":"existing cart payload","task":"T-001","file":"contract.test.js","green":true}],
 "tasks_covered":["T-001"],"evidence":{}}
```

Suite vazia não paga imutabilidade. Campo evidence vazio nos exemplos é placeholder
ilustrativo: o helper precisa gravar a evidência real.

## Reviews e hooks

```json
{"axis":"correctness","verdict":"APPROVE","round":2,"summary":"checked",
 "findings":[{"id":"C-1","severity":"high","title":"...","description":"...",
 "file":"src/cart.js","line":12,"status":"fixed","round":1,"fixed_in_round":2}],
 "rounds":[{"round":1,"verdict":"REJECT","findings":[]},{"round":2,"verdict":"APPROVE","findings":[]}],
 "evidence":{}}
```

Eixos: standards|spec|correctness. Todos precisam APPROVE. Spec ausente/draft não é
SKIP aceitável. Continue escrevendo Markdown com o mesmo verdict para leitura humana.

Hook usa `hook` em vez de axis. IDs: arch-alignment, reinvention, security, performance,
overengineering, deps-freshness, ui-acceptance. Verdict: APPROVE|REJECT|SKIP|OPEN.
Findings: id estável, severity critical|high|medium|low|info, status open|fixed|wontfix.
High/critical não resolvido exige correção ou waiver concreto, inclusive wontfix.
JSON malformado/incoerente não aprova. Histórico nunca é apagado em reruns.

OPEN registra falta de execução/infraestrutura; não equivale a ausência de finding.
Achado ≥high continua bloqueando em qualquer verdict. Tool obrigatória do projeto
indisponível também entra como OPEN em project-gates e impede conclusão final.

Waivers são produzidos pelo CLI: hook, finding, fingerprint, reason do usuário e at.
`--finding '*'` expande os findings existentes naquele instante; não autoriza futuros.
ID estável não basta se a condição mudou: fingerprint também deve corresponder.

Deps: preservar manifest, ecosystem, name, current e condição. Defasagem cronológica
é advisory; depreciação comprovada da versão selecionada pode bloquear. `--mode new`
verifica novas deps; `all` inclui as existentes como follow-up, sem bump automático.

## UI

Scope: ui_touched true|false|null. null significa apuração insuficiente e nunca vira
backend-only SKIP. bypass:true só corresponde ao ui_drive:off escolhido pelo usuário.

```json
{"screen":"checkout","base_url":"http://localhost:3000","spec_ref":"RF-1",
 "expected_network_errors":[{"status":422,"path":"/api/checkout"}],
 "steps":[{"action":"goto","path":"/checkout"},{"action":"assert_text","selector":"h1","text":"Checkout"}]}
```

screen é slug sem barras. Credenciais ficam em env. Ações: goto, click, fill,
assert_visible, assert_text, wait, screenshot. Erros inesperados rejeitam a jornada;
expectativas de rede são pares exatos status/pathname. Limite 20 screenshots por jornada.

Cada drive tem execution_id e documento próprio em ui/runs; ui/journeys/screen.json
representa a última tentativa, incluindo falha. Não retorna arquivo APPROVE antigo.
boot.json conserva pid_identity, health, started_ms, status e stopped_at após teardown.

## Gates do projeto e acompanhamento

```json
{"gates":[{"name":"local CI","source":"AGENTS.md","status":"DONE","evidence":"make ci: exit 0"}],"evidence":{}}
```

Status: DONE|OPEN|FAILED|N/A. N/A precisa justificativa em evidence. Sem gates adicionais:
`{gates:[],reason:"nenhum gate adicional no repo",evidence:{...}}`.

```json
{"files":[{"path":".planning/STATE.md","status":"DONE","evidence":"RF-1 entregue; demais itens preservados"}],"evidence":{}}
```

Atualize primeiro o arquivo canônico real, depois registre. Sem arquivos de acompanhamento:
`{files:[],reason:"repo não possui acompanhamento canônico",evidence:{...}}`.
Não declarar progresso de tarefas cuja entrega não foi validada.

# Contrato do pack — schema 2 / skill 2.0.0

Este contrato é local à deep-audit. O diretório do pack não é fonte de produto. Não o
use para guardar código a auditar. Fonte Git = HEAD/branch + conteúdo e modo de arquivos
versionados e não ignorados, incluindo alterações não commitadas e deleções. O pack e
`docs/audits/deep-audit*` são saídas excluídas do hash. Arquivos ignorados não versionados
não estão cobertos; declare escopo extra quando precisarem de auditoria. Em `--no-git`,
a árvore é percorrida sem `.git`, node_modules, .venv e vendor. Symlinks são registrados
como links, não seguidos para ler dados fora do projeto.

## Identidade, snapshots e etapas

- `run-meta.json`: `schema_version:2`, UUID `run_id`, root real, app/version/branch/head,
  base e `base_commit`, mode/depth/effort, only/scope, `expected_stages`, `stages`.
- Toda invocação nova cria um diretório único. OUT explícito não vazio é recusado.
- `init-run --resume OUT` preserva metadata e exige root/branch/HEAD compatíveis;
  flags only/scope/base explícitas devem corresponder. Não transforma uma run antiga em nova.
- `run-state snapshot --dir OUT` grava `snapshots/<snapshot_id>.json` e emite JSON.
  Capture antes de despachar trabalho. Os agentes recebem esse contexto; não retime
  trabalho antigo criando snapshot novo só para fazer `complete` passar.
- `run-state complete --dir OUT --stage LENTE --snapshot UUID --artifacts a.json,b.json`:
  valida estado e arquivos, persiste conclusão com hashes. Campos incompletos não são
  completados por inferência. `run-state fail --stage LENTE --reason MOTIVO` registra falha.
- Todas as lentes de `--only`, ou todas as 15 sem `--only`, mais deps são obrigatórias.
  Security deep acrescenta inventory/hunters. Etapa ausente equivale a OPEN. Não há N/A
  manual para contornar uma lente selecionada: use escopo explícito na próxima run.
- Cada lente inclui um ou mais `agent-*.json`. Array vazio é resultado válido; objeto
  sem findings/verified array, item sem título/local ou lente errada é inválido.
- `deps` inclui `deps-latest.json` gerado pelo runner mais todos seus agent JSONs;
  estrutura, contagens e consultas precisam estar completas. Falha de registry ou item
  skipped mantém a etapa incompleta. O relatório continua renderizável com a lacuna.
- Gate verifica hashes de todos os produtores, merge, stage stamps e fonte atual.
  Após alteração de produto, rode novamente as lentes selecionadas antes de fechar.
  Não sobrescreva artefatos de trabalho ainda em uso por outro produtor.

## Segurança deep

`sec-deep/inventory.json` mantém o inventário do Cartógrafo e acrescenta:

```json
{"status":"complete","scope_note":"arquivos e limites realmente cobertos", "components":[{"name":"app","paths":["src"]}], "required_hunters":[{"component":"app","lens":"authorization"}], "securityScanSkippedComponents":[]}
```

Cada `sec-deep/hunter-<componente>-<lente>.json` contém
`{"status":"complete","component":"app","lens":"authorization","scope_note":"traço e cobertura","candidates":[]}`.
`required_hunters` declara toda a matriz de componentes/lentes aplicáveis; os artefatos
precisam cobri-la exatamente, sem duplicatas. O exemplo é shape mínimo, não matriz full.
Zero superfície exige components/required_hunters vazios, no_attack_surface:true e reason
concreta; nesse caso hunters não são inventados e candidates.json vazio é suficiente.
Os candidatos incluem temp_id único, título, path/line, categoria, impacto, evidência,
fix e a lente/componente investigados. Maestro concatena esses arrays (inclusive os
adicionais de esforço max) sem descartar itens; `candidates.json` contém exatamente
esse multiconjunto. Dedupe pode ser feito durante produção, preservando todas as fontes
no candidato. Não corte candidatos para caber no painel.

```bash
node "$SKILL_ROOT/scripts/run-state.mjs" complete --dir "$OUT" --stage security_inventory \
  --snapshot "$SNAPSHOT_ID" --artifacts sec-deep/inventory.json
node "$SKILL_ROOT/scripts/run-state.mjs" complete --dir "$OUT" --stage security_hunters \
  --snapshot "$SNAPSHOT_ID" --artifacts sec-deep/candidates.json,sec-deep/hunter-app-authorization.json
```

Cada voto `sec-deep/votes/C1-REACHABILITY.json` (também IMPACT e DEFENSES) tem:

```json
{"lens":"REACHABILITY","verdict":"TRUE_POSITIVE","reasoning":"path:linha e traço concreto",
 "context":{"run_id":"UUID","source_hash":"HASH_DO_SNAPSHOT","candidate_hash":"HASH_CANONICO_DO_CANDIDATO"}}
```

Use `hash(candidate)` de `scripts/pack-state.mjs` para o hash JSON canônico; não monte hash
com uma serialização diferente. `FALSE_POSITIVE` requer prova de refutação. `UNVERIFIED`
é permitido como relato de incerteza, mas a CLI o mantém pendente e retorna 2.

```bash
node "$SKILL_ROOT/scripts/sec-verify.mjs" --dir "$OUT" --snapshot "$SNAPSHOT_ID" \
  --candidates "$OUT/sec-deep/candidates.json" --votes-dir "$OUT/sec-deep/votes" \
  --require-vote-files --out "$OUT/agent-cerbero.json" \
  --coverage-out "$OUT/sec-deep/coverage.json" --agent "Cérbero"
node "$SKILL_ROOT/scripts/run-state.mjs" complete --dir "$OUT" --stage security \
  --snapshot "$SNAPSHOT_ID" --artifacts agent-cerbero.json,sec-deep/coverage.json
```

Quórum fixo 2/3; confiança high só unânime. Flags antigas `--votes`/`--quorum`/`--voters`
não substituem arquivos reais nem mudam quórum. Zero candidatos dispensa votos, nunca
inventory/hunters. Coverage inclui hashes de candidatos/votos e pendências. Falha preserva
o último agent-cerbero válido, mas publica coverage unverified para bloquear uso antigo.

## Revisão da correção

1. Estabilize fonte e teste; `run-state review-start --dir OUT --id ID` emite `context`.
   Ele inclui run/snapshot/source/finding hash, id e round_id. O resumo corrente vira
   pending imediatamente. Todos os revisores recebem esse objeto inteiro e o mesmo diff.
2. Nêmesis executa:

```bash
node "$SKILL_ROOT/scripts/reversal-proof.mjs" --dir "$OUT" --id "$ID" \
  --base "$COMMIT_ANTES_DO_FIX" --fix-paths src/a.js,src/b.js --test-cmd 'node test/regression.cjs'
```

O runner cria worktree detached temporária, aplica mudanças não commitadas e copia
arquivos não ignorados novos (incluindo teste); restaura somente fix-paths a BASE.
Testes permanecem. Para arquivo recém-criado, a fase RED o remove. Não passe diretório,
symlink nem o próprio teste em fix-paths. Não executa instalação; toolchain/deps devem
estar disponíveis nesse ambiente ou a prova falha honestamente. Tempo limite default
120s, ajustável por `--timeout-ms`. Timeout/sinal não conta como RED. Logs e proof são
registrados em `reviews/rounds/ID/ROUND/`; todos os caminhos temporários são removidos
em sucesso/erro normal. SIGKILL pode deixar worktree temporária, nunca altera produto;
verifique owner e remova somente o checkout temporário abandonado.
3. Cada revisor devolve `reviews/votes/ID-<LENTE>.json` com `lens`, `verdict`, reasoning,
   required_changes e **context inteiro idêntico**. CORRECTNESS APROVA exige
   test_reversal_checked:true e proof válido da rodada. Demais lentes não assinam essa prova.
4. `review-verify --dir OUT --id ID` publica approved/changes_requested/rejected/invalid;
   qualquer falha invalida aprovação antiga. Imutáveis: contexts e tentativas em
   `reviews/attempts/ID/UUID.json`. Summary agrega todas as IDs, attempts e first_pass.
5. `sync-progress --done ID --test NOME` revalida votos/proof/fonte atuais; gate faz a mesma
   validação, mesmo se ninguém reapurar após apagar um voto. Alteração do conteúdo exige
   review-start e nova revisão. Waiver é dívida visível e permanece bloqueada no gate.

## Persistência, recuperação e migração

Operações de estado usam escrita em temporário + fsync + rename e lock exclusivo do
pack. Concorrência é recusada explicitamente (`pack ocupado`); aguarde o dono terminar e
repita a operação. Atomicidade é por arquivo. Se o processo cair entre arquivos, o gate
rejeita inconsistências; rode merge/lint/sync novamente. Reports são derivados, não a
fonte da verdade. Não rode dois publishers para o mesmo destino compartilhado.

Lock preparado com owner antes da publicação evita janela de lock sem identificação.
Não há remoção automática por timeout. Se o processo morreu, interrompa outros writers,
confirme owner local e rode `run-state recover-lock --dir OUT`; a CLI exige PID morto e
arquiva o lock. Host remoto/dono desconhecido exige inspeção manual, nunca remoção cega.
Diretórios `.lock-*` abandonados antes da aquisição não bloqueiam a run e podem ser
removidos após confirmar que nenhum processo os está preparando.

Schema 1 não recebe aprovação automática. Para migrar explicitamente:

1. Preserve o pack legado como histórico; build-report pode renderizá-lo como incompleto.
2. Crie nova run `init-run --root PROJECT --full --legacy /caminho/pack-antigo` (ou delta
   com base explícita). legacy_source é referência, não evidência.
3. Releia os achados legados no código atual; gere novos resultados, snapshots, votos e
   desfechos. Não copie status/review antigos. IDs schema 2 usam identidade por hash;
   guarde relação de IDs legados no REPORT se útil.
4. Rode merge, audit-gate e sync; closure gate somente após disposições válidas atuais.

Os scripts impõem integridade/consistência de evidência em arquivos; não autenticam o
votante nem impedem alguém com escrita no pack de fabricar todos os registros. O Maestro
continua responsável pela execução real dos agentes, cobertura da matriz de componentes,
independência e precisão das afirmações. Não chame hashes de prova criptográfica de execução.

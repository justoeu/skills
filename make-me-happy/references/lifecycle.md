# Estado, evidência e recuperação

## Identidade

`run-meta.mjs init` cria OUT absoluto com UUID e prefixo exclusivo; duas runs no mesmo
dia/branch não compartilham resultados. `--fresh` preserva a anterior. Não copie score,
review, waiver ou resultado de UI entre runs. O spec, ROOT e OUT enviados aos agentes
são absolutos. Uma run antiga pode ser adotada, mas seus resultados precisam ser
reexecutados para adquirir evidência válida.

## Um escritor para agregados

Oracle é o único escritor de TASKS.json/TASKS.md, meta, tests, coverage e tracking.
Agentes escrevem arquivos próprios (results/T-id.json, reviews/eixo.json, hooks/id.json).
O helper usa lock por pack, escrita por rename e controle de versão da task. Lock
ocupado deve ser retomado depois do escritor; lock de processo encerrado é recuperado.
Não contorne lock ativo. Após crash entre JSON e Markdown, `run-meta.mjs sync` regenera
TASKS.md a partir do JSON.

Resultado de task:

```json
{"id":"T-001","expected_version":0,"patch":{"status":"DONE","tests_added":1,"red_green":true,
 "red":{"command":"npm test -- task","output_excerpt":"expected 2, got 1"},
 "green":{"command":"npm test -- task","output_excerpt":"1 passed"},
 "commits":[{"sha":"..."}]}}
```

Cada aplicação incrementa version. Resultado antigo é rejeitado, nunca sobrescreve a
atualização de outro agente. Identidade, worktree e depends_on mudam no planejamento,
não no resultado do implementer. Atualizações do plano devem preservar evidência e
invalidar gates conforme o novo input.

## Snapshot e carimbo

```bash
node "$SKILL_ROOT/scripts/run-meta.mjs" snapshot --dir "$OUT" --file round-2-start.json
# Execute a verificação sobre essa revisão. Grave o resultado real.
node "$SKILL_ROOT/scripts/run-meta.mjs" stamp --dir "$OUT" --file reviews/spec.json --snapshot "$OUT/round-2-start.json"
```

O carimbo contém run_id, HEAD informativo, hash do conteúdo do produto e hash dos
inputs (plano/contratos/mapa/configuração). Arquivos do pack e worktrees auxiliares
não entram no hash do produto. Isso permite commitar o relatório sem invalidar o
código testado. Arquivos canônicos do app fora do pack entram: finalize-os antes da
rodada final. Fonte alterada durante a verificação recusa o stamp.
O conteúdo da spec é incluído separadamente, mesmo fora do repo, dentro do pack ou
ignorado pelo Git. O carimbo também guarda result_hash: editar o resultado depois
de carimbar exige verificação e carimbo novos.

Snapshot não prova que um comando foi executado: logs/resultados, prompts dos reviewers
e revisão do Oracle continuam necessários. Ele impede reutilização acidental de uma
prova em outra run/revisão. Nunca carimbe documento antigo sem nova execução.

`score.mjs`, resume e HTML compartilham a decisão; score salvo é cache de apresentação,
não autoridade. `close` só cria closure.json quando todos os gates obrigatórios estão
concluídos, e sela os artefatos. Modificar um artefato invalida o selo. Mudanças futuras
no produto não reabrem um relatório histórico válido; ele declara a revisão avaliada.

## Worktrees

- add persiste intenção antes de criar cada slice; retry com o mesmo OUT reconcilia.
- sync recebe deps DONE/integradas e atualiza o checkout consumidor. Sem isso, não
  iniciar tarefa dependente. Pode manter dependências dentro da mesma slice.
- merge testa a slice limpa, integra o SHA testado, testa o destino e persiste cada
  fase antes de remover recursos. Testes que alteram fonte causam parada.
- tasks pendentes mantêm a slice após merge parcial. Branch/diretório só desaparecem
  quando não restarem tasks e a integração tiver passado.
- erro/conflito preserva recursos; retry identifica a ancestralidade real em Git.
- remove não usa --force/-D; recusa conteúdo local, commits não integrados e pastas
  desconhecidas não vazias. Não usar --fresh como autorização de descarte.

## Gates finais

`tests.json`, coverage, immutability, reviews, hooks e UI-scope precisam de evidência
atual. UI=false ou off registrado dispensa a jornada, não a apuração do escopo.
project-gates e tracking têm sua própria etapa de conclusão; OPEN impede fechamento
final. Pode entregar relatório parcial honesto quando uma dependência externa impede
concluir, preservando a run para retomada.

Após gerar o HTML final, versione o pack na branch da run, selecionando apenas seus
arquivos, ou siga a política de artefatos ignorados do repo. Um pack antigo não
versionado impede a próxima baseline limpa; não o apague nem esconda alterações de
produto para destravar. `resume.historical_pack.report` localiza o último HTML fechado.

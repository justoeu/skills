# Atlas — forward independente (read-only no harness e no produto fornecido)

Fonte recebida: /tmp/atlas-regression-djr4Us/product. Li somente orders.mjs e
package.json dessa aplicação; não consultei modelos/resultados irmãos. Consultei
SKILL.md e ajuda das três CLIs. Copiei somente os dois arquivos para fixture própria,
criei Git local e gerei modelo/HTML fora do harness. Nenhuma rede, instalação, servidor,
execução de aplicação real ou mudança de skill/produto original.

## Resultado

**Fluxo funcional, com uma lacuna de inicialização reproduzida.** Depois de criar o
parent docs/atlas explicitamente, merge full → build → delta → merge incremental →
build/rebuild concluiu. O modelo e o JSON incorporado no HTML correspondem exatamente.

- Leitura inicial: uma API pública de biblioteca, createOrder(input), em orders.mjs:1.
  Retorna objeto em memória com id padrão fixture e ...input; input.id pode sobrescrever
  o padrão. SQLite é apenas dependência declarada (5.2.0), sem uso/importação na fonte.
  Documentei essa ausência: nenhum banco operacional, HTTP server, fila ou telemetria foi inventado.
- Primeira saída: 1 fluxo, 1 entrypoint library mapeado, 1 scan/1 ponto de cobertura,
  changelog NOVO preservado; score documental 48/D, qualidade/env sem evidência.
- Alteração SOMENTE na cópia: acrescentei cancelOrder(order) retornando cópia com status
  cancelled e mudei range de sqlite3 para ^5.2.0. Não consultei versões de registry.
- atlas_delta mostrou orders.mjs/package.json modificados e os dois artefatos de docs
  untracked; HEAD/base permaneceram o mesmo commit. app.syncNote registra worktree suja.
- Incremental: create-order preservado + cancel-order acrescentado; 2 entrypoints,
  sqlite3 atualizada uma vez para ^5.2.0, sem duplicata. Histórico tem 2 scans e 2 pontos
  no mesmo dia, 3 entradas de changelog; rebuild idêntico não adicionou histórico.
- JSON island do HTML é igual ao app-model.json inteiro; JavaScript do HTML compilado
  com node:vm Script sem erro. HTML final 152661 bytes. Não foi aberto em browser.
- Build avisa unhappy vazio em cancel-order; mantive vazio porque a função não contém
  tratamento explícito de falha. É aviso, não bloqueio; não inventei erro para aumentar score.

## Achado de severidade média — primeiro scan falha sem parent do pack

- Local: atlas-docs/scripts/atlas_merge.py:186–189; pipeline SKILL.md:60–69.
- Repro: projeto novo, docs/atlas não existe; executar a CLI documentada com old apontando
  docs/atlas/app-model.json inexistente (help declara que pode não existir no primeiro scan),
  scan válido e -o no mesmo caminho. Exit 1, FileNotFoundError em open(out, "w").
- Evidência: primeira fixture /var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/atlas-independent-forward-2vcgmkek, scan-initial.json
  válido e nenhum pack publicado. A segunda fixture abaixo só acrescentou mkdir(parents=True)
  antes da CLI e completou o fluxo.
- Correção objetiva: criar parent do output na CLI (idealmente escrita atômica) ou incluir
  mkdir obrigatório no setup; teste fresh checkout com docs/atlas inexistente deve concluir
  primeiro scan sem intervenção fora do fluxo documentado.

## Artefatos e limites

Fixture: /var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/atlas-independent-forward-geru5y50/
- product/docs/atlas/app-model.json e index.html: resultado final.
- initial-model.json / initial-index.html: primeira saída preservada.
- scan-initial.json / scan-update.json: extração independente.
- results.json: modelos resumidos, delta e argv/exits/stdout/stderr de todas as CLIs.
- html-check.json: igualdade JSON/HTML e compilação JS.
- Script reprodutível: /tmp/atlas-independent-forward.py.

O produto original continua com exatamente a função createOrder e sqlite3 5.2.0.
Não validei renderização visual/cliques, aplicações maiores, todos os campos de schema,
telemetria, URLs externas ou cálculo semântico automatizado. O score foi tratado como
preenchimento documental, não como prova de correção ou cobertura real de produto.

## Revalidação após correção do autor

**Achado do primeiro setup fechado por prova independente.** Reexecutei o script
inteiro removendo o mkdir manual: merge full criou docs/atlas inexistente, build, delta,
merge e rebuild concluíram novamente. Também gerei HTML em fresh/nested/html/index.html
com todos os pais ausentes: build criou a árvore e concluiu.

Nova fixture: /var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/atlas-independent-forward-ttbwkxl7/. Resultados em results.json e setup-revalidation.json.
Mantidos 1→2 fluxos, range sqlite3 atualizado, dois scans e histórico idempotente.
Nenhuma nova lacuna encontrada nesse fluxo; limites anteriores permanecem.

# Fechamento das validações restantes — 2026-10-23

## Resultado

As pendências da [rodada anterior](other-skills-remediation-2026-10-22.md) foram exercitadas. A suíte final tem **311 testes aprovados, zero falhas e zero skips**: 284 Node + 27 Python. Houve execução real de SwiftPM, `xcodebuild`, `xccov`, SonarScanner e SonarQube em Docker descartável. Nenhum achado conhecido desta rodada ficou aberto.

O trabalho também encontrou e corrigiu dois problemas que os testes anteriores não cobriam: associação de caminhos na cobertura nativa de `.xcresult` e preservação de um manifesto antigo após falha inicial no gate de publicação do `app-gp`. Os contratos externos da Ultra foram atualizados para o layout e a stack atuais, sem aceitar comportamento defeituoso como resultado esperado.

[Índice de evidências](remaining-validation-2026-10-23-evidence/README.md), com logs, resultados estruturados, patch externo e hashes das fontes.

## Testes finais

| Área | Aprovados | Escopo |
|---|---:|---|
| make-me-happy | 130 | Ciclo, retomada, provas, hooks, relatório e Chromium real |
| Atlas | 37 | Delta/full, histórico, primeiro uso, sanitização e Chromium real |
| Deep | 12 | Git/worktrees, fechamento/reabertura, concorrência e interrupção |
| Ultra | 91 | Inclui os 28 contratos antes não executados e 5 novos casos; opt-in habilitado |
| Links | 14 | Destinos, aliases, backups, rollback e entradas inválidas |
| Sonar | 27 | Bootstrap, API/CLI, LCOV, xccov, credenciais e entradas inválidas |
| **Total** | **311** | **Zero falhas; zero skips** |

Comandos da execução conjunta:

```sh
ULTRA_PROJECT_ROOT=~/Developer/Workspace/app-gp \
MMH_REAL_BROWSER=1 ATLAS_REAL_BROWSER=1 node --test \
  scripts/tests/*.test.mjs make-me-happy/scripts/tests/*.test.mjs \
  atlas-docs/scripts/tests/*.test.mjs deep-audit/scripts/tests/*.test.mjs \
  ultra-deep-audit/scripts/tests/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s sonar-swift-local/scripts/tests -v
```

As seis skills passaram pelo validador formal. Sintaxe: 67 JavaScript, 13 Python, 1 shell no harness e o shell externo alterado. `git diff --check` passou nos dois escopos. Links de hosts: 0 drift, 0 avisos, 0 ausentes.

## Integrações externas da Ultra

O primeiro teste dos 28 contratos antigos, contra cópia dos arquivos reais atuais, produziu **11 PASS / 17 FAIL**. As falhas de expectativa correspondiam a mudanças reais do projeto: PostgreSQL/Redis/Flyway em vez do conjunto antigo de MySQL, cinco imagens em duas plataformas, três builds locais e novas verificações de migrações/relatórios.

As correções usam `ULTRA_PROJECT_ROOT` explícito, preferem `deployments/scripts` e aceitam o layout `scripts` legado. O helper copia somente código/configuração necessária para um diretório temporário; não copia credenciais ou dados da aplicação. Os contratos verificam o comportamento do gate e seus artefatos com Docker, Trivy e Maven simulados. Ferramentas externas inesperadas são recusadas. Não executam o pipeline completo, deploy, publicação, registry ou a suíte da aplicação.

Foram mantidas verificações negativas: imagens ausentes/duplicadas/digest inválido, conjunto de plataformas, falha de vulnerabilidade, SBOMs preservados, XML ausente e testes ignorados/zerados. A validação atual de migrações manifestadas substitui a expectativa obsoleta de um contador textual de três métodos.

A suíte própria da Ultra passou **91/91**, também em execução separada com rede Node bloqueada. A execução conjunta confirmou o resultado contra a raiz real selecionada, usando cópias isoladas para os subprocessos.

## Correção pontual no app-gp

Arquivo alterado fora do harness: `~/Developer/Workspace/app-gp/deployments/scripts/runtime-images-supply-chain-gate.sh`.

Uma tentativa de publicação com compose ausente, digest inválido ou tag ausente retornava erro antes de remover `runtime-images.env`. Um arquivo de execução anterior podia continuar disponível. O teste de sucesso/falha do scan não detectava essa janela de pré-validação.

O patch antecipa a remoção do manifesto antigo para o início do **modo de publicação**, antes das verificações que podem falhar. O modo de consulta não remove esse arquivo. A escrita final continua dependente dos checks e scans concluídos.

- Contratos atualizados contra a fonte original: **31 PASS / 2 FAIL**; as duas regressões demonstraram o defeito.
- Cópia com patch: **33/33 PASS**. A fonte real só foi alterada depois de verificar que seus bytes ainda correspondiam à cópia inspecionada.
- Revisão independente adicional: tag ausente e compose ausente removem o manifesto antigo; modo de consulta com compose ausente o preserva. Todos retornam erro e fazem **zero chamadas de ferramentas externas**.
- O diff externo contém apenas a antecipação dessa remoção e seu comentário. [Patch exato](remaining-validation-2026-10-23-evidence/app-gp-runtime-env-preflight.patch).
- SHA-256 do script corrigido: `2feb68fdc39c9d3f206ec2df2edbed7600b1770c8f028079cb3853a12ee7155d`.

Nenhum outro arquivo do `app-gp` foi editado por esta rodada. Não houve commit, push ou deploy.

## Cobertura real de Swift e Xcode

O ambiente tem **Xcode 26.6 (17F113), Swift 6.3.3**. A seleção global continuou em `/Library/Developer/CommandLineTools`; `DEVELOPER_DIR` selecionou o Xcode apenas nos subprocessos. A disponibilidade do Xcode foi conferida diretamente, sem deduzi-la apenas de `xcode-select -p`.

### SwiftPM → LLVM → Sonar

Uma fixture mínima contém código executado e caminhos deliberadamente não testados. Dois testes reais passaram; LLVM mediu **8/12 linhas, 66,6667%**. O Sonar importou **66,7%** nas duas análises:

| Estado | analysisId | Cobertura |
|---|---|---:|
| Antes da recriação | `8631d19e-10af-4507-9947-7a2b1d419638` | 66,7% |
| Depois da recriação | `e5faf293-85d0-488c-b7ab-1f8af224bc5c` | 66,7% |

O marker da imagem atualizada foi `2`, com projeto/credenciais preservados. Uma fixture independente, extraída de outra fonte, executou dois testes Swift Testing e confirmou **10/18 linhas, 55,56%**, com igualdade integral entre LCOV e XML.

O smoke permanente agora aceita `--coverage --developer-dir <Xcode/Contents/Developer>` para repetir essa prova com imagens explicitamente selecionadas.

### xcodebuild → xcresult → xccov → Sonar

`xcodebuild test -enableCodeCoverage YES` produziu um `.xcresult` real. A tentativa nativa do plugin 0.5.1 leu a cobertura, mas não encontrou os arquivos: o bundle armazenava `/var/...`, enquanto Sonar indexava o caminho canônico `~/tmp/...`. O scanner saiu 0; a validação pela API recusou a ausência de medição.

Foi acrescentada a opção **`scan.sh ... --xcresult <bundle>`**, com conversor `xccov-to-sonar.py`. Ele normaliza caminhos, agrega aliases, preserva linhas não cobertas, exclui arquivos externos e rejeita schema/contagens inválidos antes de publicar XML. A opção tem precedência sobre SwiftPM e importa um bundle fornecido, sem reexecutar testes nem alegar que o teste acabou de rodar.

A nova importação passou no Sonar real: análise `0e06b08a-5a12-43f8-9480-af576014e03d`, **66,7%**, igual aos **66,6667%** do `xccov`. O código-fonte permaneceu inalterado.

O passe independente gerou outro bundle com três testes reais e **15/18 linhas, 83,33%**. Conferiu todas as linhas contra o XML, a preservação do bundle e a ausência de nova execução SwiftPM. Seis entradas inválidas foram recusadas, incluindo outro checkout e JSON parcialmente inválido. A nova suíte teve três falhas observáveis antes da implementação e passou integralmente depois.

A documentação explica a diferença entre importação de cobertura e resultados/duração dos testes. Para a opção nativa do plugin, `sonar.apple.resultBundlePath` é relativo ao projeto, conforme o [contrato do sonar-apple](https://github.com/insideapp-fr/sonar-apple#sonar-configuration); o fluxo corrigido usa Generic Coverage para contornar a divergência de caminhos observada.

## Versões e limites restantes do escopo

- `sonar-swift-local` **2.1.0**: opção `.xcresult`, conversão canônica, smoke com cobertura real e diagnóstico correto do toolchain. Respostas HTTP de erro também são fechadas explicitamente, eliminando o aviso de recurso observado no Python 3.15.
- `ultra-deep-audit` **2.0.1**, schema 2 preservado: contratos e isolamento atualizados. As outras quatro skills mantêm as versões da rodada anterior e passaram novamente.
- Os 28 testes antes não executados foram exercitados. Sem opt-in eles continuam corretamente marcados SKIP na suíte padrão; isso não invalida o registro desta execução explícita.
- A prova de publicação usa stubs; não afirma construção/publicação de imagens ou scan de vulnerabilidades reais do `app-gp`. O Sonar/Docker e os testes Swift/Xcode desta rodada foram reais e descartáveis.
- Os projetos Swift/Xcode são fixtures mínimas locais, não um aplicativo iOS em produção. O bundle fornecido deve corresponder à revisão analisada; um relatório antigo que ainda aponta aos mesmos caminhos não pode ter sua correspondência semântica deduzida apenas do nome.
- A atualização Docker foi entre imagens derivadas com o mesmo plugin, verificando conteúdo/persistência. Não é teste de compatibilidade com qualquer versão futura do plugin.
- Containers dos testes foram removidos. A seleção global do Xcode e instâncias compartilhadas permaneceram intactas. As alterações continuam locais, sem publicação remota.

Essas fronteiras descrevem o alcance da prova; não representam achados deixados abertos desta rodada.

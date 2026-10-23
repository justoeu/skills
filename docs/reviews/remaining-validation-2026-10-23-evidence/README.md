# Evidências da validação — 2026-10-23

Este diretório preserva os resultados e insumos da [rodada de fechamento](../remaining-validation-2026-10-23.md). O resultado final foi **311 testes aprovados, zero falhas e zero skips**. Logs RED e a tentativa nativa de cobertura com falha são registros anteriores à correção, identificados abaixo.

## Resultado final e fontes

- [Resumo estruturado](validation.json): contagens, validação formal, sintaxe, links e integrações reais.
- [Suíte Node](skills-final-node-2026-10-23.log): 284/284, incluindo Chromium e contratos externos habilitados.
- [Suíte Python](skills-final-python-2026-10-23.log): 27/27.
- [Snapshot das fontes](source-snapshot.json): hashes dos arquivos das seis skills e scripts compartilhados, além do script externo corrigido. Permite detectar alterações posteriores à execução.

## Ultra e correção no app-gp

- [Relatório detalhado](ultra-project-integration-2026-10-23.md).
- [Contratos antigos contra a fonte atual](ultra-original-red.log): 11/28 aprovados; expectativas obsoletas foram identificadas.
- [Regressões contra a fonte original](ultra-current-red.log): 31/33 aprovados; duas falhas demonstram o manifesto antigo preservado indevidamente.
- [Contratos após a correção](ultra-patched-copy-green.log): 33/33.
- [Ultra completa](ultra-project-final-all.log): 91/91, com a raiz real selecionada e subprocessos isolados em cópias temporárias.
- [Layout legado](ultra-legacy-layout-green.log): 33/33.
- [Patch externo exato](app-gp-runtime-env-preflight.patch), [registro da aplicação](app-patch-application.json) e [conferência das fontes](app-source-check.json).
- [Verificação independente do preflight](runtime-preflight-independent-2026-10-23.json): falhas em modo de publicação invalidam o manifesto antigo; consulta o preserva; zero chamadas externas.

Os contratos usam ferramentas externas simuladas. Não representam execução completa de CI, build/publicação de imagens ou scan real de vulnerabilidades do app-gp.

## SwiftPM e Sonar reais

- [Sonar antes e depois da recriação](sonar-coverage-live-2026-10-23.json): análises distintas, ambas com 66,7% de cobertura.
- Fixture original: [Package.swift](Package.swift), [código](source.swift), [testes](fixture-tests.swift) e [log SwiftPM](swift-test.log).
- [Revisão independente SwiftPM](sonar-swift-forward-2026-10-23.md) e seu [script de reprodução](sonar-swift-forward-run.py).

## Xcode, xcresult e Sonar reais

- [Log xcodebuild](xcode-test.log), [resumo xccov](xccov-report.json) e [linhas xccov](xccov-archive.json).
- Tentativa nativa anterior à correção: [resultado](sonar-xcresult-native-before-2026-10-23.json) e [diagnóstico da divergência de caminhos](native-xcresult-path-mismatch.log). A ausência de cobertura foi recusada pela validação, mesmo com saída zero do scanner.
- [Testes antes da implementação](sonar-xccov-red-2026-10-23.log) e [depois da implementação](sonar-xccov-green-2026-10-23.log).
- [Importação corrigida no Sonar](sonar-xcresult-live-2026-10-23.json): 66,7%, correspondente ao bundle real; [script da prova](sonar-xcresult-probe-2026-10-23.py).
- [Revisão independente xcresult](sonar-xcresult-forward-2026-10-23.md), [resultado estruturado](sonar-xcresult-forward-current.json), [geração da fixture](sonar-xcresult-forward-build.py) e [verificação](sonar-xcresult-forward-verify.py).

## Reprodução e limites

O relatório principal registra os comandos e versões. O smoke permanente está em `sonar-swift-local/scripts/tests/live_smoke.py`; aceita cobertura real e seleção explícita do Xcode. Os scripts de prova copiados aqui registram a execução desta sessão e alguns referenciam diretórios temporários: para reutilizá-los, é necessário recriar suas fixtures e ajustar esses caminhos. Os caminhos originais podem deixar de existir; estas cópias preservam os resultados e insumos textuais, não os bundles binários ou bancos descartáveis.

As fixtures Swift são sintéticas. SonarQube, SonarScanner, Docker, SwiftPM e Xcode foram executados de verdade. Os containers de teste foram removidos, sem alterar a seleção global do Xcode. Não houve commit, push ou deploy.

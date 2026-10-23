# Evidências da remediação — 2026-10-22

Estado final e matriz de fechamento: [relatório consolidado](../other-skills-remediation-2026-10-22.md).

## Validação da versão final

- [Resumo estruturado](validation.json): 273 testes aprovados, zero falhas, 28 integrações externas não executadas.
- [Suíte Node conjunta](skills-remediation-node-final.log): 279 casos, 251 PASS/28 SKIP; Chromium real habilitado para Atlas e make-me-happy.
- [Suíte Sonar](sonar-final-tests.log): 22 PASS. [Repetição independente](sonar-reader-final-tests.log): 22 PASS.
- [Sonar real antes/depois da atualização](sonar-live-smoke.json): duas análises concluídas, marker novo, checksum efetivo. Gate final ERROR consultivo e cobertura não medida estão preservados.
- [SHA-256 das fontes corrigidas](source-snapshot.json): arquivos da worktree, inclusive novos; não é assinatura nem commit publicado.

## Revisão e fluxos independentes

| Área | Relatório | Resultados preservados |
|---|---|---|
| Deep | [Forward independente](deep-forward-independent.md) | [81 CLIs: fluxo principal](deep-forward-results.json), [zero superfície](deep-zero-forward-results.json), [log principal](deep-forward-independent.log) |
| Ultra | [Forward e revalidação dos três extras](ultra-independent-forward.md) | [Resultados finais](ultra-forward-results.json), [RED](ultra-independent-regressions-red.log), [GREEN](ultra-independent-regressions-green.log) |
| Atlas | [Forward com fonte nova e revalidação do setup](atlas-independent-forward.md) | [Resultados finais](atlas-forward-results.json), [setup](atlas-setup-revalidation.json), [falha anterior](atlas-first-run-before.log) |
| Abuse | [Análise independente](abuse-forward-review.md) | [Fonte sintética](abuse-fixture.py), [chamadas diretas](abuse-forward-results.json) |
| Links/LCOV | [Achados adicionais](sonar-links-independent-review.md), [revalidação](sonar-links-independent-final.md) | [Links](links-independent-final-results.json), [LCOV/métrica](sonar-independent-final-results.json) |
| Credenciais Sonar | [Achado de ambiente herdado](sonar-reader-independent-review.md), [revalidação](sonar-reader-independent-final.md) | [Antes](sonar-reader-independent-results.json), [depois](sonar-reader-final-results.json), [probe reproduzível](sonar-reader-final-probe.py) |

Scripts independentes preservados: [Deep](deep-forward-independent.mjs), [Deep zero](deep-zero-forward.mjs), [Ultra original](ultra-forward-independent.mjs), [Ultra revalidação](ultra-forward-revalidation.mjs), [Atlas](atlas-independent-forward.py). Alguns referenciam o caminho canônico desta máquina ou helpers temporários; são registros da execução, não substitutos da suíte permanente do repositório.

## Relatórios de implementação e provas anteriores

- [Deep DA-01–12 e oportunidades](deep-remediation.md).
- [Ultra UD-01–11 e extras](ultra-remediation.md); [suíte própria final](ultra-suite-release-final.log).
- [Atlas A1–9 e divergências](atlas-remediation.md). Esse relatório foi escrito antes da regressão adicional de setup: sua contagem 36 é histórica; a suíte conjunta final tem 37.
- [Links RED](links-regression-before.log), [backup ainda descoberto](links-forward-before.log), [suíte final](links-final-tests.log).
- [Sonar RED](sonar-regression-before.log), [primeiro GREEN](sonar-regression-after.log), [revisão adicional](sonar-forward-before.log), [RED de credenciais/redirect](sonar-auth-before.log).
- [Ultra RED inicial](ultra-regressions-red.log), [primeiro GREEN](ultra-regressions-first-green.log), [hunter omitido](ultra-hunter-coverage-red.log).
- Tentativas Docker anteriores preservadas: [inicialização](sonar-live-smoke-first.json), [leitura privada negada](sonar-live-smoke-read-permission.json), [volume ainda antigo](sonar-live-smoke-volume-before.json). Esses arquivos documentam falhas anteriores; o estado final é [passed](sonar-live-smoke.json).

## Fronteiras

Relatórios originais podem citar `/tmp` e diretórios de fixture que serão removidos pelo sistema. Os JSON/logs copiados aqui preservam seus resultados. Credenciais usadas nas provas independentes são sintéticas. Arquivos de ambiente, tokens reais do Docker e logs brutos do servidor não foram copiados.

Votos sintéticos verificam o instrumento, não equivalem a três agentes aprovando uma aplicação real. Hashes detectam divergência local, não falsificação coordenada. O smoke real não mede cobertura Xcode nem compatibilidade de uma nova versão do plugin. Os 28 contratos de outro projeto permanecem explicitamente não executados.

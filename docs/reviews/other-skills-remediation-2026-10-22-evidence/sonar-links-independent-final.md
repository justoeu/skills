# Sonar e links — revalidação independente final

2026-10-22. Repeti as três reproduções originais contra as correções do root, sem alterar fontes e sem iniciar Docker. **Os três problemas estão corrigidos nas condições reproduzidas.**

| Problema | Resultado antes | Resultado depois | Prova |
|---|---|---|---|
| Backup dentro do root de skills | Cópia antiga com SKILL.md continuava descobrível apesar de auditoria vazia | Root contém somente `alpha`; link aponta à canônica; backup está fora do root e preserva exatamente os bytes antigos; auditoria limpa | `/tmp/links-independent-final-results.json` |
| LCOV com aliases do mesmo arquivo | Dois `<file path="Sources/App.swift">`, linha 1 true e false | Um único arquivo/linha, `covered="true"`; exit 0 e contador 1 | `/tmp/sonar-independent-final-results.json` |
| Cobertura não numérica aceita | current_metrics devolvia `(2, 'not-a-number')` | Lança `ScanError`: medição válida não confirmada pela análise atual | `/tmp/sonar-independent-final-results.json` |

A reprodução de LCOV reutilizou **o mesmo input anterior**, em `/tmp/sonar-independent-jklbos_m/input.lcov`, com caminho real e symlink. A reprodução de links usou nova fixture em `/tmp/links-independent-final-H8u5CV`; o backup ficou em `.skill-link-backups/host/` fora do root exposto.

Testes locais repetidos:

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s sonar-swift-local/scripts/tests -v`: **19/19 passaram**. Log: `/tmp/sonar-independent-final-tests.log`.
- `node --test scripts/tests/check-links*.test.mjs`: **14/14 passaram**. Log: `/tmp/links-independent-final-tests.log`.

A correção de limites de cobertura inclui rejeição de bool, valores não finitos e fora de 0–100, além do texto inválido repetido na prova independente. As suítes existentes exercitam os demais valores; esta revalidação manteve os três cenários originais para comparação direta.

Limites: testes usam filesystem temporário, subprocessos locais e API fake em loopback. Nenhuma execução extra de Sonar/Docker/Swift real, instalação ou acesso externo. A compatibilidade real do plugin, toolchain e scan atual é responsabilidade do smoke separado conduzido pelo root; os resultados acima não o substituem. Não há bloqueio remanescente nos três achados reportados.

# Evidências da auditoria de 2026-10-22

Resultados observados em fixtures locais e logs, preservados junto dos relatórios. Não contêm credenciais reais; marcadores de segredo/XSS são dados sintéticos de teste. Paths temporários e hashes identificam as fixtures desta sessão, não aplicações do usuário.

- `deep-results.json`, `deep-verification.json`: CLIs, estado, concorrência e gates; ver relatório Deep.
- `atlas-results.json`, `atlas-browser.json`: três snapshots, duas atualizações e Chromium local com rede bloqueada.
- `ultra-results.json`, `ultra-dom.json`: CLIs e HTML em DOM mínimo (não browser real).
- `ultra-tests.log`: suíte preexistente, 35 passam / 18 falham; falhas de layout discriminadas no relatório.
- `links-results.json`: substituição de cópia divergente, destino errado, link quebrado e arquivo legado, em hosts descartáveis.
- `sonar-results.json`, `sonar-scan-failed.log`: API/CLI falsas, falha de disco, colisão de token, modo de criação e LCOV. O resultado LCOV consolidado separa checksum de normalização de paths; a primeira tentativa que misturava as duas variáveis foi excluída.
- `source-snapshot.json`: commit-base e hashes SHA-256 dos 102 arquivos nas áreas auditadas, para identificar exatamente as fontes examinadas. Não inclui a validação anterior da make-me-happy.

São evidências de defeitos ABERTOS. Estes snapshots não são testes de regressão aprovados nem substituem reexecutar as reproduções após uma correção. Os relatórios descrevem entradas, comandos, saídas e critérios de aceite.

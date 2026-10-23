# Revalidação independente — Sonar reader e isolamento de credenciais

Resultado: correções verificadas. Nenhum bloqueio novo encontrado no escopo desta rodada. Este relatório substitui o achado pendente de ambiente herdado em `/tmp/sonar-reader-independent-review.md`.

| Contrato | Evidência observada |
| --- | --- |
| Scanner recebe somente credencial de análise | Executável scanner sintético, iniciado como subprocesso real, observou `SONAR_TOKEN` correto e nenhuma variável `SONAR_LOCAL_*` nas três execuções: admin no arquivo, reader explícito, admin/pending/DB/reader/outro token exportados. Um marcador benigno permaneceu no ambiente. |
| Reader explícito prevalece sobre admin | API HTTP descartável exigiu o reader para analyses/measures quando ambas as credenciais constavam do arquivo. Scan concluiu; três GETs receberam reader. Languages/CE/gate receberam somente token de análise. |
| Admin de fallback limitado às leituras | Sem reader, três GETs de analyses/measures receberam admin; scanner continuou sem admin no ambiente, argumentos ou saída. |
| Redirects não encaminham credenciais | Clientes reais `scan.api` e `bootstrap.make_client` recusaram HTTP 301, 302, 303, 307 e 308. Todos apontavam para outro servidor local de captura. Resultado: dez recusas e zero requisições ao destino. |
| Proxies do ambiente não capturam credenciais | Configurei http/https/all proxy, em caixa baixa e alta, para um proxy local de captura e removi bypasses. Ambos os clientes acessaram diretamente a API local. Resultado: zero requisições ao proxy. |
| Diagnósticos sem segredo | Argumentos do scanner, saída resumida e erros de redirect não continham os marcadores sintéticos. |

Referências da correção: `sonar-swift-local/scripts/scan.py:165` (filtro do ambiente), `scan.py:177` (reader), `scan.py:31` e `bootstrap.py:34` (cliente compartilhado), `local_http.py:6` (redirects) e `local_http.py:11` (proxy desativado).

## Execuções preservadas

- Suíte existente: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s sonar-swift-local/scripts/tests -v` — **22/22 aprovados** em 14,666 s; log `/tmp/sonar-reader-final-tests.log`.
- Reprodução independente: `PYTHONDONTWRITEBYTECODE=1 python3 /tmp/sonar-reader-final-probe.py` — exit 0; implementação `/tmp/sonar-reader-final-probe.py`; evidência estruturada `/tmp/sonar-reader-final-results.json`.
- Fixture: `/var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/sonar-reader-final-vl84q4qi`; contém apenas texto e credenciais sintéticas.

## Limites

A prova usa HTTP de loopback, scanner sintético em subprocesso real e projeto Swift mínimo sem compilação. Não iniciou Docker nem executou servidor Sonar/plugin real; o smoke real permanece responsabilidade da execução separada do root. Não afirma proteção contra um processo local já autorizado a ler o próprio arquivo de ambiente. A revalidação não alterou fontes e desativou geração de bytecode Python.

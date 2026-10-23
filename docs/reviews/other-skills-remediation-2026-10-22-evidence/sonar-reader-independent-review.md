# Revisão independente — credenciais de leitura Sonar

Escopo: revisão read-only de `sonar-swift-local/scripts/scan.py`, documentação e teste HTTP privado. Sem Docker, aplicações reais ou credenciais reais. Reprodução com marcadores sintéticos e mocks locais de `scan.run`.

## Confirmado

- Token de análise continua em `SONAR_TOKEN` do scanner; nenhum token foi acrescentado a argv.
- Credencial admin obtida apenas do arquivo de ambiente não entra no ambiente passado explicitamente ao scanner.
- `SONAR_LOCAL_READ_TOKEN_V2_<hex>` prevalece sobre a credencial admin quando ambos existem.
- Apenas `/api/project_analyses/search` e `/api/measures/component` recebem a credencial de leitura; languages, CE e gate continuam com token de análise.
- Saída resumida não contém os marcadores sintéticos de credencial.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s sonar-swift-local/scripts/tests -p test_scan.py -v`: 9 testes aprovados. Log: `/tmp/sonar-reader-independent-tests.log`.

## P2 — credencial administrativa exportada é herdada pelo scanner

Local: `sonar-swift-local/scripts/scan.py:164`; promessa correspondente em `sonar-swift-local/SKILL.md:81`.

A chamada usa `{**os.environ, 'SONAR_TOKEN': token}`. Quando `SONAR_LOCAL_ADMIN_PASSWORD` já foi exportada no processo invocador, o subprocesso scanner recebe essa senha administrativa junto com seu token de análise. Isso contradiz a promessa de que admin nunca é passado ao scanner e aumenta desnecessariamente seu acesso a credenciais. O mesmo padrão vale para outros segredos SONAR_LOCAL_* exportados.

Reprodução isolada: executar `scan.run` com `patch.dict(os.environ, {'SONAR_LOCAL_ADMIN_PASSWORD': 'ADMIN_CANARY'})`, env-file contendo token sintético e admin sintético, API/ensure_server/command simulados. A captura do argumento `env` de `command` retornou `admin_in_env:true`. Nos casos apenas arquivo e reader explícito, retornou false. Nenhuma credencial real foi lida ou registrada.

Evidência estruturada: `/tmp/sonar-reader-independent-results.json`, casos `file_admin`, `explicit_reader` e `inherited_admin`.

Correção objetiva: filtrar as variáveis confidenciais SONAR_LOCAL_* do ambiente destinado ao scanner antes de inserir o `SONAR_TOKEN` de análise. A regressão deve observar o ambiente efetivo do scanner com admin e reader exportados; verificar somente argv não cobre essa via.

## Limites

O teste HTTP privado existente passou, mas captura argv sem conferir o ambiente. A proteção de redirects HTTP anunciada pelo root ainda não estava implementada na leitura desta revisão; precisa ser validada após a mudança. Esta revisão não certifica o smoke real de Sonar/plugin, conduzido separadamente pelo root.

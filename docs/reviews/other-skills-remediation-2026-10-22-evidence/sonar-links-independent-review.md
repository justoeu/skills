# Revisão independente — Sonar local e check-links

Revisão read-only das mudanças atuais, 2026-10-22. Nenhuma fonte/teste permanente alterado, nenhum Docker adicional, instalação ou acesso externo. Os testes existentes de Sonar usam API simulada em loopback e executáveis fake; reproduções extras usam apenas mocks/arquivos em `/tmp`.

## Testes

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s sonar-swift-local/scripts/tests -v`: **17/17 passaram**. Log: `/tmp/sonar-independent-tests.log`.
- `node --test scripts/tests/check-links*.test.mjs`: **14/14 passaram**. Log: `/tmp/links-independent-tests.log`.
- Não executei `live_smoke.py`, servidor Sonar real, Docker, SwiftLint ou mobsfscan. Root conduz o smoke isolado em separado.

## Achados concretos

### P2 — Backup de skill permanece no nível de descoberta do host

**Local:** `scripts/check-links.mjs:157`.

`fixDrift` renomeia a cópia física para `<root>/alpha.bak-UUID`, preservando `SKILL.md` dentro dela. O backup fica como outra pasta de skill no próprio root que se pretendia normalizar. A auditoria posterior só visita nomes canônicos e reporta zero pendências.

**Reprodução local:** `/tmp/links-independent-g4mAcp` contém repo/host sintéticos com alpha v2 canônica e alpha v1 local. Após `fixDrift`, ele retorna fixed:true; `runCheck(...).findings` é `[]`. A função de descoberta por diretórios com SKILL.md, `harnessSkills(host)`, encontra `alpha.bak-32ba99ac-f1a2-42f1-b20d-f6c2473f4a17`. Resultado preservado em `/tmp/links-independent-results.json`.

**Impacto e limite:** a cópia antiga continua materialmente descobrível por leitores que percorrem pastas com SKILL.md, em vez de ser apenas um backup fora da exposição. Isso pode reintroduzir instruções antigas/duplicadas após uma correção declarada bem-sucedida. Não reiniciei um host de IA real nem afirmo uma ordem específica de precedência entre as cópias; a descoberta pelo mesmo critério de pasta usado no tooling foi comprovada.

**Correção mínima:** guardar o backup fora de todos os roots de skills (com caminho informado ao usuário), preservando bytes, permissões de acesso e rollback. Testar que a preservação não adiciona outro SKILL.md sob o root exposto.

### P2 — Normalização de aliases LCOV produz resultados contraditórios para o mesmo arquivo

**Local:** `sonar-swift-local/scripts/lcov-to-sonar.py:60` e `:67`.

O parse agrega acertos por caminho original (`SF`), mas resolve symlinks somente durante a emissão. Dois caminhos que normalizam para o mesmo arquivo geram dois elementos `<file path="Sources/App.swift">`, sem união das linhas/acertos.

**Reprodução:** `/tmp/sonar-independent-jklbos_m/input.lcov` contém a linha 1 coberta em `Sources/App.swift` e não coberta em `alias/App.swift`; alias aponta para Sources. O conversor termina 0, informa `2 arquivos convertidos` e produz:

```xml
<coverage version="1">
  <file path="Sources/App.swift"><lineToCover lineNumber="1" covered="true" /></file>
  <file path="Sources/App.swift"><lineToCover lineNumber="1" covered="false" /></file>
</coverage>
```

**Impacto e limite:** o relatório contradiz a cobertura da mesma linha e deixa a escolha/agregação ao importador, contrariando o objetivo de preservar cobertura de registros repetidos. Não executei importação desse XML em Sonar real; não atribuo a ele um comportamento de overwrite específico. A duplicação contraditória no artefato de saída é comprovada.

**Correção mínima:** canonicalizar e filtrar os caminhos primeiro; agregar registros por caminho canônico e número da linha antes de emitir uma única entrada por arquivo. Somar os hits ou usar OR para covered. Regressão com caminho real + alias e com relativo + absoluto.

### P2 — Cobertura inválida é aceita como medição publicável

**Local:** `sonar-swift-local/scripts/scan.py:121`.

`current_metrics` valida que ncloc é positivo e que existem linhas por linguagem, mas para coverage só verifica ausência (`None`). Textos arbitrários, valores não finitos e percentuais fora de 0–100 não são rejeitados antes de o fluxo imprimir/salvar o resultado.

**Reprodução sem rede:** mock do `api` retorna análise corrente `current`, ncloc `2`, distribuição `swift=2` e coverage `not-a-number`. `current_metrics(..., coverage_sent=True)` retorna `(2, 'not-a-number')` sem ScanError. Resultado preservado em `/tmp/sonar-independent-results.json`.

**Impacto e limite:** resposta de métricas incompatível/malformada ainda satisfaz a confirmação de cobertura e pode aparecer como `Cobertura: not-a-number%` com exit 0 consultivo. O caso usa API fake; não afirma que o Sonar real normalmente emite esse valor. É um buraco verificável no tratamento de respostas inválidas que a skill promete recusar.

**Correção mínima:** exigir valor numérico finito no intervalo 0–100 quando cobertura é enviada; também rejeitar contagens por linguagem não finitas. Validar tipos sem converter booleans em números e testar texto, NaN, Infinity, negativo e >100, além de zero legítimo.

## Limites gerais

Revisei bootstrap/configuração, scan, conversor, compose/Dockerfile e instruções locais, além de check-links e seus testes. Não validei versões/plugin por fontes externas nem comportamento de produção; não atribuí falha de compatibilidade sem execução real. A análise não encontrou evidência de perda dos bytes de backup, vazamento efetivo de token ou uso de gate antigo nos caminhos que os testes cobrem. Os três pontos acima são adições independentes, reproduzidas localmente; não alterei nenhuma fonte para resolvê-los.

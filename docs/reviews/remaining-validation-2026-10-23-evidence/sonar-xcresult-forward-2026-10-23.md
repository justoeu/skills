# Forward independente — `--xcresult`

Data: 2026-10-23. Escopo: seguir a skill atual para produzir `.xcresult` real, executar o helper novo até Generic Coverage, conferir preservação dos resultados e recusar entradas inválidas. Harness read-only; nenhuma instalação, Docker, rede externa ou alteração global de Xcode.

## Resultado

**PASS. Nenhum bug novo reproduzido neste escopo.** O bundle real produzido pelo Xcode foi aceito; todas as linhas executáveis do arquivo xccov dentro do checkout coincidiram com o XML, inclusive linhas não cobertas. Entradas inválidas foram recusadas sem publicar XML parcial. O E2E de scanner/API Sonar permanece separado, sob responsabilidade do root.

## Fixture e execução real

Fixture nova: `/private/tmp/sonar-xcresult-forward-a1tphxcv/ParcelPricing`.
Bundle: `/private/tmp/sonar-xcresult-forward-a1tphxcv/Results.xcresult`.

Reutilizei apenas o código-fonte SwiftPM cru da minha fixture independente anterior. Removi suas marcações de expectativas e escrevi três novos testes Swift Testing: entrega de membro, entrega em volume e mês sem crédito sazonal. Os resultados esperados desta validação foram derivados desses testes novos e das observações xccov, não dos números da rodada anterior.

Ambiente: Xcode 26.6 (17F113), Swift 6.3.3; `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` apenas nos subprocessos. O pacote não possui dependências externas.

Comando real, executado no diretório do pacote:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -scheme ParcelPricing -destination 'platform=macOS' \
  -derivedDataPath /private/tmp/sonar-xcresult-forward-a1tphxcv/DerivedData \
  -enableCodeCoverage YES \
  -resultBundlePath /private/tmp/sonar-xcresult-forward-a1tphxcv/Results.xcresult \
  -disableAutomaticPackageResolution -skipPackageUpdates \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
```

`xcodebuild` retornou 0, registrou `TEST SUCCEEDED` e os **três testes reais passaram**. A mensagem anterior de zero testes XCTest não substitui o resumo Swift Testing de três testes.

## Observações independentes

O helper `scan.coverage(package, artifacts, bundle)` foi executado com subprocessos reais, sem substituir xccov nem o conversor. Um observador registrou exatamente dois processos: `xcrun xccov view --archive --json` e `xccov-to-sonar.py`. Não houve chamada a `swift test`, nem scratch SwiftPM. O hash da árvore de arquivos do bundle foi idêntico antes e depois.

O relatório separado `xcrun xccov view --report --json` mediu **15 de 18 linhas executáveis cobertas**, ou **83,33%**, em `DeliveryQuote.swift`. A comparação do arquivo bruto `--archive --json` com o XML abrangeu todas as linhas executáveis de ambos os arquivos incluídos (source e testes). A percentagem acima inclui somente source.

| Marcador da fonte | Linha | Contagem xccov | XML covered |
| --- | ---: | ---: | --- |
| EMPTY | 4 | 0 | false |
| MEMBER | 7 | 1 | true |
| BULK | 10 | 1 | true |
| STANDARD | 12 | 0 | false |
| SEASON | 17 | 0 | false |
| SEASON_DEFAULT | 19 | 1 | true |

O xccov escreveu caminhos `/tmp/...`; o checkout canônico era `/private/tmp/...`. O conversor resolveu essa diferença e emitiu `Sources/ParcelPricing/DeliveryQuote.swift` e `Tests/ParcelPricingTests/DeliveryQuoteTests.swift` corretamente.

## Entradas inválidas

| Caso | Resultado observado |
| --- | --- |
| Caminho ausente | ScanError explícito antes de xccov |
| Arquivo comum com extensão `.xcresult` | ScanError explícito |
| Diretório com extensão errada | ScanError explícito |
| Diretório `.xcresult` vazio | xccov recusou; helper retornou ScanError |
| Bundle real fornecido para outro checkout vazio | Conversor recusou por ausência de linhas do repositório |
| JSON sintético com linha válida seguida de contagem negativa | Conversor retornou exit 1, sem emitir XML parcial |

Os cinco casos do helper não produziram documento `<coverage>`; o caso do conversor também não publicou o trecho válido anterior ao erro.

## CLI, documentação e regressões existentes

- `scripts/scan.sh --help` expõe `--xcresult`, explica que importa cobertura sem reexecutar testes e foi executado com exit 0.
- A skill descreve a precedência sobre SwiftPM, a responsabilidade de fornecer bundle correspondente ao checkout, o registro `coverage_source=supplied_xcresult`, falha em bundle inválido e limites da importação (linhas, não duração/contagem de testes). Isso corresponde ao comportamento observado e ao caminho de integração atual.
- Suíte existente: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s sonar-swift-local/scripts/tests -v` — **27/27 aprovados**, 10,827 s. Log: `/tmp/sonar-xcresult-forward-tests.log`.
- A prova real desta rodada exercitou a conversão até XML; a suíte existente cobre a passagem do argumento ao scanner simulado e a falha anterior ao scanner. Não atribuo isso a uma execução real de Sonar.

## Artefatos e reprodução

- `/tmp/sonar-xcresult-forward-build.py`: cria fixture nova e produz bundle real.
- `/tmp/sonar-xcresult-forward-verify.py`: importa bundle, compara arquivo bruto/linhas/XML, verifica subprocessos e entradas inválidas.
- `/tmp/sonar-xcresult-forward-current.json`: resultado estruturado.
- `/private/tmp/sonar-xcresult-forward-a1tphxcv/xcodebuild.log`: build/testes reais.
- `/private/tmp/sonar-xcresult-forward-a1tphxcv/xccov-report.json`: métricas independentes do Xcode.
- `/private/tmp/sonar-xcresult-forward-a1tphxcv/conversion/xccov.json`: arquivo bruto real.
- `/private/tmp/sonar-xcresult-forward-a1tphxcv/conversion/coverage.xml`: XML produzido pelo helper real.
- `/private/tmp/sonar-xcresult-forward-a1tphxcv/verification-summary.json`: verificação ligada à execução original.

Reprodução:

```bash
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PYTHONDONTWRITEBYTECODE=1 python3 /tmp/sonar-xcresult-forward-build.py
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PYTHONDONTWRITEBYTECODE=1 python3 /tmp/sonar-xcresult-forward-verify.py
```

Limites: fixture Swift/macOS com bundle produzido neste toolchain. Não valida Objective-C, variantes de xcresult de outras versões do Xcode, histórico/identidade automática entre bundle antigo e checkout modificado, nem importação real pelo Sonar. A documentação torna explícita a responsabilidade sobre a correspondência do checkout; não alego verificação criptográfica dessa identidade. Nenhuma fonte ou teste permanente da skill foi alterado.

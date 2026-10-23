# Forward independente — cobertura real SwiftPM

Data: 2026-10-23. Critério: passe independente orientado pela `skill-creator`, usando a instrução atual de `sonar-swift-local` e seu helper real de cobertura. Harness em modo read-only; fixture e artefatos temporários; nenhuma instalação, rede, Docker ou alteração global do Xcode.

## Resultado

**PASS no caminho fonte → testes reais → profdata → LCOV → XML.** Nenhuma divergência reproduzida neste escopo. O helper `sonar-swift-local/scripts/scan.py:65` produziu XML com valores observados no compilador, incluindo linhas cobertas e não cobertas. Esta rodada não certifica ingestão pelo servidor Sonar; o E2E separado do root cobre essa etapa.

## Ambiente e execução

- Xcode **26.6**, build **17F113**, em `/Applications/Xcode.app/Contents/Developer`.
- Apple Swift **6.3.3**, target `arm64-apple-macosx26.0`; Apple LLVM **21.0.0**.
- Seleção global preservada: `xcode-select -p` retornou `/Library/Developer/CommandLineTools`.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` foi definido somente no subprocesso Python que chamou o helper e seus subprocessos Swift/llvm-cov. Não foi usado `xcode-select --switch`.
- Package SwiftPM novo `ParcelPricing`, tools-version 6.0, plataforma macOS 13, sem dependências externas.
- Dois testes Swift Testing reais exercitaram entrega com desconto de membro e entrega padrão. Ramos de carrinho vazio, entrega em volume e função sazonal ficaram deliberadamente sem teste.

Fixture: `/private/tmp/sonar-swift-forward-03wtgr0n/ParcelPricing`.
Artefatos: `/private/tmp/sonar-swift-forward-03wtgr0n/artifacts`.

Comando repetível (cria outra fixture independente):

```bash
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PYTHONDONTWRITEBYTECODE=1 python3 /tmp/sonar-swift-forward-run.py
```

O script chama `scan.coverage(package, artifacts)` sem mocks. Portanto executa os comandos de produção do helper: `swift test --scratch-path ... --no-parallel --enable-code-coverage`, `xcrun llvm-cov export -format=lcov ...` e `lcov-to-sonar.py`. A comparação posterior usa um parser independente simples do LCOV, sem importar o parser do conversor.

## Evidência

`swift-test.log`: build real em 2,69 s; Swift Testing executou **2 testes, 0 falhas**. O runner XCTest também escreve “Executed 0 tests”; esse trecho não representa a execução Swift Testing, que aparece em seguida. Não houve erro em `llvm-cov.log`; `coverage.log` registrou 2 arquivos convertidos.

O scratch continha exatamente **1 default.profdata** e **1 bundle de testes**. O relatório LLVM sobre o arquivo de produção `Sources/ParcelPricing/DeliveryQuote.swift` mediu:

| Métrica | Resultado real |
| --- | --- |
| Linhas executáveis | 18 |
| Linhas cobertas | 10 |
| Linhas não cobertas | 8 |
| Cobertura de linhas | 55,56% |
| Funções executadas | 1 de 2 |
| Regiões cobertas | 8 de 14 |

A conferência de marcadores de fonte foi independente dos resultados anteriores da skill:

| Código de produção | Linha | Hits LCOV | XML covered |
| --- | ---: | ---: | --- |
| Retorno para carrinho vazio | 4 | 0 | false |
| Retorno para membro | 7 | 1 | true |
| Retorno para volume | 10 | 0 | false |
| Retorno padrão | 12 | 1 | true |
| Retorno sazonal | 17 | 0 | false |
| Retorno sazonal padrão | 19 | 0 | false |

Todos os registros de linhas de **ambos** os arquivos do LCOV dentro da raiz do pacote correspondem ao XML, inclusive o arquivo de testes. A percentagem 55,56% acima foi calculada exclusivamente sobre o arquivo de produção, não incluindo testes.

Artefatos para revisão:

- `/tmp/sonar-swift-forward-run.py`: construção da fixture e verificações.
- `/tmp/sonar-swift-forward-current.json`: resumo estruturado e marcadores.
- `/private/tmp/sonar-swift-forward-03wtgr0n/summary.json`: resumo ligado à execução original.
- `/private/tmp/sonar-swift-forward-03wtgr0n/artifacts/swift-test.log`: build e testes reais.
- `/private/tmp/sonar-swift-forward-03wtgr0n/artifacts/coverage.lcov`: exportação real.
- `/private/tmp/sonar-swift-forward-03wtgr0n/artifacts/coverage.xml`: conversão real.
- `/private/tmp/sonar-swift-forward-03wtgr0n/artifacts/llvm-cov-report.txt`: resumo independente do LLVM.

## Conclusão operacional e limites

O Xcode já instalado permite obter cobertura real sem mudar a seleção global: basta propagar `DEVELOPER_DIR` para a execução da skill. A orientação sobre usar o toolchain completo funciona para esta suíte Swift Testing. Nenhuma fonte da skill precisou mudar para esta prova.

O resultado é cobertura de linhas desta fixture SwiftPM, neste toolchain. Não certifica branch coverage, projetos Xcode/xcresult, Objective-C, múltiplos bundles de testes ou integração Sonar. Não usa fixtures anteriores nem seus números como resultado esperado. A execução desativou bytecode Python e não alterou fontes/testes permanentes.

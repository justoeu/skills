---
name: sonar-swift-local
description: "Analisa projetos Swift/Objective-C no SonarQube, que a Community Build não suporta nativamente, subindo uma instância local com o plugin sonar-apple. Use quando o pedido for analisar qualidade, lint, segurança ou cobertura de código Swift/ObjC no SonarQube, quando um projeto Apple precisar entrar num painel Sonar, ou quando um scan de Swift retornar zero linha analisada."
---

# /sonar-swift-local

Swift e Objective-C **não são analisáveis** na SonarQube Community Build. As linguagens Apple são exclusivas da Developer Edition, e `GET /api/languages/list` numa Community Build não devolve `swift`.

A consequência prática é pior do que "não funciona": apontar um scanner para um repositório Swift numa Community Build **indexa zero linha e o Quality Gate passa verde**. Um painel verde sobre nada é mais perigoso do que painel nenhum, porque parece medição.

Esta skill fecha a lacuna com uma instância **local** que carrega o plugin de terceiros [`insideapp-fr/sonar-apple`](https://github.com/insideapp-fr/sonar-apple).

## Antes de qualquer coisa: confirme o diagnóstico

Não presuma. Uma linha resolve:

```bash
curl -s -u <token>: "<host>/api/languages/list" | grep -c '"key":"swift"'
```

`0` confirma que a instância não analisa Swift. Se devolver `1`, a instância já é Developer Edition ou superior e **esta skill não é necessária** — use o fluxo normal de CI.

## Decisão de arquitetura: por que local, e não no servidor existente

O plugin declara `Plugin-ChildFirstClassLoader: false`, ou seja, compartilha o classloader do servidor SonarQube. Se um upgrade da imagem base quebrar a compatibilidade, **o SonarQube inteiro deixa de subir** — não é o plugin que falha isoladamente.

Num servidor compartilhado, isso derruba todos os projetos que dependem dele. Numa instância local, derruba um container que ninguém usa em produção.

**Nunca instale este plugin num servidor SonarQube compartilhado sem que o dono peça explicitamente e entenda esse risco.** Se pedirem, teste antes num container descartável da mesma versão.

## Custo que deve ser dito em voz alta

Rodando local e fora do CI, o Quality Gate é **consultivo, não bloqueante**. Quando ele reclama, o commit já está na branch principal.

Ao reportar resultados, nunca use a linguagem de "gate que bloqueia merge" — ela vale para pipelines de CI, não para este processo. O `scripts/scan.sh` já avisa quando o retrato não corresponde a um merge limpo; repasse esse aviso ao usuário em vez de apresentar o número isolado.

## Instalação

Requer Docker e, no cliente, macOS (as ferramentas de análise Apple não rodam em Linux).

```bash
# 1. Gera a senha do banco no arquivo de ambiente
python3 scripts/bootstrap.py --project-key <chave> --env-file <caminho>

# 2. Sobe a stack (constrói a imagem com o plugin, checksum verificado)
docker compose --env-file <caminho> -f assets/compose.yaml up -d

# 3. Cria o projeto e o token de análise
python3 scripts/bootstrap.py --project-key <chave> --env-file <caminho>

# 4. Analisa
scripts/scan.sh <repo> --key <chave> --env-file <caminho>

# 5. Libera a RAM quando terminar
docker compose --env-file <caminho> -f assets/compose.yaml stop
```

O `--env-file` é obrigatório em **todo** comando compose desta stack, inclusive `stop` e `logs`: o Compose interpola as variáveis antes de executar qualquer ação e falha sem elas.

### Ferramentas de cliente

| Ferramenta | Instala com | Sem ela |
|:--|:--|:--|
| `sonar-scanner` | `brew install sonar-scanner` | nada roda |
| `swiftlint` | `brew install swiftlint` | sem as ~233 regras de issues |
| `mobsfscan` | `pipx install mobsfscan` | sem as ~22 regras de segurança |

`pip install` costuma ser barrado por PEP 668 em Python gerenciado pelo Homebrew; use `pipx`.

O `scan.sh` detecta cada ausência e avisa o que deixou de rodar. Nenhuma ferramenta faltando quebra o scan em silêncio.

## Tratamento de segredos

O `bootstrap.py` gera senhas e token aleatórios e grava **apenas** no arquivo de ambiente, com permissão `0600`.

- Garanta que o Git do projeto ignore esse arquivo antes de rodar o bootstrap.
- **Não imprima o conteúdo dele**, não copie valores para mensagens, commits, issues ou logs. Se o usuário precisar da senha, ensine-o a lê-la no próprio terminal.
- O token de análise do SonarQube é devolvido pela API **uma única vez**. Um token perdido fica pendurado no servidor sem ninguém saber para quê — por isso o bootstrap grava antes de qualquer outra coisa e é idempotente.
- Erros de API são reportados só pelo código HTTP; o corpo nunca é impresso, porque pode conter token.

## O que este scan entrega

| Entrega | Origem | Depende de |
|:--|:--|:--|
| Complexidade, tamanho, duplicação, syntax highlighting | parser ANTLR do plugin | nada |
| Issues (~233 regras) | SwiftLint | `swiftlint` |
| Segurança (~22 regras) | mobsfscan | `mobsfscan` |
| Código morto (~4 regras) | Periphery | index store do Xcode |
| Testes e cobertura | bundle `.xcresult` | `xcodebuild` |

### Limites que você vai encontrar

**Cobertura em projetos SwiftPM.** O plugin lê cobertura de `.xcresult`, que só o `xcodebuild` produz. `swift test` gera profdata do llvm-cov. O `scripts/lcov-to-sonar.py` faz a ponte convertendo LCOV para o formato Generic Coverage do núcleo do SonarQube, e o `scan.sh` usa isso automaticamente quando há `Package.swift`.

**`swift test` exige o toolchain do Xcode completo.** Com apenas CommandLineTools, suítes que usam swift-testing falham com `no such module 'Testing'`. O scan segue **sem** cobertura em vez de publicar 0%. Ausência de dado não é cobertura baixa — não relate como se fosse.

**Periphery precisa de `.xcodeproj`.** Exige index store gerado por `xcodebuild -derivedDataPath`. Projeto SwiftPM puro não produz. Não invente um projeto Xcode para contornar; se o usuário quiser detecção de código morto, rode o Periphery separado, fora do Sonar.

**As regras do mobsfscan são orientadas a iOS.** Num app de macOS, achados como `ios_keyboard_cache` são falsos positivos — não há teclado de dispositivo. Triar antes de tratar como dívida técnica.

## Fixação de versão

O `assets/Dockerfile` fixa o plugin por versão **e por SHA-256**. Ao trocar a versão, recalcule o checksum:

```bash
shasum -a 256 sonar-apple-plugin-<versão>.jar
```

Sem o checksum, um release reescrito na origem entraria em silêncio num jar que roda com o alcance de classes do servidor. Ao subir a versão do SonarQube base, **valide o plugin num container descartável antes** de apontar qualquer coisa para a instância de verdade: suba, espere `"status":"UP"`, e confirme que `swift` voltou em `/api/languages/list`.

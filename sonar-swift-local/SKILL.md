---
name: sonar-swift-local
description: "Analisa projetos Swift/Objective-C no SonarQube, que a Community Build não suporta nativamente, subindo uma instância local com o plugin sonar-apple. Use quando o pedido for analisar qualidade, lint, segurança ou cobertura de código Swift/ObjC no SonarQube, quando um projeto Apple precisar entrar num painel Sonar, ou quando um scan de Swift retornar zero linha analisada."
metadata:
  version: 2.1.0
---

# /sonar-swift-local

O suporte nativo a Swift/Objective-C no SonarQube Server começa na Developer Edition. A Community Build precisa de uma extensão compatível para analisar essas linguagens; a presença de `swift` na API não identifica a edição, pois um plugin também pode adicioná-la.

Um scanner pode indexar arquivos sem produzir métricas úteis da linguagem. Um Quality Gate verde, isoladamente, não prova que o código Apple foi analisado.

Esta skill fecha a lacuna com uma instância **local** que carrega o plugin de terceiros [`insideapp-fr/sonar-apple`](https://github.com/insideapp-fr/sonar-apple).

## Antes de qualquer coisa: confirme o diagnóstico

O `scan.sh` verifica a resposta de `/api/languages/list`, a tarefa de processamento e as linhas analisadas por linguagem. Erro HTTP/autenticação, resposta inválida ou zero linhas não viram aprovação. Se já houver suporte compatível no servidor autorizado pelo projeto, use esse fluxo sem instalar outro plugin. A instalação local abaixo é uma opção para preencher a lacuna.

## Decisão de arquitetura: por que local, e não no servidor existente

O plugin declara `Plugin-ChildFirstClassLoader: false`, ou seja, compartilha o classloader do servidor SonarQube. Se um upgrade da imagem base quebrar a compatibilidade, **o SonarQube inteiro deixa de subir** — não é o plugin que falha isoladamente.

Num servidor compartilhado, isso derruba todos os projetos que dependem dele. Numa instância local, derruba um container que ninguém usa em produção.

**Nunca instale este plugin num servidor SonarQube compartilhado sem que o dono peça explicitamente e entenda esse risco.** Se pedirem, teste antes num container descartável da mesma versão.

## Custo que deve ser dito em voz alta

Neste fluxo local, o Quality Gate é **consultivo, não bloqueante**. O scan pode rodar antes ou depois de um merge; informa a branch, revisão e presença de alterações locais.

Falha operacional retorna exit 1 e não consulta um gate antigo como substituto. Uma análise concluída com gate `ERROR` continua consultiva e retorna 0. O resultado usa `ceTaskId → analysisId`, verifica a identidade do projeto e só publica métricas quando pertencem à análise atual. Se outro scan avançar o projeto durante a consulta, repita a medição em vez de atribuir números à revisão errada.

## Instalação

Requer Docker e, no cliente, macOS (as ferramentas de análise Apple não rodam em Linux).

Execute os comandos a partir da pasta canônica desta skill, descoberta pelo `SKILL.md` carregado. Caminhos de projeto/arquivo de ambiente devem ser absolutos quando houver mudança de diretório.

```bash
# 1. Gera a senha do banco no arquivo de ambiente
python3 scripts/bootstrap.py --project-key <chave> --env-file <caminho>

# 2. Sobe a stack (constrói a imagem com o plugin, checksum verificado)
docker compose --env-file <caminho> -f assets/compose.yaml up -d --build --renew-anon-volumes

# 3. Cria o projeto e o token de análise
python3 scripts/bootstrap.py --project-key <chave> --env-file <caminho>

# 4. Analisa
scripts/scan.sh <repo> --key <chave> --env-file <caminho>

# 5. Libera a RAM quando terminar
docker compose --env-file <caminho> -f assets/compose.yaml stop
```

O `--env-file` é obrigatório em **todo** comando compose desta stack, inclusive `stop` e `logs`: o Compose interpola as variáveis antes de executar qualquer ação e falha sem elas.

Porta: `--port` explícito prevalece sobre `SONAR_LOCAL_PORT` do processo, depois sobre o arquivo de ambiente, depois 9100. O bootstrap persiste a porta resolvida; o scan passa a mesma porta ao Compose quando inicia a stack. Se usar um override somente no scan, informe-o também nos comandos Compose manuais. `--timeout` limita a espera da análise; `--startup-timeout` limita a inicialização. Logs ficam em pasta privada por execução: falhas a preservam; sucesso limpa, salvo `--keep-artifacts`.

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
- A intenção de trocar senha é persistida antes da chamada remota. Se houver interrupção, o bootstrap valida a senha pendente e retoma; não exige apagar o banco. A gravação usa temporário 0600 desde a criação, substituição atômica e lock liberado pelo sistema após crash.
- O token é devolvido pela API uma única vez. Se a gravação falhar, o retry recria apenas o token com nome correspondente àquele projeto. Tokens são passados ao scanner por `SONAR_TOKEN`, sem argumento de linha de comando.
- Tokens de análise não concedem leitura geral de projetos privados. Para consultar métricas, o script usa `SONAR_LOCAL_READ_TOKEN_V2_<chave_em_hex_utf8>` quando fornecido (usuário com Browse nesse projeto); caso contrário, usa a credencial admin local já criada pelo bootstrap somente nessas leituras HTTP. A credencial admin nunca é passada ao scanner. Sem acesso de leitura, o resultado fica incompleto, não verde.
- O ambiente do scanner remove `SONAR_LOCAL_*` herdadas e fornece somente seu token por `SONAR_TOKEN`. As chamadas HTTP locais de bootstrap/leitura recusam redirects e ignoram proxies do ambiente, evitando encaminhamento das credenciais locais.
- Erros de API são reportados só pelo código HTTP; o corpo nunca é impresso, porque pode conter token.

## O que este scan entrega

| Entrega | Origem | Depende de |
|:--|:--|:--|
| Complexidade, tamanho, duplicação, syntax highlighting | parser ANTLR do plugin | nada |
| Issues (~233 regras) | SwiftLint | `swiftlint` |
| Segurança (~22 regras) | mobsfscan | `mobsfscan` |
| Código morto (~4 regras) | Periphery | index store do Xcode |
| Cobertura | SwiftPM/LLVM ou `.xcresult`/xccov → Generic Coverage | toolchain Xcode e testes executados com cobertura |

### Limites que você vai encontrar

**Cobertura em projetos SwiftPM.** O plugin lê cobertura de `.xcresult`, que só o `xcodebuild` produz. `swift test` gera profdata do llvm-cov. O `scripts/lcov-to-sonar.py` faz a ponte convertendo LCOV para o formato Generic Coverage do núcleo do SonarQube, e o `scan.sh` usa isso automaticamente quando há `Package.swift`.

Cada execução usa um scratch de build exclusivo. Dois scans não compartilham profdata, XML ou logs; artefatos ambíguos não são escolhidos com `head -1`. Se o relatório foi enviado mas a análise não confirma cobertura, o scan fica incompleto.

**Cobertura de `.xcresult`.** Gere o bundle com `xcodebuild ... -enableCodeCoverage YES -resultBundlePath <bundle> test`, usando o scheme/destination do projeto. Depois informe `scripts/scan.sh <repo> --key <chave> --env-file <caminho> --xcresult <bundle>`. Essa opção tem precedência sobre SwiftPM e não reexecuta os testes: o bundle precisa corresponder ao checkout analisado. O resultado registra `coverage_source=supplied_xcresult`. Bundle ausente, inválido ou sem linhas do repositório interrompe o scan.

O helper usa `xccov view --archive --json` e converte para caminhos canônicos relativos. Isso evita a perda de cobertura observada no plugin 0.5.1 quando Xcode grava `/var/...` e Sonar indexa `~/tmp/...`. A importação nativa descrita pelo [projeto sonar-apple](https://github.com/insideapp-fr/sonar-apple#sonar-configuration) usa `sonar.apple.resultBundlePath` **relativo** ao projeto; não confunda exit 0 do scanner com cobertura importada. O fluxo desta skill confirma a medição atual pela API. O conversor importa cobertura de linhas; não importa contagem/duração dos testes nem warnings do Xcode.

**`swift test` exige o toolchain do Xcode completo.** Com apenas CommandLineTools, suítes que usam swift-testing falham com `no such module 'Testing'`. O scan segue **sem** cobertura em vez de publicar 0%. Ausência de dado não é cobertura baixa — não relate como se fosse.

`xcode-select -p` mostra o toolchain selecionado, não todas as instalações. Se apontar para CommandLineTools, verifique se há Xcode completo instalado antes de concluir que ele está ausente. Use `DEVELOPER_DIR` apenas no comando para selecionar a instalação desejada, sem mudar a configuração global:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer scripts/scan.sh <repo> --key <chave> --env-file <caminho>
```

**Periphery precisa de `.xcodeproj`.** Exige index store gerado por `xcodebuild -derivedDataPath`. Projeto SwiftPM puro não produz. Não invente um projeto Xcode para contornar; se o usuário quiser detecção de código morto, rode o Periphery separado, fora do Sonar.

**As regras do mobsfscan são orientadas a iOS.** Num app de macOS, achados como `ios_keyboard_cache` são falsos positivos — não há teclado de dispositivo. Triar antes de tratar como dívida técnica.

## Fixação de versão

O `assets/Dockerfile` fixa o plugin por versão **e por SHA-256**. Ao trocar a versão, recalcule o checksum:

```bash
shasum -a 256 sonar-apple-plugin-<versão>.jar
```

Sem o checksum, um release reescrito na origem entraria em silêncio num jar que roda com o alcance de classes do servidor. Ao subir a versão do SonarQube base, **valide o plugin num container descartável antes** de apontar qualquer coisa para a instância de verdade: suba, espere `"status":"UP"`, e confirme que `swift` voltou em `/api/languages/list`.

Os plugins pertencem à imagem. O Compose não declara mais volume persistente de extensões, mas a imagem base declara `VOLUME` e cria um volume anônimo. Para atualizar, use `docker compose --env-file <caminho> -f assets/compose.yaml up -d --build --force-recreate --renew-anon-volumes`: sem a última flag, o Compose pode herdar extensões antigas mesmo após o rebuild. Banco, dados e logs usam volumes nomeados e continuam persistentes. O volume nomeado antigo de extensões não é apagado; se foram instalados plugins extras nele, inventarie-os e incorpore as versões compatíveis à imagem antes de migrar. Nunca use `down -v` para atualizar o plugin. Veja a semântica de [renew-anon-volumes no Docker Compose](https://docs.docker.com/reference/cli/docker/compose/up/).

## Migração de 1.x e validação

Rode novamente `bootstrap.py` para cada projeto. Variáveis antigas `SONAR_LOCAL_TOKEN_<CHAVE_NORMALIZADA>` são preservadas, mas o scan 2.x não as reutiliza: pontuação e caixa podiam colidir. A chave v2 codifica exatamente o project key; o bootstrap gera/valida o token específico. Preserve o arquivo de ambiente e seus segredos durante a migração.

Validação local: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v`. A suíte usa projetos descartáveis, API HTTP local, scanner simulado e falhas injetadas; não certifica compatibilidade do plugin com todo Swift/Xcode. Para cada atualização de toolchain/plugin, teste um projeto mínimo real com linhas Swift/ObjC e cobertura conhecida em stack descartável. Registre versões, analysisId, métricas e o que não rodou (por exemplo, Xcode completo ausente).

O smoke opt-in `scripts/tests/live_smoke.py` sobe um projeto Compose exclusivo e remove os containers/volumes nomeados dele ao terminar. Exige imagens locais explicitamente informadas. Com `--coverage --developer-dir /Applications/Xcode.app/Contents/Developer`, compila testes SwiftPM reais, mantém caminhos sem teste e compara a cobertura do LLVM com a importada nas análises antes/depois da recriação. Consulte `--help` para imagem, PostgreSQL e arquivo de resultado. Não use esse smoke contra uma instância compartilhada.

Referências do protocolo: [parâmetros do scanner](https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui) e [consulta de gate por análise da SonarSource](https://github.com/SonarSource/sonarqube-quality-gate-action/blob/master/script/check-quality-gate.sh).

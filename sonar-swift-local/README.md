# Skill: sonar-swift-local

Analisa **Swift e Objective-C** no SonarQube local com extensão compatível. Confirma tarefa, análise e linhas da linguagem antes de apresentar o gate; falha operacional fica explícita.

A skill sobe uma instância **local** com o plugin `insideapp-fr/sonar-apple`, fixado por versão e SHA-256. O workflow, os limites e o tratamento de segredo estão no [`SKILL.md`](SKILL.md).

Fonte canônica: este repo. Hosts consomem por **symlink**.

## Uso

```
/sonar-swift-local
scripts/scan.sh <repo> --key <chave> --env-file <arq>
# Bundle Xcode já gerado com cobertura, correspondente ao mesmo checkout:
scripts/scan.sh <repo> --key <chave> --env-file <arq> --xcresult <bundle>
```

Requer Docker e macOS no cliente (ferramentas Apple não rodam em Linux). O `--env-file` é obrigatório em todo comando compose, inclusive `stop`.

| | |
|---|---|
| **Quando** | Projeto Apple precisa de painel Sonar; scan de Swift devolve zero linha |
| **Entrega** | Complexidade, duplicação, ~233 regras SwiftLint, ~22 de segurança, cobertura |
| **Não faz** | Código morto em SwiftPM puro (Periphery exige `.xcodeproj`); gate bloqueante — aqui é consultivo |

Nunca instala o plugin num SonarQube compartilhado: ele usa o classloader do servidor, e incompatibilidade impede a instância inteira de subir.

## Estrutura

```
sonar-swift-local/
├── SKILL.md
├── assets/
│   ├── Dockerfile       # plugin fixado por versão e SHA-256
│   └── compose.yaml
└── scripts/
    ├── bootstrap.py     # senha e token só no env-file (0600)
    ├── scan.sh
    ├── scan.py          # análise correlacionada, temporários exclusivos e métricas
    ├── local_config.py  # escrita privada/atômica, lock e chaves sem colisão
    ├── local_http.py    # API local sem redirects nem proxies
    ├── lcov-to-sonar.py # cobertura SwiftPM (llvm-cov → generic coverage)
    └── xccov-to-sonar.py # cobertura Xcode com caminhos canônicos
```

Na migração de 1.x, execute o bootstrap por projeto para gerar tokens v2; não apague o env-file. Para atualizar a imagem, recrie com `--renew-anon-volumes`: a imagem base declara um volume anônimo de extensões. Banco/dados/logs persistem em volumes nomeados. Veja o comando completo e limites no SKILL.md.

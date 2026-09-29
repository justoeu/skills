# Skill: sonar-swift-local

Analisa **Swift e Objective-C** no SonarQube. A Community Build não suporta as linguagens Apple, e um scan apontado para ela indexa zero linha com o Quality Gate verde.

A skill sobe uma instância **local** com o plugin `insideapp-fr/sonar-apple`, fixado por versão e SHA-256. O workflow, os limites e o tratamento de segredo estão no [`SKILL.md`](SKILL.md).

Fonte canônica: este repo. Hosts consomem por **symlink**.

## Uso

```
/sonar-swift-local
scripts/scan.sh <repo> --key <chave> --env-file <arq>
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
    └── lcov-to-sonar.py # cobertura SwiftPM (llvm-cov → generic coverage)
```

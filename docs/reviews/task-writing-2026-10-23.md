# Tasks após o SDD e exposição nos hosts — 2026-10-23

## Entrega

A make-me-happy 1.5.0 aplica uma adaptação prática do ASD-STE100 à criação de tasks
após o SDD confirmado. Os “80%” solicitados indicam adoção pragmática: voz ativa,
ações diretas, condições explícitas, termos consistentes e critérios observáveis.
Não representam uma porcentagem calculada nem conformidade com o inglês controlado.
O idioma e os identificadores do projeto são preservados.

O [guia de escrita](../../make-me-happy/references/task-writing.md) está ligado ao
entrypoint, planner, schema e spec reviewer. O planner registra descrição e aceite
no JSON. O reviewer compara o significado com o SDD. A orientação não inventa
comportamento ausente nem transforma limites de frase em bloqueios automáticos.

O Markdown regenerado agora preserva responsabilidade, descrição, justificativa,
aceite, referências e dependências. O HTML já apresentava esses dados. Alterações em
`slice`, `description` ou `why` invalidam snapshots anteriores, assim como alterações
no aceite e nos demais inputs; não é possível carimbar a revisão antiga como atual.
O schema permanece 2, e packs sem esses campos continuam legíveis.

## Validação

- [RED](task-writing-2026-10-23-evidence/red.log): quatro falhas observáveis antes das mudanças nos scripts.
- [Suíte make-me-happy](task-writing-2026-10-23-evidence/make-me-happy-suite.log): **134/134**, zero falhas e zero skips, com Chromium real habilitado.
- [Checker de instalação](task-writing-2026-10-23-evidence/host-links-tests.log): **14/14**.
- Validador formal da skill: válido. Links novos e `git diff --check`: válidos.
- [Hashes das fontes verificadas](task-writing-2026-10-23-evidence/source-snapshot.json).
- [Passe independente](task-writing-2026-10-23-evidence/forward/forward-report.md):
  três tasks preliminares produzidas a partir de uma fixture em português, com
  critérios rastreáveis e lacunas de contrato explicitadas. Nenhum código HTTP,
  campo ou componente ausente foi inventado. O plano não foi despachado como pronto.
  Os artefatos preservam paths temporários da execução; servem como registro do ensaio.

Os 311 testes da [rodada anterior](remaining-validation-2026-10-23.md) permanecem
como evidência daquela revisão. Nesta rodada foi repetida a suíte afetada, com quatro
casos adicionais; as suites não alteradas não foram contabilizadas como nova execução.

## Instalação

As seis skills e o alias `mmh` estão ligados à fonte canônica em sete roots: Codex,
Claude, Grok, Muse, OpenCode, Agy CLI e Antigravity App/IDE. Foram conferidos **49
symlinks**, destinos reais, versões e hashes do `SKILL.md`, sem cópias físicas.
[Manifesto de exposição](task-writing-2026-10-23-evidence/host-exposure.json).

O checker passou a incluir os roots próprios do OpenCode e Antigravity. A documentação
anterior agrupava Agy incorretamente com `~/.agents/skills`; os paths foram corrigidos
conforme os [docs oficiais de Antigravity](https://www.antigravity.google/docs/skills)
e [OpenCode](https://dev.opencode.ai/v2/docs/skills/).

O CLI instalado do Muse listou as seis skills de usuário com `activation: on` e sem
diagnósticos: [descoberta real](task-writing-2026-10-23-evidence/muse-discovery.json).
O OpenCode confirmou `Configuration reloaded`. A prova dos demais hosts é de
exposição no filesystem; não afirma execução de um prompt por modelo em cada host.
Uma sessão que já carregou instruções antigas deve ser reaberta para relê-las.

| Skill | Versão exposta |
|---|---|
| make-me-happy | 1.5.0 |
| abuse-audit | 1.0.1 |
| atlas-docs | 2.0.0 |
| deep-audit | 2.0.0 |
| ultra-deep-audit | 2.0.1 |
| sonar-swift-local | 2.1.0 |

## Commits e fronteira externa

`166141c` registra a revisão anterior, as seis versões e as evidências. `1797f0c`
registra a correção dos roots de instalação. A mudança de escrita é uma entrega
separada. Não houve push.

O patch de quatro linhas em `app-gp/deployments/scripts/runtime-images-supply-chain-gate.sh`
permanece local. O AGENTS.md desse outro repositório exige CI completo verde antes de
commit. Não há essa evidência para o estado atual; há suites pesadas de outro trabalho
em execução. As três revisões do patch não encontraram defeito atual; a revisão de
testes sugeriu tornar permanente a prova de preservação do manifesto em modo de consulta,
hoje registrada como verificação independente. Os contratos do harness não substituem
o gate completo do app-gp. Alterações alheias nesse repositório foram preservadas.

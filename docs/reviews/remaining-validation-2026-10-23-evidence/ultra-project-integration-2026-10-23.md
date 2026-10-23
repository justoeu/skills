# Ultra — integrações opt-in do projeto, 2026-10-23

**Resultado final: 91 testes PASS, zero FAIL, zero SKIP**, incluindo os 33 contratos opt-in atuais. O passe começou com os 28 testes externos originais: 11 PASS e 17 FAIL. As falhas não foram convertidas em SKIP: contratos obsoletos foram substituídos por verificações do comportamento atual e um defeito real do gate foi corrigido após autorização específica.

## Escopo e isolamento

Foram lidos AGENTS.md, CLAUDE.md e as orientações backend pertinentes do projeto `~/Developer/Workspace/app-gp`, além do relatório local do grafo. A análise usou o código atual como fonte de verdade. HEAD observado: `0f7072209898a3e5c60bd0bd8c2b1e74c0adcf74`.

O snapshot inicial preservou 11 arquivos necessários e os links observados `scripts -> deployments/scripts`, `infra -> deployments/infra`. Manifesto com hashes/tamanhos: `/tmp/ultra-project-integration-20261023-q0_hmmk7/manifest.json`. Não foram copiados `.env`, credenciais, dados, árvores de build ou a skill para dentro do app.

Os testes permanentes agora copiam os scripts e configs para fixtures próprias, executam nelas e fazem cleanup. O helper prefere `deployments/scripts`/`deployments/infra`, com fallback para `scripts`/`infra` legados. Cria Git somente na fixture para conter os logs do ci-local. Remove do ambiente os overrides de Git/Bash que poderiam redirecionar a execução. Docker, Trivy e Maven usam stubs; ferramentas externas inesperadas falham e o hook final denuncia qualquer chamada. A execução final também bloqueou APIs de rede do Node com `/tmp/review-ultra-netguard.cjs`.

`ci-local` completo não foi executado. Foram exercitados apenas seu modo `--verificar-xml-pitest` e funções selecionadas após `source` (o script retorna antes do pipeline quando carregado assim). Nenhum build de aplicação, serviço, registry, deploy, commit ou push foi executado.

## Achados e correções

### P1 — arquivo de deploy antigo sobrevivia a falha inicial do publish [corrigido]

Fonte original: `app-gp/deployments/scripts/runtime-images-supply-chain-gate.sh`, SHA256 `15c5a35ca749c6d02f4be276c5362d8ba8b000794b96b9f06759375d3bf0a60c`. O gate validava compose/conjunto/digests antes de remover `runtime-images.env` (remoção antiga na linha 114). Compose ausente ou digest inválido encerrava com 1, deixando um arquivo da tentativa anterior disponível.

Reprodução independente: `/tmp/probe-runtime-current.py`; dados em `/tmp/ultra-project-integration-20261023-q0_hmmk7/current-runtime-probe/results.json`:

| Caso antes do fix | Exit | Docker real | Artifact antigo | SBOMs |
|---|---:|---:|---|---:|
| Input atual válido, stubs | 0 | nenhum (3 chamadas ao stub) | substituído por 3 refs digest | 10 |
| Falha simulada de vulnerabilidade | 1 | nenhum (3 chamadas ao stub) | removido | 10 |
| Digest inválido | 1 | nenhum (0 chamadas) | **preservado** | 0 |
| Compose ausente | 1 | nenhum (0 chamadas) | **preservado** | 0 |

Impacto demonstrado: arquivo antigo permanece consumível após falha. O gate devolvia status de erro corretamente; não foi demonstrado que um consumidor/deploy ignorava esse status. A garantia de não expor artefato de tentativa anterior, porém, era falsa.

Correção mínima: invalidar o env do publish imediatamente depois de resolver seu caminho, antes de qualquer preflight; preservar publicação atômica somente após os scans. O modo sem publish não apaga esse arquivo. As duas regressões permanentes exigem exit não zero, diagnóstico correto, zero chamadas a Docker/Trivy e ausência do arquivo antigo.

Patch exato: `/tmp/app-gp-runtime-env-preflight.patch`. Foi validado com `git apply --check`, testado primeiro em cópia temporária e só então aplicado ao script canônico, após comparar os bytes com o snapshot inspecionado. SHA256 final: `2feb68fdc39c9d3f206ec2df2edbed7600b1770c8f028079cb3853a12ee7155d`. Registro: `/tmp/ultra-project-integration-20261023-q0_hmmk7/applied-patch.json`. Único arquivo do app editado por este passe. A invalidação está agora nas linhas 15–18.

### P2 — 15 testes de runtime descreviam o stack anterior [corrigido]

Os cenários antigos usavam MySQL + Redis, quatro imagens, oito SBOMs e dois builds de publish. O gate/compose atuais usam PostgreSQL + Redis + Flyway como runtimes locais e RabbitMQ + MinIO como as outras imagens: cinco imagens, duas plataformas, dez SBOMs, seis builds locais ou três builds multiarch no publish. O teste do compose real executava corretamente o gate, mas falhava em `6 !== 4`; os demais paravam cedo por ausência de PostgreSQL antes de exercer a intenção nominal.

Referências atuais: `ultra-deep-audit/scripts/tests/runtime-images-supply-chain-gate.test.mjs:32` (roles/plataformas), `:168` (env), `:219` (interpolações), `:264` (compose real), `:295` (cinco imagens/dez SBOMs), `:340` (falha de scan preserva todos os SBOMs), `:578` em diante (preflight). Fixtures atualizadas preservam os asserts de erro, contagens, plataformas, digests, SBOM/provenance e publicação apenas após sucesso. Foram acrescentadas as três variantes de interpolação inválida do Flyway, além das duas regressões reais acima. Stubs de digest usam Node, evitando depender do utilitário GNU sha256sum no macOS.

### P2 — dois contratos do ci-local validavam texto aposentado [corrigido]

1. `REPARO_TESTES >= 3` era o antigo reparo MySQL. O código atual declara explicitamente que a execução manifestada PostgreSQL substitui o manifesto MySQL (`ci-local.sh:893`). O novo teste (`ci-local-contracts.test.mjs:74`) executa `rodar_sql_real_its` real com três migrações/ITs de fixture e Maven/Docker simulados. Zero, um ou dois XMLs nominais falham; todos os casos skipped ou com failure falham; três XMLs válidos passam. Não se exige restaurar um caminho MySQL aposentado.
2. O regex exigia logs fixos `/tmp/ci-local-pit-*`, contrariando o hardening para `$LOGS` por worktree. O novo teste (`:225`) aciona todos os perfis condicionais configurados, passando pelo `rodar_pitest` e verificador XML reais. Maven simulado exit0 + RUN_ERROR deve reprovar todos; KILLED coerente deve aprovar todos. Isso valida a garantia original sem impor o caminho antigo do log.

Os sete casos existentes do verificador XML e os contratos de POM/agenda/assinatura foram preservados. O teste real dos pins BOM passou sem alteração no POM ou parser.

## Evidência de execução

| Execução | Pass | Fail | Skip | Log |
|---|---:|---:|---:|---|
| 28 contratos originais, snapshot observado | 11 | 17 | 0 | `.../results.tap` no workspace inicial |
| 33 contratos atualizados, app real antes do patch | 31 | 2 | 0 | `/tmp/ultra-project-current-real.log` |
| Mesmos 33, cópia com patch | 33 | 0 | 0 | `/tmp/ultra-project-patched-copy.log` |
| Suíte Ultra inteira, opt-in da raiz real após patch | **91** | **0** | **0** | `/tmp/ultra-project-final-all.log` |

O helper está em `ultra-deep-audit/scripts/tests/project-integration-fixture.mjs:10`. A Ultra foi atualizada para **2.0.1**, mantendo **schema 2**; SKILL.md e README documentam o opt-in e seus limites. `quick_validate.py` passou com PyYAML já disponível via cache offline (`uv run --no-project --offline --with pyyaml ...`); o Python de sistema isolado não tinha esse pacote. Nenhuma instalação de rede foi feita.

Comando completo usado na validação final, a partir de `harness/skills`:

```sh
ULTRA_PROJECT_ROOT=~/Developer/Workspace/app-gp \
NODE_OPTIONS='--require /tmp/review-ultra-netguard.cjs' \
node --test --test-concurrency=1 ultra-deep-audit/scripts/tests/*.test.mjs
```

Sem `ULTRA_PROJECT_ROOT`, os 33 contratos permanecem explicitamente SKIP; isso não é contado como cobertura executada. O opt-in continua específico do projeto de origem, sem impor seu stack às auditorias genéricas.

## Limites

Os contratos executam lógica real dos scripts e parsers, com fronteiras externas simuladas. Não provam compilação das imagens, conteúdo/vulnerabilidades de imagens reais, acesso ao registry, execução real de Maven/PITest/ITs, sucesso de deploy ou CI remota. Nenhuma suíte pesada da aplicação nem pipeline ci-local completo rodou. As invariantes demonstradas são contagens, validação dos artefatos, propagação de falhas, seleção dos perfis e preservação/invalidação de estado. A revisão independente final do root é separada deste passe.

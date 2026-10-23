# Auditoria das demais skills — 2026-10-22

> Registro da auditoria inicial. O estado atual e as provas das correções estão no [relatório de remediação](other-skills-remediation-2026-10-22.md). Os achados abaixo descrevem a versão anterior.

## Resultado e escopo

A `make-me-happy` foi corrigida na etapa anterior: [matriz dos 20 achados e validação com 130 testes](make-me-happy-remediation-2026-10-22.md). As alterações continuam locais, sem commit/push. Nesta etapa, confirmei diretamente que os quatro hosts (`.codex`, `.agents`, `.claude`, `.grok`) apontam para a pasta canônica da skill, portanto já recebem essas alterações.

Esta nova auditoria cobre as outras **cinco skills próprias deste repositório** — `abuse-audit`, `atlas-docs`, `deep-audit`, `ultra-deep-audit`, `sonar-swift-local` — e o utilitário compartilhado `scripts/check-links.mjs`. Não cobre todas as skills externas instaladas na máquina.

**As demais skills ainda precisam de correções.** Foram reproduzidos casos de perda de achados, aprovação com evidência inválida/antiga, execução de conteúdo do projeto durante setup, execução de JavaScript no dashboard e exclusão de edições locais pelo reparador de links. Suas fontes permaneceram intactas; esta etapa entrega análise e evidência, sem declarar os achados resolvidos.

Todos os achados abaixo e nos três relatórios anexos estão **ABERTOS**. “Reproduzido” significa comportamento observado em fixture local, não incidente observado em um projeto real. “Estático” significa consequência identificada por inspeção, com as condições explicitadas. P1 = prioridade alta; P2 = média. As prioridades consideram impacto e caminho de uso, sem afirmar exploração externa.

## Prioridades

| Área | Problema que merece correção primeiro | Evidência detalhada |
|---|---|---|
| `check-links` | `--fix` elimina conteúdo divergente e apaga o próprio backup | TL-01 abaixo |
| `deep-audit` | Setup interpreta metadados como shell; CRITICAL herda refutação de outro achado | [DA-01 e DA-03](deep-audit-2026-10-22.md) |
| `deep-audit` e `ultra-deep-audit` | JSON inválido vira zero achados; voto inválido vira verificação concluída | [Deep](deep-audit-2026-10-22.md), [Ultra](ultra-deep-audit-2026-10-22.md) |
| `atlas-docs` | ID interpolado em handler executa JavaScript; atualização preserva informações removidas | [Auditoria Atlas](atlas-docs-2026-10-22.md) |
| `sonar-swift-local` | Scanner falha, script sai 0 e apresenta Quality Gate antigo como resultado atual | SO-01 abaixo |
| `abuse-audit` | Regras absolutas podem descartar proteção válida ou aceitar limites insuficientes | AB-01 e AB-02 abaixo |

Os problemas de acompanhamento são estruturais: identidade de achados, vínculo entre evidência e revisão, preservação de estados no merge, isolamento entre execuções e escrita concorrente. Corrigir apenas a redação do relatório não resolve esses mecanismos.

## Relatórios por skill

- [Deep: reproduções, linhas, critérios de correção e limites](deep-audit-2026-10-22.md).
- [Ultra: reproduções, portabilidade dos testes, qualidade e dependências](ultra-deep-audit-2026-10-22.md).
- [Atlas: atualização incremental/full, histórico, segurança e navegador](atlas-docs-2026-10-22.md).
- Sonar, Abuse e infraestrutura compartilhada estão detalhados a seguir.

Os anexos preservam a numeração local dos achados. Causas compartilhadas entre Deep e Ultra não devem ser contadas como descobertas independentes, mas precisam de correção e regressão em ambos os consumidores.

[Resultados e logs preservados](other-skills-2026-10-22-evidence/README.md) permitem conferir a evidência mesmo depois da remoção das fixtures temporárias. São provas de defeitos abertos, não aprovações das skills.

## Infraestrutura compartilhada

### TL-01 · P1 · Correção de links destrói edições locais

**Local:** `scripts/check-links.mjs:86–88,133–140`. **Reproduzido.**

`isSubsetOf` compara apenas nomes de arquivos. Uma cópia com os mesmos nomes da canônica, mas com conteúdo exclusivo editado pelo usuário, é tratada como segura para substituição. `fixDrift` renomeia essa cópia para backup, apaga imediatamente o backup e só então cria o symlink.

Fixture: `alpha/SKILL.md` canônico e outro `alpha/SKILL.md` com texto exclusivo no host. Resultado: `subset=true`, `fixed=true`, conteúdo exclusivo ausente e nenhum backup restante. Nenhum diretório real de host foi alterado.

**Correção e aceite:** comparar conteúdo/tipo dos arquivos ou preservar backup recuperável e mostrar diff; só concluir depois de verificar o destino. Testar arquivo de mesmo nome e bytes diferentes, arquivo extra, symlink interno e falha ao criar o link. Conteúdo divergente deve sobreviver à operação, inclusive em falha intermediária.

### TL-02 · P2 · Link para a skill errada passa na auditoria

**Local:** `scripts/check-links.mjs:107–112,159–164`. **Reproduzido.**

O teste aceita qualquer destino dentro do harness. Em fixture, `host/alpha → harness/beta` resulta em `findings=[]`. O mesmo critério é usado para aliases. A verificação direta dos destinos de `make-me-happy` nesta sessão foi feita separadamente; não há evidência de que os hosts atuais estejam apontando para outra skill.

**Correção e aceite:** comparar o realpath com a skill canônica exata; resolver explicitamente aliases. Testar destino correto, outra skill do mesmo harness e destino externo.

### TL-03 · P2 · Link quebrado e formato legado quebram o reparo

**Local:** `scripts/check-links.mjs:102–107,144–148`. **Reproduzido.**

Um symlink cujo destino não existe é classificado como ausência; `--ensure` tenta criar por cima e falha com `EEXIST`. Quando existe apenas `alpha.md`, a guarda aceita a entrada, mas `lstat(alpha)` lança `ENOENT` e interrompe a auditoria.

**Correção e aceite:** detectar a própria entrada com `lstat`, distinguir ausente/link quebrado/arquivo legado e tratar cada caso sem abortar os outros hosts. Os cenários precisam produzir diagnóstico acionável e reparo seguro ou recusa explícita.

## sonar-swift-local

### SO-01 · P1 · Falha do scan exibe aprovação antiga

**Local:** `sonar-swift-local/scripts/scan.sh:116–136`. **Reproduzido com CLI/API simuladas.**

O erro do scanner vira aviso, e o script consulta o estado atual do projeto sem comprovar que ele pertence à execução iniciada. A saída ainda imprime o HEAD atual como “Analisado”. Fixture com scanner retornando 2 e API devolvendo um Quality Gate antigo `OK`: o script retornou **0** e exibiu **OK**.

**Correção e aceite:** separar falha de execução de Quality Gate consultivo reprovado; correlacionar tarefa/análise/revisão com a tentativa atual. Simular scanner indisponível, autenticação negada, timeout de processamento, gate antigo verde e scan atual completo. Falha operacional deve ficar explícita e nunca atribuir aprovação antiga ao HEAD atual. Manter o caráter consultivo do gate é compatível com detectar falha do scan.

### SO-02 · P2 · Interrupção na troca de senha impede recuperação

**Local:** `sonar-swift-local/scripts/bootstrap.py:87–95`. **Reproduzido com API falsa e falha de disco injetada.**

A senha admin muda no servidor antes de ser persistida localmente. Uma falha nessa janela deixa o servidor com senha nova e o arquivo sem ela. Reexecutar tenta novamente `previousPassword=admin`, recebendo 401. A promessa de idempotência não cobre essa interrupção.

**Correção e aceite:** guardar a intenção/credencial pendente com proteção adequada antes do efeito remoto e reconciliar o estado na retomada. Injetar falhas antes e depois da chamada e da persistência; a retomada deve recuperar sem reset destrutivo do servidor e sem revelar a senha.

### SO-03 · P2 · Chaves de projetos colidem no nome do token

**Local:** `sonar-swift-local/scripts/bootstrap.py:113–127`; `scripts/scan.sh:43`. **Reproduzido.**

`app-a` e `app.a` geram a mesma variável `SONAR_LOCAL_TOKEN_APP_A`. Com o token do primeiro já presente, o bootstrap do segundo não gera token próprio e passa a reutilizar uma credencial associada ao outro projeto. Diferenças apenas em maiúsculas/minúsculas também são eliminadas.

**Correção e aceite:** mapeamento sem colisão, com identificação do projeto e validação de credencial existente. Testar pares de chaves normalizadas iguais e migração dos arquivos atuais sem perder tokens.

### SO-04 · P2 · Arquivo de segredos nasce com permissão mais ampla

**Local:** `sonar-swift-local/scripts/bootstrap.py:36–43`. **Reproduzido.**

`write_text` cria/grava o arquivo antes de `chmod(0600)`. Com umask 022, a observação entre as operações encontrou **0644**; ao final, 0600. A fixture estava em diretório temporário privado, portanto a prova demonstra a janela de permissões, não leitura por outra pessoa. A escrita também não é atômica.

**Correção e aceite:** criar temporário com modo 0600 desde o primeiro byte e substituir atomicamente, protegendo atualizações concorrentes. Testar primeira criação, arquivo existente, interrupção e dois escritores. Evitar também passar o token em argumento do processo quando houver mecanismo de ambiente compatível; o scanner documenta `SONAR_TOKEN`. [Parâmetros oficiais do SonarScanner](https://docs.sonarsource.com/sonarqube-server/10.4/analyzing-source-code/analysis-parameters).

### SO-05 · P2 · Conversão de cobertura perde dados válidos

**Local:** `sonar-swift-local/scripts/lcov-to-sonar.py:30–37,48–62`. **Dois casos reproduzidos.**

1. `DA:1,3,checksum` é descartado porque o código tenta converter `3,checksum` inteiro em número. A CLI sai 0, anuncia um arquivo convertido e produz um `<file>` sem `lineToCover`. O checksum é campo opcional válido do formato. [Especificação LCOV](https://raw.githubusercontent.com/linux-test-project/lcov/v2.3.1/man/geninfo.1).
2. A raiz do repo é normalizada com `resolve()`, mas o caminho absoluto do registro SF não é. No macOS, `/var/...` e `~/tmp/...` podem representar o mesmo arquivo; a fixture com caminho equivalente foi rejeitada como fora do repo. Com SF canônico, a mesma linha sem checksum foi convertida corretamente.

**Correção e aceite:** parsear os campos LCOV separadamente; normalizar ambos os caminhos de forma consistente e continuar rejeitando arquivos realmente externos. Testar checksum, registros repetidos, alias por symlink, arquivo externo e entrada sem linhas válidas. Não afirmar conversão útil apenas porque existe um registro SF. Não foi afirmado que a versão atual do llvm-cov emita checksums por padrão.

### SO-06 · P2 · Cobertura usa temporários globais e seleção ambígua

**Local:** `sonar-swift-local/scripts/scan.sh:84–96`. **Estático.**

Todas as execuções usam os mesmos quatro nomes `/tmp/sonar-swift-*`; scans simultâneos de repos diferentes podem sobrescrever logs/LCOV/XML um do outro. `find .build ... | head -1` escolhe o primeiro profdata/bundle encontrado, sem vínculo demonstrado com o teste recém-executado.

**Correção e aceite:** diretório temporário exclusivo por execução, cleanup controlado e caminhos derivados da configuração de build atual. Reproduzir dois scans intercalados e uma `.build` com duas configurações; cada scan deve consumir somente sua cobertura.

### SO-07 · P2 · Flag de porta e Compose não compartilham configuração

**Local:** `sonar-swift-local/scripts/scan.sh:38,55–64`; `assets/compose.yaml:43–46`; `bootstrap.py:71–74`. **Estático.**

`--port` muda o endereço consultado pelo script, mas a stack usa `SONAR_LOCAL_PORT` do ambiente/arquivo ou 9100. Informar apenas `--port 9200` não faz o Compose subir em 9200; o script pode iniciar em uma porta e aguardar em outra.

**Correção e aceite:** resolver uma única configuração de porta e propagá-la ao bootstrap, Compose e scan; detectar conflito explícito. Testar default, flag, variável persistida e valores conflitantes sem aguardar cinco minutos por uma instância na porta errada.

### SO-08 · P2 · Volume de plugins esconde atualização da imagem

**Local:** `sonar-swift-local/assets/compose.yaml:49`; `assets/Dockerfile:17–29`. **Estático, condicionado à reutilização de volume já populado.**

O JAR é instalado na imagem em `/opt/sonarqube/extensions/plugins`, mas `/opt/sonarqube/extensions` é coberto por volume persistente. Após a primeira instalação, reconstruir a imagem com outra versão do plugin não substitui automaticamente o conteúdo desse volume. O comportamento de ocultar arquivos da imagem por volume não vazio é documentado pelo Docker. [Documentação de volumes](https://docs.docker.com/engine/storage/volumes/).

**Correção e aceite:** definir migração de plugins e verificar versão/checksum efetivamente carregados, preservando banco/dados. Testar instalação inicial e upgrade sobre volume existente. Não foi executado upgrade real de Docker nesta auditoria.

**Oportunidades adicionais:** o diagnóstico não deve deduzir a edição do servidor apenas da presença da linguagem Swift — o próprio plugin também a adiciona. Validar `ncloc`, linguagem e importação dos relatórios na análise atual. O README do plugin descreve Swift 5; isso não prova incompatibilidade com versões novas, mas justifica uma matriz de compatibilidade executável com o Swift/Xcode usados pelo usuário. [Projeto sonar-apple](https://github.com/insideapp-fr/sonar-apple).

## abuse-audit

Esta skill é apenas um procedimento em Markdown. Não há uma CLI cujo resultado prove a qualidade da decisão futura de um modelo. Os achados abaixo são contradições e contraexemplos das regras, identificados por leitura; não são alegações de que um modelo já produziu um relatório errado em produção.

### AB-01 · P2 · A posição do limitador é usada como prova de cobertura

**Local:** `abuse-audit/SKILL.md:56–64`. **Contradição metodológica.**

A instrução diz que proteção em middleware conta e chamada no handler não conta. Um handler pode chamar corretamente o mesmo limitador atômico compartilhado antes de todo trabalho caro. A posição da chamada, sozinha, não prova buraco. A regra contradiz a exigência anterior de demonstrar entrada, guarda ausente e custo.

**Correção e aceite:** separar preferência arquitetural de vulnerabilidade demonstrada. Usar fixtures semanticamente equivalentes com middleware e handler: ambas protegidas não devem gerar achado; uma rota que omite o controle deve gerar achado com caminho concreto de bypass.

### AB-02 · P2 · Exemplos tratam limites parciais como proteção suficiente

**Local:** `abuse-audit/SKILL.md:62,100,144`. **Contraexemplos metodológicos.**

Cap de tamanho reduz custo por requisição, mas não limita quantas requisições válidas podem ser repetidas. Prova de credencial fresca precisa ter custo, unicidade ou orçamento demonstrável para limitar repetição. Um mapa por ID de usuário também não tem cardinalidade limitada apenas pelo tipo da chave se contas puderem ser criadas continuamente e não houver remoção/teto.

**Correção e aceite:** exigir prova do orçamento efetivo por operação, tempo, identidade e processo. Avaliar upload pequeno repetível, conta descartável, credencial reutilizável e cache de usuários sem expiração. Comparar com controles realmente suficientes: limite global, TTL com teto, quota atômica e identidade cuja criação tenha orçamento verificado. Tamanho, frequência e recursos concorrentes são dimensões distintas na orientação da OWASP. [OWASP API4 — consumo irrestrito de recursos](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/).

**Oportunidades adicionais:**

- `:74` confunde crescimento de um contador numérico com crescimento de linhas; avaliar escrita, índices, contenção e espaço separadamente.
- `:145` traz uma ordem absoluta entre escrita anônima e leitura autenticada, embora peça ordenar por custo e alcance. Uma leitura autenticada com fan-out caro pode ser mais grave; usar custo demonstrado e orçamento alcançável.
- Os comandos de exemplo são Go. Tornar explícita a adaptação do inventário para outras stacks/registradores de rotas, sem tratar grep vazio como ausência de superfície.
- Definir como resolver a base de `--diff` e registrar cobertura/exclusões. Manter o formato enxuto da skill; não precisa adotar todo o aparato de packs para resolver essas lacunas.

## O que está bem e deve ser preservado

- Fonte canônica única e exposição por symlink simplificam a distribuição. Os links atuais foram verificados sem executar reparo destrutivo.
- `abuse-audit` exige caminho concreto, custo e tentativa de refutação; a estrutura é boa, mas os exemplos absolutos precisam obedecer à própria regra.
- Deep/Ultra separam lentes e tentam apurar votos por código. Essa direção é útil; faltam validação completa e vínculo de identidade/rodada.
- Atlas tem build separado da coleta e testes próprios. Os casos de atualização e dados hostis precisam complementar os casos já cobertos.
- Sonar usa loopback, projeto privado e checksum de plugin. Os mecanismos de retomada, configuração e atribuição do resultado precisam acompanhar essas precauções.

Há oportunidade de compartilhar validação de votos, identidade de achados e escrita de estado entre Deep e Ultra, depois de definir os contratos e testes de ambos. Hoje o código duplicado reproduz falhas iguais. A descoberta de `SKILL_ROOT` e de documentação canônica também deveria ser consistente entre hosts, sem importar caminhos e regras do projeto em que a skill nasceu.

## Validação executada

| Verificação | Resultado | O que demonstra |
|---|---|---|
| Validador `skill-creator` | 6/6 válidas | Frontmatter/estrutura formal; não valida semântica |
| `node scripts/check-links.mjs` sem mutação | 0 drift, 0 warn, 0 ausentes | Estado atual dos hosts; cenários adversos do checker foram testados separadamente |
| Sintaxe nas áreas desta auditoria | 28 JS + 4 Python + 1 shell sem erro | Parsing, não execução correta |
| Testes existentes de `check-links` | 7/7 passam | Casos existentes não cobriam perda de conteúdo |
| Testes existentes do Atlas | 22/22 passam | Regressões existentes, complementadas por fixtures e navegador |
| Testes offline existentes do Ultra | 53: 35 passam, 18 falham | Dependências de caminhos/projetos externos tornam a suíte não portátil; detalhes no anexo |
| Deep | Sem suíte própria; CLIs reais em fixtures | Cenários detalhados no anexo, inclusive concorrência |
| Sonar | Fakes de API/CLI e injeção de falha | Lógica local; não é validação de Sonar/Docker/Xcode reais |
| Abuse | Leitura e contraexemplos | Qualidade das regras; sem avaliação estatística do modelo |

Os testes preexistentes somam **82 casos nesta etapa: 64 passam e 18 falham**. Os 130 testes de `make-me-happy` pertencem à etapa anterior e têm log próprio; não foram somados para diluir as falhas das outras skills. As reproduções adicionais não são apresentadas como uma suíte verde: elas confirmam defeitos ainda abertos.

Links Markdown relativos foram examinados; o único candidato espúrio da busca era uma expressão regular dentro de código. Não houve indicação de link Markdown real quebrado nas cinco skills. Referências inline, ordem dos comandos e ferramentas externas foram avaliadas nos anexos; validação de Markdown não garante que estejam disponíveis.

## Como fechar a próxima rodada de correções

1. Transformar cada reprodução em regressão que falhe no estado atual; registrar ID, comportamento esperado e artefato observado. Não usar apenas testes que buscam palavras no prompt.
2. Corrigir primeiro perda de dados e execução de conteúdo; depois identidade/rodadas, validação dos votos, gates e persistência. Cobrir Deep e Ultra quando compartilham o defeito.
3. Exercitar o fluxo completo: executar → interromper → retomar → corrigir → revisar → atualizar → reabrir → gerar relatório → começar outra execução. Conferir JSON, Markdown e HTML contra a mesma fonte de verdade.
4. Injetar entrada inválida, resultado vazio válido, produtor ausente, resultado velho, reordenação de achados, duas branches no mesmo dia e atualizações simultâneas. Cada caso deve produzir o estado previsto, sem sumir com pendências.
5. Para Atlas, verificar duas atualizações e navegação real, incluindo dados removidos e IDs hostis. Para Sonar, complementar os testes locais com scan real e upgrade de volume em ambiente descartável.
6. Tornar a suíte do Ultra independente de outros repos; rodar checagens, suites e revisão independente do resultado final. Só marcar um achado RESOLVIDO quando seu aceite for observado e a evidência corresponder à versão corrigida.

Não há garantia absoluta sobre toda decisão futura do agente. A garantia verificável é o contrato exercitado por testes, o acompanhamento consistente e a impossibilidade de transformar erro ou falta de evidência em aprovação silenciosa. Esta auditoria mostra onde o estado atual ainda viola esse contrato.

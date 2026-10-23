# ultra-deep-audit 2.0.1

Auditoria de código com agentes especializados, painel de segurança e pack JSON/markdown/HTML. [SKILL.md](SKILL.md) define escopo e comandos; [schema e migração](references/pack-schema.md) documenta o formato 2.

- Cada run tem diretório único, roster, snapshot e artefatos ligados por hash.
- Erros de entrada não apagam achados nem viram auditoria limpa.
- Auditoria concluída e implementação verificada são estados distintos.
- Fixes exigem autorização; validação corresponde a bug, refactor, docs/check ou dependência.
- Política e documentação pertencem ao projeto. Não exige SDD numerada, Graphify ou stack específica.

Packs antigos continuam legíveis como histórico sem atestação. Crie uma nova run para obter evidência atual; não renomeie um schema antigo para 2.

Teste local: `node --test scripts/tests/*.test.mjs` a partir desta pasta. A suíte usa fixtures herméticas. Integrações do projeto original são preservadas, mas aparecem SKIP sem `ULTRA_PROJECT_ROOT` explícito; não confunda skips com cobertura executada. Inspecione os scripts do projeto antes de habilitar esse opt-in.


Para exercitar também os contratos do projeto de origem, depois de inspecionar seus scripts:

```bash
ULTRA_PROJECT_ROOT=/caminho/do/projeto node --test scripts/tests/*.test.mjs
```

O layout `deployments/scripts` tem preferência, com suporte ao caminho `scripts` legado. As execuções usam cópias temporárias e stubs de Maven/Docker/Trivy; não executam `ci-local` completo, serviços, builds ou publicação. A validação do POM é leitura local. Esses contratos específicos continuam opt-in e não impõem o stack da aplicação às auditorias genéricas. A versão 2.0.1 mantém o schema 2.

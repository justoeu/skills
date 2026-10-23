# make-me-happy

Implementação rastreável com retomada, validação por tipo de mudança e fechamento
baseado em evidências do código verificado. Alias: `/mmh`.

Consulte [SKILL.md](SKILL.md) para flags e fluxo; [schemas](references/pack-schemas.md)
e [protocolo de estado/evidência](references/lifecycle.md) para os artefatos.

- Feature/bugfix: red-green; refactor: caracterização antes/depois; docs/config: checks adequados.
- Worktrees por run, integração testada e limpeza sem descarte forçado.
- Oracle escreve agregados; agentes devolvem resultados individuais com versão.
- Reviews e hooks independentes, UI quando aplicável, gates e acompanhamento do projeto.
- Resultados vinculados à revisão do código; HTML recalculado e fechamento selado.
- `--fresh` preserva a run anterior em vez de apagar trabalho.
- Tasks após o SDD usam uma [adaptação prática do ASD-STE100](references/task-writing.md):
  ações diretas, termos consistentes e aceite observável. Descrição e aceite permanecem
  no JSON, no Markdown regenerado e no HTML. Schema 2 preservado.
- [HTML automático](references/automatic-report.md): atualização por evento e a cada
  dez minutos em processo supervisionado, andamento parcial por task e captura final
  ao pausar/fechar. Versão 1.6.0.

```bash
node --test make-me-happy/scripts/tests/*.test.mjs
# Opcional: inclui Chromium real já instalado, sem instalar dependências.
MMH_REAL_BROWSER=1 node --test make-me-happy/scripts/tests/*.test.mjs
```

Fonte canônica neste harness; hosts usam symlinks. O relatório de auditoria e a matriz
de correções estão em `docs/reviews/` na raiz deste repositório.

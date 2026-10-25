# Craft baseline — ofício de escrita de código

Baseline **universal** (linguagem-agnóstica) aplicada na **escrita** (implementer)
e na **revisão** (standards reviewer) — a mesma régua nos dois momentos. As regras
específicas por linguagem vivem em `references/language-baselines.md`; o design de
tipos/módulos (SOLID, padrões) vive em `catalogs/design-baseline.md`.

**Três regras amarram este catálogo:**

1. **O repo manda.** Padrão documentado do projeto prevalece; onde ele endossa algo
   que este baseline flagraria, suprima o achado.
2. **Sinal, não lei de contagem.** Cada item é heurística com justificativa; investigue
   responsabilidade e contexto antes de propor mudança. Achado sem impacto declarado
   não é achado.
3. **Pule o que a tooling já garante.** Linter/formatter/compilador cobrem, o catálogo não.

Cada item: **regra → por que**. Aplique ao **código novo do diff**; código legado que
o diff não toca não vira pauta.

### Assinatura enxuta
Poucos parâmetros: até 4 como alvo, ou o limite do padrão do repo; além disso, agrupe
em objeto de parâmetros (record/struct/DTO) nomeado pelo conceito. → Parâmetros que
viajam juntos são um conceito nascendo (Data Clumps no baseline Fowler); assinatura
longa esconde dependências e quebra a cada evolução do contrato.

### Método curto, uma responsabilidade
Um método faz uma coisa, num nível de abstração por vez; se o leitor precisa rolar a
tela para caber a lógica, extraia helper com nome honesto. → Método longo esconde
ramificações não testadas e mistura níveis (validação + cálculo + I/O no mesmo corpo).

### Early return
Trate erro, borda e pré-condição primeiro, com retorno imediato; o caminho feliz fica
na indentação mínima. → Aninhamento profundo força o leitor a empilhar contexto
mental e esconde o caso principal; `else` após `return` é ruído.

### Condição nomeada
Condição com 3+ operandos vira booleano nomeado pela regra de negócio
(`podeRefundar`, `isOwner`), não comentário. → Parede de `||`/`&&` esconde qual regra
autoriza a ação e não pode ser testada isolada.

### Sem flag de comportamento
Parâmetro booleano que muda o que a função faz vira dois métodos com nomes que dizem
o que fazem. → No ponto de chamada `f(x, true)` não revela o comportamento escolhido.

### Constante nomeada
Número/string mágica vira constante com nome e unidade quando aplicável
(`MAX_TENTATIVAS`, `UM_DIA_MS`). → O leitor não deduz unidade nem origem do literal;
a mudança fica num lugar só.

### Erro com contexto
Falhe rápido e alto: mensagem diz **o que** falhou e **com quais dados**; erro técnico
é envolvido com o contexto da operação; erro de domínio usa tipo/mensagem de domínio.
Catch silencioso não existe — logue e aja, ou re-lance. → Erro genérico (`failed`,
`error: 1`) não permite diagnosticar nem reproduzir; engolir erro corrompe estado em
silêncio.

### Imutável por padrão
Campo/variável imutável salvo necessidade de mutação explícita; estado mutável
compartilhado é minimizado e protegido. → Mutação invisível é a fonte clássica de
bug de concorrência e de teste que passa hoje e quebra amanhã.

### Observável
Log/evento de erro carrega contexto estruturado (chave=valor, id do objeto, operação);
erro logado anexa a causa; requisição/fluxo tem id de correlação propagado quando o
repo suporta. Erro é logado **uma vez, na fronteira** — não em cada camada que
atravessa. Nunca logue segredo nem PII (senha, token, cartão, documento): mascare ou
registre só o identificador. → Sem isso, incidente vira adivinhação em produção; com
segredo no log, o log vira o incidente.

### Comentário explica por quê
Comentário carrega decisão, trade-off e referência (incidente, ADR, spec) — nunca
repete o que o código diz. Se precisa explicar **o quê**, o nome/extração está errado.
→ Comentário-eco apodrece junto com o código e deixa de ser lido; o porquê não vive
em lugar nenhum além dele.

### Teste determinístico e legível
Um comportamento por teste, arrange-act-assert visível, sem sleep escondido, sem
dependência de ordem entre testes. O teste verifica **comportamento observável**, não
detalhe interno — teste acoplado a implementação quebra em refactor inocente e não
prova nada para o usuário. O nome do teste lê como especificação: quem lê a suíte
sabe o que o sistema promete sem abrir o corpo. → Teste não-determinístico ensina o
time a ignorar a suíte; o custo real do teste é a confiança que ele compra.

### Contexto de dispatch curado (Oracle)
Contexto enviado a cada papel carrega o **necessário e específico**: task com versão,
spec-summary, arch-map, padrões do repo, seção da linguagem aplicável e arquivos
tocados — não o repositório inteiro, não prompt genérico. → Agente sem contexto
contextualizado inventa padrão paralelo; agente com contexto-dump se perde no meio.

### Higiene do diff
O diff faz só o que a task pede. Mudança cosmética (formatação, import, rename) não
viaja misturada com mudança de lógica — churn esconde a mudança real, infla o review e
quebra o biss; se a tooling mudou a formatação, isso é commit próprio justificado.
Rename/movimentação em escala é decisão de task, não efeito colateral. → O revisor
precisa enxergar exatamente o que a task entregou; deriva sutil de comportamento
escondida num refactor "inocente" é o bug mais caro de achar.

### Refactor não muda comportamento
Tarefa de refactor termina com o mesmo comportamento observado do início — provado
pelo modo characterization, não afirmado. Qualquer deriva de comportamento num
refactor é defeito a corrigir ou pergunta material, nunca "melhoria que veio junto".
→ Mudança de comportamento sem requisito é entrega fora do spec, mesmo quando verde.

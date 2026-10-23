# Overengineering catalog — hook `overengineering`

Fowler chama o sintoma local (Speculative Generality). Este catálogo olha a
**decisão estrutural**: peça de arquitetura sem requisito que a pague. Aplica ao
**diff + SDD + arch-map** — o que não tem `spec_ref` correspondente é o achado.

**Regras que amarram:**

1. **Um requisito futuro não é requisito.** "Vai precisar quando escalar" sem
   `spec_ref` = achado. YAGNI é a regra; a exceção é o SDD pedir.
2. **O arch-map manda.** Padrão já adotado pelo app (ex.: repo já é hexagonal)
   não é overengineering — seguir o padrão local é consistência. O achado é
   **quebrar** o padrão local ou **adicionar camada além** dele.
3. **Contagem é indício.** Investigue responsabilidade, fronteira, testabilidade e padrões locais antes de propor remover uma interface/camada/configuração.

Cada item: **sinal → o que exigir**.

### Camada extra sem responsabilidade
Pasta/módulo/pacote novo que só reexporta ou repassa (`Middle Man` estrutural):
handler → service → manager → repo onde o app tem handler → repo.
→ uma camada a menos, ou um `spec_ref` que exija a separação.

### Interface com uma implementação
`type X interface` + exatamente 1 impl + nenhum mock de teste além do trivial,
sem segunda implementação no SDD. → investigar se há fronteira, contrato ou testabilidade que justifique a interface. Uma implementação não prova defeito; só propor simplificação com benefício concreto e compatibilidade com o padrão local.

### Abstração "para o futuro"
Generic/param de tipo, hook, plugin point, strategy, factory ou builder cujo único
caller passa sempre o mesmo valor. → inline até existir variação real no spec.

### Infra de escala prematura
Fila/broker novo para chamada síncrona; cache antes de medir; DB separado para
tabela nova sem exigência de isolamento; microserviço onde módulo interno bastaria;
feature flag para comportamento que o spec define como fixo.
→ o mecanismo simples que o SDD descreve, ou a pergunta ao usuário.

### Configurabilidade sem leitor
Env var / option / setting novo que nenhum código lê além do default, ou lido em
um só lugar sempre com o mesmo valor. → verificar finalidade operacional e ambiente; segredos e configuração de deploy não viram hardcode. Propor remoção somente quando comprovadamente sem função.

### Contrato além do pedido
Endpoint/CLI/evento além dos `payloads.json`; campo de resposta "que custa nada
colocar"; golden de contrato para coisa que o spec não define como contrato.
→ corte para o spec; o extra é a dívida (e Spec reviewer vai marcar).

### Framework para um caso
DI container, ORM completo, event sourcing, CQRS, codegen introduzidos para um
caso de uso simples que a stack resolve nativamente. → mecanismo nativo; framework
é decisão de SDD, não de task.

### Paralelismo sem demanda
Worker pool / goroutine farm / async fan-out onde o fluxo é single-item e o SDD
não pede concorrência. → caminho síncrono mensurável primeiro.

### Guarda de teste como arquitetura
Suite de contrato/golden espelhando 100% do código de produção "por segurança"
além dos invariantes que o refactor pediu. → trave só os invariantes listados no SDD.

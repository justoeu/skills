# Design baseline — SOLID e escolha de padrões

Baseline **universal** de design de tipos/módulos, aplicada na **escrita** e na
**revisão** com a mesma régua. Irmã do `catalogs/craft-baseline.md` (nível
método/função); o baseline Fowler cobre os *smells*; `catalogs/overengineering.md`
cobra estrutura sem requisito.

**Quatro regras amarram:**

1. **O repo manda.** Padrão documentado/ADR prevalece; SOLID é sinal de design, não lei.
2. **Cada conceito vive uma vez.** Onde cruza com Fowler (Divergent Change ≈ SRP,
   Refused Bequest ≈ LSP, Repeated Switches ≈ OCP), cite o smell — não duplique achado.
3. **Contagem é indício.** Interface com 1 impl pode ter fronteira/testabilidade
   legítima; veredicto de estrutura é do catálogo `overengineering.md`.
4. **Pule o que a tooling já garante.**

Cada item: **sinal → como detectar → o que exigir**.

### SRP — uma razão para mudar
Sinal: o tipo/módulo acumula razões distintas de mudança (validação + persistência +
notificação no mesmo corpo). Detectar: imports de domínios não relacionados; nome
"Manager"/"Handler"/"Utils" que não diz o que faz; métodos que ignoram a maioria dos
campos; propósito indescritível numa frase sem "e". Exigir: extrair por
responsabilidade — **só as que o diff tocou**; refatoração além do escopo é pauta do
spec reviewer.

### OCP — aberto a extensão
Sinal: cadeia if/switch sobre tipo/status que cresce a cada mudança. Detectar: o mesmo
switch repetido no diff (Fowler: Repeated Switches); dispatch de enum espalhado.
Exigir: variação **já existente** no SDD → polimorfismo/estratégia; variação futura
hipotética → YAGNI (`overengineering.md`).

### LSP — substituível
Sinal: subtipo que quebra o contrato do pai. Detectar: type-check/`instanceof` antes de
chamar o método herdado; implementação vazia ou que lança "não suportado"; subtipo que
fortalece pré-condição ou enfraquece pós-condição/invariante. Exigir: separar a
abstração — composição no lugar de herança forçada.

### ISP — interface do consumidor
Sinal: interface gorda que força implementação inútil. Detectar:
`UnsupportedOperationException` em método implementado; consumidores usando subconjuntos
disjuntos da mesma interface; muitas operações com um só cliente real. Exigir: dividir
por capacidade/papel; interface definida pelo consumidor (em Go, no pacote que consome).

### DIP — dependência aponta para abstração
Sinal: regra de negócio acoplada a concreto. Detectar: instanciação de dependência
concreta dentro de lógica de domínio; import de pacote de implementação (driver, HTTP
client) na camada de domínio; teste de regra pura que exige infra real (DB/rede).
Exigir: dependência entra por construtor/parâmetro apontando ao tipo abstrato do
domínio. Exceções: ponto de montagem (composition root, main, factory) é o lugar do
`new`; se o repo não usa container DI, injeção manual vale o mesmo princípio.

## Escolha de padrão: problema → mecanismo

A forma mais simples que o problema **real do SDD** pede; padrão sem variação real é
achado do `overengineering.md`:

| Problema real no SDD | Mecanismo a considerar |
|---|---|
| Construção com muitos opcionais | Objeto de parâmetros (record/struct) ou builder |
| Algoritmos já existentes da mesma operação | Estratégia/polimorfismo |
| Notificar N consumidores de um evento | Evento do repo (Spring events, pub/sub, delegate) |
| Integrar interface incompatível na fronteira | Adapter |
| Esqueleto comum, passos que variam | Composição de passos/template |
| Instância única | Gerenciado pelo DI do repo; singleton caseiro é achado |

## Anti-padrões (sinais de abuso)

| Anti-padrão | Problema | Melhor caminho |
|---|---|---|
| Singleton global mutável | Estado oculto, teste impossível | Dependência injetada |
| Factory em toda criação | Cerimônia sem variação | Construtor direto |
| Cadeia profunda de decorators | Depuração difícil | Composição simples |
| Observer para tudo | Notificação espaguete | Evento tipado com dono |
| Padrão "para o futuro" | YAGNI | Mecanismo nativo até existir variação |

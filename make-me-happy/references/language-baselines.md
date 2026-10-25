# Language baselines — Java, Go, Swift

Baselines por linguagem para **escrita e revisão** com a mesma régua. O Oracle cola
**somente a seção da(s) linguagem(ns) primária(s) do repo** (ver `languages[]` no
arch-map) no contexto do implementer e do standards reviewer — não o arquivo inteiro.
Quando o diff cria/altera endpoints (entradas `kind:"http"` no `payloads.json`),
cole também a **seção Contratos HTTP**.

**Regras que amarram (valem para todas as seções):**

1. **O padrão do repo prevalece.** A baseline preenche silêncio: onde o repo documenta
   (CODING_STANDARDS, lint config, ADRs), a régua local manda.
2. **Pule o que a tooling já garante** (Checkstyle/ErrorProne, golangci-lint, SwiftLint).
3. **O universal vem antes.** `catalogs/craft-baseline.md` (assinatura enxuta, early
   return, erro com contexto, imutável por padrão, teste determinístico) e
   `catalogs/design-baseline.md` (SOLID, padrões) aplicam-se a todas as linguagens;
   o que segue é a forma local de cada regra.

## Contratos HTTP (universal — quando o diff toca endpoints)

- **Semântica de verbo:** GET só lê (sem efeito colateral); POST cria (201 +
  Location); PUT substitui (idempotente); PATCH altera parcial; DELETE remove
  (idempotente). → Ação com estado por GET quebra cache, prefetch e retries.
- **Status honesto:** erro é 4xx/5xx — nunca 200 com corpo de erro. 400 input
  inválido, 401 não autenticado, 403 sem permissão, 404 inexistente, 409 conflito/
  concorrência, 422 semântica válida-sintaxe-inválida. → Cliente não programa contra
  um contrato em que o transporte mente.
- **DTO na borda:** request/response são tipos de contrato, nunca a entidade interna
  (ORM/modelo). → Expor internals vaza campo sensível e acopla o cliente ao schema
  de persistência.
- **Erro com forma única:** código de máquina + mensagem humana + contexto
  (timestamp, path); stack trace e detalhe interno ficam no log do servidor, nunca na
  resposta.
- **Coleção paginada:** endpoint de lista sem paginação é risco de memória e
  latência — não questão de estilo.
- **Compatibilidade:** remover campo, mudar tipo, exigir campo novo e renomear são
  **breaking** — exigem versão nova ou deprecação documentada; adicionar campo
  opcional é seguro. Contrato produtor/consumidor precisa continuar válido (§6).

## Java (17+, Spring Boot)

**Essenciais:**

- **Nomes:** classes/records PascalCase; métodos/campos camelCase; constantes
  UPPER_SNAKE_CASE. Um tipo público top-level por arquivo. Ordem de membros:
  constantes, campos, construtores, públicos, protegidos, privados.
- **Imutabilidade:** records para valores e DTOs; campos `final`; domínio sem
  setters — comportamento em método de domínio, não em escrita direta de estado.
- **Optional:** métodos `find*` retornam `Optional<T>`; encadeie `map`/`flatMap`/
  `orElseThrow` — nunca `get()` nu, nunca `Optional` como campo ou parâmetro.
- **Streams:** transformação com pipeline curto; loop nomeado quando aninha
  complexidade. Não mutar estado externo dentro do stream; `Collectors.toList()`
  não promete lista mutável.
- **Exceções:** erro de domínio = unchecked específica com dados do contexto; erro
  técnico envolvido com a operação que falhou (com `cause`); sem `catch (Exception)`
  largo fora de fronteira; exceção não é fluxo de controle.
- **Generics:** sem raw types; bounded generics em utilitários reutilizáveis.
- **Idioms:** `equals` sempre com `hashCode`, sobre campos imutáveis/business key
  (nunca ID gerado); try-with-resources para tudo `Closeable`; pattern matching de
  `instanceof` (16+).
- **Validação/Null:** Bean Validation no DTO da borda; no domínio, o tipo valida a
  si (record compacto que rejeita estado inválido); `Objects.requireNonNull` em
  parâmetro público; coleção vazia no lugar de `null`.
- **Logging:** SLF4J parametrizado (`log.info("fetch slug={}", slug)`); nível certo
  (INFO evento de negócio, WARN tratado, ERROR com causa anexada); nunca segredo/PII
  no log; JSON estruturado + MDC com requestId quando o repo suporta.
- **Testes:** JUnit 5 + AssertJ; Mockito sem partial mocks; `@WebMvcTest` para
  controller, `MockitoExtension` para service, `@SpringBootTest`+Testcontainers
  para integração.

**Spring Boot:**

- **Camadas com uma responsabilidade:** controller trata HTTP (binding, validação,
  status), service tem regra + transação, repository só acesso a dados. Controller
  não chama repository nem retorna entidade — entra e sai DTO.
- **Injeção por construtor** com campos `final` (não `@Autowired` em campo):
  dependência visível e teste direto.
- **Self-call não atravessa o proxy:** `@Transactional`, `@Async`, `@Cacheable` e
  afins **não se aplicam** em chamada interna da mesma classe — quando o
  comportamento importar, extraia para outro bean.
- **Exceção centralizada:** `@RestControllerAdvice` mapeia domínio → status + corpo
  de erro consistente; handler genérico loga o stack completo e devolve mensagem
  genérica ao cliente.
- **Config:** `ddl-auto: validate` (nunca create em prod); segredos por env;
  `@ConfigurationProperties` + `@Validated` em vez de `@Value` espalhado.

**JPA/Hibernate:**

- **LAZY por padrão** — inclusive `@ManyToOne` (o default EAGER é armadilha); fetch
  explícito quando a consulta precisa: `JOIN FETCH`/`@EntityGraph`.
- **N+1:** relação percorrida em loop = 1+N consultas; o conserto é no query (join
  fetch, entity graph, batch size). O gate N+1 (§6) cobra; aqui está o remédio.
- **Transação:** `readOnly = true` default na classe; write método a método;
  `rollbackFor` quando a checked precisa reverter. Acesso a lazy dentro da transação
  ou via projection — `LazyInitializationException` fora dela é bug de fronteira,
  e open-in-view só mascara o N+1.
- **Cascade só pai→filho** (`@OneToMany`); `CascadeType.ALL` em `@ManyToOne` pode
  apagar o pai ao remover o filho. `toString`/`equals` não tocam coleção lazy
  (dispara load acidental).
- **Concorrência de dados:** entidade com escrita concorrente leva `@Version`
  (optimistic) — update perdido em silêncio é pior que `OptimisticLockException`.
- **Leitura:** projection DTO (interface/record) em vez de entidade cheia; paginação
  em toda lista; bulk update (`@Modifying`) para massa, em vez de carregar entidades.

**Concorrência:**

- **Check-then-act não é átomo:** `containsKey`+`put` e `count++` em estado
  compartilhado têm corrida — `computeIfAbsent`, `Atomic*` ou bloqueio explícito.
- **Visibilidade:** campo escrito por uma thread e lido por outra sem
  `volatile`/sincronização pode nunca ser visto; double-checked locking sem
  `volatile` é bug.
- **Deadlock:** locks aninhados exigem ordem global consistente (ex.: por id); não
  chamar código desconhecido segurando lock.
- **Coleção certa:** `ConcurrentHashMap` para mapa compartilhado; `BlockingQueue`
  para produtor/consumidor; `compute` aninhado no mesmo mapa pode deadlockar.
- **@Async:** exige `@EnableAsync`, método público e chamada por outro bean (proxy);
  o executor default cria uma thread por task — configure pool com nome e política
  de rejeição; SecurityContext/MDC não propagam sozinhos.
- **CompletableFuture:** sem `exceptionally`/`handle` a exceção some silenciosamente;
  `orTimeout` em toda operação externa; executor próprio para chamada bloqueante.
- **Virtual threads (21+):** para I/O, não CPU-bound; `synchronized` com operação
  bloqueante faz pinning da carrier no 21–23 (JEP 491 resolve no 25) — prefira
  `ReentrantLock` em código novo; prefira `ScopedValue` a `ThreadLocal`.

**Performance (cheire, meça, então otimize):**

- Regex/`String.format` dentro de loop compila a cada volta — `static final Pattern`.
- Boxing em hot path (`Long sum += i`) cria lixo de GC — primitivo e stream primitivo.
- `List.contains` dentro de loop é O(n) por volta — `Set`.
- Consulta sem paginação/limite é risco de memória, não estilo.
- Parallel stream com estado mutável compartilhado é corrida; em coleção pequena é
  só overhead. Otimização sem medição não é entrega — é aposta.

## Go

- **Erros:** todo erro de caminho material é tratado ou retornado com wrap e contexto
  (`fmt.Errorf("parsing order %d: %w", id, err)`); `_` só quando o descarte é
  justificado; inspecione com `errors.Is`/`errors.As`; `panic` fica para invariantes
  impossíveis, `recover` só na borda (handler HTTP, goroutine com owner).
- **context.Context:** primeiro parâmetro de toda função que faz I/O ou é cancelável;
  passado adiante, nunca armazenado em struct nem criado dentro de helper que recebe
  chamador. Contexto bem feito = cancelamento e deadline chegam ao fundo da pilha.
- **Assinaturas:** até 4 parâmetros; além, options struct com campos nomeados;
  `ctx` primeiro, entradas depois. Retornos nomeados só onde documentam; naked
  return apenas em funções de 1–3 linhas.
- **Controle de fluxo:** early return; `else` após `return`/`continue` cai; `switch`
  no lugar de cadeia de `if` sobre a mesma variável; condição 3+ operandos vira
  booleanos nomeados.
- **Nil-safety:** slice/map sempre inicializados (`[]T{}`, `make(...)` com capacidade
  conhecida) — nil map entra em pânico no write e nil slice serializa `null` em JSON.
- **Composite literals com nomes de campos** — literal posicional quebra ao adicionar
  campo.
- **Interfaces:** pequenas, definidas no consumidor; "accept interfaces, return
  structs". Interface com 1 implementação sem fronteira/testabilidade é pauta do
  catálogo overengineering, não padrão a replicar.
- **Encapsulamento:** unexport agressivo — exportar é compromisso de API; renomear
  para exportar depois é barato, o contrário é breaking.
- **Concorrência com dono:** toda goroutine tem criador que a espera/cancela
  (errgroup/WaitGroup); canal é fechado pelo produtor; sem goroutine órfã em handler
  de request; teste de caminho concorrente roda com `-race`.
- **Stdlib primeiro:** `slices`, `maps`, `errors`, `time` antes de dependência;
  "a little copying is better than a little dependency".
- **Testes:** table-driven; `t.Parallel` quando isolado; sincronizar com
  channels/sync, nunca sleep; `testify` se o repo já adota.

## Swift

- **Value semantics primeiro:** `struct`/`enum` por padrão; `class` só quando há
  identidade/ciclo de vida compartilhada; `let` por padrão, `var` só com mutação
  real. Mutação de referência compartilhada é a fonte clássica de bug de estado.
- **Access control mínimo:** `internal` é o default e o alvo; `private` para detalhe
  de implementação; `public`/`open` são compromisso de API — declare só o consumido.
- **Early exit:** `guard` para pré-condição, erro e borda; caminho feliz com
  indentação mínima. Sem force unwrap (`!`) e `try!` fora de teste/constante
  provável; `as?` sempre com fallback explícito.
- **Erros:** enum do domínio conformando `Error` com casos nomeados pelo problema;
  `throws` + `do/catch`; `Result` só em boundary assíncrona; `try?` só quando a
  ausência é o tratamento correto e documentado. Erro engolido é achado.
- **Nomes (API Design Guidelines):** clareza sobre brevidade; omitir palavras que o
  tipo já diz (`view.removeFromSuperview()`, não
  `view.removeFromItsSuperview()`); booleans com `is`/`has`/`should`; método que
  falha tem nome que declara o efeito.
- **Protocolos como capacidade:** pequenos e compostáveis (nomes `-able`/`-ing`),
  não interface Java replicada; sem conformança retroativa em tipo de
  terceiros (colisão de símbolo e acoplamento invisível).
- **SwiftUI:** uma fonte da verdade por hierarquia — `@State` privado da view que
  possui, `@Binding` filho↔pai, `@Observable` para modelo; lógica fora do `body`
  (view model/extension); `body` puro e barato; efeitos em `.task`/`.onAppear`,
  nunca no corpo da view.
- **Concorrência:** `async/await`; `@MainActor`/`Sendable` conforme domínio; sem
  `Task { }` desenfreado — task estruturada (`TaskGroup`) ou com store/cancelamento
  com owner.
- **Injeção por init/parâmetro:** dependência entra por construtor; singleton global
  mutável é achado, não atalho.
- **Testes:** Swift Testing/XCTest; determinísticos; sem force unwrap; arrange-act-
  assert visível — casa com o modo red-green do implementer.

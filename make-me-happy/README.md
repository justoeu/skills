# make-me-happy

**Version 1.10.0** · Alias: `/mmh`

[English](#english) · [Português](#português) · [Español](#español)

---

## English

Traceable implementation with resume support, validation per change type, and a
closure sealed by evidence from the verified code.

See [SKILL.md](SKILL.md) for flags and flow; [schemas](references/pack-schemas.md)
and the [state/evidence protocol](references/lifecycle.md) for the artifacts.

- **Validation by change type:** feature/bugfix → red-green (relevant failure first,
  then green); refactor → before/after characterization; docs/config → appropriate
  checks (parser/build/link/schema), never artificial tests.
- **One ruler from generation to review** — the same baselines guide the implementer
  and the standards reviewer:
  - [Craft baseline](catalogs/craft-baseline.md): lean signatures (~4 parameters,
    then a parameter object), short single-responsibility methods, early returns,
    named conditions, errors with context, immutability by default, observability
    (structured logs, correlation ID, no secrets/PII), deterministic behavior-driven
    tests, **diff hygiene** (no cosmetic churn mixed with logic) and **refactor keeps
    behavior** (any drift is a defect).
  - [Design baseline](catalogs/design-baseline.md): SOLID as detection signals
    (SRP/LSP/ISP/DIP with `instanceof` checks, empty implementations, `new` of
    concrete dependencies in business logic), pattern-selection table and abuse
    anti-patterns.
  - [Language baselines](references/language-baselines.md): Java/Spring, Go and
    Swift sections pasted per the arch-map `languages[]`. Java covers Spring Boot
    (layer responsibilities, constructor injection, self-call bypasses the proxy,
    `@RestControllerAdvice`, safe config), JPA (LAZY by default, N+1 fixes,
    transactions, cascade direction, `@Version`), concurrency (check-then-act,
    visibility, lock ordering, `@Async` pitfalls, `CompletableFuture`, virtual
    threads) and measured performance. Go covers error wrapping, `context.Context`,
    nil-safety, consumer-side interfaces and goroutine ownership. Swift covers value
    semantics, `guard`, typed domain errors, SwiftUI state ownership and structured
    concurrency.
  - **Universal HTTP contracts** section, pasted whenever the diff creates or changes
    endpoints: verb semantics, honest status codes (never 200 with an error body),
    DTOs at the boundary, single error shape, pagination and breaking-change rules.
  - The repo's documented standard always prevails over any baseline; the app's
    architecture is the base of every choice — a better-looking approach becomes a
    question to the user, never a silent swap.
- **Worktrees per run**, tested integration, cleanup without forced discards.
- **Oracle writes the aggregates**; agents return individual versioned results per task.
- **Independent reviews** (spec, standards, correctness) **and hooks** (arch-alignment,
  reinvention, security, performance, overengineering, deps-freshness, UI), runtime UI
  acceptance when applicable, project gates and canonical tracking files.
- **Results are bound to the reviewed code**: changing code, contracts, plan or the
  architecture map invalidates the affected evidence; HTML is recalculated and the
  closure is sealed. A numeric score alone never authorizes closing.
- `--fresh` starts a new run with a unique ID and preserves the previous one.
- Tasks derived from the SDD follow a [practical ASD-STE100 adaptation](references/task-writing.md):
  direct actions, consistent terms, observable acceptance criteria — kept in the JSON,
  the regenerated Markdown and the HTML.
- [Automatic HTML report](references/automatic-report.md): event-driven updates plus
  a ten-minute cadence, native scheduler/subtask when available, Node timer as
  fallback; includes per-task partial progress and a final capture on pause/close.

## Português

Implementação rastreável com retomada, validação por tipo de mudança e fechamento
selado por evidências do código verificado.

Consulte [SKILL.md](SKILL.md) para flags e fluxo; [schemas](references/pack-schemas.md)
e o [protocolo de estado/evidência](references/lifecycle.md) para os artefatos.

- **Validação por tipo de mudança:** feature/bugfix → red-green (falha relevante
  antes, verde depois); refactor → caracterização antes/depois; docs/config → checks
  adequados (parser/build/link/schema), nunca teste artificial.
- **Uma régua da geração à revisão** — as mesmas baselines guiam o implementer e o
  standards reviewer:
  - [Baseline de ofício](catalogs/craft-baseline.md): assinaturas enxutas (~4
    parâmetros, acima disso objeto de parâmetros), métodos curtos de uma
    responsabilidade, early return, condições nomeadas, erro com contexto,
    imutável por padrão, observabilidade (log estruturado, correlation id, sem
    segredo/PII), testes determinísticos de comportamento, **higiene do diff**
    (churn cosmético não viaja misturado com lógica) e **refactor não muda
    comportamento** (deriva é defeito).
  - [Baseline de design](catalogs/design-baseline.md): SOLID como sinais de detecção
    (SRP/LSP/ISP/DIP com checks de `instanceof`, implementações vazias, `new` de
    dependência concreta em regra de negócio), tabela de escolha de padrões e
    anti-padrões de abuso.
  - [Baselines por linguagem](references/language-baselines.md): seções Java/Spring,
    Go e Swift coladas conforme `languages[]` do arch-map. Java cobre Spring Boot
    (responsabilidades de camada, injeção por construtor, self-call não atravessa o
    proxy, `@RestControllerAdvice`, config segura), JPA (LAZY por padrão, conserto de
    N+1, transações, direção de cascade, `@Version`), concorrência (check-then-act,
    visibilidade, ordem de locks, pitfalls de `@Async`, `CompletableFuture`, virtual
    threads) e performance medida. Go cobre wrap de erros, `context.Context`,
    nil-safety, interfaces do consumidor e dono de goroutine. Swift cobre value
    semantics, `guard`, erros de domínio tipados, dono do estado no SwiftUI e
    concorrência estruturada.
  - Seção universal de **contratos HTTP**, colada quando o diff cria/altera endpoints:
    semântica de verbo, status honesto (nunca 200 com corpo de erro), DTO na borda,
    forma única de erro, paginação e regras de breaking change.
  - O padrão documentado do repo prevalece sobre qualquer baseline; a arquitetura do
    app é a base de toda escolha — abordagem "melhor" vira pergunta ao usuário,
    nunca troca silenciosa.
- **Worktrees por run**, integração testada e limpeza sem descarte forçado.
- **O Oracle escreve os agregados**; agentes devolvem resultados individuais versionados por task.
- **Reviews independentes** (spec, standards, correctness) **e hooks** (arch-alignment,
  reinvention, security, performance, overengineering, deps-freshness, UI), aceitação
  de UI em runtime quando aplicável, gates do projeto e arquivos canônicos de
  acompanhamento.
- **Resultados vinculados ao código revisado**: mudar código, contrato, plano ou mapa
  de arquitetura invalida as evidências afetadas; o HTML é recalculado e o fechamento
  é selado. Score numérico sozinho nunca autoriza fechar.
- `--fresh` inicia uma run nova com ID único e preserva a anterior.
- Tasks após o SDD seguem uma [adaptação prática do ASD-STE100](references/task-writing.md):
  ações diretas, termos consistentes e aceite observável — no JSON, no Markdown
  regenerado e no HTML.
- [Relatório HTML automático](references/automatic-report.md): atualização por evento
  e a cada dez minutos, agendador/subtask nativo quando disponível, timer Node como
  fallback; inclui andamento parcial por task e captura final ao pausar/fechar.

## Español

Implementación rastreable con reanudación, validación por tipo de cambio y cierre
sellado por evidencias del código verificado.

Consulta [SKILL.md](SKILL.md) para flags y flujo; [esquemas](references/pack-schemas.md)
y el [protocolo de estado/evidencia](references/lifecycle.md) para los artefactos.

- **Validación por tipo de cambio:** feature/bugfix → red-green (fallo relevante
  antes, verde después); refactor → caracterización antes/después; docs/config →
  checks adecuados (parser/build/link/esquema), nunca tests artificiales.
- **Una regla de la generación a la revisión** — las mismas baselines guían al
  implementer y al standards reviewer:
  - [Baseline de oficio](catalogs/craft-baseline.md): firmas ajustadas (~4
    parámetros, encima de eso un objeto de parámetros), métodos cortos de una
    responsabilidad, early return, condiciones nombradas, errores con contexto,
    inmutabilidad por defecto, observabilidad (log estructurado, correlation id, sin
    secretos/PII), tests determinísticos de comportamiento, **higiene del diff** (el
    churn cosmético no viaja mezclado con lógica) y **el refactor no cambia
    comportamiento** (cualquier deriva es un defecto).
  - [Baseline de diseño](catalogs/design-baseline.md): SOLID como señales de
    detección (SRP/LSP/ISP/DIP con checks de `instanceof`, implementaciones vacías,
    `new` de dependencia concreta en lógica de negocio), tabla de selección de
    patrones y anti-patrones de abuso.
  - [Baselines por lenguaje](references/language-baselines.md): secciones Java/Spring,
    Go y Swift pegadas según `languages[]` del arch-map. Java cubre Spring Boot
    (responsabilidades de capa, inyección por constructor, self-call no atraviesa el
    proxy, `@RestControllerAdvice`, config segura), JPA (LAZY por defecto, corrección
    de N+1, transacciones, dirección del cascade, `@Version`), concurrencia
    (check-then-act, visibilidad, orden de locks, pitfalls de `@Async`,
    `CompletableFuture`, virtual threads) y rendimiento medido. Go cubre wrap de
    errores, `context.Context`, nil-safety, interfaces del consumidor y dueño de
    goroutine. Swift cubre value semantics, `guard`, errores de dominio tipados,
    dueño del estado en SwiftUI y concurrencia estructurada.
  - Sección universal de **contratos HTTP**, pegada cuando el diff crea/cambia
    endpoints: semántica de verbo, status honesto (nunca 200 con cuerpo de error),
    DTOs en la frontera, forma única de error, paginación y reglas de breaking change.
  - El estándar documentado del repo prevalece sobre cualquier baseline; la
    arquitectura de la app es la base de cada elección — un enfoque "mejor" se
    convierte en pregunta al usuario, nunca en cambio silencioso.
- **Worktrees por run**, integración probada y limpieza sin descartes forzados.
- **El Oracle escribe los agregados**; los agentes devuelven resultados individuales versionados por task.
- **Reviews independientes** (spec, standards, correctness) **y hooks** (arch-alignment,
  reinvention, security, performance, overengineering, deps-freshness, UI),
  aceptación de UI en runtime cuando aplica, gates del proyecto y archivos canónicos
  de seguimiento.
- **Resultados vinculados al código revisado**: cambiar código, contratos, plan o
  mapa de arquitectura invalida las evidencias afectadas; el HTML se recalcula y el
  cierre se sella. Un score numérico por sí solo nunca autoriza cerrar.
- `--fresh` inicia una run nueva con ID único y preserva la anterior.
- Las tasks posteriores al SDD siguen una [adaptación práctica del ASD-STE100](references/task-writing.md):
  acciones directas, términos consistentes y aceptación observable — en el JSON, en
  el Markdown regenerado y en el HTML.
- [Informe HTML automático](references/automatic-report.md): actualización por evento
  y cada diez minutos, scheduler/subtask nativo cuando está disponible, timer de Node
  como fallback; incluye progreso parcial por task y captura final al pausar/cerrar.

---

## Tests

```bash
node --test make-me-happy/scripts/tests/*.test.mjs
# Optional · Opcional: uses an already-installed Chromium; installs no dependencies.
MMH_REAL_BROWSER=1 node --test make-me-happy/scripts/tests/*.test.mjs
```

Canonical source in this harness · Fuente canónica en este harness · Fonte canônica
neste harness — hosts use symlinks / los hosts usan symlinks / os hosts usam symlinks.
Audit report and fix matrix / Informe de auditoría y matriz de correcciones /
Relatório de auditoria e matriz de correções: `docs/reviews/` at the repository root /
en la raíz del repositorio / na raiz do repositório.

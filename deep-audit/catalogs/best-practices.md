# Best-practices catalog — Atena (Boas práticas)

Use as a **hunt menu**, not a checklist to spam. Only report when code shows the pattern
**and** a concrete future-change cost or bug exists. Project conventions (CLAUDE.md /
AGENTS.md / ADRs) override community idiom — deliberate deviation is not a finding.

Each entry: **id** · signals to grep/read · why it bites · good fix direction.

---

## Universal — design patterns misapplied

### `singleton-mutable-state`
- Signals: global instance + setters/mutable fields; `getInstance()` + writes; module-level mutable object shared across requests
- Bites: hidden coupling, order-dependent tests, races under concurrency
- Fix: inject the dependency; keep state per-scope; freeze what must be global

### `strategy-without-variation`
- Signals: interface/abstract + exactly one implementation, no test double, no planned second case
- Bites: pure ceremony; readers hunt through indirection for nothing (delete → Lacônio owns the delete; misuse of the pattern → yours)
- Fix: inline until a second real strategy exists

### `inheritance-over-composition`
- Signals: extends a concrete class to reuse 1–2 methods; deep hierarchies; `protected` fields as API; base-class flags checked in children
- Bites: fragile base class — every parent change risks all children
- Fix: compose/delegate; extract shared behavior into a collaborator

### `observer-cycle`
- Signals: A notifies B, B mutates A (directly or via event); event handlers emitting the event they handle
- Bites: infinite loops, double-processing, heisenbugs
- Fix: one-way data flow; re-entrancy guard; split the event

### `builder-ceremony`
- Signals: builder for ≤3 fields, all required; fluent API with a single call site
- Bites: noise; hides which fields are actually required
- Fix: constructor/named args/factory function

### `decorator-contract-break`
- Signals: wrapper that swallows errors of the wrapped call, changes nullability, skips delegation on some paths
- Bites: callers rely on the interface contract; the decorated path silently differs
- Fix: decorator must be substitutable — same contract, added behavior only

### `repository-leaking-orm`
- Signals: repository interface returning ORM entities/query objects/`*sql.Rows`; caller composing queries on the result
- Bites: the "port" doesn't abstract — swapping infra breaks every caller
- Fix: return domain types; keep query language behind the boundary

### `pattern-by-name-only`
- Signals: class named `*Factory`/`*Strategy`/`*Adapter`/`*Facade` that doesn't do what the name promises
- Bites: name sets expectations the code betrays; onboarding tax
- Fix: rename to what it does, or implement the actual pattern

## Universal — Clean Code effectiveness

### `name-lies`
- Signals: `get*`/`is*`/`find*` that mutates state or does I/O; `validate*` returning transformed data; "pure-looking" fn writing globals/DB
- Bites: callers reason from the name and misuse it
- Fix: rename to reveal effect, or remove the effect

### `boolean-trap`
- Signals: `fn(true, false)` at call sites; a flag param that flips the whole behavior; flag threaded through layers
- Bites: unreadable call sites; the two branches share nothing and diverge
- Fix: two functions, enum param, or options object

### `mixed-abstraction-levels`
- Signals: business rule interleaved with byte parsing/SQL building/HTTP header fiddling in one function
- Bites: can't test the rule without the plumbing; every infra change touches domain code
- Fix: extract the low-level steps; the function should read at one level

### `constructor-does-work`
- Signals: constructor/init doing network/DB/file I/O, spawning threads/goroutines, registering global handlers
- Bites: object creation becomes unmockable and order-sensitive; tests need live infra
- Fix: constructors assign; a start()/factory does the work

### `exception-control-flow`
- Signals: throw/catch used for expected branches (not-found, validation); catch block implementing the happy path
- Bites: hides real errors in the same catch; perf; unreadable flow
- Fix: return values/result types for expected outcomes; exceptions for the exceptional

## Universal — Clean Architecture effectiveness (typed stacks)

### `anemic-domain`
- Signals: entities = getters/setters only; every rule lives in `*Service`; invariants enforced (or not) at N call sites
- Bites: the type system protects nothing; same rule re-implemented and diverging
- Fix: move invariants into the entity/value object; make illegal states unrepresentable

### `passthrough-usecase`
- Signals: use case/service method = one repository call, no rule, no orchestration — repeated for every entity
- Bites: ceremonial layer taxes every feature; readers assume there's logic when there's none
- Fix: collapse the layer for CRUD paths, or put the actual policy there

### `port-mirrors-infra`
- Signals: interface with the exact signature/types of the ORM/HTTP client it wraps; mock re-implements infra behavior
- Bites: the abstraction abstracts nothing — infra swap still breaks all callers
- Fix: design the port from the caller's need, not the vendor's API

### `domain-annotated-with-infra`
- Signals: `@Transactional`/`@Entity`/serialization/DI annotations on domain classes; domain importing framework types
- Bites: domain untestable without framework; migration = rewrite
- Fix: keep domain POJO/POGO; map at the boundary

---

## Go

### `go-error-discarded`
- Signals: `_ = fn()` on error-returning calls; `err` shadowed and never checked; `errors.As`/`Is` skipped for string compare on messages
- Bites: silent failure; retry/fallback logic keyed on message text breaks on wording change
- Fix: handle or wrap with `%w` + context; classify with `errors.Is/As`

### `go-context-ignored`
- Signals: exported funcs doing I/O without `ctx context.Context` first param; `context.Background()` deep in call chain; ctx stored in struct
- Bites: no cancellation/timeout propagation; goroutines outlive requests
- Fix: ctx first param, flow it down; never store in struct

### `go-interface-on-producer`
- Signals: package defines interface next to its only implementation and returns the interface
- Bites: violates "accept interfaces, return structs"; consumers can't extend; mocks proliferate
- Fix: consumer declares the interface it needs; producer returns concrete type

### `go-panic-as-error`
- Signals: `panic(` in library/service code for expected failures; `recover` as routine flow
- Bites: crashes the process (or hides bugs when blanket-recovered)
- Fix: return errors; panic only for programmer error/unreachable states

### `go-goroutine-no-owner`
- Signals: bare `go func(){...}()` with no WaitGroup/errgroup/channel/panic-guard
- Bites: leaked goroutines, lost errors, process crash on panic (ownership → Cronos/Fantasma if concurrency/leak; the *idiom* is yours)
- Fix: errgroup / owned lifecycle / project's safe-go helper

## JavaScript / TypeScript

### `ts-any-gratuitous`
- Signals: `any`/`as any` where a type exists or is one import away; `@ts-ignore` without comment; `Function` type
- Bites: turns the compiler off exactly where it was needed; refactors silently break call sites
- Fix: `unknown` + narrowing, generics, or the real type

### `ts-enum-vs-union`
- Signals: numeric enums serialized to API/DB; string unions and enums mixed for the same concept in one repo
- Bites: numeric enum values shift on reorder → corrupt persisted data
- Fix: string literal unions (or string enums) — one convention per repo

### `ts-assertion-over-narrowing`
- Signals: `as Foo` on fetch/JSON/parse results; non-null `!` on values that can be null at runtime
- Bites: type says safe, runtime disagrees — crash far from the cause
- Fix: schema validation (zod/valibot/project's validator) at the boundary; type guards

### `react-effect-for-derived-state`
- Signals: `useEffect` + `setState` computing a value from props/state; effect chains updating each other
- Bites: extra renders, tearing, stale intermediate states
- Fix: compute during render / `useMemo`; effects only for real external sync

### `react-prop-drilling-vs-context-misuse`
- Signals: same prop threaded ≥4 levels; or one giant context re-rendering the whole tree on every change
- Bites: churn on every signature (drilling) / global re-render (fat context)
- Fix: composition (children), split contexts by change-rate, or the project's store

### `promise-floating`
- Signals: async call without `await`/`.catch`/`void` marker; `forEach(async ...)`
- Bites: swallowed rejections, out-of-order effects (correctness bug → Artemis; the idiom is yours)
- Fix: await/`Promise.all`; `for..of` for sequential async

## Java / Kotlin

### `jk-optional-get`
- Signals: `Optional.get()` without `isPresent`; Kotlin `!!` in production paths; `Optional` as field/parameter type
- Bites: NPE with extra steps — the type promised safety and code opted out
- Fix: `orElse*/map/fold`; Kotlin `?.`/`?:`/`requireNotNull` with message; Optional only as return type

### `jk-mutable-where-immutable-free`
- Signals: Kotlin `var`+`MutableList` exposed in APIs when `val`+`List` fits; Java setters on config/value objects; exposed internal collections
- Bites: aliasing bugs — caller mutates internal state; thread-unsafe by default
- Fix: `val`/`List`, `copy()`/withers, defensive copies at the boundary; Java records for values

### `jk-data-class-misuse`
- Signals: Kotlin data class with `var`s used as identity-bearing entity (equals/hashCode over mutable fields); data class in `HashSet`/map keys then mutated
- Bites: element "disappears" from set; equality changes under the collection
- Fix: immutable data classes for values; plain class + stable identity for entities

### `jk-checked-exception-laundering`
- Signals: `catch (Exception e) { throw new RuntimeException(e) }` everywhere; `@SneakyThrows`; broad `throws Exception`
- Bites: callers can't handle specific failures; the wrapper hides the actual contract
- Fix: domain exception types (or result types); translate at the boundary once

### `jk-stream-side-effects`
- Signals: `.map`/`.filter` lambdas mutating external state; `peek()` for logic; giant stream chains replacing readable loops
- Bites: order/laziness surprises; parallel streams corrupt shared state
- Fix: pure lambdas; `forEach`/loop when the point is side effects

### `kt-coroutine-scope-misuse`
- Signals: `GlobalScope.launch`; `runBlocking` inside suspend/production paths; scope not tied to lifecycle
- Bites: leaked work after the owner dies; deadlocks on blocked event loops
- Fix: structured concurrency — lifecycle-owned scope, `coroutineScope {}`

## Python

### `py-untyped-public-api`
- Signals: public functions without type hints in a repo that uses them elsewhere; `Any` where a Protocol/TypedDict fits
- Bites: the one untyped seam is where refactors break silently
- Fix: annotate the public surface; Protocol for duck-typed deps

### `py-exception-blanket`
- Signals: `except Exception:`/bare `except:` continuing the happy path; exceptions for expected branches
- Bites: real bugs (TypeError, KeyError) masked as "expected miss"
- Fix: catch the specific exception at the narrowest scope

### `py-dunder-abuse-or-magic`
- Signals: `__getattr__`/metaclass/monkey-patching where a plain method fits; decorators mutating global registries at import time
- Bites: import order becomes load-bearing; tooling and readers can't follow
- Fix: explicit registration/plain composition; magic only at framework edges

### `py-dataclass-vs-dict`
- Signals: dicts with fixed string keys threaded through many functions; `.get("field")` chains
- Bites: typos are runtime KeyErrors; no refactor support
- Fix: dataclass/TypedDict/pydantic at the boundary

## Rust

### `rs-unwrap-in-prod`
- Signals: `.unwrap()`/`.expect()` on I/O, parse, lock results in non-test code
- Bites: panic = abort in prod paths (crash bug → Artemis; the idiom is yours)
- Fix: `?` with contextual error type (thiserror/anyhow per project convention)

### `rs-clone-to-satisfy-borrowck`
- Signals: `.clone()` clusters on hot paths purely to appease the borrow checker; `Rc<RefCell<_>>` where a redesign of ownership fits
- Bites: hidden O(n) copies; runtime borrow panics reintroduce what the compiler prevented
- Fix: restructure ownership/lifetimes; borrow, or move the data

## C#

### `cs-async-void`
- Signals: `async void` outside event handlers; `.Result`/`.Wait()` on tasks; missing `ConfigureAwait` per project convention
- Bites: unobservable exceptions; deadlocks on sync-over-async
- Fix: `async Task` end-to-end; await all the way up

### `cs-idisposable-ignored`
- Signals: IDisposable created without `using`; DbContext/HttpClient lifetimes wrong (per-call HttpClient, long-lived DbContext)
- Bites: socket exhaustion, stale change-tracking (leak symptom → Fantasma; the idiom is yours)
- Fix: `using`/DI-managed lifetimes; IHttpClientFactory

---

## Cross-domain ownership

| Symptom found while hunting | Owner |
|---|---|
| Layer/import rule broken | **Atlas** |
| Measured complexity over threshold | **Dédalo** |
| Same logic in two places | **Eco** |
| Ceremony to delete (no idiom to teach) | **Lacônio** |
| Single-thread correctness bug | **Artemis** |
| Concurrency/lifetime of work | **Cronos** / **Fantasma** |
| Exploit/authz/secret | **Cérbero** |

If the fix sentence starts with "delete/inline" → Lacônio. If it starts with "replace with
the idiomatic form / apply the pattern correctly" → Atena. Strong overlap: leave it with
the specialist and note it in `evidence`.

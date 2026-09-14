# Best practices catalog — Mentor (+ Atlas layering cross-ref)

Use as hunt menu. Project `AGENTS.md` / SDD **wins** over this file.

---

## Universal Clean Code

| id | Signals | Effective fix |
|----|---------|---------------|
| `lying-name` | `isX` mutates; `get` saves; `validate` persists | rename or split |
| `hidden-side-effect` | ctor/I/O; getter hits DB/network | explicit command/use case |
| `primitive-obsession` | `String customerId` everywhere; money as double | value types |
| `data-clump` | same 3–5 params travel together | object/record |
| `feature-envy` | method uses other type's data more than own | move method |
| `train-wreck` | `a.getB().getC().do()` cross-layer | tell-don't-ask; facade at boundary |
| `error-as-bool` | `boolean success` + out-params | Result / throws policy of codebase |
| `commented-code` | dead blocks | delete |
| `todo-prod-path` | TODO/FIXME on hot path without ticket | ticket or implement |

## Universal SOLID / cohesion

| id | Signals |
|----|---------|
| `srp-god-class` | class name + "And" / Manager/Util with unrelated methods |
| `ocp-switch-grow` | repeated edits adding enum cases in 5 files |
| `lsp-broken` | subclass throws UOE; weakened preconditions |
| `isp-fat-interface` | clients depend on methods they never call |
| `dip-concrete` | high-level imports infrastructure concrete types |

## Design patterns — misuse

| id | Bad signal | Good signal (don't flag) |
|----|------------|---------------------------|
| `singleton-di-world` | static mutable + DI framework present | true process-wide immutable config |
| `abstract-factory-god` | one factory constructs half the app | family of related products |
| `strategy-single-impl` | interface+1 never selected | real runtime selection |
| `observer-spaghetti` | global event bus, no schema | typed events + clear owner |
| `repo-as-service` | business rules in DAO | repo = persistence only |
| `builder-overkill` | builder for 2 fields | many optionals / telescoping fixed |
| `missing-polymorphism` | type switch edited monthly | sealed hierarchy / strategy |

## Clean / Hexagonal effectiveness

| id | Bad signal |
|----|------------|
| `domain-framework-import` | domain imports Spring/JPA/EF/UI |
| `controller-business` | HTTP layer contains rules |
| `entity-as-dto` | same class is table + JSON + domain |
| `usecase-bypassed` | controllers → repos directly |
| `infra-types-in-app` | `JpaRepository` / `RedisTemplate` in application services without port |
| `domain-tests-need-container` | pure domain tests boot Spring/DB |
| `anemic-plus-god-service` | entities have no invariants; 2k-LOC service holds all rules **and** Echo/Daedalus fire |

Atlas enforces **dependency arrows**. Mentor enforces **whether the architecture works**.

---

## Java

- `equals`/`hashCode` contract; mutable keys in sets  
- Spring: `@Transactional` on private/self-invocation ineffective  
- `@Service` in domain package  
- Checked exceptions swallowed at boundary  
- Optional in fields / serialization  
- Prefer constructors over field injection  

### Kotlin
- `!!` on public APIs  
- `GlobalScope`  
- data class for entities with identity (careful)  
- blocking in coroutines without dispatcher  

### Spring-specific
- Business in `@RestController`  
- JPA entities returned as API body  
- Open session in view relied upon  

## Swift

- Reference types for pure values  
- `observable` / MainActor isolation ignored  
- Protocol existentials where generics needed for perf/correctness  
- Force try in library code  

## Go

- Interfaces defined on producer with huge method sets  
- Returning concrete when tests need fake — OK; accept interfaces at consumer  
- `context.Context` not first param on RPC  
- Panic for ordinary errors  
- Init() heavy side effects  

## TypeScript / JavaScript

- `any` / `as unknown as` on domain boundaries  
- Non-null `!` assertions hiding bugs  
- React: side effects in render; unstable deps  
- Mixed CJS/ESM hacks in app code  

## Python

- Mutable default args (also Artemis)  
- Public API without types on greenfield typed codebases  
- `except Exception` broad in framework boundaries  
- Django fat views vs service layer when project chose services  

## Rust

- `unwrap` in libraries  
- Overly generic public API unused  
- Holding locks across await  

## C#

- `async void` non-event  
- Discarding `Task`  
- IDisposable not disposed  
- Anemic + huge ApplicationServices  

## PHP / Ruby

- Fat controllers  
- Business in Blade/ERB  
- N+1 left to Nexus but Mentor flags missing query objects if pattern exists  

---

## Arch test suggestions (test_red_green)

- ArchUnit / NetArchTest / import-linter / dependency-cruiser  
- PHPStan/Psalm baseline rules  
- Swift package boundary tests compile-only  
- Go `go list` + forbidden import grep in CI  

# Verbosity catalog — Laconic

Noise that **hides intent**. Prefer idiomatic density of the **project**, not golf.

## Universal anti-patterns

| id | Signals | Denser direction |
|----|---------|------------------|
| `pass-through-layers` | A calls B calls C, identical signature, no rule | collapse to boundary that adds value |
| `stdlib-reimpl` | manual loop for map/filter/join/exists | use stdlib / lodash-of-the-stack already in repo |
| `getter-forest` | dozens of trivial accessors in domain that could be records/data class | records / immutable data |
| `null-ceremony` | 15 lines null-check where `?.` / Optional / if-let exists | idiomatic null handling |
| `comment-novel` | line-by-line comments restating code | delete; rename symbols |
| `commented-code` | large `//` or `#` blocks of old code | delete; VCS keeps history |
| `enterprise-theater` | interface+impl+factory ×1, never swapped | delete seam until second impl |
| `boolean-param-explosion` | `f(true,false,true,true)` | options object / enum |
| `dead-param` | parameter always same literal at all call sites | remove or close over |
| `wrapper-type-no-invariant` | newtype without validation or units | use alias or add invariant |
| `async-noise` | async method that only `return await other()` | sync pass-through or inline |
| `exception-translate-noop` | catch and throw same/wrapped without info | remove or enrich |

## Language signals

### Java
- Manual getters/setters where records fit (Java 16+)  
- `Optional` get/isPresent pyramids → `map/flatMap/orElseThrow`  
- Checked exception wraps that add nothing  
- Builder for 2 required fields

### Kotlin
- `!!` chains instead of structured nullability  
- `apply/also/let/run` nested without need (also complexity)  
- Java-style verbose code in Kotlin modules (for-i, raw getters)

### Swift
- `NumberFormatter` ceremony for simple cases when project has helper  
- Nested `if let` instead of `guard`  
- Explicit types everywhere against local style  
- Combine boilerplate where `async` already used nearby

### Go
- Reimplementing `slices`/`maps` helpers on new Go  
- Interfaces defined on consumer side violated (too many tiny interfaces unused)  
- Yoda error strings without `%w` when project standard is wrap

### TS / JS
- `Array.prototype` reimpl  
- `for(let i=0...)` when `.map` is local style **and** no index need  
- Redundant `Promise.resolve` / `async`  
- Props drilling of 12 fields → context or object already used elsewhere

### Python
- Java-style getters  
- `range(len(x))` where `enumerate`/`for item in`  
- Explicit close without context managers

### C#
- Manual properties where records fit  
- `async` end-to-end for CPU-only  
- LINQ that is clearer as loop (don't force reverse)

### Rust
- Extreme generic abstraction for one monomorphized use  
- Newtype without invariants

## Do not flag

- Explicitness required by safety (authz checks repeated at boundary by policy)  
- Verbose code matching team AGENTS.md style  
- FFI / serialization glue  
- Public API stability wrappers  

## Severity bias

Up when noise sits **between** reader and a security/money branch.  
Down when file is generated or low churn.

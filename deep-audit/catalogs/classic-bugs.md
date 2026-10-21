# Classic bugs catalog — Artemis (Caça-bugs)

Use as a **hunt menu**, not a checklist to spam. Only report when code shows the pattern **and** a concrete failure scenario exists.

Each entry: **id** · signals to grep/read · typical failure · good fix direction.

---

## Universal

### `off-by-one`
- Signals: `<= length`, `i < n-1` mixed with `i <= n`, subrange APIs (`end` exclusive vs inclusive), page `from/to`
- Failure: skipped last element, OOB, empty page when data remains
- Fix: one convention end-exclusive; tests on empty/one/many

### `null-deref-unchecked`
- Signals: `.` after optional without guard; `get(` without contains; force paths
- Failure: crash on missing optional data
- Fix: explicit branch / type system / default

### `swallowed-error`
- Signals: empty catch, `catch { }`, `_ = try?`, `err` ignored, `.ok()` discarded
- Failure: silent data loss, continues with partial state
- Fix: handle, propagate, or log+abort with metric

### `wrong-equality`
- Signals: `==` on floats; reference equality on value types; case-sensitive id compare; `equals` without null-safe
- Failure: duplicate rows, failed lookups, auth mismatch
- Fix: domain equality, epsilon only where defined, normalized ids

### `time-timezone`
- Signals: `LocalDateTime.now()`, `new Date()`, `Date()` mixed with instant; format without zone; "add 1 day" via epoch ms
- Failure: billing day shift, appointment wrong day, DST holes
- Fix: store UTC/instant; convert at edge; zoned tests

### `money-float`
- Signals: `float`/`double`/`number` for currency; `* 0.1` money; JSON number money
- Failure: 0.1 + 0.2 residuals, unpaid cents
- Fix: integer minor units or decimal type

### `int-division-trunc`
- Signals: integer `/` for rates/percent; `n/2` mid index without clarifying
- Failure: wrong split, lost remainder
- Fix: explicit rounding mode; remainder handling

### `pagination-drift`
- Signals: offset page without stable sort; total count query different filter than page query
- Failure: duplicates/skips while scrolling
- Fix: keyset pagination; same filter; stable order

### `cache-stale-correctness`
- Signals: cache get after write path without invalidate; TTL-only consistency
- Failure: user sees old state after mutation
- Fix: invalidate/update on write; version keys

### `half-open-resource-on-error`
- Signals: open then work then close without defer/finally/use; early return before close
- Failure: fd/socket leak under errors (pair with Hydra if unbounded)
- Fix: defer / try-with-resources / `use`

### `parser-accepts-garbage`
- Signals: permissive parse then persist; `JSON.parse` without schema
- Failure: corrupt records, crash later readers
- Fix: validate before persist

### `boolean-trap-api`
- Signals: `f(true, false, true)` call sites; flags without enum/options object
- Failure: swapped args, wrong branch
- Fix: named options / enum

---

## Swift

### `swift-force-unwrap`
- Signals: `!`, `try!`, `as!` outside tests
- Failure: trap in prod
- Fix: `guard let` / `throws` / `as?`

### `swift-mainactor-hop`
- Signals: UIKit/SwiftUI mutation off MainActor; `Task { }` touching `@Published` without MainActor
- Failure: intermittent UI corruption/crashes
- Fix: `@MainActor`, hop explicitly

### `swift-codable-defaults-hide-missing`
- Signals: `var x: Int = 0` in Codable without `decodeIfPresent` intent
- Failure: missing key silently becomes 0
- Fix: optional or explicit decode

### `swift-enum-nonexhaustive-default`
- Signals: `default:` in switch on app enum that gains cases
- Failure: new case mis-handled
- Fix: exhaustive switch, no default

### `swift-sendable-capture`
- Signals: non-Sendable captured in `@escaping` concurrent closures (Swift 6)
- Failure: data races
- Fix: Sendable models / isolation (cross-ref Hermes)

---

## Go

### `go-ignored-err`
- Signals: `_ = f()` / `f()` without `if err`
- Failure: continues after failed write/read
- Fix: handle err

### `go-nil-map-write`
- Signals: `var m map[K]V` then `m[k]=`
- Failure: panic
- Fix: `make`

### `go-loop-capture`
- Signals: `go func(){ use(v) }()` on range var in old style; pointers to loop var
- Failure: all goroutines see last value
- Fix: per-iter copy (`v := v`)

### `go-mutex-copy`
- Signals: `sync.Mutex` passed by value; embed mutex in copied struct
- Failure: useless lock / race
- Fix: pointer receiver; mutex unexported behind pointer

### `go-context-leak`
- Signals: `WithCancel` without `cancel()`; HTTP client without context
- Failure: goroutine leak / hung calls
- Fix: defer cancel; plumb ctx

### `go-slice-shared-append`
- Signals: append to shared slice without copy from pool/cache
- Failure: overwritten buffers
- Fix: copy before retain

---

## JavaScript / TypeScript

### `js-loose-equality`
- Signals: `==` / `!=` (except nullish idioms deliberately)
- Failure: type coercion bugs (`0 == ''`)
- Fix: `===`

### `js-async-no-abort`
- Signals: `fetch`/`useEffect` async without AbortController; setState after unmount
- Failure: race, wrong UI, warnings
- Fix: abort + mounted flag / ignore

### `js-json-parse-raw`
- Signals: `JSON.parse(userInput)` bare
- Failure: throw crash; prototype pollution if merged unsafely (Sentinel if exploit)
- Fix: try/catch + schema (zod/io-ts)

### `js-parseint-radix`
- Signals: `parseInt(x)` on non-decimal-looking strings
- Failure: octal surprises legacy; NaN chains
- Fix: radix 10; `Number` with validation

### `js-float-money`
- Signals: money as `number`
- Failure: cent drift
- Fix: integer cents

### `js-mutate-props`
- Signals: mutate props/state object in place in React
- Failure: missed render / stale closure
- Fix: immutable update

### `ts-non-null-assertion`
- Signals: `x!` / `as SomeType` without check
- Failure: runtime undefined access
- Fix: narrow

---

## Java / Kotlin

### `java-equals-hashcode`
- Signals: `equals` override without `hashCode` (or inconsistent)
- Failure: HashMap/Set lost entries
- Fix: both; Objects.hash

### `java-optional-get`
- Signals: `optional.get()` without isPresent
- Failure: NoSuchElementException
- Fix: `orElseThrow` explicit / pattern match

### `java-simpledateformat-shared`
- Signals: static `SimpleDateFormat`
- Failure: race wrong dates
- Fix: DateTimeFormatter / ThreadLocal / java.time

### `java-string-encode-default`
- Signals: `new String(bytes)` / `getBytes()` no charset
- Failure: platform charset corruption
- Fix: UTF_8 explicit

### `kotlin-!!`
- Signals: `!!` outside tests
- Failure: NPE
- Fix: `?.` / requireNotNull with message

---

## Python

### `py-mutable-default`
- Signals: `def f(x=[])` / `dict={}`
- Failure: shared state across calls
- Fix: `None` + create inside

### `py-bare-except`
- Signals: `except:` / `except Exception: pass`
- Failure: hides bugs including KeyboardInterrupt patterns
- Fix: specific exceptions

### `py-is-on-literals`
- Signals: `x is "s"` / `is 256` beyond intern guarantees
- Failure: intermittent False
- Fix: `==`

### `py-naive-datetime`
- Signals: `datetime.now()` naive vs aware compare
- Failure: TypeError or wrong order
- Fix: timezone-aware UTC

### `py-late-binding-closure`
- Signals: lambda in loop capturing loop var
- Failure: all see last value
- Fix: default arg bind `lambda i=i: ...`

---

## Rust

### `rust-unwrap-prod`
- Signals: `.unwrap()` / `.expect` in non-test lib code on external input
- Failure: panic on bad input
- Fix: `?` / map_err

### `rust-lock-across-await`
- Signals: `MutexGuard` held across `.await`
- Failure: deadlock
- Fix: drop guard; use async mutex carefully

### `rust-as-cast-truncate`
- Signals: `as u32` from larger ints on sizes
- Failure: truncated length / OOB later
- Fix: `try_from`

---

## C# 

### `csharp-async-void`
- Signals: `async void` not event handler
- Failure: unobserved exceptions
- Fix: `async Task`

### `csharp-culture-string`
- Signals: `ToLower()` without culture for ids
- Failure: Turkish I bugs
- Fix: `Ordinal` / invariant

---

## Cross-domain ownership

| If the bug is mainly… | Owner |
|-----------------------|--------|
| Exploit / authz / injection | **Sentinel** |
| Multi-writer lost update / CAS | **Hermes** |
| Unbounded growth / pool exhaustion | **Hydra** |
| N+1 query storm | **Nexus** |
| Classic wrongness / crash / corrupt on one thread | **Artemis** |
| Pure clutter without failure mode | **Forge** (or drop) |

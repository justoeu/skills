# Complexity catalog — Daedalus

Hunt menu for **cyclomatic / cognitive / nesting** debt. Prefer `measure-quality.mjs` numbers; manual count when script lacks a construct.

## Default thresholds

| Metric | MEDIUM | HIGH | CRITICAL (hot path only) |
|--------|--------|------|---------------------------|
| Cyclomatic CC | ≥ 15 | ≥ 20 | ≥ 30 |
| Cognitive | ≥ 15 | ≥ 25 | ≥ 35 |
| Max nesting | ≥ 4 | ≥ 5 | ≥ 6 |
| Executable LOC / function | ≥ 80 with CC≥12 | ≥ 120 with CC≥15 | — |

**Hot path:** authn/z, payments, multi-tenant filters, concurrency control, parsers of untrusted input, anything in the request path of top endpoints.

## How to count CC (McCabe-style)

Start at **1**, add **1** per:

- `if` / `else if` / `elif` / guard condition  
- `for` / `while` / `do` / `forEach` with nontrivial body  
- `case` / `when` arm (each)  
- `catch` / `rescue`  
- boolean `&&` / `||` in conditions (each extra term)  
- ternary `? :` / null-coalescing used as branch  
- pattern match arm  

Do **not** add for: `else` alone, `break`/`continue`, plain sequential calls.

Cognitive: same, plus extra weight for nesting (+1 per level when decision is nested).

## Universal signals

```
deep indent (4+ levels)
else if chains > 6
switch/when/match with business logic in arms (not pure map)
boolean soup: a && b || c && (d || e)
nested try inside try inside loop
```

## Language signals

### Java / Kotlin
- `if` forests in `*Service` / `*UseCase`
- `switch` on strings/enums with side effects
- Kotlin `when` without sealed exhaustiveness used as god branch
- nested `let`/`run`/`also` chains with branches inside

### Swift
- nested `if let` / `guard` pyramids (prefer early `guard`)
- giant `switch` on non-frozen enums with logic
- Combine/async handlers with inline branching

### Go
- `if err != nil` is normal — **do not** count each trivial err check as complexity debt unless nested with business branches
- flag: business `if` nests + loops together
- `switch v := x.(type)` god methods

### TS / JS
- nested callbacks / `.then` pyramids (prefer flat async)
- React components with 10+ conditional renders in one function
- `switch (action.type)` reducers: OK if thin; flag if arms hold I/O

### Python
- nested `try/except` + `if` in views/services
- boolean ops in list comprehensions hiding branches

### Rust
- nested `match` with side effects
- `unwrap_or_else` closures that contain full business flows

### C#
- nested LINQ with conditional projections + local functions doing I/O

## Exclude

- Generated code (`*.g.swift`, `*.pb.go`, OpenAPI clients)
- Exhaustive mechanical mappings (DTO↔entity field copy) with CC from many arms but **no** logic
- Test DSLs unless production twin exists

## Fix directions

1. Guard clauses / early return  
2. Extract method per case  
3. Strategy / policy / polymorphic dispatch  
4. State machine for phase logic  
5. Table-driven decisions for pure data rules  

# Duplication catalog — Echo

## Clone types (quick)

| Type | Detection idea |
|------|----------------|
| T1 | identical lines (ignore ws/comments) |
| T2 | same tokens after normalizing identifiers/literals |
| T3 | shared skeleton ≥70% lines with inserts/deletes |
| T4 | same business rule, different structure |

## Minimum size

- Prefer **≥ 6–8 non-trivial lines** or **≥ 3 identical statements** of domain logic  
- Never report 1-line getters or import blocks  
- Two files sharing a 2-line null check → drop

## Universal signals

- Same log/error message string in 2+ modules  
- Same magic number/string sequence (regex, SQL fragment, header name)  
- Copy-pasted `TODO` or identical outdated comment  
- Parallel class names `FooService` / `FooService2` / `FooServiceOld`  
- Test expected values duplicated with production constants (maybe extract)

## High-value domains (bias severity up)

- Discount / tax / pricing  
- Permission / tenant predicates  
- Validation of emails, CPF/CNPJ, IBAN, cards  
- Retry/backoff policy  
- Date range / billing period math  
- Hashing / token compare (also Sentinel if security)

## Language signals

### Java / Kotlin
- Same stream pipeline in two services  
- Duplicated MapStruct-like manual mappers  
- Identical `@Query` fragments

### Swift
- Duplicated `Codable` mapping logic  
- Copy-pasted ViewModel load/error handling

### Go
- Repeated err-wrap + log blocks with same business check inside  
- Duplicate SQL in multiple repos

### TS / JS
- Same `fetch` + error parse in multiple files (should be client)  
- Copy-pasted Yup/Zod schemas

### Python
- Duplicated Django serializers / Pydantic models diverging  
- Same pandas wrangle in two tasks

## False positives

- Interface + single adapter (not a clone of business rule)  
- Protocol conformance stubs  
- Parallel test cases (table-driven is good)  
- Vendor SDK wrappers that must mirror upstream API  

## Fix directions

1. Extract function / shared module in same layer  
2. Domain policy / pure function  
3. Template method only if variation is real  
4. Generate from single schema (OpenAPI, SQLC)  
5. Delete dead twin  

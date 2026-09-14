# N+1 catalog — Nexus

Use as a **hunt menu**, not a checklist to spam. Report only with a real `path:line` and a concrete extra query/request per item (or a fixed K-round-trip that should be batched).

N+1 = **1 fetch of a collection + 1 I/O per item**, instead of one batched round-trip.

Batching, when it is the fix: `WHERE x IN (…)` / `= ANY(…)`, JOIN, EntityGraph/`include`/`preload`, 2-phase ids then graph, dataloader, `SendBatch`/`pipeline`, bulk insert (`CopyFrom` / multi-row `VALUES`), list endpoint that already embeds children.

---

## Shapes

### `list-then-per-item-query`
- Signals: `for`/`range`/`map` over a list from DB, then another repository/query inside
- Failure: list page of N rows does N extra SELECTs
- Fix: `IN` / JOIN / 2-phase load / projection DTO

### `orm-lazy-in-loop`
- Signals: getter/association/serializer field on a lazy relation inside mapper, JSON, template
- Failure: 1+N on serialize; LazyInitializationException if session is closed
- Fix: FETCH / EntityGraph / `@BatchSize` / `include`/`select_related`/`prefetch`/`preload`/`With`; never page + multi-bag JOIN FETCH (cartesian) — 2-phase instead

### `worker-per-item-write`
- Signals: `UPDATE`/`INSERT`/`exec` inside a job/consumer loop over ids
- Failure: N writes instead of one batch; pool saturation
- Fix: bulk/`CopyFrom`/multi-row VALUES / batched prepared statements

### `non-sql-io-in-loop`
- Signals: HTTP client, S3/`PutObject`, mail, cache `GET` by id, inside `for` over a list
- Failure: N outbound calls; tail latency × N
- Fix: bulk API, `MGET`/`pipeline`, batch send, embed data in the list fetch

### `graphql-resolver-per-parent`
- Signals: field resolver that hits DB/HTTP with parent id; no dataloader
- Failure: query cost = nodes × fields
- Fix: dataloader / batch loader keyed by parent id

### `frontend-list-cell-fetch`
- Signals: component rendered by `.map()` that calls `fetch`/`useQuery`/`useSWR`; `Promise.all` over ids; polling per row
- Failure: N XHRs on first paint; waterfalls
- Fix: list endpoint embeds children; one batched query; DataLoader-style cache on the client

### `grpc-http-per-item`
- Signals: client stub / `restTemplate` / `fetch` inside loop; no bulk route
- Failure: N RPCs
- Fix: bulk endpoint or collect-then-one-call

### `k-sequential-roundtrips`
- Signals: handler that runs a **fixed** sequence of queries (dashboard: counts + list + extras) with K large
- Failure: not classic 1+N, but same user-visible cost
- Fix: combine, pipeline, or parallelize with a cap; report as N+1-family only when K is large or on a hot path
- Not a finding: 2–3 sequential lookups on a rare admin page

---

## Stack signals (apply what is present)

| Signal | Typical N+1 |
|--------|-------------|
| JPA / Hibernate / EclipseLink | lazy association in loop/mapper/serializer; missing FETCH/EntityGraph/`@BatchSize`/2-phase |
| EF / Dapper / SQLAlchemy / Prisma / Eloquent / ActiveRecord / GORM / Diesel | query inside `for`/`map`; missing `include`/`select_related`/`prefetch`/`preload`/`With` |
| Raw SQL | `SELECT`/`UPDATE` per row after a list query |
| GraphQL | per-parent resolver without dataloader |
| Frontend (React/Vue/Svelte/Next) | `.map` → fetch/query; `Promise.all` over item ids; per-row polling |
| gRPC / HTTP client | per-item outbound call |
| Workers / queues | per-message DB/HTTP that could be a flush batch |

OSIV / open-session-in-view: if the repo documents it **off**, lazy access outside a transaction is HIGH (LIE). If **on**, still flag the N+1; session-in-view is an amplifier, not a fix.

---

## Method

Delta: files in `$BASE...HEAD` + callers. Full: list/search/page handlers, workers, GraphQL types, list UI.

1. **Service / handler** — I/O (`ctx`, repository, client) inside `for`/`range`/`map`. Read the callee: does it hit DB/network per iteration?
2. **Repository / worker** — query/exec inside loops; UPDATEs/INSERTs that could be batched.
3. **Serializer / template / GraphQL field** — association access after a list load.
4. **Frontend** — fetch/query in a list cell; `Promise.all` on a collection; confirm whether the list API already returns the child data.
5. **Fixed K round-trips** — only if K is large or the path is hot.

Confirm load strategy before filing: eager, batch, 2-phase, projection, dataloader. A loop that only uses in-memory data is not N+1.

---

## Severity

| Sev | When |
|-----|------|
| **HIGH** | hot path (list endpoint, high-volume worker) and **N unbounded** (no page size / no cap) |
| **MEDIUM** | N capped by pagination or a small batch |
| **LOW** | rare/admin/seed, or N always tiny (≤ ~5) |

`blocks_pr`: HIGH + confidence high on a **delta-introduced** path.

---

## Ownership

| If it is mainly… | Owner |
|------------------|--------|
| 1+N queries/requests / lazy graph / list-cell fetch | **Nexus** |
| Unbounded pool/queue from the fan-out | **Hydra** |
| Lost update from per-item writes racing | **Hermes** |
| Exploit via the extra query (IDOR in the child fetch) | **Sentinel** |

---

## `test_red_green`

Query-count or request-count test (assert extra I/O does not grow with N), or assert the batched repository/loader is the one invoked. Document LIE when session-closed lazy access is the failure.

# Pack schemas — `docs/impl/make-me-happy/<run>/`

`build-report.mjs` reads these files. It never fails on a missing or malformed file. It shows an empty state that names the file and the agent that should have written it, and it prints `WARN <file>: …` for schema drift. Older packs are adapted, not rejected. A warning still means the pack is incomplete: fix the writer, not the reader.

| File | Writer | Required |
|------|--------|----------|
| `run-meta.json` | Oracle (§0) + `scripts/run-meta.mjs step` | yes |
| `spec-summary.md` | planner / explorer | yes |
| `TASKS.json` / `TASKS.md` | planner, then implementer per task | yes |
| `flow.mmd` | planner | yes |
| `diagrams/<T-xxx>.mmd` | planner (optional, per-task `sequenceDiagram`) | no |
| `payloads.json` | planner | yes (`[]` when the spec defines no contract) |
| `worktrees.json` | `scripts/worktrees.mjs` | yes |
| `immutability.json` | immutability | yes |
| `tests.json` | Oracle, after the final merge | yes |
| `coverage.json` | implementer / Oracle | yes |
| `reviews/<axis>.json` + `reviews/<axis>.md` | each reviewer | yes |
| `score.json` | `scripts/score.mjs` | yes |
| `project-gates.json` | Oracle (§8) | yes |

Timestamps are ISO-8601 UTC (`2026-10-01T00:40:00Z`).

## run-meta.json

```json
{
  "app": "Prontyx Receitas", "branch": "feat/x", "into": "feature/x", "head": "360eb8da", "base": "5fdc9065",
  "kind": "feature", "loop": "full", "worktree_n": 3,
  "spec": "docs/SDD/x.md", "spec_status": "confirmed", "coverage_floor": 90,
  "status": "in_progress", "test_cmd": "make test",
  "started_at": "…", "finished_at": "…",
  "steps": {
    "planner":   { "status": "done", "started_at": "…", "finished_at": "…", "note": "24 tasks" },
    "implement": { "status": "in_progress", "started_at": "…" }
  }
}
```

`status`: `in_progress` | `closed`. Step ids: `explore planner worktrees implement immutability review score clean project-gates`. Step status: `in_progress` | `done` | `failed` | `skipped`. Write steps with the helper; do not hand-edit timestamps:

```bash
node "$SKILL_ROOT/scripts/run-meta.mjs" step --dir "$OUT" --step implement --status in_progress
node "$SKILL_ROOT/scripts/run-meta.mjs" step --dir "$OUT" --step implement --status done --note "3 slices merged"
```

Without `steps`, the report infers the timeline from which files exist and labels it `inferido`.

## TASKS.json

```json
{
  "kind": "feature",
  "spec": "docs/SDD/x.md",
  "tasks": [
    {
      "id": "T-001",
      "title": "short",
      "slice": "what this worktree owns",
      "worktree": 1,
      "status": "DONE",
      "depends_on": [],
      "refs": ["RF-02", "SEC-SEN-001"],
      "tests_added": 2,
      "red_green": true,
      "immutability": false,
      "red": {
        "test": "TestJobsDeleteRejectsAbove200",
        "file": "backend/internal/httpserver/jobs_delete_cap_test.go",
        "command": "go test ./internal/httpserver -run TestJobsDeleteRejectsAbove200",
        "output_excerpt": "expected 400, got 200",
        "at": "…"
      },
      "green": { "command": "go test ./internal/httpserver -run TestJobsDelete", "output_excerpt": "ok  0.41s", "at": "…" },
      "reversal": { "done": true, "output_excerpt": "reverted jobs.go:88 → FAIL expected 400, got 200" },
      "tests": ["TestJobsDeleteRejectsAbove200", "TestJobsDeleteAccepts200"],
      "files": ["backend/internal/services/jobs.go"],
      "commits": [{ "sha": "5fdc9065", "message": "fix(jobs): cap ids at 200" }],
      "notes": ""
    }
  ]
}
```

- `status`: `OPEN` | `IN_PROGRESS` | `DONE` | `BLOCKED`. The planner emits only `OPEN`.
- The planner writes the first block (`id` to `immutability`). The implementer fills `red`, `green`, `reversal`, `tests`, `files`, `commits` and flips `status`.
- `output_excerpt` holds the assertion or failure message, 20 lines at most. Do not paste the whole log.
- `reversal.done: false` with a `note` explains why reversal was not viable.
- Legacy fields still read: `red_test`, `test`, `red` (string), `evidence`, `findings`, `rf`, `spec_refs`, `results/<id>.json`.

## payloads.json

```json
[
  {
    "name": "delete runs above the cap",
    "kind": "http",
    "method": "POST",
    "path": "/api/jobs/{key}/runs/delete",
    "request": { "ids": [1, 2, 3] },
    "responses": [
      { "status": 400, "body": { "error": "validacao" }, "note": "201 ids" },
      { "status": 200, "body": { "deleted": 200 } }
    ],
    "notes": ["no DELETE runs when the cap trips"],
    "tasks": ["T-002"],
    "spec_ref": "§4.2"
  }
]
```

`kind`: `http` | `cli` | `event` | `ui`. For CLI, put args in `request` and stdout in `responses[].body`. Use `[]` when the spec defines no contract. Do not use a dict keyed by name, and do not use `response_201` keys. The report adapts both, but warns.

## tests.json

```json
{ "cmd": "make test-ci", "ok": true, "total": 812, "passed": 806, "failed": 0, "skipped": 6, "duration_s": 94.2,
  "at": "…", "suites": [{ "name": "backend", "passed": 640, "failed": 0, "skipped": 2 }], "log": "last 40 lines" }
```

## coverage.json

```json
{ "pct": 92.4, "floor": 90, "tool": "c8", "report": "coverage/index.html", "scope": "diff-touched product code",
  "covered": 390, "total": 410, "measured_at": "…",
  "modules": [{ "name": "backend/internal/services", "pct": 94.1, "covered": 318, "total": 338 }] }
```

`modules[]` (or `files[]`) feeds the per-module bar chart against the floor.

## immutability.json

```json
{ "green": true, "command": "go test ./... -run Contract",
  "tests": [{ "name": "OrderPayloadIT#listShape", "task": "T-002", "file": "…", "kind": "golden", "green": true }],
  "tasks_covered": ["T-002"], "notes": "what could not be proven" }
```

`suite: ["A#b", …]` (list of names) is still accepted. `score.json` keeps only a count in the gate detail and the list in `gates[].items`.

## reviews/<axis>.json (`standards` | `spec` | `correctness`)

```json
{
  "axis": "correctness",
  "verdict": "APPROVE",
  "round": 2,
  "summary": "one paragraph",
  "findings": [
    { "id": "C-1", "severity": "high", "kind": "hard", "title": "DONE task without a red test",
      "description": "…", "file": "src/a.ts", "line": 42, "rule": "AGENTS.md §3",
      "status": "fixed", "round": 1, "fixed_in_round": 2, "fix": "commit abc123" }
  ],
  "rounds": [
    { "round": 1, "verdict": "REJECT", "at": "…", "summary": "…", "findings": [ … ] },
    { "round": 2, "verdict": "APPROVE", "at": "…", "findings": [] }
  ]
}
```

- `verdict`: `APPROVE` | `REJECT` | `SKIP`. `severity`: `critical` | `high` | `medium` | `low` | `info`. `status`: `open` | `fixed` | `wontfix`. `kind` (standards): `hard` | `judgement`.
- `findings` = the state after the latest round, including findings fixed in earlier rounds. On a re-run, append to `rounds`; never overwrite history.
- Keep writing `reviews/<axis>.md` too (human prose, ending in `VERDICT: …`). `score.mjs` and `resume.mjs` prefer the JSON verdict and fall back to the md.

## project-gates.json (§8)

```json
{ "gates": [
  { "name": "security-review skill", "source": "CLAUDE.md §2", "status": "DONE", "evidence": "reviews/repo-security.md" },
  { "name": "docs + i18n sweep", "source": "AGENTS.md", "status": "OPEN", "evidence": "not run by this host" }
] }
```

`status`: `DONE` | `OPEN` | `FAILED` | `N/A`. Without this file, the report lists extra `reviews/*.md` as inferred gates.

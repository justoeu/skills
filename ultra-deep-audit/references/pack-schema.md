# Pack schema 2 / migration from 1

Version 2 separates audit completion from implementation completion. Generated `run-meta.json` owns `schema_version:2`, random `run_id`, root, branch/head, content `snapshot`, intent (`audit|fix`), expected_agents, required_artifacts, artifacts and evidence. Do not hand-promote legacy metadata. Existing v1 arrays/reports can be read and merged for historical inspection, but cannot acquire trusted DONE or COMPLETE. Start a new run; regenerate the selected roster and revalidate dispositions against current source. Keep the original pack unchanged as history.

An artifact binding is `{run_id,snapshot,sha256}` for the exact bytes of a pack-relative file. `bind` is an attestation of production/review by the operator, not a command-execution proof. Mutable HTML/markdown are views; the gate reads source bytes and bindings again. Output folders and Git-ignored generated files are excluded from source snapshots; do not ignore production source to avoid invalidation. `attempts.json` preserves the latest failure/success of each validation stage. Failed validation never replaces prior good aggregate/panel output and blocks publication as current.

A finding has agent, domain, severity (`LOW|MEDIUM|HIGH|CRITICAL`), confidence, title, path, numeric nonnegative line, evidence, impact and proposed fix/validation. IDs are stable and unique. Status is `open|resolved|accepted|refuted`; accepted/refuted require disposition_reason. `block_policy` persists policy across close/reopen; presentation counts only open blockers. Missing findings in reanalysis are retained with `not_in_latest_scan:true` pending explicit disposition. `test_red_green` from prompts is advisory only; executed proof is in run-meta evidence.

## Security

`sec-deep/inventory.json`:

```json
{
  "complete": true,
  "components": [{"name":"api","paths":["src"]}],
  "securityScanSkippedComponents": [],
  "required_hunters": [{"component":"api","lens":"authorization"}]
}
```

Dispatch all applicable lenses; this is a minimal shape, not a full-roster default. Each bound hunter file has `{component,lens,status:"complete",findings:[]}`. Missing/duplicate/incomplete assignments invalidate coverage. No attack surface can use an empty assignment list only with `no_attack_surface:true` and reason. Source inventory completeness remains an operator judgment that must be reviewable.

`sec-deep/candidates.json`:

```json
{
  "run_id": "copy from current metadata",
  "snapshot": "copy from current metadata",
  "coverage": {"inventory":"sec-deep/inventory.json","hunters":["sec-deep/hunter-api.json"]},
  "candidates": [{"temp_id":"C1","title":"owner guard","path":"src/auth.js","line":10,"severity":"HIGH","confidence":"high"}]
}
```

Bind inventory, hunters and candidates. The candidate set must exactly match hunter findings, excluding temporary IDs; only identical content can be deduplicated. Do not discard a hunter candidate before the panel. Get each candidate hash using `pack-state candidate-hash`. Votes at `votes/C1-REACHABILITY.json` (and IMPACT/DEFENSES) contain:

```json
{
  "run_id":"same run",
  "snapshot":"same snapshot",
  "candidate_hash":"hash returned by helper",
  "lens":"REACHABILITY",
  "verdict":"TRUE_POSITIVE",
  "reasoning":"source/guard/sink trace read from code",
  "cited_paths":["src/auth.js:10"]
}
```

Verdicts are TRUE_POSITIVE/FALSE_POSITIVE/INCONCLUSIVE. Inconclusive blocks verification and must be completed, never counted as a refutation. Coverage is `verified` or `not_applicable` only after complete inventory/hunters, with run/snapshot and hashes of every candidate, inventory, hunter and vote input. Gates recheck those hashes even without rerunning the tally. Failed attempts go to attempts.json and stderr/exit nonzero. A previous verified file may remain as history, but the pack is incomplete until that stage succeeds again.

## Implementation evidence

`pack-state record` captures command argv, exit_code, output log/hash, run/snapshot, finding-content hash and sequence. Bug requires red before green, characterization before/after, deps/check one successful check. GREEN/after/check must match current snapshot; before/red preserve their earlier snapshot. Logs must remain byte-identical; materially changed finding content requires new validation/review. Commands run in the source root, without shell expansion; use an explicit interpreter only for authorized commands.

Review file for `attest --kind review`:

```json
{"status":"PASS","reason":"Reviewed diff, deny paths and assertions; reviewers inline because only one worker was available","findings":[]}
```

A listed finding must be resolved or explicitly accepted; do not accept HIGH on behalf of the user. Docs file:

```json
{"status":"NOT_APPLICABLE","reason":"Internal refactor; existing public behavior and contract unchanged"}
```

Or PASS with reason pointing at the updated canonical document. Attest binds exact bytes and current snapshot. No fixed SDD layout or Graphify output is required. These local records are integrity checks and explicit attestations, not cryptographic proof that a model or human did the review.

## Dependency policy

Use project `.ultra-deep-audit/dependency-policy.json` or explicit `--policy FILE`. The bundled file is an empty example, never an automatic application policy. JSON fields `docker` (per registry/image LTS policy) and `release_managed_images` (explicit image/build/source mappings) retain their scanner semantics. A policy loaded from `.claude/skills/...` in v1 must be moved explicitly to the project path; no silent fallback. The scan records policy source and SHA-256. Missing explicit policy, expired rules, unresolved versions and network errors remain visible/incomplete.


## Base, dependencies and concurrent publication

Delta requires a Git HEAD and a resolvable commit base with a common ancestor. Default
base search is main/master/origin/main/origin/master. An explicit invalid base fails
before any pack is created; full can audit a non-Git corpus without a base. Metadata
stores base and base_commit so the chosen ref is not silently replaced.

Dependency coverage requires root, packages and runner_errors arrays plus nonnegative
integer checked/outdated/up_to_date/errors counts matching the package rows. Missing
fields, skipped/error rows, runner errors and count mismatches keep the audit incomplete.
The real scanner may legitimately report zero packages with all four counts zero.

All publishing CLIs acquire `.pack.lock` before reading mutable state. Concurrent
writers fail visibly and should retry after the owner exits. Sync's child renderers
inherit the same owner token; standalone renderers also acquire the lock. Normal exit
removes only the matching owner's lock. An abnormal death leaves it fail-closed: stop
other writers, inspect owner PID, confirm the process is dead, then archive/remove that
specific lock. Never remove a live/unknown lock or recover solely because time elapsed.
Writes are atomic per file, not a multi-file transaction; gates detect inconsistent
bindings after interrupted publication and require regeneration.

# Ultra remediation — UD-01 through UD-11

Ownership stayed in `ultra-deep-audit/**`; no commit, push, production or registry calls. Version 2.0.0 / schema 2 is documented in SKILL.md and references/pack-schema.md. Legacy reports remain unverified; a new run and regenerated evidence are required for trusted closure.

## Corrections

- UD-01/07: panel validates all candidates and three votes, identity/lens/hash and completeness. UNKNOWN/INCONCLUSIVE/missing votes fail, preserve prior findings and record failed attempt. Empty candidate list succeeds only with complete inventory/hunters and exact reconciliation against hunter findings. Coverage retains hashes of all input/vote files; gate revalidates them without a new tally.
- UD-02/03: strict agent schema (array/envelope/single object), expected roster, matching agent identity, duplicate-ID rejection and reserved generated IDs. Bad input preserves prior aggregate. Output writes use temporary file + rename.
- UD-04: unique run directories, root/branch/content snapshot, explicit artifact bindings, merge input provenance and candidate identity. Remerge keeps IDs/dispositions/history; disappeared findings remain pending explicit disposition. A newly bound producer invalidates the prior aggregate until merge. Changed finding content invalidates its implementation evidence.
- UD-05: persisted block policy survives close/reopen; report counts open blockers separately.
- UD-06: audit and implementation states are separate and recomputed from current inputs. `--done` requires real recorded execution appropriate to change type, current review/docs attestations, complete audit and intact logs. Unknown IDs/legacy mutation are rejected. Refresh does not convert manually modified FINDINGS into trusted aggregate.
- UD-08: scoped directories traverse real source, dedupe files and report invalid scopes/unreadable or oversized files; strict refuses incomplete coverage.
- UD-09: dependency errors/skips and package names are visible in DOM/markdown; no false all-up-to-date claim. Scanner error status remains nonzero.
- UD-10: removed Prontyx-specific architecture/classes/framework versions/SDD paths and mandatory Graphify. Audit-only stays read-only on product. Bug uses RED/GREEN; refactor characterization; docs/check and deps compatibility checks. Review roles can be sequential/inline with limits declared.
- UD-11: neutral bundled policy; explicit `--policy` or project `.ultra-deep-audit/dependency-policy.json`, source/hash recorded. APP_VERSION alone no longer exempts images. Original app-specific integration tests are preserved behind explicit ULTRA_PROJECT_ROOT with visible SKIP, not silently passing.

## Independent pass follow-up

The separate Deep owner tested Ultra independently using `/tmp/ultra-forward-independent.mjs`. Clean audit, remerge/resume, real RED/GREEN+attest+closure, same-day unique runs, and deleted-vote invalidation passed. Three additional issues were reproduced, regressed and corrected:

1. Partial dependency report `{summary:{errors:0}}` could claim complete. Coverage now requires real package/runner arrays, canonical root, four numeric counts and exact row/count consistency. A real zero-dependency scanner run still succeeds.
2. Invalid `--base` could create a completed delta run. Init now checks Git HEAD, commit resolution and common ancestry before creating any pack. Delta requires a base; default main/master/origin/main/origin/master; non-Git explicitly uses full.
3. Concurrent bind writers could both exit0 and lose one binding. All publishing CLIs now acquire an exclusive per-pack lock before reading mutable state; unrelated writers fail busy and can retry, sync child renderers inherit ownership. The forced-overlap regression verifies both bindings survive a retry. Normal exit releases only the matching owner. No automatic stale-lock deletion; recovery procedure documented.

Independent revalidation after the fixes: **PASS** from the Deep owner. Evidence: `/tmp/ultra-forward-revalidation.mjs` and `/var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/ultra-independent-forward-UBsMi5/results.json`. It reconfirmed the real audit/fix/remerge/new-run flow, deleted-vote invalidation, malformed deps refusal, valid empty scanner acceptance, invalid base refusal and concurrent lock-busy/retry preserving both bindings.

## Evidence

- `/tmp/ultra-regressions-red.log`: five behavioral regressions failed on the old implementation (invalid aggregate replacement, direct object output, ID collision, directory scope, false legacy COMPLETE).
- `/tmp/ultra-regressions-first-green.log`: same five passed after correction.
- `/tmp/ultra-hunter-coverage-red.log`: dropping a hunter candidate to create an empty panel failed as a new regression before its correction.
- `/tmp/ultra-last-flow.log`: 14/14 lifecycle/forward tests passed after candidate reconciliation, vote hash validation, merge provenance and agent-identity checks.
- `/tmp/ultra-suite-final.log`: full suite before the last merge-provenance regression: **82 tests, 54 passed, 0 failed, 28 explicitly skipped**.
- `/tmp/ultra-suite-release.log`: 83 tests, 55 passed, 0 failed, 28 skipped before the independent feedback.
- `/tmp/ultra-independent-regressions-red.log`: all three independent repros failed as new behavioral tests on the prior code (partial dependency report, invalid base, concurrent lost update).
- `/tmp/ultra-independent-regressions-green.log`: the same three passed after correction.
- `/tmp/ultra-suite-release-final.log`: final full suite **86 tests, 58 passed, 0 failed, 28 explicitly skipped**; Node network APIs disabled by `/tmp/review-ultra-netguard.cjs`.
- `git diff --check -- ultra-deep-audit`: clean.

The forward test executes real Git and Node in an isolated fixture: cart quantity bug, failing test, fix, passing test, second documentation check task, recorded review/docs, closure/HTML, remerge preserving resolutions, reopen restoring blocker, changed log invalidating closure, second run on the same day. Fixtures are removed after tests. Additional cases cover stale vote/candidate/run, missing hunter, empty clean scan, malformed/missing roster, duplicate/unknown IDs, scope directories, DOM dependency errors, policy discovery and characterization with N1 IDs.

## Limits

28 original project integrations were **not executed**: 1 real pom contract, 12 ci-local contracts, 15 runtime-image supply-chain contracts. They require a separately inspected project root and are explicitly marked SKIP. Hermetic instrument tests run without them; no Docker/Trivy/registry/browser/production verification is claimed. Rendered JS is tested in a DOM fixture, not visual layout.

Hashes provide local integrity and provenance, not signatures proving a human/model independently reviewed code. `bind`/review/docs are explicit local attestations. Source snapshots exclude run artifacts, common build outputs and Git-ignored untracked files; they include tracked/untracked source and branch. Commands are executed without shell expansion and log results; the operator still must judge whether a RED was the intended failure. Atomicity is per file; failed/inconsistent intermediate states remain incomplete and can be rebuilt. No guarantee against arbitrary manual fabrication of every pack record is claimed.

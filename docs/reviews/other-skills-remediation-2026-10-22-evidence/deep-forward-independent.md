# Deep Audit — independent forward pass

Result: **PASS for the exercised workflow; no new reproducible finding**. Read-only on `deep-audit/**`: no source or permanent test edits. The test was derived from current `SKILL.md`, `references/pack-contract.md` and CLI implementations, not from the implementation author's expected-test assertions. All fixture writes stayed in temporary directories. No network/live apps/production, commit/push to harness, registry access or browser automation occurred.

## Evidence and reproduction

- Run `node /tmp/deep-forward-independent.mjs`. The script builds a fresh Git/Node cart project on `feature/cart`, then runs 71 real CLI invocations. Log: `/tmp/deep-forward-independent.log`.
- Preserved result: `/var/folders/0z/c5nklh457hbfkp524n88czhc0000gn/T/deep-independent-forward-lnv3L8/results.json` (commands, exits, stdout/stderr and pack paths).
- Additional genuine zero-surface fixture: `node /tmp/deep-zero-forward.mjs`, 10 real CLI invocations on a separate pure-addition module and dependency-free manifest. Results `/tmp/deep-zero-forward-results.json`; log `/tmp/deep-zero-forward.log`. This separate fixture is the evidence for legitimate no-attack-surface completion. The first script's zero-envelope portion only exercised schema acceptance and is not claimed as semantic coverage of its unsafe-order fixture.
- Node subprocesses used `/tmp/review-ultra-netguard.cjs` to reject http/https/fetch/socket connections. Git operations were local.

## What actually passed

1. Full run scoped to classic_bugs plus mandatory deps: initialize, source snapshot, Artemis result, real empty dependency scanner, complete stages, merge, audit gate and HTML/markdown generation. Open HIGH allowed audit completion but blocked closure.
2. Malformed producer object caused nonzero merge, preserved prior FINDINGS byte-for-byte and invalidated audit gate. Restoring current valid producer recovered it. Direct done without proof was rejected.
3. Quantity bug was reproduced by a real failing assertion (`5*3 + 2*2 = 19`); implementation was changed, test passed and old source evidence became stale. New snapshots/stage results restored coverage.
4. A real reversal-proof worktree ran GREEN → reverted RED → restored GREEN using the baseline commit. Product source remained byte-identical before/after the proof. Recorded test command and synthetic vote files passed the review protocol; done/closure then succeeded.
5. Remerge retained resolved status and valid evidence. Deleting a QUALITY vote immediately blocked closure; reapuration replaced prior approved with invalid. Restoring the vote and reapurating recovered closure. Reopen blocked closure and valid reclose succeeded.
6. Explicit resume preserved run identity. A second run on the same day used a unique directory. New Git HEAD invalidated both resume and prior closure. Invalid base ref was rejected.
7. Security inventory declared an order-authorization hunter. Dropping its real candidate from candidates.json prevented completing hunter coverage. Proper reconciliation plus three fixture votes passed panel/stage/audit gates. UNKNOWN vote rejected tally, preserved prior findings and blocked gate; restoring a valid vote recovered it.
8. Partial dependency document `{summary:{errors:0}}` could not complete deps. The actual dependency-free scanner output could.
9. Separate arithmetic-only repository completed zero-candidate security using explicit complete inventory, `no_attack_surface:true`, concrete reason and no invented hunter. Real deps scan and audit gate passed.

## Limits

The votes are **synthetic instrument fixtures**, clearly labeled as such. They test tally/provenance/closure behavior; they do not claim three independent agents reviewed a product, nor that any real application is secure. The mathematical regression and worktree reversals actually executed. HTML existence and generated content were checked; browser layout/interactions were not exercised in this pass. No registry integration or live external dependency tool was exercised. This pass did not repeat the author's crash/SIGKILL matrix; that has separate implementation-owner evidence. Scripts/results and isolated repositories remain in OS temporary storage for inspection, not in the harness repository.

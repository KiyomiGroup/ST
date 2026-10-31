# Didit verification: stage breakdown sized to fit one AI session (read this right after didit-00)

This file REPLACES the six-row table in section 6 of `didit-00-assessment-and-plan.md`. Section 6 of that file is the summary; this file is the working plan. Everything else in didit-00 (findings F1-F9, design, decisions D-V1..D-V8) still stands.

## 0. Why this exists
A single "do V2" or "do V3" session reads many files, writes several, and can run out of room before it finishes, leaving half-written code and no record of what is done. Every stage below is small enough to finish inside one session with room to spare. If a stage still turns out too big, the AI divides it further (section 3) BEFORE writing code.

## 1. Standing rules for every session (carry these into every stage)
1. SQL editor and dashboard deploys only (no console, no curl). Deliver changed files only.
2. Never claim a test passed, SQL applied, or a verification worked unless it really happened. Say "not run" instead.
3. No secrets in the browser. Never hardcode credentials. Never log `session_token`, API keys or webhook secrets.
4. Follow `AGENTS.md`. For any `.html`/`.css`/inline style change run `node tools/check-design-system.js`; it must pass. Never edit `tools/design-baseline.json` to make it pass.
5. Do not deploy or activate live verification without the owner's written approval.
6. Stay in scope: touch only the files the stage lists. Remove nothing. Do not redesign unrelated pages.
7. Do not read the whole repo. Read only the files in the stage's "Read" list, and for large files read just the part you need (Grep, or Read with offset and limit).
8. Do not start a stage whose "Needs" are missing. Say what is missing and stop.

## 2. Session protocol (the same for every stage)
**Start**
1. Read `HANDOFF-README.md`, then this file's section for your stage, then the previous stage's handoff note (`docs/verification/handoffs/didit-<prev>.md`) if one exists.
2. Read only the stage's "Read" list. Skip `DESIGN-SYSTEM.md` unless the stage touches UI (it is 25 KB).
3. Run the size gate (section 3). If it fails, split and stop.
4. Tell the owner in one sentence what you are about to do.

**During**
5. Work one deliverable file at a time. After each file is written, append one line to the stage's handoff note (file, what it does, what is still untested). This is the checkpoint: if the session ends suddenly, the next session continues from it.
6. Keep narration short. Do not paste whole files back into the chat; write them to disk.

**Finish**
7. Run the stage's exit check. Report the result honestly (passed / failed / not run, and why).
8. Write `docs/verification/handoffs/didit-<stage>.md` (one page maximum): done, files created or changed, exit check result, open issues, exact next stage and what it needs from the owner.
9. Add one row to `docs/local-tasker/IMPLEMENTATION-STATUS.md` (Didit section) and update nothing else in it.
10. Deliver changed files only, plus the stage note. Stop.
11. OWNER RULE (2026-10-30): at the end of EVERY stage, also build a zip of the whole package as it now stands (everything under the package root: HANDOFF-README.md, docs/, sql/, supabase/, context-snapshot/), named `ST-Didit-Verification-Handoff_<stage>-complete.zip`, with HANDOFF-README.md updated first (State, Done so far, Next stage, Needs from owner). A fresh AI must be able to continue from that zip alone. Send it with the stage files. Do not begin the next stage in the same session unless the owner says "go".

**If you are running out of room mid-stage:** stop writing code. Write the checkpoint (what is finished, what is half-done, which file and line you stopped at, what remains), tell the owner plainly that the stage must be split, and propose the split (section 3).

## 3. Size gate: divide further if the stage is still too large
Before writing any code, estimate the stage. It is TOO LARGE if any one of these is true:
- it needs more than about 4 files read in full, or more than about 60 KB of reading in total;
- it creates or rewrites more than 2 deliverable files, or one file longer than about 300 lines;
- it mixes layers (for example SQL and an Edge Function, or an Edge Function and the page);
- its exit check needs more than one kind of test;
- you cannot describe it in two sentences.

If it is too large:
1. Split it into sub-stages named by adding a letter or digit (for example `V2b` becomes `V2b-1` and `V2b-2`). Cut along a seam that leaves each part testable on its own: one function, one file, one mode of the page, one test group.
2. Write the split into section 4 of THIS file (new rows, same columns: Read, Writes, Needs, Exit check). Do not delete the parent row; mark it "split into ...".
3. Apply the size gate again to each new row. Keep dividing until every row passes.
4. Tell the owner the new stage names, then start only the first one (or stop for the owner's "go" if the owner asked for that).

Any session that discovers a split must record it here, so the next session sees the current plan.

## 4. Stage table
Sizes of the files you will read are in section 5. "Needs" are things only the owner can supply.

### V0 follow-up (owner, not an AI session)
| ID | What | Needs |
|---|---|---|
| V0.1 | Run introspect blocks 1 to 6 in `sql/verification/didit-v0-introspect.sql` and send each CSV. Block 7 is already done (section 6). | owner |
| V0.2 | Answer D-V1..D-V8 in didit-00 section 5 (a one-line answer each, or "take the default"). | owner |
| V0.3 | Create a Didit SANDBOX application. Do not send secrets in chat; they go into Supabase secrets at V2e. | owner |

### V1: database (SQL only, tested on a scratch Postgres, applied to staging first)
| ID | Read | Writes | Needs | Exit check |
|---|---|---|---|---|
| V1a Tables and RLS | didit-00 section 4 (tables); introspect CSVs 1, 2 | `sql/verification/v1a-tables.sql` + rollback `v1a-rollback.sql` | V0.1, V0.2 | applies and rolls back cleanly on scratch Postgres; RLS on; partial unique index rejects a second open row; browser roles cannot insert, update or delete |
| V1b-1 Status transition core | didit-00 section 4 (status map, out-of-order rule); `DIDIT-API-FACTS.md` (status strings) | `sql/verification/v1b1-idv-apply-core.sql` | V1a applied | table-driven test: every Didit status maps right; stale event ignored; terminal states only left by Resubmitted, Kyc Expired or a new session; duplicate `event_id` is a no-op |
| V1b-2 Side effects | introspect CSVs 1, 3, 5, 6; `context-snapshot/sql/local-tasker/stage-4c1-core.sql` (grep `verification_method`, `verified_at`) | `sql/verification/v1b2-idv-apply-effects.sql` | V1b-1 applied | VERIFIED sets the flags on `users`, `taskers` and (local) `local_tasker_profiles`; Kyc Expired clears them; audit row and notification row written; nothing is set for any other status |
| V1c Start and read functions | didit-00 section 4 (functions); `context-snapshot/sql/local-tasker/stage-2d-core.sql` (consent pattern) | `sql/verification/v1c-idv-start-read.sql` | V1b-2, D-V4, D-V6 | a user reads only their own row; a coordinator reads only assigned Local Taskers; consent row is required before start; no scores or images returned |
| V1d Lock down browser writes (F1) | introspect CSVs 2, 3, 4; didit-00 F1 | `sql/verification/v1d-lockdown.sql` + rollback | V1c; owner OK | an authenticated test user's UPDATE of `is_verified` / `verified_at` / `verifications.status` is refused; existing reads still work |
| V1e Scratch-DB test run | all V1 files | `sql/verification/v1-tests.sql` and a results note | V1a to V1d | every test above is run and the output is pasted into the note |
| V1f Old data (D-V2) | CSV 7 (section 6) | `sql/verification/v1f-old-id-numbers.sql` + rollback | D-V2 answered; owner OK | dry-run count matches section 6 (8 rows); nothing deleted until the owner runs the real step |

**Plan changes from the owner's answers (2026-10-30, see `docs/verification/DECISIONS.md`):**
| ID | Read | Writes | Needs | Exit check |
|---|---|---|---|---|
| V1f (REVISED) Old data | block 7 CSV | `sql/verification/v1f-old-id-numbers.sql` + rollback | owner OK; Q3 | dry run lists the rows that would lose `id_number` (8 rows); the two test accounts are untouched; nothing changed until the owner runs the real step |
| V1g Re-verification gate (NEW) | DECISIONS.md Q1 to Q5; `process_verification` source (block 5) | `sql/verification/v1g-reverify-gate.sql` + rollback; list of users to email | Q1 to Q5 answered; V1c | existing users (except the two test accounts) are marked "must re-verify"; blocked from every action but verification until VERIFIED; the two test accounts are not blocked. The re-verification EMAIL needs a sender that is not yet identified (Q5) |
| V6 Customer flow (NEW) | V1 to V3 outputs | second Didit workflow (lighter ID + proof of address), customer branch of the page, "task goes live only when verified" | V3 working for taskers; owner creates the customer workflow in the Didit console | customer cannot publish a task until VERIFIED |

V1a result: DONE on scratch Postgres (51 of 51 checks), see `didit-V1a.md`. V1b to V1d are unblocked.

### V1c split (size gate, recorded 2026-10-30)
V1c as one stage mixes consent tables, a constraint change on an existing table, write functions and read functions: too large. Split:
| ID | Read | Writes | Needs | Exit check |
|---|---|---|---|---|
| V1c-1 Consent | `stage-2d-core.sql` (consent pattern), `results/v1b2-block2-constraints.csv`, `v1b2-block1-functions.csv` (guard + audit source) | `sql/verification/v1c1-consent.sql` + `v1c1-rollback.sql` + `v1c1-scratch-standins.sql` + `v1c1-tests.sql` | V1b-2 | purpose list gains `identity_verification`; self consent table + functions; coordinator records proxy consent only for an assigned Local Tasker; `idv_has_consent` (server) true only for a current, un-withdrawn consent; browser roles cannot touch the tables |
| V1c-2 Start and read | V1c-1 note; `didit-00` section 4 (functions) | `sql/verification/v1c2-idv-start-read.sql` + rollback + tests | V1c-1 | a user reads only their own status; a coordinator only assigned Local Taskers; start refused without consent; no scores or images returned; no way to set VERIFIED or flags |

V1c-1 result: DONE on scratch Postgres (68/68), see `didit-V1c1.md`. V1c-2 result: DONE on scratch Postgres (108/108), see `didit-V1c2.md`. Unblocked now: V1d (needs owner OK), V1g, V2b, V2c.

### V2: Edge Functions (Deno)
| ID | Read | Writes | Needs | Exit check |
|---|---|---|---|---|
| V2a Signature module | `DIDIT-API-FACTS.md` (webhook section) | `supabase/functions/_shared/didit-signature.ts` + `didit-signature.test.ts` | none | tests with made-up secrets: valid passes; wrong secret, tampered body, stale timestamp, whole-number float, nested keys and Unicode cases behave per the facts file |
| V2b Webhook | V2a; V1b outputs (function names only) | `supabase/functions/didit-webhook/index.ts` | V2a, V1b-2 | tests with fake events: bad signature 401; wrong environment ignored; duplicate `event_id` returns 2xx and changes nothing; DB failure returns 500; `Approved` triggers a decision re-fetch (stubbed) |
| V2c Create session | `context-snapshot/supabase/functions/local-tasker-create/index.ts` (pattern); V1c function names | `supabase/functions/didit-create-session/index.ts` | V1c, V2a | tests with a stubbed Didit: self mode and proxy mode derive `vendor_data` on the server; a user id sent from the browser is ignored; Didit 403 becomes a generic user message; token never logged |
| V2d Sync | V2b and V2c (only the shared helpers they use) | `supabase/functions/didit-sync/index.ts` | V2b, V2c | a user can sync only their own session; a coordinator only for an assigned Local Taskers; goes through the same apply function |
| V2e Deploy runbook | V2b to V2d file names | `docs/verification/DEPLOY-FUNCTIONS.md` | owner has the sandbox key, workflow id, webhook secret | steps listed for secrets (`DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_ENV`), Verify JWT ON for create and sync, OFF for webhook, webhook destination setup; owner runs it, the AI does not claim it worked |

V2b result: DONE on Node with stubbed fetch (29/29; Deno and Didit not run), see `didit-V2b.md`.

V2c result: DONE on Node with stubbed fetch (22/22; Deno and Didit not run), see `didit-V2c.md`. NOTE: customers cannot start until the V6 customer workflow exists, so V1g must not gate customers before V6.

V2d result: DONE on Node with stubbed fetch (26/26; Deno and Didit not run), see `didit-V2d.md`. Builds `didit-sync/index.ts`, `handler.ts`, `handler.test.ts` (three files, like V2c).

V2e result: DONE (runbook written, never followed; bundles 29/29, 22/22, 26/26), see `didit-V2e.md`. Writes also `supabase/deploy/*/index.ts` and `build-bundles.mjs`.

### V3: verification page (all UI work follows `AGENTS.md`; read `DESIGN-SYSTEM.md` in these stages only)
| ID | Read | Writes | Needs | Exit check |
|---|---|---|---|---|
| V3a Markup and messages | `context-snapshot/verify.html`; `DESIGN-SYSTEM.md`; reference screens | `verify.html` (structure, six verbatim status messages, consent block, no behaviour) | D-V1, D-V4, D-V8 | `node tools/check-design-system.js` passes; page renders at desktop and mobile widths; no claim from didit-00 F5 appears |
| V3b Self mode behaviour | V3a; `context-snapshot/js/verify.js` (read in two parts); V1c, V2c names | `js/verify.js` (self mode: read status, consent, start, redirect, resume, retry). Remove the browser-side approval fallback | V2c | nothing in the file writes `is_verified` or `status`; success is shown only from the server read; sandbox run (owner) |
| V3c Proxy mode | V3b; `context-snapshot/js/coordinator-tasker.js` (grep how a coordinator opens a tasker) | proxy branch in `js/verify.js`; link or QR entry from the coordinator page (a few lines only) | V3b, V2c | coordinator can start verification only for an assigned Local Tasker; consent method and `recorded_by` captured |
| V3d Publish gating | `context-snapshot/js/verify.js` (`_publishDrafts` part only); D-V6 | change so drafts publish only after the server says VERIFIED (or move server-side if D-V6 says so) | V3b, D-V6 | an unverified user cannot publish through the page; existing drafts are not deleted |

V3b result: DONE on a fake DOM (15/15; design check passed on a copy of the repo; rendered at 2 widths; not run against real Supabase, Didit or deployed functions), see `didit-V3b.md`. Writes `pending-ui/js/verify.js`, edits `pending-ui/verify.html` and `pending-ui/css/verify.css`, adds `docs/verification/CONSENT-WORDING.md` and `tests/verify-page.test.mjs`.

V3a result: DONE (markup + css/verify.css written to `pending-ui/`; structural checks pass; design check and rendering NOT run, tool/CSS absent), see `didit-V3a.md`.

### V4: coordinator side
| ID | Read | Writes | Needs | Exit check |
|---|---|---|---|---|
| V4a List | `context-snapshot/coordinator-taskers.html`, `js/coordinator-taskers.js` | status column, filter, "Start or resend verification" | V1c, V3c | list shows NOT_STARTED, in progress, pending, completed with date, needs-review flag; no "mark verified" control anywhere |
| V4b Profile card | `context-snapshot/coordinator-tasker.html`, `js/coordinator-tasker.js` (grep `coFactsVerify`) | replace Method / Verified on / Notes with real status, completion date, review flag | V4a | design check passes; old fields no longer shown as if they were results |
| V4c Notifications | `context-snapshot/js/notifications-panel.js`; introspect CSV 1 (notifications) | wording/rows for status changes | V1b-2 | one notification per real status change; none for duplicates |

### V5: test and go-live
| ID | Read | Writes | Needs | Exit check |
|---|---|---|---|---|
| V5a Test matrix | `DIDIT-BRIEF.md` (phase 8) | `docs/verification/TEST-MATRIX.md`: one row per case (success, failure, face mismatch, failed liveness, incomplete, pending, delayed webhook, duplicate webhook, invalid signature, Didit down, cross-user read, coordinator start, normal and local flows, desktop and mobile) with how to run it in the sandbox | V2, V3 deployed to staging | every brief case has a row; none marked passed |
| V5b Run and record | TEST-MATRIX | results column filled by the owner (the AI helps interpret, never invents results) | sandbox | each row passed, failed or not run, with date |
| V5c Go-live runbook and final report | all stage notes | `docs/verification/GO-LIVE.md` and the final report in the format at the bottom of `DIDIT-BRIEF.md` | V5b | report lists built, modified, created, DB changes, env vars, dashboard steps, webhook config, tests with results, open issues, exactly what the owner does to go live. Live activation only after the owner's written approval |

## 5. Reading budget (sizes in this package)
| File | Size | Used by |
|---|---|---|
| `DESIGN-SYSTEM.md` | 25 KB | V3a to V3c, V4a, V4b only |
| `context-snapshot/verify.html` | 23 KB | V3a |
| `context-snapshot/js/verify.js` | 11 KB | V3b, V3d |
| `context-snapshot/js/coordinator-tasker.js` | 13 KB | V3c, V4b |
| `context-snapshot/js/coordinator-taskers.js` | 5 KB | V4a |
| `context-snapshot/js/notifications-panel.js` | 13 KB | V4c |
| `context-snapshot/sql/local-tasker/stage-4c1-core.sql` | 16 KB | V1b-2 (grep only) |
| `context-snapshot/sql/local-tasker/stage-2d-core.sql` | 9 KB | V1c |
| `context-snapshot/supabase/functions/local-tasker-create/index.ts` | 10 KB | V2c |
| `docs/local-tasker/IMPLEMENTATION-STATUS.md` | 38 KB | do NOT read whole: read only the Didit section and the last-session note |
| `didit-00-assessment-and-plan.md` | 18 KB | every stage reads sections 3 to 5 once, not the rest |
| `DIDIT-API-FACTS.md` | 8 KB | V1b-1, V2a to V2d |

## 6. Result already received: introspect block 7
`sql/verification/results/block7-verifications-by-status.csv`:
| status | rows_total | rows_with_id_number |
|---|---|---|
| approved | 6 | 6 |
| rejected | 2 | 2 |

All 8 existing rows hold a raw ID number (F2). The set is tiny, so V1f is a small, reversible step. This does not answer D-V2: the owner must still decide. Blocks 1 to 6 have NOT been received; V1a, V1b-2, V1c and V1d cannot start without them.

## 7. Copy-paste start prompt for any stage
> Read `HANDOFF-README.md`, then `docs/verification/handoffs/didit-01-stage-breakdown.md`. Do stage **<ID>** only. Follow the session protocol (section 2) and run the size gate (section 3) first; if the stage is too large, split it, record the split in section 4, and tell me before writing code. Finish with the stage note and stop.

# Local Tasker: implementation status

Update this file at the end of every stage. Status values: Not started, In progress, Blocked, Written (not applied), Applied on staging, Verified, Done.

| Stage | Title | Size | Needs reference screen | Status | Handoff / notes |
|---|---|---|---|---|---|
| 1A | Repo and schema audit | S (read-only, no code) | No | Done | handoffs/stage-01a.md; audit complete, classification answered: ADD new tables |
| 1B | Money, escrow, chat, and Edge Function audit | S (read-only, no code) | No | Done | handoffs/stage-01b.md; money, release, webhook and 12% audited from source |
| 1C | Architecture plan and owner decisions | S (documents only) | No | Done | handoffs/stage-01c.md; DECISIONS.md and implementation-plan.md written |
| 2A | Coordinator role, Local Tasker flag, assignments, 10-cap | M (SQL only) | No | Applied (owner ran it; reported correct) | handoffs/stage-02a.md |
| 2B | Audit log, consent records, and security helper functions | M (SQL only) | No | Applied (owner ran it; reported correct) | handoffs/stage-02b.md |
| 2C | RLS for existing tables and the public marketplace view | M (SQL only, high care) | No | Applied (owner ran `stage-2c-rls.sql`; reported successful) | handoffs/stage-02c.md; the AI did not observe the output |
| 2D | Local Tasker account creation (no-login identity) and coordinator creation function | M (SQL plus one Edge Function) | No | Applied (SQL run by owner, tests run; Edge Function deployed). End-to-end Edge call UNVERIFIED | handoffs/stage-02d.md; first live call happens in 4A (needs 3A); see section 16 |
| 3A | Coordinator sign-in, route guard, dashboard shell | M | Yes | Written (not yet used against real Supabase); browser-tested with a MOCKED Supabase only | handoffs/stage-03a.md; no SQL; owner check in section 8 of the handoff |
| 3B | Coordinator overview (real data) | S | Yes | Written (not yet used against real Supabase); browser-tested with a MOCKED Supabase only | handoffs/stage-03b.md; no SQL; booking metrics wait for 5A/5B (coordinators have no booking access yet) |
| 4A-1 | My Local Taskers: read-only list and profile | M | Yes (owner: follow the design system) | Written (not yet used against real Supabase); browser-tested with a MOCKED Supabase only | handoffs/stage-04a-1.md; no SQL |
| 4A-2 | My Local Taskers: create form (first real Edge Function call) with consent, and audited edit | L | Yes (owner: follow the design system) | Not started; BLOCKED on 3 inputs | handoffs/stage-04a-1.md section 8 |
| 4B | Service listings and portfolio photos | L, split if needed | Yes | Not started | |
| 4C | Preview, publish, Local Tasker badge, marketplace, application block | M | Yes | Not started | |
| 5A | Booking assignment and Local Tasker booking state machine (SQL) | L (SQL only), split if needed | No | Not started | |
| 5B | Coordinator booking list and booking detail | M | Yes | Not started | |
| 5C | Tasker confirmation recording and quote breakdown | L, split if needed | Yes | Not started | |
| 5D | Customer quote approval, milestones, exceptions | L, split if needed | Yes | Not started | |
| 6A | Booking-specific coordinator thread (SQL and customer side) | M | Yes | Not started | |
| 6B | Coordinator chat and internal notes | M | Yes | Not started | |
| 7A | Local Tasker commission exemption | M | No | Not started | |
| 7B | Verified payout destination (bank details) | M | Yes | Not started | |
| 7C | Release to direct payout, webhook, idempotency, failures | L, split if needed | No | Not started | |
| 7D | Coordinator payments and records view | S | Yes | Not started | |
| 8A | Admin: coordinator approval, assignment, reassignment, deactivation | M | Yes | Not started | |
| 8B | Admin: audit viewer, disputes, payment issue handling | M | Yes | Not started | |
| 9A | Security and RLS test pack | M (SQL and checklist) | No | Not started | |
| 9B | End-to-end and regression testing, defect fixes | M | No | Not started | |
| 10 | Final handoff and deployment readiness | S (documents) | No | Not started | |

## Blockers
- Stage 4A-2 needs inputs from the owner (handoffs/stage-04a-1.md section 8): the `local-tasker-create` source, `stage-2d-core.sql`, and the output of `stage-4a-introspect.sql`.
- The owner has said later stages follow the brief and the existing design system; no reference screen is needed unless something cannot be decided from them.
- Carry-forward: the 2D Edge Function has never completed a real create (first attempt failed `identity_not_locked`; fix deployed, unexercised). 4A must prove it (see handoffs/stage-02d.md section 16).

## Decisions pending
Only defaults the owner may overrule: O3 (verification record location), customer-contact visibility, D13 (coordinator must be active to receive Local Taskers). See `DECISIONS.md`.

## Last session
Update 2026-10-26 (Stage 4A-1): built My Local Taskers list (search, status filter) and read-only profile page, real data under RLS; nav link live; Overview cards link to profiles. 68 browser checks pass with a MOCKED Supabase; nothing run against the real project. Create/edit (4A-2) is blocked on three inputs listed in handoffs/stage-04a-1.md section 8. Earlier notes follow.

Update 2026-10-26 (Stage 3B): Overview now reads real data (own active assignments, profiles of managed taskers): tiles, cards, loading/empty/error states. Booking metrics deliberately absent (no coordinator booking access until Stage 5). Fixed the coordinator sign-in message: a normal or unverified account is told it is not a coordinator and pointed to login/sign up. 47 browser checks pass with a MOCKED Supabase; nothing run against the real project. Next: owner signs in once (stage-03b.md section 8), then Stage 4A. Earlier notes follow.

Update 2026-10-26 (Stage 3A): built `coordinator-login.html`, `coordinator-dashboard.html` (shell, no real data), `components/coordinator-nav.html`, `js/coordinator.js` (route guard), `js/coordinator-login.js`, `css/coordinator.css`, `--co-*` tokens. No SQL: the guard uses the existing `is_active_coordinator()`, `is_coordinator()` and the `lt_coordinators_read` policy (confirmed from the owner's introspect export). 28 browser checks pass with a mocked Supabase; the real sign-in has not been run. Next: owner signs in once (handoff section 8), then Stage 3B. Previous session notes follow.

Update 2026-10-26: owner ran the fixed 2D SQL and deployed the fixed Edge Function; owner declined console/curl steps, so the live Edge test moves to 4A. Stage 2D written: server-only SQL `create_local_tasker` (one transaction: private profile draft, `users` + `taskers` rows without phone/whatsapp, active assignment with the 10-cap, consent, 2 audit rows, idempotency ledger), refuses any identity that could log in; Edge Function `local-tasker-create` (active-coordinator check, creates a locked placeholder Auth user: no password, `@local-tasker.invalid`, banned about 100 years). SQL tests pass on a scratch Postgres built from the owner's exported schema (NOT Supabase); nothing run in Supabase, Edge Function not deployed, no-login proof not run. Next: owner runs section 16 of the handoff; then Stage 3A (needs a reference screen). Standing owner instructions are at the top of `handoffs/stage-02d.md`.

# StreetTasker subscription overhaul: handoff (START HERE for subscription work)

(The older `HANDOFF-README.md` is the Didit identity-verification project. Do not mix the two. Never touch `verify*`, `didit-*`, `idv_*`.)

Work is split into small stages so no session runs out of room. Do ONE stage per session, then stop and wait for the owner's "go".

## Read in this order
1. This file, then **`docs/subscription/OWNER-RULE-NO-TOPUPS.md`** (short).
2. `docs/subscription/02-final-plan.md` (exact names, row order, SQL order; it overrides the stage table in `01-stage-plan.md`).
3. `docs/subscription/01-stage-plan.md`: findings F1-F13, standing rules, session protocol, size gate. Read only YOUR row plus sections 1-3.
4. The previous stage note in `docs/subscription/handoffs/` (now `sub-T1.md`, then `sub-S5b.md`).
5. `docs/subscription/DECISIONS.md` (owner answers D1-D12). `docs/subscription/00-owner-brief.md` only for requirement text (long; grep it).
6. `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md` before any page or style work.

## CURRENT STATE (updated in the S4f-1 session, 2026-11-04)
The owner said on 2026-11-03 that she did everything every earlier handoff asked and all of it succeeded. Individual results were sent for S2a to S3e only; for S3f, S3g and S5a the "applied" below rests on that general statement.

| Stage | State |
|---|---|
| S0, S1a, S1b, S1c | Done (plan, audits, final plan). No code. |
| S2a, S2b-1, S2b-2, S2c | Applied on production (S2c confirmed indirectly: S3a-1 works). |
| S3a-1, S3a-2 part 1, S3a-2 part 2 | Applied. The offer gate is ENFORCED: offers only through `submit_offer` / `edit_offer` / `withdraw_offer`. |
| S3b-1, S3b-2 | Deployed and tested by the owner (ten JS files). |
| S3c, S3e | Applied. S3d deployed. The S3e job is NOT scheduled; always preview `apply_due_subscription_changes(true)`. |
| S3f (label, ranking), S3g (activity) | Applied per the general statement. Tests pass on scratch Postgres 16. Nothing on a page uses them yet (S4h-S4j). |
| S5a (activation core) | Applied per the general statement. Its three read-only check results and the `_write_receipt` definition were not sent. Its wallet top-up check is WITHDRAWN (rule R-W). |
| S5b (`payment-init`) | **Deployed by the owner.** |
| **T1** (close the top-up) | **Deployed by the owner** ("T1 deployed", 2026-11-04). `payment-init` is S5b + T1; `supabase/deploy/payment-init/index.ts` is the source of truth. |
| **S5c-1** (`subscription_store_authorization`) | **Applied** (owner: "S5c-1 applied", 2026-11-04). |
| **S5c-2** (webhook saves the card) | **Deployed by the owner** ("S5c-2 deployed", 2026-11-04). 38 Node tests passed; the real card save is only provable in the Paystack TEST run (S7c). Source of truth `supabase/deploy/paystack-webhook/index.ts`. |
| **S4a** (membership label CSS) | **Written, tested.** Deployment is implied by the owner's standing convention below once she sends the next files without an error. |
| **S4b** (pricing page hero + cards) | **Deployed per the owner convention (2026-11-04).** Was: written, tested with stubbed Supabase. Owner copies 3 site files (`subscription.html`, `css/subscription.css`, `js/pricing-plans.js`). Paid buttons charge nothing until S5d sets `window.StPricing.onChoose`. `js/subscription.js` is now unused (delete in S4d). |
| **S4c** (comparison, why upgrade, visibility) | **Deployed per the owner convention (2026-11-04).** |
| **S4d** (FAQ, final CTA, retire `js/subscription.js`) | **Deployed per the owner convention (2026-11-04).** Owner was asked to delete `js/subscription.js` from the site. |
| **S4e** (My Subscription page, read-only) | **Written, tested with stubbed Supabase.** NOT in the owner's 2026-11-04 01:10 project export (so not deployed at that moment; the owner was told to copy the 5 files from `subscription-S4e.zip`). New `my-subscription.html`, `css/my-subscription.css`, `js/my-subscription.js`; edited `components/navbar.html` (two Subscription links now open it) and `js/pricing-plans.js` (the signed-in Free card's "Manage your plan" button is now shown). |
| **S4f-1** (manage-plan SQL) | **Written, 8 test blocks pass on scratch PostgreSQL 16. NOT applied on production.** `sql/subscription/s4f-manage.sql` (+ rollback + tests) creates `schedule_downgrade(p_plan)`, `cancel_subscription()`, `undo_cancel()`. They were named in `02-final-plan.md` but NO earlier stage created them (plan gap found in this session; S4f is split into S4f-1 SQL and S4f-2 page). |
| S4f-2 onward, S5d to S5g, S7 | Not started. S5d needs S4f-2 (manage actions on the my-subscription page). |

Owner answers (`DECISIONS.md`): D1 no subscribers, D2 saved-card auto renewal (Paystack only, R-W), D3 no admin in this project (`ADMIN-REQUIREMENTS.md` is the contract), D4 booking caps removed, D13 resolved. D5-D12 defaults stand; D14 optional.

ANSWERED 2026-11-04: the `taskers` mirror-row question: YES, hide a person whose listings are ALL paused (done in S4f-3 by triggers; S4i can rely on `taskers.available`). Still open from the owner: one privacy line for the S3g view counts, needed before S4h; whether job payment from a wallet balance (`pay_with_wallet`) should stay (only matters if something else credits a customer wallet).

Facts every later session needs:
- **`02-final-plan.md` overrides the stage table in `01-stage-plan.md`.** Use its exact table, function and notification names.
- **Edit only `js/db.js` and `js/auth.js`.** The root-level `db.js` and `auth.js` are dead copies.
- Payments: subscriptions are `payment_intents.purpose = 'subscription'` with `ST-` references. New `subscription_payment_prepare`; `payment_finalize` gets ONE added branch; receipts go in a new `subscription_receipts` table; edit `payment-init` and the DEPLOYED webhook (`docs/subscription/inputs/paystack-webhook-deployed.ts`, to store the card authorization); `payment-verify` unchanged.
- The urgent-task fee (`URG-` refs) is verified only in the browser (issue X1). Never reuse or imitate it; it is not part of this project.
- Offers: `submit_offer` / `edit_offer` / `withdraw_offer`; the browser-write revoke runs last, after the JS is deployed.
- Listings: `services.listing_status`; pausing also sets `available=false`.
- Labels and ranking (S3f): public `membership_for_users(uuid[])` (only people with a label or a boost are listed; Free/Starter never) and `featured_taskers(category, limit)` (fair rotation, Business first); boost <= 0.25 hard ceiling and 0 for flagged people; S4i must keep relevance on a 0 to 1 scale and only ADD `visibility_boost`; nothing returned carries price or payment data. Tuning settings: `boost_per_tier`, `featured_slots`, `featured_rotation_minutes`.
- Lifecycle (S3e): `apply_due_subscription_changes(p_dry_run default false, p_max default 500)` is service-role only; ALWAYS preview with `(true)` before a real run. Listings above a limit get a row in `listing_reduction_notices` and a `listings_will_pause` notification first; pausing happens only after its date (setting `listing_notice_days`). `_sub_pause_excess_listings(user, keep)` is the one place that pauses extras (S5a calls it after a plan switch; the `taskers` mirror-row decision, once answered, goes there and in `pause_service`). A scheduled downgrade to a lower PAID plan is applied by the renewal payment, not by the job; only downgrade-to-Free, cancel and lapse are applied by the job. The job sets `cancelled` / `expired`, never `past_due` (S5e does).
- Label comes from a server function, never from `taskers.subscription_plan`.
- Notifications: `_notify(...)` with `data.url = '/my-subscription.html'` (leading slash, or the email link ignores it), types `subscription_*`. Every notification row is emailed (confirmed from the owner's source), so avoid duplicates.
- `submit_offer(task, message, phone, whatsapp, client_request_id)` exists (S3a-1). Error codes are the exception MESSAGE (`offer_limit_reached`, `fair_use_daily`, `fair_use_monthly`, `already_offered`, `own_task`, `task_closed`, `not_a_tasker`, `local_tasker`, `task_not_found`, `request_id_reused`, `bad_request_id`, `message_too_long`, `bad_contact`, `not_signed_in`); `detail` is plain text. It already notifies the task owner (same type and data as `applyToTask`), so S3b must remove the JS notification.
- `edit_offer(application, message, phone, whatsapp)` (NULL keeps a value, blank clears it; pending only; consumes nothing; owner notified 'Offer Updated') and `withdraw_offer(application)` (pending -> `withdrawn`, row kept, no refund; a repeat on an already withdrawn offer returns `already_withdrawn: true` and notifies nobody) exist (S3a-2 part 1). Error codes (message): `not_signed_in`, `application_not_found` (also for someone else's offer), `offer_not_pending`, `message_too_long`, `bad_contact`, `local_tasker`. Both return jsonb `{ok, application_id, status}`. S3b must delete the JS notifications in `updateMyApplication` and `withdrawMyApplication` (the RPCs send them) and must keep building the stored `<pitch> | Proposed rate: ... | Arrival: ... | Proof: ...` message string in JS, then pass it as `p_message`. The RPC does not edit the rate separately.
- Design gate: the checker's only allowed failures are the three reference-copy lines in `frontend-audit.md` section 7.
- **Owner rule R-W (2026-11-03): no user top-ups. A subscription is paid ONLY through Paystack; wallet money can never pay for a subscription.** Read `docs/subscription/OWNER-RULE-NO-TOPUPS.md` before any payment, checkout, renewal, refund or pricing-text work.
- S5a (applied): `subscription_payment_prepare(user, plan)` (server only), `_apply_subscription_payment`, `get_subscription_quote(plan)` (browser: what a payment would be, so the page can show the credit), `payment_finalize` with ONE added branch for `purpose = 'subscription'`. Refusals raise P0001 with the reason in the HINT. A payment that arrives but cannot activate the plan becomes `failed` with `needs_review: true` (money received, plan unchanged, a person decides, refund through Paystack only).
- S5b (deployed): `payment-init` accepts `{purpose: 'subscription', plan}` and reads nothing else from the browser; it answers the old fields plus `plan, planName, kind, fromPlan, priceKobo, creditKobo, netKobo, periodStart, periodEnd` (`amountKobo` is the NET amount for the Paystack pop-up); refusals are `400 {error, reason}`. Source of truth for the deployed function: `supabase/deploy/payment-init/index.ts`. `payment-verify` is unchanged and finalises subscription references through `payment_finalize`.
- T1 (deployed): `payment-init` refuses `topup`; the deployed source of truth is still `supabase/deploy/payment-init/index.ts` (S5b + T1). What T1 left alone (job payment from wallet balance, the unreachable top-up branch in `payment_finalize`, gift-card wording) is listed in `handoffs/sub-T1.md`.

- S4f-3 (written, not applied): `sql/subscription/s4f3-hide-paused.sql` (+ rollback, tests, scratch stand-ins). Rule: has >= 1 listing and every listing paused => `taskers.available = false`; any non-paused listing => true; no listings => untouched. Triggers `zz_sub_sync_tasker_visibility` (services) and `zz_sub_keep_paused_hidden` (taskers, stops the browser's `available: true` upserts from undoing it). Needs `services.listing_status` (S3c). Not tested against the real `idv_lockdown_guard` (its body was not in the files).

## (S4f-2 DONE 2026-11-04, see handoffs/sub-S4f-2.md; the text below is its brief, kept for reference.)
## NEXT STAGE was: **S4f-2** (manage buttons on `my-subscription.html`), needs the S4e files (`my-subscription.html`, `js/my-subscription.js`, `css/my-subscription.css`, and the S4e edits to `components/navbar.html` and `js/pricing-plans.js`), which were MISSING from the 2026-11-04 uploads, after the owner says "S4f-1 applied" (or sends files with no error). Then S5d, then S4g-S4j.
S4f-2 (JS + page only): buttons call `schedule_downgrade(p_plan)`, `cancel_subscription()`, `undo_cancel()` and the existing `chooseActiveListings(ids)` in `js/db.js` (param `p_ids`); confirm dialogs; after each call re-read `get_my_entitlements()`. Error codes are the exception MESSAGE: `not_signed_in`, `no_paid_plan`, `payment_overdue`, `cancel_pending`, `plan_required`, `plan_not_found`, `not_a_downgrade`, `period_over`. Answers are jsonb `{ok, plan, status, cancel_at_period_end, pending_plan, pending_change_at, period_end, already}`. "Stay on my plan" = `schedule_downgrade(<current plan key>)` clears a scheduled downgrade. Upgrade: button goes to the pricing page; real payment is S5d. Read `js/db.js` `_listingRpc` for the chooser's error handling. Nothing may charge money, end a plan early or touch wallet/top-ups (R-W).
`02-final-plan.md` section 4 rows 17-19: S4a-S4d (pricing page, badge; no Needs), S4e-S4g (my-subscription, offer UX; needs S2c, S3e), then S5d (`js/payments.js` one new function, `js/my-subscription.js`, buttons; needs S5b and S5c deployed). Read the S5d row in `01-stage-plan.md` and propose the order to the owner in one line before starting. Payments are Paystack only (R-W). Do not touch `task_applications`, `verify*`, `didit-*`, `idv_*`.

- S5c-1 (applied): `subscription_store_authorization(reference, authorization jsonb, customer_email)`, service role only; owner of the card is read from the payment, only a PAID `subscription` payment stores, only `reusable: true` is kept (anything else answers `{ok:true, stored:false, reason}`, never an error), one row per person, newer paid card wins, replays safe, event `card_saved` without code or email, no notification. Answer carries only `ok, stored, reason, already, card_last4, card_brand`.

- S5c-2 (deployed): the webhook saves the card for a paid subscription payment, also when the browser check finalised it first; only the needed authorization fields are sent; a failure to save is only logged (never with card data) and never changes the answer to Paystack; deployed source of truth `supabase/deploy/paystack-webhook/index.ts` (the repo copy under `supabase/functions/` is stale).

- S4f-1 (written): the three functions only change `cancel_at_period_end` / `pending_plan` / `pending_change_at` on the caller's ONE live paid row (locked), write one `subscription_events` row each (`downgrade_scheduled`, `downgrade_cleared`, `cancel_requested`, `cancel_undone`, actor `user`, no card or email data), send NO notification (S5g), refuse past due or overdue rows for downgrades, drop a scheduled downgrade when cancelling, and `undo_cancel` refuses once the paid period has ended (`period_over`). They rely on S3e / S5a to APPLY the change on the date (a downgrade to Free, a cancel: the S3e job; a downgrade to a lower paid plan: the renewal payment). That hand-over was NOT tested because the S3e source was not in the session's files: after applying, preview with `select apply_due_subscription_changes(true);`.

## Owner convention: silence means success (set 2026-11-04)
When the owner sends files to work with (a new zip, a project snapshot) and does NOT report any error, that means she deployed / applied the last stage's files and everything succeeded. Record that stage as applied/deployed ("per the owner's no-error convention") and continue; do not ask her to re-confirm. If she DOES report an error, stop and fix that first. This does not replace a stage's own explicit gate: a stage that says it needs "X deployed" still needs her to say so or to send files that follow it. Never claim a test passed or a payment worked on this basis; it only settles "applied / deployed".

## Owner rules (carry into every stage)
- **R-W: no user top-ups; subscriptions are paid only through Paystack; wallet money cannot pay for a subscription (`OWNER-RULE-NO-TOPUPS.md`). Never ask the owner to make a top-up, not even as a test.**
- Owner uses ONLY the Supabase SQL editor and dashboard function deploys. No console, curl or terminal steps. Leave non-compulsory steps out.
- Everything goes straight to production. All SQL additive, safe to run twice, with a rollback file.
- Never claim a test passed, SQL applied or a payment worked unless it really happened. Say "not run".
- No secrets in chat or in the browser.
- Deliver ONLY the files that changed, in their folders, as a zip named `subscription-<ID>.zip` (the owner's standing preference; the old "whole project in every zip" rule is retired). Each stage still writes `docs/subscription/handoffs/sub-<ID>.md`, updates this file and `STATUS.md`, and ends with a numbered "What you do now" list for the owner.
- All screens follow `DESIGN-SYSTEM.md` and `css/tokens.css`, copy the structure of existing pages, and pass `node tools/check-design-system.js` (only the three reference-copy failures are allowed). For any page change, show a live preview of the page.

## Ready-to-paste start message for the next session
> Continue the StreetTasker subscription overhaul. The zips are attached (latest `subscription-*.zip` plus the project). Read `SUBSCRIPTION-HANDOFF.md` and `docs/subscription/OWNER-RULE-NO-TOPUPS.md`, then do the stage named under NEXT STAGE only. Follow the session protocol, finish with the changed-files zip and my "What you do now" steps, then stop.




## UPDATE (S4f-2 session): S4f-1 and S4f-3 applied (owner: no errors); S4e deployed. S4f-2 written (page buttons + chooser), tested with stubbed Supabase, NOT deployed. NEXT STAGE: **S5d** (checkout wiring: js/payments.js one new function, js/my-subscription.js and subscription.html buttons; needs S5b and S5c deployed, both are). Propose the order to the owner in one line first. S4g-S4j follow.

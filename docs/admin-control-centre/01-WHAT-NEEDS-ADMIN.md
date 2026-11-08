# What the StreetTasker site needs an admin for (audit of the real repo)

Source: the project zip `ST-Real-Main` taken 2026-11-07 (426 files, 131 JS files, about 80 HTML pages). Everything below was found by reading the files, with the file named so the next session can check it. **UNVERIFIED** meant "inferred from code, the real database was not available". Stage A0 part B (2026-11-07) settled every UNVERIFIED item; each now says **CONFIRMED** with the real answer, or **unknown** where the owner's results did not show it. See `ARCHITECTURE.md` Part B.

## 1. How the site is built (this decides how the admin is built)

| Fact | Evidence | Consequence for admin |
|---|---|---|
| Plain HTML, CSS and JS. No build step, no framework. | `CLAUDE.md`, `package.json` (only `sharp`) | Admin pages are static HTML + JS files, exactly like `support.html`. No React, no bundler. The ChatGPT brief talks about "routes and components": translate that to HTML pages and shared JS files. |
| Hosted on Vercel (`vercel.json` only has share-link rewrites). Domain `streettasker.com`. | `vercel.json`, `CNAME` | Admin lives on the same domain under `/admin/`. Anyone can download the admin JS, so **all security is in Supabase** (RLS and SQL functions). The browser only shows things. |
| Supabase is the backend: Auth, Postgres, Edge Functions, Storage, Realtime. Browser uses the public anon key (`js/supabaseClient.js`). | `js/supabaseClient.js`, `supabase/functions/*` | Admin reads and writes go through `admin_*` SQL functions that call `admin_has()`. No admin table is ever opened to the browser roles directly. |
| Payments through Paystack; identity through Didit; email through Resend (every `notifications` row is emailed). | `supabase/functions/*`, `SUBSCRIPTION-HANDOFF.md` | Admin never holds Paystack keys. Admin never moves money. Mass notifications are mass emails (see Notifications screen). |
| The **owner works only in the Supabase SQL editor and dashboard function deploys**. No terminal. Everything goes straight to production. No staging. | `SUBSCRIPTION-HANDOFF.md`, `HANDOFF-README.md` | Every stage ships additive SQL files (safe to run twice, with a rollback file) and one-file function bundles. Never ask for console, curl or CLI steps. |
| A design system is enforced by a checker. New pages must use tokens and the page shell. | `AGENTS.md`, `CLAUDE.md`, `DESIGN-SYSTEM.md`, `tools/check-design-system.js` | Admin needs its own shell variant (sidebar app layout), which must be written into `DESIGN-SYSTEM.md` first. See decision D-A4. |
| The repository does NOT contain the real database schema. Only a few SQL files exist (`sql/`). Several handoffs say "the deployed copy is the source of truth, the repo copy is stale". | `sql/`, `SUBSCRIPTION-HANDOFF.md` (paystack-webhook, payment-init) | Stage A0 (read-only introspection) is mandatory before any admin SQL is written. |

## 2. Roles that exist today

- `public.users.role` is the active role; `users.roles` is the list (`js/auth.js` ~675-714). Values seen in code: `customer`, `tasker`, `coordinator`. `add_my_role` accepts only customer or tasker.
- Local Taskers are **not login accounts of the normal kind**: they are `local_tasker_profiles` rows managed by a coordinator (`js/coordinator-taskers.js`, `local-tasker-create` function).
- Coordinators are completely separate logins (`coordinator-login.html`, `coordinator-signup.html`, `js/auth.js` turns a coordinator away from every customer page). `js/auth.js` line ~792 already says "coordinator / admin logins have no second account", so the code expects an admin role to exist later.
- There is **no admin role, no admin table and no admin page**. The only staff concept is `support_staff` + `_is_support()` + the `support_*` functions behind `support.html`.

**Security note for the admin design.** `getUserRole()` in `js/auth.js` (line ~17) trusts `user.user_metadata.role` first. `user_metadata` can be edited by the user. That is acceptable for choosing which nav to draw; it must **never** be used to decide admin access. Admin access comes only from a new server table checked by `admin_has()`.

## 3. Hooks in the live site that are already waiting for an administrator

These are places where a customer, tasker or coordinator is told "an administrator will handle this", but no admin screen exists yet. They are the most valuable admin work because real people are blocked today.

| # | What the user sees | Where | What admin must be able to do |
|---|---|---|---|
| H1 | "Waiting for an administrator to give this Local Tasker a coordinator." Booking status `needs_reassignment`. | `js/coordinator-bookings-common.js` | Queue of local bookings with no coordinator; assign or reassign a coordinator (respecting the 10-worker limit). |
| H2 (**REMOVED by stage F-2, see `ARCHITECTURE.md` Part D item 1: the call-back no longer exists once the owner applies `f2-identity-gate-and-no-callback.sql`**) | "Ask a StreetTasker administrator to call them back before the quote is sent." Events `second_check_passed` / `second_check_failed`. | `coordinator-booking.html`, `js/coordinator-confirmation.js`, `js/coordinator-quote.js` | Queue of requested call-backs; record passed or failed with a note. Quote cannot go out until passed. |
| H3 | "After three wrong codes the booking is locked and only a StreetTasker administrator can unlock it." | `coordinator-booking.html`, `js/coordinator-release.js` | Locked-booking list; unlock only after the admin records that the customer was contacted. Must not release money by itself. |
| H4 | "Five attempts are already recorded. Contact an administrator." | `js/coordinator-exceptions.js` | Review exception records, raise the cap or close the case, with a reason. |
| H5 | "A problem report is open. A StreetTasker administrator is handling it." Booking `disputed`. | `js/coordinator-bookings-common.js`, `js/messages-details.js` | Already served by `support.html` for job payments (see section 5). Local Tasker bookings must appear in the same queue. |
| H6 | "Ask a StreetTasker administrator if you were expecting some [Local Taskers]." | `coordinator-dashboard.html`, `coordinator-taskers.html` | Unassigned Local Taskers list and assign action. |
| H7 | Coordinator applications are stored and the admin email contains `select admin_approve_coordinator_application('<id>')` to run by hand. | `supabase/functions/coordinator-apply/index.ts`, `docs/coordinator-onboarding/handoff-S2.md`, `handoff-S3.md` | Applications list, approve (returns the test link), reject with reason, see quiz attempts and result, see Didit result before the coordinator goes active. |
| H8 | Coordinator codes created with `admin_create_coordinator_code` in the SQL editor. | `docs/coordinator-onboarding/00-PLAN.md` | **CONFIRMED (A0 part B):** codes are still used by the new coordinator sign-up (`coordinator_code_check`, spent in `coordinator_finish_signup`), but they come from the test-pass flow; only the old `coordinator_redeem_code` route was closed. No separate Codes screen: A9 shows each application's code state and an optional "Create a code" action. |
| H9 | Withdrawals stuck in `pending`/`processing` are reconciled by a cron function; `withdrawal_stuck_list`, `withdrawal_succeed`, `withdrawal_fail` exist. | `supabase/functions/withdrawal-reconcile/index.ts` | Read-only watch screen for stuck and failed withdrawals. No manual "mark paid". |
| H10 | Gift cards: orders, delivery, receipts, errors (`list_due_gift_cards`, `list_unreceipted_gift_orders`, `record_gift_card_delivery_error`). | `supabase/functions/paystack-webhook/index.ts` | Oversight list of orders, undelivered or errored cards, resend status. Not in the ChatGPT brief. |
| H11 | "Support removed this file" and orphan uploads. | `js/messages-thread.js`, `js/support.js` | Already in `support.html`; carry over into the Support module. |
| H12 | Users who share contact details in chat are flagged by `report_contact_violation` (a count and a flag kept by the database). | `js/messages.js` ~204 | Trust & Safety list of flagged users with count and date; decision and note. CONFIRMED: the flag lives on `users` (`contact_violations`, `is_flagged`, `flagged_reason`); there is no separate table. |
| H13 | Re-verification: old users must verify again (owner decision), Didit results, `idv_restore_user` brings hidden tasks and services back. | `HANDOFF-README.md`, `js/verify.js` | Verification queue and history, using the existing `idv_*` functions only. |

## 4. Area by area: what exists, what admin needs

### 4.1 People
| Area | What exists (repo evidence) | Admin needs |
|---|---|---|
| Customers | `users` (60 uses), `dashboard-customer.html`, `client-profile.html`, `customer-bookings.html`, referral and gift-card use. | Directory, search, profile, booking and payment history, reports/complaints against them, suspend and restore. |
| Regular Taskers | `taskers` (public columns in `js/db.js` `TASKER_PUBLIC_COLS`: rating, `is_verified`, `verified_at`, `available`, services, location), `tasker_profiles`, `services`, `task_applications`, `wallets`, `wallet_transactions`, `withdrawal_bank_accounts`, 12% fee through `platform_fee_rate_for_booking`. | Directory, services, applications (offers), ratings, wallet **read-only**, withdrawals read-only, verification state, suspend/deactivate with history preserved. |
| Local Taskers | `local_tasker_profiles`, `local_tasker_photos`, `local_tasker_consents`, `coordinator_assignments`, functions `create_local_tasker`, `publish_local_tasker`, `unpublish_local_tasker`, `local_payout_*`, `local_tasker_public_*`. | Directory, assigned coordinator, publish state, services, bookings, payout destination **status only** (last four digits exist; the full number is never stored), consent records, reassign, unassigned list, deactivate. |
| Coordinators | `coordinators` (is_active_coordinator, `my_coordinator_plan`, `my_coordinator_upgrades`, `coordinator-plan.html`, `coordinator_applications`, quiz tables, Didit consent `coordinator-v1`, status `pending` then `active`). | Directory, status, workload, assigned workers, applications and test results, identity result, tier, deactivate, **10-worker limit**. |
| Admins | Nothing. | New: `admin_users`, roles, permissions, invite flow, MFA. |

### 4.2 Marketplace
| Area | What exists | Admin needs |
|---|---|---|
| Tasks (customer-posted) | `tasks` (42 uses), `post-task.html`, `find-tasks.html`, `task_applications`, map points, drafts, urgent flag. | Read list, status, hide or close a task that breaks rules. CONFIRMED columns (`tasks`: status `open, in_progress, completed, cancelled, draft`, `urgent_paid`, `urgent_fee`, `no_budget`, `map_lat`, `map_lon`); there is no suspend or hide column, so a hide needs a NEW column or table (A12). |
| Services (listings) | `services` with `listing_status` (paused by subscription limits), `post-service.html`, `find-services.html`. | Listing moderation (hide/unhide with reason), featured controls only through the existing ranking settings. Respect subscription pausing: admin hide must not be undone by the S3e job and must not undo it. |
| Categories | **Hardcoded** in `js/categories.js` (17 categories, service lists, keyword detection) and `images/icons/`. | Not editable from a database today. Decision D-A7. |
| Bookings (regular) | `bookings` (50 uses), `booking_private`, `escrow_payments`, `payment_requests`, `job_events`, statuses incl. `paid`, `provider_done`, `confirmed`, `released`, `disputed`, `cancelled`. | Read-only booking detail with payment and escrow state and the event timeline. No arbitrary status edit. |
| Bookings (Local Tasker) | `job_requests`, `local_booking_*` functions, states `needs_reassignment`, `assigned`, `awaiting_tasker_confirmation`, `tasker_confirmed`, `tasker_declined`, `quote_sent`, `quote_declined`, `quote_approved`, plus milestones, extras, exceptions, confirmations, release code. | Same read-only detail plus the three admin hooks H1, H2, H3. CONFIRMED: state is in `local_booking_state` (`lt_status`, `resume_status`, `coordinator_id`), history in `local_booking_events`. |
| Messaging | `message_threads`, `messages`, coordinator chat. Support can read a conversation only through `support_dispute_messages`, which logs `chat_viewed`. | No general chat browser. Reading a conversation only inside a dispute, with the same logged function. |
| Disputes | `job_disputes`, `dispute_events`, `job_refunds`, `job_attachments`, `evidence_removals`; **`support.html` + `js/support.js` + `css/support.css` already exist**; functions `support_list_disputes`, `support_dispute_context`, `support_dispute_messages`, `support_start_review`, `support_resolve_dispute`, `support_record_refund`, `support_remove_evidence`, `support_list_orphan_uploads`, `_is_support`. | Do not rebuild. Wrap it in the admin shell; keep its SQL functions; map it to permission `disputes.manage`. Outcomes: full refund, partial, release to tasker, split, no action. Refunds are made in Paystack and only **recorded**. |
| Reviews | `reviews`, `submit_review`, `profile_reviews`, `coordinator_submit_review`. | Read, reported reviews, hide with reason, history. Never remove a review only because it is negative. |
| Community feed | `feed_posts`, `posts`, `comments`, `community.html`. **Not in the ChatGPT brief.** | Moderation list: hide post or comment with reason. |

### 4.3 Money (all oversight, nothing moves)
| Area | What exists | Admin needs |
|---|---|---|
| Job payments | `payment-init`, `payment-verify`, `paystack-webhook` (repo copy stale), `payment_requests`, `escrow_payments`, `payments`, `payment_finalize`. | Transaction list with purpose, status, reference, booking; reconciliation flags. |
| Urgent task fee | References `URG-`, **verified only in the browser** (`js/tasks.js` ~502; the owner's own issue "X1"). | Show it as its own category. Flag to the owner as a security gap to fix separately. Admin must never treat it as a trusted payment until it is server-verified. |
| Subscriptions | `subscription_plans`/`get_public_plans`, `subscriptions`, `subscription_receipts`, `subscription_events`, `subscription_notice_log`, `listing_reduction_notices`, `get_my_entitlements`, `apply_due_subscription_changes` (service role, always dry-run first), settings keys `boost_per_tier`, `featured_slots`, `featured_rotation_minutes`, `listing_notice_days`, `renewal_window_days`, `renewal_reminder_days`, `features.portfolio_max`. Owner rules: **R-C no saved cards, no automatic renewal; R-W no top-ups, wallet cannot pay for a plan**. D3: "no admin in the subscription project; `ADMIN-REQUIREMENTS.md` is the contract". | Read-only first. Writes only after the shared approvals exist. **`ADMIN-REQUIREMENTS.md` and `docs/subscription/` are NOT in this zip: the owner must send them before A18.** The ChatGPT brief's table names (`payment_receipts`, `subscription_payment_details`, `admin_set_plan_*`) may not match; the real names win. |
| Coordinator tiers | `my_coordinator_plan`, `my_coordinator_upgrades`, `coordinator-plan.html`, `payment-init` purpose `tier_upgrade`. The brief's table name `coordinator_tiers_state` was **not found** in the repo. | Read tier, price, upgrade payments, revenue. Separate from subscriptions. |
| Wallets and withdrawals | `wallets`, `wallet_transactions`, `withdrawal_bank_accounts`, `process-withdrawal`, `withdrawal-reconcile`, `withdrawal_limits`, `withdrawal_fee`. | Read-only balances and withdrawal watch. No manual credit or debit. |
| Local Tasker payouts | `local-payout-account` verifies and stores last four digits only. Live payouts are guarded by `PAYOUT_LIVE_APPROVED`. | Payout record list and status; reconciliation view. |
| Gift cards | `gift_cards`, `gift_card_orders`, `gift_card_holds`, `gift_card_transactions`, `gift-card-pay`, `redeem.html`. | Orders, redemptions, delivery errors. Not in the brief. |
| Referrals | `referral_profiles`, `referral_rewards`, `referral_my_*`, `/r/CODE` share pages. | Programme overview and reward list. Not in the brief. |

### 4.4 Identity (Didit)
`identity_verifications`, `local_tasker_consents`, `idv_apply_event`, `idv_local_status_list`, `idv_my_status`, Edge Functions `didit-create-session`, `didit-webhook`, `didit-sync`. Admin shows the **provider result and history** and may use existing `idv_*` functions only. Membership labels PRO/PREMIUM are never identity. Subscription changes never touch verification.

### 4.5 Communication and content
- `notifications` table, shared panel (`js/notifications-panel.js`), email pipeline `send-notification-email` -> Resend, push (`push_save_subscription`), preferences (`get/set_my_notification_prefs`). **Every notification row is emailed.**
- Public content is **static files**: `index.html`, `learn.html` + `js/learn-content.js`, FAQ blocks in `subscription.html` and `js/pricing-plans.js`, `contact.html`, `community.html`, legal pages (`terms.html`, `privacy.html`, `cookies.html`, `accessibility.html`, `ip-complaints.html`), `sitemap.xml`, `robots.txt`. No CMS tables exist.

## 5. Where the ChatGPT brief and the real site disagree

| Brief says | Reality | Decision |
|---|---|---|
| App with routes and components | Static HTML + JS | Pages in `/admin/`, shared `admin-*.js` |
| "Existing StreetTasker authentication" has roles | Roles are customer/tasker/coordinator; metadata fallback is user-editable | New `admin_users` table, `admin_has()` |
| Build approvals infrastructure | None exists | Build once (A2) |
| Subscription tables `payment_receipts`, `subscription_payment_details`, `admin_set_plan_*` | Real: `subscription_receipts`, `subscription_events`, notice log, settings keys | Re-map in A18 from real schema |
| Subscriptions: cancel, downgrade, saved card | Owner rule R-C removed them | Admin shows "ended", "past due", "paid again", never "renews automatically" |
| `coordinator_tiers_state` | Not found | A0 finds the real table or RPC source |
| Editable service categories | Hardcoded JS | D-A7 |
| Website CMS | Static files | D-A8 (small scope) |
| 26 screens | Missing: gift cards, referrals, community moderation, withdrawals watch, local-booking operations, coordinator applications, contact-violation flags | Added in `02-SCREEN-SPECS.md` |
| Stitch reference screens | **Not in the zip** | Owner must send them (D-A5) |
| One shared `admin_has()` and approvals "later" | Needed before any admin write | A1, A2 come first |
| Files under `docs/admin-control-centre/` | Matches this repo's habit (`docs/<project>/handoff-*.md`) | Kept |

## 6. Not found in the zip (the owner must send before the stage that needs it)

| Missing | Needed by |
|---|---|
| Stitch reference screens (26) | A3 onward (visual reference) |
| `docs/subscription/*` incl. `ADMIN-REQUIREMENTS.md`, `02-final-plan.md`, `DECISIONS.md` | A18, A19, A20 |
| `docs/verification/*` incl. `DECISIONS.md`, `DEPLOY-FUNCTIONS.md` | A11 |
| `sql/messaging-step6a.sql`, `PAYMENTS-HARDENING.md` (named in `js/payments.js`) | A15, A17 |
| `audit/frontend-audit.md` | A3 |
| The owner's ChatGPT brief saved as `docs/admin-control-centre/00-BRIEF.md` | All |
| The real schema (answers to `sql/admin/a0-introspect.sql`) | A1 onward |
| Source of the Edge Functions that are called by the site but are **not in the repo**: `payment-init`, `payment-verify`, `urgent-verify`, `send-booking-notification`, `send-notification-email`, `push-send`, `gift-card-redeem`, `gift-card-corporate` (the repo copy of `paystack-webhook` is also stale). Found in A0 by comparing code to `supabase/functions/`. Paste each from the Supabase dashboard (Edge Functions > the function > code); never any secret value. | A15, A16, A22 (not needed before) |

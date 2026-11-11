# Admin screens: what goes on each one and how it should look

Read `01-WHAT-NEEDS-ADMIN.md` first. Names marked **NEW** do not exist yet. Names marked **VERIFY** came from the repo; A0 part B (2026-11-07) confirmed or corrected them, and each is now marked **CONFIRMED** or **unknown** (see `ARCHITECTURE.md` Part B). There are **no Stitch reference screens**: the owner confirmed (2026-11-07) that every admin page follows `DESIGN-SYSTEM.md`, `css/tokens.css` and the existing website style. "Brief #" is the screen number in the owner's master brief. `STAGE` is the stage in `00-PLAN.md` that builds it.

## 0. Rules that apply to every screen

**Where pages live.** `/admin/*.html`, one JS file per page in `/admin/js/`, one shared shell (`admin/js/admin-shell.js`) and one stylesheet (`css/admin.css`, tokens only). Pages are `noindex`, not in `sitemap.xml`, and listed `Disallow` in `robots.txt`. Nothing on the public site links to them.

**How a page gets its data.** Only through `admin_*` SQL functions (security definer, each begins with `admin_require('<permission>')`). No direct `.from('table')` on a protected table from an admin page. Lists are paged on the server (50 per page) and searched on the server. Counts come from one summary function, never from downloading rows.

**How a page decides what to show.** On load, one call `admin_my_access()` returns the admin's role names and permission list. The shell draws only permitted menu items. A hidden menu item is a convenience: every function re-checks on the server.

**Writing to the page.** Follow `js/support.js`: build elements with `textContent`, never `innerHTML` with data. Free text from users (messages, names, reasons) is untrusted.

**Layout (desktop, tablet, phone).** Uses the design system breakpoints 480 / 768 / 1044.
- 1044 and up: fixed left sidebar (256 px), top bar, content max width 1200 px. Detail opens in a right-hand panel beside the table.
- 768 to 1043: sidebar collapses to icons; detail opens as a full-width panel over the table.
- Under 768: sidebar becomes a drawer behind a menu button; **tables become stacked cards** (name and status on the first line, two key facts below, "Open" button); filters collapse into one "Filters" sheet; detail is its own full screen with a back button. Never shrink a wide table onto a phone.
- Colour and type: tokens only (`--color-primary` #0F6B46 for primary buttons and active nav, light `--color-bg-subtle` workspace, white cards, Inter body and Manrope headings, 14 px for dense table text). Radius follows the owner's rule: 16 px for cards and fields, pill for badges and chips. **No 32 px hero blocks, no gradients, no oversized stat cards** in admin.
- Status uses the existing `.badge` classes with the semantic tokens (success green, warning amber, danger red, neutral grey). Always show a word, never colour alone.
- Every list has these states, written once in the shell and reused: loading skeleton, empty ("Nothing here yet"), no search results, error with Retry, no permission (shows which permission is missing), and a success toast.
- Sensitive actions: a confirmation dialog that shows exactly what will change, a required reason box (minimum 10 characters, matching the subscription contract), and a final button labelled with the action. Anything that needs approval says "Send for approval", never "Do it".
- Money wording: nothing in admin says money moved unless a server record says so. "Record refund" not "Refund". "Record adjustment" not "Adjust balance".
- Private data: phone, email, address and bank last-four are **masked by default**. "Reveal" calls a logged function (`pii.reveal`).

## 1. Permissions (the vocabulary)

Names follow the brief and are extended for what the site really has. Final spelling is fixed in A1 and recorded in `DATABASE-CHANGES.md`.

`customers.view|edit|suspend` · `taskers.view|manage|suspend` · `local_taskers.view|manage` · `coordinators.view|manage|assign` · `coordinators.applications.review` · `admin.team.view|manage` · `admin.roles.manage` · `verification.view|review` · `bookings.view|manage` · `local_bookings.reassign` · `local_bookings.unlock` · `disputes.view|manage` · `disputes.refund.record` · `reviews.moderate` · `listings.moderate` · `community.moderate` · `trust.flags.view|manage` · `transactions.view` · `revenue.view` · `payouts.view` · `withdrawals.view` · `giftcards.view|manage` · `referrals.view` · `subscriptions.view|plans.edit|payments.view|revenue.view|override|adjust|credits.grant|review.resolve` · `coordinator_plans.view` · `notifications.send|broadcast` · `content.manage` · `analytics.view` · `settings.view|manage` · `audit_logs.view` · `accounting.view|record|capital.request` · `approvals.view|request` · `approvals.decide` (Super Admin only) · `pii.reveal` · `export.run`.

| Role | Gets |
|---|---|
| Super Admin | Everything, plus `approvals.decide`, `admin.*`. Explicitly assigned. At least two recommended (D-A10). |
| Operations Admin | customers, taskers, local_taskers, coordinators (+assign), bookings, local_bookings.*, listings, community, analytics.view |
| Finance Admin | transactions, revenue, payouts, withdrawals, giftcards.view, referrals.view, subscriptions.view/payments/revenue, coordinator_plans.view, export.run. **No money-moving function exists for anyone.** |
| Accountant (planned, A15b-1) | Money only: accounting.view|record|capital.request, transactions.view, revenue.view, payouts.view, withdrawals.view, giftcards.view, referrals.view, subscriptions.view/payments.view/revenue.view, coordinator_plans.view, export.run. Cannot see people, bookings, verification or content. Cannot edit a ledger entry or repay capital without an approval. |
| Verification Admin | verification.view/review, local_taskers.view, coordinators.view |
| Support Admin | disputes.*, trust.flags.*, reviews.moderate, customers.view, taskers.view, bookings.view, pii.reveal (limited) |
| Content Admin | content.manage, notifications.send (not broadcast), listings.moderate, community.moderate |

## 2. Screens

Format: **Purpose** · **Data** · **Shows** · **Actions (permission; approval?)** · **Layout notes**.

### S01 Dashboard (brief 01) · STAGE A4
- **Purpose.** One look at the health of the platform and what needs a person today.
- **Data.** NEW `admin_dashboard_summary()` returning counts in one call. Sources: `users` by role, `local_tasker_profiles`, `coordinators` (by status), `admin_users`, `identity_verifications` (pending), `bookings` and local booking state (active, completed, cancelled), `job_disputes` (open), `payment_intents`/`payment_requests`/`escrow_payments` (CONFIRMED, all exist), `subscription_receipts`, `my_coordinator_upgrades` source, withdrawals stuck list.
- **Shows.** Row 1 "Needs attention" (clickable cards with a number, hidden if zero or no permission): pending approvals, local bookings needing a coordinator (H1), locked bookings (H3), open disputes, verifications waiting, stuck withdrawals, subscription payments needing review, coordinator applications waiting. Row 2 people totals. Row 3 bookings by status (last 30 days). Row 4 money in four **separate** boxes: regular Tasker commission, subscription revenue, coordinator plan revenue, other income (never one total). Row 5 recent activity (last 20 audit rows the viewer may see). Row 6 user growth line (weekly, 12 weeks).
- **Actions.** None except navigation. **Never invent a number.** If a source is unreadable show "Not available" and the reason, not zero.
- **Layout.** Cards 2 per row on phone, 4 per row on desktop, compact (number and label only). Growth uses the app's existing chart approach; if none, a plain table plus tiny inline bars.

### S02 Pending Approvals (brief 02) and S26 Approval Details · STAGE A5
- **Data.** NEW `admin_approval_requests` (design in `00-PLAN.md` section 4).
- **Shows.** Tabs Pending / Approved / Rejected / Expired. Columns: request id (short), action label, target, requester, submitted, risk badge (Low, Medium, High), status. Detail: requester and reason, "current value" next to "proposed value" (a two-column diff), supporting evidence links, history, expiry countdown.
- **Actions.** Super Admin only: Approve or Reject with a decision reason (`approvals.decide`). Requester may Cancel their own pending request (`approvals.request`). The page never executes the action itself: approving marks the request; the target function consumes it (see plan). Show "You cannot approve your own request" instead of hiding the buttons.

### S03 My Profile (brief 03) · STAGE A3
- **Data.** Supabase Auth session, `admin_users` row, MFA factors, `notification_preferences` table (CONFIRMED; the `get_my_notification_prefs` function does not exist, read the table pattern in `sql/notification-preferences.sql`).
- **Shows.** Name, email, role names, last active, MFA status (set up TOTP), change password (Supabase Auth), sign out of this device and of all devices, notification preferences for admin alerts.
- **Actions.** Own profile only. Sign out.

### S04 Customers (brief 04) · STAGE A7
- **Data.** `users` (role customer), `bookings`, `job_disputes`, `reviews`, report flags (H12), `notifications` not read.
- **Shows.** Directory with search (name, email, phone, id), filters (status, joined date, has open dispute), columns: name, joined, bookings count, status. Profile panel: contact (masked), account status, booking history, payments summary, reports against and by them, disputes, restrictions with reasons, gift-card and referral summary.
- **Actions.** Suspend and restore (`customers.suspend`, reason required, logged, **no approval** unless D-A10 changes it). Edit only non-identity fields (`customers.edit`). Suspension must not delete or hide historical bookings, and must not block an open dispute or a pending refund record.
- **Needs.** NEW suspension table `admin_account_flags` (A0 decision: no suspend column exists on `users`, `taskers` or `services`; the `users` and `taskers` guard triggers `_m18_users_guard`, `_m18_taskers_guard` and `idv_lockdown_guard` make adding columns there risky).

### S05 Regular Taskers (brief 05) · STAGE A8
- **Data.** `taskers`, `tasker_profiles`, `services`, `task_applications`, `reviews`, `wallets` and `wallet_transactions` (read-only), `identity_verifications`, `membership_for_users` (label only).
- **Shows.** Directory with filters (verified, available, category, plan label, status). Profile panel tabs: Overview, Services (with listing status and who paused it), Offers/applications, Bookings, Ratings and reviews, Earnings and wallet (permission `payouts.view`), Verification (provider result), Plan (read-only label and period).
- **Actions.** Suspend, reactivate, deactivate (`taskers.suspend`, reason). Hide or unhide a service goes through S11. Never edit rating, wallet, commission or verification here. The PRO / PREMIUM label is shown as "Membership", visually distinct from the verified tick.

### S06 Local Taskers (brief 06) · STAGE A10
- **Data.** `local_tasker_profiles`, `coordinator_assignments`, `local_tasker_photos`, `local_tasker_consents`, `idv_local_status_list`, local bookings, `local_payout_*` status (last four only).
- **Shows.** Directory, filters (coordinator, unassigned, published, verified, has bookings). Panel: profile and areas, assigned coordinator and assignment history, identity check status, published services and prices (read-only: **admin never edits a price**), booking history, earnings and payout records, consent records.
- **Actions.** Reassign coordinator (`coordinators.assign`; backend refuses an 11th worker), unpublish (`local_taskers.manage`, reason), deactivate (reason, history kept). Not allowed anywhere: set or reduce prices, apply for tasks, charge the 12% fee, use a wallet.
- **Rules to display as small notes, not hide:** workers must agree to each job; coordinators cannot set prices.

### S07 Coordinators (brief 07) + Applications · STAGE A9
- **Data.** `coordinators`, `coordinator_assignments`, NEW-to-admin reads of `coordinator_applications`, `coordinator_quiz_attempts` (CONFIRMED), `coordinator_tiers_state` + `coordinator_tier_terms()` (CONFIRMED), Didit coordinator result, local booking states.
- **Shows.** Tab 1 Coordinators: name, area, status (pending identity check / active / deactivated), tier, workers assigned `n/10`, open bookings, pending requests, last activity. Tab 2 Applications: answers (`tasker_count`, `area_sqm`, `can_meet_taskers`, `can_explain`), status new/approved/rejected/passed, quiz attempts and best score, link state. Tab 3 Workload: bars of `n/10` and open jobs per coordinator, plus **unassigned Local Taskers**.
- **Actions.** Approve application (returns the test link to copy; `coordinators.applications.review`), reject with reason, assign and reassign workers (`coordinators.assign`), deactivate coordinator (reason). No separate Codes screen (CONFIRMED in A0 part B: codes are still used by the sign-up flow); show code state per application and an optional "Create a code".
- **Hard rule.** CONFIRMED: the limit already exists as a per-tier capacity in the trigger `coordinator_assignments_guard`; there is no fixed 10 any more. Admin assign and reassign (NEW function) insert into `coordinator_assignments` and let that trigger decide; nothing bypasses it.

### S08 Admin Team (brief 08) and S24 Roles and Permissions · STAGE A5
- **Data.** NEW `admin_users`, `admin_roles`, `admin_role_permissions`, `admin_user_roles` (names proposed, see plan).
- **Shows.** Admin directory: name, email, roles, status, last active, MFA on/off. Roles directory: each role with its permission groups as checkbox grid; sensitive permissions marked with a shield.
- **Actions (Super Admin only).** Invite admin (Edge Function `admin-invite` creates the auth user; service-role key stays on the server), assign roles, deactivate (immediate: `admin_has()` returns false), edit a role's permissions. **Permission and role changes go through approval** (the brief lists them as sensitive). Cannot remove or demote the last Super Admin. Cannot approve own change.

### S09 Identity Verification (brief 09) · STAGE A11
- **Data.** `identity_verifications`, `idv_local_status_list`, `local_tasker_consents`, Didit webhook results as stored by `idv_apply_event` (CONFIRMED: `identity_verifications` stores status, provider status, reason codes and three booleans `liveness_ok`, `face_match_ok`, `document_ok`, plus `nin_database_match`; no scores, no media).
- **Shows.** Queues: Pending, Review required, Failed, Verified, Additional information. Columns: subject (regular Tasker, Local Tasker, coordinator, customer), status, provider session id, result time, attempts. History per subject.
- **Actions.** Only what the existing `idv_*` functions allow (for example request a new attempt). Admin cannot set a verified flag by hand. Separate "Membership" is never shown here.

### S10 Bookings and Tasks (brief 10) · STAGE A12
- **Data.** `bookings`, `booking_private`, `tasks`, `task_applications`, `job_events`, `escrow_payments`, local booking functions (`local_booking_detail`, `local_booking_list`, `local_booking_confirmations`, `local_booking_exceptions`, `local_booking_milestones`, CONFIRMED: `local_booking_*` functions are coordinator functions and were not shown to accept staff; admin gets NEW `admin_*` wrappers (A12)).
- **Shows.** Tabs: Bookings (regular), Local bookings, Tasks. Columns: id, customer, tasker, type, status, payment status, date, cancellation. Local rows add coordinator, worker agreement state, approved quote, transport and material costs, release state. Detail has the full event timeline.
- **Actions.** Read-only for regular bookings. Local booking operations queue (H1, H3, H4; H2 the call-back was removed in stage F-2): reassign coordinator (`local_bookings.reassign`), unlock after three wrong codes with note that the customer was contacted (`local_bookings.unlock`). **Admin can never bypass worker consent or release escrow from here.**
- **Needs.** NEW admin-permitted wrappers around the coordinator-only functions, each logging to `admin_audit_log`.

### S11 Services and Categories (brief 11) · STAGE A14
- **Data.** `services` (+ `listing_status`), `js/categories.js` (static), `featured_taskers` settings.
- **Shows.** Listings table with category, tasker, status, reports count. Categories tab is **read-only** (17 today) until D-A7 is decided. Featured tab shows what the ranking function currently returns and the tuning settings (read-only; edits belong to S23 and need approval).
- **Actions.** Hide or unhide listing with reason (`listings.moderate`). A hide must be separate from the subscription pause flag so neither undoes the other (CONFIRMED: `listing_status` allows only `active` and `paused`, so the admin hide is a NEW column or table, never a new value).

### S12 Disputes and Complaints (brief 12) · STAGE A13
- **Data.** Existing: `support_list_disputes`, `support_dispute_context`, `support_dispute_messages`, `support_start_review`, `support_resolve_dispute`, `support_record_refund`, `support_remove_evidence`, `support_list_orphan_uploads`; tables `job_disputes`, `dispute_events`, `job_refunds`, `job_attachments`.
- **Plan.** **Do not rewrite.** Move the UI into the admin shell (`/admin/disputes.html`), keep `support.html` working until the new page is proven, then make it redirect. Change `_is_support()` to also accept `admin_has('disputes.manage')`; never weaken it.
- **Shows.** Same as today: queue (Needs action / Closed / All), case detail, evidence (signed URLs of 120 s), notes, refund records, timeline, orphan uploads. Add: Local Tasker and coordinator complaints in the same queue, category badge (no show, poor quality, incomplete, payment, misconduct, damage, wrong description, cancellation), escalation flag.
- **Actions.** As today. **Subscription payments are never shown here.**

### S13 Reviews and Reports (brief 13) · STAGE A14
- **Data.** `reviews`, `profile_reviews`, `comments`, `feed_posts`, contact-violation flags (H12), reports of services.
- **Shows.** Tabs: Reviews, Reported reviews, Flagged users (contact sharing), Community posts and comments.
- **Actions.** Hide with reason from a fixed list (abuse, fake, personal data, off-topic); decision history. **No "remove because negative" option exists in the reason list.** Flagged users: add note, clear flag, escalate to suspension (S04/S05).

### S14 Transactions (brief 14) · STAGE A15
- **Data.** `payment_intents` (CONFIRMED exists; purposes `request, booking, topup, tier_upgrade, subscription`), `payment_requests`, `escrow_payments`, `payments`, `job_refunds`, `subscription_receipts`, coordinator tier payments (`tier_upgrade`), gift-card orders, urgent fee (`URG-`, browser-verified, flagged).
- **Shows.** One table with a **Purpose** column and filter: Job payment, Subscription, Coordinator plan, Gift card, Urgent fee, Other. Reference, customer, tasker, booking, amount (naira from kobo), provider, status, date, refund status, reconciliation status (matched / needs review / unverified).
- **Actions.** Read-only. Export (`export.run`, logged). "Mark reconciled" only if A15 finds a field for it, and then it needs a reason.

### S14b Accountant dashboard (NEW, not in brief) · STAGES A15b-1 to A15b-3
- **Spec.** `04-ACCOUNTANT-ADMIN.md` (section 0 is the full list of money flows and the ten dashboard blocks).
- **Data.** Reads `payment_intents`, `payment_requests`, `escrow_payments`, `gift_card_*`, `subscription_receipts`, coordinator plan payments, `donations`, payout and withdrawal rows, `job_refunds`, `referral_rewards`. New `admin_topup_batches` (A15b-2) and `admin_money_ledger` (A15b-3).
- **Shows.** Top-up needed now, cash position (typed), money in, owed to others, paid out, platform income and costs (profit), Local Taskers and coordinators, settlements expected versus received, capital (₦200,000, repaid, outstanding), ledger.
- **Actions.** Record a top-up, a settlement received, an expense, capital in; request a capital repayment (needs a different Super Admin's approval). Nothing calls Paystack; nothing changes a wallet, escrow or payment.

### S15 Revenue and Commissions (brief 15) · STAGE A16
- **Shows.** Four separate reports with their own definitions printed under each number: (1) regular Tasker commission (12% via `platform_fee_rate_for_booking`; excludes Local Taskers), (2) subscription revenue (paid receipts, plan only; add-ons separate if enabled), (3) coordinator plan revenue (tier upgrades), (4) other platform income (gift-card fees if any, to be confirmed). By day, week, month.
- **Rule.** Where the fee is stored is found in A0 Block 17. If it cannot be proven, show "Not available" and say why.

### S16 Subscriptions (brief 16) · STAGES A18 (read) and A19 (write)
- **Data (real names, confirm in A0 and from the owner's docs).** `get_public_plans` source table (plans, price in kobo, offer allowance, listing limit, label, features, active), `subscriptions`, `subscription_receipts`, `subscription_events`, `subscription_notice_log`, `listing_reduction_notices`, offer usage and credits tables, settings keys.
- **Shows.** Overview (subscribers by status active / past due / cancelled / expired and by plan, revenue this month, failed payments, **payments needing review**: money received but plan not activated). Plans (read first). Subscribers with search and filters and a per-person timeline from `subscription_events`. Payments with receipts. Audit (`subscription_admin_log` + events).
- **Actions (A19 only).** Price change, plan override, adjustment record, goodwill credits, resolve a review case: each calls the real subscription function with an **approval id** that the function validates in SQL. The page says "Adjustment recorded. The refund itself is made in Paystack by an authorised person" whenever an adjustment is saved.
- **Exclusions.** Local Taskers are not subscribers. Coordinator tiers are separate (S17). No "cancel", "downgrade" or "saved card" controls (owner rule R-C). Wallet can never pay for a plan (R-W). Changing a plan never changes verification.

### S17 Coordinator Plans (brief 17) · STAGE A20
- **Data.** `my_coordinator_plan` and `my_coordinator_upgrades` sources (CONFIRMED: `coordinator_tier_upgrades` ledger and `coordinator_tiers_state`), payment records with purpose `tier_upgrade`.
- **Shows.** Tiers, prices, status, coordinators per tier, upgrade payments, revenue (separate).
- **Actions.** Read-only at first. Price edits later through approvals.

### S18 Earnings and Payouts (brief 18) · STAGE A17
- **Shows.** Two clearly separated sections. Regular Taskers: wallet balances, earnings, withdrawal requests, payout history, failed and stuck (from `withdrawal_stuck_list`). Local Taskers: approved job payments, payout records by status, last four of the destination, failed records, reconciliation.
- **Actions.** None that move money. Read-only plus export. A link explains that reconciliation runs from the `withdrawal-reconcile` function.

### S19 Gift Cards and Referrals · STAGE A21 (NEW, not in brief)
- **Data.** `gift_card_orders`, `gift_cards`, `gift_card_holds`, `gift_card_transactions`, `referral_profiles`, `referral_rewards`.
- **Shows.** Orders by status, undelivered and errored cards (`record_gift_card_delivery_error` data), redemptions; referral programme counts and rewards by status.
- **Actions.** Read-only. Resend actions only through existing server functions after review.

### S20 Notifications and Announcements (brief 19) · STAGE A22
- **Data.** `notifications`, `send-notification-email`, push subscriptions, notification preferences, NEW `admin_announcements`.
- **Shows.** Compose (title, body, link, audience: all customers, all Taskers, all Local Taskers' coordinators, one coordinator group, one person), preview with **recipient count**, history with who sent it.
- **Rules.** Every notification row sends an email, so a broadcast is a mass email: show the count and the email warning, respect `notification prefs`, cap sends per day, and require approval above a threshold (default 50 recipients). Local Taskers without a phone or email are reached through their coordinator.

### S21 Website Content and Help Centre (brief 20) · STAGE A23
- **Scope (small on purpose, D-A8).** NEW tables for: announcement banner, FAQ entries, help articles, contact details block. Public pages read them with a **built-in fallback** to the current static text so a database error never blanks the site. Legal pages, the homepage layout and `sitemap.xml` stay in git.
- **Actions.** Draft, preview, publish, unpublish, history (`content.manage`). Legal text changes are not editable here.

### S22 Analytics and S23 Local Tasker Impact (brief 21, 22) · STAGE A24, A25
- **Shows.** User growth, active users, bookings by status and category, cancellations, disputes by category, revenue by the four buckets, subscription and coordinator plan performance. Impact: Local Taskers onboarded, workers who received a booking, completed jobs, total earnings paid to Local Taskers, active coordinators, average bookings per worker, workers with no bookings, workers without a coordinator, trend by month.
- **Rule.** Only counts that come from rows. No social-impact or employment claims. Every chart has its definition under it.

### S24 Platform Settings (brief 23) · STAGE A26
- **Data.** `subscription_settings` (key, int_value, text_value), `local_tasker_settings` (key, value), `homepage_settings` (key, value_int) (CONFIRMED names; contents unknown), NEW `admin_platform_settings` only for settings that have no home yet, commission rule source (`platform_fee_rate_for_booking`).
- **Shows.** Commission rule, withdrawal limits and fee (`withdrawal_limits`, `withdrawal_fee`), booking and cancellation settings, subscription tuning keys, renewal window and grace, portfolio limit.
- **Actions.** Edit with reason. Commission, fee, limit and pricing changes **require approval**. Changing the 12% never rewrites past bookings.

### S25 Security and Activity Logs (brief 25) · STAGE A6 (reader), A27 (monitoring)
- **Data.** NEW `admin_audit_log` (append-only) plus a read-only view that unions `subscription_admin_log`, `subscription_events`, `dispute_events`, local booking events, `idv` audit, coordinator logs (CONFIRMED names: `subscription_admin_log`, `subscription_events`, `dispute_events`, `local_booking_events`, `local_tasker_audit_log`, `idv_takedowns`, `job_events`). The old logs are never altered.
- **Shows.** Filter by admin, action, target, date, outcome (success, refused, failed). Columns: time, admin, action, target, reason, approval id, outcome. Row detail shows previous and new value. Security tab: admin sign-ins, failed `admin_has` checks, role changes, MFA changes, approval decisions.
- **Actions.** Read and export (`audit_logs.view`, `export.run`). No edit, no delete, enforced by a trigger and by RLS, not by the page.

### S27 Help and Support (brief general) · STAGE A3
A static page with how-to notes for admins, the escalation contact, and a link to the owner's handoff docs. No data.

## 3. Navigation (permission aware)

OVERVIEW: Dashboard, Pending Approvals · PEOPLE: Customers, Regular Taskers, Local Taskers, Coordinators (with Applications), Admin Team, Identity Verification · MARKETPLACE: Bookings and Tasks (with Local booking operations), Services and Categories, Reviews and Reports, Disputes and Complaints · FINANCE: Transactions, Revenue and Commissions, Subscriptions, Coordinator Plans, Earnings and Payouts, Gift Cards and Referrals · COMMUNICATION: Notifications, Announcements, Website Content and Help · INTELLIGENCE: Analytics, Local Tasker Impact · SYSTEM: Platform Settings, Roles and Permissions, Security and Activity Logs · GENERAL: Help, My Profile, Sign out. A group with no permitted item is not drawn.

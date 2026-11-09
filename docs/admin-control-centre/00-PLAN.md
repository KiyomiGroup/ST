# Admin Control Centre: plan, architecture and stage table

Written 2026-11-07 from a full read of the repository. Companion files: `01-WHAT-NEEDS-ADMIN.md` (the audit), `02-SCREEN-SPECS.md` (every screen), `03-OWNER-DECISIONS.md` (questions with proposed answers), `sql/admin/a0-introspect.sql` (read-only checks the owner runs first). The owner's master brief (written with ChatGPT) is the business requirement; **where it disagrees with the real repo, the repo wins** (see `01` section 5).

## 1. Goal in one paragraph

One admin area, on the same domain, for several staff accounts with different roles and one Super Admin level. It watches and manages people, bookings, verification, disputes, money records, subscriptions and content, **without ever becoming a way to move money, bypass escrow, bypass a Local Tasker's consent, or edit identity status**. Sensitive changes need a second person (a Super Admin) and the database, not the page, enforces that.

## 2. Architecture (fits the real site)

```
Browser (static HTML + JS, anon key)           Supabase
  /admin/*.html  ----- admin_* RPC ----->   SQL functions (security definer)
  admin/js/admin-shell.js                     each starts: admin_require('perm')
  css/admin.css (tokens)                      reads/writes existing tables
                                              writes admin_audit_log (append-only)
  Edge Functions (dashboard-deployed):        consumes admin_approval_requests
   admin-invite (service role, creates auth user)
   (later) admin-export
```

Rules that follow from the site:
1. **No framework, no build.** Pages like `support.html`. Shared JS in `admin/js/`. Files delivered in a zip with the repo folder layout.
2. **Admin pages never touch a protected table directly.** Only `admin_*` functions. Existing coordinator and support functions are wrapped, not edited.
3. **Admin accounts are separate Supabase Auth users** (like coordinators), never a customer account with a flag. `js/auth.js` turns an admin login away from customer and tasker pages, the same way it already does for coordinators (`js/auth.js` lines ~454, ~792, ~923 and ~937 in the 2026-11-07 16:04 snapshot).
4. **Admin identity comes only from `admin_users`.** Never from `users.role` and never from `user_metadata` (users can edit their own metadata).
5. **MFA (TOTP) required for admin accounts.** `admin_has()` checks the session level (`aal2`) once the owner has enrolled, controlled by a setting so the owner cannot lock herself out on day one (D-A2).
6. **Existing support console is kept.** `support_staff`, `_is_support()` and all `support_*` functions stay. `_is_support()` is extended (never narrowed) to also accept `admin_has('disputes.manage')`.
7. **Money.** No admin function calls Paystack. No admin function changes a wallet, an escrow row or a payment status. "Record" functions only write a note or an adjustment row.
8. **Identity.** No admin function writes a verified flag. Only existing `idv_*` functions change verification, as they do today.
9. **Do not edit** `verify*`, `didit-*`, `idv_*`, `task_applications`, subscription SQL or payment Edge Functions (standing rule from earlier projects). Wrap or read only.

## 3. Database contract (proposed names; A1 and A2 confirm and record them in `DATABASE-CHANGES.md`)

All new objects are additive, safe to run twice, with a rollback file, RLS on, and **no grants to `anon` or `authenticated` on tables**. Browser access is `execute` on specific functions only.

| Object | Purpose |
|---|---|
| `admin_users(user_id pk -> auth.users, display_name, status, created_by, created_at, last_seen_at, removed_at)` | Who is an admin. Status `active` / `suspended` / `removed`. |
| `admin_roles(key pk, label, is_system)` | `super_admin`, `operations`, `finance`, `verification`, `support`, `content` |
| `admin_permissions(key pk, label, group_name, sensitive bool)` | The vocabulary in `02` section 1 |
| `admin_role_permissions(role_key, permission_key)` | Role to permission |
| `admin_user_roles(user_id, role_key, granted_by, granted_at)` | An admin may hold several roles |
| `admin_audit_log(id bigserial, at, actor_id, actor_roles, action, target_type, target_id, old_value jsonb, new_value jsonb, reason, approval_id, outcome, detail)` | Append-only. Trigger refuses UPDATE, DELETE and TRUNCATE; table privileges revoked from everyone but the owner role. |
| `admin_sensitive_actions(action pk, permission_required, risk, expires_hours, notes)` | The **server's** list of which actions need approval. The page does not decide this. |
| `admin_approval_requests(...)` | See section 4 |
| `admin_my_access()` | Returns `{active, roles[], permissions[]}` for `auth.uid()` |
| `admin_has(text)`, `admin_require(text)` | `admin_has` returns boolean from `auth.uid()`; `admin_require` raises `42501` and writes a refusal row to the audit log |
| `admin_log(action, target_type, target_id, old, new, reason, approval_id, outcome)` | The one internal write path to the audit log |

Bootstrap: the owner runs **one** statement in the SQL editor to create the first Super Admin (the AI writes it with the owner's real admin email; no placeholders). After that, admins are created only from the Admin Team screen. The last active Super Admin cannot be removed or demoted (trigger).

Integration with existing pieces (**A0 part B decided, 2026-11-07**): `support_staff` has **0 rows**, so there is nothing to migrate. A1 adds the first Super Admin to `support_staff` as well (the bridge) so that `support.html`, every `support_*` function and every `is_local_tasker_admin()` policy keep working for her; `_is_support()` is **not** changed in A1 (decided in A1: it is used by many live policies); it is extended, never narrowed, in A13 to also accept an active admin holding `disputes.manage`. Because `is_local_tasker_admin()` is just `_is_support()`, anyone with that permission also gets the Local Tasker admin reads: A1 says so in its notes. Keep `support_staff` working. Read `is_local_tasker_admin` (exists in the coordinator policies list) and decide whether it becomes a wrapper of `admin_has`.

## 4. One shared approval system

```
admin_approval_requests
  id uuid pk, action text, target_type text, target_id text,
  payload jsonb, payload_hash text,          -- hash of action + target + payload
  previous_value jsonb, target_version text, -- state at request time, to detect change
  reason text (>= 10 chars), risk text,
  status: pending | approved | rejected | expired | consumed | cancelled
  requested_by, requested_at, expires_at (default 72 h from admin_sensitive_actions)
  decided_by, decided_at, decision_reason
  consumed_at, consumed_by, execution_result jsonb
```

Functions: `admin_request_approval(action, target_type, target_id, payload, reason)`, `admin_decide_approval(id, approve, reason)`, `admin_cancel_approval(id)`, and `admin_consume_approval(id, action, target_id, payload)`.

`admin_consume_approval` is called **inside** every sensitive function, in the same transaction, after `select ... for update` on the request row. It refuses: missing id, rejected, expired, cancelled, already consumed, action mismatch, target mismatch, payload hash mismatch, target changed since request (`target_version`), self-approved (`decided_by = requested_by`), decider without `approvals.decide`. On success it marks `consumed`, stores the execution result, and writes the audit row. The subscription functions listed in brief section 9.3 call it; they never invent their own check.

Super Admins are notified through the existing `notifications` table (note: this also emails them). Sensitive actions at launch: price changes (plan, add-on, coordinator tier), subscription override, adjustment, credits, payment-review resolution, commission and fee changes, withdrawal limits, admin role and permission changes, broadcast above the recipient threshold. Everything else is permission-only plus audit.

**Practical gap to settle (D-A10):** requester and approver must be different people. If the owner is the only Super Admin, her own sensitive actions can never be approved. Either appoint a second Super Admin, or keep the SQL editor as the owner's own route for those changes (as today) and let the page cover staff-initiated requests only.

## 5. Audit

- One new `admin_audit_log` for everything the admin area does (including refusals).
- Existing logs stay exactly as they are: `subscription_admin_log`, `subscription_events`, `dispute_events`, local booking events, identity audit, coordinator logs. A read-only view `admin_activity_feed` unions them with the new log for the Security screen. Nothing is deleted or rewritten.
- Reading someone's private conversation or revealing a masked field writes an audit row (the existing `chat_viewed` dispute event is the model).

## 6. Stages

Standing owner rules apply to every stage: **one stage per session, then stop and wait for "go"**; SQL is additive, safe to run twice, with a rollback file; owner uses only the SQL editor and dashboard function deploys; deliver `admin-<ID>.zip` containing changed files in repo layout plus the whole `docs/admin-control-centre/` folder plus `ADMIN-HANDOFF.md`; write `handoffs/<ID>.md`; update `ADMIN-HANDOFF.md` and `IMPLEMENTATION-STATUS.md`; end with a numbered "What you do now" list; never claim a test passed, SQL applied or a deploy done unless it really happened; follow the "owner silence means success" convention only for "applied/deployed", never for "tested".

**Size gate.** If a stage would need more than about 3 pages, 3 SQL files or 1 Edge Function, split it (A12a, A12b) in the stage note before writing code.

| ID | Stage | Ships | Needs from owner | Done when | Priority |
|---|---|---|---|---|---|
| **A0** | Introspect and gather | **DONE 2026-11-07 (part A and part B).** Nothing built. Owner runs `sql/admin/a0-introspect.sql`; AI writes `ARCHITECTURE.md` with the real schema map and fixes every UNVERIFIED in `01` and `02` | Run 17 read-only blocks; send results; send the missing files (`01` section 6); answer `03-OWNER-DECISIONS.md` | Real names recorded; open questions closed or listed | **Done. Next: A1** |
| **A1** | **WRITTEN 2026-11-07 (not applied until the owner reports it).** Admin identity and permissions (SQL) | `a1-admin-core.sql` (+rollback+tests): tables, `admin_has`, `admin_require`, `admin_my_access`, audit table with append-only trigger, role and permission seed, `support_staff` bridge (the table is empty today), bootstrap statement for **admin@streettasker.com** (the statement first checks that this account exists in Supabase Auth and says so plainly if not). New names must not clash with the existing `admin_approve_coordinator_application`, `admin_create_coordinator_code`, `admin_reject_coordinator_application` | Run SQL; run the bootstrap statement | Tests show: non-admin refused, inactive admin refused, wrong permission refused, audit row cannot be updated or deleted, last Super Admin cannot be removed | P1 |
| **A2** | **WRITTEN 2026-11-08 (not applied until the owner reports it).** Approval infrastructure (SQL) | `a2-approvals.sql` (+rollback+tests): request, decide, cancel, consume, sensitive-action registry, expiry, notifications to Super Admins | Run SQL | Tests cover: self-approval, wrong decider, reuse, mismatch, expired, changed target, double consume | P1 |
| **A3a** | **WRITTEN 2026-11-08 (browser-tested against a fake Supabase only).** Admin frame and sign-in | `admin/login.html`, `admin/index.html`, `css/admin.css`, `admin/js/admin-shell.js`, `admin-login.js`, `admin-index.js`; `DESIGN-SYSTEM.md` 4.17; admin tokens; `robots.txt`; `vercel.json` headers (frame deny, no-store) | Copy files; try the real sign-in and report | Page loads for an admin, "No access" for anyone else, three widths checked | P1 |
| **A3b** | **WRITTEN 2026-11-08 (fake-Supabase tests only).** My Profile and the guard | `admin/profile.html` + `admin/js/admin-profile.js`; `js/auth.js` turns admin logins away from customer pages (ask the owner about the `admin@streettasker.com` customer row first) | Copy files; answer the login question | Profile shows own data only; sign out of all devices works; guard tested with a customer login and an admin login | P1 |
| **A3c** | **WRITTEN 2026-11-08 (fake-Supabase tests only; SQL not run).** Help and two-step verification | `admin/help.html`; TOTP set-up and challenge so `require_mfa` can be switched on safely | Copy files; enrol an authenticator | Owner can enrol, sign in with a code and switch `require_mfa` on without a lock-out | P1 |
| **A4** | **WRITTEN 2026-11-08 (fake-Supabase browser tests only; SQL not run).** Dashboard (read) | `a4-dashboard.sql` with `admin_dashboard_summary()`; `admin/dashboard.html` | Run SQL; copy files | Every number traceable to a table; unavailable sources show "Not available" | P1 |
| **A5** | Approvals screens, Admin Team, Roles | `admin/approvals.html`, `approval.html`, `team.html`, `roles.html`; Edge Function `admin-invite` (one-file bundle in `supabase/deploy/`); SQL for invite, role assign, deactivate | Deploy function; copy files | Invite creates a login; role changes create approval requests; self-approval blocked on screen and in SQL | P1 |
| **A6** | **WRITTEN 2026-11-08 (fake-Supabase browser tests only; SQL not run).** Audit and security reader | `a6-activity-feed.sql` (view and reader function); `admin/audit.html` | Run SQL; copy files | Union view shows old and new logs; no edit path exists | P1 |
| **A7** | Customers | `admin/customers.html`; SQL reads and suspend/restore | Run SQL; copy | Search, profile, suspend and restore with reason; history preserved | P2 |
| **A8** | Regular Taskers | `admin/taskers.html`; reads incl. wallet read-only | Same | Profile tabs work; no edit of rating, wallet or verification | P2 |
| **A9** | **WRITTEN 2026-11-09 (scratch-Postgres 83 checks, fake-Supabase browser 45 checks; SQL not run on Supabase).** Coordinators and applications | `admin/coordinators.html`; SQL wrappers for approve/reject application (wrapping the existing `admin_*_coordinator_application` functions after their permission checks are read, `a0-followup.sql` F1), NEW first-assignment function (none exists; `coordinator_assignments` is written today only by an Edge Function or SQL). **Reassign already exists in the repo as `admin_reassign_local_tasker` (stage F-6, applied unknown): A9 replaces its check `is_local_tasker_admin()` with `admin_guard('coordinators.assign', ...)` (CREATE OR REPLACE, same body) so that the A13 extension of `_is_support()` cannot let a Support Admin reassign. See `ARCHITECTURE.md` Part D item 3**, deactivate. **The limit already exists** as per-tier capacity in trigger `coordinator_assignments_guard`: A9 reuses it and tests that an over-capacity assignment is refused. Optional: split into A9a (read, applications) and A9b (assign, deactivate) | Same; run `a0-followup.sql` F1 and F3 first | An assignment beyond the coordinator's tier capacity is refused by the database; applications list works; test link returned | **P1 (unblocks H6, H7)** |
| **A10** | **WRITTEN 2026-11-09 (scratch-Postgres 87 checks, fake-Supabase browser 44 checks; SQL not run on Supabase).** Local Taskers | `admin/local-taskers.html`; reassign, unpublish, deactivate; unassigned list | Same | Reassign respects the limit; no price editing exists | **P1** |
| **A11** | Identity verification | `admin/verification.html`; reads of `idv_*` data | Same | Shows provider results only; no manual verified flag; memberships never shown as identity | P2 |
| **A12** | Bookings, tasks, **local booking operations** (needs `a0-followup.sql` F2 for the real `bookings.status` values; consider splitting into A12a read-only queues and A12b the H1, H3 and H4 hooks (H2, the call-back, was removed by stage F-2), because 50 `local_booking_*` functions exist) | `admin/bookings.html`; wrappers for H1 reassign, H2 call-back, H3 unlock, H4 exceptions | Same | Queue for each hook; every action logged; none releases money | **P1 (unblocks H1 to H4)** |
| **A13** | Disputes (move the support console) | `admin/disputes.html` reusing `support_*` functions; `_is_support()` extended; `support.html` kept until proven | Same | Same cases, same outcomes as `support.html`; local bookings appear; subscription payments do not | **P1 (H5, H11)** |
| **A14** | Services, reviews, reports, community | `admin/services.html`, `reviews.html`; hide with reason **in a NEW column or table, never a new `listing_status` value (it allows only `active` and `paused`)**; flagged users (H12; the flag lives on `users`: `contact_violations`, `is_flagged`, `flagged_reason`) | Same | Hide/unhide logged and reversible; no negative-review removal reason | P2 |
| **A15** | Transactions and reconciliation | `admin/transactions.html`; purpose filter; export; **includes a Donations tab** (table `donations`, permission `donations.view`: flagged, stuck and receipt-not-sent donations; donor email masked) | Same | Job, subscription, coordinator, gift-card and urgent-fee rows are labelled apart | P2 |
| **A16** | Revenue and commissions | `admin/revenue.html`; four separate reports | Same | Local Tasker earnings excluded from commission; definitions printed | P2 |
| **A17** | Earnings and payouts watch | `admin/payouts.html` (regular and Local sections) | Same | Stuck and failed withdrawals visible; no money-moving control | P2 (H9) |
| **A18** | Subscriptions, read-only | `admin/subscriptions.html` from the real subscription schema (tables are now known: `subscriptions`, `subscription_plans`, `subscription_receipts`, `subscription_events`, `subscription_payment_details`, `subscription_settings`, `subscription_admin_log`, `offer_credits`, `offer_usage`); also report the row count of `subscription_card_authorizations` (rule R-C) | **`ADMIN-REQUIREMENTS.md` and `docs/subscription/`** | Overview, plans, subscribers, payments, timeline, review cases | P2 |
| **A19** | Subscription writes with approvals | Wrappers for the real subscription functions using `admin_consume_approval` | Same, plus confirmed signatures | Every write refused without a valid approval; reason >= 10 chars; event row written | P3 |
| **A20** | Coordinator plans | `admin/coordinator-plans.html` | Same | Revenue kept apart from subscriptions | P3 |
| **A21** | Gift cards and referrals | `admin/giftcards.html`, `referrals.html` | Same | Errored and undelivered cards visible | P3 |
| **A22** | Notifications and announcements | `admin/notifications.html`; send function with recipient count, daily cap, approval threshold | Same | Broadcast shows email warning and count | P3 |
| **A23** | Website content and help | NEW content tables; `admin/content.html`; public pages read with static fallback | Same | Site still renders when the table is empty or unreachable | P3 |
| **A24** | Analytics | `admin/analytics.html` | Same | Every chart has a definition and a source | P3 |
| **A25** | Local Tasker impact | `admin/impact.html` | Same | Only counts from rows | P3 |
| **A26** | Platform settings | `admin/settings.html`; sensitive keys through approvals | Same | Changing commission needs an approved request and never rewrites history | P3 |
| **A27** | Security review and monitoring | RLS and grant audit of every `admin_*` object; the findings of `ARCHITECTURE.md` Part C items 6 to 12 (wide anon and authenticated grants, every user readable by every login, plain-text sensitive columns); admin sign-in log; fix list for the owner (including the browser-verified urgent fee) | Run read-only checks | Written security report with real results | P2 |
| **A28** | Regression and final handoff | Walk the existing flows (sign-up, login, post task, booking, messaging, payment, wallet, subscription, coordinator, Local Tasker, verification) and the admin flows; final report and deploy checklist | Test with the two test accounts only | Report lists what ran and what did not | P1 at the end |

**Rule R-SELF (2026-11-08).** Because the first Super Admin login is also a coordinator login, every `admin_*` function that acts on a coordinator, a Local Tasker, a booking or a payout refuses when the target belongs to the acting admin's own coordinator account (and an admin can never act on their own admin record, approve their own request, or reassign Local Taskers to or from themselves). Each such function tests this. The audit log shows the refusal. A later second login for admin work removes the need, but the rule stays.

**Separate security stage S1 (not part of the admin build; the owner decides when).** Move the three literal secrets out of the `push-notifications` trigger and the `gift-card-deliveries` cron job into Supabase Vault and rotate them (`ARCHITECTURE.md` Part C item 6). Needs the owner's go, because rotating the service-role key breaks every Edge Function until its environment value is updated. It does not block A1.

**Recommended order** (launch-blockers first, read-only before write): A0, A1, A2, A3, A4, A6, **A13, A9, A10, A12**, A5, A7, A8, A11, A15, A17, A16, A18, A14, A27, A19, A20, A21, A22, A23, A24, A25, A26, A28. A5 can move earlier if the owner wants staff accounts sooner.

## 7. Testing approach (honest about what is possible)

- SQL: each SQL stage ships a `*-tests.sql` that runs on a scratch Postgres (earlier sessions used a local Postgres 16 or PGlite). If no Postgres is available in the session, **say "SQL not run"** in the handoff. Never claim otherwise.
- Pages: headless browser with a stubbed Supabase client at 390, 768 and 1280 px, as earlier stages did. Stub tests prove layout and logic, not real data.
- Real checks happen on production with the two test accounts only, run by the owner, with results sent back.
- Every SQL stage must include these security tests: anonymous call refused, signed-in non-admin refused, inactive admin refused, admin missing the permission refused (and the refusal logged), direct `select`/`insert` on each new table refused for `authenticated`.
- Every page stage runs `node tools/check-design-system.js`. Do not edit `tools/design-baseline.json` to make it pass.
- The existing Node tests in `tests/` are not deployed by the owner; treat them as local checks only.

## 8. Things that must not change (regression list)

Customer and tasker sign-up and login; coordinator login and portal; `post-task`, `post-service`, `find-*` pages; messaging; `payment-init`, `payment-verify`, `paystack-webhook`; escrow release code flow; wallets and withdrawals; subscription pages and the offer gate; Local Tasker creation and payout verification; Didit verification pages; `support.html` until A13 is proven. The only existing files an admin stage may edit are listed in that stage's note: expected so far `js/auth.js` (admin turn-away), `robots.txt`, `vercel.json`, `DESIGN-SYSTEM.md`, and (A13) the body of `_is_support()`.

# Owner decisions and introspect findings (recorded 2026-10-30)

## Owner answers to D-V1..D-V8
| ID | Answer | How it is applied |
|---|---|---|
| D-V1 | Hosted Didit flow (default) | Unchanged. |
| D-V2 | Changed from the default. Old users must be emailed to re-verify, and their account is disabled until they do. Keep only the two test accounts `naomibabadiya@gmai.com` and `msgracekathy@gmail.com` as they are. | New stages V1g (re-verification gate) and V1f (old ID numbers) below. See open questions Q1, Q2, Q4. |
| D-V3 | Default (Approved + liveness + face match + NIMC `full_match` for Nigerian documents; partial match = review) | Unchanged. |
| D-V4 | Changed. Customers must also verify before their tasks go live, with an easier flow and proof of address. | Schema allows `subject_kind = 'customer'` from V1a. Customer flow (second Didit workflow with proof of address) is a new stage V6. Taskers go first. |
| D-V5 | Default (Didit console reviewers; coordinators see "needs review" only) | Unchanged. |
| D-V6 | Default for the record location. Because unverified users are blocked (D-V2, D-V4), VERIFIED is effectively a blocking check. | Exact blocking points decided in V1g and V3d. |
| D-V7 | Default (owner decides later after reading Didit's retention page) | Still open. Does not block V1 or V2. |
| D-V8 | Default (no biometric claims until a lawyer approves wording) | Still open. Blocks V3a wording only. |

## Questions Q1 to Q5: ANSWERED 2026-10-30
- **Q1** "Disabled until re-verified" means: the user CAN sign in, but every page and action except the verification page (and logout) is blocked until VERIFIED. Confirmed.
- **Q2** The test account is `naomibabadiya@gmail.com` (the `gmai.com` in the answer was a typo). The other is `msgracekathy@gmail.com`. Confirmed.
- **Q3** "Old users" includes customers as well as taskers. Only those two test accounts stay exempt. Confirmed.
- **Q4 ANSWERED (2026-10-30, from the owner's function code and SQL results).** Email path today: every INSERT into `public.notifications` fires trigger `notifications_email` -> function `email_new_notification()` -> `net.http_post` to Edge Function `send-notification-email` -> Resend. Secrets of that function: `RESEND_API_KEY`, `EMAIL_FROM`, `WEBHOOK_SECRET`, optional `SITE_URL`. The Resend sending domain is `contact.streettasker.com`; the exact From address lives in the `EMAIL_FROM` secret (not needed by us). The email uses a generic template (title, message, button "View on StreetTasker"); the button goes to `SITE_URL + data.url` when `notifications.data.url` starts with `/`. It looks up the user's email in Supabase Auth, so users who never log in are still reachable.
  CONSEQUENCE: the re-verification email needs NO new Resend code. V1g inserts one notification per user (via `_notify`, with `data = {"url": "/verify.html"}`) and the existing pipeline emails it. Caveats for V1g: (a) the send is fire-and-forget: failures are swallowed, so there is no delivery proof; (b) a bulk insert fires one email per row at once: send in small batches and check the Resend plan's rate limit; (c) the email wording is the notification title/message, so it must be written to stand alone.
  SECURITY NOTE: the body of `email_new_notification()` contains the webhook secret in plain text (it was shown in a result file shared in chat). Anyone holding it can make `send-notification-email` email any user with text of their choosing. The owner has decided NOT to change it (2026-10-30). The secret value is NOT stored anywhere in this package; keep it that way and do not raise it again.
- **Q5** (merged into Q4.)

## Introspect findings (blocks 1 to 6, files in `sql/verification/results/`)
**F1 is CONFIRMED and worse than the handoff assumed. A signed-in user can mark themselves verified with their own login, no browser fallback needed.**
- `users`: policies `auth_own_users` (ALL, own row) and `users: owner update`; `authenticated` holds UPDATE on `is_verified` and `verified_at`; no triggers on the table.
- `taskers`: policies `auth_own_taskers` (ALL), `taskers update own` and others; UPDATE on `is_verified`, `verified`, `verified_at`; no triggers. NOTE there are TWO flags, `is_verified` and `verified`; the second is not mentioned in the handoff.
- `verifications`: a user may INSERT own rows with no check on `status` (so `status='approved'` can be inserted), and UPDATE own rows while pending. No triggers.
- `process_verification(p_user_id uuid)` is SECURITY DEFINER and never checks `auth.uid()`: any caller who can run it can approve any user who has a pending row. Its "check" is a format regex, a loose name LIKE and an age check. Who can EXECUTE it was not in the results.
- `anon` and `authenticated` both hold DELETE, TRUNCATE and TRIGGER on `users`, `taskers` and `verifications`. RLS does not stop TRUNCATE. The Supabase API does not expose TRUNCATE, so this was not shown to be exploitable, but the grants should be removed (V1d).
- `local_tasker_profiles`: `authenticated` has SELECT only, read policy `coordinator_manages_tasker(...) OR is_local_tasker_admin()`. Good.
- `users` has no email column (email is in Supabase Auth). Relevant for V1g.
- Existing helpers to reuse: `_notify(p_user, p_type, p_title, p_msg, p_data)`, `local_tasker_audit(p_action, p_entity, p_entity_id, p_before, p_after, p_actor)`, `is_active_coordinator()`, `coordinator_manages_tasker(...)`, `is_local_tasker_admin()`.
- Not yet seen: the check constraint on `local_tasker_consents.purpose` and the body of `local_tasker_consent_guard`. Needed at V1c (the new purpose `identity_verification`).

## Added findings (V1b-2 introspect, 2026-10-30)
- Audit: `local_tasker_audit()` writes to `local_tasker_audit_log` through `local_tasker_scrub()`, is generic (free-text entity) and append-only. Reusable for all subject kinds.
- `_notify()` swallows all errors by design; every notification row is emailed.
- `local_tasker_consents`: purpose list has no `identity_verification` (V1c must extend it); rows are insert-only; the foreign key to `local_tasker_profiles` means regular taskers and customers need a separate consent record.
- Active coordinator of a Local Tasker: `coordinator_assignments` (`coordinator_id`, `tasker_user_id`, `ended_at is null`) + `coordinators.status = 'active'`. `is_local_tasker_admin()` = `_is_support()`.

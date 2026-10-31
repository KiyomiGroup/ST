# Didit stage V3b: self-mode behaviour of the verify page

## Done
- `pending-ui/js/verify.js` (new, replaces the old soft-check file): reads the status with `idv_my_status()`, shows exactly one status panel, records consent with `idv_give_consent('v1')`, calls `didit-create-session` (`{mode:'self', request_id}` only), checks the returned link is https on didit.me, then redirects. On return from Didit (a session flag set before redirect, or a `verificationSessionId` parameter) it calls `didit-sync {returned:true}` first and then reads the status. "Check again" calls `didit-sync {returned:false}`, then reads; it pauses 5 s between checks (each check is one Didit request). `ABANDONED` shows the FAILED panel. Text is written with `textContent` only (no innerHTML).
- The browser-side approval is GONE: nothing in the file writes `is_verified`, `verified`, `verified_at` or any status; it no longer asks for or validates ID numbers; `process_verification` is no longer called. Success is shown only from the server read.
- Kept for other pages (same names): `window.ST.verify.isUserVerified()` (read of `users.is_verified`, set only by the server), `getVerificationStatus()` (now mapped from the server status to the old shape `{status: approved|pending|rejected, rejection_reason: ''}`; the reason is always empty, Didit reasons are never shown), `requireVerification(action)`. Added `getServerStatus()`. REMOVED exports (only the old verify page used them, and that page is replaced): `submitVerification`, `validateIdFormat`, `getIdHint`, `ID_RULES`.
- Kept on purpose: after the SERVER says VERIFIED the page publishes the user's draft tasks and services (the old behaviour). V3d decides the final gating.
- Consent text rewritten from research: `docs/verification/CONSENT-WORDING.md` (also has the answers to the owner's three questions and a proposed replacement for section 4 of `privacy.html`). `pending-ui/verify.html` updated: consent block, "Contact support" now `mailto:hello@streettasker.com` (`contact.html` does not exist), header comment. `pending-ui/css/verify.css`: list bullets and spacing only.

## Exit check
- `node --test tests/verify-page.test.mjs` (fake DOM, stubbed Supabase, Node 22): **15 passed, 0 failed.** Covers: tick needed before start; consent v1 recorded then create-session called with only mode and request_id; links that are not https on didit.me refused (4 bad links); consent already given; version mismatch blocks; all 9 statuses show the right panel and start area; same-site return only (4 bad targets ignored); sync before read on return and none otherwise; sync failure keeps the saved status; read failure shows an error and no panel; "Check again"; no write to any verification table or flag; source has no innerHTML, no ID-number code; legacy helper mapping. Mutation check: 7 deliberate breakages (no link check, open redirect, no sync on return, consent assumed, start always enabled, ABANDONED unmapped, drafts published when not verified) were each caught; one more mutation turned out to change nothing (equivalent) and is not counted.
- `node tools/check-design-system.js` on a COPY of the real repo with the three new files laid over it: **passed** ("1 count below baseline"; nobody ran `--update`, `design-baseline.json` untouched).
- Rendered with headless Chrome at 1280 and 390 px (not-started, failed, verified): no horizontal scroll; consent block readable after the list fix. Screenshots were looked at, not archived.
- **NOT run:** a real sign-in, real Supabase, Didit, the deployed functions, Deno. The first real run is the owner's sandbox test below. The Didit callback parameter name `verificationSessionId` is a guess; the session flag makes the return work without it.

## Open issues
1. **privacy.html contradicts the new flow** (section 4 says documents are not shared with third parties). Fix before launch; draft in `CONSENT-WORDING.md`.
2. D-V7 (retention) must be set in the Didit console and written in the privacy policy, or the consent sentence "then deletes them" is not true.
3. Withdrawal is by email only; a button needs a Didit delete step (not built).
4. Old verify.html calls go away with the replacement; `dashboard-tasker.html` and `edit-profile-common.js` still work through the compatible helpers. Their "rejected" box now shows the generic text, never a reason.
5. Proxy panel (coordinators, Local Taskers) stays hidden: that is V3c. A Local Tasker who opens the page gets the generic read error.
6. Customers cannot start until V6 (create-session answers 503 for them).

## Owner steps, in order (SQL editor, dashboard and GitHub only)
1. Deploy the three functions: `docs/verification/DEPLOY-FUNCTIONS.md` (only files in `supabase/deploy/`). Test accounts only: naomibabadiya@gmail.com, msgracekathy@gmail.com.
2. Copy into the repo in ONE commit: `pending-ui/verify.html` -> `verify.html`, `pending-ui/css/verify.css` -> `css/verify.css`, `pending-ui/js/verify.js` -> `js/verify.js`. Do not copy any of them alone.
3. Sign in as a test account, open `verify.html`, run a Didit SANDBOX verification, and tell me what happened (screen text only, never keys).

## Next
Default: **V3c (proxy mode)** after the owner's sandbox result; or V1g/V1d. Do one stage and wait for "go".

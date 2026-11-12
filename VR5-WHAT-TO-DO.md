# VR5: cleanup, copy, and the Didit monthly counter

Nothing here changes how money is checked (VR2 and VR3 stay as they are). It removes the old "verify first" wording, and adds a Didit counter to the admin page.
Source: your ST-Real-Main zip of 2026-11-12 (VR4 already in it). Files in this zip sit at the same paths as in the repo: copy them over your repo copies. None is a categories file.

## Do, in this order
1. Supabase SQL editor: run `sql/verification-rework/vr5-didit-usage.sql` (whole file, safe to run twice). Last row must say `DONE: VR5 Didit counter installed.` Needs VR3a (table `verification_rules`) and A11. Undo: `vr5-rollback.sql`.
2. Upload the changed files (list below) to GitHub.
3. Apply the patches in `VR5-PATCHES.md` by hand to your own latest `post-service.html`, `post-task.html` and `js/tasks.js` (find and replace; 14 small patches, each checked to match exactly once in the 2026-11-12 zip).
4. Nothing to change or delete on GitHub or Supabase besides that. Edge Functions are not touched.

## Changed files (whole files)
- Prompts and copy: `dashboard-tasker.html`, `my-services.html`, `js/my-services.js`, `edit-profile-tasker.html`, `js/edit-profile-tasker.js`, `edit-profile-customer.html`, `js/edit-profile-customer.js`
- Verify pages: `verify.html`, `js/verify.js`, `js/verify-retry-nudge.js`
- Text: `terms.html` (10.1), `privacy.html` (7.3), `payments.html` (6.2), `js/learn-content.js` (one step in "Payments")
- Admin: `admin/js/admin-verification.js`, new `sql/verification-rework/vr5-didit-usage.sql`, `vr5-rollback.sql`

## What changed
- Dashboard: "Get Verified" button next to Save removed. Draft services say "Not live yet" with an Edit link instead of "Verify to Post".
- My Services: the "Verify to Go Live" side card is gone; drafts get Edit as their main button.
- Edit profile (tasker and customer): the strip says verifying is optional (asked at the first withdrawal, or over ₦10,000 for customers) with a "Verify identity" button. When a person verifies, the profile-strength ring can reach 100% (that item was kept). The "ID not verified yet" chip is gone from both.
- `verify.html` / `js/verify.js`: the "Your tasks and services stay hidden" notice is gone. A reason line shows from `action=withdraw` or `action=pay`. "Why we verify" now says money is the trigger.
- `js/verify-retry-nudge.js`: the "try again" pop-up now shows only on the wallet page.
- Terms, Privacy, Payments, Learn: one line each on when verification is asked.
- Admin Identity verification, Overview: new card "Didit checks this month: N of 30", amber from 25, red from 30, with a banner line. Reads `identity_verifications` only.

## Test
1. Brand new unverified tasker: Dashboard, My Services, Edit Profile show no "verify" button or card.
2. Brand new unverified customer: Edit Profile shows the ₦10,000 line, no button.
3. Open `verify.html?action=withdraw` and `verify.html?action=pay` (unverified): a reason line shows at the top.
4. Wallet page for an account whose last check failed: the retry pop-up shows. On any other page: it does not.
5. Admin > Identity verification: the new card shows. To see amber and red, temporarily run `update verification_rules set int_value = 1 where key = 'didit_warn_at';` then put 25 back.

## Please check / tell me
- **Which month and what counts is UNVERIFIED.** I count live checks that reached Didit, by Lagos calendar month. Open the Didit billing page and tell me whether a started check or only a passed check counts, and the month boundary. The card also shows how many passed.
- **Not done: three verify blocks on post-service.html** (mobile "Quick verification" card, the step-2 `verifyPrompt` card, and the desktop sidebar "Identity Verification" card with its "Verify My Identity Now" button). They still say "verify before going live". Removing them changes the page layout, so tell me whether to remove them or replace them with something (I can do this as the next patch). Patches 3 to 5 already fix the subtitle and notes.
- Wording is mine, not approved by you. Terms, Privacy and Payments text is not lawyer-approved. Their "Last updated" dates were not changed: set them to the day you release.
- The urgent fee is paid straight through Paystack in the browser, not through `payment-init`, so it is not in the customer ₦10,000 total (VR3).
- `idv_reverify_run`: checked, no cron job runs it. Nothing to switch off.
- Unused CSS you can delete later: `.sv-verify-btn` (css/my-services.css), `.pt-urgent-lock*` (css/post-task.css).
- `node tools/check-design-system.js` FAILS, but it fails with exactly the same output on your unchanged 2026-11-12 zip (stale baseline: css/legal.css, local-tasker-public.css, map-view.css and others). VR5 adds no new violation.

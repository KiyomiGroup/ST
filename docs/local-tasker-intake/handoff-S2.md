# Stage 2 handoff: one-page "Add a Local Tasker" intake (2026-11-08)
Owner rules: no terminal steps for the owner; stage zip = changed files only. **No SQL and no function deploys in this stage**: it only calls database functions and Edge Functions that already exist, with the same inputs the existing pages send.

## What the coordinator now gets
Add Local Tasker (coordinator-tasker-new.html) is the whole first meeting on one page:
1. Profile and agreement (the old form; button now "Save profile and continue").
2. On save the page does NOT leave. It stays on the same page (address becomes coordinator-tasker-new.html?id=...) and opens, in order: a "Before you leave this Local Tasker" checklist, Services and agreed rates (add up to 5), Payout account (bank check + agreement), Identity check (consent, start, link to hand over, Check again), Photos (optional, up to 8).
3. Reopening the page with ?id= (refresh, or coming back) continues the same person.
4. "What to collect and explain" button with an info icon in the hero opens a pop-up: what to ask them to bring, every item collected, what to explain (how it works, privacy, bookings, prices, identity check, payouts, photos), and a "before you leave" list.
5. The agreement method chosen in step 1 pre-fills the "how did they agree" boxes in the later sections; each section still needs its own ticked confirmation and records its own agreement (same as before).

## Files
- js/coordinator-intake.js (NEW): the four sections + info pop-up, `STIntake.mount(root, taskerId, {method})` and `STIntake.mountInfo(button)`. Stage 3 reuses it on the edit page.
- coordinator-tasker-new.html, js/coordinator-tasker-new.js: stay on the page after create; resume by ?id=.
- css/coordinator-intake.css (NEW): sub-forms and pop-up, tokens only.
- docs/local-tasker-intake/handoff-S2.md.
The page also loads the existing css/coordinator-tasker-verify.css (for the identity notice styles).

## Back-end calls used (all existing, unchanged)
local-tasker-create (Edge Function); save_local_tasker_service, add_local_tasker_photo, local_payout_account, idv_local_status, idv_record_local_consent (database functions); local-payout-account, didit-create-session, didit-sync (Edge Functions); storage bucket local-tasker-photos.

## Checked
Headless Chromium at 390 with a fake Supabase: create, add service, check and save bank account, start identity check (link shown), upload photo, checklist updates (2 of 3 required done while identity is in progress, as designed), info pop-up opens/closes, no sideways scroll. `node tools/check-design-system.js`: nothing listed for these files.
**NOT tested against real Supabase, Paystack or Didit.** Please do one real run with a test Local Tasker and tell me any error code shown on screen.

## Behaviour to know
- The payout section needs their full legal name (two names) from step 1, because the bank name is compared with it; the error tells the coordinator if it is incomplete.
- Identity is "done" only when the server says VERIFIED, so the checklist can legitimately show 2 of 3 when the coordinator leaves; the page tells them to start the check before leaving. Publishing still needs VERIFIED (F-2 rule).
- Services/photos agreement boxes only show the first time (the server records the agreement once per purpose).
- Editing or removing a service/photo/payout uses the existing pages (links shown). Stage 3 puts these on the Edit page.

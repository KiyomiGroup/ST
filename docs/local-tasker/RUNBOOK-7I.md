# Stage 7I runbook (Supabase dashboard + your site upload only)

What this adds: a new page `coordinator-plan.html` where a coordinator sees their tier, places used, the next tier and its price, and buys the next tier through Paystack.

**Your Paystack keys are LIVE (your decision, 2026-11-02). The first upgrade that anyone completes on this page is a REAL charge (Tier 1 to 2 is N50,000). The price is set by the database and cannot be lowered from the page. The upgrade is permanent and not refunded in the app.** Nothing in this stage was tested against Paystack.

## Step 1. Make sure the 7H-2 functions are deployed (skip if done)
Follow `RUNBOOK-7H-2.md`: paste `payment-init` and `payment-verify`, Deploy each. Until this is done, pressing Pay on the new page shows the server's message "Unknown payment type." and charges nothing.

## Step 2. Database (SQL editor)
1. Open `sql/local-tasker/stage-7i-core.sql`, select all, paste in the SQL editor, Run. Expect "Success. No rows returned". (It only adds one read function. Safe to run twice.)
2. Open `sql/local-tasker/stage-7i-tests.sql`, select all, Run. An ERROR box is normal. It must start `STAGE 7I TESTS` and end `RESULT: ALL PASS`. A `SKIP:` line is not a pass. Send me the whole box.
3. Undo, if ever needed: `stage-7i-rollback.sql`.

## Step 3. Upload the site files (same folders as in this zip)
New: `coordinator-plan.html`, `css/coordinator-plan.css`, `js/coordinator-plan.js`.
Changed: `js/payments.js`, `components/coordinator-nav.html`, `coordinator-dashboard.html`, `coordinator-tasker-new.html`.

MERGE WARNING. The four changed files are copies of the site as it was in your 2026-11-02 05:06 zip. If you changed any of them since (for example Stage 7D adds a Payments link to `components/coordinator-nav.html`), do NOT overwrite; add only these lines instead:
- `components/coordinator-nav.html`, after the Messages link in the top menu: `<a class="co-nav-link" href="coordinator-plan.html" data-co-page="coordinator-plan.html">Plan</a>`; and after the Messages link in the phone menu: `<a class="co-drawer-link" href="coordinator-plan.html" data-co-page="coordinator-plan.html">Plan &amp; upgrade</a>`.
- `coordinator-dashboard.html`: in the "Open places" tile, the note line becomes `<p class="co-stat-note"><a class="co-fact-link" href="coordinator-plan.html">See your plan</a></p>`.
- `coordinator-tasker-new.html`: inside the `coFormCap` banner, after the `</span>`, add `<a href="coordinator-plan.html">See your plan and upgrade</a>`.
- `js/payments.js`: the file differs from the old one in three places only (the end of `_verifyPayment`, the new function `upgradeCoordinatorTier`, and one line in the `window.ST.payments` list).

## What you should see (no payment needed)
1. Sign in as a coordinator, open the Overview. The "Open places" tile says "See your plan". Click it.
2. The Plan page shows: Current plan (Tier 1), Places used, Places left, Next step (N50,000, Tier 2, 20 places), a "Your places" card, a "Next step: Tier 2" card with ONE button "Upgrade to Tier 2", and "Upgrade history" ("No upgrades yet").
3. Pressing "Upgrade to Tier 2" only opens a confirmation ("Pay N50,000 now ... ?"). Pressing "Not now" closes it. NOTHING is charged until you press the green "Pay N50,000" button inside the confirmation.
4. On a phone the page is reached from the menu (three lines, top left), the Overview tile, or the Add form message. The bottom bar has no Plan item (known, see handoff).

## Your first real upgrade (when you decide to buy one)
Press Pay, complete Paystack. The page waits, then re-reads your plan from the server and shows the new tier and capacity. If it shows a message with a "Payment reference", copy the reference and send it to me. Do not pay a second time.

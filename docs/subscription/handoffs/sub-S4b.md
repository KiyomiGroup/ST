# Stage S4b: pricing page, hero + plan cards

Owner asked for S5d, "if you cant then S4b". S5d needs S4f (the `my-subscription` page and `js/my-subscription.js`), which does not exist, so S5d was not started. S5c-2 was confirmed deployed.

## Done
- `subscription.html` rewritten: brief section 1 (hero, exact wording, "Explore plans" CTA to `#plans`) and section 2 (plan cards). Loads `css/membership.css` and `js/pricing-plans.js`; no longer loads `js/subscription.js`.
- `js/pricing-plans.js` (NEW, one file beyond the row's list: the cards need a script and S4b/S4d rules forbid reusing the old one). Reads `get_public_plans()`; for a signed-in person also `get_my_entitlements()` to mark the current plan. No price, limit or plan name in the file. Cards: name + PRO/PREMIUM label (S4a classes, after the name), price, 8 feature lines with included / not included (screen-reader text too), one button. Professional = "Most popular" (`POPULAR_KEY`, a label choice only); Business = dark premium card.
- `css/subscription.css` rewritten, tokens only (old file had raw colours).
- States: loading skeleton, error with "Try again", signed out (Free: "Start free" -> signup.html; paid: "Log in to choose" -> login with redirect back), signed in (current plan disabled "Your current plan"; other paid plans "Choose <name>").
- **The paid "Choose" button does not charge anything yet.** It calls `window.StPricing.onChoose(planKey)` when S5d sets it; until then it shows "Plan checkout is not open yet. Nothing was charged and your plan has not changed."

## Removed from the old page (all contradicted the new plans: old plans/prices, "5 free connections", mock slot meter, browser-side subscription write)
Slot meter, billing toggle, three hardcoded plan cards, old comparison table, old FAQ, upgrade/sprint modals, inline `initPage`. Their replacements are S4c (comparison, why upgrade, visibility) and S4d (FAQ, final CTA). `js/subscription.js` is now loaded by NO page; delete it in S4d (still contains `recordSubscriptionChoice`).

## Exit check
- RUN: `node tools/check-design-system.js`: only the three allowed reference-copy failures.
- RUN: `node --test tests/s4b-pricing.test.mjs`: 5 pass (no price/limit/old plan in page or script, old script and modals gone, only the two RPCs, brief hero wording, tokens-only CSS). Earlier tests still pass: s4a 4, s5b 68, s5c2 38.
- RUN (headless Chromium, SUPABASE STUBBED, local server): signed out, signed in on Professional, signed in on Free, plan-load failure; 1280 and 360 px; no page errors, no sideways scroll; 4 cards; clicking Choose Business shows the "not open yet" note. Script: `tests/s4b-pricing-render.py` (needs Python Playwright; not part of the site).
- NOT run: against the real database, real signed-in accounts, real phones. The real `get_public_plans` / `get_my_entitlements` answers were not seen; the stub copies the shapes from `s2a-plan-config.sql` and `s2c-entitlements.sql`.

## Open issues / notes
- Free card for a signed-in person on a paid plan has no button (the "Manage your plan" link is hidden until `my-subscription.html` exists; S4e/S4f unhides it by setting `hasManagePage`).
- "Choose Starter" for someone on Professional is a downgrade; S4f/S5d decide the wording and behaviour (scheduled, not immediate).
- The page does not gate by role; the server refuses non-taskers at payment (`not_a_tasker`).
- The bottom phone nav floats over the page as on other pages; not adjusted.
- Still open: `taskers` mirror-row answer, S3g privacy line.

## Next
**S4c** (comparison table, why upgrade, how visibility works; same files) or **S4e-S4g** then **S5d**. Owner picks.

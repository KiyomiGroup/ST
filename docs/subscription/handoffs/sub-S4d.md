# Stage S4d: pricing page FAQ + final CTA, old script retired

S4c recorded as deployed (owner sent files with no error: standing convention).

## Done
- `subscription.html`: section 6 (`#faq`, the nine questions in brief order, native details/summary, no script) and section 7 (`#get-started`, dark band: "Start free" and "Choose a plan").
- `js/pricing-plans.js`: `buildFaqLabels(plans)` fills "Professional shows PRO; Business shows PREMIUM." from the plan rows (no plan name in the page text); `applyFinalCta(ctx)` hides "Start free" for signed-in people (also when plans fail to load).
- `css/subscription.css`: FAQ accordion and CTA band, tokens only.
- `js/subscription.js`: retired. No page has loaded it since S4b. The owner deletes it from the site (a zip cannot delete). `tools/design-baseline.json` still lists it; harmless.
- Copy rules: FAQ/CTA prose has no digits, prices or plan names; no booking promise; Paystack only and wallet balance cannot pay (R-W); verification is not paid (F13); downgrade scheduled, nothing deleted (D9); cancel keeps benefits to period end.
- `tests/s4c-pricing-sections.test.mjs`: prose slice now stops at `#faq` (the FAQ has its own test).

## Exit check
- RUN: design check: only the three allowed reference-copy failures.
- RUN: `node --test` s4b (5), s4c (6), s4d (9): all pass.
- RUN (headless Chromium, SUPABASE STUBBED, `tests/s4d-faq-render.py`): 9 items, open/close, label sentence filled, Start free hidden when signed in, no page errors, no sideways scroll at 360 px; viewed at 1280 and 360.
- NOT run: real database, real phones, screen reader. Suites not in this session's zips (s4a, s5b, s5c2, s3*) were NOT re-run.

## Open issues
- FAQ answers 3, 6, 7 describe upgrade credit, cancel and automatic renewal, reminder and grace; delivered by S4f/S5d/S5e. Owner to check the wording matches how she wants renewals to work (D2).
- Same as S4c: Choose buttons charge nothing until S5d; `taskers` mirror-row answer and S3g privacy line still open.
- This session's project zips were stale (pre-S3b); only the docs kit and the S4 files were needed.

## Next
S4e (my-subscription page), then S4f, then S5d.

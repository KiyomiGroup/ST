# Stage S4c: pricing page, comparison table + why upgrade + how visibility works

S4b recorded as deployed (owner sent "do 4c" with no error: standing convention).

## Done
- `subscription.html`: brief sections 3, 4, 5 added after the cards (`#compare`, `#why-upgrade`, `#visibility`).
- `js/pricing-plans.js`: `buildCompare(plans)` builds the table from the SAME plan rows as the cards (one column per plan from the database, 10 rows: price, offers, listings, analytics, featured placement, priority recommendations, priority support, early access, expanded portfolio, membership label). Included / not included is a tick or dash plus screen-reader text. The table stays hidden if plans fail to load. Professional's column is tinted (same "Most popular" label choice as the cards).
- `css/subscription.css`: table (scrolls inside its own wrapper, benefit column sticky, tighter on phones, "Swipe sideways" hint under 640 px), why-upgrade grid, visibility grid, no-guarantee note. Tokens only.
- Copy rules kept: the six "Why upgrade?" items and the three visibility levels contain NO numbers, prices or plan names (so they cannot contradict the config); paid plans are described as a modest lift where relevance still comes first (S3f rule); featured spots rotate fairly; the note says no plan guarantees bookings, customers or income.
- `tests/s4c-pricing-sections.test.mjs` (6 tests), `tests/s4c-pricing-render.py` (stubbed browser check).

## Exit check
- RUN: design check: only the three allowed reference-copy failures.
- RUN: `node --test tests/s4c-pricing-sections.test.mjs`: 6 pass (headings, no digits/prices/plan names in prose, no booking promise, table built from plan rows, hidden until loaded + keyboard-reachable wrapper, tokens only). Earlier tests still pass: s4a 4, s4b 5, s5b 68, s5c2 38, s3b1 13, s3b2 14, s3d 12.
- RUN (headless Chromium, SUPABASE STUBBED): table has the benefit column plus 4 plan columns and every cell matches the stubbed plan rows; table hidden when the plan load fails; page cannot scroll sideways at 360 px; table scrolls inside its box and shows two plan columns plus a peek of the third. Viewed at 1280 and 360 px.
- NOT run: against the real database, real phones, a screen reader.

## Open issues
- Same as S4b (Free card button for paid users hidden until my-subscription exists; Choose buttons charge nothing until S5d).
- "Premium recommendations" / "featured" copy describes S3f behaviour (fair rotation, relevance first) but nothing on the real search pages uses S3f yet (S4i). The copy says what the plans include; if S4i changes the ranking rules, update these two paragraphs.
- `taskers` mirror-row answer and S3g privacy line still open.

## Next
**S4d** (FAQ with the nine answers, final CTA, delete `js/subscription.js`; same files), then S4e-S4g, then S5d.

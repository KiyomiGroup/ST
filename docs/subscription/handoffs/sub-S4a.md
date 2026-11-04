# Stage S4a: membership label component (CSS only)

Owner said "go do the next stage" after S5c-2 was written. S5d needs "S5c-2 deployed" (not said) and the `my-subscription` page (not built), so the next row in `02-final-plan.md` order with no Needs is S4a. No SQL, no function, no page other than the design-system demo changed.

## Done
- `css/tokens.css`: new block "Membership labels" (`--membership-{pro,premium}-{bg,ink,border}`, `--membership-gap`, `--membership-font-size`, `--membership-tracking`); all alias existing tokens, no new raw colour.
- `css/membership.css` (new): `.membership-name` (+ `__text`), `.membership-label`, `--pro` (soft mint fill, green text), `--premium` (dark forest fill, mint text), `--sm`. Tokens only. Label is after the name by markup; name wraps, label never splits; no icon, no check mark.
- `DESIGN-SYSTEM.md` section 4.12; `design-system.html`: stylesheet link + "Membership labels" demo block.
- `tests/s4a-membership.test.mjs`.

## Exit check
- RUN: `node tools/check-design-system.js`: only the three allowed reference-copy failures.
- RUN: `node --test tests/s4a-membership.test.mjs`: 4 pass (order name-then-label, only PRO/PREMIUM, no raw colours / `!important`, different tokens). Earlier tests still pass: `s5b-payment-init` 68, `s5c2-webhook` 38.
- RUN: rendered `design-system.html` in headless Chromium at 1280 and 360 px: no sideways scroll, long name wraps with the label whole. Computed colours PRO green on mint, PREMIUM mint on dark forest (clearly different). A contrast ratio was not measured.
- NOT run: on real pages (nothing uses the label yet; S4h-S4i do), real devices.

## Open issues
- Same as before: S5c-2 not deployed; `taskers` mirror-row answer and S3g privacy line still open.
- Nav role badge `TASKER` (D10) is not part of S4a.

## Next
Owner picks: **S4b** (pricing page hero + cards; needs S2a, applied) or, after "S5c-2 deployed", the my-subscription page rows (S4e-S4g) then S5d.

# Handoff: customer dashboard cleanup (2026-10-29)

Follows `accent-green-2026-10-29.md`. Dashboards were left last on purpose; this is the first of two.

## What changed (`dashboard-customer.html` only)
- **Breakpoint:** the one `700px` query is now `768px` (the chat panel switches to its phone layout at 768 like every other page).
- **Colours:** all raw hex / rgba (62 values, 33 distinct, mostly Tailwind greens, blue, amber) now use tokens. Payment-request card, pay modal, chat badges and the "Payment confirmed" card use `--color-primary`, `--color-mint`, `--color-mint-border`, `--color-forest-900`, `--color-warning*`, `--color-danger`, `--color-text-*`, `--shadow-*`. The blue "paid" badge is now solid primary with white text. The pay-modal warning box is now the warning token pair. SVG icons use `stroke="currentColor"`.
- **Inline styles:** 64 -> 7. The 7 left are `display:none` start states that the page's script switches on and off (`dashLoading`, `profileImageFile`, `profileSaveMsg`, `chatHead`, `chatBody`, `inputBar`, `payRequestBtn`); they are runtime state and stay.
- **New `css/dashboard.css`** (shared by both dashboards, prefix `db-`, tokens only), loaded after `styles.css`.
- **`css/tokens.css`:** new `--color-glass-soft` and `--color-glass-border`.
- `tools/design-baseline.json` lowered with `--update`.

## How it was checked
Signed-in render (headless Chromium, stubbed sign-in) at 390 / 800 / 1280px, before and after: same layout, no sideways scroll, mobile hero now `#0B2E1C`. The page's inline script passes a syntax check and `check-design-system.js` passes. Pages showed empty states, so the dynamic cards (notifications, bookings, payment-confirmed card, chat) were not seen with real data: look at them once on the live site.

## Review notes
- At 800px the top nav pill showed "Home / Overview / My Ta..." cut off on this page. It looked the same before the change, and it did not happen on Applications or Bookings, so it is a nav matter and not part of this change.

## Next: tasker dashboard (`dashboard-tasker.html`)
Same three passes: 700 -> 768, about 126 raw hex (includes teal `#0F766E` and the Tailwind greens), about 168 inline styles. Reuse `css/dashboard.css`; add classes there rather than in the page.

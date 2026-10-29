# Handoff: one brand green (2026-10-29)

Follows `consistency-fixes-2026-10-29.md`. Owner asked for the option that is best for consistency ("go with your defaults").

## Decision (DESIGN-SYSTEM.md, decision 6)
- **Action green = `#0F6B46`** (`--color-primary`, hover `--color-primary-hover`). Buttons, links, prices, icons, focus, badges, success.
- **Dark surfaces = forest scale.** Hero + mobile nav `--color-forest-900` (was `#013109` on mobile and `#0B2E1C` on desktop, now the same). Dark chips/panels `--color-forest-800`. Idle hero chips `--color-forest-700`.
- **Live dot = `--color-live`** (`#4ADE80`), one token instead of 4 raw copies.
- Why: `#16A34A` is 3.3:1 on white (fails WCAG AA for text); `#0F6B46` is 6.5:1. Logged-in pages used `#004F31` while logged-out used `#0F6B46`; they now match.

## What changed
- `css/tokens.css`: accent, card, Post Task, Gift Cards, hero, profile prompt, coordinator and auth green tokens now alias the primary or forest tokens. New `--color-success`, `--color-live`. Auth/work alpha tokens use the primary RGB.
- `css/styles.css`: `--green`, `--green-light`; raw `#0F6B46`, `#013109`, `#0B4D30`, `#9EF0C4`, `#4ADE80`, `rgba(22,163,74,.2)` replaced with tokens. New tablet rule (769 to 1043px) for the shared floating search bar: search on the first row, filters share the second (they used to wrap and leave one filter alone).
- `css/tasks.css`, `css/subscription.css`: status border token.
- `find-tasks.html`, `find-taskers.html`: `theme-color` `#013109` -> `#0B2E1C`.
- `js/location.js`: street badge uses the tokens, no raw fallbacks.
- `tools/design-baseline.json`: lowered with `--update`.

## Visible changes to review
- Logged-in buttons, tabs, chips, links: `#004F31` -> `#0F6B46` (lighter, same as logged-out).
- Links, prices, status badges: bright `#16A34A` -> `#0F6B46` (deeper).
- Mobile hero and top nav: `#013109` -> `#0B2E1C` (matches desktop).
- Gift Cards hero background `#013109` -> `#0B2E1C`.
- Auth and coordinator buttons: various greens -> `#0F6B46`.

## How it was checked
Logged-in render (headless Chromium, stubbed sign-in, both roles) of Applications, Bookings, Wallet, customer Applications/Bookings, Customer and Tasker Profile, Home, both dashboards at 390 / 800 / 1280px, before and after. No sideways scroll anywhere; bottom nav shows at 390 and is gone at 800+; page content is 1112px at 1280. Only the green values changed, plus the 800px toolbar fix. `node tools/check-design-system.js` passes. Pages showed their empty states (no real data), so cards with real bookings and applications still need one look on the live site.

## Still open
- About 90 one-off green tints/glows/dark neutrals inside page-scoped blocks of `tokens.css`, and the Tailwind greens in both dashboards.
- Dashboards: 700px queries, about 183 raw hex, 238 inline styles.
- Logo SVGs and the 8 illustration SVGs have their own greens (brand art, left alone).

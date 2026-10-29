# Handoff: design consistency fixes (2026-10-29)

Follows `DESIGN-AUDIT-HANDOFF.md` (the page-by-page audit). Owner decisions given in chat: page width **1112px**; do now: merge duplicate palettes, pill radius 999, replace raw colours on login / signup / onboarding, move off-spec breakpoints; **dashboards last (untouched)**.

## What changed
1. **Page width.** New `--page-width: 1112px` (`css/tokens.css`). Used by `.ap-container`, `.bk-container`, `.pt-container` (was 1120), `.wl-container` (was 1120), `.tp-decision-inner`, dashboard `.tov`. `.container` is unchanged: 1160 max minus 2 x 24 padding is already 1112 of content.
2. **Pill radius.** `--radius-pill` 100px -> 999px (`styles.css`). Literal `99px / 100px / 9999px` pill radii in `styles.css` and `find-services.css` now use the token. Dashboard HTML files were not touched.
3. **Palette merge.** 17 `--gc-*` / `--co-*` tokens whose hex equalled a `--pt-*` or `--color-forest-*` value now alias it. Three look-alike values were left alone on purpose (`--gc-green-text`, `--co-green-mid`, `--co-nav-dark`) because aliasing them would tie unrelated components together.
4. **Auth colours.** All raw hex / rgba in the login, signup and onboarding-tasker block of `styles.css` are now tokens in a new "Auth pages" block in `tokens.css` (same values). The `--auth-*` set that lived inside `.av2-page` moved there too. New core token `--color-danger-border`. The Google "G" logo moved from inline SVG (4 brand colours, 8 places) to `images/google-g.svg`.
5. **Breakpoints** (all pages except the two dashboards). 560, 600 -> 480; 640, 700, 767, 860, 900, 899.98 -> 768; min 641, 900, 901 -> 769; min 640 -> 768; min 600 -> 481; 1024, 1044 -> 1043; min 1045 -> 1044. 67 media queries changed. JS that mirrors them: `find-tasks.html` (900 -> 768), `components/footer.html` (641 -> 769), `js/messages-details.js` (`DESKTOP_MIN` 1045 -> 1044). Two tablet-only blocks (769-900px) in `messages.css` and `home-feed.html` were deleted: the floating bottom nav now ends at 768, so they had nothing left to do.
6. `DESIGN-SYSTEM.md` updated (decisions 4 and 5, page-width rule, breakpoint migration note, palette and auth notes). `tools/design-baseline.json` lowered with `--update` after the violations were removed (check passes).

## How it was checked
- Every custom property in the site (367) resolves to the same value before and after, except `--radius-pill` (intended) and `--page-width` (new).
- Before / after screenshots (headless Chromium, local files, external requests blocked) of 23 pages at 390, 700, 800, 1000, 1100, 1280, 1440px. Result: no change on 404, bookings, gift-cards, onboarding-customer, support, task-details, tasker-profile, verify, wallet, applications. Differences on the other pages are the expected ones below, plus animation noise (sidebar fade-in on find-taskers, floating badges on Home).
- `node tools/check-design-system.js` passes.

## Visible changes the owner should review (all expected)
- **Post Task / Post Service:** content is 8px narrower on wide screens (1120 -> 1112). Post Task is 17px taller at 1280+ because of the narrower column.
- **700px and 800px widths:** pages now switch layout at 768 instead of 900 / 640 / 600. Biggest effects: login (800px now shows the desktop split layout), signup, onboarding-tasker, Home and Local Taskers (700px is now the phone layout, 800px the desktop one), Find Taskers and Subscription at 800px, coordinator login and Explore Tasks at 800px (a few px taller). Messages at 800px loses the bottom-nav padding.
- Login / signup / onboarding Google button: same logo, now an `<img>` (onboarding-tasker shows a 0.1% pixel difference from image vs inline-SVG anti-aliasing).

## Not done / next AI must note
- **Not checked in a logged-in browser.** Applications, Bookings, Wallet, profiles, the app pages and coordinator pages redirect when logged out, so the screenshots show only their signed-out state. Open them signed in at 390, 800 and 1280px before shipping.
- **Dashboards untouched** (`dashboard-customer.html`, `dashboard-tasker.html`): still 700px queries, 115 / 53 raw hex, ~240 inline styles, old `var(--font)`.
- **Left off-spec on purpose:** 380px (`bookings.css`), 1164px (`post-task.css`, where the 60px page margin begins to shrink).
- **Still open (owner decision):** the accent green (#0F6B46 vs #16A34A vs #004F31 vs #013109 vs #18704B); `.container` pages keep 24px side padding while the 1112 wrappers keep a 60px margin; coordinator and support use a 1312 wrapper.
- Public internal pages (`design-system.html`, `messages-cards.html`, `messages-fixtures.html`) are still reachable.
- Do not edit `tools/design-baseline.json` by hand.

## Files in this zip (26 changed, 1 new image, this handoff)
`DESIGN-SYSTEM.md`, `components/footer.html`, `css/` (applications, bookings, coordinator, edit-profile, find-services, messages, post-task, profile-pages, styles, subscription, task-details, tasks, tokens, wallet), `find-tasks.html`, `home-feed.html`, `index.html`, `login.html`, `messages.html`, `onboarding-tasker.html`, `signup.html`, `verify.html`, `js/messages-details.js`, `tools/design-baseline.json`, new `images/google-g.svg`, this handoff.

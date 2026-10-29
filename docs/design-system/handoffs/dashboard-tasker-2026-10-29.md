# Handoff: tasker dashboard cleanup (2026-10-29)

Second of two dashboard passes (see `dashboard-customer-2026-10-29.md`).

## What changed (`dashboard-tasker.html`)
- **Breakpoint:** `700px` -> `768px`.
- **Colours:** 127 raw values (53 distinct: Tailwind greens, blue, amber, teal, red) now use tokens. The blue "complete your profile" tip is now mint/primary. The amber "payment received" card uses the warning tokens. Icons use `stroke="currentColor"`.
- **Inline styles:** 168 -> 21, all `display:none` start states that the page script toggles.
- **Classes:** shared ones reused from `css/dashboard.css` (`db-`); tasker-only ones added there under "Tasker dashboard" (`tdb-`, 70 classes: tip card, form cards, modals, draft-services box, payment-received card, crop modal).
- **Banner colour swatches:** now one class plus `data-color`; the script paints the swatch and toggles `.active` instead of writing inline borders. The 10 palette hex values and the default `#121212` stay because they are the colours taskers choose from (stored as data).
- `css/tokens.css`: new `--color-scrim-soft`.
- `css/styles.css`: the desktop "Complete Profile" button (`.st-pp-cta`) is now the primary green, not dark forest.
- Baseline lowered with `--update`; `check-design-system.js` passes.

## How it was checked
Signed-in tasker render (headless Chromium, stubbed sign-in) of the dashboard, Edit Profile and Verification panels at 390 and 1280px, before and after: same layout, no sideways scroll. JS syntax check passes and every `db-` / `tdb-` class used in the page is defined. Pages showed empty states: the booking cards, notifications, services list, work grid, payment-received card, post-work modal and banner crop modal were not seen with real data, so open each once on the live site.

## Review notes
- A few `tdb-` classes are one-offs by nature (crop modal, thumb remove button). If a second page needs one, move it to a shared class then.
- Legacy names (`--blue`, `--red`, `--text-muted`, `--amber`) remain inside the new classes; they alias the current tokens and can be renamed in a later pass.

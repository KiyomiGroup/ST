# Handoff: one-off greens in tokens.css (2026-10-29)

Third green pass (after `accent-green` and the two dashboard handoffs). Only `css/tokens.css` changed (plus the baseline); no page CSS or HTML was touched.

## What merged
- **Action green:** `--to-green`, `--to-dark-action(-hover)`, `--to-dark-selected`, `--color-nav-pill-active`, `--color-nav-badge-text`, `--tone-success-ink` -> `--color-primary` / `--color-primary-hover`.
- **Dark greens:** the Messages/Tasker dark theme (`--tm-panel`, `-deep`, `-card`, `-border`, `-chip`, `-mint-ink`), the Gift Cards hero dark set (`--gc-hero-glow-*`, `--gc-chip-bg`, `--gc-btn-dark*`, `--gc-divider`, `--gc-cz-card-bg`), `--pt-escrow-icon/deco` and `--co-hero-end` now use the forest scale (`--color-forest-700/800/900`).
- **Bright mint on dark:** `--gc-pill`, `--auth-grad-end`, `--tm-mint`, `--to-dark-accent` -> `--pt-mint`. `--color-nav-dot` -> `--color-live`.
- **Light tints:** `--tone-success-*`, `--to-green-soft`, `--co-notice-soft`, nav badge backgrounds, `--tm-mint-soft`, `--co-mint-soft`, `--auth-mint-hover-bg` -> `--color-mint`, `--color-mint-border`, `--pt-mint-soft`, `--color-primary-soft`.
- **Green-tinted greys:** `--co-page`, `--to-page-bg`, `--auth-oauth-hover-bg` -> `--color-bg-subtle`.
- **Near-black greens:** nine variants of "almost black green" -> four new tokens `--color-dark`, `--color-dark-raised`, `--color-dark-border`, `--color-dark-chip`.

## Left alone on purpose
- Gift-card artwork colours (`--gc-card-*`, `--gc-text-soft`, `--gc-mint-hover`): illustration, not UI.
- The Overview chart ramp (`--to-bar-1` to `--to-bar-6`): a data scale.
- `--pt-escrow-text`, `--tm-text-soft`, `--pt-glow` and the alpha shadows: neutral text and glows.

## Visible changes to review
Small: darker teal panels in Messages/Tasker overview (`#0F4A34` etc. -> forest `#0F3D26`), the Overview "live/accent" colour on dark (`#34D399` -> mint `#9EF1C2`), greenish page backgrounds on coordinator and overview pages -> neutral `#F7F7F7`, and the online dot (`#10B981` -> `#4ADE80`).

## How it was checked
Before/after renders (headless Chromium, stubbed sign-in, tasker and customer) of 16 pages and 4 dashboard panels at 390 and 1280px; differences are under 0.2% of pixels. Pages show empty states, so the dark panels with real content (assignments, chat, coordinator pages) need one look on the live site. `check-design-system.js` passes.

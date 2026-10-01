# StreetTasker design-system migration checklist

Tick a box only when the item is done **and** verified. Update the counts with `node tools/check-design-system.js --update` after each batch.

## How every batch is verified
- [ ] Before/after screenshots taken (desktop 1440px and mobile 390px) and reviewed by you
- [ ] Pixel difference reported per page, and every visible change explained
- [ ] `node tools/check-design-system.js` passes
- [ ] Baseline lowered with `--update` (counts only go down)
- [ ] Only the agreed area changed (logged-in views, mobile nav and other pages untouched unless listed)
- [ ] `design-system.html` still renders correctly

## Foundation
- [x] `DESIGN-SYSTEM.md` written and decisions settled (primary `#0F6B46`, fonts, breakpoints)
- [x] `css/tokens.css` created and imported by `css/styles.css`
- [x] Logged-out desktop nav built to spec in `components/navbar.html` and unified across the site (`nav-landing` retired)
- [x] Primary buttons use `--color-primary`
- [x] Old tokens that match new ones now alias them (text, border, background, amber, red, font)
- [x] Older green set (`--blue`, `--mint`, `--forest`) now alias `--color-accent*`, `--color-mint*`, `--color-forest-*`
- [x] `AGENTS.md` and `CLAUDE.md` in the project root
- [x] `tools/check-design-system.js` with baseline
- [x] `design-system.html` reference page (live tokens and components)

## Batches
### Batch 1: shared components in `styles.css` (DONE, awaiting your review)
- [x] Buttons: padding, gap, font sizes, shadows and hover colours use tokens
- [x] Badges and eyebrow use tokens
- [x] Form fields, labels and helper text use tokens
- [x] Form focus ring changed from off-palette blue to the primary green
- [ ] **You review** the previews in `previews/` and approve

Visible changes in batch 1 (all small): buttons gain about 1px of height; Large buttons are 1px bigger text and wider; Extra large buttons are narrower; badges are about 1px taller; form fields are 1px shorter; eyebrow text is 0.5px bigger; focused form fields glow green instead of blue.

### Batch 2: remaining shared components in `styles.css`
- [ ] Headings, `.section`, `.container`, grids
- [ ] Navigation (logged-in pill nav, icon bar, role badges, mobile nav)
- [ ] Modal, toast, avatar, icon box
- [ ] `css/tasks.css` and `css/subscription.css`

### Batch 3: public pages
- [ ] `login.html`, `signup.html`, `onboarding-customer.html`, `onboarding-tasker.html`
- [ ] `index.html`
- [ ] `find-tasks.html`, `find-taskers.html`, `local-taskers.html`, `explore-tasks.html`
- [ ] `post-task.html`, `post-service.html`
- [ ] `404.html`, `privacy.html`, `terms.html`, `verify.html`

### Batch 4: logged-in pages
- [ ] `home-feed.html`, `messages.html`, `subscription.html`
- [ ] `tasker-profile.html`

### Batch 5: dashboards (largest)
- [ ] `dashboard-customer.html`
- [ ] `dashboard-tasker.html`

### Batch 6: finish
- [ ] Decide the accent green (links, badges, prices, icons) and update `--color-accent*` in one place
- [ ] Move remaining breakpoints onto 480 / 768 / 1044
- [ ] Remove inline styles that remain
- [ ] Baseline at zero (or documented exceptions), then switch the check to fail on any violation

## Current debt (from `tools/design-baseline.json`)
| File | Hex | rgb() | Inline style | !important |
|---|---|---|---|---|
| `dashboard-tasker.html` | 196 | 24 | 328 | 13 |
| `dashboard-customer.html` | 128 | 20 | 243 | 13 |
| `css/styles.css` | 101 | 110 | 0 | 88 |
| `tasker-profile.html` | 45 | 14 | 88 | 0 |
| `home-feed.html` | 12 | 14 | 64 | 0 |
| `messages.html` | 55 | 6 | 27 | 1 |
| `explore-tasks.html` | 5 | 2 | 60 | 0 |
| `index.html` | 0 | 5 | 41 | 0 |
| `post-service.html` | 6 | 2 | 32 | 0 |
| `find-taskers.html` | 1 | 0 | 35 | 0 |
| `post-task.html` | 6 | 0 | 29 | 0 |
| `subscription.html` | 3 | 8 | 21 | 0 |
| `verify.html` | 0 | 0 | 31 | 0 |
| `local-taskers.html` | 0 | 0 | 30 | 0 |
| `find-tasks.html` | 1 | 0 | 22 | 0 |
| `signup.html` | 20 | 0 | 3 | 0 |
| `components/navbar.html` | 0 | 0 | 15 | 0 |
| `css/tasks.css` | 8 | 6 | 0 | 0 |
| `js/taskers.js` | 2 | 0 | 12 | 0 |
| `onboarding-customer.html` | 1 | 0 | 13 | 0 |
| `onboarding-tasker.html` | 10 | 0 | 1 | 0 |
| `css/subscription.css` | 1 | 7 | 0 | 2 |
| `js/subscription.js` | 3 | 1 | 5 | 0 |
| `login.html` | 8 | 0 | 0 | 0 |
| `js/location.js` | 2 | 0 | 3 | 0 |
| `privacy.html` | 0 | 0 | 2 | 0 |
| `terms.html` | 0 | 0 | 2 | 0 |
| `js/future-features.js` | 1 | 0 | 0 | 0 |
| **Total** | **615** | **219** | **1107** | **117** |

## Known exceptions
- Fixed nav sizes from your spec (133, 174, 40, 1312) stay literal.
- Icon offsets and runtime-computed values (progress widths) may stay inline or literal.

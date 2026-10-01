# StreetTasker Design System (v0.2)

Single source of truth for how StreetTasker looks and is built. Every human and every AI tool must read this before editing any `.html`, `.css` or inline style in this project.

**Stack:** plain HTML, CSS and JS. No build step. Shared styles live in `css/`, shared markup in `components/`.

---

## 0. Decisions (settled)

| # | Decision | Outcome |
|---|---|---|
| 1 | **Primary button green** | `#0F6B46`. Hover is `#0B5638` (a darker step I derived; change `--color-primary-hover` if you have a Figma value). |
| 2 | **Fonts** | Manrope for headings, buttons and nav; Inter for body text. |
| 3 | **Breakpoints** | 480, 768 and 1044px (section 6). |

**Single source:** the old tokens in `styles.css` that have the same value as a new token (`--text-primary`, `--border`, `--bg`, `--amber`, `--red`, `--font` and others) now point at the new tokens, so changing a value in `tokens.css` updates both.

**Still open:** the site's other greens. Links, badges, prices, icons and the `--blue` / `--green` tokens in `styles.css` are still `#16A34A`. Only primary buttons use `#0F6B46` so far. Decide whether those should move to `#0F6B46` too, or stay as a lighter accent. Until decided, new code uses `--color-primary` for buttons only.

---|---|---|
| 1 | **Brand green.** The site token `--blue` is `#16A34A` (named "blue" but green). The nav spec uses `#168A5B`. The audit also found `#0F6B46`, `#005938` and `#0B4D30` in use. | `#168A5B` becomes the single primary. If you prefer `#16A34A`, change only the one `--color-primary` line in section 2. |
| 2 | **Body font.** Manrope is used for headings and the nav; Inter for body text. | Keep both. Manrope for headings, buttons and nav; Inter for body copy and form text. |
| 3 | **Breakpoints.** The code uses 900, 768, 700, 640, 600, 560 and 480px. | Reduce to the three in section 6. |

---

## 1. Principles

1. **Tokens only.** Colours, font sizes, spacing, radii, shadows and breakpoints come from the tokens in section 2. No raw hex, no loose `px`/`rem` values for these.
2. **Components, not one-offs.** If something looks like a button, card, badge or input, use the existing class. Do not restyle it inside a page.
3. **Pages only do layout.** A page file may arrange components (grid, spacing between sections). It may not define new colours, new button looks or new type sizes.
4. **No inline `style=""` for visual styling.** Allowed only for values computed at runtime (a progress-bar width, for example).
5. **No `!important`** unless a comment on the same line says why.
6. **Mobile and logged-in views are separate concerns.** Never change them as a side effect of a desktop or logged-out change. Scope with media queries and `body.st-logged-in` / `body:not(.st-logged-in)`.

---

## 2. Tokens

Tokens are defined in `css/tokens.css`, which `styles.css` imports at the top, so every page gets it. Names below are the target names. Rows marked "not yet created" are planned but not in the file. Legacy names in the `styles.css` `:root` block still work and are migrated page by page.

### 2.1 Colour

| Token | Value | Replaces / notes |
|---|---|---|
| `--color-primary` | `#0F6B46` | Primary buttons (`.btn-primary`, nav Post a Task). The legacy `--blue` / `--green` stay `#16A34A` for now (see section 0). |
| `--color-primary-hover` | `#0B5638` | Hover for primary buttons. Derived. |
| `--color-primary-soft` | `#EEFFF1` | Mint fill. Used by the Become a Tasker button. Replaces `--mint` (`#E8F5EC`) in nav use. |
| `--color-primary-soft-hover` | `#DFF7E4` | |
| `--color-primary-border` | not yet created | Will replace `--blue-border` / `--mint-border` once the accent green is decided. |
| `--color-forest-900` | `#0B2E1C` | `--forest-deep` (dark hero and footer backgrounds) |
| `--color-forest-800` | `#0F3D26` | `--forest` |
| `--color-forest-700` | `#16512F` | `--forest-mid` |
| `--color-text` | `#121212` | `--text-primary`, `--charcoal` |
| `--color-text-nav` | `#171A19` | Nav button text (Become a Tasker). Candidate to merge into `--color-text`. |
| `--color-text-nav-link` | `#384179` | Logged-out desktop nav link text at rest (Find Tasks, Find Taskers, Local Taskers, Gift Cards, Sign Up, Log in). Hover turns it `--color-primary`. |
| `--color-text-secondary` | `#4A4A4A` | `--text-secondary`, `--gray-600` |
| `--color-text-muted` | `#7A7A7A` | `--text-muted`, `--gray-400` |
| `--color-bg` | `#FFFFFF` | `--bg`, `--white` |
| `--color-bg-subtle` | `#F7F7F7` | `--bg-subtle` |
| `--color-bg-muted` | `#F5F5F5` | `--gray-100` |
| `--color-border` | `#E5E5E5` | `--border`, `--gray-200` |
| `--color-border-strong` | `#D0D0D0` | `--border-strong` |
| `--color-warning` | `#D97706` | `--amber`. Pair with `--color-warning-soft: rgba(217,119,6,0.1)`. |
| `--color-danger` | `#DC2626` | `--red`. Pair with `--color-danger-soft: rgba(220,38,38,0.08)`. |
| `--color-success` | not yet created | Depends on the accent-green decision. |

**Rules**
- Status colours (warning, danger, success) appear only on badges, alerts, validation and status text. Never as decoration.
- Off-palette colours found in the audit (`#0A84FF`, `#1976D2`, `#FF3D00`, `#4CAF50`, `#FFC107` and others) are bugs to be replaced with the nearest token.

### 2.2 Typography

**Families**
- `--font-heading`: `'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. Used for headings, nav, buttons.
- `--font-body`: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. Used for body text, forms, tables.

**Size scale.** The audit found 75 different `font-size` values. They collapse onto these 9:

| Token | Size | Typical use | Old values that map here |
|---|---|---|---|
| `--text-2xs` | 0.6875rem (11px) | Tiny badges, legal | 0.63 to 0.7rem |
| `--text-xs` | 0.75rem (12px) | Captions, meta rows, badges | 0.72, 0.73, 0.74, 0.75, 0.76rem |
| `--text-sm` | 0.8125rem (13px) | Secondary text, small buttons, form labels | 0.78, 0.8, 0.82, 0.83rem |
| `--text-base-sm` | 0.875rem (14px) | Dense UI body, table text | 0.84, 0.85, 0.875, 0.88rem |
| `--text-base` | 1rem (16px) | Default body, nav links, nav buttons | 0.9 to 1rem, 16px |
| `--text-lg` | 1.125rem (18px) | Lead paragraphs, card titles | 1.05 to 1.2rem |
| `--text-xl` | 1.5rem (24px) | Section sub-headings | 1.4, 1.5rem |
| `--text-2xl` | 2rem (32px) | Page headings | 2rem |
| `--text-hero` | `clamp(2rem, 5vw, 3.5rem)` | Hero h1 only | current `h1` |

Heading defaults already in `styles.css` stay: weight 700 (h1 800), line-height 1.15, letter-spacing -0.025em. Body line-height is 1.6.

**Weights:** 400 body, 500 secondary buttons, 600 links and primary buttons and labels, 700 headings, 800 h1 only.

### 2.3 Spacing

4px base. Use only these values for `padding`, `margin` and `gap`:

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 64px |
| `--space-9` | 88px (section padding) |

The audit found 46 different pixel values. Odd ones (9, 11, 13, 22, 26 and so on) snap to the nearest step. 10px and 20px are the exceptions that the nav spec depends on: add `--space-nav: 10px` for nav container padding only.

### 2.4 Radius

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4px | Tiny chips |
| `--radius-sm` | 6px | Small inputs, tags |
| `--radius-md` | 10px | Inputs, small cards |
| `--radius-lg` | 14px | Cards, panels |
| `--radius-xl` | 20px | Modals, hero blocks |
| `--radius-pill` | 999px | Buttons, badges, pills (replaces 100px, 99px, 999px, 9999px) |
| `50%` | | Avatars and circular icon buttons only |

### 2.5 Shadow, motion

Keep the existing `--shadow-xs` through `--shadow-xl`, `--ease` and `--t` (0.18s). No new shadows inside pages.

---

## 3. Layout

| Container | Width | Side padding | Use |
|---|---|---|---|
| `.container` | max 1160px | 24px (16px on mobile) | Default page content |
| `.container-home` | max 1440px | 60px | Homepage sections only |
| Nav inner | 1312px | 10px | Logged-out desktop nav only (section 5) |

**Page margin:** every page keeps a 60px no-content margin on each side (`--page-margin`). The logged-out nav is 1312px wide and centred, but on screens narrower than 1432px it becomes `100% - 120px` wide so the 60px margin stays. The margin only shrinks below 60px when the screen is under 1164px wide, because the nav row needs at least 1044px (`--nav-min-width`).

- Section vertical padding: `.section` 88px, `.section-sm` 56px.
- Grids: `.grid-2`, `.grid-3`, `.grid-4` with the existing gaps (24 / 24 / 20 to be normalised to 24).
- Page content below the fixed nav uses `padding-top: var(--nav-height)`. `--nav-height` is 64px logged in and 60px logged-out on desktop.

---

## 4. Components

Use these classes. Do not create page-local variants.

### 4.1 Buttons

Base class `.btn`. Pill shaped (`--radius-pill`), inline-flex, centred.

| Variant | Class | Look |
|---|---|---|
| Primary | `.btn .btn-primary` | Primary green fill, white text |
| Mint | `.btn .btn-mint` | `--color-primary-soft` fill, dark text |
| Outline | `.btn .btn-outline` | Transparent, 1.5px strong border |
| Ghost | `.btn .btn-ghost` | Transparent, light border |
| Text | `.btn .btn-text` | No background, link-style |
| Dark | `.btn .btn-dark` | Forest background |
| OAuth | `.btn .btn-oauth` | White, bordered, full width |

| Size | Class | Padding | Font size |
|---|---|---|---|
| Small | `.btn-sm` | 8 / 16 | `--text-sm` |
| Default | none | 11 / 22 | `--text-base-sm` |
| Large | `.btn-lg` | 13 / 28 | `--text-base` |
| Extra large | `.btn-xl` | 15 / 36 | `--text-base` |
| Full width | `.btn-full` | | |

Nav buttons are a fixed exception, defined in section 5.

### 4.2 Badges
`.badge` with `.badge-blue` (to be renamed `.badge-primary`), `.badge-green`, `.badge-amber`, `.badge-gray`. Pill, `--text-xs`, 3 / 8 padding.

### 4.3 Cards
`.card`: white, 1px `--color-border`, `--radius-lg`. Hover lifts 2px with `--shadow-lg`. Page-specific cards (`.tc-*`, `.task-row-card`, dashboard panels) should be built on `.card` and add layout only.

### 4.4 Forms
`.form-group` (16px bottom margin), `.form-label` (`--text-sm`, weight 600, 6px below), `.form-input` / `.form-select` / `.form-textarea` (shared look, hover `--color-border-strong`, focus ring in primary). Placeholder colour is `--color-text-muted`.

### 4.5 Other shared pieces
`.eyebrow` (uppercase pill label above headings), `.section-header`, `.icon-box`, `.toast`, `.modal-box`. Use as is.

---

## 5. Logged-out desktop navigation (implemented)

Component: `components/navbar.html`. Styles: the "LOGGED-OUT DESKTOP NAV" block at the end of `css/styles.css`. Applies at 1044px and wider, to `body:not(.st-logged-in)` only.

| Item | Spec |
|---|---|
| Container | 1312px wide, centred, 10px padding on all sides, 60px tall. On screens under 1432px: 60px margin each side instead of full width |
| Logo | 133 x 22, then 16px to the first item |
| Links | Post a Task, Find Tasks, Find Taskers, Local Taskers, Gift Cards. 16px apart |
| Right group | Sign Up, Log in, Become a Tasker. 16px apart, pinned to the right edge |
| Space | Whatever is left sits between Gift Cards and Sign Up |
| Link text | Manrope 16px, weight 600, `--color-text-nav-link`, no padding. Hover: text turns `--color-primary` and a `--nav-hover-bar` (4px) bar of `--color-primary` appears above the link, the width of the link, 8px above its box (centre links and Sign Up / Log in) |
| Post a Task | 133 x 40, padding 8 / 24, `--color-primary` fill, white text, weight 600 |
| Become a Tasker | 174 x 40, padding 14 / 24, `--color-primary-soft` fill, dark text, weight 500 |

The nav block uses tokens for colours, font family and size, and most spacing. The fixed widths and heights (133, 174, 40, 1312) are part of the spec and stay literal.

---

## 6. Breakpoints

| Name | Query | Meaning |
|---|---|---|
| `sm` | `max-width: 480px` | Small phones |
| `md` | `max-width: 768px` | Mobile layout, mobile nav |
| `lg` | `min-width: 1044px` | Full desktop nav row fits |

Existing 900, 700, 640, 600 and 560px queries should be moved to the nearest of these. Do this per page with testing, not as a global find-and-replace.

---

## 7. Rules for AI tools

1. Read this file first. Then open `css/tokens.css` and `css/styles.css` before writing any CSS.
2. Reuse a class from section 4 before writing any new CSS. If you must add one, add it to `styles.css` next to similar components, never to a page.
3. Never write a hex colour, `rgb()`, a font size, or a spacing value that is not a token. If the value you need is missing, stop and ask for it to be added to this file.
4. Never add `style=""` for look and feel. Never add `!important` without a comment.
5. When asked to change one area (for example the logged-out nav), change only that area. Do not touch logged-in, mobile, or other pages.
6. After a change, run `node tools/check-design-system.js`. It must pass. Never edit `tools/design-baseline.json` to make it pass.
7. List every file you edited and confirm nothing outside the requested scope changed.
8. If a page already contains old hardcoded values, do not copy them into new code. Leave them for the cleanup, or fix them only if asked.

---

## 8. Migration plan

1. ~~Settle the decisions in section 0.~~ Done, except the accent green.
2. ~~Create `css/tokens.css`.~~ Done (imported by `styles.css`).
3. ~~Convert the nav block and primary buttons to tokens.~~ Done.
4. Convert shared components in `styles.css` (cards, badges, forms).
5. Pages, smallest first: `login`, `signup`, `index`, `find-*`, `post-*`, `messages`, `subscription`, `tasker-profile`.
6. The two dashboards last (`dashboard-customer.html`, `dashboard-tasker.html`). They hold over half of the hardcoded colours and about 575 inline styles.
7. ~~Automated check.~~ Done: `tools/check-design-system.js` fails when any file gains raw hex/rgb colours, inline styles or `!important`. It compares against `tools/design-baseline.json`, so old debt is tolerated and new debt is not. After each cleanup step, run it with `--update` to lower the baseline.
8. ~~`AGENTS.md` and `CLAUDE.md` at the project root pointing to this file.~~ Done.
9. ~~`design-system.html` reference page.~~ Done. Open it in a browser to see every token and component rendered live.
10. Track progress in `MIGRATION-CHECKLIST.md`.

---

## Audit baseline (for tracking progress)

| Measure | At audit |
|---|---|
| Hardcoded hex values | 672 (155 unique) |
| `font-size` declarations / unique values | 969 / 75 |
| Unique spacing values in padding, margin, gap | 46 |
| Unique `border-radius` values | 36 |
| Inline `style=""` attributes in HTML | about 1,100 |
| `!important` in `styles.css` | 88 |
| Distinct breakpoints | 12 |

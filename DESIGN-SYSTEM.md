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
| 4 | **Page width** (2026-10-29) | Every page wrapper is `--page-width` = 1112px of content, with the 60px `--page-margin` each side. `.container` (max 1160 with 24px padding) already gives 1112px of content on desktop, so it is unchanged. |
| 5 | **Pill radius** (2026-10-29) | `--radius-pill` is now 999px in code (it was 100px) and literal 99 / 100 / 9999px pill radii use the token. |

**Single source:** the old tokens in `styles.css` that have the same value as a new token (`--text-primary`, `--border`, `--bg`, `--amber`, `--red`, `--font` and others) now point at the new tokens, so changing a value in `tokens.css` updates both.

| 6 | **Brand green** (2026-10-29) | `#0F6B46` is the one green for actions: buttons, links, prices, icons, focus, badges, success. `#16A34A`, `#004F31`, `#18704B`, `#168A5B`, `#006A43`, `#116C47` and `#1A8D61` are retired; their tokens (`--blue`, `--green`, `--color-accent*`, `--pt-green`, `--gc-green*`, `--co-green*`, `--auth-green*`, `--color-card-primary`) now alias `--color-primary` / `--color-primary-hover`. Dark surfaces (hero, mobile nav, dark chips and panels) use the forest scale: hero and mobile nav `--color-forest-900`, dark chips and panels `--color-forest-800`, idle hero chips `--color-forest-700`. The bright live dot is `--color-live`. |

**Still open:** one-off greens that are scoped to a single page block in `tokens.css` (about 90 tints, glows and dark neutrals for gift cards, coordinator, auth and profile pages).

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
| `--color-primary` | `#0F6B46` | Primary buttons (`.btn-primary`, nav Post a Task). The legacy `--blue` / `--green` now alias it (decision 6). |
| `--color-primary-hover` | `#0B5638` | Hover for primary buttons. Derived. |
| `--color-primary-soft` | `#EEFFF1` | Mint fill. Used by the Become a Tasker button. Replaces `--mint` (`#E8F5EC`) in nav use. |
| `--color-primary-soft-hover` | `#DFF7E4` | |
| `--color-primary-border` | not yet created | Will replace `--blue-border` / `--mint-border` once the accent green is decided. |
| `--color-forest-900` | `#0B2E1C` | `--forest-deep` (dark hero and footer backgrounds) |
| `--color-forest-800` | `#0F3D26` | `--forest` |
| `--color-forest-700` | `#16512F` | `--forest-mid` |
| `--color-text` | `#121212` | `--text-primary`, `--charcoal` |
| `--color-text-nav` | `#171A19` | Nav button text (Become a Tasker). Candidate to merge into `--color-text`. |
| `--color-text-nav-link` | `#384179` | Logged-out desktop nav link text at rest (Find Tasks, Services, Local Taskers, Gift Cards, Sign Up, Log in). Hover turns it `--color-primary`. |
| `--color-text-secondary` | `#4A4A4A` | `--text-secondary`, `--gray-600` |
| `--color-text-muted` | `#7A7A7A` | `--text-muted`, `--gray-400` |
| `--color-bg` | `#FFFFFF` | `--bg`, `--white` |
| `--color-bg-subtle` | `#F7F7F7` | `--bg-subtle` |
| `--color-bg-muted` | `#F5F5F5` | `--gray-100` |
| `--color-border` | `#E5E5E5` | `--border`, `--gray-200` |
| `--color-border-strong` | `#D0D0D0` | `--border-strong` |
| `--color-warning` | `#D97706` | `--amber`. Pair with `--color-warning-soft: rgba(217,119,6,0.1)`. |
| `--color-danger` | `#DC2626` | `--red`. Pair with `--color-danger-soft: rgba(220,38,38,0.08)`. |
| `--color-success` | `var(--color-primary)` | Success / confirmed / paid. Same green as the brand. |
| `--color-live` | `#4ADE80` | Bright live dot on dark surfaces only. Never for text or buttons. |

**Rules**
- Status colours (warning, danger, success) appear only on badges, alerts, validation and status text. Never as decoration.
- Off-palette colours found in the audit (`#0A84FF`, `#1976D2`, `#FF3D00`, `#4CAF50`, `#FFC107` and others) are bugs to be replaced with the nearest token.

### 2.2 Typography

**Families**
- `--font-heading`: `'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. Used for headings, nav, buttons.
- `--font-body`: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. Used for body text, forms, tables.

**Size scale.** The audit found 75 different `font-size` values, many of them below 12px. They now collapse onto the standard scale that professional sites use (Airtasker, Stripe, Airbnb, Tailwind, Material): 12 / 14 / 16 / 18 / 20 / 24 / 32px. Body text is 16px, dense UI is 14px, and **nothing is smaller than 12px**.

| Token | Size | Typical use |
|---|---|---|
| `--text-xs` | 0.75rem (12px) | Captions, meta rows, badges. The smallest size allowed. |
| `--text-sm` | 0.875rem (14px) | Secondary text, buttons, form labels, table and dense UI text |
| `--text-base` | 1rem (16px) | Default body text |
| `--text-lg` | 1.125rem (18px) | Lead paragraphs |
| `--text-md` | 1.25rem (20px) | Card titles, small headings |
| `--text-xl` | 1.5rem (24px) | Section sub-headings |
| `--text-2xl` | 2rem (32px) | Page headings |
| `--text-hero` | `clamp(2rem, 5vw, 3.5rem)` | Hero h1 only |

Responsive headings: `--text-h3` (18 to 20px), `--text-h2-sm` (20 to 24px), `--text-h2` (24 to 36px), `--text-h1-sm` (24 to 32px, mobile h1), `--text-display` and `--text-display-xl` (decorative large type).

`--text-2xs` and `--text-base-sm` still exist as aliases of `--text-xs` and `--text-sm` so old code keeps working. Do not use them in new code.

**Mapping for old values:** up to 0.8rem becomes `--text-xs`; 0.82 to 0.9rem becomes `--text-sm`; 0.92 to 1.05rem becomes `--text-base`; 1.1 to 1.15rem becomes `--text-lg`; 1.2 to 1.3rem becomes `--text-md`; 1.4 to 1.6rem becomes `--text-xl`; 1.9 to 2rem becomes `--text-2xl`.

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
| `--radius-hero` | 32px | Page heroes: all four corners on desktop (inset card), bottom corners on phones (full width under the nav). Same value as `.pg-hero`. |
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

**Page width:** `--page-width` (1112px) is the content width of `.ap-container`, `.bk-container`, `.pt-container`, `.wl-container`, `.tp-decision-inner` and the dashboard `.tov` blocks. Do not type 1112 or 1120 in a page.

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
| Small | `.btn-sm` | 8 / 16 | `--text-sm` (14px) |
| Default | none | 11 / 22 | `--text-base-sm` |
| Large | `.btn-lg` | 13 / 28 | `--text-base` |
| Extra large | `.btn-xl` | 15 / 36 | `--text-base` |
| Full width | `.btn-full` | | |

Nav buttons are a fixed exception, defined in section 5.

### 4.2 Badges
`.badge` with `.badge-blue` (to be renamed `.badge-primary`), `.badge-green`, `.badge-amber`, `.badge-gray`. Pill, `--text-xs`, 3 / 8 padding.

`.rating-badge` (stage M9, `css/rating-badge.css`, `js/rating-badge.js`): the one rating display, a star, the average to one decimal and the review count, e.g. ★ 4.5 (12). Never hand-build a rating. Put `<span data-rating-user="<uuid>" data-rating-role="tasker|customer"></span>` where the rating belongs (add `data-rating-new` to show "New" when there are no reviews; otherwise it stays empty). It reads `rating_summary` only, through `rating_summaries()`. Never show `taskers.rating`, `taskers.review_count` or `services.rating`.

### 4.3 Cards
`.card`: white, 1px `--color-border`, `--radius-lg`. Hover lifts 2px with `--shadow-lg`. Page-specific cards (`.tc-*`, `.task-row-card`, dashboard panels) should be built on `.card` and add layout only.

### 4.4 Forms
`.form-group` (16px bottom margin), `.form-label` (`--text-sm`, weight 600, 6px below), `.form-input` / `.form-select` / `.form-textarea` (shared look, hover `--color-border-strong`, focus ring in primary). Placeholder colour is `--color-text-muted`.

### 4.5 Other shared pieces
`.eyebrow` (uppercase pill label above headings), `.section-header`, `.icon-box`, `.toast`, `.modal-box`. Use as is.

---

### 4.6 Page hero (desktop and phones)

One dark-green hero for the logged-in pages: tasker Home, Find Tasks, Overview, Applications, Bookings, Wallet, and, for customers, Home and My Tasks. It works on desktop and on phones. On a phone it is full width, fixed under the nav (`js/pg-hero-fixed.js`), and the top nav takes the same green.

Taskers get the green phone nav automatically (`body.role-tasker`). A page that shows the hero to customers too adds `pg-hero-nav` to `<body>` (customer Home and My Tasks do). It turns the phone nav and the browser status bar green for any role.

Tokens (`css/tokens.css`, "Page hero tokens"):

| Token | Use |
|---|---|
| `--hero-text-muted` | eyebrow and description text |
| `--hero-btn-bg`, `--hero-btn-bg-hover` | pale pill buttons, active chip, live pill |
| `--hero-chip-bg`, `--hero-chip-bg-hover` | idle filter chips on the hero |
| `--hero-dot` | live dot, focus ring on the hero |
| `--hero-float-gap` | how far cards (stat cards, balance cards) overlap the hero's bottom edge |
| `--hero-bar-overlap` | how far the floating search pill overlaps the hero's bottom edge |
| `--hero-chip-h`, `--hero-chips-lift` | chip height, and how far the chip row sits above the hero's bottom edge |

Classes (`css/styles.css`, "TASKER PAGE HEROES"):

| Class | Use |
|---|---|
| `.pg-hero-zone` | clears the fixed nav (pages that do not already pad for it) |
| `.pg-hero` + `.pg-hero-text`, `.pg-hero-side`, `.pg-hero-stack` | the shell, its text, its buttons |
| `.pg-hero-eyebrow` (with `.spg-hero-eyebrow`, `.spg-hero-dot`) | page name with the green dot |
| `.pg-hero-title`, `.pg-hero-lead`, `.pg-hero-desc`, `.pg-hero-meta`, `.pg-hero-note`, `.pg-hero-live` | greeting, lead line, description, live count |
| `.pg-hero-btn`, `.pg-hero-icon-btn` | pale pill button |
| `.pg-hero-float` | content that overlaps the bottom edge (cards) |
| `.pg-hero-page` | on the page container when the page uses chips and the floating bar |
| `.pg-hero-chips`, `.pg-hero-chip`, `.pg-hero-chip-n` | status tabs inside the hero's bottom-right |
| `.pg-hero-bar`, `.pg-hero-search`, `.pg-hero-search-btn`, `.pg-hero-input`, `.pg-hero-select-wrap`, `.pg-hero-select` | floating search pill and selects |

The chips and bar are the page's own tabs and toolbar, restyled. The page JS keeps its ids.

### 4.7 Cards v2: task, service, tasker

Built from the card references. Markup comes from three builders in `js/ui.js`; styles are in `css/tasks.css` ("CARDS v2"). Do not hand-write card HTML in a page.

| Builder | Class | Used by | Shows |
|---|---|---|---|
| `stTaskCard(task)` | `.st-card--task` | `find-tasks.html` | Urgency + category chips, save, client photo (or category emoji), title, description, location, distance, In-Person/Remote, **Client Budget**, offers, **Make an Offer** |
| `stServiceCard(service)` | `.st-card--service` | `js/services-search.js` | Category chip, turnaround chip, perk line, rating, title, description, **Starting From** price, **Book Service** |
| `stTaskerCard(tasker)` | `.st-card--tasker` | `js/taskers.js` | Availability, rating, name + verified tick, role, location, avatar, skills (+N), portfolio strip, price pill, **View Profile** |

Optional fields (rating, distance, offers, turnaround, perk, portfolio) render **only when the data has them**. A card never shows an invented number. Shared parts: `.st-chip` (`--urgent`, `--soon`, `--category`, `--available`, `--glass`, `--dark`, `--skill`, `--mode`), `.st-card-save`, `.st-card-media`, `.st-card-foot`, `.st-card-cta`, `.st-rating`. Tokens: `--card-*`, `--color-card-*`, `--radius-card`.

**Card text limits and desktop size (2026-11-06).** Every text line in a v2 card is capped so one long entry never makes a card taller than its neighbours: titles and descriptions stop at two lines, the eyebrow, location, role, tasker name and chips stop at one line, each ending in an ellipsis (…). The full text is on the details page. From 769px up the cards are smaller: tokens `--card-padding-desktop`, `--card-media-ratio-desktop`, `--radius-card-desktop`, `--card-cta-height-desktop`, `--card-grid-min-desktop` (results grids on find-tasks and find-services) and `--cc-card-width-desktop` (scrolling rows). Phones: inside the scrolling rows only, cards are about 176px wide (`--cc-card-width-phone`, `--card-padding-phone`, `--card-media-ratio-phone`, `--card-cta-height-phone`) so roughly two show at once; the buttons stack and the save bookmark is hidden. The service card stack uses a smaller gap so there is no empty band above the Book Service strip.

The static marketing cards (`.lt-tasker-card` on the homepage and Local Taskers) and the owner-side `.task-row-card` rows on the dashboards are not part of v2.

### 4.8 Toasts

`showToast(message, options)` in `js/ui.js`. A bare `showToast('text')` still works: the tone is guessed from the wording.

| Option | Values |
|---|---|
| `type` | `success`, `info`, `warning`, `error` (shortcuts: `showToast.error(msg)`) |
| `title` | bold first line; `message` becomes the small second line |
| `tonal` | `true` for the pastel pill (`.st-toast--tonal`) |
| `duration` | ms. Default 4500, errors 6000 |

Max three on screen, pauses on hover/focus, Esc closes the newest, errors use `role="alert"`, and the close button has a 44px tap zone. Pages that define their own `showToast` (both dashboards) delegate to `window.stToast`. The Messages page keeps its own toast (`JRThread.toast`) and is unchanged.

### 4.9 Notification boxes

`.st-notice` for dashboards, checkout and compliance states. Tone modifiers: none (live, white), `--success`, `--warning`, `--danger`, `--info`. Parts: `.st-notice-icon`, `-title`, `-badge`, `-meta`, `-body`, `-points`, `-actions`. Filled action button: `.btn .btn-tone`. Live examples are on `design-system.html`.

### 4.10 Profile prompt ("Complete your profile")

`.st-pp`: one component, two skins. Under 768px it is the dark compact card ("Complete profile (75%)", **Boost Now**); from 768px up it is the light banner with the TIP badge, "75% Complete", the next step and **Complete Profile**. Set the fill with `el.style.setProperty('--pp-value', '75%')`, toggle with the `hidden` attribute. Used on `dashboard-tasker.html` (`#profileCompleteBanner`) and `home-feed.html` (`#hfProfileCard`).

### 4.11 New tokens (added for 4.7 to 4.10)

All in `css/tokens.css`.

| Group | Tokens |
|---|---|
| Status tones | `--tone-{success,info,warning,danger}-{bg,border,ink,icon}`. **Decision needed:** the success tone uses `--color-primary` for its icon; the blue `--tone-info-*` is new to the system. |
| Toast | `--shadow-toast`, `--shadow-notice`, `--toast-max-width`, `--toast-badge-size`, `--toast-close-size`, `--toast-hit-size` |
| Cards | `--card-surface`, `--card-surface-tint`, `--card-chip-glass`, `--card-chip-dark`, `--card-cta-bg(-hover)`, `--card-skill-bg`, `--card-media-ratio`, `--card-avatar-size`, `--card-thumb-size`, `--shadow-card-hover` |
| Profile prompt | `--pp-dark-*`, `--pp-accent(-hover/-ink)`, `--pp-light-*`, `--pp-fill`, `--pp-icon-size`, `--pp-track-height`, `--pp-track-width` (most alias existing greens) |

### 4.13 Compact card system (horizontal scrollers)

`js/cards-compact.js` (global `STCompact`) and `css/cards-compact.css`; tokens `--cc-*` in `css/tokens.css`. Added in stage M11. Used by the tasker and customer homepages (M12b, M13b). Do not hand-write these cards in a page.

| Builder | Shows |
|---|---|
| `STCompact.row({ title, viewAllHref, skeleton, emptyText, hideWhenEmpty })` | Header, View All link, desktop arrows (hover devices, 768px and up, only when the row scrolls), swipe, hidden scrollbar, arrow-key / Home / End on the focused track. Only the track scrolls sideways, never the page. States: `stSetState('loading' / 'empty' / 'error')`, `stSetItems(nodes)`, `stOnRetry(fn)`. An empty row hides itself unless `hideWhenEmpty: false`. |
| `STCompact.taskCard(task, { urgent })` | Title, budget, location, posted time, offer count, optional distance, Urgent badge. The badge shows only when the caller passes `urgent: true`; distance only when `distance_km` is a real number. |
| `STCompact.taskerCard(tasker)` | Photo (initials fallback), name, verified tick, rating badge, PRO / PREMIUM label, main service, location and distance. The rating is a `data-rating-user` span filled by `js/rating-badge.js` in one batch per row; nothing is read from `taskers.rating`. |
| `STCompact.categoryCard({ label, emoji, href, count })` | Category tile. |
| `STCompact.referralStrip({ title, text, cta, href, show })` | Placeholder strip, hidden unless `show: true` (M15 supplies the real text). |

Pages that use it load `css/cards-compact.css`, `js/rating-badge.js` and `css/rating-badge.css`, and (optional) `js/membership-labels.js` and `css/membership.css`. All text is set with `textContent`.

### 4.12 Membership labels (PRO, PREMIUM)

`css/membership.css` (load it after `styles.css`) and the `--membership-*` tokens in `css/tokens.css`. Added in S4a of the subscription overhaul.

| Plan | Label | Class |
|---|---|---|
| Free, Starter | none: render no element | |
| Professional | `PRO` | `.membership-label.membership-label--pro` (soft mint fill, green text) |
| Business | `PREMIUM` | `.membership-label.membership-label--premium` (dark forest fill, mint text) |

- Markup: wrap name and label in `.membership-name`, name first: `<span class="membership-name"><span class="membership-name__text">Chinedu Okafor</span> <span class="membership-label membership-label--premium">PREMIUM</span></span>`. The label is always AFTER the name.
- `.membership-label--sm` for cards and search rows.
- The label is subscription membership only. Never add a check mark, shield or the word "verified" to it, and never put it where the identity-verification mark goes. Every user is identity verified; the label means nothing about that.
- The label text comes from the server (`membership_for_users`, S3f), never from `taskers.subscription_plan`.
- Tokens: `--membership-{pro,premium}-{bg,ink,border}`, `--membership-gap`, `--membership-font-size`, `--membership-tracking`. All alias existing tokens.
- S4h: build labels with `js/membership-labels.js` (`STMembership.load(ids)` once per page, then `html(userId, { small: true })` or `node(label, opts)`); never write the label classes by hand. It asks the server once, draws only PRO or PREMIUM and draws nothing on any failure.
- `.membership-label--on-dark` for dark surfaces such as the tasker profile hero: PRO is outlined mint, PREMIUM is solid mint, so the two still differ.
- Place the label after the name and after the identity tick; it never replaces or touches the tick.
- S4i: labels are also drawn on service cards (`stServiceCard`, after the provider name in the eyebrow line, only when the card shows the name, never on a perk line or a Local Tasker), the customer's offers list (`customer-applications.html`, after the applicant's name) and the customer's bookings list (`customer-bookings.html`, after the provider's name). A page that draws labels links `css/membership.css` and loads `js/membership-labels.js` before its page script, then calls `STMembership.load(ids)` once.

### 4.14 Page shell (2026-11-06): the frame for every new page

**Rule: every new page must use it.** It gives the same look as `learn.html` and `referrals.html` (forest hero, white panels on `--pt-page`) and guarantees the fixed nav never covers the heading.

| Piece | Class | Notes |
|---|---|---|
| Body | `<body class="st-shell">` | `--pt-page` background |
| Main | `<main class="st-page">` or `st-page--narrow` | Clears the nav (`--nav-height` + 24px, 16px on phones), width `--page-width` (narrow: `--page-width-narrow` 720px), 60px margin on desktop, 16px on phones, 24px gap between blocks. Exempt from the legacy phone rule `main:not(.st-page)` |
| Hero | `.st-hero` + `.st-hero-chip` (with `.st-hero-dot`), `.st-hero-title` (the page h1), `.st-hero-lead` | Forest gradient, `--radius-hero`. One per page, first block |
| Panel | `.st-panel` + `.st-panel-title`, `.st-panel-note` | White card, `--radius-hero`, 24px padding (16px phones). Fields inside get the tinted `--pt-field` look automatically |
| Required star | `.st-req` | |

Inside panels use `.btn`, `.form-group`, `.form-label`, `.form-input`, `.check-row`, `.st-notice`, `.badge`. A page file adds layout only (columns, grids), never new colours, sizes or radii. `html` has `scroll-padding-top` so `#anchor` links stop below the nav.

**Why it exists:** a legacy rule `main { padding: ... !important }` inside the phone breakpoint overrode the top padding of every bare `<main>`, and the Privacy and Terms pages used a 48px gap under a 64px nav. Both are fixed; the shell stops it coming back. Pages older than the shell are listed in `tools/legacy-pages.json`; `tools/check-design-system.js` fails any other page that has the shared nav but no `.st-page`.

## 9. Checklist for every new page

1. `<body class="st-shell">`, `<main class="st-page">` (`st-page--narrow` for forms and text), `.st-hero`, `.st-panel` blocks.
2. Tokens and existing components only (sections 1 to 4). New value needed: add it to `css/tokens.css` and this file first.
3. No inline `style=""`, no `!important`, no page-local button, card or input looks.
4. Breakpoints 480 / 768 / 1044 only.
5. View at 390px and 1280px: heading below the nav, no sideways scroll.
6. `node tools/check-design-system.js` passes.

---

## 5. Logged-out desktop navigation (implemented)

Component: `components/navbar.html`. Styles: the "LOGGED-OUT DESKTOP NAV" block at the end of `css/styles.css`. Applies at 1044px and wider, to `body:not(.st-logged-in)` only.

| Item | Spec |
|---|---|
| Container | 1312px wide, centred, 10px padding on all sides, 60px tall. On screens under 1432px: 60px margin each side instead of full width |
| Logo | 120 x 20, then 16px to the first item |
| Links | Post a Task, Find Tasks, Services, Local Taskers, Gift Cards. 16px apart |
| Right group | Sign Up, Log in, Become a Tasker. 16px apart, pinned to the right edge |
| Space | Whatever is left sits between Gift Cards and Sign Up |
| Link text | Manrope 14px (`--text-base-sm`), weight 500, `--color-text-nav-link`, no padding. Hover: text turns `--color-primary` and a `--nav-hover-bar` (4px) bar of `--color-primary` appears above the link, the width of the link, 8px above its box (centre links and Sign Up / Log in) |
| Post a Task | 36px tall, width from content, padding 0 / 24, `--color-primary` fill, white text, weight 600 |
| Become a Tasker | 36px tall, width from content, padding 0 / 24, `--color-primary-soft` fill, dark text, weight 500 |

The nav block uses tokens for colours, font family and size, and most spacing. The fixed sizes (logo 120 x 20, button height 36, link row height 40, nav width 1312) are part of the spec and stay literal.

---

## 6. Breakpoints

| Name | Query | Meaning |
|---|---|---|
| `sm` | `max-width: 480px` | Small phones |
| `md` | `max-width: 768px` | Mobile layout, mobile nav |
| `lg` | `min-width: 1044px` | Full desktop nav row fits |

**Migrated 2026-10-29** (all pages except the two dashboards): 560 and 600 became 480; 640, 700, 767, 860 and 900 (including 899.98 and 901) became 768 / 769; 1024 and 1044 became 1043; min-width 600 became 481, 640 became 768, 641 / 900 / 901 became 769, 1045 became 1044. JavaScript `matchMedia` values that mirror them were changed too (`find-tasks.html`, `components/footer.html`, `js/messages-details.js`). The two tablet-only blocks (769 to 900px) in `messages.css` and `home-feed.html` were removed because the floating bottom nav now ends at 768px.

**Still off-spec on purpose or pending:** 380px (`bookings.css`, tiny phones), 1164px (`post-task.css`, the width where the 60px page margin starts to shrink), and the 700px queries inside `dashboard-customer.html` and `dashboard-tasker.html` (dashboards are last).

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


---

## Coordinator portal tokens (Stage 3A, added 2026-10-26)

`css/tokens.css` now has a `--co-*` block (colours, `--radius-co-*`, `--shadow-co-*`, header and bottom-nav heights) used only by `coordinator-login.html`, `coordinator-dashboard.html`, `css/coordinator.css` and the coordinator components. Values were sampled from the owner's coordinator design screens (no Figma values), so they are approximations; replace them in `tokens.css` if exact Figma values exist. Same rule as the Post a Task and Gift Cards blocks: page-specific, do not reuse elsewhere without a design decision.

---

## Palette merge and auth tokens (2026-10-29)

- `--gc-*` and `--co-*` values that were identical to a `--pt-*` or `--color-forest-*` value now alias it (for example `--co-green` and `--gc-green` are `var(--pt-green)`, `--co-hero-start` is `var(--color-forest-800)`). Computed values are unchanged (checked: all 367 custom properties resolve to the same value before and after). Change the `--pt-*` value and the gift cards and coordinator portal follow.
- New "Auth pages" block in `css/tokens.css`: the raw colours that login, signup and onboarding-tasker used in `styles.css` (including the `--auth-*` set that lived inside `.av2-page`) are now tokens with the same values. Added `--color-danger-border` (rgba 220,38,38,0.2) to the core set.
- The Google "G" logo (four brand colours) moved from inline SVG to `images/google-g.svg`. Those colours belong to Google and are not part of the palette.


### Dashboards (2026-10-29)
Both dashboards use `css/dashboard.css` (prefix `db-` for shared, `tdb-` for tasker-only) instead of inline styles. Only `display:none` start states that the page script toggles stay inline. The banner colour palette on the tasker dashboard is user data (`data-color` on each swatch, painted by script), so those hex values stay.

## Guided tours (onboarding Stage 1)

Added to `css/tokens.css` for `js/onboarding.js` and `css/onboarding.css`: `--tour-scrim` (dim wash; **guessed**: the dark ink from the card shadows at 62%), `--tour-blur`, `--tour-pad`, `--tour-tip-width`, `--tour-tip-gap`, `--tour-edge`, `--tour-dur`, `--tour-arrow`, `--z-tour` (9000: above the nav drawer and install banner, below toasts). The tour card (Stage 4) is small and dark: `--color-dark` background, `--color-dark-border`, `--color-dark-raised` / `--color-dark-chip` for the Back and Skip buttons, `--color-text-on-primary` and `--hero-text-muted` for text, `--pt-mint` for hints, `--tour-tip-width` is now 300px. Layout: title with a close button, one or two lines of text, then the step count (`1/6`) on the left and Back / Skip / Next step on the right. Next step uses `.btn-primary`; the others use `.btn` with `.st-tour-btn`. On phones the card sits above the floating tab bar (`.st-bottom-nav`); the engine measures the bar and passes it to `placeTooltip` as `insetBottom`.

## Help / Learn page (onboarding Stage 4)

`learn.html` + `css/learn.css` follow the referrals page pattern: `--pt-page` background, forest hero (`--color-forest-900/700`), white panels (`--radius-hero`), tinted rows (`--pt-field`, `--radius-form`), pill tabs, `.btn-mint` and `.btn-primary`. Status chips use the `--tone-*` tokens. No new tokens.

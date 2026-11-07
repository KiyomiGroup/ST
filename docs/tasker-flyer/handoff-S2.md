# Flyer: handoff after Stage 2 (design) -> Stage 3 (real data)

## What exists now
| File | Status | Purpose |
|---|---|---|
| `css/flyer.css` | new | All flyer styles. Drawn in one unit `--u` (1mm). Also the `.flp-*` preview page styles and the `@media print` sheet rules (`.fl-sheet`, `body.fl-printing`). |
| `js/flyer-template.js` | new | `window.STFlyer`: `render(host, data, opts)`, `setWidth(el, px)`, `print(el, 'a5'|'a4')`, `normalise(data)`, `templates`, `copy`. Pure drawing, no network. |
| `flyer-preview.html`, `js/flyer-preview.js` | new | Design check page with 3 sample Taskers (full, long name + one service, minimal), a photo picker, and A5 / A4 print buttons. noindex, no nav, no database. Can be deleted after Stage 4. |
| `images/flyer/logo-wordmark.png`, `logo-bar.png`, `photo-fallback.svg` | new | Official wordmark (from the uploaded file, resized to 2400 px wide), the vertical "StreetTasker" bar cropped from the uploaded K logo, and the no-photo avatar. |
| `css/tokens.css` | edited (appended) | `--fl-*` colour block at the end. Nothing else changed. |
| `DESIGN-SYSTEM.md` | edited (appended) | Section "Tasker promotional flyer". |
| `docs/tasker-flyer/*` | new | Plan and this handoff. |

Gift card files were not touched. `node tools/check-design-system.js` passes.

## The data contract (Stage 3 fills this)
```js
STFlyer.render(hostElement, {
  name,        // string: tasker display name
  profession,  // string: primary service (empty -> "Local Tasker")
  location,    // string: optional (empty -> the row disappears)
  services,    // array of strings: first 3 unique are used, 0 is fine (block disappears)
  photoUrl,    // string: optional (empty or broken -> fallback avatar)
  qrUrl        // string: the full link the QR encodes
}) // -> { el, ready (Promise, resolves when photo + fonts are in and text is fitted), qrOk }
```
`normalise()` already trims, de-duplicates and shortens text. Everything is added with `textContent`.

## Where the real data comes from (found in Stage 1, use these, do not invent new tables)
- Page: `tasker-profile.html` + `js/tasker-profile.js`. Hero is `<section class="pp-hero pg-hero tp-hero">`.
- The page already builds one model in `buildModel()`: `m.name`, `m.photo`, `m.location`, `m.service` (profession; `m.headline` is a tagline, do not use it), `m.services` (array of `{title}`; use `title`).
- Owner check: `state.isOwner` (set around line 895), the owner's user id is `state.id`.
- Photo: `m.photo` (tasker `photo_url`/`photo` or user `avatar_url`). Local Taskers use a coordinator cover photo through signed links; a flyer for those probably cannot export a PNG (CORS). Decide in Stage 3: hide the button for `m.isLocal`, or accept fallback avatar.
- Referral code: `STReferralData.mine('tasker')` (js/referral-data.js) -> `{ code, ... }` or `null` when the tasker has no referral profile yet. Needs `js/referral-data.js` loaded on the profile page (it is not loaded there now) and a signed-in owner. When `null`: do not show a dead button, show "Your referral link is not ready yet" (and say what to do).
- QR link (decision 2 in the plan): `location.origin + '/signup.html?ref=' + code + '&redirect=' + encodeURIComponent('tasker-profile.html?id=' + state.id)` then pass as `qrUrl`. The sample links in `js/flyer-preview.js` show the exact shape. Build it in ONE small function so it can change later.
- Check that `tasker-profile.html?id=<user id>` works for a logged-out and brand-new user (it reads `taskers.user_id`, then `taskers.id`, public columns only). Also test the full path once: scan -> sign-up -> verify email -> log in -> lands on the profile (`rememberSignupTarget` / `takeSignupTarget` in `js/auth.js`). A person who is already signed in and opens `signup.html` may be redirected elsewhere; check that and tell the owner what happens.

## Stage 3 to do
1. Add a small builder (new file, e.g. `js/flyer-data.js`) `STFlyerData.fromProfile(model, referralCode, userId)` -> the data object above. Keep all profile reading out of `flyer-template.js`.
2. Load `js/vendor/qrcode.min.js`, `js/flyer-template.js`, `js/referral-data.js` on `tasker-profile.html` (script tags at the bottom, before `tasker-profile.js`) and add `<link rel="stylesheet" href="css/flyer.css">`. The flyer CSS defines no generic classes (all `.fl*` / `.flp*`), so it will not affect the page.
3. Keep `flyer-preview.html` working; add a 4th sample if useful.
4. Do not add the visible button yet (Stage 4), but expose a function the button will call.

## Stage 4 notes (so nothing is rediscovered)
- **A5 / A4 PDF**: already implemented as `STFlyer.print(el, 'a5'|'a4')`. Tested in headless Chrome: A5 = 420 x 595 pt, A4 = 595 x 842 pt, one page each, vector text, QR decodes from a 300 dpi raster. A5 page = trim size (148 x 210); the 3 mm bleed is cropped. If the owner wants a print-shop file with bleed, add a third paper size `{ w: 154, h: 216, k: 1 }` with x/y offset 0. The person must choose "Save as PDF", margins "None" is handled by `@page`.
- **PNG** does not exist yet (the gift card has none either). Plan: a pinned `html-to-image` script from `cdn.jsdelivr.net` (the site already loads Supabase from there; `vercel.json` sets no CSP), call it on a clone with `--u` set so the width is about 1480 px (A5 at 254 dpi) or larger. Needs: photo loaded with `crossOrigin='anonymous'` (the template already does this) and the Supabase storage bucket returning CORS headers (test with a real photo), and the fonts embedded (test that Manrope is not replaced by a fallback in the PNG). If html-to-image cannot carry the fonts, fall back to drawing the PNG on a canvas by hand.
- Button in the hero: owner only, uses existing `.btn` classes, follows `DESIGN-SYSTEM.md`. No inline styles. The preview + 3 download buttons can live in a modal or a panel opened by the hero button; reuse existing modal styles if there are any (search `css/` first).
- The owner has no terminal: every step for them must be "replace these website files". Stage 3 and 4 need no Supabase SQL.

## Known notes
- In my test sandbox Google Fonts were blocked, so Inter stood in for Manrope in my screenshots. The fitting routine measures at runtime, so real Manrope will fit too, but look at one real print before sign-off.
- Long text is shortened or shrunk, never clipped: name wraps to 2 lines and shrinks; profession and each service stay on one line and end with "..." only below a readable minimum (3.4 mm).
- The vertical "StreetTasker" bar and wordmark are the owner's uploaded files; do not redraw them.

# Flyer: handoff after Stage 4 (button, preview, downloads) -> Stage 5 (verification)

## What exists now
| File | Status | Purpose |
|---|---|---|
| `tasker-profile.html` | edited | Hero button `#tpFlyerBtn` (hidden until js shows it), dialog `#tpFlyerDialog`, flyer CSS and scripts. |
| `js/tasker-flyer.js` | new | Opens the dialog, asks `STProfileFlyer.prepare()` for the data, draws the preview, A5 / A4 PDF (`STFlyer.print`), PNG (`STFlyer.png`). |
| `js/tasker-profile.js` | edited | Shows the button for the owner of a real profile only (`state.isOwner`, not demo, not Local Tasker). |
| `js/flyer-template.js` | edited | New `STFlyer.png(data)` and `STFlyer.refit(el)`. Flyer name is now a `<p>` (a phone-width rule in `styles.css` forces every `h1` to a fixed size with `!important`, which broke the fitting). |
| `css/flyer.css`, `css/profile-pages.css` | edited | `.fl-offscreen` (PNG drawing area), `.tp-flyer-*` dialog styles, name letter-spacing kept as before. |
| `js/vendor/html-to-image.min.js` | new | html-to-image 1.11.13 (MIT), bundled so nothing loads from a CDN. |

## How it behaves
- Button: owner only. Click -> dialog -> `prepare()`. No referral code -> the dialog shows the "not ready yet" message and no download buttons.
- PDF: browser print window, person picks "Save as PDF". A5 = trim size, A4 = scaled.
- PNG: 1480 x 2100 px (A5 trim, about 254 dpi), file name `streettasker-flyer-<name>.png`. The photo is fetched first; if its server blocks that (CORS), the PNG uses the no-photo avatar and the dialog says so. The PDFs always include the photo.
- Text is re-fitted at the preview size, because phones wrap text in different places than the 4 px per mm measurement.

## Stage 5 to check (could not be tested without the real site)
1. Two real Tasker accounts: button shows only on your own profile; code present -> flyer; scan the printed QR -> sign-up with ref -> lands on that profile.
2. A real photo from Supabase storage in the PNG (needs CORS on the bucket). If the notice "photo could not be added" appears, the bucket needs CORS headers.
3. PNG fonts with real Manrope (Google Fonts). If the PNG shows a different font, tell me and I will embed the font files.
4. Print one A5 and one A4 PDF on paper.
5. Delete `flyer-preview.html` and `js/flyer-preview.js` if no longer wanted.

## Design changes after owner review
- Flyer paper is plain white (`.fl` background), no cream gradient. The `--fl-cream*` tokens are now unused.
- The vertical "StreetTasker" bar on the left was removed from the template and CSS (`images/flyer/logo-bar.png` is no longer used and can be deleted).

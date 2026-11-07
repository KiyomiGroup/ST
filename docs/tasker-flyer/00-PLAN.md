# Tasker promotional flyer: plan and stages

Goal: every approved Tasker can download a personalised flyer (their photo, name, profession, location, up to 3 services, and a QR code that carries their referral code). Reference design: the approved flyer image. Technical reference: the gift card printable sheet (`gift-card-success.html`, `css/gift-cards.css` `.gcp`, `js/gift-card-success.js`).

## Decisions made (owner)
1. The "Download flyer" button goes in the **hero of the Tasker profile page** (`tasker-profile.html`, `section.pp-hero`), shown to the profile owner only (`state.isOwner` in `js/tasker-profile.js`).
2. The QR opens **sign-up with the Tasker's referral code**, and after sign-in the new person **lands on that Tasker's profile**. The site already carries a `?redirect=` target through sign-up, the verification email and first log-in (`js/auth.js`, "?redirect=" block, `safeRedirect`), and `referral-capture.js` already reads `?ref=` on sign-up. So the QR link is:
   `https://streettasker.com/signup.html?ref=<CODE>&redirect=tasker-profile.html%3Fid%3D<tasker user id>`
   (Fallback if a shorter link is wanted later: `/r/<CODE>`, which would need a small edit in `server/referral-share-core.js` to add the same `redirect`.)
3. Benefit wording (reference said "Trusted Taskers", which the profile code treats carefully because taskers show no verified mark): **Rated & Reviewed Taskers / Fast & Easy Booking / Escrow-Protected Payments**. Change in `COPY.benefits` if the owner wants different words.
4. Output: A5 PDF (148 x 210, the page is the trim size), A4 PDF (flyer scaled to fill), PNG.

## Stages
| Stage | What | Status |
|---|---|---|
| 1 | Investigation | done |
| 2 | Flyer design as one template, print path tested | **done** (this handoff: `handoff-S2.md`) |
| 3 | Real data (profile model, referral code), QR link, graceful gaps | next |
| 4 | Hero button, preview panel, A5 / A4 / PNG downloads | |
| 5 | Verification with two Tasker accounts, run `node tools/check-design-system.js` | |

Rules from `AGENTS.md` apply: tokens only, no inline `style=""`, no `!important`, do not touch the gift card files, list every edited file at the end.

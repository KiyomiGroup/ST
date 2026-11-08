# Stage 1 handoff: Local Taskers public page (2026-11-08)
Owner rules: no terminal steps for the owner; stage zip = changed files only. No SQL, no function deploys in this stage.

## Done
- local-taskers.html
  - partners@streettasker.com removed (that mailbox does not exist). Replaced with contact@streettasker.com (owner's real mailboxes: adunola, contact, admin, support, dispute). The line now also links to the new #ngo-partners section.
  - Hero rebuilt on the homepage's own `.hero-frame`, so it is identical by construction: small eyebrow line "Find a local tasker" in the same place and style as the homepage's "Get things done"; the big LOCAL TASKERS title now sits where "GET ANY TASK DONE" sits and no longer runs under the subtext and buttons. Old pill eyebrow and full-bleed background removed from this page only. Mobile shows the eyebrow too (it was hidden before).
  - New section #ngo-partners ("Skill is everywhere. Access is not."): the barriers Local Taskers removes, 4 ways to help (fund onboarding, back coordinators in underserved areas, equip Local Taskers, introduce people / apply as coordinators), "What partners can rely on", and two buttons (Partner with us, Support Local Taskers) that open an email to contact@ with a prefilled subject.
- css/local-tasker-public.css: new `.lt-hero-img`, `.lt-ngo*`, `.trust-grid--four`, `.lt-checklist--two`. Tokens only.
- images/lt-hero-desktop.webp, images/lt-hero-mobile.webp: NEW transparent versions of the existing artwork (flat green background removed, mobile one cropped so the title is high). The old lt-banner-*.jpg files are untouched because the homepage teaser still uses them; css/styles.css was NOT changed (its old `.hero .lt-banner` rules are now unused by this page and can be deleted later).

## Checked
Headless Chromium at 1280 and 390: eyebrow and title positions match the homepage, no sideways scroll, NGO section stacks on phones. `node tools/check-design-system.js`: nothing listed for these files (the tool lists other pages that were already over the baseline before this stage).

## For the owner to decide (not done by me)
- The page invites donations, but there is no donation mechanism: both buttons only email contact@. Have a real way to receive and account for money before promoting it. "We will reply with how we could work together" is the only promise made; no numbers, no impact claims.
- The 4 "ways to help" are proposals ("we will shape it with you"), not existing programmes. Edit the wording if any are not something you want to offer.
- Make sure contact@streettasker.com is monitored.

## Not tested
Live "Meet Local Taskers" grid (needs Supabase).

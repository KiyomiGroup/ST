# Coordinator: Local Tasker page (tabs) — handoff (2026-11-09)

Self-contained: read this and you can continue without the chat.

## What this work is
The coordinator portal's page for ONE Local Tasker (`coordinator-tasker.html?id=<tasker user id>`) is being rebuilt to the owner's Figma references (desktop + mobile): a header card, five tabs (Overview, Bookings, Messages, Earnings, Profile & Services), the dark "My Local Taskers" sidebar on desktop and a tasker switcher on phones/tablets. The coordinator Overview page (`coordinator-dashboard.html`, stages C1-C4) is finished and is NOT touched by this work.

Owner rules (from CLAUDE.md / AGENTS.md and the owner's standing requests): follow `DESIGN-SYSTEM.md` (tokens only, no raw hex/rgb/px, no inline style, no `!important`, corner radii 16 / pill / 32, no straight rectangles); plain HTML/CSS/JS, no build step; one stage per session; send ONLY the changed files, zipped in their folder structure; stay inside the section asked; ask if unclear; always say what must be changed or deleted by hand on GitHub or Supabase; the owner runs SQL straight on production in the Supabase SQL editor (no staging advice). Links to pages that do not exist yet are greyed out.

## Stages
| Stage | Content | Needs SQL? |
|---|---|---|
| **T1 (done)** | Page shell: top row, tasker switcher, header card, tab bar, dark sidebar with "N new" badges, counts. The existing profile cards sit unchanged in the Profile & Services tab. | no |
| T2 | Overview tab: stat tiles, incoming bookings, "action needed", earnings volume chart, quick actions | maybe (see below) |
| T3 | Bookings tab: this Local Tasker's bookings, same groups as the Bookings page, each opens `coordinator-booking.html?id=` | no |
| T4 | Messages tab: this Local Tasker's conversations (list), opening `coordinator-chat.html?booking=` (owner to decide: link out vs. embed the thread) | no |
| T5 | Earnings tab: payouts and coordinator commission for this Local Tasker | maybe |
| T6 | Profile & Services restyled to the reference (bio, rates table, portfolio, identity, representation) using the existing loaders | no |
| T7 | QA at 390 / 820 / 1360, design-system note, final handoff | no |

## T1: what was built
Changed files (nothing else):
- `coordinator-tasker.html` (replaced)
- `css/coordinator-tasker.css` (new)
- `js/coordinator-tasker-shell.js` (new)
- `DESIGN-SYSTEM.md` (one short section added after "Coordinator overview layout")
- `COORDINATOR-TASKER-HANDOFF.md` (this file, new)

`js/coordinator-tasker.js` is UNCHANGED. It still paints the profile, services, photos, flyer, payout, publishing, verification and agreement cards. The new HTML keeps every element id that script and `js/coordinator-flyer.js` use (checked by script: none missing), so they work as before.

How the page works:
- Tabs: `<button role="tab">` in `#coTabs`. `?tab=<overview|bookings|messages|earnings|profile>` opens a tab; clicking a tab updates `?tab=` with `history.replaceState` (other params such as `id`, `created`, `updated`, `service_saved` are kept). Arrow keys / Home / End move between tabs. A disabled tab, or an unknown `?tab=`, falls back to `data-default` on `#coTabs` (currently `profile`).
- Tabs not built yet (Overview, Bookings, Messages, Earnings) are `disabled`, greyed out, `title="Coming soon"`, and have no panel.
- Sidebar (from 1044px): copied markup of the overview sidebar, same classes and ids; `js/coordinator-sidebar.js` is NOT loaded on this page. `js/coordinator-tasker-shell.js` fills it itself (same two reads the overview uses), marks the open Local Tasker (`aria-current="page"`), and shows "N new" per Local Tasker.
- Phones/tablets: back link, then a `<select>` switcher (hidden when the coordinator has only one Local Tasker; switching keeps the open tab). Below 1044px the normal coordinator header and bottom bar are used, as on the overview.
- Header card: initials avatar, name, "Managing <name>" chip, skills · area, status chip (from `coordinator-tasker.js`), identity chip, "View public page" (published Local Taskers only, opens `tasker-profile.html?id=`), "Edit details".

Data (all read-only, no writes, `textContent` only):
- `coordinator_assignments` + `local_tasker_profiles`: the roster, area, status.
- `rpc local_booking_list` (limit 200) and `rpc coordinator_chat_list` (limit 100): Bookings count = open bookings of this Local Tasker (same rule as the overview's Active Requests); Messages count and sidebar "N new" = unread in conversations the coordinator handles (`access = 'coordinator'`), joined to the Local Tasker through `booking_id`. The sidebar Messages badge = all unread.
- `rpc idv_local_status` through `STCo.verifyView`: the same answer as the Verification card.
- If a count or the identity answer cannot be read, it stays hidden. Never a made-up number.
- Counts sit on tabs that are still disabled; the CSS hides them there. They appear when the tab is turned on.

## Turning on the next tab (how T2-T5 plug in)
1. In `coordinator-tasker.html`: remove `disabled` and `title` from that tab button, add a `<section class="co-tpanel" id="coPanelX" role="tabpanel" aria-labelledby="coTabX" hidden>` after `#coPanelProfile`, and (T2 only) change `data-default="profile"` to `overview`.
2. Put the tab's JS in its own file (for example `js/coordinator-tasker-bookings.js`), loaded after `coordinator-tasker-shell.js`. Load data when the tab is first opened, not on page load (the shell does not emit an event yet; add a `coordinator-tasker:tab` CustomEvent in `selectTab` when the first tab needs it).
3. CSS goes in `css/coordinator-tasker.css` (or a per-tab file), scoped by `.co-page--tasker`.

## Left out of the reference on purpose (no real data behind it; same approach as the overview)
Level 3 / "Master specialist" badge; "Artisan #TK-108" number; the rating line (4.96, 84 reviews) in the header — no reviews source readable by a coordinator has been confirmed (T2 needs `reviews` columns and its RLS, via a read-only introspect file first); "NIN Verified" wording (the site uses the Didit identity check, so the chip says "Identity verified" / the server's status); "Guarantor on file", "Bank payout verified", "Readiness 4/4" strip (guarantor data does not exist; payout and identity are shown in their own cards); the "WhatsApp line (Coordinator)" and "Operating hub / radius" tiles; "Vetted by Lucy on <date>" line; "Guarantor Renewal Due" and "Add Backup Payout Bank" action cards; Coordinator Dossier (a private note needs a table: owner decision for T2); "Block schedule / vacation", "Create custom quote", "Monthly statement (PDF)". Each can be added later if the owner wants it and the data exists.

## Currency
The references show £ and example names. The site pays and quotes in ₦; every amount will use `STCoBk.naira()` (₦). Figures will always be real data, never the reference's sample numbers.

## Tested (T1)
- jsdom with a stubbed Supabase and the REAL `coordinator-common.js`, `coordinator-verify-status.js`, `coordinator-tasker.js`, `coordinator-tasker-shell.js`: 24 checks pass (name still painted by the old script; Managing chip; area; public link only when published; identity chip; Bookings count counts only this Local Tasker's open bookings; Messages count ignores customer-access chats and other Local Taskers; sidebar badges; current row; cap; switcher; default tab; disabled tabs ignore clicks; a disabled `?tab=` falls back; counts stay hidden if bookings cannot be read; roster error message survives later redraws; bad id shows "not found").
- Real Chromium at 390, 820 and 1360px with the real site CSS and the stubbed Supabase: no sideways scroll, no script errors, screenshots checked (header, tabs, sidebar, switcher, banners).
- `node tools/check-design-system.js`: none of the new or edited files are reported. The command still exits with failures from older files (map-view.js, post-service.html, signup.html, wallet.html, six legal pages); those were already there and are not part of this stage.

## NOT verified
- The real Supabase: reads were stubbed. The two list calls and the identity call are the same ones the overview and Verification card already make, but this page was not opened with a real coordinator session.
- Google Fonts were blocked in my test browser, so the screenshots used fallback fonts; the real fonts are slightly different widths.
- Safari / iOS, a screen reader, and a coordinator with only one Local Tasker (switcher hidden) were not tried in a browser (the hidden case is covered by the jsdom logic, not by sight).

## Owner action
None. No SQL, nothing to delete on GitHub or Supabase. Upload the changed files to the same paths (replace `coordinator-tasker.html`, `DESIGN-SYSTEM.md`; add the three new files).
Until T2-T5 are pushed, the Overview, Bookings, Messages and Earnings tabs are greyed out and the page opens on Profile & Services.

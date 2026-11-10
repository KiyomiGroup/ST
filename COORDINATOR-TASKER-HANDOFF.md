# Coordinator: Local Tasker page (tabs) — handoff (2026-11-09, updated for T4)

Self-contained: read this and you can continue without the chat.

## What this work is
The coordinator portal's page for ONE Local Tasker (`coordinator-tasker.html?id=<tasker user id>`) is being rebuilt to the owner's Figma references (desktop + mobile): a header card, five tabs (Overview, Bookings, Messages, Earnings, Profile & Services), the dark "My Local Taskers" sidebar on desktop and a tasker switcher on phones/tablets. The coordinator Overview page (`coordinator-dashboard.html`, stages C1-C4) is finished and is NOT touched by this work.

Owner rules (from CLAUDE.md / AGENTS.md and the owner's standing requests): follow `DESIGN-SYSTEM.md` (tokens only, no raw hex/rgb/px, no inline style, no `!important`, corner radii 16 / pill / 32, no straight rectangles); plain HTML/CSS/JS, no build step; one stage per session; send ONLY the changed files, zipped in their folder structure; stay inside the section asked; ask if unclear; always say what must be changed or deleted by hand on GitHub or Supabase; the owner runs SQL straight on production in the Supabase SQL editor (no staging advice). Links to pages that do not exist yet are greyed out.

## Stages
| Stage | Content | Needs SQL? |
|---|---|---|
| **T1 (done)** | Page shell: top row, tasker switcher, header card, tab bar, dark sidebar with "N new" badges, counts. The existing profile cards sit unchanged in the Profile & Services tab. | no |
| **T2 (done)** | Overview tab: stat tiles, open bookings, "action needed", 6-month chart, quick actions | no |
| **T3 (done)** | Bookings tab: this Local Tasker's bookings, same groups as the Bookings page, each opens `coordinator-booking.html?id=` | no |
| **T4 (done)** | Messages tab: this Local Tasker's conversations (list), opening `coordinator-chat.html?booking=` (linked out; embedding the thread was not chosen) | no |
| T5 | Earnings tab: payouts and coordinator commission for this Local Tasker | maybe |
| T6 | Profile & Services restyled to the reference (bio, rates table, portfolio, identity, representation) using the existing loaders | no |
| T7 | QA at 390 / 820 / 1360, design-system note, final handoff | no |

## T4: what was built (Messages tab)
Changed files: `coordinator-tasker.html` (tab on, panel `#coPanelMessages`, script tag), `js/coordinator-tasker-messages.js` (new), `COORDINATOR-TASKER-HANDOFF.md`. No CSS change (reuses `.co-msgs-*`, `.co-filters`), no SQL.
- Owner did not answer the link-out vs embed question, so the default was used: each row opens `coordinator-chat.html?booking=<id>`. Embedding the thread can be a later stage.
- Lists only conversations the coordinator handles (`access = 'coordinator'`) for THIS Local Tasker (a chat row has no Local Tasker id, so it is matched through its booking in the booking list). Newest first, All / Unread, search by customer or message text, unread count in the summary line. Payment requests and Job Room system lines show as "Payment request" / "Job Room update" like the overview.
- Both lists come from the frame (`STCoTasker`), no extra call; loads on first open; if either list cannot be read: error with Try again, never "no conversations".
- Tested: jsdom with the real scripts, 16 checks; T2 (37) and T3 (14) still pass. Browser layout NOT looked at.
- Owner action: upload `coordinator-tasker.html`, `COORDINATOR-TASKER-HANDOFF.md` and new `js/coordinator-tasker-messages.js`. T2 and T3 files must already be uploaded.

## T3: what was built (Bookings tab)
Changed files: `coordinator-tasker.html` (tab turned on, panel `#coPanelBookings`, script tag), `js/coordinator-tasker-bookings.js` (new), `COORDINATOR-TASKER-HANDOFF.md`. No CSS change (reuses `.co-toolbar`, `.co-search`, `.co-filters`, `.co-bk-*`), no SQL.
- Groups Needs action / Waiting / Problems / Closed with counts (the same `STCoBk.nextAction` rule as `coordinator-bookings.html`); opens on the first group that has bookings; search by job, customer or reference looks across all groups; each card opens `coordinator-booking.html?id=`.
- Only this Local Tasker's bookings, from the list the frame already read (`STCoTasker.bookings()`): no extra call. Loads when the tab is first opened. Unreadable list shows an error banner with Try again, never an empty message.
- Cap: the list is limited to 200 bookings (newest first), so older closed bookings may be missing.
- Tested: jsdom with the real scripts, 14 checks (groups, counts, only this Local Tasker, search, empty, error, lazy load, one call); T2's 37 checks still pass. Browser layout NOT looked at (no browser available).
- Owner action: upload `coordinator-tasker.html`, `COORDINATOR-TASKER-HANDOFF.md`, and the new `js/coordinator-tasker-bookings.js`. Nothing else.

## T2: what was built (Overview tab)
Changed files (nothing else): `coordinator-tasker.html`, `css/coordinator-tasker.css`, `js/coordinator-tasker-shell.js`, `js/coordinator-tasker-overview.js` (new), `DESIGN-SYSTEM.md` (one short section), `COORDINATOR-TASKER-HANDOFF.md` (this file). No SQL.
- The Overview tab is on and is the default tab (`data-default="overview"`). `?tab=` still works. Bookings, Messages and Earnings stay greyed out.
- Shell change (small): `window.STCoTasker` now exposes `id`, `bookings(again)`, `chats(again)` and `isOpenForMe(row)`. The two lists are read ONCE and shared, so the Overview tab adds no extra call (tested: one `local_booking_list`, one `coordinator_chat_list`). `selectTab` now fires `coordinator-tasker:tab` (`detail.tab`), and a panel loads its data the first time its tab opens. T3-T5 should use both.
- Tiles (all from `local_booking_list`, this Local Tasker only):
  - Jobs this month = bookings with `booking_status = 'completed'` whose month (from `updated_at`, else `created_at`) is the current month; the note compares with last month.
  - Active bookings = open, not frozen, not a problem report; the note adds the value of the ones with `payment_status = 'paid'` ("held safely").
  - Needs your action = open bookings whose `STCoBk.nextAction(...).tab` is `action` (the same rule the Bookings page uses).
  - Completed this month = sum of `amount` of this month's completed jobs, BEFORE fees (gross).
- Open bookings: up to 4, "needs action" first, then problems, then waiting; each opens `coordinator-booking.html?id=`. "View all bookings" opens `coordinator-bookings.html` (the Bookings tab is T3).
- Past 6 months: bars of the gross value of completed jobs per month; each bar has a screen-reader sentence; empty state when there are no completed jobs.
- Action needed (real signals only): bookings needing action, unread customer messages for this Local Tasker (coordinator-access chats), identity check not finished (`idv_local_status` through `STCo.verifyView`), profile needs republishing / draft / inactive (one read of `local_tasker_profiles`, the same table the page already reads). If a signal cannot be read, a note says so and "nothing needs attention" is NOT shown.
- Quick actions: Add a service, Manage photos, Payout account, Public listing (existing pages, `?id=`).

### Known approximations (say so if the owner wants them exact)
- The month of a completed job is the month of the LAST STEP recorded (`local_booking_state.updated_at`). There is no `completed_at` in `local_booking_list`. If a booking was touched again after completion, it could move to a later month. A real completion date would need a small SQL change to the list function (T5 can add it together with the earnings data).
- "Completed this month" is the gross booking value, not the Local Tasker's net payout and not the coordinator's share. The fee split (5% coordinator, 7% platform) is not shown here on purpose; the Earnings tab (T5) will read the real commission records.
- The list RPC is capped at 200 bookings (newest first), so the 6-month chart and "jobs this month" are exact only while this coordinator has fewer than 200 bookings in total.

### Left out of the reference (no data behind it)
Client rating tile and "82 verified reviews"; "Ada's net payout" tile (replaced by "Completed this month"); Coordinator Dossier (private note needs a table: owner decision); "Add Backup Payout Bank" and "Guarantor Renewal Due" cards (no such data); Create custom quote, Block schedule / vacation, Monthly statement (PDF) quick actions (nothing behind them yet); the "Coordinator share" line under the chart.

### Tested (T2)
- jsdom with a stubbed Supabase and the REAL `coordinator-common.js`, `coordinator-verify-status.js`, `coordinator-bookings-common.js`, `coordinator-tasker-shell.js`, `coordinator-tasker-overview.js` and the real page HTML: 37 checks (the tiles, only this Local Tasker's bookings, escrow counts only paid, action-first order, 6 bars with the current month marked, old months excluded, unread counts only coordinator-access chats of this Local Tasker, one call per list, unreadable bookings show dashes plus the error banner and no false "empty", empty Local Tasker, identity and republish signals, nothing loads while another tab is open and it loads on first open).
- `node tools/check-design-system.js`: none of the new or edited files are reported (the command still fails on the older files listed in T1).
### NOT verified
- No real browser was available this time: the layout (1360 / 820 / 390 px), the bar chart heights and the mobile section order were written to the existing tokens and classes but NOT looked at. Please open the page once at phone width and desktop width.
- The real Supabase (reads stubbed), the real fonts, Safari / iOS, a screen reader.

## Owner action (T2)
None. No SQL, nothing to delete on GitHub or Supabase. Upload the changed files to the same paths (replace `coordinator-tasker.html`, `css/coordinator-tasker.css`, `js/coordinator-tasker-shell.js`, `DESIGN-SYSTEM.md`, `COORDINATOR-TASKER-HANDOFF.md`; add `js/coordinator-tasker-overview.js`).
After upload the page opens on Overview. Profile & Services is unchanged.

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
Until T5 is pushed, the Earnings tab is greyed out.

# M17 final report (2026-11-06)

## How this was checked
- **Done here:** every script and every page script was checked for syntax errors (none); the design-system check passes; cards were rendered in a headless browser with sample data; the code was searched for the old problems (direct chat insert, stored ratings, early chat paths).
- **Not done here (no live database or browser):** the SQL files were run by you (you reported all pass for M2 to M16). Nothing was clicked through on the live site. Part 2 of `M17-OWNER-CHECKLIST.md` is that click-through.
- The "old homepage acceptance list" and the "12-item final report" template from the first homepage handoff were not in the files I was given, so this report follows the stage list in `MERGED-HANDOFF.md`.

## What was built
M2 chat rule and closed chats. M3 offer rules (one accepted offer, owner-only accept, cancel). M4 early-chat paths removed. M5 cancel screens. M6 and M7 reviews (coordinator, review prompt). M8 to M10 profile reviews and the rating badge, real ratings everywhere. M11 compact card system. M12a/b location and tasker home. M13a/b customer home. M14 referral engine. M15 referral page and home strips. M16 referral credit (customer gift balance) and the free Starter month. This round: all cards follow your three designs, home rows are "Your Tasks" and "Other Tasks", favicon logo placeholder, warning before paying during a reward month.

## Found in M17 and fixed
1. `js/taskers.js` made up each tasker's availability from a hash of their id, and marked a tasker "verified" when their rating was 4.8 or more. Both are removed: availability shows only when the tasker set it, and verified only when the row says so.

## Found in M17 and NOT fixed (your decision)
1. **Demo taskers are added to the live list on Find Taskers.** `js/taskers.js` appends `DUMMY_SERVICES` after the real taskers (and shows only demo ones if loading fails). Real customers can see made-up providers. Say "remove demo taskers" and I will.
2. **Table permissions:** `bookings`, `tasks` and `services` allow UPDATE, DELETE and TRUNCATE for `authenticated`, and `users` and `taskers` the same for `anon`; only row rules protect them (from the earlier audit). This needs a careful tightening stage of its own.
3. `js/edit-profile-tasker.js` still reads the stored `taskers.rating` and `review_count` for the tasker's own edit page (users can write those columns). It is only shown to that tasker.
4. The "plan ended" message for a reward month says "as you asked" (existing wording for plans that end at period end).
5. Coordinates: 0 of 17 tasks and 0 of 8 taskers had coordinates at the last check, so "km away" appears only where a place was chosen after M12a. `m17-checks.sql` shows the current count.
6. The gift cards page may show referral credit cards (theme "referral") without a special design.
7. The payment-ends-reward database trigger has no automatic test (it needs a real payment): test it once by hand with a Paystack test payment.

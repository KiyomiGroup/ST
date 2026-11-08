# Handoff G-1 (2026-11-08): Add Local Tasker save error, Laundry, areas + availability pickers
Changed files only. Order: (1) upload the site files, (2) redeploy the Edge Function, (3) press Save once, (4) send the result.

## 1. "Save profile and continue" error (NOT yet fixed at the root: needs the database function source)
The error text on screen is a Postgres HINT ("No operator matches the given name and argument types..."), not the real message, and
the source of `create_local_tasker` is not in the project. The Edge Function used to throw the real message away.
- `supabase/functions/local-tasker-create/index.ts`: now logs code + message + details, and for an unexpected database error returns error `db_error`
  with the real message in `detail`. Redeploy it (Supabase > Edge Functions > local-tasker-create > Deploy, keep "Verify JWT" ON).
- `js/coordinator-tasker-new.js`: shows `detail` on screen after "Error code: db_error (...)".
- `sql/coordinator-onboarding/g1-introspect.sql`: READ-ONLY. Run its blocks and send the results (source of create_local_tasker, the assignment guard,
  coordinator_capacity, my_coordinator_plan; triggers; column types). Suspect: a type mismatch (text vs uuid) in one of those, probably added with the
  center-coordinator / plan SQL (those files are not in the zip, so they could not be checked).

## 2. Laundry category
`js/categories.js` (icon, entry after Cleaning, 9 services, detection words moved out of Cleaning, "laundry" no longer an alias of Cleaning),
`post-service.html` (dropdown), `js/ui.js` (card photo uses the Cleaning picture until images/placeholders/task-laundry.jpg exists: then change
`laundry: ['cleaning-2']` to `['laundry']`), `images/icons/cat-laundry.svg`. Every other page reads the shared list, so chips, filters, Home and Find pages pick it up.
Old rows saved as "laundry" now belong to Laundry, not Cleaning. If the database has a CHECK on tasks/services category values, add 'laundry' there (none found in the project SQL).

## 3. Areas served + availability (Add and Edit Local Tasker)
New `js/coordinator-pickers.js` (+ tests/coordinator-pickers.test.js, 13 tests), styles in `css/coordinator-intake.css`, both pages load `js/ng-places.js` + the picker.
- Areas: type, pick from suggestions, chips. Only listed places can be added; near misses are offered ("Did you mean") and never auto-picked.
  Saved as "Yaba, Lagos; Surulere, Lagos" (300 characters, 12 areas max). Older free text is matched to listed places on the Edit page; unmatched parts stay as yellow chips.
- Availability: Days / Times of day / same-day jobs / one short note. Saved as "Days: Weekdays · Times: Morning, Evening · Same-day jobs OK · Note: ...". Older text becomes the note.
- Search matches on text (js/taskers.js `includes`), so a customer who picks "Yaba, Lagos" finds this person. A customer who picks a bigger or smaller name for the same place (for example "Lekki, Lagos" vs "Lekki Phase 1, Lagos") will not. Loosening that is a separate step.

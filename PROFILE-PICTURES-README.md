# Fix: profile pictures on Local Tasker cards (2026-11-09)

Run order:
1. SQL: sql/coordinator-flow/t2-profile-pictures.sql in the Supabase SQL editor. Adds ONE new read-only function (local_tasker_public_avatars). Nothing existing is changed. The check row at the end shows how many published Local Taskers have a profile picture. Undo: t2-rollback.sql.
2. Push js/ui.js and js/local-tasker-public.js (they replace the B5 versions; both are the B5 files plus this fix). No page needs editing.
3. Hard refresh (the service worker may serve old JS once).

What changed
- Tasker cards (home "Taskers" row, Find Taskers, featured): a Local Tasker now shows their PROFILE PICTURE. The service photo / cover photo is never printed for a Local Tasker. No picture uploaded yet = the StreetTasker mark (no wrong photo). Regular taskers are unchanged.
- Service cards: the small round picture beside the provider name now shows the profile picture: Local Tasker = their profile picture; regular tasker = users.avatar_url when the site can read it. Nothing found = the StreetTasker mark, as today.
- "Meet Local Taskers" grid uses the profile picture too.

Not verified: nothing ran in a browser or against Supabase (8 tests pass against a tiny fake page). Unknown: whether the public (logged-out) storage rule lets the site sign a profile-picture file. If a published Local Tasker WITH a picture still shows the mark, send me the storage policies for storage.objects. Unknown: whether users.avatar_url is readable by logged-out visitors; if not, regular taskers' service cards keep the mark.

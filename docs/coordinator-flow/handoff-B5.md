# B5: booked tasks stay visible, offers stay open, service image

## Your rule
A task that is not closed stays on the homepage and search (with a "Booked" label). Other taskers can still send offers. The customer cannot accept a second offer while the first accepted offer stands: `accept_application` already refuses ("You have already hired someone"), and the Applications page already says so. The customer must cancel the current offer first (`cancel_accepted_offer`, unchanged), which puts the task back to open.

## Run
1. `sql/coordinator-flow/b5-visible-offers-image.sql`, then read its check row (three true).
2. Push the files in the zip.
3. Rollback: `sql/coordinator-flow/b5-rollback.sql`.

## What changed
- RLS: new policy lets logged-out visitors read `in_progress` tasks (signed-in users could already).
- `submit_offer`: exact pasted text, only the "task closed" test changed (diff checked). Offers allowed for `open` and `in_progress`.
- Lists: `js/db.js` fetchTasks (homepage, find tasks), `js/tasks-map.js`, `dashboard-tasker.html` include booked tasks. Cards in `js/ui.js` show a "Booked" chip.
- `js/task-details.js`: badge "Booked", Make an Offer stays on with a note. `js/make-offer.js` accepts booked tasks.
- Service image: optional file field on `coordinator-service-edit.html`; upload to the public `service-images` bucket; new function `set_local_tasker_service_photo` (checks the coordinator manages the Local Tasker, audited). `save_local_tasker_service` is NOT changed. If the upload fails the service is still saved and the profile page says the image failed.
- Service cards for Local Taskers: own image, else the category placeholder (`images/placeholders/`). The cover photo is no longer used on service cards. `js/local-tasker-public.js`, `js/services-search.js`, `home-feed.html`, `index.html`.
- Flyer uses the cover photo first (`js/coordinator-flyer.js`).

## Not verified
- Nothing run: no SQL, no browser. Syntax of every JS file checked only.
- The `service-images` bucket upload policy for a coordinator account is unknown. If the upload says it failed, send the storage policies for `storage.objects`.
- Names of CSS chips `st-chip--soon` reused for "Booked".
- Tasks that the customer's own "My tasks" lists show are unchanged.
- Placeholder is for Local Tasker services only; regular services without a photo keep today's behaviour.
- Service worker may serve old JS until refreshed.

## Still open
Payout sender (the 24 hour wait is real only once a sender exists). Test payout row from yesterday: status queued, 440, release_after empty, so nothing was sent.

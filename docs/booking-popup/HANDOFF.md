# Booking pop-up: handoff

The pop-up lives on `tasker-profile.html` (`#tpBookDialog`), built in `js/tasker-profile.js` (`openBooking`, `submitBooking`) and styled in `css/profile-pages.css` (`.tp-dialog-book`, `.tp-bk-*`).
It stays a pop-up. Goal: collect everything a tasker needs, the way Make an Offer does for a task.

## Decisions (from Grace)
- The 12% platform fee is shown only to the tasker, never to the customer.
- Keep it a pop-up, not a full page.
- Fields: job address/area, what needs doing (title + description), photos, budget/price summary with 12% fee, urgency (flexible / urgent).
- No contact-preference field.
- Built in stages, one handoff note each.

## Stages
1. **Job details + urgency (done):** job title, description (counter, 600 max), Flexible/Urgent chips; pop-up centred and scrollable.
2. **Address / area (done):** required Area field with suggestions, optional street address or landmark.
3. **Price summary (done):** customer sees the rate or an estimated total, with no platform fee shown.
4. **Photos of the job (done):** optional, up to 5, shown as thumbnails with remove buttons.
5. **Save properly (done):** own `bookings` columns, private street address, details on both Bookings pages, one booking per request, fee wording, phone pass.

## Stage 1: what changed
- `tasker-profile.html`: `#tpBookDialog` gets class `tp-dialog-book`. This page does not load `task-details.css`, so the pop-up used to sit against the left edge. It is now centred and scrolls inside the screen.
- `js/tasker-profile.js`: new fields `#bkJob` (min 5, max 80) and `#bkNotes` (now "Describe the job", min 10, max 600), urgency `#bkUrgency` (`state.bkUrgency`). Callout mode starts as Urgent with today's date. Choosing Urgent fills today's date if the date is empty.
- Storage is unchanged for now: everything goes in `bookings.notes` through `buildNotes()`:
  line 1 = title, then the description, then `Urgency: Flexible|Urgent` (quote/callout tags stay in front).
- The tasker notification now says `Job: <title>` and "(urgent)".
- `css/profile-pages.css`: new `.tp-dialog-book` and `.tp-bk-*` rules, tokens only.

## Stage 2: what changed
- `tasker-profile.html`: loads `js/location.js` (the same suggestions widget Post a Task uses).
- `js/tasker-profile.js`:
  - `#bkArea` (required, min 3): area / neighbourhood with suggestions and the GPS option (`mode: 'area'`). It is pre-filled from the customer's saved location (`users.location`) when they have one, and stays editable. `savedLocation()` reads it once and keeps it on `state.bkSavedLoc`.
  - `#bkStreet` (optional, max 160): street address or landmark, plain text.
  - `buildNotes()` now writes: title, description, `Area: ...`, `Address: ...` (only if given), `Urgency: ...`.
  - The tasker notification says "in <area>"; the "Request sent" screen shows the area.
- `css/profile-pages.css`: `.tp-bk-loc`, `.tp-bk-tag`, `.tp-bk-help`.

## Stage 3: what changed
- `js/tasker-profile.js`: `priceSummary(mode, m)` adds a price box above the submit button.
  - Per-job rate: "Estimated total" with the rate.
  - Hourly or daily rate: the rate, and "Depends on the time needed" (no total is guessed).
  - Quote mode or no rate: "Quote after review" / "To be agreed".
  - Every case says the final price is agreed in chat before paying, that sending a request costs nothing, and that payment is held in escrow.
- No fee line for the customer. The tasker already sees "You receive" (rate minus 12%) on their Bookings page.
- `bookings.amount` is deliberately NOT set when the request is sent. The job room reads `bookings.amount` as the agreed price (`js/messages-money.js`), so a guessed amount would pre-set it before the price is agreed in chat.
- `css/profile-pages.css`: `.tp-bk-price*`.

## Stage 4: what changed
- `js/tasker-profile.js`: photo picker (`#bkPhotoFiles`, `#bkPhotos`, `#bkPhotoErr`) between the description and the area. Same rules as Post a Task and Make an Offer: JPG, PNG or WebP, 5 MB each, up to 5. Files upload when the customer presses send (`uploadBkPhotos()`) to the `task-images` bucket under `tasks/<user id>-booking-<time>-<n>.<ext>`. If an upload fails nothing is sent, the button is restored and the customer can remove the photo or retry.
- Photo links are saved in `bookings.notes` as a last line, `Photos: <url> <url>`. The "Request sent" screen says how many were attached.
- Previews are released when the pop-up closes or is reopened.
- `tasker-profile.html`: added the `i-camera-plus` icon to the sprite.
- `css/profile-pages.css`: `.tp-bk-file`, `.tp-bk-photos`, `.tp-bk-thumb*`, `.tp-bk-add-photo`.
- Photos in `task-images` are public files (anyone with the link can open it), the same as task photos. Stage 5 can decide whether booking photos should be private.
- Until Stage 5, both Bookings pages show the whole `notes` text, so the `Area:`, `Address:`, `Urgency:` and `Photos:` lines (long links) appear raw on a card note. Stage 5 reads them and shows them properly.

## Stage 5: what changed
Deploy order: run `sql/booking-popup-stage5.sql` on staging first, then upload the files.
- **SQL (`sql/booking-popup-stage5.sql`):** `bookings` gets `job_title`, `job_description`, `job_area`, `job_urgency` (flexible/urgent), `job_photos` (text[], max 5). New table `booking_private(booking_id, address)` with RLS: the customer can add and read their own; the tasker can read it only when the booking status is confirmed or later (never pending or cancelled); no update or delete from the browser. `bookings.amount` is untouched (the guard trigger still blanks it on insert).
- **`js/tasker-profile.js`:** every request is now its own booking (the "reuse an open booking, save nothing" behaviour is gone; `openQuote` still reuses one for chat). Details go in the new columns, `notes` keeps just title + description. If the SQL has not been run, the insert is retried the old way (details as lines in notes) and the street address is left out of the open notes. The street address is saved to `booking_private`; if that fails the "Request sent" screen tells the customer to send it in chat. Helper text now says only the booked tasker sees it, after they accept.
- **`js/booking-job.js` (new, shared):** reads the columns, falls back to the old notes lines for requests sent before the SQL (never shows an `Address:` line from notes), loads allowed addresses, and draws the compact block.
- **`bookings.html` / `js/bookings.js` (tasker):** loads the job columns and addresses; card title = task title, else job title, else service name; the note shows the description; below the figures: area chip, Urgent chip, the street address once confirmed, up to 3 photo thumbnails (+N).
- **`customer-bookings.html` / `js/customer-bookings.js`:** same block (no address line). "Provider Receives" is removed, so the customer no longer sees the 12% split; the figures row is now Job Price + Payment (`.bk-figures--two`), and the unused fee code was deleted.
- **CSS:** `css/bookings.css` (`.bk-job*`, `.bk-figures--two`), `css/profile-pages.css` (phone padding for the pop-up).
- Both pages still fall back to smaller column sets, so they keep working if the SQL is not run.

## Still showing the fee to customers (not changed)
The job room (`js/messages-money.js` and friends) may show fee wording when a customer pays. Not checked in this work.

## Known issues to settle later
- Other booking forms exist (`js/taskers.js` modal, `createBooking` in `js/db.js`). Only the tasker-profile pop-up is in scope so far.
- `node tools/check-design-system.js` reports violations only in `context-snapshot/` and `withdrawals-reference/`, none in the files changed here.

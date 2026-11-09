# Handoff: stage T1a done (rules, republish banner, profile picture). Flyer = T1c, still open. (2026-11-08)

Read first: `00-PLAN.md`, `handoff-N1.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`.

## Built
SQL `sql/coordinator-flow/t1-local-tasker-rules.sql` (undo: `t1-rollback.sql`, restores the six original functions). Made by patching the owner's real function sources; tested on a scratch Postgres 16 with stand-in tables and the real function text (all scenarios passed); NOT run on the owner's Supabase.
1. Main service: `services.is_main` (one per person, unique index), `set_local_tasker_main_service(p_tasker, p_service)` (live services only, hint `not_live`). `_local_tasker_sync_public` now orders `is_main desc` first, so the public card uses it.
2. At most 3 LIVE services (`available = true`): trigger `services_live_limit`, hint `live_service_limit`. The old total limit of 5 stays. The standard listing gate skips Local Taskers by design, so this is the only limit.
3. Publish again: `local_tasker_profiles.needs_republish` + `edited_at`. Set by triggers when a PUBLISHED Local Tasker's services (incl. main/live), portfolio or profile-picture rows, or profile text change (rating/review updates do not). `publish_local_tasker` clears it. The live listing is not frozen; the pages only warn.
4. Profile picture separate from the portfolio: `local_tasker_photos.kind` ('portfolio' default | 'avatar'), `add_local_tasker_avatar(...)` (replaces the old one, same bucket and same consent rule as photos). Readiness has a new check `avatar` that blocks a FIRST publish only (the two live Local Taskers are not locked out). Portfolio count, the 8-photo limit and the cover ignore avatars.
Pages: `js/coordinator-tasker.js` + `coordinator-tasker.html` (Main badge, "Make this the main service", "n of 3 live", republish banner, portfolio-only strip), `js/coordinator-publish.js` (avatar check + link, republish text, main service first in the preview, portfolio-only), `js/coordinator-photos.js` + `coordinator-photos.html` (Profile picture card, "What is this picture?" choice), `js/coordinator-service-edit.js` + `coordinator-service-edit.html` (3-live message and label).

## Owner order (important)
1. Run `t1-local-tasker-rules.sql` in the SQL editor FIRST. 2. THEN push the changed files. The pages now select `needs_republish`, `is_main` and `kind`; before the SQL runs the profile, publish and photos pages show their load-error state.
3. Check: add a 4th live service (must be refused with the 3-live message); press "Make this the main service"; edit a published Local Tasker (banner appears) then Update public listing (banner goes); upload a profile picture and a portfolio photo.

## Known gaps / not verified
- Browser: only JS syntax was checked; the pages were not opened (no Supabase here). `node tools/check-design-system.js` lists none of the edited files (it fails on other files that were already failing).
- `local_tasker_photo_is_public(name)` (public read of photos) was not seen: confirm the profile picture is readable on the public page once published. The public Local Tasker page still needs to show the picture (`js/local-tasker-public.js` not changed; `_local_tasker_sync_public` sets taskers.photo to null on purpose).
- The step-by-step intake pages (`coordinator-tasker-new/edit`, `js/coordinator-intake.js`) upload portfolio photos only; the profile picture is added from the Photos page (the publish checklist links to it with `&kind=avatar`).
- "Publish again" does not hold a snapshot: customers see edits at once; owner chose a warning, not a hold (default in the plan). Say so if they wanted a hold.

## T1c: shop flyer (not started; needs owner answers)
Owner wants: a coordinator creates a flyer and gives it to a Local Tasker who has a shop. Existing code: `js/tasker-flyer.js`, `js/flyer-template.js`, `js/flyer-data.js`, `flyer-preview.html`, `css/flyer.css`, `images/flyer/`. `taskers` already has `business_name`, `business_address`, `business_lat/lon`, `banner_img`, `whatsapp`. Ask the owner: what must the flyer show (shop name, address, services, QR to the profile)? Is "has a shop" a yes/no on the intake page? Then add `has_shop`, `shop_name`, `shop_address` to `local_tasker_profiles` and a "Create flyer" button on `coordinator-tasker.html` reusing the flyer template (read how `tasker-profile.html` calls it first).

## Next stage after T1c: B1 (new-booking intake), see `00-PLAN.md`. Its introspect file is `b1-introspect.sql` (run it; it returns function text and column names only, no secrets).

# Handoff: N1 notifications (status 2026-11-08)

Read first: `00-PLAN.md`, `AGENTS.md`, `DESIGN-SYSTEM.md`.

## Findings from the owner's introspect results
- No trigger or function tells a coordinator about a new booking. `bookings_local_tasker_assign` (AFTER INSERT) runs `local_booking_assign_on_insert` (source not seen) and writes `local_booking_state`; nothing inserts a notification. The coordinator's last 15 notifications contain no booking alert.
- Customer messages in a Local Tasker chat go to `receiver_id` = the Local Tasker's user id (nobody logs in as them), and the site inserts the `new_message` notification from the browser (`js/messages-thread.js` ~1057) for that id. The coordinator never hears of it.
- `coordinator_send_message` inserts the message and bumps `customer_unread`, but creates no notification for the customer. `messages` has only BEFORE INSERT triggers.
- `_notify()` exists and swallows errors. `notifications_insert` RLS uses `can_notify(user_id, type, data)`; the new SQL uses a security-definer helper so RLS does not apply.
- pg_cron and `net.http_post` are available (3 jobs: gift cards, subscriptions). The coordinator bell panel already shows the phone-notification switch (`STPush.mountPrompt`), so no new front-end switch is needed.

## Written and tested on a scratch Postgres 16 (stand-in tables only)
`sql/coordinator-flow/n1-notify-coordinator.sql` (+ `n1-rollback.sql`): three triggers: new/moved booking -> coordinator (with the 4-step list), customer message -> coordinator (one unread alert per booking), coordinator message -> customer. Scratch test passed: alerts created, no duplicates, non-local chats ignored, and a notifications failure does NOT block the booking or the message (it logs a WARNING). NOT run on the owner's Supabase.

## Still unknown (blocks "on their phone and in their emails")
Whether an insert into `notifications` is pushed and emailed. The delivery code (`send-notification-email`, `push-send`, any database webhook) is not in the zip and the trigger list for `notifications` was not returned. Owner: run `sql/coordinator-flow/n1b-introspect.sql` and paste results; also paste the source of the two Edge Functions from the dashboard (they may email only some `type` values: if so add `coordinator_new_booking`, `coordinator_chat_message` to their list).

## Owner steps now
1. Run `n1-notify-coordinator.sql` once in the SQL editor.
2. Run `n1b-introspect.sql`, paste ALL results.
3. Make a test booking as a customer; check the coordinator's bell, phone and email; write in the chat from both sides.

## Next AI (after N1b results)
- Fix push/email delivery for the new types if needed (Edge Function change = owner deploys from the dashboard).
- N1d reminders: a pg_cron job every 5 minutes calling a new function that notifies the coordinator 30 minutes before and at the start time (owner chose both), once each per booking (needs a small log table or marker). Needs the `bookings.scheduled_time` type (Block 4 of n1b).
- Then write `handoff-T1.md` and stop. The coordinator-side "Accept the application" button is stage B1.

## UPDATE 2026-11-08 14:40 (n1b results received)
- Delivery exists: trigger `notifications_email` (AFTER INSERT, only when `notification_email_wanted(user_id)`, runs `email_new_notification()`) and trigger `push-notifications` (AFTER INSERT, webhook to Edge Function `push-send`). So every row the N1 triggers insert is pushed and emailed, subject to the user's `notification_preferences` (`push_enabled`, `email_enabled`) and a saved push subscription. NOT yet seen: the source of `email_new_notification`, `notification_email_wanted` and `push-send` (they may filter by `type`). Confirm with the owner's test booking; if no email arrives, read those three.
- `local_booking_assign_on_insert` inserts `local_booking_state` WITH `coordinator_id` at booking time, so the N1 trigger `lbs_notify_coordinator` fires at booking creation. Confirmed from source.
- `coordinators` has `display_name`, `phone`, `status` (no email column).
- `bookings.scheduled_time` is TEXT: `2026-11-09 — Afternoon (12pm – 5pm)` (a date and a window) or null. Reminders therefore use the window's first hour, Lagos time. Written: `n1d-job-reminders.sql` (+ `n1d-rollback.sql`): log table, `_lt_window_start(text)`, `coordinator_send_job_reminders(p_now)`, pg_cron job every 5 min. Scratch test passed (30 min before once, at start once, null/completed/not-approved bookings skipped). NOT run on the real project.
- SECURITY: the owner pasted the `push-notifications` trigger definition, which contains the project's service_role key and the push secret. Owner should rotate both (Supabase > Project Settings > API, and the push secret in the webhook and the push-send function). Never ask for trigger definitions with headers again; ask for names only.
- Owner steps: run `n1-notify-coordinator.sql`, then `n1d-job-reminders.sql`; test booking; report phone/email/bell.
- Next stage: T1 (`00-PLAN.md`). Write `handoff-T1.md` when starting it; its introspect file is `t1-introspect.sql`.

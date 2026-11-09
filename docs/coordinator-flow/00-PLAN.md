# Coordinator flow: plan and stages (owner request 2026-11-08)

Rules (same as earlier work): owner uses ONLY the Supabase SQL editor and dashboard function deploys. Follow `AGENTS.md` + `DESIGN-SYSTEM.md`. One stage per session, then stop and wait for "go". Never claim a test passed or SQL applied unless it really ran. Nothing in this plan has been built yet.

## What the code already does (found in the zip)
- Booking page `coordinator-booking.html` and chat `coordinator-chat.html` exist, with cards for: record the Local Tasker's answer (phone call record, price read-back), quote, extras, price reduction, milestones (arrived/started/finished), release code, exceptions, closeout.
- States (`lt_status`): assigned > awaiting_tasker_confirmation > tasker_confirmed > quote_sent > quote_approved / quote_declined. `STCoBk.nextAction()` gives the one next action.
- The chat dock (`js/coordinator-dock.js`) already has the release-code box (3 tries, then locked).
- Notifications: shared bell panel (`js/notifications-panel.js`, polling + realtime), phone push (`js/push.js`, `push_save_subscription`), email via `notifications` > `send-notification-email` > Resend. The coordinator portal loads the bell panel but NOT the phone-notification switch (`STPush.mountSettings`), and the booking-created notification for coordinators is created by database code that is not in the zip.
- Not in the zip: all `local_booking_*`, `coordinator_*`, notification and booking triggers, `push-send` and `send-notification-email` functions. Every stage that changes them starts with a read-only introspect file.

## Stages
| Stage | Content | Needs DB | Introspect file |
|---|---|---|---|
| N1 | Notifications. (a) New booking: coordinator gets a bell item, a phone push and an email, with a "what to do now" checklist in the text. (b) Coordinator/customer chat messages create notifications both ways. (c) Coordinator portal gets the phone/email notification switches and asks permission. (d) Reminder to the coordinator at the job day and time (scheduled). | yes | `n1-introspect.sql` |
| T1 | Local Tasker setup. (a) Coordinator picks the MAIN service. (b) Max 3 published services, enforced in the database and shown on the page (page text says 5 today: `coordinator-service-edit.js`). (c) After editing a published Local Tasker a banner says "Publish again", and the live copy is held until Update is pressed. (d) Profile picture collected separately from the 8 portfolio photos. (e) Flyer: coordinator creates it for a Local Tasker who has a shop and gives it to them (reuse `tasker-flyer.js`, `flyer-template.js`). | yes (b, c, d) | `t1-introspect.sql` |
| B1 | New-booking intake. A "New booking" panel tells the coordinator, in order: accept the application, chat with the customer first to confirm date, price, place and details; record it; while chatting, call the Local Tasker to confirm; only then record the Local Tasker's answer. Quote is blocked until the customer chat is recorded. | small | `b1-introspect.sql` |
| B2a | Customer declines a quote and can propose a lower service price; the coordinator is told what to do (bell / phone / email). DONE, not yet run. | yes (small) | none (sources already pasted) |
| B2b | Coordinator "what to do now" after a decline: phone the Local Tasker with the customer's price > record the new answer > send the new quote, as guided steps on the booking page (same style as the B1 "New booking" card). | no | none. DONE, not yet pushed. |
| B2c | If the customer will not accept: the coordinator closes the booking (task stays closed, not re-opened), the customer is told, the Job Room chat closes. | yes | `b2c-introspect.sql` (`_local_booking_cancel_block`, task triggers, `job_cancel`) |
| B2d | The quote appears as a card in the chat: coordinator chat page (read) and the message that puts it there. | yes | `b2d-introspect.sql` (`coordinator_send_message`, `coordinator_chat_thread`, `coordinator_chat_cards`, messages triggers) |
| B2e | The same quote card in the customer's Job Room with Approve / Decline (uses the B2a answer function; the proposed-price field is in the card). | no (front end) | none after B2d |
| B3 | Job day. Coordinator asks the customer for the location and shares it with the Local Tasker; day-and-time prompt to call the Local Tasker and confirm work began; Local Tasker finished > coordinator asks the customer if satisfied > release code pop-up in the chat > money released > chat closes after the code is entered. | yes | `b1-introspect.sql` |
| B4 | Booking page countdown for the Local Tasker's payout, a notification to the coordinator when it is sent, and a task leaves the site only when closed (not when it is booked). | yes | `b1-introspect.sql` |

Order: N1 first (most painful bug), then T1, B1, B2, B3, B4.

## B2 split (owner request 2026-11-08: "it seems like a big build, divide the stages further")
B2 became B2a to B2e (table above). Order: a, b, c, d, e. One per session, then wait for "go".
Reading of the plan used for B2: "payment is declined" = the customer declines the quote (the last point where the price can still change; after approval the payment requests exist and `price_propose` is blocked after the first payment). The proposed price is for the SERVICE FEE line (the Local Tasker's own price), must be lower than it. Transport and materials are real costs and stay as the Local Tasker confirmed them.

## Owner answers (2026-11-08)
1. Payout countdown (B4): 24 hours after the release code.
2. "Task closed" (B4): the coordinator writes the release code; entering it closes the chat and the task.
3. T1: no Local Tasker has more than 3 live services today, so the limit only needs to block the 4th.
4. Reminders (N1d): both, 30 minutes before and at the start time.

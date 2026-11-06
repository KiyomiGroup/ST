# M17: what to run and what to click

Do the parts in order. Send me anything that fails (a screenshot or the result rows).

## Part 1. Database (Supabase SQL editor, run each file once)

1. `sql/final/m17-checks.sql` (read only). Every row must say PASS. FAIL rows: send them to me.
2. Re-run the self-cancelling tests, now that all stages are live together. Each ends with an error box that says "ALL PASS" or "n FAILED"; that box is normal and keeps nothing.
   `sql/chat-rules/stage-C1-tests.sql`, `sql/offers/stage-M3-tests.sql`, `sql/reviews/m6-tests.sql`, `sql/reviews/m7-tests.sql`,
   `sql/location/m12a-tests.sql`, `m12b-tests.sql`, `m13a-tests.sql`, `m13a2-tests.sql`, `m13b-tests.sql`,
   `sql/referrals/m14-tests.sql`, `sql/referrals/m16-tests.sql`.
3. Local Tasker coordinator chat and review still work: `sql/local-tasker/stage-6a-tests.sql` and `stage-6b-tests.sql`.

## Part 2. Click-through on the live site (use two test accounts: one customer, one tasker; a Paystack TEST key)

**Chat**
- [ ] The tasker cannot start a chat from a profile or a task (no Message button, no chat link).
- [ ] A pending offer has no chat. A pending booking has no chat.
- [ ] The customer accepts an offer: a chat opens for both people.
- [ ] A booking the tasker accepted has a chat.
- [ ] A second offer on the same task cannot be accepted until the first is cancelled.
- [ ] After "Cancel accepted offer" the chat is closed (history readable, sending disabled), and the tasker is told.
- [ ] After the job is completed and paid out the chat is closed.

**Reviews**
- [ ] A review can only be left after the job is completed and released. One review per person per job.
- [ ] Ratings show only real numbers. A person with no reviews shows no star number.
- [ ] A Local Tasker's coordinator can still chat and leave the review of the customer.

**Customer home**
- [ ] Featured Taskers, Taskers Near You, Explore Services, Your Tasks, Other Tasks (no side line, no "Part A/B" text).
- [ ] "Other Tasks" cards open the task but a customer cannot offer on or accept offers for another customer's task.
- [ ] A card with no photo shows the StreetTasker logo.

**Tasker home**
- [ ] Urgent (only if there is a paid urgent task), Tasks Near You (asks to add a location if none), Matching Your Services, All Available. No task appears twice.

**Referrals**
- [ ] Sign up with someone's link, verify the email: the referrer gets exactly 5 points, once.
- [ ] Own link, own email alias, a made-up code: no points.
- [ ] Customer with 1,000 or more points sees "Add ₦200 to my gift balance". After pressing it the balance appears on the gift card page and pays part of a booking. Pressing again adds nothing.
- [ ] Tasker with a saved gift sees "Activate my free Starter month". It gives 30 days of Starter. A second gift is refused with "You can activate this reward once your current plan has ended."
- [ ] A tasker in a free reward month who starts a plan payment sees "You are on a free Starter month. Paying now ends it. Continue?"

**Regression**
- [ ] Paystack test payment for a booking and for a subscription.
- [ ] Post a task. Send an offer. Subscription offer and listing limits still apply.
- [ ] Sign up, log in, log out, reset password.
- [ ] A shared task link `/t/<task id>` shows a preview in WhatsApp and opens the task.

# Stage S4f-2: manage buttons and listing chooser (page + JS)

S4f-1 applied, S4f-3 applied, S4e deployed (owner message and convention).

## Done
- my-subscription.html, js/my-subscription.js, css/my-subscription.css edited (S4e base).
- Buttons by state: active = "Change to a lower plan" (only if a cheaper plan exists) or "Stay on my plan" (when a downgrade is scheduled) plus "Cancel subscription"; past due = cancel only (the server refuses downgrades then); cancelling = "Undo cancellation"; Free / ended = none. "See all plans" stays the upgrade path (payment is S5d).
- Dialogs (Go back / confirm) for lower plan, stay, cancel; undo has no dialog (harmless, reversible). Lower plans come from get_public_plans() (price below the current price); no plan name or number is written in the code.
- Only schedule_downgrade(p_plan), cancel_subscription(), undo_cancel() and ST.db.chooseActiveListings(ids) are called; every S4f-1 error code has a plain message; the page re-reads get_my_entitlements() after each action and shows a done note.
- Chooser card appears only when active listings exceed the plan limit: lists own non-paused listings (read of own services), preselects the most recently updated up to the limit, locks the rest, saves with choose_active_listings.
- Dialog overlay styled in css/my-subscription.css (tasks.css is not loaded on this page). Tokens only.
- Tests: tests/s4f2-manage.test.mjs (5), tests/s4e-my-subscription.test.mjs (one title and assertion note), tests/s4f2-manage-render.py (15 browser checks).

## Exit check
- RUN: node --test tests/*.test.mjs: 51 pass.
- RUN: stubbed-Supabase headless Chromium: 15 PASS (downgrade, stay, go back, cancel, undo, error in dialog, past due, free, chooser preselect and save, 360 px no sideways scroll); S4e render check: no page errors. Viewed the dialog at 1280.
- RUN: design check: no violation in my files. It reports violations in context-snapshot/verify.html and withdrawals-reference/css/tokens.css (not touched by this stage).
- NOT run: real database and real phones; the S3e / S5a hand-over on the change date (preview with: select apply_due_subscription_changes(true);).

## Open issues
- The chooser acts at once (pauses the others now) because that is what choose_active_listings does.
- Past-due banner still has no grace end date (needs grace_ends_at from the SQL).
- S3g privacy line still open (before S4h).

## What you do now
1. Copy these three files into the site: my-subscription.html, css/my-subscription.css, js/my-subscription.js. (The tests are optional.)
2. Open My Subscription as a tasker on a paid plan and try "Change to a lower plan", then Go back. Send back "S4f-2 deployed" or the exact error text.

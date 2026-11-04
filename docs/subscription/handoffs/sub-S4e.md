# Stage S4e: My Subscription page (read-only)

S4d recorded as deployed (owner sent "do next stage" with no error: standing convention).

## Done
- `my-subscription.html`, `css/my-subscription.css`, `js/my-subscription.js`: hero, plan card (name, PRO/PREMIUM label, status chip, price, period, next renewal or end date or allowance reset), usage meters (offers used of allowance; Business shows Unlimited plus the fair-use 24-hour and monthly meters; extra credits if any; active listings of limit), included features, verification line. Native `<progress>` bars (no inline styles).
- Data: `get_my_entitlements()`; `get_public_plans()` only to name a scheduled plan or an ended plan; the person's own `subscriptions` row (RLS own read) only to say an earlier paid plan has ended. No write call anywhere. No price, limit or plan name in the page or script.
- States: loading, error + retry, free, active, past due / grace (banner, short grace period, no number), cancelling (benefits until the date, then Free), scheduled change to a lower plan (banner), ended plan (banner), over-limit listings (note: nothing deleted, paused after notice). Signed out: `login.html?next=my-subscription.html`. Customers: `my-tasks.html` (same rule as My Services).
- `components/navbar.html`: the two tasker "Subscription" links (settings menu and drawer) now point to `my-subscription.html` (label unchanged). The pricing page stays reachable through "See all plans" and the footer "Pricing" link.
- `js/pricing-plans.js`: `hasManagePage` is now true, so a signed-in person sees "Manage your plan" on the Free card.
- Not done on purpose (D6 also mentions a dashboard summary card): `dashboard-tasker.html` is 160 KB; a small link/summary card there is left for a later stage so no big file is touched here.

## Exit check
- RUN: design check: only the three allowed reference-copy failures.
- RUN: `node --test` s4b (5), s4c (6), s4d (9), s4e (7): 27 pass.
- RUN (headless Chromium, SUPABASE STUBBED, `tests/s4e-render.py`): free, active, Business (unlimited), past due, cancelling, scheduled downgrade, ended plan, over limit, error, signed out (redirect), customer (redirect); 3 cases at 360 px, no sideways scroll, no page errors. Viewed Business at 1280 and past due at 360.
- NOT run: real database, real phones, screen reader; `css/membership.css` was not in this session's files, so label styling was not seen (the page uses the same classes as the pricing page). Earlier suites not in the zips were not re-run.

## Open issues
- `components/navbar.html` here is from the 2026-11-03 project snapshot. If the owner changed the navbar since, make the two edits by hand: change `href="subscription.html"` to `href="my-subscription.html"` on the "Subscription" menu item and the "Subscription" drawer link only.
- Past-due banner does not give the grace end date (`get_my_entitlements` does not return it). If wanted, add `grace_ends_at` to the SQL in a later stage.
- Receipts / payment history are not on this page (not in the S4e row).
- Still open: `taskers` mirror-row answer (before S4i), S3g privacy line (before S4h).

## Next
S4f (manage actions), then S5d.

# Tasker Bookings page: handoff

Page: `bookings.html` + `css/bookings.css` + `js/bookings.js` (prefix `bk-`). Built like `applications.html`.
Rules: tokens only, no inline styles, no `!important`. `node tools/check-design-system.js` must pass.

## Stages
1. Shell, data layer, stray-file fix ............ DONE
2. Tabs, toolbar, full booking cards ............ DONE
3. Actions, shared-status fix, switch nav/redirect  DONE (this zip)
4. Sidebar ...................................... planned
5. Mobile pass, accessibility, cleanup .......... planned

## Stage 3: what changed
| File | Change |
|---|---|
| `bookings.html`, `css/bookings.css`, `js/bookings.js` | Action buttons and three dialogs (decline, mark done, enter code) |
| `js/payments.js` | `markJobDone` now sets `provider_done` and checks the booking is paid and not already past that point |
| `js/messages-list.js` | `provider_done` counts as "awaiting customer approval" in Messages (one line) |
| `components/navbar.html` | Tasker Bookings pill links to `bookings.html` |
| `js/auth.js` | Tasker nav icon "pending" links to `bookings.html` |
| `dashboard-tasker.html` | `?panel=bookings` and `#bookings` redirect to `bookings.html`; `loadBookings()` (used by the old Bookings tab buttons) now goes to `bookings.html` |

If your copy of any of these files has changed since the zip you sent me, apply only these edits instead of replacing the file:
- `navbar.html`: in the tasker pill, `href="bookings.html"` on `#np-bookings`.
- `auth.js`: `setHref('navIconPending', isTasker ? 'bookings.html' : panelUrl('my-tasks'));`
- `messages-list.js` `derive()`: `bk.status === 'awaiting_confirmation' || bk.status === 'provider_done'`.
- `dashboard-tasker.html`: in the first `<script>` in `<head>`, add `if (q.get('panel') === 'bookings' || window.location.hash === '#bookings') { window.location.replace('bookings.html'); }`; at the top of `loadBookings()` add `window.location.href = 'bookings.html'; return;`.
- `payments.js` `markJobDone`: replace the whole function with the one in this zip.

### Job flow after Stage 3
1. Customer books: `pending`. Tasker taps **Confirm Booking** (`confirmed`) or **Decline** (`cancelled`).
2. Customer pays into escrow: `payment_status = paid`, `status = confirmed`.
3. Tasker taps **Mark Job as Done**: `provider_done`. Customer is notified.
4. Customer confirms (`confirmJobComplete`): `awaiting_confirmation`. Tasker sees **Enter Completion Code**.
5. Tasker enters the code: `completed` + `released`; wallet credited minus the 12% fee. 3 wrong tries lock the code.

Bookings already stuck in `awaiting_confirmation` from the old Mark Done will show "Enter Completion Code" even though the customer never confirmed. They clear once the customer confirms and gives the code.
Decline only shows for unpaid pending requests. The Confirm check also requires the status to still be `pending`.

### Test checklist
Confirm and decline a pending request; mark a paid job done; check the customer's Bookings panel shows "Provider Says Job is Done"; customer confirms; enter a wrong then the right code; Message Customer opens the chat; nav pill and old `?panel=bookings` links land on `bookings.html`.

## Stage 2: what changed
| File | Change |
|---|---|
| `bookings.html` | Tabs, toolbar (search, service, date, sort), Load More, extra icons |
| `css/bookings.css` | Tabs, toolbar, booking cards, figures, customer box, hints, tags. Basic rows from Stage 1 removed |
| `js/bookings.js` | Tab counts, filters, sort, paging, full cards, empty/filter states |

Tabs: All, Pending, In Progress, Sign-Off, Completed, Cancelled. Counts respect search, service and date filters.
Date filter uses the booking's created date. Default is All Time so active older jobs never disappear.
Cards show a "what happens next" line per state, a customer box, a payout breakdown (job value, 12% fee, what you receive), and the customer's note.
Cards have no action buttons yet, only View Task Details and View in Wallet links. Actions arrive in Stage 3.

## Stage 1: what changed
| File | Change |
|---|---|
| `bookings.html` | New page shell (header, list area, states) |
| `css/bookings.css` | New: shell, header, buttons, states, badges, basic rows |
| `js/bookings.js` | New: sign-in and role guard, loads bookings + customer/task/service details, maps each to a tab group and label, renders basic rows |
| `js/auth.js` | Merged (see below) + `bookings.html` highlights the Bookings pill |
| `js/db.js` | Merged (see below) |
| `components/navbar.html` | Merged (see below) |

## Stray root files (the fix)
Five files had been copied into the project root. Each was compared with its folder copy and the newer parts were kept:

| Root copy | Folder copy | Result |
|---|---|---|
| `navbar.html` | `components/navbar.html` | Root was newer (Applications pill links to `applications.html`). Folder copy replaced. |
| `auth.js` | `js/auth.js` | Root was newer (`applications.html` pill mapping). Folder copy replaced. |
| `db.js` | `js/db.js` | Root was newer (`updateMyApplication`, `withdrawMyApplication`, which the Applications page needs). Folder copy replaced. |
| `applications.js` | `js/applications.js` | Folder was newer. Unchanged. |
| `applications.css` | `css/applications.css` | Folder was newer (mobile pass). Unchanged. |

**Delete these 5 files from the project root:** `navbar.html`, `auth.js`, `db.js`, `applications.js`, `applications.css`.
A zip cannot delete files, so do it by hand. After deleting, the design-system check passes.

## Booking states (real data)
`bookings.status`: pending, confirmed, in_progress, provider_done, awaiting_code, awaiting_confirmation, completed, cancelled, disputed.
`bookings.payment_status`: unpaid, paid, released, disputed.
Platform fee: 12% (`PLATFORM_COMMISSION` in `js/payments.js`). Free tier: max 3 active bookings.

Tab groups in `js/bookings.js` `group()`:
pending = `pending`; progress = confirmed / in_progress / disputed; signoff = provider_done / awaiting_code / awaiting_confirmation; completed = completed or payment released; cancelled = cancelled.

## Not switched on yet
The nav "Bookings" pill and the `dashboard-tasker.html?panel=bookings` redirect still point at the old dashboard panel. That panel is the only place with Confirm, Mark Done and Enter Code, so the switch happens in Stage 3, once the new page has those actions. Test Stage 1 at `/bookings.html`.

## Known issues found (not changed in this stage)
- `markJobDone` and `confirmJobComplete` (js/payments.js) both set `status = 'awaiting_confirmation'`, and nothing sets `provider_done`. After a tasker taps Mark Done, the tasker UI cannot tell "waiting for customer" from "customer confirmed, enter code".
- `submitCompletionCode` reads `completion_code` in the browser and compares it there, so a tasker can read the code from the network. Moving the check to a Supabase function (RPC) is the safe fix.

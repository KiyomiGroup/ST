# Decisions the owner needs to make (each has a proposed answer)

## Answered by the owner on 2026-11-07
- **D-A3:** first Super Admin email is **admin@streettasker.com** (one address so far; a second Super Admin is still recommended, see D-A10).
- **D-A3 (revised 2026-11-08):** `admin@streettasker.com` is already the owner's **coordinator** login. The bootstrap refused it. The owner chose to keep that one login for both the coordinator and the admin area. Recommended alternative (not chosen): a separate admin-only login. Consequence recorded as rule **R-SELF** in `00-PLAN.md`.
- **D-A3b (2026-11-08):** the owner wants `admin@streettasker.com` to be an admin only, not a coordinator. `a1b-release-coordinator.sql` does this safely; it is blocked while that login still looks after Local Taskers. R-SELF stays until then.
- **D-A10 (2026-11-08, reported by the owner, not verified):** a second admin, `kiyomigroups@gmail.com`, was added by another AI. Check with `sql/admin/a3c-admin-report.sql`. Approvals need this second person to be an active Super Admin.
- **D-A10 (answered 2026-11-08, at the A13 request):** the owner says `kiyomigroups@gmail.com` **is a Super Admin**. Approvals can now have a second person. (Stated by the owner; not checked against `admin_user_roles`.)
- **D-A3c (2026-11-08):** the owner wants `admin@streettasker.com` to be an admin only, **also not a customer**. Not done yet: `a3c-admin-report.sql` shows what that login owns first. No history is deleted.
- **D-A4 (default applied 2026-11-08, stage A3a):** admin has its own frame (`DESIGN-SYSTEM.md` 4.17). The design checker needed no change: it only looks for the public shell on root-level pages.
- **D-A5:** there are **no reference screens**; follow `DESIGN-SYSTEM.md` and the existing website style for consistency.
- **D-A14 (answered by A0):** the limit exists as per-tier capacity in the database, not as a fixed 10 (`ARCHITECTURE.md` B5).
- **D-A16 (answered by A0):** codes are still used by sign-up; no separate Codes screen.

- **Float source (2026-11-10, owner):** top-ups start from her personal money; later Paystack settlements refill it, so over time she stops using personal money. Recorded as the `source` field and the owner-funded float in `04-ACCOUNTANT-ADMIN.md` section 5.
- **Money flow (2026-11-10, owner, in chat):** every day at 9 pm Nigeria time the day's customer money (job payments and gift cards) is totalled, shown on an admin page and emailed to the admin; the admin tops up the Paystack Balance by hand and records it; payments after 9 pm go to the next day's batch; payouts keep the 24 hour clearing; Local Tasker-style automatic payout is wanted for regular taskers too (stage M1). Recorded as A15b and M1; see `04-ACCOUNTANT-ADMIN.md`.

- **Accountant admin and capital (2026-11-10, owner):** the admin that handles money is called **Accountant**, handles money only, and shows every income, outgoing, spending, subscription, gift card, commission, payout and Local Tasker flow separately. The business starts with **₦200,000** of her own money as payout float; she expects that ₦200,000 back later. Recorded as A15b-1 to A15b-3 in `04-ACCOUNTANT-ADMIN.md`.

Reply with the ID and "ok" or your change, for example "D-A1 ok, D-A7 later". Anything left unanswered uses the proposed default. None of these block A0 (the read-only SQL checks).

| ID | Question | Proposed default | Why it matters |
|---|---|---|---|
| **D-A1** | Where does the admin live? | Same repo, same domain, folder `/admin/`, hidden from search and from the public site. | The site is plain static HTML on Vercel. A second app would add hosting, login and keys to manage. |
| **D-A2** | Admin accounts: separate logins with two-step verification (an authenticator app)? | Yes: dedicated admin logins, separate from customer accounts. Two-step required once you have enrolled yours. | Admin power is too high for a password alone. The default avoids locking you out on day one. |
| **D-A3** | Who are the first Super Admins? | Send the email address(es) you want to use for admin (not your customer email). Two people recommended. | The AI needs the real address to write the one-time statement you run in the SQL editor. |
| **D-A4** | Admin needs a different page frame from the public pages (side menu app layout). May `DESIGN-SYSTEM.md` get a new section 4.17 "Admin shell", and may the design checker skip `/admin/` for the page-shell rule only (tokens-only still enforced)? | Yes. | `AGENTS.md` rule 9 says every new page uses the public page shell. `support.html` already differs. Without this decision the checker blocks admin pages. |
| **D-A5** | Send the 26 Stitch screens. | Send as HTML or images in a zip. | They were not in the project zip. Without them the AI follows `02-SCREEN-SPECS.md` and the design system. |
| **D-A6** | The current support console (`support.html`) | Keep it working; build the new Disputes page beside it; redirect only after it is proven (A13). | It is live and handles real money decisions. |
| **D-A7** | Service categories are hardcoded in `js/categories.js`. Make them editable from admin? | Not now. Read-only list in admin. Revisit after launch. | Making them database-driven touches search, posting, icons and detection on every page: high regression risk for little benefit now. |
| **D-A8** | Website content from admin: how much? | Banner, FAQs, help articles, contact details only. Legal pages, homepage layout and sitemap stay in git. | Legal text should only change with a lawyer; the homepage is heavily designed. |
| **D-A9** | Broadcast notifications | Show recipient count; daily cap; approval needed above 50 recipients; respect notification preferences. | Every notification row is also emailed, so a broadcast is a mass email. |
| **D-A10** | Approvals need two different people. If you are the only Super Admin, you cannot approve your own request. | Appoint a second Super Admin, or keep the SQL editor as your own route for those changes and use the page for staff requests. | Otherwise you cannot approve your own sensitive changes through the page. |
| **D-A11** | May admins read private chats? | Only inside a dispute, through the existing logged function. No general chat browser. | Privacy and trust. The existing function already records "support read the conversation". |
| **D-A12** | Phone, email and address are masked in admin with a logged "Reveal". | Yes. | Least privilege. |
| **D-A13** | Please send `ADMIN-REQUIREMENTS.md` and the whole `docs/subscription/` folder (and `docs/verification/`). | Send before A11 and A18. | The subscription project says that file is the admin contract. It is not in this zip. |
| **D-A14** | Is the rule "a coordinator may have at most 10 Local Taskers" already enforced in the database? | Unknown. A0 Block 12 looks. If not, A9 adds it in SQL. | The brief requires backend enforcement. |
| **D-A15** | What does "suspend" mean for each person type? | Customer: cannot sign in to book or post; open bookings and disputes continue. Tasker: hidden from search, cannot take new work, open jobs continue. Local Tasker: unpublished, coordinator told. Nothing is deleted. | Money may be held on an open job; suspension must not strand it. |
| **D-A16** | Coordinator codes (H8): are they still used after Stage D-2 closed code redemption? | A0 checks. If unused, no Codes screen. | Avoids building a screen for a removed feature. |
| **D-A17** | The urgent-task fee is verified only in the browser (your issue X1, `js/tasks.js`). | Not part of admin. Admin labels it "unverified" in Transactions. Fix as a separate security stage. | A payment that the server never checked should not look trusted in finance reports. |
| **D-A18** | Cutoff time | 9:00 pm Africa/Lagos (WAT, UTC+1, no daylight saving) = 20:00 UTC, by the time the server confirmed the payment. | The owner's own rule. Confirmation time, not the customer's click, so a late webhook cannot reopen a closed day. |
| **D-A19** | What should "suggested top-up" be? | `due`: payouts falling due before the next cutoff, minus the balance she types. Income total shown beside it. Switchable to `income` (the day's total money in) in settings. | Income and what is due differ day to day. A top-up of income alone can be too small and leave payouts awaiting funds. Over time they match. |
| **D-A20** | Gift card sales: add to the top-up? | No by default: shown as "keep in client money account". Gift-funded jobs are covered by payouts due. Switchable (`topup_include_gift_sales`). | Gift cards never expire, so the money may sit unused for a long time. Moving it all to Paystack is allowed but not needed. |
| **D-A21** | Read the real Paystack Balance automatically? | No. She types it. | Rule 7: no admin function calls Paystack. A read-only balance function is possible later as a separate decision. |
| **D-A22** | Who gets `accounting.view` and `accounting.record`? | The new Accountant role and Super Admin only. Reminders go to everyone with `accounting.view`. | Money visibility. |
| **D-A23** | Does repaying the owner's ₦200,000 need a second person's approval? | Yes: the Accountant requests, a different Super Admin approves, the record is written once. | It is money going to the owner personally; two people must see it. |
| **D-A24** | Expense categories | Paystack fees, Hosting and database, Email, ID verification, Domain, Marketing, Tax, Other. | The Accountant needs fixed groups so costs add up. Change the list if yours differ. |
| **D-A25** | Does the Accountant see customer and tasker names? | Names masked; booking or payment reference shown. Reveal only through the existing logged reveal. | Least privilege. |
| **D-A26** | The existing `finance` role | Stays read only and unchanged. `accountant` is a new role. | Avoids changing a role that already exists. |

## What to do now (after A0)

1. Read the **security alert** in `ARCHITECTURE.md` Part C item 6 (a service-role key and two secrets appeared in the results you pasted). Tell me when you want stage S1 (rotation) done.
2. Say **"go"** for **A1**. Nothing else is required for A1.
3. Optional, before A9, A12, A16 and A26: run the blocks of `sql/admin/a0-followup.sql` and send the results. Paste results only; they contain no secrets (the queries are written to avoid them).

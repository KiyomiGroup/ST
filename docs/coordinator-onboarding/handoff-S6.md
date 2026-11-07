# S6 handoff: redeem, routing, final QA (todo)
1. Sign-up with a valid code: after the account exists (note email confirmation may delay the session) call `coordinator_redeem_code`; then go to `coordinator-dashboard.html`. Handle: confirmation-required sign-ups (store the code in sign-up metadata or `sessionStorage` and redeem at first login), Google sign-up, reused/expired code.
2. `coordinator-login.js` already sends active coordinators to the dashboard; make sure a redeemed user lands there and others are unchanged.
3. QA everything at 390, 768, 1280 (headless screenshots), the nav never covers a heading, `node tools/check-design-system.js` passes, update `MIGRATION-CHECKLIST.md`.
4. Final zip with the whole project and all handoffs.

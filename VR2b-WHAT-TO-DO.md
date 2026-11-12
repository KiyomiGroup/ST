# VR2b: withdrawal popup and verify pages (UI only)

Copy each file into the same path in your repo (whole files, taken from your latest repo).

## Files
- wallet.html, coordinator-wallet.html, css/wallet.css, js/wallet-data.js, js/payments.js
- verify.html, js/verify.js, coordinator-identity.html, js/coordinator-identity.js
- supabase/functions/process-withdrawal/index.ts (+ vr2a.test.ts): CORRECTED version. It replaces the one in VR2a (the "still clearing" code name was wrong there).

## Deploy order
1. If VR2a is not yet live: deploy process-withdrawal/index.ts first, then run vr2a-withdrawal-gate.sql. If VR2a is already live: just redeploy process-withdrawal/index.ts.
2. Upload the front-end files.

## Test
1. Normal tasker, unverified: open Wallet > Withdraw. A notice with "Verify now" shows and Continue is disabled. The link opens verify.html with a withdraw line at the top.
2. Verified tasker, bank account name matches: "Name matches" badge, Continue works.
3. Account name differs: "Name does not match" badge, Continue disabled with a message.
4. Coordinator wallet: same, but "Verify now" goes to coordinator-identity.html.
5. Exempt test accounts: no notice, no badges.

## Caveats
- Wording on the new "One more check" panels (verify.html, coordinator-identity.html) and the popup notices is mine, not approved by you. Change freely.
- If the check cannot load, nothing is blocked in the UI; the server still enforces the rule.
- verify.html "Why we verify" text still describes the old rule (VR5). Coordinator pre-activation verification removal is VR4.
- Didit's name field names are still unconfirmed against a real session. Test with one real verification.

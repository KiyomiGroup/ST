# VR1: what to do, in this order

Files in this zip sit at the same paths as in your repo. Copy them over the repo copies (none of them is a categories file).

## Step 1. Database (Supabase SQL editor, live project)
1. Run `sql/verification-rework/vr1-legal-name.sql` (whole file). Last row must say `DONE: VR1 installed`.
2. Run `sql/verification-rework/vr1-tests.sql`. Last row must say `RESULT: ALL PASS`. If anything else, STOP and send me the message.
   Do NOT run vr1b yet.

## Step 2. Edge Functions (Supabase dashboard > Edge Functions)
1. `didit-webhook`: open Code, replace everything with `supabase/deploy/didit-webhook/index.ts`, Deploy. Keep "Verify JWT" OFF.
2. `didit-sync`: same with `supabase/deploy/didit-sync/index.ts`. Keep "Verify JWT" ON.
Order matters: SQL first, then these. (If the functions went first, name saving would fail quietly; harmless but wasted.)

## Step 3. Website + consent version (do together, within a few minutes of each other)
1. Upload the four pages: `verify.html`, `coordinator-identity.html`, `data-consent.html`, `privacy.html`.
2. Immediately run `sql/verification-rework/vr1b-consent-v2.sql`. Last row must say `DONE: VR1b installed`.
   If the pages say v2 and the database says v1 (or the reverse), nobody can start a check. If that happens, run `vr1b-rollback.sql` and put the old pages back.
   Effect: people who agreed to v1 are asked to agree again the next time they START a check. People already VERIFIED are not affected.

## Step 4. Test (one account)
1. Use a test account that is NOT verified. Verify it in Didit sandbox.
2. In the SQL editor run:  `select user_id, cardinality(name_tokens) as words, source from idv_verified_names;`
   Expect one row with words = 2 or more, source = didit.
3. If NO row appears: Didit's name field names are a guess (the plan marks them UNVERIFIED). Supabase > Edge Functions > didit-webhook > Logs: look for "name store failed". If there is no such line either, the decision had no name field I recognised. Send me one sandbox decision response (delete the ID number and date of birth first) and I will fix `extractLegalName`.
4. Your existing verified accounts have no stored name. For your own test accounts you can set one by hand:
   `select idv_set_name_manual('<user uuid>', 'Full Name As On ID');`
   Every other already-verified person is asked to re-verify once at their first withdrawal (VR2 handles that).

## Not done in this stage
- Nothing changes for users yet: no gate, no banner, no withdrawal rule. VR1 only stores the name and adds the match function.
- The consent text is not lawyer-approved. Please have the new sentence checked.
- `data-consent.html` version is now 2.0, last updated 11 November 2026. The "Effective date" line still says 9 November 2026: change it to the day you really release.

## Next: VR2a (withdrawal gate on the server). I need from you
1. The DEPLOYED code of Edge Function `process-withdrawal` (Supabase dashboard > Edge Functions > process-withdrawal > Code). The repo copy is old.
2. The VR0 results: run `sql/verification-rework/vr0-introspect.sql` blocks 01-10 and export each as CSV (I did not get these CSVs).
3. Tell me you finished Step 4 with a row showing.

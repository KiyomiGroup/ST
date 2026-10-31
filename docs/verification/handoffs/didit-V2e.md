# Didit stage V2e: deploy runbook

## Done
- `docs/verification/DEPLOY-FUNCTIONS.md`: owner runbook (dashboard only): deploy three functions, JWT switch (create-session and sync ON, webhook OFF), three secrets, Didit webhook destination and its secret, one optional 401 check, real test only after V3b, undo, going-live note, list of unconfirmed points.
- **Import question settled by construction:** the dashboard editor's handling of `../_shared` and cross-function imports could not be confirmed (Supabase's dashboard quickstart does not cover it). `supabase/deploy/<function>/index.ts` are single-file bundles (no relative imports) built by `supabase/deploy/build-bundles.mjs` from the tested sources. The AI runs the script; the owner only pastes.
- No function code changed; no SQL changed.

## Exit check
- The same test files were run against the bundles (import path swapped): webhook **29/29**, create-session **22/22**, sync **26/26** (V2a signature tests 12/12 run on the original module, which the webhook bundle contains unchanged). Bundles contain no `import` lines.
- **Nothing was deployed. Nothing was run on Deno, Supabase or Didit.** The runbook has never been followed.

## Open issues
- Labels in the runbook for Supabase and Didit screens (Via Editor, Verify JWT switch, Secrets, API & Webhooks) are unchecked against the live UIs.
- The dashboard has no rollback; if a bundle is edited later, rebuild with `build-bundles.mjs` and re-paste.
- Customers cannot verify until V6 (see V1g warning).

## Next
Default: V3a (verify page markup and messages). Needs D-V8 (biometric wording) from the owner, otherwise the AI uses neutral wording and flags it. Also unblocked: V1g (customer warning), V1d (owner OK). Owner may deploy per the runbook now or wait until V3b.

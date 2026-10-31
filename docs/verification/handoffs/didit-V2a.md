# Didit stage V2a: webhook signature module

## Done
Pure signature check for Didit's `X-Signature-V2`, per `DIDIT-API-FACTS.md` (Webhook). No Didit account, key, Supabase or network was used.

## Files created
- `supabase/functions/_shared/didit-signature.ts`: `verifyDiditSignature({rawBody, signatureHeader, timestampHeader, secret, nowSeconds?})` returns `{ok:true, payload}` or `{ok:false, reason}`. Also exports `canonicalJson`, `shortenFloats`, `sortKeys`, `hmacSha256Hex`, `timingSafeEqualStr`. Web APIs only, no imports.
- `supabase/functions/_shared/didit-signature.test.ts`: 12 tests, made-up secrets, expected signatures computed independently with `node:crypto` from hand-written canonical strings.

## Exit check
- Run: `node --experimental-strip-types --test didit-signature.test.ts` on Node 22: **12 passed, 0 failed**.
- Covered: valid; wrong secret; tampered body; garbage/truncated signature; timestamp at 300 s accepted, 301 s old or ahead rejected; missing or malformed headers and secret; invalid or non-object JSON; whole-number floats (`5.0`, `1e3`); nested key sort with array order kept; Unicode unescaped (also when the body arrives `\u`-escaped); whitespace and key order in the raw body.
- **Not run on Deno** (Deno could not be installed in the build sandbox). The test file uses `node:test`, which Deno also runs (`deno test --allow-read`), but this has not been confirmed. The module uses only standard Web APIs.

## Open issues / UNVERIFIED
- The canonicalisation follows Didit's published description. It has never been checked against a REAL Didit webhook. First real sandbox event (stage V2e/V5) is the true test. If it returns bad_signature, compare against Didit's own reference code before anything else.
- Numbers: a payload float such as `0.1+0.2` style values rely on JS number printing matching Didit's serializer. Same caveat as above.

## Next
- V2b (webhook) needs V1b-2 applied, which needs V0.1 (introspect blocks 1 to 6) and V0.2 (D-V answers). V2c needs V1c.
- Nothing else is unblocked without the owner: see "Needs from owner".

## Needs from owner
1. V0.1: run introspect blocks 1 to 6 and send each CSV (the CSV sent today was block 7 again, identical to the one already in the package).
2. V0.2: D-V1..D-V8, or "take the default".
3. V0.3: create the Didit SANDBOX application (no secrets in chat).

# Didit facts used by this integration

Read on 2026-10-30 from https://docs.didit.me/integration/integration-prompt (fetched in full) and Didit's Nigeria database-validation pages (search snippets only). Anything marked UNVERIFIED must be confirmed in the Didit console, sandbox or support before it is relied on. Nothing here was run against Didit: no account, key or sandbox was available.

## Credentials (exact names from the Didit prompt)
- `DIDIT_API_KEY` sent as header `x-api-key` (server only).
- `DIDIT_WORKFLOW_ID` (the workflow uuid; passed as `workflow_id` when creating a session).
- `DIDIT_WEBHOOK_SECRET` (the `secret_shared_key` returned when the webhook destination is created; shown once, store immediately).
- No `DIDIT_API_SECRET` exists in this flow. Do not invent one.
- Sandbox and live are separate identities and apps: expect separate key + workflow + secret per environment.

## Base URLs
Verification API `https://verification.didit.me` (all `/v3/...`); hosted flow `https://verify.didit.me`; console `https://business.didit.me`; OpenAPI `https://docs.didit.me/openapi-25.json`.

## Create session (Approach A, hosted flow)
`POST https://verification.didit.me/v3/session/` headers `x-api-key`, `Content-Type: application/json`.
Body: `workflow_id`, `vendor_data` (OUR stable user id, derived on the server, never from the browser), `callback` (redirect URL), optional `metadata` (echoed on every webhook), `language`, `contact_details {email, send_notification_emails, email_lang, phone(E.164)}`, `expected_details {first_name,last_name,date_of_birth,gender,nationality,country,id_country,identification_number,expected_document_types[P,ID,DL,RP,HIC,TC,SSC],...}`, `sandbox_scenario` (sandbox apps only, 400 on live).
201 response keys: `session_id, session_number, session_token, url, vendor_data, metadata, status, workflow_id, workflow_version, callback`.
- `session_token` is a secret (anyone holding it can open the flow). Do not log it.
- Reuse is idempotent: an unfinished session (Not Started / In Progress / Resubmitted / Awaiting User) with the same `vendor_data` on the latest published workflow version is returned again (still 201). Finished sessions are never reused.
- After the user finishes, Didit redirects to `callback?verificationSessionId=...&status=...`. A redirect is NOT proof. Never act on it.
- Auth failure on this endpoint is HTTP 403 (not 401). `/v3/users/`, `/v3/businesses/`, `/v3/transactions/`, `/v3/billing/`, `/v3/webhook/destinations/` return 401 for a bad key.

## Workflow (one-time, console or API)
`POST /v3/workflows/` with `workflow_label` and `features[]` of `{feature, config?}`. Feature enum: OCR, NFC, LIVENESS (`face_liveness_method`: PASSIVE | ACTIVE_3D | FLASHING), FACE_MATCH, AGE_ESTIMATION, PHONE_VERIFICATION, EMAIL_VERIFICATION, DATABASE_VALIDATION, AML, IP_ANALYSIS, PROOF_OF_ADDRESS, QUESTIONNAIRE. Unknown body fields return 400. List price of the core bundle (ID + Liveness + Face Match + IP) is $0.33 per session (Didit's own list; check the account's real pricing).

## Presenting the flow
Web: `@didit-protocol/sdk-web` (`DiditSdk.shared.startVerification({ url })`), or iframe (needs `allow="camera; microphone; geolocation; ..."`), or plain redirect `window.location.href = url`. The site has NO build step, so the redirect (or an iframe) is the natural fit; the npm SDK would need a vendored file in `js/vendor/`. NFC is native-SDK only (not available for this web site).

## Webhook
Register once: `POST /v3/webhook/destinations/` `{label, url, webhook_version:"v3", subscribed_events:["status.updated","data.updated"]}`. HTTPS, public host. Didit egress IP `18.203.201.92`, User-Agent `DiditWebhook/2.0`.
Verify ONE signature. Recommended `X-Signature-V2`:
1. Parse JSON body. Read `X-Signature-V2` (hex HMAC-SHA256) and `X-Timestamp` (unix seconds).
2. Reject if `abs(now - X-Timestamp) > 300`.
3. `shortenFloats` (whole-number floats become integers), then `sortKeys` (recursive lexicographic, arrays keep order), then `JSON.stringify` with unescaped Unicode.
4. `HMAC-SHA256(DIDIT_WEBHOOK_SECRET, canonical_json)` hex, compare to the header in constant time.
`X-Signature-Simple` is deprecated and does not authenticate the decision: if ever used, re-fetch the decision.
Return 2xx within 5 seconds. Retries: 5xx, 404, timeouts, connection failures, twice (about 1 min and 4 min). 3xx and other 4xx are NEVER retried (so a bad-signature 401 is final; do not return 4xx for a valid event we failed to store: return 500).
Event types (complete set of nine): status.updated, data.updated, user.status.updated, user.data.updated, business.status.updated, business.data.updated, activity.created (not delivered live), transaction.created, transaction.status.updated. We need only `status.updated` (+ `data.updated`).
Envelope: `event_id` (STABLE across retries: the idempotency key), `webhook_type`, `timestamp` (refreshed each retry: never use as a key), `created_at`, `application_id`, `environment` ("live"|"sandbox": CHECK IT), `session_id`, `status`, `workflow_id`, `workflow_version`, `vendor_data`, `metadata`, `decision` (present on Approved | Declined | In Review | Abandoned), `resubmit_info` on Resubmitted.
Fallback idempotency key if `event_id` is missing: `session_id + status + webhook_type`.

## Session status strings (case-sensitive, exact)
`Not Started`, `In Progress`, `Awaiting User`, `In Review`, `Approved`, `Declined`, `Resubmitted`, `Abandoned`, `Expired`, `Kyc Expired`.

## Decision (V3, plural arrays, always index by node_id)
`GET /v3/session/{session_id}/decision/` returns the same decision with fresh media links. Arrays: `id_verifications[]`, `liveness_checks[]` (status, score 0-100, method), `face_matches[]` (status, score 0-100), `ip_analyses[]`, `database_validations[]` (status, issuing_state, match_type full_match|partial_match|no_match), `aml_screenings[]`, `reviews[]` (manual-review audit trail), ... Every item has its own `status` (Not Finished, Approved, Declined, In Review, Resub Requested). All media (`*_image`, `video_url`) are short-lived presigned URLs: never persist them.

## Other operational endpoints
`GET /v3/sessions/` (list, filter by status/vendor_data), `PATCH /v3/session/{id}/update-status/` (manual approve/decline: NEVER call from anything a coordinator can reach), `DELETE /v3/session/{id}/delete/` (erasure; `{"deletion_instruction":"privacy_erasure"}`), `GET /v3/billing/balance/`.

## NIN: separate from document scan (the owner's explicit question)
- Document OCR (`OCR`, `id_verifications[]`) reads the card/slip. It does NOT query NIMC.
- NIMC validation is a SEPARATE service: workflow module `DATABASE_VALIDATION` with Nigeria > "Nigeria National ID Verification (NIMC)"; standalone `POST /v3/database-validation/` with `issuing_state=NGA`, `services=nga_national_id`, `first_name`, `last_name`, `national_id`, optional `date_of_birth`. Billed only on a conclusive result; Didit's page lists $0.08 per call. BVN is a separate Nigeria service (listed $0.80 per call). Per Didit's pages, accounts include 500 free validations a month (UNVERIFIED for this account).
- Result is `database_validations[]` with `match_type` full_match | partial_match | no_match.
- UNVERIFIED: whether the hosted flow collects the NIN from the user or needs `expected_details.identification_number` supplied by us; whether the NIN slip / NIN card is an accepted OCR document type (the documented `expected_document_types` codes are P, ID, DL, RP, HIC, TC, SSC: none says "NIN slip"); whether voter's card is accepted. Test each in the SANDBOX and ask Didit support in writing before the page promises them.
- StreetTasker must say "NIN checked against NIMC" ONLY when `database_validations[]` holds an Approved Nigeria entry with `full_match`. The reference mockups show "NIMC Matched" in the browser: that claim must come from the server result, never from a format check.

## Not supported / not applicable here
Didit Authentication is separate and unpublished: we keep Supabase Auth. Transaction monitoring: not selected.

## Sandbox and console (added 2026-10-30 from help.didit.me; read via search, never run)
Sources: help.didit.me/getting-started/sandbox-and-testing, /account-organization/api-keys, /getting-started/understanding-the-console.
- CORRECTION to the V0 handoff: sandbox is NOT a separate application the owner creates. It is the organization's shared test environment. In the console, click **Sandbox** on the pill under the application name at the top of the sidebar. If Sandbox is greyed out, Didit support must enable it for the organization.
- Sandbox API key: **API & Webhooks** (sidebar) > **Create API key**, pick Sandbox as the environment. The key decides the environment. Secret is shown once. Sandbox has its OWN workflows (build one or copy from Live).
- Console sidebar: Workflows, Verifications, Businesses / KYB, Transactions, API & Webhooks, Analytics, Settings. Webhook destinations and their signing secrets (one per destination, not the API key) are under API & Webhooks. Data retention is under **Settings**.
- Where the workflow ID is shown: not stated on those pages; check the Workflows section.
- Sandbox is never billed, 500 sessions per 24 h, providers are mocked (extracted data is sample data), webhooks carry `"environment": "sandbox"`. Outcomes come from the scenario, not image quality.
- `sandbox_scenario` slugs listed by Didit: `approve`; `decline_document_expired`, `decline_could_not_recognize_document`, `decline_mrz_validation`, `decline_minimum_age`, `decline_face_match_low_similarity`, `decline_liveness_attack`, `decline_aml_hit`, `decline_ip_blocklist`, `decline_poa_address_mismatch`, `decline_nfc_chip_not_verified`, `decline_database_no_match`, `decline_kyb_registry_mismatch`; `review_aml_possible_match`, `review_face_match_borderline`, `review_poa_partial_match`. Authoritative list: `GET /v1/sandbox/scenarios/` (do not rely on this copy).
- Because sandbox is mocked, it can NOT prove NIMC matching or Nigerian document types. Those need a small live top-up test after contacting Didit support first.

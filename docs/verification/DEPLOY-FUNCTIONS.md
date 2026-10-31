# Deploying the three Didit functions (owner runbook, dashboard only)

Nothing here needs a terminal, curl or the console. You do it in the Supabase dashboard and the Didit dashboard. Everything goes to your one (production) Supabase project, with Didit in SANDBOX mode.

## Read this first
- **Are you deploying the edge functions you were given? Yes, these three, but not yet from the folders in the zip.** Do NOT paste files from `supabase/functions/`. Paste the one-file versions in `supabase/deploy/` (they contain the same tested code joined into a single file, because the dashboard editor may not accept imports from other folders).
- **Nothing calls these functions until stage V3 (the verify page) exists.** You can deploy now, but a real test is only possible after V3b. If you prefer, do steps 1 to 4 now and wait for V3b to test.
- **Sandbox on your production project is real for the user it is run for:** a Didit sandbox "Approved" sets the real verified flags on that user. Test ONLY with `naomibabadiya@gmail.com` and `msgracekathy@gmail.com`.
- Never paste the Didit key, workflow id or webhook secret into chat or into any file. They go only into Supabase Secrets.
- The Supabase dashboard editor has no version history or rollback (Supabase's own docs say so): the zip is your backup.

## What you need before you start
1. A Didit **sandbox API key** (Didit console: switch to Sandbox, then API & Webhooks, Create API key, environment Sandbox; shown once).
2. The Didit **workflow ID** of a sandbox workflow (console, Workflows; build one in Sandbox or copy one from Live).
3. The three files: `supabase/deploy/didit-webhook/index.ts`, `didit-create-session/index.ts`, `didit-sync/index.ts`.

## Step 1: Deploy the three functions
In Supabase: **Edge Functions** > **Deploy a new function** > **Via Editor**. Do this three times:

| Function name (type EXACTLY) | Paste the whole file | 
|---|---|
| `didit-webhook` | `supabase/deploy/didit-webhook/index.ts` |
| `didit-create-session` | `supabase/deploy/didit-create-session/index.ts` |
| `didit-sync` | `supabase/deploy/didit-sync/index.ts` |

Select everything in the editor, delete it, paste the file, click **Deploy**. If the editor offers a default `index.ts` plus other files, keep only `index.ts`.

## Step 2: Set the JWT switch on each function
Open each function, then its settings / details page and find the switch called **Verify JWT** (it may read "Enforce JWT verification"). Set:
- `didit-create-session`: **ON**
- `didit-sync`: **ON**
- `didit-webhook`: **OFF** (Didit has no Supabase login; the webhook proves itself with a signature instead)

Save. If the switch is hidden after deploy, redeploy and look for it on the deploy screen.

## Step 3: Add the secrets
Supabase: **Edge Functions** > **Secrets** (Manage secrets). Add exactly these names:

| Name | Value |
|---|---|
| `DIDIT_API_KEY` | the sandbox API key |
| `DIDIT_WORKFLOW_ID` | the sandbox workflow id |
| `DIDIT_ENV` | `sandbox` (all lower case) |

Optional: `SITE_URL` (only if your site is not `https://streettasker.com`). Do not add anything starting `SUPABASE_`: Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to every function by itself.

## Step 4: Register the webhook in Didit, then add its secret
1. In the Didit console (Sandbox selected): **API & Webhooks**, add a **webhook destination**.
2. URL: `https://<your-project-ref>.supabase.co/functions/v1/didit-webhook` (your project ref is in the Supabase project URL).
3. Version **v3**; events **status.updated** and **data.updated**.
4. Didit shows a **secret** once. Copy it straight into Supabase Secrets as `DIDIT_WEBHOOK_SECRET`. If you lose it, create a new destination.

Until `DIDIT_WEBHOOK_SECRET` exists the webhook answers "not configured" (HTTP 500) and Didit will retry; that is expected between steps 1 and 4.

## Step 5: One quick check (optional, about a minute)
In the dashboard open `didit-webhook` and use its built-in test tool to send an empty POST. **Expected: HTTP 401.** 401 means the function is live, the secrets are in, and it correctly refuses unsigned requests. 500 means a secret from step 3 or 4 is missing (check the function Logs). Do the same for `didit-sync` and `didit-create-session` only if you like: without a valid login they should answer 401 (Supabase itself will refuse before the code runs when Verify JWT is ON).

## Step 6: The real test (after V3b exists, not before)
1. Sign in as one of the two test accounts. Give consent on the verify page. Start verification.
2. Complete the Didit sandbox flow. (To force an outcome, use a `sandbox_scenario`; the AI will tell you how when V3b exists.)
3. Come back to the page: it should show the status. If the webhook was slow, "check again" calls `didit-sync`.
4. Report back what the page showed and, if anything failed, the function **Logs** lines (they contain no secrets).

## If something goes wrong
- Stop everything fast: in the Didit console delete the webhook destination, and in Supabase delete the three functions (or change `DIDIT_API_KEY` to an empty/invalid value). No data is lost; the SQL stays.
- Users cannot be harmed by the functions being off: nobody is blocked until stage V1g, which is not built yet.
- Do NOT run any SQL rollback file unless the AI tells you to.

## Going live later (not now)
Live needs a separate Live API key, workflow, webhook destination and secret, and `DIDIT_ENV=live`, and your written approval. That is stage V5c. Do not change `DIDIT_ENV` to `live` before then.

## What is still unconfirmed (so you know what a failure might be)
- Whether the dashboard editor accepts the pasted one-file bundles and where exactly the Verify JWT switch is (the labels above are from memory of Supabase's UI, not checked).
- Whether Didit's decision reply carries the session `status` (needed by `didit-sync`; `didit-webhook` and `didit-create-session` do not need it). The first sandbox run will show.
- Nothing here has ever run against Didit or Supabase. Treat the first run as the real test.

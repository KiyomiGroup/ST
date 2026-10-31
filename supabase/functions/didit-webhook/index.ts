// Edge Function: didit-webhook (stage V2b). Deploy with "Verify JWT" OFF (Didit sends no Supabase token;
// the X-Signature-V2 check is the authentication).
// Secrets: DIDIT_WEBHOOK_SECRET, DIDIT_API_KEY, DIDIT_ENV ("sandbox" or "live"). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime. See handler.ts for the rules.
import { handleWebhook } from "./handler.ts";

Deno.serve((req: Request) =>
  handleWebhook(req, { env: (n: string) => Deno.env.get(n), fetch })
);

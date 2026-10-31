// Edge Function: didit-sync (stage V2d). Deploy with "Verify JWT" ON.
// Secrets: DIDIT_API_KEY, DIDIT_ENV ("sandbox" or "live"). Optional: ALLOWED_ORIGINS.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime.
// See handler.ts for the rules.
import { handleSync } from "./handler.ts";

Deno.serve((req: Request) =>
  handleSync(req, { env: (n: string) => Deno.env.get(n), fetch })
);

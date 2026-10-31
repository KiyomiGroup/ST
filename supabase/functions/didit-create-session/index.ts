// Edge Function: didit-create-session (stage V2c). Deploy with "Verify JWT" ON.
// Secrets: DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_ENV ("sandbox" or "live"). Optional: SITE_URL (default
// https://streettasker.com), ALLOWED_ORIGINS, DIDIT_WORKFLOW_ID_CUSTOMER (stage V6). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime. See handler.ts for the rules.
import { handleCreateSession } from "./handler.ts";

Deno.serve((req: Request) =>
  handleCreateSession(req, { env: (n: string) => Deno.env.get(n), fetch })
);

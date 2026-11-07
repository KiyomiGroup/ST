// DEPLOY copy for the Supabase dashboard (paste this whole file). Source: supabase/functions/coordinator-guide/index.ts
// Edge Function: coordinator-guide  (Stage C)
// Hands out the Local Tasker and Coordinator Guide (PDF) ONLY to someone holding a valid coordinator test link.
// The PDF is not on the website. It lives in public.coordinator_guide_files (no access for anon or signed-in users) and is read
// through public.coordinator_guide_for_token(p_token), which only this function (service role) may call and which checks the link.
// The page sends the token in the POST body (not in the URL), so it does not appear in logs or browser history.
// Deploy with "Verify JWT" left ON: the page sends the project anon key like coordinator-apply does.
//
// Secrets: none to set. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are supplied by Supabase to every Edge Function.
//   ALLOWED_ORIGINS (optional, comma separated extra origins for testing)
const DEFAULT_ORIGINS = ["https://streettasker.com", "https://www.streettasker.com"];
const TOKEN_RE = /^[0-9a-f]{64}$/;

function allowedOrigin(req: Request): string {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = [...DEFAULT_ORIGINS, ...extra];
  const origin = req.headers.get("origin") ?? "";
  return list.includes(origin) ? origin : DEFAULT_ORIGINS[0];
}
function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Disposition",
    "Vary": "Origin",
  };
}
function fail(req: Request, status: number, error: string) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed");

  let token = "";
  try {
    const raw = await req.text();
    if (raw.length > 2000) return fail(req, 400, "bad_request");
    const body = JSON.parse(raw);
    token = typeof body?.token === "string" ? body.token.trim().toLowerCase() : "";
  } catch { return fail(req, 400, "bad_request"); }
  // A token that is not 64 hex characters can never be valid: answer without touching the database.
  if (!TOKEN_RE.test(token)) return fail(req, 404, "invalid_token");

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !serviceKey) return fail(req, 500, "server_misconfigured");

  let out: { ok?: boolean; error?: string; b64?: string; content_type?: string; filename?: string } | null = null;
  try {
    const r = await fetch(`${supaUrl}/rest/v1/rpc/coordinator_guide_for_token`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) { console.error("guide lookup failed", r.status, (await r.text()).slice(0, 200)); return fail(req, 502, "server_error"); }
    out = await r.json();
  } catch (e) { console.error("guide lookup error", String(e).slice(0, 200)); return fail(req, 502, "server_error"); }

  if (!out || out.ok !== true) {
    if (out?.error === "guide_not_ready") return fail(req, 503, "guide_not_ready");
    return fail(req, 404, "invalid_token"); // wrong, expired or not approved: one answer for all, never why
  }

  let bytes: Uint8Array;
  try {
    const bin = atob(String(out.b64 ?? ""));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { console.error("guide is not valid base64"); return fail(req, 500, "guide_corrupt"); }
  // A PDF starts with "%PDF". Refuse to send anything else.
  if (bytes.length < 1000 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    console.error("guide does not look like a PDF"); return fail(req, 500, "guide_corrupt");
  }
  const filename = /^[A-Za-z0-9._-]{1,100}$/.test(String(out.filename ?? "")) ? String(out.filename) : "coordinator-guide.pdf";
  return new Response(bytes, {
    status: 200,
    headers: {
      ...cors(req),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

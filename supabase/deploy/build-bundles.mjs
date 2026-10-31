// Builds ONE self-contained index.ts per Edge Function (no relative imports) so it can be pasted into the
// Supabase dashboard editor. Run by the AI, not the owner: node deploy/build-bundles.mjs  (from supabase/).
// The sources in functions/ stay the tested originals; this only joins them and drops the import lines.
import fs from "node:fs";
const F = "functions/";
const read = (p) => fs.readFileSync(F + p, "utf8");
const strip = (s) => s.replace(/^import\s[^;]*;\s*$/gm, "");
const plans = {
  "didit-webhook": ["_shared/didit-signature.ts", "didit-webhook/decision.ts", "didit-webhook/handler.ts"],
  "didit-create-session": ["didit-create-session/handler.ts"],
  "didit-sync": ["didit-webhook/decision.ts", "didit-sync/handler.ts"],
};
const wire = {
  "didit-webhook": `Deno.serve((req: Request) =>\n  handleWebhook(req, { env: (n: string) => Deno.env.get(n), fetch })\n);\n`,
  "didit-create-session": `Deno.serve((req: Request) =>\n  handleCreateSession(req, { env: (n: string) => Deno.env.get(n), fetch })\n);\n`,
  "didit-sync": `Deno.serve((req: Request) =>\n  handleSync(req, { env: (n: string) => Deno.env.get(n), fetch })\n);\n`,
};
for (const [name, parts] of Object.entries(plans)) {
  const body = parts.map((p) => `// ===== ${p} =====\n` + strip(read(p))).join("\n");
  fs.mkdirSync(`deploy/${name}`, { recursive: true });
  fs.writeFileSync(`deploy/${name}/index.ts`, `// DEPLOY BUNDLE for ${name}: generated, do not edit. Source files are in supabase/functions/.\n` + body + "\n// ===== entry =====\n" + wire[name]);
  fs.writeFileSync(`deploy/${name}/_bundle-for-tests.ts`, body); // same code without Deno.serve, used to re-run the tests
}

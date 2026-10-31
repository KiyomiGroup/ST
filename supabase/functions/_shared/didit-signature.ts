// Didit webhook signature check (X-Signature-V2). Stage V2a.
// Source of the algorithm: docs/verification/DIDIT-API-FACTS.md, "Webhook".
//
// Uses only Web APIs (crypto.subtle, TextEncoder) so it runs in Supabase Edge
// Functions (Deno) and in Node 20+. No imports, no secrets in this file.
//
// Steps (one signature only, V2):
//  1. parse the JSON body
//  2. reject if |now - X-Timestamp| > 300 seconds
//  3. shortenFloats (whole-number floats become integers), sortKeys (recursive,
//     arrays keep order), JSON.stringify with Unicode left unescaped
//  4. HMAC-SHA256(secret, canonical_json) as hex, compared in constant time
//
// NOTE: JSON.parse already turns 5.0 into 5, so shortenFloats is satisfied by
// parsing. It is still written out below so the behaviour is explicit and
// tested (and covers floats like 1e3 that parse to whole numbers).

export const MAX_SKEW_SECONDS = 300;

export type SignatureFailure =
  | "missing_secret"
  | "missing_signature"
  | "missing_timestamp"
  | "bad_timestamp"
  | "stale_timestamp"
  | "invalid_json"
  | "bad_signature";

export type SignatureResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: SignatureFailure };

/** Whole-number floats become integers; recurses through objects and arrays. */
export function shortenFloats(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) ? Math.trunc(value) : value;
  }
  if (Array.isArray(value)) return value.map(shortenFloats);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shortenFloats(v);
    }
    return out;
  }
  return value;
}

/** Recursive lexicographic key sort; arrays keep their order. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

/** The exact string that is signed. JSON.stringify leaves Unicode unescaped. */
export function canonicalJson(payload: unknown): string {
  return JSON.stringify(sortKeys(shortenFloats(payload)));
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time string compare (length is not secret: both are 64 hex chars). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export interface VerifyInput {
  /** The raw request body text, exactly as received. */
  rawBody: string;
  /** Value of the X-Signature-V2 header (hex), or null if absent. */
  signatureHeader: string | null;
  /** Value of the X-Timestamp header (unix seconds), or null if absent. */
  timestampHeader: string | null;
  /** DIDIT_WEBHOOK_SECRET for the matching environment. */
  secret: string | undefined | null;
  /** Injected clock for tests; defaults to the real time. */
  nowSeconds?: number;
}

/**
 * Verifies a Didit webhook. Returns the parsed payload only when the signature
 * is valid and the timestamp is fresh. The caller maps any failure to HTTP 401
 * and must not reveal which check failed to the sender.
 */
export async function verifyDiditSignature(input: VerifyInput): Promise<SignatureResult> {
  if (!input.secret) return { ok: false, reason: "missing_secret" };

  const sig = (input.signatureHeader ?? "").trim().toLowerCase();
  if (!sig) return { ok: false, reason: "missing_signature" };

  const tsRaw = (input.timestampHeader ?? "").trim();
  if (!tsRaw) return { ok: false, reason: "missing_timestamp" };
  if (!/^\d+$/.test(tsRaw)) return { ok: false, reason: "bad_timestamp" };
  const ts = Number(tsRaw);

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale_timestamp" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid_json" };
  }

  const expected = await hmacSha256Hex(input.secret, canonicalJson(parsed));
  if (!timingSafeEqualStr(expected, sig)) return { ok: false, reason: "bad_signature" };

  return { ok: true, payload: parsed as Record<string, unknown> };
}

// Reads a Didit decision (GET /v3/session/{id}/decision/) and reduces it to the booleans
// idv_apply_event needs. Pure: no network, no logging. Returns NO scores, media or personal data.
// Field names follow DIDIT-API-FACTS.md. Anything missing counts as "not shown to be OK" (false / null),
// so a surprise in Didit's reply can only push a person to review, never to VERIFIED.

export interface DecisionFlags {
  liveness_ok: boolean;
  face_match_ok: boolean;
  document_ok: boolean;
  nin_database_match: "full_match" | "partial_match" | "no_match" | "not_run";
  nigerian_doc: boolean;
}

type Item = Record<string, unknown>;

function items(decision: Item, key: string): Item[] {
  const v = decision[key];
  return Array.isArray(v) ? v.filter((x): x is Item => typeof x === "object" && x !== null) : [];
}

// At least one item, and every item Approved.
function allApproved(list: Item[]): boolean {
  return list.length > 0 && list.every((i) => i.status === "Approved");
}

const isNga = (v: unknown) => typeof v === "string" && v.toUpperCase() === "NGA";

export function extractDecisionFlags(raw: unknown): DecisionFlags {
  // Didit may return the decision at the top level or under "decision".
  const root = (typeof raw === "object" && raw !== null ? raw : {}) as Item;
  const decision = (typeof root.decision === "object" && root.decision !== null ? root.decision : root) as Item;

  const docs = items(decision, "id_verifications");
  const nigerian = docs.some((d) => isNga(d.issuing_state) || isNga(d.issuing_country));

  const ngaChecks = items(decision, "database_validations").filter((d) => isNga(d.issuing_state));
  let nin: DecisionFlags["nin_database_match"] = "not_run";
  if (ngaChecks.length > 0) {
    // The worst result wins: a single no_match or partial_match is never overridden by a full_match.
    const m = ngaChecks.map((d) => (d.status === "Approved" ? d.match_type : d.match_type === "no_match" ? "no_match" : "partial_match"));
    nin = m.includes("no_match") ? "no_match"
      : m.every((x) => x === "full_match") ? "full_match"
      : "partial_match";
  }

  return {
    liveness_ok: allApproved(items(decision, "liveness_checks")),
    face_match_ok: allApproved(items(decision, "face_matches")),
    document_ok: allApproved(docs),
    nin_database_match: nin,
    nigerian_doc: nigerian,
  };
}

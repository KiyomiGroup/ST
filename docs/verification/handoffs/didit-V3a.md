# Didit stage V3a: verify page markup and messages

## Done
New markup and styles for the verify page. **No behaviour** (that is V3b). Files are in `pending-ui/` (paths match the repo root) and must be copied into the repo only together with V3b.
- `pending-ui/verify.html`: header; loading state; error and notice areas (`#verifyError`, `#verifyNotice`); `#verifyMain[data-mode="self|proxy"]` with one panel per status (`[data-status-panel=...]`); start area (why, what you need, data and consent block with checkbox, Start button); coordinator proxy panel (consent method, optional reference, certification checkbox, Start button).
- `pending-ui/css/verify.css`: layout and the few status states, tokens only (no hex, no rgb, no inline style, no `!important`).
- The six brief messages (phase 7) appear **verbatim** in NOT_STARTED, IN_PROGRESS, PENDING, VERIFIED, REVIEW_REQUIRED, FAILED. The page asks for NO ID number, name, date of birth, phone or business name: Didit collects what it needs. The old form, the ID-format hint and every browser-side approval path are gone from the markup.
- Every claim from finding F5 stays out (no NIMC, bank-grade, NDPR, guarantee, turnaround time, booking uplift). Wording is neutral and factual.

## Hooks V3b / V3c rely on (do not rename)
`#verifyLoading`, `#verifyError`, `#verifyNotice`, `#verifyMain` (`data-mode`), `[data-status-panel]` (NOT_STARTED, IN_PROGRESS, PENDING, VERIFIED, REVIEW_REQUIRED, FAILED, RESUBMIT_REQUESTED, EXPIRED), `#verifyStart`, `#consentBlock` (`data-consent-version="v1"`, must match `idv_consent_version()`), `#consentCheck`, `#consentDone`, `#verifyStartBtn`, `#verifyContinueBtn`, `[data-action="resume|refresh|retry|start|proxy-start"]`, `#proxyPanel`, `#proxyName`, `#proxyMethod` (in_person|phone|written), `#proxyEvidence`, `#proxyConsentCheck`, `#proxyStartBtn`. Mapping for V3b: ABANDONED shows the FAILED panel; V3b writes text with `textContent` only.

## Exit check
- Structural check run on the files: 0 inline styles, 0 event-handler attributes, 0 raw colours, 0 `!important`, no duplicate ids, every label has a target, all six messages found verbatim, no F5 claim.
- **NOT run: `node tools/check-design-system.js`** (the tool, `css/tokens.css` and `css/styles.css` are not in this package). **NOT rendered** at desktop or mobile width (no stylesheet to render against). Both must be done in the real repo before this ships. Token names used come from `DESIGN-SYSTEM.md`: `--tone-*` (section 4.11), `--space-*`, `--text-*`, `--radius-md`, `--color-*`, `--nav-height`; classes `.btn(-primary/-outline/-ghost/-full)`, `.badge(-green/-amber/-gray)`, `.card`, `.form-*`, `.icon-box`, `.skel`.

## Open issues (owner)
1. **Wording needs approval (D-V8).** The data and consent text is neutral, not legal text. Also two states the brief does not cover use MY wording: RESUBMIT_REQUESTED ("Action required: please redo the steps you are asked to repeat.") and EXPIRED ("Your verification has expired. Please verify again."). Change or approve.
2. The support link is `contact.html` and the privacy link is `privacy.html`; neither path could be checked (the footer is not in this package). Tell me the right path if different.
3. The customer ("easier flow + proof of address") variant is V6; customers cannot start until then.
4. The current production `verify.html` still collects ID numbers into `verifications` until V3b replaces it (findings F1 and F2 stay open until then; V1d/V1f close them).

## Next
Default: **V3b (self-mode behaviour)**: rewrite `js/verify.js` (read status, consent, start, redirect, resume, check again; remove the browser-side approval). It needs the three functions DEPLOYED to test; it can be written without that. V3b is the point where deploying (`DEPLOY-FUNCTIONS.md`) becomes necessary.

# pending-ui: files that must NOT be copied into the repo one by one

These paths match the repo root. They are the new verify page: stages V3a (markup, CSS), V3b (self mode) and V3c (proxy mode).

| Package path | Repo path |
|---|---|
| `pending-ui/verify.html` | `verify.html` (replaces the old page) |
| `pending-ui/css/verify.css` | `css/verify.css` (new) |
| `pending-ui/js/verify.js` | `js/verify.js` (replaces the old file) |
| `pending-ui/coordinator-tasker.html` | `coordinator-tasker.html` (replaces; one button added, stage V3c) |
| `pending-ui/js/coordinator-tasker.js` | `js/coordinator-tasker.js` (replaces; three lines added, stage V3c) |
| `pending-ui/verification-done.html` | `verification-done.html` (new public page, stage V3c-2) |
| `pending-ui/data-consent.html` | `data-consent.html` (new public page: the Data Consent Notice) |
| `pending-ui/dashboard-tasker.html` | `dashboard-tasker.html` (replaces; old verification panel removed) |
| `pending-ui/components/navbar.html` | `components/navbar.html` (replaces; Verification links go to verify.html) |
| `pending-ui/post-service.html` | `post-service.html` (replaces; live or draft now comes from the server verified read, stage V3d) |

Copy ALL TEN in the same commit, and only after the three Didit functions are deployed (`docs/verification/DEPLOY-FUNCTIONS.md`). The first three alone break verification; the coordinator pair only adds the entry button. Test with the two test accounts only. `tests/*.mjs` test `pending-ui/js/verify.js` (do not copy it into the repo).

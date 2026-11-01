# pending-ui: files that must NOT be copied into the repo one by one

These paths match the repo root. They are the new verify page: stages V3a (markup, CSS), V3b (self mode) and V3c (proxy mode).

| Package path | Repo path |
|---|---|
| `pending-ui/verify.html` | `verify.html` (replaces the old page) |
| `pending-ui/css/verify.css` | `css/verify.css` (new) |
| `pending-ui/js/verify.js` | `js/verify.js` (replaces the old file) |
| `pending-ui/coordinator-tasker.html` | `coordinator-tasker.html` (replaces; one button added, stage V3c; Verification card shows the server's identity check, stage V4b) |
| `pending-ui/js/coordinator-tasker.js` | `js/coordinator-tasker.js` (replaces; three lines added, stage V3c) |
| `pending-ui/verification-done.html` | `verification-done.html` (new public page, stage V3c-2) |
| `pending-ui/data-consent.html` | `data-consent.html` (new public page: the Data Consent Notice) |
| `pending-ui/dashboard-tasker.html` | `dashboard-tasker.html` (replaces; old verification panel removed; profile save no longer sets the listing live by itself, stage V1h) |
| `pending-ui/components/navbar.html` | `components/navbar.html` (replaces; Verification links go to verify.html) |
| `pending-ui/post-service.html` | `post-service.html` (replaces; live or draft now comes from the server verified read, stage V3d; registers the saved service and listing for auto-publish, stage V6e) |
| `pending-ui/js/app.js` | `js/app.js` (replaces; adds the loader for the gate, stage V1g-3) |
| `pending-ui/js/verify-gate.js` | `js/verify-gate.js` (new, stage V1g-3) |
| `pending-ui/js/db.js` | `js/db.js` (replaces; `postTask` saves a draft unless the server says the user may publish, stage V6b; registers the draft so it goes live after verification, stage V6c) |
| `pending-ui/js/tasks.js` | `js/tasks.js` (replaces; success modal uses the server decision, stage V6b) |
| `pending-ui/coordinator-taskers.html` | `coordinator-taskers.html` (replaces; identity-check filter, stage V4a) |
| `pending-ui/js/coordinator-taskers.js` | `js/coordinator-taskers.js` (replaces; shows each Local Tasker's identity-check status, stage V4a) |
| `pending-ui/js/coordinator-verify-status.js` | `js/coordinator-verify-status.js` (new, stage V4a; reused by V4b) |
| `pending-ui/css/coordinator-verify.css` | `css/coordinator-verify.css` (new, stage V4a) |

Copy ALL EIGHTEEN in the same commit, and only after the three Didit functions are deployed (and, for db.js and tasks.js, after `sql/verification/v6a-can-publish.sql` AND `v6c-hold-publish.sql` AND `v6e-hold-listing.sql` are applied; the same for `verify.js` and `post-service.html`) (`docs/verification/DEPLOY-FUNCTIONS.md`). The first three alone break verification; the coordinator pair only adds the entry button. Test with the two test accounts only. `tests/*.mjs` test `pending-ui/js/verify.js` (do not copy it into the repo).

# pending-ui: files that must NOT be copied into the repo one by one

These paths match the repo root. They are the new verify page: stage V3a (markup, CSS) and stage V3b (behaviour).

| Package path | Repo path |
|---|---|
| `pending-ui/verify.html` | `verify.html` (replaces the old page) |
| `pending-ui/css/verify.css` | `css/verify.css` (new) |
| `pending-ui/js/verify.js` | `js/verify.js` (replaces the old file) |

Copy ALL THREE in the same commit, and only after the three Didit functions are deployed (`docs/verification/DEPLOY-FUNCTIONS.md`). Any one alone breaks verification. Test with the two test accounts only. `tests/verify-page.test.mjs` tests `pending-ui/js/verify.js` (do not copy it into the repo).

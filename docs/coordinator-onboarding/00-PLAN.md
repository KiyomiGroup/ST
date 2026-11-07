# Coordinator onboarding: plan and stage table

Owner request (2026-11-06). Owner rules: uses ONLY the Supabase SQL editor and dashboard function deploys (no console, curl or terminal steps for the owner); leave non-compulsory steps out; at the end of EVERY stage give a zip with everything the next AI needs; follow `AGENTS.md` + `DESIGN-SYSTEM.md` (every new page uses the page shell, 4.14). Do ONE stage per session, then stop and wait for "go". Never claim a test passed or SQL applied unless it really ran.

## The feature
1. **Coordinator code.** Admin creates a code and gives it to a coordinator. An OPTIONAL field on the sign-up page ("Have a coordinator code?", collapsible, same pattern as the referral code `data-av2-ref`). Valid code at sign-up leads the person to the coordinator page (`coordinator-dashboard.html`) as an active coordinator. Everyone else leaves it empty.
2. **Wrong code.** A link appears: "Request to be a coordinator" -> the apply form `coordinator-apply.html`. The form asks (new questions): how many Local Taskers they can bring in their area; the area, in square metres, that they would cover and that is not far from them; whether they can meet Local Taskers in person and explain what a Local Tasker is. It is sent to the StreetTasker admin email (and stored). If accepted, the admin emails the applicant a link.
3. **Approval link -> quiz.** The link opens the coordinator test: questions on what a Local Tasker is and what a coordinator must know. Fail = prompted to try again. **3 attempts per day**. A PDF about Local Taskers and what coordinators should know is given BEFORE the test (in the approval email and on the test page).
4. **Sign-up page link** "Take the coordinator test to be a coordinator" -> the test page.
5. **Site work:** the apply page did not follow the site style (fixed in S1); the top nav covers headings on phones (fixed in S1); design system gets a rule that every new page follows the site style, tokens and layout (done in S1: DESIGN-SYSTEM.md 4.14 and section 9, AGENTS.md / CLAUDE.md rule 9, check tool).

## Defaults chosen by the AI (owner can change; confirm in S2)
- Pass mark 80%. Questions served in random order, 20 per attempt (S7C), from a bank of 52 (32 from S4 + 20 added in S7C). Answers are graded on the server only; the browser never receives the answer key.
- 3 attempts per rolling calendar day in Africa/Lagos time, counted on the server per application.
- Approval link: random token, valid 14 days, tied to one application. Passing a test marks the application `passed` and issues a single-use coordinator code (shown on the page and emailed).
- Coordinator code: 10 characters from an unambiguous alphabet (no 0/O/1/I), e.g. `CO-7KQ4M2XH`, single use, optional expiry (default 30 days), created by the admin through a SQL function (the Admin Control Centre does not exist in the project zip; document what the admin page needs).
- Admin approves with one SQL call that returns the approval link; the admin pastes it into their own email (matches "the admin emails them a link").

## Stages
| Stage | Content | Owner action | Status |
|---|---|---|---|
| S1 | Foundation: nav-overlap fix site-wide, page shell, design-system rule + check, apply page restyled, C0 introspect SQL | Deploy files; run C0 introspect SQL blocks and paste results | DONE 2026-11-06 |
| S2 | Database: codes, applications, quiz questions/attempts, RPCs, RLS, scratch tests | Run `c1-coordinator-onboarding.sql` in the SQL editor | DONE 2026-11-06 (tested on scratch Postgres, NOT yet run on the real project) |
| S3 | Sign-up code field, wrong-code link, "take the test" link, new apply form, `coordinator-apply` function v2 (store + email admin) | Deploy function; push files | DONE 2026-11-06 (function tested with stubbed fetch, pages tested in headless Chromium; NOT run against the real Supabase) |
| S4 | Training PDF (Local Taskers + what coordinators must know) and the 20-question bank | Review PDF and questions | todo |
| S5 | Test page `coordinator-test.html` (quiz UI, 3/day, retry, pass -> code), approval-email helper | Deploy function; push files | todo |
| S6 | Sign-up redeem flow + routing to coordinator page, full QA at 390/768/1280, final zip | Final push | todo |

Each stage has `docs/coordinator-onboarding/handoff-Sx.md`. Read in this order: this file, the previous handoff, `AGENTS.md`, `DESIGN-SYSTEM.md` (4.14, section 9).

## Separation request (owner, 2026-11-07)
Coordinators must be completely separate from customer and tasker accounts (chosen: coordinator-only login). Coordinators must pass a Didit identity check AFTER the test and BEFORE they can work. The guide PDF is shown only to an approved applicant who was sent the test link. The test becomes 20 questions.

| Stage | Content | Status |
|---|---|---|
| A | coordinator-wallet.html (own wallet page), no links to customer/tasker pages from coordinator login/nav/dashboard, login.html signs coordinator accounts out, PDF link removed from apply page and bad-link state | DONE 2026-11-07 (stub-tested in headless Chromium, NOT run on real Supabase) |
| B | Owner runs STEP-B read-only checks and sends results | DONE 2026-11-07 (all 8 results received, copies in 4-FOR-NEXT-AI/stage-b-results) |
| C | 20-question test (RPC serves 20; 20 new questions from the PDF; garbled naira options in Q32 repaired), server-side test-link check, PDF removed from the public site and served only for a valid link (Edge Function `coordinator-guide`, PDF stored in table `coordinator_guide_files`) | FILES DONE 2026-11-07. SQL NOT run on any Postgres (none available), function NOT deployed, nothing run on real Supabase: waiting for the owner to run the 2 SQL files, deploy the function, upload, delete the public PDF |
| C-3 | Owner asked (2026-11-07): rebalance the old 32 questions so the right answer is not the longest. `STAGE-C-3-rebalance-answers.sql` rewrites the options of 22 questions (key positions unchanged) | FILES DONE 2026-11-07; run on a real Postgres (PGlite) with Stage C-1/C-2, NOT on the owner's Supabase yet |
| D-1 | Coordinator-only sign-up, first half: SQL `coordinator_finish_signup()` (additive), `coordinator-signup.html` + `js/coordinator-signup.js` + `css/coordinator-signup.css`, `coordinator-login.js` finishes a fresh sign-up, test-page pass panel points to the new sign-up (Activate / Sign up / Log in buttons removed) | FILES DONE 2026-11-07; SQL run on PGlite (18 + 16 checks), pages in headless Chromium (44 + 36 checks); NOT run on the owner's Supabase, no real email/phone |
| D-2 | Coordinator-only sign-up, second half: close the old doors. Remove the coordinator code box and links from `signup.html`, the code handling in `login.html` and `js/auth.js`; SQL to switch off `coordinator_redeem_code`; take the public navbar/footer off `coordinator-login`, `coordinator-test`, `coordinator-apply`; read every place that reads `users.role` and make a `coordinator` role safe; final QA | todo (waiting for "go" and the D-1 results) |
| E | Coordinator identity check (Didit) after the test, gate before work; verify.html proxy mode into coordinator shell | todo (needs B) |


## Notes added in S7C
- The Stage B results show: no `handle_new_user` function and no trigger that creates `public.users` (only two referral triggers on `auth.users`), so the site creates the `users` row itself from the browser (`js/auth.js`, `signUpUser` and the Google-sign-in path). `add_my_role` only accepts `customer` or `tasker`. `idv_*` functions know the subject kinds `tasker_local`, `tasker_regular`, `customer` only. Details in `handoff-S7C-test-and-guide.md`, section "What D and E need to know".
- The public PDF `downloads/local-tasker-coordinator-guide.pdf` must be DELETED from the live site by the owner; the source copy is in `4-FOR-NEXT-AI/guide-source/` and must never be put in a folder that is uploaded to the site.

# S5 handoff: test page (todo)
1. `coordinator-test.html` + `css/coordinator-test.css` + `js/coordinator-test.js` on the page shell. Reads `?t=` token. States: no/invalid/expired token (explain, link to apply and to the PDF), intro (PDF link FIRST, attempts left today, start button), questions (one card per question, large tap targets, progress), result. Fail: show score, plain "Try again" button, attempts left; at 0 attempts: next try time (Lagos). Pass: show the coordinator code with a copy button and a button to sign up; do not store the answer key in the page.
2. All grading via `coordinator_quiz_submit`; page never sees answers. Texts via `textContent`.
3. Optional (only if S2 did not cover it): an Edge Function that emails the pass code. Prefer showing the code on the page.
4. Owner actions: push files (+ deploy function if one was added).

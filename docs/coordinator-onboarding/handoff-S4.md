# S4 handoff: training PDF and question bank (todo)
1. Build `downloads/local-tasker-coordinator-guide.pdf` (use the pdf skill): what a Local Tasker is (read `local-taskers.html`, `coordinator-*.html`, `learn.html` for the real rules; do not invent policy), what a coordinator does and must never do, payments and verification basics (Didit proxy verification is still being built: say only what the site already says), safety, conduct. Plain language, short, branded to the site palette.
2. Write 20 multiple-choice questions (4 options, 1 correct, short explanation) drawn ONLY from the PDF, as SQL inserts `sql/coordinator-onboarding/c4-quiz-questions.sql` for the S2 table. Owner reviews the PDF and the questions (give them as a readable list too).
3. Link the PDF from the apply success screen text and keep its path stable for the S5 email and test page.
Owner action: review, then run the SQL file in the SQL editor.

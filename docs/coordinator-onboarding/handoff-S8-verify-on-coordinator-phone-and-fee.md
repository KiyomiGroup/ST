# Handoff S8: identity check on the coordinator's phone, and the 12% fee explanation (2026-11-08)
Changed files only. No SQL, no function deploys. Upload the files in this zip over the site.

## 1. Identity check is done on the COORDINATOR's phone
How it already worked in code: the Didit link is not tied to any device, so it works on the coordinator's phone. Only the wording said otherwise. Changed:
- `js/coordinator-intake.js` (Add / Edit Local Tasker page and its "What to collect and what to explain" pop-up): "Before you meet" no longer asks the Local Tasker to bring a phone (it tells the coordinator to bring a charged phone with data and a working camera); the identity step, consent text, link box and "Before you leave" now say the coordinator opens the check on their phone and hands it to the Local Tasker (or holds it) while beside them. The main button is now "Open on this phone", with Copy link second.
- `coordinator-tasker-verify.html`, `js/coordinator-tasker-verify.js`: same wording and button order.
- `data-consent.html` (the public notice): "The check is done on your Coordinator's phone, with you beside them." This is legal-notice text: have your lawyer confirm it.
- `verify.html`: old unused Local Tasker panel text updated; plus a small safety script (below).

IMPORTANT fix that was needed: when Didit finishes, it sends the browser to `verify.html`, which loads the customer scripts that SIGN A COORDINATOR-ONLY LOGIN OUT. That did not matter while the Local Tasker used their own phone; on the coordinator's phone it would log the coordinator out. Now, when the check is started, the page saves a small note in the browser (which coordinator page to return to); `verify.html` reads it before anything else runs and sends the coordinator back to that page (only to `coordinator-*.html` pages, only within 3 hours). Tested with a headless browser: a fresh note returns to the page, an old note, a foreign address or a "//" address is ignored. NOT tested against real Didit.

## 2. The 12% fee, explained to the Local Tasker BEFORE asking the price
- "What to explain" now has "Prices and the 12% fee. Explain this before you ask for their price": StreetTasker keeps 12%, they receive 88%, example N10,000 -> N8,800. The services line under "What you will collect" says to explain it first.
- Under the price box (Add page and Edit-service page) a line shows the example, and updates live as the coordinator types, e.g. "At N10,000, StreetTasker keeps 12% and they receive N8,800."
- REMOVED: "You earn a commission from the service fee" from what the coordinator tells the Local Tasker.

## For you to decide
- Your Terms (11.5) and Payments page say Paystack's processing fee is ALSO taken from the Tasker (on N10,000 about N250, so about N8,550). Telling a Local Tasker "N8,800" with no mention of this could be misleading, so the pop-up adds one sentence: "A small payment-processing charge from Paystack may also be deducted; it is shown before a booking is accepted." Delete that sentence if you do not want it, but then the Terms and this guidance disagree.
- Not changed: public `local-taskers.html` still says the coordinator earns a commission (a general description of how the service works, and a line aimed at people thinking of becoming coordinators). Tell me if you want those lines removed too.
- Unchanged and fine: coordinator privacy note, payouts, publish steps.

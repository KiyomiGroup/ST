# Data and consent wording (stage V3b, 2026-10-30)

Status: **drafted from research, plain and factual, NOT legal text. A lawyer must approve it before launch (D-V8).** It is live in `pending-ui/verify.html` (block `#consentBlock`, version `v1`).

## Answers to the owner's three questions
1. **Data and consent wording:** a stronger text is now written (below) and replaces the earlier short one. It is acceptable to build and test with. It is not approved for launch until a lawyer has read it AND `privacy.html` has been corrected (see section 4: the current privacy page contradicts the new flow).
2. **Two extra status messages:** approved by the owner, kept word for word ("Action required: please redo the steps you are asked to repeat." and "Your verification has expired. Please verify again.").
3. **Support and privacy paths:** `privacy.html` is correct (it exists; the footer links to it). **`contact.html` does not exist.** The footer's "Contact us" and "Help center" are disabled placeholders, and `support.html` is the internal staff "Support console", not a page for users. The only real contact route on the site is the address in `privacy.html`: `hello@streettasker.com`. The "Contact support" button and the withdrawal line now use `mailto:hello@streettasker.com`. If a real contact page is built later, change that one link.

## What was researched, and what it changed
- **Didit's own documents** (biometric data policy, privacy policy): Didit is the processor; the customer (StreetTasker) decides the purpose and must identify Didit as the provider and obtain any consent the law requires BEFORE a face is captured. Didit asks for consent by a ticked box and lets people withdraw through the customer or at privacy@didit.me. Didit says it may process data in several countries and does not sell biometric data. -> The text names Didit, says a face comparison is done, mentions possible processing outside Nigeria, and uses a ticked box.
- **Stripe Identity** (the best-known comparable flow): separate plain-language permissions to "verify your identity", the business receives the result and not the biometric identifiers, a stated removal period, a named contact for withdrawal and access. -> Same shape: what is collected, why, who gets what, how long, how to withdraw.
- **Nigeria Data Protection Act 2023** (secondary summaries, not the Act itself): biometric data used to identify a person is sensitive personal data and needs explicit consent for a specific purpose; silence or a pre-ticked box is not consent; the person must be told BEFORE consenting that they can withdraw, and withdrawal must be easy; the controller carries the burden of proving consent; people may complain to the Nigeria Data Protection Commission. -> The box is unticked and not pre-ticked, the wording says "biometric data" and "consent", withdrawal is stated before the box, and each consent is stored with its text version (V1c-1).
- Pattern used by marketplaces: a short list of labelled points with a link to the full policy, rather than a wall of legal text. -> five labelled points.

## The text on the page (version v1)
Heading: **Your data and consent**
Please read this before you start. It explains what happens to your information when you verify.
- **What is collected.** Didit, our verification provider, takes a photo of your ID and a short live selfie check, then compares your face with the photo on the ID. This comparison uses biometric data, which is sensitive personal data.
- **Why.** Only to confirm that you are the person on the ID. We do not use it for marketing and we do not sell it.
- **Who handles it.** Didit processes it for us and may do so outside Nigeria. StreetTasker receives the result (for example verified or not completed) and the dates, not your ID images. We do not ask you to type your ID number into StreetTasker. If a check needs manual review, authorised StreetTasker staff may view the record in Didit.
- **How long.** We keep the result and dates while your account is active. Didit keeps your images only for a limited period set in our Didit account, then deletes them. Details are in our privacy policy.
- **Your choice.** Verification is required to offer or book services on StreetTasker. You can withdraw your consent at any time by emailing hello@streettasker.com, and you can ask to see, correct or delete your data. Withdrawing does not undo what has already happened, and without consent we cannot verify you.

Box (unticked): *I have read the information above. I consent to StreetTasker and Didit processing my ID photo, selfie and face comparison (biometric data) to verify my identity.*

Kept out on purpose (finding F5): NIMC, "bank-grade", NDPR, encryption claims, guarantees, turnaround times, any retention number.

## Facts the text states that the owner must make true before launch
1. **Retention (D-V7, still open).** The text says Didit deletes images after a limited period "set in our Didit account". The owner must set that period in the Didit console (Settings) and put the number in the privacy policy. Until then the sentence is not true.
2. **Staff access.** "Authorised StreetTasker staff may view the record in Didit" matches D-V5 (Didit console reviewers). Keep it only while that stays so.
3. **"Not your ID images".** True of this build: no image or media link is stored (V1c-2 and V2b/V2d never persist media). Do not add storage of images later without changing this text and bumping the version.
4. **"Outside Nigeria".** Taken from Didit's statement that it processes data in several countries. The lawyer should say whether the Act's transfer rules need more wording.

## Open items for the lawyer (not for the owner to decide)
- Is "consent" the right legal basis here, or should the text also rely on another basis for customers and taskers? (The page currently makes the box a condition of verifying, and verifying a condition of offering or booking services.)
- Whether StreetTasker must register with the Nigeria Data Protection Commission, and whether a data protection impact assessment is needed for biometric checks.
- Easy withdrawal: today it is by email. The Act says withdrawal must be as easy as giving consent. A "Withdraw consent" button is possible later (`idv_withdraw_consent` exists), but withdrawing must also cause Didit data to be deleted (Didit's session delete endpoint), which is not built. Proposed as a separate small stage.
- Anything in the text that must change: if so, change `idv_consent_version()` to `v2` and `data-consent-version` together, so no old consent counts for new text.

## privacy.html CONTRADICTS the new flow (must be fixed before launch)
Section 4 "Verification documents" says: "We do not share raw ID documents with third parties. Documents are stored securely and reviewed only by authorised team members." With Didit this is no longer true. Section 3 also says "To verify identity where you choose to submit verification documents." I did not edit `privacy.html` (outside this stage). Proposed replacement for section 4, for the lawyer to approve (`{{ }}` = owner fills in):

> **4. Identity verification.** To verify your identity we use Didit, a third-party verification provider that processes data on our behalf. When you verify, Didit collects a photo of your government-issued ID and a selfie or short liveness check, and compares your face with the photo on the ID. This face comparison uses biometric data, which is sensitive personal data. We process it only with your explicit consent and only to confirm your identity. StreetTasker receives the result of the check and its dates, not your ID images. Authorised StreetTasker staff may view the verification record in Didit where a manual review is needed. Didit may process data outside Nigeria. We keep the result and dates while your account is active. Didit keeps the images for {{retention period}} and then deletes them. You can withdraw your consent at any time, and ask to access, correct or delete your data, by emailing hello@streettasker.com. Withdrawing does not affect processing already carried out. You may also complain to the Nigeria Data Protection Commission.

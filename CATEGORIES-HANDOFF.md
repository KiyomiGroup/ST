# Categories project: handoff for the next AI (after Stage 4d, Stage 4 complete)

Read `CLAUDE.md`, `DESIGN-SYSTEM.md` and `CHANGES-categories-services.md` first. Rules that matter here: tokens only, no inline `style=""`, no `!important`, run `node tools/check-design-system.js` (it already reports 2 old warnings on `post-service.html`: hex 2 -> 3 and inline 5 -> 6; they are the same on the untouched original, do not "fix" them by editing the baseline).

## The goal
Taskers post a service by choosing one of 26 categories and a subcategory, then answer questions that fit that kind of work. Customers later see those answers and can filter by them. Pricing methods and Sales products come last.

## Where we are
| Stage | What | State |
|---|---|---|
| 0 | Decisions: 26 categories (20 from the Category Directory document merged with the 17 + Sales + Other already on the site), one home per subcategory, every category ends with "Other (not listed)", old saved values kept through aliases | Done |
| 1 | `js/categories.js` (26 categories, subcategories, icons, keywords, aliases); `sql/categories/c1-*.sql` adds `services.subcategory` (text) and `services.details` (jsonb) | Done |
| 2 | Searchable picker: `js/category-picker.js`, `css/category-picker.css` | Done |
| 3 | Form engine `js/category-forms.js`, piloted on Cleaning, Repairs, Moving & Delivery | Done |
| 4a | Batch A: Home & Furniture, Gardening & Outdoor, Automotive, Beauty & Personal Care, Fashion & Tailoring | Done |
| 4b | Batch B: Design & Creative, Technology & IT, Business & Admin, Education, Pet Services | Done |
| 4c | Batch C: Events, Food & Catering, Personal Assistance, Building & Construction, Marketing, Laundry | Done |
| 4d | Batch D (regulated): Professional Services, Security & Safety, Health, Legal, Financial. Owner chose QUESTIONS ONLY (no publishing hold) | Done (this stage) |
| 5 | Show the answers to customers; category filters on Find Services | Next |
| 6 | Pricing methods, Sales upgrade, reuse schemas on Post a Task | Not started |

## How the pieces fit
- `#svcCategory` (hidden select) and `#svcSubcategory` (hidden input) hold the answers from the picker. The picker fires a normal `change` event on the select.
- `STCatForms.mount(...)` (called in `post-service.html`) listens to that change, then draws `candidates(category, subcategory)` into `#catFields` and shows `#secDetails`. No schema for the category = section hidden = `details` saved as `null`.
- Answers live in the engine (`M.values`) while the tasker edits. Changing the type of work inside the SAME category keeps answers with the same key; changing category clears them. On save, `validate()` keeps only questions that are shown and valid, then adds `_v: 1`.
- Draft / edit: the page sets category and subcategory, calls `STCatPicker.sync()`, then `STCatForms.setValues(draft.details)`.
- Save: `payload.details = STCatForms.collect()`. If the `details` or `subcategory` column is missing the page retries without it and shows a toast (so a missing SQL step never loses the listing).

## Stage 4: how to add a category (this is the main job)
Add ONE entry to `SCHEMAS` in `js/category-forms.js`, keyed by the category `value` from `categories.js` (note the old values: Repairs is `handyman`, Moving & Delivery is `logistics`, Events is `events`, Beauty is `grooming`, Food & Catering is `hospitality`, Gardening is `landscaping`, IT is `it_tech`, Design is `creative`, Business & Admin is `business`). Nothing else changes: no HTML, no CSS, no page JS.
```js
SCHEMAS.fashion = {
  groups: { sewing: ['Tailoring', 'Dressmaking'] },          // names must be real subcategory names from categories.js
  fields: [
    { key: 'fabric_by', label: 'Who supplies the fabric?', type: 'select', required: true, options: ['Client', 'Me', 'Either'] },
    { key: 'turnaround_days', label: 'Usual turnaround', type: 'number', required: true, min: 1, max: 90, unit: 'days' },
    { key: 'measure_home', label: 'Do you take measurements at the customer\'s home?', type: 'yesno', subs: '@sewing' }
  ]
};
```
Field options: `key` (never rename once live), `label`, `type`, `options`, `required`, `hint`, `placeholder`, `maxLength`, `min`/`max`/`unit`, `subs`, `notSubs`, `when: { key, equals | in }`. A `when` field must come AFTER the field it depends on.
`tests/category-forms.test.js` already checks all pilot schemas; EXTEND its `PILOT` list with each new category. The tests fail if a schema names a subcategory that does not exist, repeats a key, has a select without options, or leaves any subcategory (or Other) with fewer than two questions.

Suggested batches (from the plan): A (DONE, Stage 4a: keys `home_furniture`, `landscaping`, `automotive`, `grooming`, `fashion`). B (DONE, Stage 4b: keys `creative`, `it_tech`, `business`, `education`, `pet`). C (DONE, Stage 4c: keys `events`, `hospitality`, `assistance`, `construction`, `marketing`, `laundry`). D (DONE, Stage 4d: keys `professional`, `security`, `health`, `legal`, `financial`) Professional Services, Security & Safety, Health, Legal, Financial.
**Regulated categories (D)** also need a licence or qualification question and must be verified before going live. The engine has no "licence" type yet. Suggested: a required `text` question for the licence / registration number now, and a Stage 4D change so these categories never publish until the existing identity verification AND a manual licence check pass (look at how `window.ST.verify.holdForVerification` is used in `post-service.html` and add a second hold; do not invent a new publishing path without asking).

## Things the next AI must know
1. **The Category Directory document was not available in Stage 3.** Its "Listing fields" lists were not in the uploaded files, so the pilot questions are my own design for each type of work. Ask the owner for the document (or its listing-field lists) and reconcile before Stage 4 repeats the pattern 23 more times. Renaming a `key` after listings exist orphans saved answers, so settle the keys early.
2. **Existing listings in the pilot categories have `details = null`.** When a tasker edits one, the required questions show empty and must be answered before saving. That is intended (it fills the data in), but tell the owner.
3. **Sales and Other have no category form.** Sales keeps its own products section until Stage 6. Other keeps the "describe your category" box.
4. **`details` is NOT searchable yet.** Stage 5 filters will use `details->>'supplies'` and `details->'property_types' ? 'Office'`; add a GIN index then (`create index ... using gin (details jsonb_path_ops)`) with a matching rollback, in `sql/categories/` (next number: c2 / c3).
5. **Stage 5 display:** `STCatForms.describe(category, subcategory, details)` already returns `[{key, label, text}]` for the service details page, cards and tasker profile. Use it instead of reading `details` directly so labels stay in one place. Places to touch: `service-details.js`, `js/services-search.js`, `js/cards-compact.js`, `my-services.js`, `coordinator-service-edit.js`. Coordinator service edit does NOT have the category questions yet; it will not wipe `details` (it never sends the column) but it cannot edit them.
6. **Post a Task** (`post-task.html`, `js/tasks.js`) still uses the old category dropdown with no subcategory questions. Stage 6 reuses the same schemas for it.
7. The picker is mounted only on Post a Service. Post a Task, Find Tasks, Find Services and home-feed read the 26-category list as plain chips/dropdowns; their chip rows with 26 entries were never visually checked (open item from Stage 2).
8. Stage 1-2 bug found and fixed in Stage 3 (see `CHANGES-categories-services.md`): the category change listener lived inside `if (chipWrap ...)` in `js/post-service-ui.js`. If you ever see Sales/Other behave oddly, look there first.
9. **Phone layout:** `post-task.css` sets `.pt-section { display: contents }` under 768px and hides the section header, so on a phone each question becomes its own white card automatically. Do not add a wrapper that breaks that. `hidden` still works on sections (checked).
10. Section numbers and "Step 1.x" chips are renumbered by `renumberSections()` in `post-service.html`; call it if you add another section that shows and hides.

## Testing done in Stage 3 (and how to repeat it)
- `node --test tests/category-forms.test.js tests/category-search.test.js tests/category-detect.test.js` all pass (17 + 26 + 31), plus the older suites.
- Real browser run (Playwright, desktop 1280px and phone 390px, a fake Supabase object injected before the page loads, external requests blocked): 50 checks passed. They cover: questions per subcategory, shared answers kept when only the type of work changes, answers cleared when the category changes, the call-out fee follow-up question, Sales and Other behaviour, required-question blocking with errors and focus, the exact `details` JSON sent on insert and on update, draft restore for every field type, a legacy row with `details = null`, and the save retry when the `details` column is missing. That harness is NOT in the zip (it depends on a local Playwright install); rebuild it the same way if needed.
- **NOT tested against the real Supabase.** Run `sql/categories/c1-subcategory-details.sql` first, then save one listing in each pilot category and check `select subcategory, details from services order by created_at desc limit 5;`.

## Open decisions still with the owner
Health & Wellness / Legal / Financial are kept as their own categories (decided). Still open: whether popular "Other (describe)" services get promoted to real categories by an admin screen (idea only, not built); how regulated categories are verified (Stage 4D); the Stage 5 filter design (decision #9 in the Category Directory document).


## Stage 4a notes (batch A)
- `js/category-forms.js` (5 new schemas, no engine change), `tests/category-forms.test.js` and `css/category-forms.css` (phone fix below) changed. No SQL, no HTML. Nothing to run in Supabase for this stage.
- Keys now fixed for batch A: `home_furniture`, `landscaping` (Gardening & Outdoor), `automotive`, `grooming` (Beauty), `fashion`. Shared key names are reused on purpose (`materials`, `warranty`, `recurring`, `service_location`, `coverage`, `design_services`) so Stage 5 filters can treat them the same across categories.
- The Category Directory document is STILL missing; the questions are my own design. If the owner supplies it, reconcile BEFORE listings exist in these categories (renaming a key orphans saved answers).
- Test file: `BATCH_A` block at the bottom checks at least two questions for every subcategory and Other, plus examples of questions following the type of work. When you add batch B, extend `PILOT` and add a similar block.
- `node tools/check-design-system.js` currently FAILS on files this project never touched (css/legal.css, css/local-tasker-public.css, css/map-view.css and some legal pages missing the page shell). It is not caused by this stage; do not edit the baseline to hide it.
- Not browser-tested this stage (schema data only, same engine as Stage 3). Schema tests: `node --test tests/category-forms.test.js tests/category-search.test.js tests/category-detect.test.js` = 78 pass.
- Comment in `post-service.html` (~line 672) still says "Cleaning, Repairs, Moving & Delivery so far"; harmless, fix it when that file is next touched.
- **Phone layout fix (owner report):** chips wrap instead of scrolling sideways, and `#catFields` is `display: contents` under 768px so cards get the form gap. Do NOT add a block wrapper around question groups on phones; it breaks the card spacing. Any new chip row for answers must use `.cf-chips` (not bare `.pt-chips`).

## Stage 4b notes (batch B)
- Only `js/category-forms.js` (5 new schemas) and `tests/category-forms.test.js` changed, plus these two docs. No engine, SQL, HTML or CSS change. The phone layout fix lives in `css/category-forms.css` from the Stage 4a zip.
- Keys fixed for batch B: `creative`, `it_tech`, `business`, `education`, `pet`. Shared names reused across categories for Stage 5 filters: `software`, `languages`, `service_mode`/`work_mode`, `coverage`, `parts`, `warranty`, `emergency`, `smart_systems` (same as Home Automation), `design_services`.
- **Veterinary Care and Mobile Vet Care (inside Pet Services) are regulated.** They now ask a required `vet_registration` text answer only. Nothing holds the listing back yet. Stage 4d must decide whether these two subcategories join the licence-check hold (same mechanism as Professional, Health, Legal, Financial). Ask the owner.
- Driving Lessons has no licence/driving-school question yet; consider it in 4d too.
- Still no Category Directory document; all questions are my own design.
- Tests: 81 pass (`node --test tests/category-forms.test.js tests/category-search.test.js tests/category-detect.test.js`). BATCH_B block at the bottom of the forms test.

## Stage 4c notes (batch C)
- Only `js/category-forms.js` (6 new schemas) and `tests/category-forms.test.js` changed, plus these docs. No engine, SQL, HTML or CSS change.
- Keys fixed for batch C: `events`, `hospitality` (Food & Catering), `assistance`, `construction`, `marketing`, `laundry`. Shared names again: `coverage`, `languages`, `engagement`, `warranty`, `max_guests`, `first_aid`, `same_day`, `health_certificate`.
- Food & Catering asks an OPTIONAL food-handler health certificate (yes/no). If the owner wants it mandatory or checked, that belongs with Stage 4d verification. Building trades (electrical, plumbing, structural, roofing) only ask safety-equipment questions; no licence question yet.
- Only Stage 4d (regulated categories + licence hold) is left in Stage 4: Professional Services, Security & Safety, Health & Wellness, Legal & Advocacy, Financial Services (plus the vet and driving-school questions raised in 4b). Ask the owner how licences are checked BEFORE coding a hold. The engine has no licence type; use a required `text` registration-number question.
- Then Stage 5 (show answers to customers, filters) and Stage 6 (pricing methods, Sales upgrade, Post a Task).
- Tests: 84 pass (same three test files). BATCH_C block at the bottom of the forms test.

## Stage 4d notes (regulated categories) - Stage 4 is now complete
- 24 of 26 categories have a form. Only Sales (own products section, upgraded in Stage 6) and the empty "Other" category have none.
- **Owner decisions (2026-11-11):** regulated work gets QUESTIONS ONLY, no publishing hold; and optional registration questions were added to Driving Lessons (education) and Electrical / Plumbing Installation (construction, also covers gas work).
- How it works: work that normally needs a licence asks a required `licence_body` ("Registered with") and `licence_number` (Architecture, Engineering, Property Consultancy; Event Security, Security Guards, Fire Safety Equipment, Safety Inspection; Physiotherapy, Mental Health Counselling, Acupuncture, Chiropractic, Nursing Assistance; ALL of Legal incl. Other; Accounting, Audit Support, Tax Preparation, Financial Planning, Financial Consultancy). Other work in those categories asks an optional `has_certification` yes/no, then a required `certification_details` only if Yes. Pets keep `vet_registration`. Driving and electrical/plumbing use an optional `licence_number`.
- NOTHING is verified against any register and nothing blocks publishing. The text is shown to customers as typed. Stage 5 must display `licence_body` / `licence_number` (via `STCatForms.describe`) so customers can see them, and should NOT word it as "verified". A later admin check or hold can reuse these keys (look at `window.ST.verify.holdForVerification` in `post-service.html` around line 992 if the owner changes the decision).
- Keys are shared across categories on purpose: `licence_body`, `licence_number`, `has_certification`, `certification_details`, `work_mode`, `coverage`, `turnaround`, `client_types`, `nda`, `emergency`, `first_aid`.
- Health: `Nutrition Coaching`, `Personal Fitness Training`, `Yoga Instruction`, `Caregiving`, `Lactation Consulting` ask an optional certificate only. Owner may want some of these licensed later.
- Tests: 87 pass. The "no form yet" test now only lists Sales and Other.

## NEXT: Stage 5 (show answers to customers, filters)
Read points 4, 5 and 7 under "Things the next AI must know". Use `STCatForms.describe()` everywhere answers are shown; add a GIN index (`sql/categories/c2-*.sql` + rollback) before filtering on `details`. Ask the owner for the filter design (decision #9 of the Category Directory document, which is still missing) before building filters. Existing listings have `details = null` and will show no answers until edited.

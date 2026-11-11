# Changes: services row, categories, icons, Find Tasks fix

- js/ui.js: FIXED Find Tasks blank page (`cat` was used before it was declared in stTaskCard). Cards can hide Make an Offer (`hideOffer`). Category icons on cards.
- js/categories.js (new): 16 categories + "Other", ~120 services, 16 icons, old values (plumber, barber...) mapped to groups.
- css/categories.css (new), images/icons/cat-*.svg (new standalone icons).
- home-feed.html: new Services row; Explore Services shows every category; chips from the shared list; customer task cards have no Make an Offer.
- js/cards-compact.js: serviceCard(), categoryCard icons, taskCard option noOffer.
- find-tasks.html, js/services-search.js, js/taskers.js: chips and filters use the shared categories (taskers now reads ?category=).
- js/tasks.js, post-task.html, post-service.html: dropdown + quick chips from the shared list, "Includes:" hint.
- index.html: Browse by category icon grid.


## Categories Stage 1 + 2 (2026-11-11): 26 categories, subcategories, searchable picker
- js/categories.js: 26 categories (the 20 from the Category Directory document merged with the existing 17 + Sales + Other). Existing saved values are unchanged
  (handyman, grooming, hospitality, logistics... keep their value; only the labels changed), so no data migration. New values: construction, home_furniture, fashion,
  assistance, professional, security, marketing. Each category has subcategories (`subs`, one home each); `services` is kept as the plain name list for old callers.
  New: STCat.search(query), STCat.subsOf(value), STCat.OTHER_SUB, STCat.popular. Security words moved out of Events; CCTV moved out of IT.
- js/category-picker.js + css/category-picker.css (new): searchable picker. Writes #svcCategory (select, now hidden) and #svcSubcategory (hidden input).
- post-service.html: picker replaces the dropdown and quick chips; subcategory is required (except Other); saved as services.subcategory; draft restores it.
  Fixed: a saved Sales draft reopened as "Other" (the known-category list left Sales out).
- sql/categories/c1-subcategory-details.sql (+ c1-rollback.sql): services.subcategory (text) and services.details (jsonb, for Stage 3). RUN THIS FIRST in Supabase.
  Until it runs, saving still works; the subcategory is just not stored.
- css/tokens.css: --z-picker. tests/category-search.test.js (new).


## Categories Stage 3 (2026-11-11): the form engine, piloted on Cleaning, Repairs, Moving & Delivery
- js/category-forms.js (new): category questions described as DATA (`SCHEMAS`) and drawn by one engine. Field types: select, multi, yesno, text, textarea, number.
  Questions can be limited to subcategories (`subs`, `notSubs`, with named `groups`) or to an earlier answer (`when`). API: STCatForms.has / fieldsFor / validate / describe / mount / setValues / collect / check.
  Pilot schemas: `cleaning`, `handyman` (Repairs), `logistics` (Moving & Delivery). Every other category (and Sales and Other) shows no extra section yet and saves `details = null`.
- Saved in `services.details` (jsonb, column from Stage 1): flat, e.g. `{"_v":1,"supplies":"Either","team_size":3,"property_types":["Office"]}`. Only questions that are SHOWN for the chosen subcategory are saved.
- css/category-forms.css (new): a few rules for the new section; everything else is the shared .pt-* form classes. No new tokens.
- post-service.html: new "Service Details" section under Service Basics (`#secDetails`, drawn into `#catFields`); validated on Save / Save Draft (each missing question is marked, focus jumps to the first);
  saved with the listing; restored when a draft or an existing service is opened. Section numbers and "Step 1.x" chips now follow what is showing (renumberSections).
  The save retry now copes with EITHER `subcategory` or `details` missing in the database (Stage 1 SQL not run): it saves without them and tells the tasker.
- js/post-service-ui.js: FIXED a Stage 1-2 bug. The category change listener (which calls onCategoryChange) was only attached when the old `#svcChips` row existed, and the picker replaced it.
  Result: choosing Sales never showed the products form, and choosing Other never showed the "describe your category" box. The listener no longer depends on `#svcChips`.
- tests/category-forms.test.js (new, 17 tests): schemas only name real subcategories, fields are well formed, every subcategory (and Other) gets questions, validation, dropping hidden answers, describe().
- No new SQL. Needs `sql/categories/c1-subcategory-details.sql` (Stage 1) to have been run, same as before.

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

# Changes: services row, categories, icons, Find Tasks fix

- js/ui.js: FIXED Find Tasks blank page (`cat` was used before it was declared in stTaskCard). Cards can hide Make an Offer (`hideOffer`). Category icons on cards.
- js/categories.js (new): 16 categories + "Other", ~120 services, 16 icons, old values (plumber, barber...) mapped to groups.
- css/categories.css (new), images/icons/cat-*.svg (new standalone icons).
- home-feed.html: new Services row; Explore Services shows every category; chips from the shared list; customer task cards have no Make an Offer.
- js/cards-compact.js: serviceCard(), categoryCard icons, taskCard option noOffer.
- find-tasks.html, js/services-search.js, js/taskers.js: chips and filters use the shared categories (taskers now reads ?category=).
- js/tasks.js, post-task.html, post-service.html: dropdown + quick chips from the shared list, "Includes:" hint.
- index.html: Browse by category icon grid.

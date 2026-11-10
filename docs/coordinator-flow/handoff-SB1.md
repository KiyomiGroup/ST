# Stage SB1 — coordinator sidebar on every page

**What changed**
- The top pill menu is gone on desktop. From 1044px every coordinator page has one full-height sidebar fixed to the left edge (light, white, thin right border): brand + bell at the top, the seven links with icons, the My Local Taskers list (filter, places count, at least six rows visible before the list scrolls), Add Local Tasker, and the account row (name, Sign out) stuck to the bottom.
- Below 1044px: unchanged phone/tablet menu (header with menu button, drawer, bottom bar).
- The sidebar lives in `components/coordinator-nav.html`, so every page that loads the nav gets it. No page needed a new script tag.
- `coordinator-dashboard.html` and `coordinator-tasker.html` no longer carry their own sidebar; their old dark sidebar CSS was removed from `coordinator-dashboard.css` / `coordinator-tasker.css`. Sidebar CSS is now in `css/coordinator.css`.
- `js/coordinator-sidebar.js` fills the list and the Messages badge on every page (it is loaded by `js/coordinator.js`). On the Local Tasker page `coordinator-tasker-shell.js` still fills the list itself (current row, "N new" counts).
- The notifications panel opens to the right of the sidebar bell (`data-np-side` in `js/notifications-panel.js`).
- Width is `--co-sidebar-width` in `css/tokens.css` (now 280px).

**Not verified:** no real browser was available. Checked: JS syntax, CSS braces, no duplicate ids in the nav, design-system check shows none of these files. Please look at 1360px and 1920px wide, a short window (about 700px high: the sidebar scrolls as one piece), and a phone.

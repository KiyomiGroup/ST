# Map view: follow-ups (the three "later" items)

## 1. One copy of the area lookup
`taskers-map.js` no longer has its own area lookup, offset or cache code. It uses `STMap.areaPoint` and `STMap.nudge` from `map-view.js` (same cache key `st.map.areaPoints.v1`, same numbers as before), like the tasks map.

## 2. "Search this area" asks the database too
`STMap.show(el, items, { fetchArea(bounds) })`: when the person taps **Search this area**, the page may return extra pins from the database for the visible area. They are merged with the loaded pins (duplicates by id dropped), the note says "Showing N of M in this area (X more, not in the list)", and **Show all** removes them again. If the person changes a filter while it is searching, the late answer is ignored. If the search fails, the loaded pins in view are still shown.
- **Find Tasks:** open tasks with a saved map point (item 3) inside the view, up to 150, filtered with the page's own filters (`applyTaskFilters`, split out of `renderTasks()` in `find-tasks.html`). Remote tasks are skipped.
- **Find Taskers:** taskers with `business_lat/business_lon` inside the view (up to 100) who are not in the loaded list, with their available services, filtered with the page's own filters (`filterList`, split out of `filtered()` in `taskers.js`; sorting is unchanged). Taskers with only an area (no business point) cannot be found by position, so they appear only if they are already in the loaded list. Extra pins have no rating yet (same as live rows before the rating summary), so a "minimum rating" filter hides them.
- Extra pins are not in the list view, so their popup has no "Show in list" button.

## 3. Saved task points (privacy kept: area only)
Post Task deliberately asks for an area, not an address, and drops coordinates. That stays. New: `sql/task-map-points.sql` adds `tasks.map_lat/map_lon` and two functions:
- `task_area_point(text)`: internal. Area centre from the location text via `homepage_place_point`, trying the whole text then fewer leading parts, rounded to 3 decimals. Not callable from the browser.
- `set_task_map_point(task_id)`: callable by signed-in users, only for their own task, skips remote tasks. The browser sends **no coordinates**; the server works the point out itself.
`db.js postTask()` calls it right after the insert, not awaited and with errors ignored, so posting is never slowed or blocked. `tasks-map.js` uses the saved point when there is one and looks the area up in the browser only for older tasks. The file also has an optional commented backfill for tasks that are already open.

**Order to ship:** run `sql/task-map-points.sql`, then deploy the JS. Deploying the JS first is safe too (everything falls back), you just won't get saved points or task area search until the SQL has run.

## Files changed
`js/map-view.js`, `js/taskers-map.js`, `js/tasks-map.js`, `js/taskers.js`, `js/db.js`, `find-tasks.html`, new `sql/task-map-points.sql`.

## Tested / not tested
Browser test with a fake Leaflet and a fake Supabase: saved point used without a lookup, older task still looked up, extras merged and de-duplicated, remote and filtered-out tasks excluded, taskers already loaded not repeated, Show all removes the extras. **Not run:** the SQL (no Postgres in the build sandbox; it assumes `homepage_place_point(text)` returns columns `lat` and `lon`, as the app's JavaScript already reads them, and that `tasks` has `user_id`/`customer_id` as `postTask` writes them), real Leaflet, or the live database. Run the SQL on a copy or read it through once before production.

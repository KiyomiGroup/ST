# Map view: Stage 2 handoff (Find Tasks)

**Done:** a List / Map toggle on `find-tasks.html`, same look as Find Taskers. The map shows one pin per task for the current filters and search. Tapping a pin shows title, category, area, budget (or "No budget set"), "Urgent" if it is, and a "View task" link to `task-details.html?id=…`.

## Files
- `js/tasks-map.js` (new): Find Tasks side. Works out pin positions, wires the toggle.
- `js/map-view.js`: added two shared helpers, `STMap.areaPoint(place)` and `STMap.nudge(id)` (same logic and same localStorage cache `st.map.areaPoints.v1` as `taskers-map.js`, so an area looked up on one page is known on the other).
- `find-tasks.html`: stylesheet link, toggle in the results bar, `#tasksMapWrap` before `#tasksGrid`, two script tags, and in `renderTasks()` a call to `STTasksMap.refresh(f)` (plus the "No tasks found" box stays hidden while the map shows).
- `css/map-view.css`: unchanged (Stage 1's classes are reused).

## Where a pin comes from
`tasks` rows store only the location text (answers the Stage 1 question), so every task pin is an **approximate area**: `homepage_place_point` for the area, plus a fixed per-task offset (~100-350 m). A long address is tried whole, then without its leading parts ("Lekki Phase 1, Lagos", then "Lagos"), so a pin is never finer than an area. Popup says "Approximate area".
Left off the map, and counted in the note under it: remote tasks (no place) and tasks whose place the function does not know.

## Notes
- `taskers-map.js` still has its own copy of the area lookup. It works as before; it can be switched to `STMap.areaPoint/nudge` in Stage 3 if you want one copy.
- Tasks are the 100 newest open ones (`fetchTasks({limit:100})`), same as the list.
- Tested with a stubbed map (filtering, remote, address fallback, unknown place, toggle state). Not tested against the live database or real tiles.

## Not done yet
- Stage 3: "Search this area" / near-me button, pin clustering, highlight the card when a pin is tapped.
- Stage 4: mobile polish (bottom sheet card), tile provider check.

# Map view: Stage 1 handoff (Find Taskers)

**Done:** a List / Map toggle on `find-taskers.html`. Map shows one pin per tasker for the current filters and search; tapping a pin shows name, service, area, "From ₦…", rating and a "View profile" link.

## Files
- `js/map-view.js` (new): shared wrapper around Leaflet 1.9.4 (cdnjs) + OpenStreetMap tiles. `STMap.show(el, items, opts)`, `STMap.refresh()`, `STMap.destroy()`. Leaflet loads only when the map is first opened. Popups use textContent only.
- `js/taskers-map.js` (new): Find Taskers side. Works out pin positions, wires the toggle.
- `css/map-view.css` (new): toggle, map box (560px desktop, 70vh phone), pins, popups. Tokens only.
- `find-taskers.html`: stub "Map View" button replaced by the toggle; `#taskersMapWrap` added before `#taskersGrid`; the three scripts and the stylesheet added.
- `js/taskers.js`: one line in `render()` that passes the filtered list to `STTaskersMap.refresh(all)`.

## Where a pin comes from
1. `taskers.business_lat/business_lon` (already public columns), rounded to 3 decimals (~100 m).
2. Otherwise the centre of the tasker's area from the RPC `homepage_place_point(p_place)` (same function Home uses) plus a fixed per-person offset (~350 m). Popup says "Approximate area". Area points are cached in localStorage key `st.map.areaPoints.v1`.
Taskers with neither are left off the map and counted in the note under it.

## Not done yet
- Stage 2: Find Tasks map (reuse `STMap`; needs a decision on where task pins come from, see questions below).
- Stage 3: "Search this area" / near-me button, pin clustering, highlight the card when a pin is tapped.
- Stage 4: mobile polish (bottom sheet card), tile provider check.

## Open questions
- Do `tasks` rows store coordinates, or only the location text? (post-task.js strips lat/lon before saving.) If only text, Stage 2 will use the same `homepage_place_point` area lookup, with approximate pins.
- OpenStreetMap's public tile server is for light use. If traffic grows, switch `TILES` in `map-view.js` to a paid provider key.

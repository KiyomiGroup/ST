# Map view: Stage 3 handoff (both maps)

**Done:** on Find Taskers and Find Tasks maps:
- **Clustering:** pins close together group into numbered green bubbles; tap to zoom in. Uses Leaflet.markercluster 1.5.3 (cdnjs), loaded with Leaflet. If that file fails to load, pins are drawn one by one as before.
- **Near me** button (top right of the map): asks the browser for the position once, centres the map there, draws a blue "You are here" dot. Nothing is stored or sent. If location is refused the button says so for a few seconds.
- **Search this area** button: appears after the person moves or zooms the map (not after the page's own fit-to-pins). Tapping it keeps only the pins in view, the note says "Showing N of M in this area", and the button becomes **Show all**. Changing a filter resets it.
- **Show in list** in each pin popup: switches to the list, finds the card (Find Taskers: on the right "Load more" page), scrolls to it and flashes a green ring (`.stmap-picked`, steady ring if reduced motion is on).

## Files (all changed, none new)
- `js/map-view.js`: clustering, the two buttons, `onPick` / `onArea` options, `item.pickId`. Doc block at the top lists the API.
- `css/map-view.css`: buttons, cluster colours, popup button, picked-card ring.
- `js/taskers-map.js`, `js/tasks-map.js`: pass `onPick` and `onArea`, add the note text.

## Notes
- "Search this area" filters the pins already loaded (same 100 tasks / filtered taskers as the list); it does not query the database for the area. The list view is not narrowed by it.
- Tested with a fake Leaflet (button show/hide, in-view filter, reset, popup wiring). Real Leaflet, clusters, geolocation and tiles need a look in a browser; the sandbox had no network.

## Not done yet
- Stage 4: mobile polish (bottom sheet card instead of the popup, buttons sizing on phones), tile provider check.

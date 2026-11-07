# Map view: Stage 4 handoff (mobile polish, tiles)

**Done (both maps):**
- **Phones (width 768px or less):** tapping a pin opens a card at the bottom of the map instead of a popup. Bigger text, 44px tap targets for "View profile / View task", "Show in list" and the close button. Closes on ×, tapping the map, Escape, or when the pins are redrawn. Desktop keeps the popup.
- **Touch sizes:** map buttons (Near me, Search this area) and the List/Map toggle are taller on phones.
- **Map height on phones:** 62vh (max 560px, min 360px), down from 70vh, so there is page above and below the map to scroll with.
- **Tile provider:** now one setting. Default is still OpenStreetMap's public server. To switch, set before `js/map-view.js` loads:
  `window.ST_MAP_CONFIG = { tiles: 'https://…/{z}/{x}/{y}.png?key=…', attribution: '© …', maxZoom: 19 };`
  Keep the provider's attribution text. If no tile loads (4 errors, none succeeded), a small message says the map picture is not loading and the pins are still there.

## Files (changed): `js/map-view.js`, `css/map-view.css`. No page changes.

## Tile provider check
OpenStreetMap's public tile server is meant for light use and may block heavy or unidentified traffic. It is fine for launch and testing. If map use grows, or tiles go grey on some networks, move to a paid or key-based provider (MapTiler, Stadia, Mapbox, Thunderforest, etc.) via `ST_MAP_CONFIG`; a key in a front-end URL is public, so restrict it by domain in the provider's dashboard.
I could not test live tiles from the build sandbox (no network); please open both maps once on a real phone and a desktop.

## Testing done
Fake-Leaflet browser test at 390px width: sheet opens, shows title/sub/meta/approx/link/"Show in list", "Show in list" calls back, closes on ×, map tap and Escape, tile-error message appears and clears.

## Map view is now complete (Stages 1-4)
Possible later: one shared area-lookup copy (taskers-map.js still has its own), a database-side "search this area" query, task pins with real coordinates if tasks ever store them.

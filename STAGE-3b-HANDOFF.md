# StreetTasker — Update 2026-11-10: Stage 3b handoff (Service tab for taskers)

## Stages
| Stage | What | Status |
|---|---|---|
| 1 | Edit services button, new users land on Home + reminder, Premium/Pro tag, nav drift fix | Done |
| 1b | Plus button becomes "Service" for taskers | **DONE (this zip)** |
| 2 | Coordinator chat does everything | Done |
| 3 | Price range | Done. Owner ran p1-price-range.sql: check returned `price_max | numeric` |
| 4 | "Sales" category for product sellers (6 products, price, photo) | Not started (needs SQL + Storage bucket) |

## What changed (one file)
- **components/bottom-nav.html:** for taskers only, the round "+" is now a normal tab labelled **Service** with a briefcase icon, same style as Home / Tasks. It opens **my-services.html** (where the tasker adds, edits and pauses services). It is highlighted on my-services.html, post-service.html and service-details.html. Customers keep the round "+" (post a task). The element id `stBnPlus` is unchanged, so the onboarding tours still find it.
- Owner's choice of destination was not given: if they want Service to open post-service.html instead, change `'my-services.html'` to `'post-service.html'` on the `elPlus.href` line.

## You must do manually
- GitHub: upload components/bottom-nav.html over the old one. Nothing else (no SQL, no deploy).
- On the phone, close and reopen the web app once so the new nav loads.

## Verified / not verified
- Rendered at 390px for both roles in a headless browser: tasker bar = Home, Tasks, Service, Messages, Profile; customer bar unchanged. Not tested on a real iPhone or with real login.

## Next stage
Stage 4 (Sales category). See STAGE-3-HANDOFF.md "Next stage": SQL table for products (up to 6 per service: name, price, image), Storage bucket + policies, post-service form switches when category = Sales, display on service-details and tasker profile. Ask the owner before building: should Sales listings also have a "Sales" filter on Find Services, and how do buyers pay (in chat or on delivery)?

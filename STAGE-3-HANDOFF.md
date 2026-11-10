# StreetTasker — Update 2026-11-10: Stage 3 handoff (price range)

## Stages
| Stage | What | Status |
|---|---|---|
| 1 | Edit services button, new users land on Home + reminder, Premium/Pro tag, nav drift fix | Done |
| 1b | "Plus button should change to a service" | Still waiting for the owner's answer: what should the centre + button do, and for whom (taskers only, or customers too)? |
| 2 | Coordinator chat does everything (record + quote unlock in chat) | Done |
| 3 | Price range next to Per hour / job / day / session / visit | **DONE (this zip)** |
| 4 | "Sales" category for product sellers (6 products, price, photo) | Not started (needs SQL + Storage bucket) |

## What changed
- **Database:** `services.price_max` (nullable number). Empty = fixed price. A range service has `price` = From and `price_max` = To. A check keeps To >= From.
- **post-service.html, css/post-service.css:** new "Pricing" switch, Fixed price | Price range, above the rate box. Range shows a "To" box and the first box becomes "From". The charging unit (/job, /day...) still applies. Validates To > From. Saved drafts reopen in range mode. If the SQL has not been run, choosing Range shows a clear message instead of silently saving a fixed price.
- **js/ui.js** (new `ST_PRICE`): tasker cards and service cards show "₦5,000–₦20,000"; the service card label says "Price range" instead of "Starting From".
- **js/db.js, js/services-search.js, js/cards-compact.js, home-feed.html:** carry `price_max` through to the cards.
- **js/service-details.js, js/my-services.js, js/tasker-profile.js:** the service page, My Services list and profile service list show the range (profile hides "From" for a range).

## You must do manually (in this order)
1. **Supabase SQL editor:** run `sql/pricing/p1-price-range.sql`. It ends with a check query; it should return one row, `price_max | numeric`.
2. **GitHub:** upload the files in this zip over the old ones, same paths. Nothing to delete.
3. Nothing to deploy. No Storage change.

## Test (2 minutes)
Post a service, choose Price range, enter 5000 and 20000, Save. Open My Services, the Home page card, the service page and the tasker profile: each shows ₦5,000 – ₦20,000.

## Not verified / known limits
- Not opened in a browser or run against Supabase; JS syntax checked and design check shows nothing new in these files (it already fails on older pages).
- Not changed (still shows the "From" amount only): the Local Tasker (coordinator) pages and the old `taskers` table sync (`taskers.rate_value`), because Local Taskers are priced by coordinators and `taskers` has no max column. Price filters on Find Services compare the "From" amount.
- The edit-profile-tasker.js and dashboard-tasker.html rate boxes are unchanged (fixed price only).

## Next stage
Stage 4 (Sales category) needs: SQL for a `service_products` table (6 rows max per service: name, price, image path), a Storage bucket + policies for product images, form switching in post-service.html, and display on service-details/profile. Ask the owner whether sellers' listings also appear under a "Sales" filter on Find Services, and whether buyers pay in chat or on delivery. Re-attach the Stage 3 zip plus the project zip.

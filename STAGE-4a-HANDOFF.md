# StreetTasker — Update 2026-11-10: Stage 4a handoff (Sales category, seller side)

## Stages
| Stage | What | Status |
|---|---|---|
| 1 | Edit services button, new users land on Home + reminder, Premium/Pro tag, nav drift fix | Done |
| 1b | Plus button becomes "Service" for taskers | Done (ST-Update-Stage-3b.zip) |
| 2 | Coordinator chat does everything | Done |
| 3 | Price range | Done; owner ran p1-price-range.sql |
| 4a | Sales category: 6 products with price + photo, product list on service page, Sales filter on Find Services | **DONE (this zip)** |
| 4b | "Customers pay in chat" for products | Not started (audit first, see below) |

## Owner answers
Sales gets its own filter on Find Services: yes. Buyers pay in chat: yes.

## What changed
- **sql/pricing/p2-sales-products.sql:** new table `service_products` (service_id, user_id, position 1-6, name, price, image_url), RLS: anyone reads products of a live service, only the service owner writes. Max 6 is enforced by the table (position 1..6, unique per service). Photos reuse the existing public `service-images` bucket under `services/prod-...`, so no Storage change.
- **js/categories.js:** new category `sales` ("Sales (products)", bag icon) flagged `sellers: true`. `STCat.list` (task side: post-task, find-tasks, home chips) does NOT include it; new `STCat.serviceList` does. `resolve/get/iconHtml` know it.
- **js/services-search.js:** Find Services chips and category lookup use `serviceList`, so the "Sales" filter chip appears there.
- **post-service.html, css/post-service.css:** category dropdown has "Sales (sell products)". Choosing it hides the one-price form and shows 6 product rows (name, price, optional photo up to 5 MB, JPG/PNG/WebP). At least 1 product is required; a half-filled row is rejected. The service price is set from the products: lowest to highest price, unit `/item` (uses the Stage 3 range, so cards show ₦1,500–₦5,000). Products save after the service (upsert by position, removed rows deleted). Saved drafts reopen with their products. A CSS rule `.pt-section[hidden]` was added because `.pt-section` (display: contents on mobile) beat the `hidden` attribute.
- **service-details.html, js/service-details.js, css/service-details.css:** a Sales service shows a "Products" grid (photo, name, price); price label says "Price range" when there is a range; the main button says "Order now".
- These files also contain the Stage 3 changes (cumulative); uploading them over the old ones is correct.

## You must do manually (in this order)
1. Supabase SQL editor: run `sql/pricing/p2-sales-products.sql`. It ends with two check queries: first returns `service_products`, second returns 4 policy names (service_products_delete / _insert / _read / _update).
2. GitHub: upload the files in this zip over the old ones, same paths.
3. Nothing to deploy.

## Test (3 minutes)
Post a service, category Sales (sell products), add 2 products with prices (one with a photo), Save & Continue. After verification the service is live: open it from Find Services (filter chip "Sales"): the Products grid shows both, price shows a range, button says "Order now".

## Not verified / known limits
- Not tested against the real Supabase or on a real phone; the form logic and layout were tested headlessly at 390px (6 rows, range from products, bad row rejected, switching category back restores the normal form). JS syntax checked; design check shows nothing new beyond the old +1 notes on post-service.html.
- Editing a published Sales service later: only the draft path reloads products. my-services.html has no product editor yet (4b/4c).
- Tasker profile service list and home/cards show the Sales service as a normal card with the price range; they do not list products.
- Payment is NOT built specially. "Order now" opens the normal booking form on the tasker profile (date, urgency fields written for services), and payment then happens in the Job Room chat through the existing payment requests (js/messages-money.js, Paystack). Whether that fits product orders is unverified.

## Next: 4b (pay in chat for products)
Audit first, then decide with the owner: (1) does booking from a Sales service create a thread the tasker can send a `payment_requests` row in? (2) a simpler product order form (pick products + quantity, address, no date) that opens the chat with an itemised message/invoice (JRMoney supports `kind: 'invoice'` with lines and a title, Stage 8); (3) editing products from my-services.html. Attach this zip plus the project zip.

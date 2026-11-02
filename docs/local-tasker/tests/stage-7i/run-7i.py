# Stage 7I browser checks. MOCKED Supabase, Paystack pop-up and payment Edge Functions (fake-plan-supabase.js).
# Usage: ST_REPO_ROOT=/path/to/site python3 run-7i.py   (the site folder must already contain the 7I files)
import asyncio, json, http.server, threading, functools, os
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); PORT = 8791
SHOTS = os.environ.get('ST_SHOTS')   # optional folder for screenshots
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__)); FAKE = open(os.path.join(HERE, 'fake-plan-supabase.js')).read(); BASE = 'http://127.0.0.1:%d/' % PORT
res = []
def check(n, c, x=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(x)[:300] if x else ''))
async def page(b, sc, url='coordinator-plan.html', w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'js.paystack.co' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(sc) + ';'); await p.goto(BASE + url); await p.wait_for_timeout(700); return ctx, p, errs
async def txt(p, sel): return (await p.inner_text(sel)).strip()
async def vis(p, sel): return await p.is_visible(sel)
async def start_pay(p):
    await p.click('#coPlUpgradeBtn'); await p.click('#coPlPayBtn'); await p.wait_for_timeout(500)
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()

        # 1. Tier 1 view
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4})
        check('tier 1: tier, places used, left, next price', (await txt(p, '#coPlTier'), await txt(p, '#coPlUsed'), await txt(p, '#coPlLeft'), await txt(p, '#coPlNextPrice')) == ('Tier 1', '4', '6', '₦50,000'), (await txt(p, '#coPlTier'), await txt(p, '#coPlUsed'), await txt(p, '#coPlLeft'), await txt(p, '#coPlNextPrice')))
        check('tier 1: notes say 10 places and "of 10 allowed"', await txt(p, '#coPlTierNote') == '10 places allowed' and await txt(p, '#coPlUsedNote') == 'of 10 allowed', (await txt(p, '#coPlTierNote'), await txt(p, '#coPlUsedNote')))
        check('tier 1: next step is Tier 2 with 20 places', await txt(p, '#coPlNextNote') == 'Tier 2 · 20 places' and await txt(p, '#coPlNextTitle') == 'Next step: Tier 2', await txt(p, '#coPlNextNote'))
        check('exactly ONE upgrade button, labelled for Tier 2, and no Tier 3 button anywhere', await p.locator('#coPlUpgradeBtn').count() == 1 and await txt(p, '#coPlUpgradeBtn') == 'Upgrade to Tier 2' and 'Tier 3' not in ' '.join(await p.locator('button').all_inner_texts()), await p.locator('button').all_inner_texts())
        check('history: empty message for a new coordinator', await vis(p, '#coPlHistEmpty') and not await vis(p, '#coPlHistList'))
        check('meter shows 40%', await p.evaluate("getComputedStyle(document.querySelector('#coPlMeter')).getPropertyValue('--co-meter').trim()") == '40%')
        check('nav: Plan link is current on this page; drawer link exists', await p.locator('.co-nav-link[href="coordinator-plan.html"][aria-current="page"]').count() == 1 and await p.locator('.co-drawer-link[href="coordinator-plan.html"]').count() == 1)
        check('no payment call just from opening the page', await p.evaluate('window.__initBodies.length') == 0 and await p.evaluate('window.__verifyBodies.length') == 0)
        check('no page errors', not errs, errs)
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-1440-tier1.png', full_page=True)
        # 2. confirmation step
        await p.click('#coPlUpgradeBtn')
        check('Upgrade shows the confirmation, names the price and tier, and charges nothing yet', await vis(p, '#coPlConfirm') and '₦50,000' in await txt(p, '#coPlConfirmText') and 'Tier 2' in await txt(p, '#coPlConfirmText') and await p.evaluate('window.__initBodies.length') == 0, await txt(p, '#coPlConfirmText'))
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-1440-confirm.png', full_page=True)
        await p.click('#coPlCancelBtn')
        check('Not now closes it, nothing started', not await vis(p, '#coPlConfirm') and await vis(p, '#coPlUpgradeBtn') and await p.evaluate('window.__initBodies.length') == 0)
        await ctx.close()

        # 3. Successful upgrade, with verify held so we can look at the page BEFORE verification
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'verify': 'hold'})
        await p.click('#coPlUpgradeBtn'); await p.click('#coPlPayBtn'); await p.wait_for_timeout(600)
        bodies = await p.evaluate('window.__initBodies'); ps = await p.evaluate('window.__psOpts')
        check('payment-init got ONLY the purpose (no amount, tier or id from the browser)', bodies == [{'purpose': 'tier_upgrade'}], bodies)
        check('the pop-up used the SERVER amount (5,000,000 kobo) and reference', len(ps) == 1 and ps[0]['amount'] == 5000000 and ps[0]['ref'].startswith('ST-') and ps[0]['currency'] == 'NGN', ps)
        check('BEFORE verification: tier, capacity and button are unchanged', (await txt(p, '#coPlTier'), await txt(p, '#coPlUsedNote')) == ('Tier 1', 'of 10 allowed') and await p.evaluate('window.__verifyBodies.length') == 1, (await txt(p, '#coPlTier'), await txt(p, '#coPlUsedNote')))
        check('while verifying: buttons are disabled (no double pay)', await p.is_disabled('#coPlPayBtn') and await p.is_disabled('#coPlUpgradeBtn'))
        await p.evaluate('window.__release()'); await p.wait_for_timeout(800)
        check('AFTER verification: Tier 2, capacity 20, places left 16', (await txt(p, '#coPlTier'), await txt(p, '#coPlTierNote'), await txt(p, '#coPlLeft')) == ('Tier 2', '20 places allowed', '16'), (await txt(p, '#coPlTier'), await txt(p, '#coPlTierNote'), await txt(p, '#coPlLeft')))
        check('success message names the new capacity', 'Tier 2' in await txt(p, '#coPlStatusText') and '20' in await txt(p, '#coPlStatusText'), await txt(p, '#coPlStatusText'))
        check('next step is now Tier 3 for ₦100,000 and only Tier 3 is offered', await txt(p, '#coPlUpgradeBtn') == 'Upgrade to Tier 3' and await txt(p, '#coPlNextPrice') == '₦100,000' and await p.locator('#coPlUpgradeBtn').count() == 1)
        check('history lists Tier 1 → Tier 2 with price, places and the reference', await p.locator('#coPlHistList li').count() == 1 and 'Tier 1 → Tier 2' in await txt(p, '#coPlHistList') and '₦50,000' in await txt(p, '#coPlHistList') and 'ST-ab12cd34' in await txt(p, '#coPlHistList'), await txt(p, '#coPlHistList'))
        check('exactly one payment-init and one payment-verify call', await p.evaluate('window.__initBodies.length') == 1 and await p.evaluate('window.__verifyBodies.length') == 1)
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-1440-after-upgrade.png', full_page=True)
        check('no page errors', not errs, errs)
        await ctx.close()

        # 4. Double click on Pay
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4})
        await p.click('#coPlUpgradeBtn'); await p.dblclick('#coPlPayBtn'); await p.wait_for_timeout(900)
        check('double-clicking Pay starts ONE payment', await p.evaluate('window.__initBodies.length') == 1, await p.evaluate('window.__initBodies.length'))
        await ctx.close()

        # 5. Pop-up closed
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'paystack': 'close'})
        await start_pay(p)
        check('pop-up closed: no verify call, tier unchanged, calm message with the reference', await p.evaluate('window.__verifyBodies.length') == 0 and await txt(p, '#coPlTier') == 'Tier 1' and 'closed' in await txt(p, '#coPlStatusText') and await vis(p, '#coPlStatusRef'), await txt(p, '#coPlStatusText'))
        check('pop-up closed: the person can try again', not await p.is_disabled('#coPlUpgradeBtn'))
        await ctx.close()

        # 6. Pending forever
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'verify': 'pending'})
        await start_pay(p); await p.wait_for_timeout(600)
        t = await txt(p, '#coPlStatusText')
        check('still pending: says do not pay again, shows reference, button locked, tier unchanged', 'do not pay again' in t.lower() and await vis(p, '#coPlStatusRef') and await p.is_disabled('#coPlUpgradeBtn') and await txt(p, '#coPlTier') == 'Tier 1', t)
        check('pending: it retried verification (6 tries)', await p.evaluate('window.__verifyBodies.length') == 6, await p.evaluate('window.__verifyBodies.length'))
        await ctx.close()

        # 7. Paid but needs review
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'verify': 'review'})
        await start_pay(p)
        t = await txt(p, '#coPlStatusText')
        check('needs review: says contact support, shows reference, locked, tier unchanged', 'contact' in t.lower() and 'support' in t.lower() and await vis(p, '#coPlStatusRef') and await p.is_disabled('#coPlUpgradeBtn') and await txt(p, '#coPlTier') == 'Tier 1', t)
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-1440-review.png', full_page=True)
        await ctx.close()

        # 8. Payment failed
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'verify': 'failed'})
        await start_pay(p)
        check('failed payment: server text shown, tier unchanged, can retry', 'not been charged' in await txt(p, '#coPlStatusText') and await txt(p, '#coPlTier') == 'Tier 1' and not await p.is_disabled('#coPlUpgradeBtn'), await txt(p, '#coPlStatusText'))
        await ctx.close()

        # 9. Server says confirmed but plan has not risen
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'verify': 'okStale'})
        await start_pay(p)
        check('confirmed but plan not risen: nothing invented, locked, tells person not to pay again', await txt(p, '#coPlTier') == 'Tier 1' and await p.is_disabled('#coPlUpgradeBtn') and 'do not pay again' in (await txt(p, '#coPlStatusText')).lower(), await txt(p, '#coPlStatusText'))
        await ctx.close()

        # 10. Server refuses to start
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'initFail': {'status': 400, 'error': 'A tier cannot be skipped. The next tier is 2.'}})
        await start_pay(p)
        check('server refusal shown as written; no pop-up opened', 'cannot be skipped' in await txt(p, '#coPlStatusText') and await p.evaluate('window.__psOpts.length') == 0, await txt(p, '#coPlStatusText'))
        await ctx.close()

        # 11. Top tier
        ctx, p, errs = await page(b, {'tier': 100, 'active': 20, 'noNext': True})
        check('highest plan: message shown, no upgrade button, no price', await vis(p, '#coPlTopBody') and not await vis(p, '#coPlUpgradeBtn') and await txt(p, '#coPlNextPrice') == '—', await txt(p, '#coPlNextNote'))
        await ctx.close()

        # 12. Malformed next step (skips a tier)
        ctx, p, errs = await page(b, {'tier': 2, 'active': 4, 'badNext': True})
        check('server next = tier+2 (malformed): NO upgrade button is offered', not await vis(p, '#coPlUpgradeBtn') and not await vis(p, '#coPlNextBody') and not await vis(p, '#coPlTopBody'), await txt(p, '#coPlNextNote'))
        await ctx.close()

        # 13. Plan unreadable, then retry
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'planError': True})
        check('plan unreadable: error banner, dashes, no grid, no button', await vis(p, '#coPlError') and await txt(p, '#coPlTier') == '—' and not await vis(p, '#coPlGrid') and not await vis(p, '#coPlUpgradeBtn'))
        await p.evaluate('window.__planFixed = true'); await p.click('#coPlRetry'); await p.wait_for_timeout(500)
        check('retry loads the plan', not await vis(p, '#coPlError') and await txt(p, '#coPlTier') == 'Tier 1' and await vis(p, '#coPlUpgradeBtn'))
        await ctx.close()

        # 14. Over capacity
        ctx, p, errs = await page(b, {'tier': 1, 'active': 12})
        check('over capacity: notice shown, places left 0, meter full', await vis(p, '#coPlOver') and await txt(p, '#coPlLeft') == '0' and await p.evaluate("document.querySelector('#coPlMeter').classList.contains('is-full')") and await p.evaluate("getComputedStyle(document.querySelector('#coPlMeter')).getPropertyValue('--co-meter').trim()") == '100%')
        await ctx.close()

        # 15. History unreadable does not break the plan
        ctx, p, errs = await page(b, {'tier': 2, 'active': 4, 'histError': True})
        check('history unreadable: its own error, the plan and the button still work', await vis(p, '#coPlHistError') and await txt(p, '#coPlTier') == 'Tier 2' and await vis(p, '#coPlUpgradeBtn'))
        await ctx.close()

        # 16. Text is never treated as HTML
        evil = '<img src=x onerror=window.__pwn=1>'
        ctx, p, errs = await page(b, {'tier': 2, 'active': 4, 'history': [{'from_tier': 1, 'to_tier': 2, 'capacity': 20, 'amount_kobo': 5000000, 'payment_reference': evil, 'created_at': '2026-11-01T09:00:00Z'}]})
        check('payment reference shown as text, not run as HTML', await p.evaluate('window.__pwn') is None and await p.locator('#coPlHistList img').count() == 0 and evil in await txt(p, '#coPlHistList'))
        await ctx.close()

        # 17. Links from the other pages
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4}, 'coordinator-dashboard.html')
        check('Overview tile links to the plan page', await p.locator('a[href="coordinator-plan.html"].co-fact-link').count() == 1)
        check('Overview nav shows Plan', await p.locator('.co-nav-link[href="coordinator-plan.html"]').count() == 1)
        await ctx.close()
        ctx, p, errs = await page(b, {'tier': 1, 'active': 10}, 'coordinator-tasker-new.html')
        check('Add form at capacity: message still names 10 and now links to the plan page', await vis(p, '#coFormCap') and 'maximum of 10' in await txt(p, '#coFormCap') and await p.locator('#coFormCap a[href="coordinator-plan.html"]').count() == 1, await txt(p, '#coFormCap'))
        await ctx.close()

        # 18. Phone width
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4}, w=390, h=844)
        check('390px: no sideways scroll', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), await p.evaluate('document.documentElement.scrollWidth'))
        check('390px: upgrade button is at least 44px tall', (await p.locator('#coPlUpgradeBtn').bounding_box())['height'] >= 44)
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-390-tier1.png', full_page=True)
        await p.click('#coPlUpgradeBtn')
        check('390px: confirmation fits without sideways scroll', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-390-confirm.png', full_page=True)
        await p.click('#coPlCancelBtn')
        await ctx.close()
        ctx, p, errs = await page(b, {'tier': 3, 'active': 28, 'history': [{'from_tier': 1, 'to_tier': 2, 'capacity': 20, 'amount_kobo': 5000000, 'payment_reference': 'ST-1111aaaa1111aaaa1111aaaa1111aaaa', 'created_at': '2026-10-20T09:00:00Z'}, {'from_tier': 2, 'to_tier': 3, 'capacity': 30, 'amount_kobo': 10000000, 'payment_reference': 'ST-2222bbbb2222bbbb2222bbbb2222bbbb', 'created_at': '2026-11-01T09:00:00Z'}]}, w=390, h=844)
        check('390px, tier 3 with history: no sideways scroll', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-390-tier3-history.png', full_page=True)
        await ctx.close()
        ctx, p, errs = await page(b, {'tier': 3, 'active': 28, 'history': [{'from_tier': 1, 'to_tier': 2, 'capacity': 20, 'amount_kobo': 5000000, 'payment_reference': 'ST-1111aaaa1111aaaa1111aaaa1111aaaa', 'created_at': '2026-10-20T09:00:00Z'}, {'from_tier': 2, 'to_tier': 3, 'capacity': 30, 'amount_kobo': 10000000, 'payment_reference': 'ST-2222bbbb2222bbbb2222bbbb2222bbbb', 'created_at': '2026-11-01T09:00:00Z'}]})
        if SHOTS: await p.screenshot(path=SHOTS + '/plan-1440-tier3-history.png', full_page=True)
        await ctx.close()
        await b.close()
    print('%d PASS, %d FAIL' % (sum(res), len(res) - sum(res)))
asyncio.run(main())

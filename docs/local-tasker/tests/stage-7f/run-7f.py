# Stage 7F browser checks for the coordinator Overview wallet panel and the navigation Wallet link.
# MOCKED Supabase (fake-dashboard-supabase.js). Proves PAGE logic only, not the real database.
# Usage: ST_REPO_ROOT=/path/to/site [ST_SHOTS=/folder] python3 run-7f.py   (the folder must already contain the 7F files)
import asyncio, json, http.server, threading, functools, os
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); PORT = 8792; SHOTS = os.environ.get('ST_SHOTS')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__)); FAKE = open(os.path.join(HERE, 'fake-dashboard-supabase.js')).read(); BASE = 'http://127.0.0.1:%d/' % PORT
res = []
def check(n, c, x=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(x)[:300] if x else ''))
async def page(b, sc, url='coordinator-dashboard.html', w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'js.paystack.co' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(sc) + ';'); await p.goto(BASE + url); await p.wait_for_timeout(800); return ctx, p, errs
async def txt(p, sel): return (await p.inner_text(sel)).strip()
async def vis(p, sel): return await p.is_visible(sel)
async def overflow(p): return await p.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # 1. a coordinator with money
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'wallet': 6000})
        check('balance shows the real wallet amount', await txt(p, '#coWalletBalance') == '₦6,000.00', await txt(p, '#coWalletBalance'))
        check('no message when the balance loaded', not await vis(p, '#coWalletNote'))
        reads = await p.evaluate('window.__walletReads')
        check('exactly one wallets read: balance column only, for this coordinator only', len(reads) == 1 and reads[0]['selected'] == 'balance' and reads[0]['filters'] == [['user_id', 'co-1']], reads)
        calls = await p.evaluate('window.__calls')
        check('nothing was written and no payment call was made', not any(c.startswith('rpc:withdrawal') or c.startswith('rpc:bank') or c.startswith('fn:') for c in calls) and await p.evaluate('window.__initBodies.length') == 0, calls)
        check('Open your wallet link goes to wallet.html', await p.get_attribute('#coWalletBalance >> xpath=../../..//a[@class="co-fact-link"]', 'href') == 'wallet.html')
        check('top navigation has a Wallet link to wallet.html', await p.locator('.co-nav-link[href="wallet.html"]').count() == 1 and await txt(p, '.co-nav-link[href="wallet.html"]') == 'Wallet')
        check('drawer has a Wallet link to wallet.html', await p.locator('.co-drawer-link[href="wallet.html"]').count() == 1)
        check('the other navigation links are still there (Overview, Taskers, Bookings, Messages, Plan)', all([await p.locator(f'.co-nav-link[href="{h}"]').count() == 1 for h in ['coordinator-dashboard.html', 'coordinator-taskers.html', 'coordinator-bookings.html', 'coordinator-chat.html', 'coordinator-plan.html']]))
        check('no sideways scroll at 1440', await overflow(p) <= 0, await overflow(p))
        check('no page errors', not errs, errs)
        if SHOTS: await p.screenshot(path=SHOTS + '/dashboard-1440.png', full_page=True)
        await ctx.close()
        # 2. no wallet row yet
        ctx, p, errs = await page(b, {'wallet': 'none'})
        check('no wallet row: balance is 0, no error message', await txt(p, '#coWalletBalance') == '₦0.00' and not await vis(p, '#coWalletNote'))
        await ctx.close()
        # 3. failures show a dash and a message, never a number
        for mode in ['error', 'junk', 'negative']:
            ctx, p, errs = await page(b, {'wallet': mode})
            check('wallet ' + mode + ': dash and a plain message, no invented figure', await txt(p, '#coWalletBalance') == '—' and await vis(p, '#coWalletNote') and 'couldn' in (await txt(p, '#coWalletNote')).lower(), (await txt(p, '#coWalletBalance'), await txt(p, '#coWalletNote')))
            await ctx.close()
        # 4. phone
        ctx, p, errs = await page(b, {'tier': 1, 'active': 4, 'wallet': 1234567.5}, w=390, h=844)
        check('390: large balance is formatted and fits', await txt(p, '#coWalletBalance') == '₦1,234,567.50' and await overflow(p) <= 0, (await txt(p, '#coWalletBalance'), await overflow(p)))
        if SHOTS: await p.screenshot(path=SHOTS + '/dashboard-390.png', full_page=True)
        await p.click('#coMenuBtn'); await p.wait_for_timeout(300)
        check('390: the drawer opens and shows Wallet & withdrawals', await vis(p, '.co-drawer-link[href="wallet.html"]') and 'Wallet' in await txt(p, '.co-drawer-link[href="wallet.html"]'))
        if SHOTS: await p.screenshot(path=SHOTS + '/drawer-390.png')
        check('390: no page errors', not errs, errs)
        await ctx.close()
        # 5. 320 phone
        ctx, p, errs = await page(b, {'wallet': 98765}, w=320, h=640)
        check('320: no sideways scroll', await overflow(p) <= 0, await overflow(p))
        await ctx.close()
        # 6. other coordinator pages still load their nav with the new link and no errors
        for u in ['coordinator-plan.html', 'coordinator-taskers.html']:
            ctx, p, errs = await page(b, {'tier': 1, 'active': 4}, url=u)
            check(u + ': nav loads with the Wallet link, no page errors', await p.locator('.co-nav-link[href="wallet.html"]').count() == 1 and not errs, errs)
            await ctx.close()
        await b.close()
    n = sum(res); print('\n%d passed, %d failed' % (n, len(res) - n)); raise SystemExit(0 if n == len(res) else 1)
asyncio.run(main())

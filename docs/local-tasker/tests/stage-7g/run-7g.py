import asyncio, json, http.server, threading, functools, os
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); PORT = 8778
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__)); FAKE = open(os.path.join(HERE, 'fake-plan-supabase.js')).read(); BASE = 'http://127.0.0.1:%d/' % PORT
res = []
def check(n, c, x=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' | ' + str(x)[:250] if x else ''))
def plan(tier, cap, active): return {'tier': tier, 'capacity': cap, 'active_count': active, 'places_left': max(cap - active, 0), 'over_capacity': active > cap, 'next': {'tier': tier + 1, 'capacity': cap + 10, 'price_kobo': 5000000}}
async def page(b, sc, url, w=1440):
    ctx = await b.new_context(viewport={'width': w, 'height': 900})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(sc) + ';'); await p.goto(BASE + url); await p.wait_for_timeout(900); return ctx, p, errs
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # Overview tile
        for name, pl, n, want_open, want_note in [('tier 1, 4 used', plan(1, 10, 4), 4, '6', 'of 10 allowed'), ('tier 2, 4 used', plan(2, 20, 4), 4, '16', 'of 20 allowed'), ('tier 4, 35 used', plan(4, 35, 35), 35, '0', 'of 35 allowed'), ('over capacity', plan(1, 10, 12), 12, '0', 'of 10 allowed')]:
            ctx, p, errs = await page(b, {'plan': pl, 'assignments': n}, 'coordinator-dashboard.html')
            o = await p.inner_text('[data-co-stat="open"]'); note = await p.inner_text('#coCapNote')
            check('overview, %s: places left %s, note "%s"' % (name, want_open, want_note), o == want_open and note == want_note, (o, note, errs))
            await ctx.close()
        ctx, p, errs = await page(b, {'plan': 'error', 'assignments': 4}, 'coordinator-dashboard.html')
        check('overview, plan unreadable: a dash, not a guessed number', await p.inner_text('[data-co-stat="open"]') == '—' and await p.inner_text('#coCapNote') == 'Active assignments', errs); await ctx.close()
        # list summary
        ctx, p, errs = await page(b, {'plan': plan(2, 20, 3), 'assignments': 3}, 'coordinator-taskers.html')
        check('list: "3 of 20 places used"', '3 of 20 places used' in await p.inner_text('#coListSummary'), await p.inner_text('#coListSummary')); await ctx.close()
        ctx, p, errs = await page(b, {'plan': 'error', 'assignments': 3}, 'coordinator-taskers.html')
        check('list, plan unreadable: no number invented', '3 active' in await p.inner_text('#coListSummary') and ' of ' not in await p.inner_text('#coListSummary'), await p.inner_text('#coListSummary')); await ctx.close()
        # add form
        ctx, p, errs = await page(b, {'plan': plan(1, 10, 10), 'assignments': 10}, 'coordinator-tasker-new.html')
        txt = await p.inner_text('#coFormCap')
        check('form at capacity: banner visible, names 10, submit disabled', await p.is_visible('#coFormCap') and 'maximum of 10' in txt and await p.is_disabled('#coFSubmit'), txt)
        check('no "ask an administrator" wording left', 'administrator' not in txt); await ctx.close()
        ctx, p, errs = await page(b, {'plan': plan(2, 20, 10), 'assignments': 10}, 'coordinator-tasker-new.html')
        check('form at tier 2 with 10 used: banner hidden, submit enabled', not await p.is_visible('#coFormCap') and not await p.is_disabled('#coFSubmit'), errs); await ctx.close()
        ctx, p, errs = await page(b, {'plan': 'error', 'assignments': 10}, 'coordinator-tasker-new.html')
        check('form, plan unreadable: the "could not check" note shows and submit stays enabled (the database decides)', await p.is_visible('#coFormCheckError') and not await p.is_disabled('#coFSubmit'), errs)
        calls = await p.evaluate('window.__calls'); check('the form no longer counts assignments itself', 'from:coordinator_assignments' not in calls, calls); await ctx.close()
        ctx, p, errs = await page(b, {'plan': plan(1, 10, 4), 'assignments': 4}, 'coordinator-dashboard.html', 390)
        check('390px: no sideways scroll on the overview', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), errs); await ctx.close()
        await b.close()
    print('%d PASS, %d FAIL' % (sum(res), len(res) - sum(res)))
asyncio.run(main())

import asyncio, json, http.server, threading, functools, os, copy
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8767), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake-bookings-supabase.js')).read()
BASE = 'http://127.0.0.1:8767/'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra else ''))
async def newpage(b, sc, w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(sc) + ';')
    return ctx, p, errs
def uid(n): return '00000000-0000-4000-8000-%012d' % n
LT = '44444444-4444-4444-8444-444444444444'
def row(n, lt, bs='pending', pay='unpaid', title=None, open_=True, frozen=False, amount=None, cust='Ada Obi', when='Sat 2 Nov, 10:00'):
    return {'booking_id': uid(n), 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': cust, 'title': title or ('Job %d' % n), 'lt_status': lt,
            'booking_status': bs, 'work_stage': None, 'payment_status': pay, 'amount': amount, 'scheduled_time': when, 'created_at': '2026-10-27T10:%02d:00Z' % n,
            'updated_at': '2026-10-27T10:%02d:00Z' % n, 'frozen': frozen, 'open': open_}
LIST = [row(1, 'assigned', title='<b>Fix wardrobe</b>'), row(2, 'awaiting_tasker_confirmation'), row(3, 'tasker_confirmed', amount=15000),
        row(4, 'quote_sent'), row(5, 'quote_approved', pay='unpaid'), row(6, 'quote_approved', bs='confirmed', pay='paid', amount=20000),
        row(7, 'assigned', bs='disputed', open_=False), row(8, 'quote_approved', bs='completed', pay='released', open_=False), row(9, 'quote_declined'),
        row(10, 'assigned', frozen=True), row(11, 'tasker_declined')]
DET = {uid(1): {'booking_id': uid(1), 'lt_status': 'assigned', 'booking_status': 'pending', 'work_stage': None, 'payment_status': 'unpaid', 'amount': None,
                'scheduled_time': 'Sat 2 Nov, 10:00', 'created_at': '2026-10-27T10:01:00Z', 'notes': '<img src=x onerror=window.__xss=1>Door off hinge',
                'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada <i>Obi</i>', 'customer_phone': '+234 801 000 1111',
                'task': {'title': '<b>Fix wardrobe</b>', 'description': 'Door off hinge', 'location': 'Yaba', 'category': 'carpentry', 'budget': '20000'}, 'service': None,
                'original_coordinator_is_me': True, 'frozen': False, 'open': True, 'allowed_next': ['awaiting_tasker_confirmation'],
                'events': [{'kind': 'status_changed', 'from_status': 'assigned', 'to_status': 'awaiting_tasker_confirmation', 'actor_role': 'coordinator', 'note': 'Called him', 'created_at': '2026-10-27T11:00:00Z'},
                           {'kind': 'assigned', 'from_status': None, 'to_status': 'assigned', 'actor_role': 'system', 'note': None, 'created_at': '2026-10-27T10:01:00Z'}]},
       uid(8): {'booking_id': uid(8), 'lt_status': 'quote_approved', 'booking_status': 'completed', 'work_stage': None, 'payment_status': 'released', 'amount': 20000,
                'scheduled_time': None, 'created_at': '2026-10-27T10:08:00Z', 'notes': None, 'tasker_user_id': LT, 'tasker_name': None, 'customer_name': 'Ada Obi', 'customer_phone': None,
                'task': None, 'service': {'service_name': 'Wardrobe repair', 'location': 'Yaba'}, 'original_coordinator_is_me': False, 'frozen': False, 'open': False, 'allowed_next': [], 'events': []}}
def scn(**k):
    s = {'list': copy.deepcopy(LIST), 'detail': copy.deepcopy(DET)}; s.update(k); return s
async def rpcs(p): return await p.evaluate('window.__rpc')

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # ---------- list, desktop
        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'coordinator-bookings.html'); await p.wait_for_selector('#coBkList li', timeout=8000)
        tabs = await p.locator('#coBkTabs button').all_inner_texts()
        check('list: four tabs with counts', len(tabs) == 4, tabs)
        exp = ['Needs action (5)', 'Waiting (3)', 'Problems (2)', 'Closed (1)']
        # assigned(1) awaiting(2) tasker_confirmed(3) quote_declined(9) tasker_declined(11) = 5 action; quote_sent(4), approved unpaid(5), approved paid(6) = 3 waiting; disputed(7)+frozen(10) = 2; completed(8) = 1
        check('list: counts are exactly 5 / 3 / 2 / 1', tabs == exp, tabs)
        check('list: opens on Needs action', 'is-active' in (await p.locator('#coBkTabs button').first.get_attribute('class')))
        check('list: 5 cards shown on Needs action', await p.locator('#coBkList li').count() == 5)
        check('list: summary says 5 bookings need action', '5 bookings need your action' in await p.inner_text('#coBkSummary'), await p.inner_text('#coBkSummary'))
        first = p.locator('#coBkList li').first
        t = await first.inner_text()
        check('list: card shows job, tasker, customer, status, and the single next action', 'Baba Alabi' in t and 'Ada Obi' in t and 'New booking' in t and 'Contact the Local Tasker' in t, t.replace('\n', ' | '))
        check('list: HTML in a title is shown as text, not rendered', await p.locator('#coBkList li b').count() == 0 and '<b>Fix wardrobe</b>' in t)
        href = await first.locator('a').get_attribute('href')
        check('list: card links to the detail page with the booking id', href == 'coordinator-booking.html?id=' + uid(1), href)
        check('list: only one data call (rpc list) and no table reads of bookings', [x.split(':')[0] for x in await rpcs(p) if x.startswith('local_booking')] == ['local_booking_list'] and 'bookings' not in await p.evaluate('window.__tables'))
        check('list: Bookings is the current nav item', await p.locator('.co-nav a[aria-current=page]').inner_text() == 'Bookings')
        check('list: no buttons that change anything on the cards', await p.locator('#coBkList button, #coBkList form').count() == 0)
        await p.screenshot(path=OUT + '/bookings-list-1440.png', full_page=True)
        await p.click('#coBkTabs button:nth-child(2)'); await p.wait_for_timeout(100)
        check('list: Waiting tab shows 3', await p.locator('#coBkList li').count() == 3)
        txt = await p.locator('#coBkList').inner_text()
        check('list: approved + unpaid waits for the customer to pay; paid is under way', 'Waiting for the customer to pay' in txt and 'under way' in txt)
        await p.click('#coBkTabs button:nth-child(3)'); await p.wait_for_timeout(100)
        check('list: Problems tab shows disputed and frozen bookings', await p.locator('#coBkList li').count() == 2 and 'problem report is open' in await p.locator('#coBkList').inner_text())
        await p.click('#coBkTabs button:nth-child(4)'); await p.wait_for_timeout(100)
        check('list: Closed tab shows the completed booking', await p.locator('#coBkList li').count() == 1 and 'completed' in (await p.locator('#coBkList').inner_text()).lower())
        await p.fill('#coBkSearch', 'job 6'); await p.wait_for_timeout(100)
        check('list: search looks across tabs', await p.locator('#coBkList li').count() == 1 and 'Job 6' in await p.locator('#coBkList').inner_text())
        await p.fill('#coBkSearch', 'zzzz'); await p.wait_for_timeout(100)
        check('list: no match message', await p.is_visible('#coBkNoMatch') and 'No match' in await p.inner_text('#coBkNoMatchTitle'))
        await p.fill('#coBkSearch', ''); await p.wait_for_timeout(100)
        check('list: clearing the search returns to the tab', await p.locator('#coBkList li').count() == 1)
        check('list: no page errors', not errs, errs); await ctx.close()

        # ---------- list, mobile
        ctx, p, errs = await newpage(b, scn(), 390, 844)
        await p.goto(BASE + 'coordinator-bookings.html'); await p.wait_for_selector('#coBkList li', timeout=8000)
        ov = await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        check('list mobile: no sideways scroll at 390', ov)
        check('list mobile: bottom bar Bookings item is current', 'Bookings' in await p.locator('.co-bn-item[aria-current=page]').inner_text())
        await p.screenshot(path=OUT + '/bookings-list-390.png', full_page=True); await ctx.close()

        # ---------- list: empty, error, retry, only-closed
        ctx, p, errs = await newpage(b, scn(list=[]))
        await p.goto(BASE + 'coordinator-bookings.html'); await p.wait_for_selector('#coBkEmpty:not([hidden])', timeout=8000)
        check('list: empty state, no toolbar', await p.is_hidden('#coBkToolbar') and 'No bookings yet' in await p.inner_text('#coBkEmpty'))
        await ctx.close()
        ctx, p, errs = await newpage(b, scn(fail={'list': True}))
        await p.goto(BASE + 'coordinator-bookings.html'); await p.wait_for_selector('#coBkError:not([hidden])', timeout=8000)
        check('list: error banner with retry, no crash', await p.is_visible('#coBkRetry') and await p.is_hidden('#coBkList'))
        await p.evaluate('window.__SC.fail = {}'); await p.click('#coBkRetry'); await p.wait_for_selector('#coBkList li', timeout=5000)
        check('list: retry loads the bookings', await p.locator('#coBkList li').count() == 5); await ctx.close()
        ctx, p, errs = await newpage(b, scn(list=[row(8, 'quote_approved', bs='completed', open_=False)]))
        await p.goto(BASE + 'coordinator-bookings.html'); await p.wait_for_selector('#coBkToolbar:not([hidden])', timeout=8000)
        check('list: with only closed bookings it opens on Closed and says nothing needs action',
              'is-active' in (await p.locator('#coBkTabs button').nth(3).get_attribute('class')) and 'Nothing needs your action' in await p.inner_text('#coBkSummary')); await ctx.close()

        # ---------- detail, desktop
        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'coordinator-booking.html?id=' + uid(1)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000)
        body = await p.inner_text('#coBd')
        check('detail: title, status and next step', await p.inner_text('#coBdTitle') == '<b>Fix wardrobe</b>' and 'New booking' in await p.inner_text('#coBdStatus') and 'Contact the Local Tasker' in await p.inner_text('#coBdNext'))
        check('detail: job facts (details, place, category, when)', 'Door off hinge' in body and 'Yaba' in body and 'carpentry' in body and 'Sat 2 Nov' in body)
        check('detail: customer name as text (no HTML) and a tel link for the phone', 'Ada <i>Obi</i>' in body and await p.locator('#coBdCust a[href^="tel:"]').get_attribute('href') == 'tel:+2348010001111')
        check('detail: injected markup in notes did not run', await p.evaluate('window.__xss') is None and await p.locator('#coBd img').count() == 0)
        check('detail: Local Tasker profile link', await p.locator('#coBdTasker a').get_attribute('href') == 'coordinator-tasker.html?id=' + LT)
        check('detail: payment is read only, no inputs or action buttons on the page', await p.locator('#coBd input, #coBd select, #coBd textarea, #coBd button').count() == 0 and 'can’t change them' in body.replace("can't", 'can’t') or 'change them' in body)
        check('detail: no release code / completion code wording or values', 'completion' not in body.lower() and 'release code' not in body.lower())
        hist = await p.locator('#coBdHist li').all_inner_texts()
        check('detail: history newest first with note', len(hist) == 2 and 'Waiting for the Local Tasker' in hist[0] and 'Called him' in hist[0] and 'Booking assigned to you' in hist[1], hist)
        rp = await rpcs(p)
        check('detail: exactly one detail call with the id from the URL', [x for x in rp if x.startswith('local_booking_detail')] == ['local_booking_detail:' + json.dumps({'p_booking': uid(1)}, separators=(',', ':'))], rp)
        await p.screenshot(path=OUT + '/booking-detail-1440.png', full_page=True)
        check('detail: no page errors', not errs, errs); await ctx.close()
        # closed booking
        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'coordinator-booking.html?id=' + uid(8)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000)
        body = await p.inner_text('#coBd')
        check('detail closed: next step says closed, phone hidden, empty history message, service name used', 'Nothing more to do' in await p.inner_text('#coBdNext') and 'Hidden once a booking is closed' in body and await p.is_visible('#coBdHistEmpty') and await p.inner_text('#coBdTitle') == 'Wardrobe repair')
        await ctx.close()
        # another coordinator's / unknown / invalid id
        for label, url in [('not mine or unknown id', 'coordinator-booking.html?id=' + uid(99)), ('malformed id', 'coordinator-booking.html?id=abc'), ('missing id', 'coordinator-booking.html')]:
            ctx, p, errs = await newpage(b, scn())
            await p.goto(BASE + url); await p.wait_for_selector('#coBdMissing:not([hidden])', timeout=8000)
            rp = [x for x in await rpcs(p) if x.startswith('local_booking_detail')]
            check('detail: ' + label + ' shows "Booking not found" and reveals nothing', await p.is_hidden('#coBd') and 'not found' in await p.inner_text('#coBdMissing') and (len(rp) == 1 if label.startswith('not mine') else len(rp) == 0), rp)
            await ctx.close()
        ctx, p, errs = await newpage(b, scn(fail={'detail': True}))
        await p.goto(BASE + 'coordinator-booking.html?id=' + uid(1)); await p.wait_for_selector('#coBdError:not([hidden])', timeout=8000)
        check('detail: server error shows retry banner (not "not found")', await p.is_hidden('#coBdMissing'))
        await p.evaluate('window.__SC.fail = {}'); await p.click('#coBdRetry'); await p.wait_for_selector('#coBd:not([hidden])', timeout=5000)
        check('detail: retry works', True); await ctx.close()
        # mobile
        ctx, p, errs = await newpage(b, scn(), 390, 844)
        await p.goto(BASE + 'coordinator-booking.html?id=' + uid(1)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000)
        check('detail mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        await p.screenshot(path=OUT + '/booking-detail-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('TOTAL', len(results), 'FAILED', len(bad)); [print('  FAILED:', n) for n in bad]
asyncio.run(main())

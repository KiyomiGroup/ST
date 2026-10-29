import asyncio, json, http.server, threading, functools, os
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8775), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, 'fake-coordinator-supabase.js')).read()
BASE = 'http://127.0.0.1:8775/'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra else ''))
def uid(n): return '00000000-0000-4000-8000-%012d' % n
LT = '44444444-4444-4444-8444-444444444444'
def det(n, lt, bs='pending', open_=True):
    return {'booking_id': uid(n), 'lt_status': lt, 'booking_status': bs, 'work_stage': None, 'payment_status': 'unpaid', 'amount': None, 'scheduled_time': 'Sat 2 Nov, 10:00',
            'created_at': '2026-10-27T10:01:00Z', 'notes': 'Door off hinge', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': None,
            'task': {'title': 'Fix wardrobe'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': False, 'open': open_, 'allowed_next': [], 'events': []}
def sc(**k):
    s = {'detail': {uid(1): det(1, 'quote_approved'), uid(2): det(2, 'assigned'), uid(3): det(3, 'quote_approved', bs='completed', open_=False)}, 'quote': {}, 'conf': {}}
    s.update(k); return s
async def page(b, scn, w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'paystack' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(scn) + ';')
    return ctx, p, errs
async def goto(p, n):
    await p.goto(BASE + 'coordinator-booking.html?id=' + uid(n)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000); await p.wait_for_timeout(400)
async def calls(p, k): return await p.evaluate('window.__%s || []' % k)
async def fill(p, kind='materials', amount='5,000', how='phone_call', sure=True):
    await p.select_option('#coXtKind', kind); await p.fill('#coXtAmount', amount); await p.fill('#coXtTitleIn', '<b>Pipes</b>')
    await p.fill('#coXtDetails', 'Two extra pipes needed'); await p.select_option('#coXtHow', how)
    if sure: await p.check('#coXtSure')

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx, p, errs = await page(b, sc()); await goto(p, 1)
        check('card and form show on an approved booking', await p.is_visible('#coXt') and await p.is_visible('#coXtForm'))
        check('the old 5D-3a card is still there (no id clash)', await p.evaluate("document.querySelectorAll('#coEx').length") == 1 and await p.evaluate("document.querySelectorAll('[id]').length - new Set([...document.querySelectorAll('[id]')].map(e=>e.id)).size") == 0)
        check('the room left is shown', '30,000' in await p.inner_text('#coXtAmountHelp'))
        await p.screenshot(path=OUT + '/coordinator-extras-1440.png', full_page=True)
        await p.click('#coXtSubmit'); await p.wait_for_timeout(300)
        check('empty submit stopped on screen, no call', not await calls(p, 'extra') and await p.is_visible('#coXtKindErr'))
        await fill(p, amount='50'); await p.click('#coXtSubmit'); await p.wait_for_timeout(300)
        check('amount under 100 stopped, no call', not await calls(p, 'extra') and await p.is_visible('#coXtAmountErr'))
        await fill(p, amount='31000'); await p.click('#coXtSubmit'); await p.wait_for_timeout(300)
        check('amount above the room left stopped, no call', not await calls(p, 'extra') and 'still allowed' in await p.inner_text('#coXtAmountErr'))
        await fill(p, how='', sure=True); await p.select_option('#coXtHow', ''); await p.click('#coXtSubmit'); await p.wait_for_timeout(300)
        check('no confirmation method stopped, no call', not await calls(p, 'extra') and await p.is_visible('#coXtHowErr'))
        await p.select_option('#coXtHow', 'phone_call'); await p.uncheck('#coXtSure'); await p.click('#coXtSubmit'); await p.wait_for_timeout(300)
        check('unticked confirmation stopped, no call', not await calls(p, 'extra') and await p.is_visible('#coXtSureErr'))
        await p.check('#coXtSure'); await p.click('#coXtSubmit'); await p.wait_for_timeout(600)
        c = await calls(p, 'extra')
        check('exact call arguments', len(c) == 1 and c[0]['p_booking'] == uid(1) and len(c[0]['p_request_id']) == 36 and c[0]['p_kind'] == 'materials' and c[0]['p_amount'] == 5000
              and c[0]['p_title'] == '<b>Pipes</b>' and c[0]['p_how'] == 'phone_call' and set(c[0]) == {'p_booking', 'p_request_id', 'p_kind', 'p_amount', 'p_title', 'p_details', 'p_how'}, c)
        check('the new request is listed as text (not HTML) and the form hides while one waits', '<b>Pipes</b>' in await p.inner_text('#coXtList') and await p.evaluate("document.querySelectorAll('#coXtList b').length") == 0 and not await p.is_visible('#coXtForm'))
        check('status wording and withdraw button shown', 'Waiting for the customer' in await p.inner_text('#coXtList') and await p.is_visible('#coXtList button'))
        await p.screenshot(path=OUT + '/coordinator-extras-waiting-1440.png', full_page=True)
        await p.click('#coXtList button'); await p.wait_for_timeout(600)
        check('withdraw sends booking and extra id; the form comes back', len(await calls(p, 'unextra')) == 1 and await p.is_visible('#coXtForm') and 'Withdrawn' in await p.inner_text('#coXtList'))
        check('no payment, escrow, release, wallet, cancel or dispute rpc was called', not any(x.split(':')[0] in ('job_cancel', 'open_job_dispute', 'local_booking_cancel', 'local_booking_open_problem') or 'escrow' in x or 'wallet' in x or 'release' in x for x in await p.evaluate('window.__rpc')))
        check('no page errors', not errs, errs); await ctx.close()

        # refusals reload the card and speak plainly
        ctx, p, errs = await page(b, sc(ex={uid(1): {'can_request': True, 'blocked': None, 'room': 30000, 'items': []}}, fail={'extra': [{'hint': 'one_waiting', 'message': 'x'}]})); await goto(p, 1)
        await fill(p); await p.click('#coXtSubmit'); await p.wait_for_timeout(600)
        check('server refusal shows plain words', 'still waiting for the customer' in await p.inner_text('#coXtErrorText'))
        await ctx.close()

        # not approved: lead explains, no form
        ctx, p, errs = await page(b, sc(ex={uid(2): {'can_request': False, 'blocked': 'not_approved', 'room': 0, 'items': []}})); await goto(p, 2)
        check('before approval: no card at all (the quote card is the place to change things)', not await p.is_visible('#coXt'))
        await ctx.close()
        # closed booking with nothing recorded: card hidden
        ctx, p, errs = await page(b, sc(ex={uid(3): {'can_request': False, 'blocked': 'booking_closed', 'room': 0, 'items': []}})); await goto(p, 3)
        check('closed booking with nothing recorded: no card', not await p.is_visible('#coXt')); await ctx.close()
        # load failure leaves the page working
        ctx, p, errs = await page(b, sc(fail={'ex': True})); await goto(p, 1)
        check('load failure: message shown, the rest of the page works', await p.is_visible('#coXt') and not await p.is_visible('#coXtForm') and await p.is_visible('#coBd')); await ctx.close()
        # mobile
        ctx, p, errs = await page(b, sc(), w=390, h=844); await goto(p, 1)
        sw = await p.evaluate('document.documentElement.scrollWidth')
        check('390 wide: no sideways scroll', sw <= 391, sw)
        bh = await p.evaluate("document.getElementById('coXtSubmit').getBoundingClientRect().height")
        check('submit button at least 44px tall', bh >= 44, bh)
        await p.screenshot(path=OUT + '/coordinator-extras-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\n%d PASS, %d FAIL' % (len(results) - len(bad), len(bad))); raise SystemExit(1 if bad else 0)
asyncio.run(main())

# Browser tests for the "Release the payment" card (Stage 7C-1c). MOCKED Supabase (no real database, no real payment).
# Run from the repo root:  ST_REPO_ROOT=. ST_SHOTS=docs/local-tasker/tests/stage-7c1c/shots python3 docs/local-tasker/tests/stage-7c1c/run-7c1c.py
import asyncio, json, http.server, threading, functools, os
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8776), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, 'base-fake.js')).read() + '\n' + open(os.path.join(HERE, 'fake-7c1c.js')).read()
BASE = 'http://127.0.0.1:8776/'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra else ''))
def uid(n): return '00000000-0000-4000-8000-%012d' % n
LT = '44444444-4444-4444-8444-444444444444'
def det(n, pay='paid', bs='confirmed', open_=True, frozen=False):
    return {'booking_id': uid(n), 'lt_status': 'quote_approved', 'booking_status': bs, 'work_stage': None, 'payment_status': pay, 'amount': 50000, 'scheduled_time': 'Sat 2 Nov, 10:00',
            'created_at': '2026-10-27T10:01:00Z', 'notes': 'Door off hinge', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': None,
            'task': {'title': 'Fix wardrobe'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': frozen, 'open': open_, 'allowed_next': [], 'events': []}
def sc(**k):
    s = {'detail': {uid(i): det(i) for i in range(1, 9)}, 'quote': {}, 'conf': {}, 'co': {},
         'rel': {uid(1): {'state': 'ready', 'remaining': 3, 'code': '482913'}, uid(2): {'state': 'not_paid', 'remaining': 3, 'code': '111222'},
                 uid(3): {'state': 'locked', 'remaining': 0, 'code': '333444'}, uid(4): {'state': 'frozen', 'remaining': 3, 'code': '555666'},
                 uid(5): {'state': 'released', 'remaining': 3, 'code': '777888'}, uid(6): {'state': 'closed', 'remaining': 3, 'code': '999000'},
                 uid(7): {'state': 'consent_revoked', 'remaining': 3, 'code': '121212'}, uid(8): {'state': 'ready', 'remaining': 1, 'code': '343434', 'start': 1}}}
    s.update(k); return s
async def newpage(b, scn, w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'paystack' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(scn) + ';')
    return ctx, p, errs
async def goto(p, n):
    await p.goto(BASE + 'coordinator-booking.html?id=' + uid(n)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000); await p.wait_for_timeout(500)
async def ev(p, js): return await p.evaluate(js)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()

        # ---- ready: layout, text, validation, wrong codes, success ----
        ctx, p, errs = await newpage(b, sc()); await goto(p, 1)
        check('ready: the card and the code field show, the card says what to do', await p.is_visible('#coRl') and await p.is_visible('#coRlCode') and 'ask them for their release code' in await p.inner_text('#coRlLead'))
        check('ready: 3 attempts, so no "attempts left" line yet', not await p.is_visible('#coRlAttempts'))
        check('ready: the card tells the coordinator three wrong codes lock the booking and it can\u2019t be undone', 'three attempts' in await p.inner_text('#coRlFoot') and 'can\u2019t be undone' in await p.inner_text('#coRlFoot'))
        check('the field has a label, numeric keypad, no autofill', await p.get_attribute('#coRlCode', 'inputmode') == 'numeric' and await p.get_attribute('#coRlCode', 'autocomplete') == 'off' and 'release code' in await p.inner_text('label[for=coRlCode]'))
        check('the read call asked about this booking only', await ev(p, 'window.__state.length') >= 1 and await ev(p, 'window.__state[0].p_booking') == uid(1))
        await p.screenshot(path=OUT + '/release-ready-1440.png', full_page=True)
        await p.fill('#coRlCode', '12ab 3x'); await p.wait_for_timeout(100)
        check('letters and spaces are dropped as you type', await p.input_value('#coRlCode') == '123')
        await p.fill('#coRlCode', '1234567890'); await p.wait_for_timeout(100)
        check('more than 6 digits are cut to 6', await p.input_value('#coRlCode') == '123456')
        await p.fill('#coRlCode', '12ab 3x'); await p.wait_for_timeout(100)
        await p.click('#coRlSubmit'); await p.wait_for_timeout(300)
        check('5 or fewer digits: stopped on screen, NOTHING sent (no attempt can be wasted on a typo)', await ev(p, 'window.__submit.length') == 0 and await p.is_visible('#coRlCodeErr') and 'Nothing was sent' in await p.inner_text('#coRlCodeErr'))
        await p.fill('#coRlCode', ''); await p.click('#coRlSubmit'); await p.wait_for_timeout(300)
        check('empty: stopped on screen, nothing sent', await ev(p, 'window.__submit.length') == 0)
        await p.fill('#coRlCode', '000000'); await p.click('#coRlSubmit'); await p.wait_for_timeout(500)
        sub = await ev(p, 'window.__submit')
        check('a wrong code sends exactly booking and code', len(sub) == 1 and sub[0] == {'p_booking': uid(1), 'p_code': '000000'}, sub)
        check('wrong code: the field is emptied, the message says 2 attempts left, the card shows it too', await p.input_value('#coRlCode') == '' and '2 attempts left' in await p.inner_text('#coRlErrorText') and '2 attempts left' in await p.inner_text('#coRlAttempts'))
        check('wrong code: the field is flagged and focused for the next try', await p.get_attribute('#coRlCode', 'aria-invalid') == 'true' and await ev(p, 'document.activeElement.id') == 'coRlCode')
        await p.fill('#coRlCode', '111111'); await p.click('#coRlSubmit'); await p.wait_for_timeout(500)
        check('second wrong code: last attempt warning', 'Last attempt' in await p.inner_text('#coRlAttempts') and '1 attempt left' in await p.inner_text('#coRlErrorText'))
        await p.screenshot(path=OUT + '/release-last-attempt-1440.png', full_page=True)
        await p.fill('#coRlCode', '482 913'); await p.click('#coRlSubmit'); await p.wait_for_timeout(900)
        sub = await ev(p, 'window.__submit')
        check('the right code (typed with a space) is sent as 6 digits, once', len(sub) == 3 and sub[2]['p_code'] == '482913')
        check('success: the form is gone and the released message shows', not await p.is_visible('#coRlForm') and await p.is_visible('#coRlDone') and 'payment has been released' in await p.inner_text('#coRlDoneText'))
        check('success: the page reloaded the booking (detail read at least twice)', sum(1 for r in await ev(p, 'window.__rpc') if r.startswith('local_booking_detail')) >= 2)
        check('success: the page now shows the booking as completed', 'Completed' in await p.inner_text('#coBdJob') or 'completed' in (await p.inner_text('#coBdNext')).lower())
        html = await p.content()
        check('the real code is nowhere on the page, in storage or in the address bar', '482913' not in html and '482913' not in await ev(p, 'JSON.stringify([localStorage, sessionStorage])') and '482913' not in p.url)
        rp = await ev(p, 'window.__rpc')
        names = [r.split(':')[0] for r in rp]
        check('only the read and submit functions touch release; no payment, payout, wallet or escrow call', not any(any(w in n for w in ('payout', 'wallet', 'escrow', 'payment', 'unlock')) for n in names), names)
        check('the page crashed nowhere', not errs, errs); await ctx.close()

        # ---- 3 wrong codes lock; the card then shows the locked state and no field ----
        ctx, p, errs = await newpage(b, sc()); await goto(p, 1)
        for c in ('100000', '200000', '300000'):
            await p.fill('#coRlCode', c)
            if await p.is_visible('#coRlCode'): await p.click('#coRlSubmit'); await p.wait_for_timeout(450)
        check('after the third wrong code the field is gone and the card says locked', not await p.is_visible('#coRlForm') and 'locked' in await p.inner_text('#coRlLead') and 'No attempts are left' in await p.inner_text('#coRlErrorText'))
        check('locked: exactly 3 codes were sent, no 4th', len(await ev(p, 'window.__submit')) == 3)
        await ctx.close()

        # ---- one attempt left when the page opens (booking start=1 attempt) ----
        ctx, p, errs = await newpage(b, sc()); await goto(p, 8)
        check('opening with 1 attempt left warns before the first try', 'Last attempt' in await p.inner_text('#coRlAttempts') and await p.is_visible('#coRlCode'))
        await ctx.close()

        # ---- each state on open ----
        for n, st, field, text in ((3, 'locked', False, 'locked'), (4, 'frozen', False, 'problem report is open'), (5, 'released', False, None), (7, 'consent_revoked', False, 'withdrawn their consent')):
            ctx, p, errs = await newpage(b, sc()); await goto(p, n)
            check(st + ': card visible, no code field', await p.is_visible('#coRl') and not await p.is_visible('#coRlForm') and not await p.is_visible('#coRlCode'))
            if text: check(st + ': says why', text in await p.inner_text('#coRlLead'), await p.inner_text('#coRlLead'))
            if st == 'released': check('released: says the payment was released and what happens next, without claiming it was already paid out', await p.is_visible('#coRlDone') and 'bank account' in await p.inner_text('#coRlDoneText') and 'has been paid' not in await p.inner_text('#coRlDoneText') and not await p.is_visible('#coRlFoot'))
            if st == 'locked': await p.screenshot(path=OUT + '/release-locked-1440.png', full_page=True)
            check(st + ': nothing was sent on open', await ev(p, 'window.__submit.length') == 0)
            await ctx.close()
        for n, st in ((2, 'not_paid'), (6, 'closed')):
            ctx, p, errs = await newpage(b, sc()); await goto(p, n)
            check(st + ': the card stays hidden', not await p.is_visible('#coRl')); await ctx.close()

        # ---- refusals that arrive as a result: the card re-reads the truth ----
        s = sc(); ctx, p, errs = await newpage(b, s); await goto(p, 1)
        await p.evaluate("window.__SC.rel['%s'].state='frozen'" % uid(1))     # a problem report is opened elsewhere while the page is open
        await p.fill('#coRlCode', '482913'); await p.click('#coRlSubmit'); await p.wait_for_timeout(600)
        check('frozen elsewhere: the right code is refused, the card now shows frozen, the field is gone', not await p.is_visible('#coRlForm') and 'problem report is open' in await p.inner_text('#coRlLead') and 'can\u2019t be released now' in await p.inner_text('#coRlErrorText'))
        await ctx.close()

        # ---- SQL not installed yet ----
        s2 = sc(); ctx, p, errs = await newpage(b, s2)
        await p.add_init_script("(function(){var t=setInterval(function(){if(window.supabase&&window.supabase.createClient&&!window.__w){window.__w=1;var c=window.supabase.createClient;window.supabase.createClient=function(){var k=c.apply(this,arguments),r=k.rpc;k.rpc=async function(n,a){if(n==='local_booking_code_state')return{data:null,error:{code:'PGRST202',message:'Could not find the function'}};return r.call(k,n,a);};return k;};clearInterval(t);}},1);})();")
        await goto(p, 1)
        check('function not installed yet: the card stays hidden, no error banner, the rest of the page works', not await p.is_visible('#coRl') and await p.is_visible('#coBd') and not errs, errs); await ctx.close()

        # ---- failures ----
        ctx, p, errs = await newpage(b, sc(fail={'state': True})); await goto(p, 1)
        check('if the state can\u2019t be read the field is NOT offered and the card says so', await p.is_visible('#coRl') and not await p.is_visible('#coRlForm') and 'couldn\u2019t load this card' in await p.inner_text('#coRlErrorText'))
        await ctx.close()
        for mode, expect in (('throw', 'couldn\u2019t confirm'), ('error', 'couldn\u2019t confirm')):
            ctx, p, errs = await newpage(b, sc(fail={'submit': mode})); await goto(p, 1)
            await p.fill('#coRlCode', '482913'); await p.click('#coRlSubmit'); await p.wait_for_timeout(600)
            check('submit ' + mode + ': the field is emptied, the card re-read the state and says it could not confirm', await p.input_value('#coRlCode') == '' and expect in await p.inner_text('#coRlErrorText') and len(await ev(p, 'window.__state')) >= 2, await p.inner_text('#coRlErrorText'))
            check('submit ' + mode + ': the page crashed nowhere', not errs, errs); await ctx.close()
        ctx, p, errs = await newpage(b, sc(fail={'submit': 'hint:not_found'})); await goto(p, 1)
        await p.fill('#coRlCode', '482913'); await p.click('#coRlSubmit'); await p.wait_for_timeout(500)
        check('not_found on submit: says the booking is no longer yours and hides the field', 'no longer yours' in await p.inner_text('#coRlErrorText') and not await p.is_visible('#coRlForm')); await ctx.close()

        # ---- double click sends once ----
        ctx, p, errs = await newpage(b, sc()); await goto(p, 1)
        await p.fill('#coRlCode', '000000')
        await p.evaluate("(function(){var b=document.getElementById('coRlSubmit');b.click();b.click();})()"); await p.wait_for_timeout(600)
        check('a double click sends the code once', await ev(p, 'window.__submit.length') == 1); await ctx.close()

        # ---- other coordinator's booking ----
        ctx, p, errs = await newpage(b, sc(rel={})); await goto(p, 1)
        check('a booking the database says is not yours: no code field', not await p.is_visible('#coRlForm')); await ctx.close()

        # ---- mobile ----
        ctx, p, errs = await newpage(b, sc(), 390, 844); await goto(p, 1)
        check('390px: no sideways scrolling', await ev(p, 'document.documentElement.scrollWidth <= window.innerWidth'))
        box = await p.locator('#coRlSubmit').bounding_box(); check('390px: the button is at least 44px tall', box and box['height'] >= 44, box)
        ibox = await p.locator('#coRlCode').bounding_box(); check('390px: the field fits inside the card', ibox and ibox['x'] >= 0 and ibox['x'] + ibox['width'] <= 390, ibox)
        await p.locator('#coRl').scroll_into_view_if_needed(); await p.screenshot(path=OUT + '/release-ready-390.png', full_page=True)
        await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\n%d checks, %d failed' % (len(results), len(bad)))
    raise SystemExit(1 if bad else 0)
asyncio.run(main())

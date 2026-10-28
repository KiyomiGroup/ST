import asyncio, json, http.server, threading, functools, os, copy, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8769), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake-bookings-supabase.js')).read()
BASE = 'http://127.0.0.1:8769/'
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
def det(n, lt, bs='pending', open_=True, frozen=False):
    return {'booking_id': uid(n), 'lt_status': lt, 'booking_status': bs, 'work_stage': None, 'payment_status': 'unpaid', 'amount': None, 'scheduled_time': 'Sat 2 Nov, 10:00',
            'created_at': '2026-10-27T10:01:00Z', 'notes': 'Door off hinge', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': None,
            'task': {'title': 'Fix wardrobe'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': frozen, 'open': open_, 'allowed_next': [], 'events': []}
CONF = {'service_fee': 12500, 'transport_amount': 1500, 'materials_amount': 3000, 'materials_notes': 'Hinges', 'second_check_status': 'off'}
def cur(ver=1, tr=1500, ma=3000, ot=0, label=None):
    lines = [{'sort': 1, 'key': 'service_fee', 'label': 'Service fee (the Local Tasker’s price)', 'amount': 12500}]
    if tr: lines.append({'sort': 2, 'key': 'transport', 'label': 'Transport', 'amount': tr})
    if ma: lines.append({'sort': 3, 'key': 'materials', 'label': 'Materials', 'amount': ma})
    if ot: lines.append({'sort': 4, 'key': 'other', 'label': label, 'amount': ot})
    return {'version': ver, 'service_fee': 12500, 'transport_amount': tr, 'materials_amount': ma, 'other_amount': ot, 'other_label': label, 'total': 12500 + tr + ma + ot, 'created_at': '2026-10-28T08:00:00Z', 'lines': lines}
def scn(**k):
    s = {'detail': {uid(1): det(1, 'tasker_confirmed'), uid(2): det(2, 'quote_sent'), uid(3): det(3, 'quote_declined'), uid(4): det(4, 'quote_approved'), uid(5): det(5, 'awaiting_tasker_confirmation'),
                    uid(6): det(6, 'tasker_confirmed'), uid(7): det(7, 'quote_sent', bs='cancelled', open_=False), uid(8): det(8, 'tasker_confirmed'), uid(9): det(9, 'tasker_confirmed', frozen=True)},
         'quote': {uid(1): {'confirmed': dict(CONF), 'current': None, 'history': []},
                   uid(2): {'confirmed': dict(CONF), 'current': cur(2, ot=1000, label='Parking <b>fee</b>'), 'history': [{'version': 2, 'total': 17000, 'superseded': False, 'created_at': '2026-10-28T08:00:00Z'}, {'version': 1, 'total': 20000, 'superseded': True, 'created_at': '2026-10-28T07:00:00Z'}]},
                   uid(3): {'confirmed': dict(CONF), 'current': cur(1, ot=1000, label='Parking fee'), 'history': [{'version': 1, 'total': 18000, 'superseded': False, 'created_at': '2026-10-28T07:00:00Z'}]},
                   uid(4): {'confirmed': dict(CONF), 'current': cur(1), 'history': []},
                   uid(6): {'confirmed': dict(CONF, second_check_status='requested'), 'current': None, 'history': []},
                   uid(7): {'confirmed': dict(CONF), 'current': cur(1), 'history': []},
                   uid(8): {'confirmed': dict(CONF, transport_amount=0, materials_amount=0, materials_notes=None), 'current': None, 'history': []},
                   uid(9): {'confirmed': dict(CONF), 'current': None, 'history': []}}}
    s.update(k); return s
async def rpcs(p): return await p.evaluate('window.__rpc')
async def goto(p, n):
    await p.goto(BASE + 'coordinator-booking.html?id=' + uid(n)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000); await p.wait_for_timeout(300)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 1)
        check('builder: card and form shown after the tasker confirmed', await p.is_visible('#coQt') and await p.is_visible('#coQtForm') and await p.is_hidden('#coQtSummary'))
        check('builder: service fee is shown as fixed text, not an input', '₦12,500' in await p.inner_text('#coQtFixed') and 'set by the Local Tasker' in await p.evaluate("getComputedStyle(document.querySelector('#coQtFixed dd'),'::after').content") and await p.locator('#coQtForm input[id*=Fee], #coQtForm input[id*=fee], #coQtForm input[id*=Service]').count() == 0 and "can’t change it here" in await p.inner_text('#coQtFixedNote'))
        check('builder: transport and materials prefilled with what the tasker said; total preview', await p.input_value('#coQtTransport') == '1500' and await p.input_value('#coQtMaterials') == '3000' and '₦17,000' in await p.inner_text('#coQtTotal'))
        check('builder: helper says lower, never raise', 'not raise it' in await p.inner_text('#coQtTransportHelp') and 'Hinges' in await p.inner_text('#coQtMaterialsHelp'))
        await p.fill('#coQtTransport', '2000'); await p.click('#coQtSend')
        check('builder: transport above the ceiling is refused in the page, no call', 'more than' in await p.inner_text('#coQtTransportErr') and not any(x.startswith('local_booking_send_quote') for x in await rpcs(p)))
        await p.fill('#coQtTransport', '50'); await p.click('#coQtSend')
        check('builder: transport under ₦100 refused', 'at least' in await p.inner_text('#coQtTransportErr'))
        await p.fill('#coQtTransport', '1000'); await p.fill('#coQtOther', '1000'); await p.click('#coQtSend')
        check('builder: another cost needs a label', 'what this cost is for' in await p.inner_text('#coQtOtherLabelErr') and not any(x.startswith('local_booking_send_quote') for x in await rpcs(p)))
        await p.fill('#coQtOther', '20000'); await p.fill('#coQtOtherLabel', 'Parking'); await p.click('#coQtSend')
        check('builder: another cost above the service fee refused', 'service fee' in await p.inner_text('#coQtOtherErr'))
        await p.fill('#coQtOther', '1000')
        check('builder: total preview follows the inputs (12500 + 1000 + 3000 + 1000)', '₦17,500' in await p.inner_text('#coQtTotal'))
        await p.screenshot(path=OUT + '/quote-form-1440.png', full_page=True)
        await p.click('#coQtSend'); await p.wait_for_selector('#coQtSummary:not([hidden])', timeout=5000); await p.wait_for_timeout(200)
        sv = (await p.evaluate('window.__sent'))[0]
        check('send: exact arguments, a uuid request id, no service fee argument', sv['p_transport'] == 1000 and sv['p_materials'] == 3000 and sv['p_other'] == 1000 and sv['p_other_label'] == 'Parking'
              and re.match(r'^[0-9a-f-]{36}$', sv['p_request_id']) and set(sv.keys()) == {'p_booking', 'p_request_id', 'p_transport', 'p_materials', 'p_other', 'p_other_label', 'p_other_note', 'p_note'}, sv)
        t = await p.inner_text('#coQtLines')
        check('after send: page reloaded, status Quote sent, summary lists the lines and total', 'Quote sent' in await p.inner_text('#coBdStatus') and '₦12,500' in t and '₦1,000' in t and '₦3,000' in t and '₦17,500' in t, t.replace('\n', ' | '))
        check('after send: form gone and no input can change a quote', await p.is_hidden('#coQtForm') and await p.locator('#coQtSummary input, #coQtSummary textarea, #coQtSummary button').count() == 0)
        check('after send: says waiting for the customer', 'Waiting for the customer' in await p.inner_text('#coQtStatusNote'))
        check('no page errors', not errs, errs); await ctx.close()

        for hint, msg, expect in [('exceeds_confirmed', 'Transport and materials can’t be more than the Local Tasker confirmed.', 'can’t be more'), ('second_check_pending', 'An administrator call-back is still needed.', 'call-back'),
                                  ('invalid_transition', 'x', 'Reload the page'), ('booking_closed', 'x', 'closed'), (None, 'FATAL relation x', 'couldn’t send')]:
            ctx, p, errs = await newpage(b, scn(fail={'send': {'hint': hint, 'message': msg}})); await goto(p, 1)
            await p.click('#coQtSend'); await p.wait_for_selector('#coQtError:not([hidden])', timeout=4000)
            tx = await p.inner_text('#coQtErrorText')
            check('error ' + str(hint) + ': plain sentence, form kept, never raw database text', expect in tx and 'FATAL' not in tx and 'relation' not in tx and await p.is_visible('#coQtForm') and await p.is_enabled('#coQtSend'), tx)
            if hint == 'exceeds_confirmed':
                await p.evaluate('window.__SC.fail = {}'); await p.click('#coQtSend'); await p.wait_for_selector('#coQtSummary:not([hidden])', timeout=5000)
                s2 = await p.evaluate('window.__sent'); check('retry: same request id sent again', len(s2) == 2 and s2[0]['p_request_id'] == s2[1]['p_request_id'])
            await ctx.close()

        ctx, p, errs = await newpage(b, scn()); await goto(p, 2)
        check('quote sent: summary with lines, total and earlier versions; label text not HTML',
              await p.is_visible('#coQtSummary') and await p.is_hidden('#coQtForm') and 'parking <b>fee</b>' in (await p.inner_text('#coQtLines')).lower() and await p.locator('#coQt b').count() == 0
              and 'Version 1' in await p.inner_text('#coQtHist') and 'replaced' in await p.inner_text('#coQtHist'))
        check('quote sent: says to record a new answer to change the price', 'record a new answer' in await p.inner_text('#coQtStatusNote'))
        await p.screenshot(path=OUT + '/quote-summary-1440.png', full_page=True); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 3)
        check('declined: form shown again, prefilled from the old quote including the other cost, lead explains', await p.is_visible('#coQtForm') and await p.input_value('#coQtOther') == '1000' and await p.input_value('#coQtOtherLabel') == 'Parking fee' and 'declined' in await p.inner_text('#coQtLead'))
        check('declined: next-step note points to the quote card', 'The quote' in await p.inner_text('#coBdNextNote')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 4)
        check('approved: summary only, says approved', await p.is_visible('#coQtSummary') and await p.is_hidden('#coQtForm') and 'approved' in await p.inner_text('#coQtStatusNote')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 5)
        check('waiting for the tasker: no quote card and no quote call', await p.is_hidden('#coQt') and not any(x.startswith('local_booking_quote') for x in await rpcs(p))); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 6)
        check('second check pending: no form, plain reason', await p.is_hidden('#coQtForm') and 'call-back' in await p.inner_text('#coQtLead')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 7)
        check('closed booking: quote shown read-only', await p.is_visible('#coQtSummary') and await p.is_hidden('#coQtForm')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 9)
        check('open problem report: no way to send a quote', await p.is_hidden('#coQt') or await p.is_hidden('#coQtForm')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 8)
        check('no transport or materials stated: those inputs are disabled and say how to add them', await p.is_disabled('#coQtTransport') and await p.is_disabled('#coQtMaterials') and 'record a new answer' in await p.inner_text('#coQtTransportHelp'))
        await p.click('#coQtSend'); await p.wait_for_selector('#coQtSummary:not([hidden])', timeout=5000)
        sv = (await p.evaluate('window.__sent'))[0]
        check('only the service fee: sends 0 / 0 / 0 and the total is just the fee', sv['p_transport'] == 0 and sv['p_materials'] == 0 and sv['p_other'] == 0 and sv['p_other_label'] is None and '₦12,500' in await p.inner_text('#coQtLines')); await ctx.close()
        ctx, p, errs = await newpage(b, scn(fail={'quote': True})); await goto(p, 1)
        check('load failure: plain error, no form', await p.is_visible('#coQtError') and await p.is_hidden('#coQtForm') and 'couldn’t load' in await p.inner_text('#coQtErrorText')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 1)
        body = await p.inner_text('#coBd')
        check('5C-1 card still works beside it, and nothing mentions release codes, commission or payment actions', await p.is_visible('#coCf') and 'commission' in (await p.inner_text('#coQt')).lower() and 'release code' not in body.lower() and await p.locator('#coQt button:has-text("Pay")').count() == 0); await ctx.close()
        ctx, p, errs = await newpage(b, scn(), 390, 844); await goto(p, 1)
        await p.fill('#coQtOther', '1000'); await p.fill('#coQtOtherLabel', 'Parking')
        check('mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        check('mobile: send button at least 44px tall', (await p.locator('#coQtSend').bounding_box())['height'] >= 44)
        await p.screenshot(path=OUT + '/quote-form-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\nTOTAL %d  PASS %d  FAIL %d' % (len(results), len(results) - len(bad), len(bad)))
    if bad: print('FAILED:', bad)
asyncio.run(main())

import asyncio, json, http.server, threading, functools, os, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8772), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_C = open(os.path.join(HERE, 'fake-customer-supabase.js')).read()
FAKE_K = open(os.path.join(HERE, 'fake-coordinator-supabase.js')).read()
BASE = 'http://127.0.0.1:8772/'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra else ''))
async def newpage(b, sc, fake, w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'paystack' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=fake, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(sc) + ';')
    return ctx, p, errs
def uid(n): return '00000000-0000-4000-8000-%012d' % n
LT = '44444444-4444-4444-8444-444444444444'
def bk(n, status='pending', pay=None, amount=None):
    return {'id': uid(n), 'customer_id': 'u1', 'tasker_id': LT, 'task_id': None, 'service_id': None, 'status': status, 'payment_status': pay, 'amount': amount,
            'notes': 'Door off hinge', 'scheduled_time': None, 'created_at': '2026-10-27T10:00:00Z', 'code_attempts': 0}
def lines(tr=1500, ma=3000, ot=1000, label='Parking <b>fee</b>'):
    L = [{'key': 'service_fee', 'label': 'Service fee (the Local Tasker’s price)', 'amount': 20000, 'held_in_escrow': True}]
    if tr: L.append({'key': 'transport', 'label': 'Transport', 'amount': tr, 'held_in_escrow': False})
    if ma: L.append({'key': 'materials', 'label': 'Materials', 'amount': ma, 'held_in_escrow': False})
    if ot: L.append({'key': 'other', 'label': label, 'amount': ot, 'held_in_escrow': False})
    return L
def quote(n, st, ver=2, payments=None, decision=None, note='Includes the hinges'):
    L = lines(); return {'booking_id': uid(n), 'lt_status': st, 'tasker_name': 'Baba A.', 'quote': {'version': ver, 'total': sum(l['amount'] for l in L), 'note': note, 'created_at': '2026-10-28T08:00:00Z', 'lines': L},
                         'decision': decision, 'payments': payments or []}
def scn(**k):
    pay_mixed = [{'key': 'service_fee', 'amount': 20000, 'status': 'pending'}, {'key': 'transport', 'amount': 1500, 'status': 'paid'}, {'key': 'materials', 'amount': 3000, 'status': 'declined'}, {'key': 'other', 'amount': 1000, 'status': 'failed'}]
    pay_paid = [{'key': x['key'], 'amount': x['amount'], 'status': 'paid'} for x in lines()]
    s = {'tables': {'bookings': [bk(1), bk(2), bk(3), bk(4), bk(5, 'confirmed', 'paid', 25500)], 'taskers': [], 'users': [], 'tasks': [], 'services': []},
         'quotes': [quote(1, 'quote_sent'), quote(2, 'quote_approved', payments=pay_mixed, decision={'decision': 'approved', 'reason': None, 'at': 'x'}),
                    quote(3, 'quote_declined', ver=1, decision={'decision': 'declined', 'reason': 'Too <i>expensive</i>', 'at': 'x'}),
                    quote(5, 'quote_approved', payments=pay_paid, decision={'decision': 'approved', 'reason': None, 'at': 'x'})]}
    s.update(k); return s
async def rpcs(p): return await p.evaluate('window.__rpc')
async def goto(p):
    await p.goto(BASE + 'customer-bookings.html'); await p.wait_for_selector('#bkList .bk-card', timeout=8000); await p.wait_for_timeout(300)
def box(n): return '[data-qbox="%s"]' % uid(n)
def card(n): return '.bk-card[data-id="%s"]' % uid(n)


def det(n, lt, pay='unpaid', events=None, bs='pending'):
    return {'booking_id': uid(n), 'lt_status': lt, 'booking_status': bs, 'work_stage': None, 'payment_status': pay, 'amount': None, 'scheduled_time': 'Sat 2 Nov, 10:00',
            'created_at': '2026-10-27T10:01:00Z', 'notes': 'Door off hinge', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': None,
            'task': {'title': 'Fix wardrobe'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': False, 'open': True, 'allowed_next': [], 'events': events or []}
def ksc(**k):
    s = {'detail': {uid(1): det(1, 'quote_approved'), uid(2): det(2, 'quote_sent'), uid(3): det(3, 'awaiting_tasker_confirmation'),
                    uid(4): det(4, 'quote_approved', events=[{'kind': 'milestone', 'to_status': 'arrived', 'created_at': '2026-10-28T09:00:00Z', 'actor_role': 'coordinator', 'note': None}])},
         'quote': {}, 'conf': {}}
    s.update(k); return s
async def kgoto(p, n):
    await p.goto(BASE + 'coordinator-booking.html?id=' + uid(n)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000); await p.wait_for_timeout(400)
async def rpcs(p): return await p.evaluate('window.__rpc')
async def ms_calls(p): return await p.evaluate('window.__ms || []')

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # ---- coordinator: the full day ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 1)
        check('card shows for an approved booking, with the first step asked and the right button', await p.is_visible('#coMs') and 'address' in (await p.inner_text('#coMsLead')).lower() and await p.inner_text('#coMsSubmit') == 'Record: address confirmed')
        check('card has the "never changes a payment" reassurance', 'never changes a payment' in await p.inner_text('#coMsFoot'))
        await p.screenshot(path=OUT + '/coordinator-ms-1440.png', full_page=True)
        await p.fill('#coMsNote', '<b>Spoke</b> to Baba')
        await p.click('#coMsSubmit'); await p.wait_for_timeout(500)
        c = await ms_calls(p)
        check('recording sends exactly booking, request id, kind, an ISO time and the note', len(c) == 1 and c[0]['p_booking'] == uid(1) and c[0]['p_kind'] == 'address_confirmed' and len(c[0]['p_request_id']) == 36 and c[0]['p_happened_at'].endswith('Z') and c[0]['p_note'] == '<b>Spoke</b> to Baba', c)
        t = await p.inner_text('#coMsList')
        check('the step appears in the list; the note is text, not markup', 'Address confirmed' in t and '<b>Spoke</b> to Baba' in t and await p.locator('#coMsList b').count() == 0, t)
        check('the next button is now "arrived"', await p.inner_text('#coMsSubmit') == 'Record: arrived')
        await p.click('#coMsSubmit'); await p.wait_for_timeout(500)
        check('after "arrived", "started" is blocked with the payment message and no form', not await p.is_visible('#coMsForm') and 'not paid yet' in await p.inner_text('#coMsLead'), await p.inner_text('#coMsLead'))
        rp = await rpcs(p)
        check('no payment function is ever called by this card', not any(('payment' in r.split(':')[0] or 'escrow' in r.split(':')[0] or 'release' in r.split(':')[0]) for r in rp), [r.split(':')[0] for r in rp])
        check('the page crashed nowhere', not errs, errs); await ctx.close()

        sc = ksc(paid=True); sc['ms'] = {uid(1): [{'kind': 'address_confirmed', 'happened_at': '2026-10-28T08:00:00Z', 'recorded_at': '2026-10-28T08:00:00Z', 'note': None}, {'kind': 'arrived', 'happened_at': '2026-10-28T08:30:00Z', 'recorded_at': '2026-10-28T08:30:00Z', 'note': None}]}
        ctx, p, errs = await newpage(b, sc, FAKE_K); await kgoto(p, 1)
        check('paid booking: "started" is offered', await p.inner_text('#coMsSubmit') == 'Record: work started')
        await p.click('#coMsSubmit'); await p.wait_for_timeout(500); await p.click('#coMsSubmit'); await p.wait_for_timeout(500)
        check('after "finished" nothing more can be recorded and the message says so', not await p.is_visible('#coMsForm') and 'All four steps' in await p.inner_text('#coMsLead') and await p.locator('#coMsList li').count() == 4, await p.inner_text('#coMsLead'))
        await p.screenshot(path=OUT + '/coordinator-ms-done-1440.png', full_page=True); await ctx.close()

        # ---- coordinator: states where the card must not show ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 2)
        check('quote sent but not approved: no card', not await p.is_visible('#coMs')); await ctx.close()
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 3)
        check('still waiting for the Local Tasker: no card and no milestone call', not await p.is_visible('#coMs') and not any(r.startswith('local_booking_milestones') for r in await rpcs(p))); await ctx.close()
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 4)
        check('the history lists a milestone event with its name', 'Arrived' in await p.inner_text('#coBdHist'), await p.inner_text('#coBdHist')); await ctx.close()

        # ---- coordinator: validation and errors ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 1)
        await p.evaluate("document.getElementById('coMsWhen').value = '2999-01-01T10:00'")
        await p.click('#coMsSubmit'); await p.wait_for_timeout(300)
        check('a future time is stopped on screen with no call', not await ms_calls(p) and await p.is_visible('#coMsWhenErr'))
        await p.fill('#coMsWhen', ''); await p.click('#coMsSubmit'); await p.wait_for_timeout(300)
        check('an empty time is stopped on screen with no call', not await ms_calls(p) and 'Enter when' in await p.inner_text('#coMsWhenErr')); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'msRecord': [{'message': 'network down'}]}), FAKE_K); await kgoto(p, 1)
        await p.click('#coMsSubmit'); await p.wait_for_timeout(400)
        check('a failed save shows a plain message, nothing recorded, the form stays', await p.is_visible('#coMsError') and 'Nothing was recorded' in await p.inner_text('#coMsErrorText') and await p.is_visible('#coMsForm'))
        await p.click('#coMsSubmit'); await p.wait_for_timeout(500)
        c = await ms_calls(p)
        check('the retry uses the SAME request id and then succeeds', len(c) == 2 and c[0]['p_request_id'] == c[1]['p_request_id'] and await p.locator('#coMsList li').count() == 1, c); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'msRecord': [{'code': 'P0001', 'hint': 'payment_needed', 'message': 'x'}]}), FAKE_K); await kgoto(p, 1)
        await p.click('#coMsSubmit'); await p.wait_for_timeout(500)
        check('a server refusal (payment_needed) is shown in plain words', 'not paid yet' in await p.inner_text('#coMsErrorText'), await p.inner_text('#coMsErrorText')); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'ms': True}), FAKE_K); await kgoto(p, 1)
        check('milestones that cannot load: error shown, form hidden, rest of the page works', await p.is_visible('#coMsError') and not await p.is_visible('#coMsForm') and await p.is_visible('#coBd') and not errs, errs); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(), FAKE_K, 390, 844); await kgoto(p, 1)
        check('mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        check('mobile: the record button is at least 44px tall', (await p.locator('#coMsSubmit').bounding_box())['height'] >= 44)
        await p.screenshot(path=OUT + '/coordinator-ms-390.png', full_page=True); await ctx.close()

        # ---- customer ----
        def bkc(n, pay='paid'): return {'id': uid(n), 'customer_id': 'u1', 'tasker_id': LT, 'task_id': None, 'service_id': None, 'status': 'confirmed', 'payment_status': pay, 'amount': 25500, 'notes': 'x', 'scheduled_time': None, 'created_at': '2026-10-27T10:00:00Z', 'code_attempts': 0}
        L = [{'key': 'service_fee', 'label': 'Service fee', 'amount': 20000, 'held_in_escrow': True}]
        def q(n): return {'booking_id': uid(n), 'lt_status': 'quote_approved', 'tasker_name': 'Baba A.', 'quote': {'version': 1, 'total': 20000, 'note': None, 'created_at': '2026-10-28T08:00:00Z', 'lines': L},
                          'decision': {'decision': 'approved', 'reason': None, 'at': 'x'}, 'payments': [{'key': 'service_fee', 'amount': 20000, 'status': 'paid'}]}
        def csc(**k):
            s = {'tables': {'bookings': [bkc(1), bkc(2)], 'taskers': [], 'users': [], 'tasks': [], 'services': []}, 'quotes': [q(1), q(2)],
                 'msRows': [{'booking_id': uid(1), 'items': [{'kind': 'address_confirmed', 'happened_at': '2026-10-28T08:00:00Z'}, {'kind': 'arrived', 'happened_at': '2026-10-28T08:40:00Z'}]}]}
            s.update(k); return s
        async def cgoto(p):
            await p.goto(BASE + 'customer-bookings.html'); await p.wait_for_selector('#bkList .bk-card', timeout=8000); await p.wait_for_timeout(300)
        ctx, p, errs = await newpage(b, csc(), FAKE_C); await cgoto(p)
        t1 = await p.inner_text('.bk-card[data-id="%s"]' % uid(1)); t2 = await p.inner_text('.bk-card[data-id="%s"]' % uid(2))
        check('customer: the booking with milestones shows "Progress on the day" with both steps', 'Progress on the day' in t1 and 'Address confirmed' in t1 and 'Arrived' in t1 and 'Work started' not in t1, t1.replace('\n', ' | ')[:300])
        check('customer: a booking without milestones shows no progress block', 'Progress on the day' not in t2)
        check('customer: the block has no buttons (read only)', await p.locator('.bk-card[data-id="%s"] .bk-ms button' % uid(1)).count() == 0)
        await p.screenshot(path=OUT + '/customer-ms-1440.png', full_page=True); await ctx.close()
        ctx, p, errs = await newpage(b, csc(fail={'ms': True}), FAKE_C); await cgoto(p)
        check('customer: milestones that cannot load never break the bookings page', await p.locator('.bk-card').count() == 2 and await p.locator('.bk-q').count() == 2 and not errs, errs); await ctx.close()
        ctx, p, errs = await newpage(b, csc(), FAKE_C, 390, 844); await cgoto(p)
        check('customer mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        await p.screenshot(path=OUT + '/customer-ms-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\nTOTAL %d  PASS %d  FAIL %d' % (len(results), len(results) - len(bad), len(bad)))
    if bad: print('FAILED:', bad)
asyncio.run(main())

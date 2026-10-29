import asyncio, json, http.server, threading, functools, os, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8773), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_C = open(os.path.join(HERE, 'fake-customer-supabase.js')).read()
FAKE_K = open(os.path.join(HERE, 'fake-coordinator-supabase.js')).read()
BASE = 'http://127.0.0.1:8773/'
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
async def ex_calls(p): return await p.evaluate('window.__ex || []')

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # ---- coordinator: customer unreachable and no-show on an approved booking ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 1)
        check('card shows for an approved booking, form visible, both choices enabled', await p.is_visible('#coEx') and await p.is_visible('#coExForm') and not await p.is_disabled('#coExUnreach') and not await p.is_disabled('#coExNoShow'))
        check('card says recording never changes a payment and does not cancel', 'never changes a payment' in await p.inner_text('#coExFoot') and 'does not cancel' in await p.inner_text('#coExFoot'))
        await p.screenshot(path=OUT + '/coordinator-ex-1440.png', full_page=True)
        await p.click('#coExSubmit'); await p.wait_for_timeout(300)
        check('submitting with no choice is stopped on screen with no call', not await ex_calls(p) and await p.is_visible('#coExKindErr'))
        await p.check('#coExUnreach'); await p.fill('#coExNote', '<b>Phone</b> off')
        check('the button names the choice', await p.inner_text('#coExSubmit') == 'Record: customer not reached', await p.inner_text('#coExSubmit'))
        await p.click('#coExSubmit'); await p.wait_for_timeout(500)
        c = await ex_calls(p)
        check('recording sends exactly booking, request id, kind, an ISO time and the note', len(c) == 1 and c[0]['p_booking'] == uid(1) and c[0]['p_kind'] == 'customer_unreachable' and len(c[0]['p_request_id']) == 36 and c[0]['p_happened_at'].endswith('Z') and c[0]['p_note'] == '<b>Phone</b> off', c)
        t = await p.inner_text('#coExList')
        check('it appears in the list; the note is text, not markup', 'Customer could not be reached' in t and '<b>Phone</b> off' in t and await p.locator('#coExList b').count() == 0, t)
        check('the choice is cleared and unreachable can be recorded again', not await p.is_checked('#coExUnreach') and not await p.is_disabled('#coExUnreach'))
        await p.check('#coExNoShow'); await p.click('#coExSubmit'); await p.wait_for_timeout(500)
        c = await ex_calls(p)
        check('a no-show is recorded with its own kind and a different request id', len(c) == 2 and c[1]['p_kind'] == 'tasker_no_show' and c[0]['p_request_id'] != c[1]['p_request_id'])
        check('after a no-show the choice is disabled with the reason, and the lead explains what is blocked', await p.is_disabled('#coExNoShow') and 'Already recorded' in await p.inner_text('#coExNoShowWhy') and 'No step on the day' in await p.inner_text('#coExLead'), await p.inner_text('#coExLead'))
        check('both entries are in the list', await p.locator('#coExList li').count() == 2)
        rp = await rpcs(p)
        check('no payment, escrow, release or cancel function is ever called by this card', not any(any(w in r.split(':')[0] for w in ('payment', 'escrow', 'release', 'cancel', 'wallet')) for r in rp), [r.split(':')[0] for r in rp])
        check('the page crashed nowhere', not errs, errs); await ctx.close()

        # ---- coordinator: states ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 2)
        check('quote sent: card shows, unreachable enabled, no-show disabled with a reason', await p.is_visible('#coEx') and not await p.is_disabled('#coExUnreach') and await p.is_disabled('#coExNoShow') and 'Not available' in await p.inner_text('#coExNoShowWhy')); await ctx.close()
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 3)
        check('waiting for the Local Tasker: no card and no exceptions call', not await p.is_visible('#coEx') and not any(r.startswith('local_booking_exceptions') for r in await rpcs(p))); await ctx.close()
        ctx, p, errs = await newpage(b, ksc(arrived=True), FAKE_K); await kgoto(p, 4)
        check('arrived is recorded: no-show disabled with the reason, unreachable still possible', await p.is_disabled('#coExNoShow') and 'already recorded as arrived' in await p.inner_text('#coExNoShowWhy') and not await p.is_disabled('#coExUnreach'), await p.inner_text('#coExNoShowWhy')); await ctx.close()
        sc = ksc(); sc['detail'][uid(1)]['events'] = [{'kind': 'exception', 'to_status': 'tasker_no_show', 'created_at': '2026-10-28T09:00:00Z', 'actor_role': 'coordinator', 'note': None}, {'kind': 'exception', 'to_status': 'customer_unreachable', 'created_at': '2026-10-28T09:10:00Z', 'actor_role': 'coordinator', 'note': None}]
        ctx, p, errs = await newpage(b, sc, FAKE_K); await kgoto(p, 1)
        h = await p.inner_text('#coBdHist')
        check('the history lists both exceptions by name', 'Local Tasker did not come' in h and 'Customer could not be reached' in h, h); await ctx.close()
        sc = ksc(); sc['exs'] = {uid(1): [{'kind': 'customer_unreachable', 'happened_at': '2026-10-28T09:00:00Z', 'recorded_at': '2026-10-28T09:00:00Z', 'note': None}] * 5}
        ctx, p, errs = await newpage(b, sc, FAKE_K); await kgoto(p, 1)
        check('after five attempts unreachable is disabled with the contact-an-administrator reason', await p.is_disabled('#coExUnreach') and 'Five attempts' in await p.inner_text('#coExUnreachWhy')); await ctx.close()

        # ---- coordinator: validation and errors ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 1)
        await p.check('#coExUnreach'); await p.evaluate("document.getElementById('coExWhen').value = '2999-01-01T10:00'")
        await p.click('#coExSubmit'); await p.wait_for_timeout(300)
        check('a future time is stopped on screen with no call', not await ex_calls(p) and await p.is_visible('#coExWhenErr'))
        await p.fill('#coExWhen', ''); await p.click('#coExSubmit'); await p.wait_for_timeout(300)
        check('an empty time is stopped on screen with no call', not await ex_calls(p) and 'Enter when' in await p.inner_text('#coExWhenErr')); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'exRecord': [{'message': 'network down'}]}), FAKE_K); await kgoto(p, 1)
        await p.check('#coExNoShow'); await p.click('#coExSubmit'); await p.wait_for_timeout(400)
        check('a failed save shows a plain message, nothing recorded, the form stays', await p.is_visible('#coExError') and 'Nothing was recorded' in await p.inner_text('#coExErrorText') and await p.is_visible('#coExForm'))
        await p.click('#coExSubmit'); await p.wait_for_timeout(500)
        c = await ex_calls(p)
        check('the retry uses the SAME request id and then succeeds', len(c) == 2 and c[0]['p_request_id'] == c[1]['p_request_id'] and await p.locator('#coExList li').count() == 1, c); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'exRecord': [{'code': 'P0001', 'hint': 'already_arrived', 'message': 'x'}]}), FAKE_K); await kgoto(p, 1)
        await p.check('#coExNoShow'); await p.click('#coExSubmit'); await p.wait_for_timeout(500)
        check('a server refusal is shown in plain words and the card reloads', 'reloaded the card' in await p.inner_text('#coExErrorText'), await p.inner_text('#coExErrorText')); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'ex': True}), FAKE_K); await kgoto(p, 1)
        check('exceptions that cannot load: error shown, form hidden, rest of the page works', await p.is_visible('#coExError') and not await p.is_visible('#coExForm') and await p.is_visible('#coBd') and await p.is_visible('#coMs') and not errs, errs); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(), FAKE_K, 390, 844); await kgoto(p, 1)
        check('mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        check('mobile: the record button is at least 44px tall', (await p.locator('#coExSubmit').bounding_box())['height'] >= 44)
        await p.screenshot(path=OUT + '/coordinator-ex-390.png', full_page=True); await ctx.close()

        # ---- the "send back" button explains the going-back refusal ----
        # (the real refusal comes from the database trigger; here we only check the words the coordinator sees)
        src = open(os.path.join(ROOT, 'js/coordinator-confirmation.js')).read()
        check('the send-back error handler knows work_started and payment_started', "'work_started'" in src and "'payment_started'" in src)

        # ---- customer ----
        def bkc(n, pay='paid'): return {'id': uid(n), 'customer_id': 'u1', 'tasker_id': LT, 'task_id': None, 'service_id': None, 'status': 'confirmed', 'payment_status': pay, 'amount': 25500, 'notes': 'x', 'scheduled_time': None, 'created_at': '2026-10-27T10:00:00Z', 'code_attempts': 0}
        L = [{'key': 'service_fee', 'label': 'Service fee', 'amount': 20000, 'held_in_escrow': True}]
        def q(n): return {'booking_id': uid(n), 'lt_status': 'quote_approved', 'tasker_name': 'Baba A.', 'quote': {'version': 1, 'total': 20000, 'note': None, 'created_at': '2026-10-28T08:00:00Z', 'lines': L},
                          'decision': {'decision': 'approved', 'reason': None, 'at': 'x'}, 'payments': [{'key': 'service_fee', 'amount': 20000, 'status': 'paid'}]}
        def csc(**k):
            s = {'tables': {'bookings': [bkc(1), bkc(2), bkc(3)], 'taskers': [], 'users': [], 'tasks': [], 'services': []}, 'quotes': [q(1), q(2), q(3)],
                 'msRows': [{'booking_id': uid(1), 'items': [{'kind': 'address_confirmed', 'happened_at': '2026-10-28T08:00:00Z'}]}],
                 'exRows': [{'booking_id': uid(1), 'items': [{'kind': 'customer_unreachable', 'happened_at': '2026-10-28T09:00:00Z'}]},
                            {'booking_id': uid(3), 'items': [{'kind': 'tasker_no_show', 'happened_at': '2026-10-28T10:00:00Z'}]}]}
            s.update(k); return s
        async def cgoto(p):
            await p.goto(BASE + 'customer-bookings.html'); await p.wait_for_selector('#bkList .bk-card', timeout=8000); await p.wait_for_timeout(300)
        ctx, p, errs = await newpage(b, csc(), FAKE_C); await cgoto(p)
        t1 = await p.inner_text('.bk-card[data-id="%s"]' % uid(1)); t2 = await p.inner_text('.bk-card[data-id="%s"]' % uid(2)); t3 = await p.inner_text('.bk-card[data-id="%s"]' % uid(3))
        check('customer: steps and the unreachable line show together', 'Address confirmed' in t1 and 'We tried to reach you and could not' in t1, t1.replace('\n', ' | ')[:300])
        check('customer: a booking with only an exception still shows the block, with the no-show text', 'Progress on the day' in t3 and 'did not arrive as agreed' in t3 and 'Address confirmed' not in t3, t3.replace('\n', ' | ')[:300])
        check('customer: a booking with nothing recorded shows no block', 'Progress on the day' not in t2)
        check('customer: the block says it changes no payment, and has no buttons', 'does not change any payment' in t3 and await p.locator('.bk-card[data-id="%s"] .bk-ms button' % uid(3)).count() == 0)
        await p.screenshot(path=OUT + '/customer-ex-1440.png', full_page=True); await ctx.close()
        ctx, p, errs = await newpage(b, csc(fail={'ex': True}), FAKE_C); await cgoto(p)
        check('customer: exceptions that cannot load never break the bookings page (steps still show)', await p.locator('.bk-card').count() == 3 and 'Address confirmed' in await p.inner_text('.bk-card[data-id="%s"]' % uid(1)) and not errs, errs); await ctx.close()
        ctx, p, errs = await newpage(b, csc(), FAKE_C, 390, 844); await cgoto(p)
        check('customer mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        await p.screenshot(path=OUT + '/customer-ex-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\nTOTAL %d  PASS %d  FAIL %d' % (len(results), len(results) - len(bad), len(bad)))
    if bad: print('FAILED:', bad)
asyncio.run(main())

import asyncio, json, http.server, threading, functools, os, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8771), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_C = open(os.path.join(HERE, 'fake-customer-supabase.js')).read()
FAKE_K = open(os.path.join(HERE, 'fake-coordinator-supabase.js')).read()
BASE = 'http://127.0.0.1:8771/'
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

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx, p, errs = await newpage(b, scn(), FAKE_C); await goto(p)
        t = await p.inner_text(box(1))
        check('quote card: title, tasker name, four lines, total, note', 'Quote from Baba A.' in t and '₦20,000' in t and '₦1,500' in t and '₦3,000' in t and '₦1,000' in t and '₦25,500' in t and 'Includes the hinges' in t, t.replace('\n', ' | '))
        check('quote card: coordinator text is shown as text, never as markup', await p.locator(box(1) + ' b').count() == 0 and 'Parking <b>fee</b>' in t)
        check('quote card: badge says Quote to Review and the hint says approving does not charge', 'Quote to Review' in await p.inner_text(card(1) + ' .bk-badge') and 'does not charge' in await p.inner_text(card(1) + ' .bk-hint'))
        check('quote card: no card on a booking without a quote', await p.locator(card(4) + ' .bk-q').count() == 0)
        check('sidebar counts the quote to answer (1) plus one approved booking to pay (booking 2 has pending payments)', '1 quote to answer' in await p.inner_text('#sActionSub') and await p.inner_text('#sAction') == '2', await p.inner_text('#sActionSub'))
        await p.screenshot(path=OUT + '/customer-quote-1440.png', full_page=True)
        await p.click(box(1) + ' [data-qact=approve]')
        check('approve: asks to confirm with the total and makes no call yet', '₦25,500 in total' in await p.inner_text(box(1)) and not any(x.startswith('local_booking_decide_quote') for x in await rpcs(p)))
        await p.click(box(1) + ' [data-qact=back]')
        check('approve: Back returns to the two buttons', await p.locator(box(1) + ' [data-qact=approve]').count() == 1)
        await p.click(box(1) + ' [data-qact=approve]'); await p.click(box(1) + ' [data-qact=confirm-approve]'); await p.wait_for_selector(box(1) + ' [data-qact=room]', timeout=5000); await p.wait_for_timeout(300)
        d = (await p.evaluate('window.__decide'))[0]
        check('approve: exact arguments (booking, version 2, uuid, approved, no reason)', d['p_booking'] == uid(1) and d['p_version'] == 2 and d['p_decision'] == 'approved' and d['p_reason'] is None and re.match(r'^[0-9a-f-]{36}$', d['p_request_id']) and len(d) == 5, d)
        check('approve: page re-read the quotes and now shows Quote approved with Pay in Job Room and Payment Needed', 'Quote approved' in await p.inner_text(box(1)) and 'Payment Needed' in await p.inner_text(card(1) + ' .bk-badge') and 'Pay in Chat' in await p.inner_text(card(1) + ' > .bk-actions'), (await p.inner_text(card(1) + ' .bk-badge')) + ' / ' + (await p.inner_text(card(1) + ' > .bk-actions')))
        check('approve: only the two quote calls and the read-only milestones read were made, and no table was written', set(x.split(':')[0] for x in await rpcs(p)) == {'local_booking_customer_quotes', 'local_booking_decide_quote', 'local_booking_customer_milestones'} and not errs, errs)

        t2 = await p.inner_text(box(2))
        check('approved quote: each line shows its payment state (to pay, paid, declined, failed)', 'To pay' in t2 and 'Paid' in t2 and 'Declined' in t2 and 'try again' in t2, t2.replace('\n', ' | '))
        check('approved quote with everything paid: no pay button, label In Progress', await p.locator(box(5) + ' [data-qact=room]').count() == 0 and 'In Progress' in await p.inner_text(card(5) + ' .bk-badge') and 'Everything on this quote has been paid' in await p.inner_text(box(5)))
        t3 = await p.inner_text(box(3))
        check('declined quote: says declined, shows the reason as text, no buttons', 'You declined this quote' in t3 and 'Too <i>expensive</i>' in t3 and await p.locator(box(3) + ' button').count() == 0 and await p.locator(box(3) + ' i').count() == 0)
        await p.click(box(2) + ' [data-qact=room]'); await p.wait_for_url('**/messages.html', timeout=8000)
        check('Pay in Job Room opens the booking chat', True); await ctx.close()

        ctx, p, errs = await newpage(b, scn(), FAKE_C); await goto(p)
        await p.click(box(1) + ' [data-qact=decline]'); await p.fill('[data-qreason="%s"]' % uid(1), 'Too much for me')
        await p.click(box(1) + ' [data-qact=confirm-decline]'); await p.wait_for_selector(box(1) + ' >> text=You declined this quote', timeout=5000)
        d = (await p.evaluate('window.__decide'))[0]
        check('decline: sends the reason; card then shows declined with the reason', d['p_decision'] == 'declined' and d['p_reason'] == 'Too much for me' and 'Too much for me' in await p.inner_text(box(1)), d)
        await ctx.close()

        ctx, p, errs = await newpage(b, scn(fail={'decide': [{'hint': None, 'message': 'FATAL relation x'}, None]}), FAKE_C); await goto(p)
        await p.click(box(1) + ' [data-qact=approve]'); await p.click(box(1) + ' [data-qact=confirm-approve]'); await p.wait_for_selector(box(1) + ' .bk-q-error', timeout=5000)
        tx = await p.inner_text(box(1) + ' .bk-q-error')
        check('server error: plain sentence, never raw database text, buttons usable again', 'Nothing was changed' in tx and 'FATAL' not in tx and await p.is_enabled(box(1) + ' [data-qact=confirm-approve]'), tx)
        await p.click(box(1) + ' [data-qact=confirm-approve]'); await p.wait_for_selector(box(1) + ' [data-qact=room]', timeout=5000)
        ds = await p.evaluate('window.__decide')
        check('retry after an error uses the SAME request id', len(ds) == 2 and ds[0]['p_request_id'] == ds[1]['p_request_id']); await ctx.close()

        def bump(sc):
            q = sc['quotes'][0]; q['quote']['version'] = 3
        ctx, p, errs = await newpage(b, scn(fail={'decide': {'hint': 'quote_changed', 'message': 'x'}}), FAKE_C); await goto(p)
        await p.click(box(1) + ' [data-qact=approve]'); await p.click(box(1) + ' [data-qact=confirm-approve]'); await p.wait_for_selector(box(1) + ' .bk-q-error', timeout=5000); await p.wait_for_timeout(300)
        check('quote_changed: tells the customer to read the new quote and returns to the two buttons', 'new one' in await p.inner_text(box(1) + ' .bk-q-error') and await p.locator(box(1) + ' [data-qact=approve]').count() == 1); await ctx.close()

        ctx, p, errs = await newpage(b, scn(fail={'quotes': True}), FAKE_C); await goto(p)
        check('quotes cannot load: bookings still show, no quote card, no error box, no crash', await p.locator('.bk-card').count() == 5 and await p.locator('.bk-q').count() == 0 and not errs, errs); await ctx.close()

        ctx, p, errs = await newpage(b, scn(), FAKE_C, 390, 844); await goto(p)
        await p.click(box(1) + ' [data-qact=decline]')
        check('mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        check('mobile: quote buttons are at least 44px tall', (await p.locator(box(1) + ' [data-qact=confirm-decline]').bounding_box())['height'] >= 44)
        await p.screenshot(path=OUT + '/customer-quote-390.png', full_page=True); await ctx.close()

        # coordinator page: the customer's reason is shown
        def ksc(reason):
            det = {'booking_id': uid(1), 'lt_status': 'quote_declined', 'booking_status': 'pending', 'work_stage': None, 'payment_status': 'unpaid', 'amount': None, 'scheduled_time': 'Sat', 'created_at': '2026-10-27T10:01:00Z', 'notes': 'x',
                   'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': None, 'task': {'title': 'Fix'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': False, 'open': True, 'allowed_next': [], 'events': []}
            cur = {'version': 1, 'service_fee': 12500, 'transport_amount': 0, 'materials_amount': 0, 'other_amount': 0, 'other_label': None, 'total': 12500, 'created_at': '2026-10-28T08:00:00Z',
                   'lines': [{'sort': 1, 'key': 'service_fee', 'label': 'Service fee', 'amount': 12500}], 'decision': {'decision': 'declined', 'reason': reason, 'at': 'x'}}
            return {'detail': {uid(1): det}, 'quote': {uid(1): {'confirmed': {'service_fee': 12500, 'transport_amount': 0, 'materials_amount': 0, 'materials_notes': None, 'second_check_status': 'off'}, 'current': cur, 'history': []}}}
        ctx, p, errs = await newpage(b, ksc('Too <b>dear</b>'), FAKE_K)
        await p.goto(BASE + 'coordinator-booking.html?id=' + uid(1)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000); await p.wait_for_timeout(300)
        lead = await p.inner_text('#coQtLead')
        check('coordinator: sees the customer\'s reason as text on a declined quote, form open for a revision', 'Their reason: “Too <b>dear</b>”' in lead and await p.locator('#coQtLead b').count() == 0 and await p.is_visible('#coQtForm'), lead)
        check('coordinator: note field now says it is for the customer', 'Note for the customer' in await p.inner_text('label[for=coQtNote]')); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\nTOTAL %d  PASS %d  FAIL %d' % (len(results), len(results) - len(bad), len(bad)))
    if bad: print('FAILED:', bad)
asyncio.run(main())

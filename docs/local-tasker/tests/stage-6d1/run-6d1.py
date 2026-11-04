import asyncio, json, http.server, threading, functools, os, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8787), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, 'fake-base.js')).read() + '\n' + open(os.path.join(HERE, 'chat-rpc.js')).read()
BASE = 'http://127.0.0.1:8787/'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra else ''))
def uid(n): return '00000000-0000-4000-8000-%012d' % n
LT = '44444444-4444-4444-8444-444444444444'
def det(n, lt, pay='unpaid'):
    return {'booking_id': uid(n), 'lt_status': lt, 'booking_status': 'pending', 'work_stage': None, 'payment_status': pay, 'amount': 20000, 'scheduled_time': 'Sat 2 Nov, 10:00',
            'created_at': '2026-10-27T10:01:00Z', 'notes': '', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': '+234 801 000 0000',
            'task': {'title': 'Fix wardrobe'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': False, 'open': True, 'allowed_next': [], 'events': []}
def row(n, lt, access='coordinator'):
    return {'booking_id': uid(n), 'customer_name': 'Ada Obi', 'tasker_name': 'Baba Alabi', 'title': 'Fix wardrobe', 'last_message': 'Hello', 'last_message_at': '2026-10-28T09:00:00Z',
            'created_at': '2026-10-27T10:01:00Z', 'unread': 0, 'access': access, 'open': True, 'frozen': False, 'lt_status': lt, 'booking_status': 'pending', 'payment_status': 'unpaid',
            'amount': 20000, 'scheduled_time': 'Sat 2 Nov, 10:00'}
P1, P2, R1, R2 = 'p1111111-aaaa', 'p2222222-bbbb', 'r1111111-aaaa', 'r2222222-bbbb'
def msgs():
    return [{'id': 'm1', 'kind': 'customer', 'type': 'text', 'body': 'Hello, can you do Saturday?', 'author_name': None, 'author_is_me': False, 'created_at': '2026-10-28T09:00:00Z'},
            {'id': 'm2', 'kind': 'local_tasker', 'type': 'payment_request', 'body': 'PAYMENT_REQUEST:%s:20000' % P1, 'created_at': '2026-10-28T09:05:00Z'},
            {'id': 'm3', 'kind': 'local_tasker', 'type': 'job_request', 'body': 'JOB_REQUEST:%s:price_proposal' % R1, 'created_at': '2026-10-28T09:06:00Z'},
            {'id': 'm4', 'kind': 'customer', 'type': 'job_request', 'body': 'JOB_REQUEST:%s:reschedule' % R2, 'created_at': '2026-10-28T09:07:00Z'},
            {'id': 'm5', 'kind': 'local_tasker', 'type': 'payment_request', 'body': 'PAYMENT_REQUEST:%s:3000' % P2, 'created_at': '2026-10-28T09:08:00Z'}]
def cards():
    return {'thread_id': 't1', 'read_only': False,
            'payments': [{'id': P1, 'kind': 'payment', 'status': 'paid', 'amount': 20000, 'title': None, 'reason': 'Main payment <img src=x onerror="window.__xss=1">', 'breakdown': [{'label': 'Service', 'amount': 17000}, {'label': 'Transport', 'amount': 3000}],
                          'invoice_number': None, 'due_date': None, 'revises_id': None, 'settlement': 'held', 'created_at': '2026-10-28T09:05:00Z', 'paid_at': '2026-10-28T09:30:00Z'},
                         {'id': P2, 'kind': 'invoice', 'status': 'pending', 'amount': 3000, 'title': 'Extra hinges', 'reason': None, 'breakdown': None, 'invoice_number': 'INV-0042',
                          'due_date': '2026-11-20', 'revises_id': None, 'settlement': None, 'created_at': '2026-10-28T09:08:00Z', 'paid_at': None}],
            'requests': [{'id': R1, 'kind': 'price_proposal', 'status': 'fulfilled', 'note': 'after the phone call', 'payload': {'amount': 20000}, 'by': 'local_tasker', 'created_at': '2026-10-28T09:06:00Z', 'responded_at': None},
                         {'id': R2, 'kind': 'reschedule', 'status': 'pending', 'note': 'running late', 'payload': {'when': '2026-12-01T09:00:00Z', 'label': 'x'}, 'by': 'customer', 'created_at': '2026-10-28T09:07:00Z', 'responded_at': None}],
            'receipts': [{'id': 'rc1', 'receipt_number': 'RCT-0001', 'payment_request_id': P1, 'kind': 'payment', 'title': 'Payment', 'invoice_number': None, 'amount': 20000, 'lines': [], 'paid_at': '2026-10-28T09:30:00Z'}]}
def events(n=3):
    kinds = [('booked', 'Booking confirmed', 'customer'), ('work_update', 'Work update', 'local_tasker'), ('payment_paid', 'Payment received', 'system')]
    out = []
    for i in range(n):
        k = kinds[i % 3]; out.append({'id': 'e%d' % i, 'kind': k[0], 'text': k[1], 'note': 'on my way' if k[0] == 'work_update' else None, 'by': k[2], 'created_at': '2026-10-28T%02d:00:00Z' % (20 - i)})
    return out
def sc(**k):
    s = {'detail': {uid(1): det(1, 'quote_approved'), uid(2): det(2, 'assigned')}, 'quote': {}, 'conf': {}, 'ex': {},
         'chat': {'rows': [row(1, 'quote_approved'), row(2, 'assigned'), row(3, 'quote_approved', access='former_coordinator')],
                  'threads': {uid(1): {'thread_id': 't1', 'access': 'coordinator', 'total_messages': 5, 'notes': [], 'messages': msgs()},
                              uid(2): {'thread_id': 't2', 'access': 'coordinator', 'total_messages': 1, 'notes': [], 'messages': [msgs()[0]]},
                              uid(3): {'thread_id': 't3', 'access': 'former_coordinator', 'total_messages': 5, 'notes': [], 'messages': msgs()}}},
         'cards': {uid(1): cards(), uid(3): dict(cards(), read_only=True)}, 'activity': {uid(1): events(3), uid(3): events(3)}}
    s.update(k); return s
async def page(b, scn, w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'paystack' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(scn) + ';')
    return ctx, p, errs
async def goto(p, n):
    await p.goto(BASE + 'coordinator-chat.html?booking=' + uid(n)); await p.wait_for_selector('#ccBody:not([hidden])', timeout=8000); await p.wait_for_timeout(900)
async def rpcs(p): return await p.evaluate('window.__rpc || []')
async def txt(p, sel): return await p.evaluate("(s)=>Array.from(document.querySelectorAll(s)).map(e=>e.textContent).join('\\n')", sel)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # 1. cards in the conversation (desktop)
        ctx, p, errs = await page(b, sc()); await goto(p, 1)
        body = await txt(p, '#ccBody')
        check('two payment cards and two request cards are drawn', await p.locator('#ccBody .payment-request-card').count() == 2 and await p.locator('#ccBody .jr-req').count() == 2)
        check('the raw PAYMENT_REQUEST / JOB_REQUEST codes are never shown', 'PAYMENT_REQUEST' not in body and 'JOB_REQUEST' not in body)
        check('paid card shows the amount, the lines and "Funds in escrow"', '₦20,000' in body and 'Service' in body and 'Funds in escrow' in body)
        check('invoice card shows the title, number and due date', 'Extra hinges' in body and 'INV-0042' in body and 'Due 20 Nov 2026' in body and 'Waiting for the customer to pay' in body)
        check('price proposal card shows the amount and "Agreed"', 'Price proposed' in body and 'Agreed' in body)
        check('reschedule card shows who asked, the new time and the note', 'Reschedule requested' in body and 'New time:' in body and 'running late' in body)
        check('cards are read only: no button inside any card', await p.locator('#ccBody .payment-request-card button, #ccBody .jr-req button').count() == 0)
        check('database text is never turned into HTML (no injected image, no script ran)', await p.locator('#ccBody img').count() == 0 and not await p.evaluate('window.__xss'))
        check('a customer-sent request sits on the left, a Local Tasker one on the right', await p.locator('#ccBody .msg-bubble-wrap.theirs .jr-req').count() == 1 and await p.locator('#ccBody .msg-bubble-wrap.mine .jr-req').count() == 1)
        # 2. right-hand column
        ctxt = await txt(p, '#ccCtx')
        check('Payment history lists both requests with the totals', 'Payment history' in ctxt and '₦20,000 paid' in ctxt and '₦3,000 waiting for the customer' in ctxt and 'Invoice INV-0042' in ctxt and 'Receipt RCT-0001' in ctxt)
        check('invoice is tagged as an additional charge', 'Additional charge, not part of the agreed price' in ctxt)
        check('the Activity block is there', 'Activity' in ctxt)
        ev = await p.evaluate("Array.from(document.querySelectorAll('#ccCtx .jr-dt-event-text')).map(e=>e.innerText)")
        check('activity events are in the order given (newest first) and show the note', ev[0] == 'Booking confirmed' and 'on my way' in ctxt, ev)
        check('activity names the actor as Customer / Local Tasker / StreetTasker', 'Customer ·' in ctxt and 'Local Tasker ·' in ctxt and 'StreetTasker ·' in ctxt)
        r = await rpcs(p)
        allowed = re.compile(r'^(is_active_coordinator|coordinator_chat_(list|thread|cards|activity|mark_read)|local_booking_(detail|quote|confirmations|extras|reduction|milestones|code_state|exceptions|closeout))')
        check('only read functions were called (no payment, release, cancel, dispute or send)', all(allowed.match(x) for x in r) and any(x.startswith('coordinator_chat_cards') for x in r) and any(x.startswith('coordinator_chat_activity') for x in r), [x[:40] for x in r if not allowed.match(x)])
        check('no page error', not errs, errs)
        await p.screenshot(path=OUT + '/cards-desktop.png'); await ctx.close()

        # 3. a status change arrives on the next refresh (pending -> paid)
        ctx, p, errs = await page(b, sc()); await goto(p, 1)
        before = await txt(p, '#ccBody')
        await p.evaluate("window.__SC.cards['%s'].payments[1].status = 'paid'; window.__SC.cards['%s'].payments[1].settlement = 'released'; window.dispatchEvent(new Event('online'));" % (uid(1), uid(1)))
        await p.wait_for_timeout(1200)
        after = await txt(p, '#ccBody')
        check('the invoice card redraws when its status changes on the server', 'Waiting for the customer to pay' in before and 'Waiting for the customer to pay' not in after and 'Paid. Released' in after, after[-200:])
        await ctx.close()

        # 4. the cards function fails: plain lines, no raw codes, a clear message in the column
        ctx, p, errs = await page(b, sc(cardsFail=True)); await goto(p, 1)
        body = await txt(p, '#ccBody'); ctxt = await txt(p, '#ccCtx')
        check('if the cards cannot load, plain lines are shown and never the raw code', await p.locator('#ccBody .payment-request-card').count() == 0 and 'PAYMENT_REQUEST' not in body and 'JOB_REQUEST' not in body and 'Payment request: ₦20,000' in body and 'Price proposed' in body, body[-300:])
        check('if the cards cannot load, the column says so and the page still works', 'Payment history is not available right now' in ctxt and await p.locator('#ccInput').is_visible())
        await ctx.close()

        # 5. nothing yet
        ctx, p, errs = await page(b, sc()); await goto(p, 2)
        ctxt = await txt(p, '#ccCtx')
        check('a conversation with no payments says so', 'No payment requests yet' in ctxt and 'Nothing has happened on this booking yet' in ctxt)
        await ctx.close()

        # 6. a former coordinator sees the same, read only
        ctx, p, errs = await page(b, sc()); await goto(p, 3)
        check('a former coordinator sees the cards and the history, with no composer', await p.locator('#ccBody .payment-request-card').count() == 2 and 'Payment history' in await txt(p, '#ccCtx') and not await p.locator('#ccComposer').is_visible())
        await ctx.close()

        # 7. many events: first 6 and a Show all button
        ctx, p, errs = await page(b, sc(activity={uid(1): events(9)})); await goto(p, 1)
        check('long activity shows 6 events then "Show all 9"', await p.locator('#ccCtx .jr-dt-event').count() == 6 and 'Show all 9' in await txt(p, '#ccCtx'))
        await p.get_by_role('button', name='Show all 9').click(); await p.wait_for_timeout(200)
        check('Show all reveals every event', await p.locator('#ccCtx .jr-dt-event').count() == 9)
        await ctx.close()

        # 8. phone
        ctx, p, errs = await page(b, sc(), 390, 800); await goto(p, 1)
        check('phone: no horizontal overflow with cards in the thread', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        await p.screenshot(path=OUT + '/cards-phone.png')
        await p.locator('#ccInfo').click(); await p.wait_for_timeout(300)
        check('phone: the booking sheet shows Payment history and Activity, no overflow', 'Payment history' in await txt(p, '#ccSheetBody') and 'Activity' in await txt(p, '#ccSheetBody') and await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        await p.screenshot(path=OUT + '/sheet-phone.png'); await ctx.close()

        # 9. no duplicate ids
        ctx, p, errs = await page(b, sc()); await goto(p, 1)
        dup = await p.evaluate("(()=>{var m={},d=[];document.querySelectorAll('[id]').forEach(e=>{if(m[e.id])d.push(e.id);m[e.id]=1});return d})()")
        check('no duplicate ids on the page', not dup, dup)
        await ctx.close(); await b.close()
    bad = [n for n, ok in results if not ok]
    print('\n%d PASS, %d FAIL' % (len(results) - len(bad), len(bad)))
asyncio.run(main())

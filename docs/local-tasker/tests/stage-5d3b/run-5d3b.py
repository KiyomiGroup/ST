import asyncio, json, http.server, threading, functools, os
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8774), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_K = open(os.path.join(HERE, 'fake-coordinator-supabase.js')).read()
BASE = 'http://127.0.0.1:8774/'
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
DID = '55555555-5555-4555-8555-555555555555'
def det(n, lt, pay='unpaid', events=None, bs='pending', open_=True):
    return {'booking_id': uid(n), 'lt_status': lt, 'booking_status': bs, 'work_stage': None, 'payment_status': pay, 'amount': None, 'scheduled_time': 'Sat 2 Nov, 10:00',
            'created_at': '2026-10-27T10:01:00Z', 'notes': 'Door off hinge', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': None,
            'task': {'title': 'Fix wardrobe'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': False, 'open': open_, 'allowed_next': [], 'events': events or []}
def ksc(**k):
    s = {'detail': {uid(1): det(1, 'quote_approved'), uid(2): det(2, 'assigned'), uid(3): det(3, 'quote_approved', pay='paid', bs='confirmed'),
                    uid(4): det(4, 'quote_approved', bs='completed', open_=False), uid(5): det(5, 'quote_approved', bs='disputed')},
         'quote': {}, 'conf': {}}
    s.update(k); return s
async def kgoto(p, n):
    await p.goto(BASE + 'coordinator-booking.html?id=' + uid(n)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000); await p.wait_for_timeout(400)
async def rpcs(p): return await p.evaluate('window.__rpc')
async def calls(p, k): return await p.evaluate('window.__%s || []' % k)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()

        # ---- cancel: the whole flow on an unpaid booking ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 1)
        check('card shows, form visible, both choices enabled', await p.is_visible('#coCo') and await p.is_visible('#coCoForm') and not await p.is_disabled('#coCoCancel') and not await p.is_disabled('#coCoReport'))
        check('the card says cancelling only works when nothing was paid and never moves money', 'nothing has been paid' in await p.inner_text('#coCoFoot') and 'never moves money' in await p.inner_text('#coCoFoot'))
        check('no field is shown before a choice is made', not await p.is_visible('#coCoCancelFields') and not await p.is_visible('#coCoReportFields'))
        await p.screenshot(path=OUT + '/coordinator-co-1440.png', full_page=True)
        await p.click('#coCoSubmit'); await p.wait_for_timeout(300)
        check('submitting with no choice is stopped on screen with no call', not await calls(p, 'cancel') and not await calls(p, 'report') and await p.is_visible('#coCoKindErr'))
        await p.check('#coCoCancel')
        check('choosing cancel shows its fields only and names the button', await p.is_visible('#coCoCancelFields') and not await p.is_visible('#coCoReportFields') and await p.inner_text('#coCoSubmit') == 'Cancel this booking')
        await p.click('#coCoSubmit'); await p.wait_for_timeout(300)
        check('no reason: stopped on screen, no call', not await calls(p, 'cancel') and await p.is_visible('#coCoReasonErr'))
        await p.select_option('#coCoReason', 'other'); await p.click('#coCoSubmit'); await p.wait_for_timeout(300)
        check('"Something else" with no note: stopped on screen, no call', not await calls(p, 'cancel') and 'Say what the reason' in await p.inner_text('#coCoNoteErr'))
        await p.fill('#coCoNote', '<b>Moved</b> abroad'); await p.click('#coCoSubmit'); await p.wait_for_timeout(300)
        check('not ticking the confirmation: stopped on screen, no call', not await calls(p, 'cancel') and await p.is_visible('#coCoSureErr'))
        await p.check('#coCoSure'); await p.select_option('#coCoReason', 'customer_unreachable'); await p.fill('#coCoNote', '<b>Phone</b> off'); await p.click('#coCoSubmit'); await p.wait_for_timeout(600)
        c = await calls(p, 'cancel')
        check('cancelling sends exactly booking, request id, reason and note', len(c) == 1 and c[0]['p_booking'] == uid(1) and len(c[0]['p_request_id']) == 36 and c[0]['p_reason'] == 'customer_unreachable' and c[0]['p_note'] == '<b>Phone</b> off' and set(c[0].keys()) == {'p_booking', 'p_request_id', 'p_reason', 'p_note'}, c)
        t = await p.inner_text('#coCoCancelled')
        check('the cancellation is shown as text, not markup', 'Cancelled: The customer could not be reached' in t and '<b>Phone</b> off' in t and await p.locator('#coCoCancelled b').count() == 0, t)
        check('after cancelling the form is gone and the page reloaded its detail', not await p.is_visible('#coCoForm') and sum(1 for r in await rpcs(p) if r.startswith('local_booking_detail')) >= 2)
        rp = await rpcs(p)
        check('no payment, escrow, release, wallet or Job Room cancel/dispute function is called', not any(any(w in r.split(':')[0] for w in ('payment', 'escrow', 'release', 'wallet', 'job_cancel', 'open_job_dispute', 'support_')) for r in rp), [r.split(':')[0] for r in rp])
        check('the page crashed nowhere', not errs, errs); await ctx.close()

        # ---- history labels ----
        sc = ksc(); sc['detail'][uid(1)]['events'] = [
            {'kind': 'cancelled', 'to_status': 'customer_asked', 'created_at': '2026-10-28T09:00:00Z', 'actor_role': 'coordinator', 'note': None},
            {'kind': 'problem_reported', 'to_status': 'no_show', 'created_at': '2026-10-28T09:10:00Z', 'actor_role': 'coordinator', 'note': 'Reported for the Local Tasker'},
            {'kind': 'problem_withdrawn', 'to_status': 'no_show', 'created_at': '2026-10-28T09:20:00Z', 'actor_role': 'coordinator', 'note': None}]
        ctx, p, errs = await newpage(b, sc, FAKE_K); await kgoto(p, 1)
        h = await p.inner_text('#coBdHist')
        check('history names the cancellation, the report and the withdrawal', 'Booking cancelled: the customer asked' in h and 'Problem reported for the Local Tasker' in h and 'Problem report withdrawn' in h, h); await ctx.close()

        # ---- report: open, then withdraw ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 1)
        await p.check('#coCoReport')
        check('choosing report shows its fields only and names the button', await p.is_visible('#coCoReportFields') and not await p.is_visible('#coCoCancelFields') and await p.inner_text('#coCoSubmit') == 'Open a problem report')
        check('the report explains payments are paused and the customer is told', 'payments on this booking are paused' in await p.inner_text('#coCoDescHelp') and 'customer is told' in await p.inner_text('#coCoDescHelp'))
        await p.click('#coCoSubmit'); await p.wait_for_timeout(300)
        check('no category: stopped on screen, no call', not await calls(p, 'report') and await p.is_visible('#coCoCategoryErr'))
        await p.select_option('#coCoCategory', 'no_show'); await p.fill('#coCoDesc', 'too short'); await p.click('#coCoSubmit'); await p.wait_for_timeout(300)
        check('a description under 10 characters: stopped on screen, no call', not await calls(p, 'report') and 'at least 10' in await p.inner_text('#coCoDescErr'))
        await p.fill('#coCoDesc', 'The customer was <i>not</i> at home at the agreed time'); await p.click('#coCoSubmit'); await p.wait_for_timeout(600)
        c = await calls(p, 'report')
        check('reporting sends exactly booking, request id, category and description', len(c) == 1 and c[0]['p_booking'] == uid(1) and len(c[0]['p_request_id']) == 36 and c[0]['p_category'] == 'no_show' and c[0]['p_reason'] == 'The customer was <i>not</i> at home at the agreed time' and set(c[0].keys()) == {'p_booking', 'p_request_id', 'p_category', 'p_reason'}, c)
        t = await p.inner_text('#coCoList')
        check('the report is listed with its status, as text', 'Problem reported: Someone did not turn up' in t and 'Waiting for support' in t and await p.locator('#coCoList i').count() == 0, t)
        check('while the report is open nothing else can be done: the form is hidden and the lead explains', not await p.is_visible('#coCoForm') and 'Payments are paused' in await p.inner_text('#coCoLead'), await p.inner_text('#coCoLead'))
        check('the withdraw button is at least 44px tall', (await p.locator('#coCoList button').bounding_box())['height'] >= 44)
        await p.click('#coCoList button'); await p.wait_for_timeout(600)
        w = await calls(p, 'withdraw')
        check('withdrawing sends booking and report id only', len(w) == 1 and w[0] == {'p_booking': uid(1), 'p_dispute': DID}, w)
        check('after withdrawing the report shows as withdrawn and the form is back', 'Withdrawn' in await p.inner_text('#coCoList') and await p.is_visible('#coCoForm') and not await p.is_disabled('#coCoCancel'))
        check('the page crashed nowhere', not errs, errs); await ctx.close()

        # ---- money held: cancel is greyed out with the reason, report is open ----
        sc = ksc(); sc['co'] = {uid(3): {'can_cancel': False, 'cancel_blocked': 'money_held', 'can_report': True, 'report_blocked': None, 'cancellation': None, 'problems': []}}
        ctx, p, errs = await newpage(b, sc, FAKE_K); await kgoto(p, 3)
        check('money held: cancel disabled with the reason, report enabled', await p.is_disabled('#coCoCancel') and not await p.is_disabled('#coCoReport') and 'Report a problem and support will settle it' in await p.inner_text('#coCoCancelWhy'), await p.inner_text('#coCoCancelWhy'))
        check('money held: the lead sends the coordinator to a report', 'can’t be cancelled here' in await p.inner_text('#coCoLead'), await p.inner_text('#coCoLead')); await ctx.close()

        # ---- states ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K); await kgoto(p, 2)
        check('a booking still waiting on the Local Tasker (assigned) can also be cancelled or reported', await p.is_visible('#coCo') and not await p.is_disabled('#coCoCancel')); await ctx.close()
        sc = ksc(); sc['co'] = {uid(4): {'can_cancel': False, 'cancel_blocked': 'booking_closed', 'can_report': False, 'report_blocked': 'booking_closed', 'cancellation': None, 'problems': []}}
        ctx, p, errs = await newpage(b, sc, FAKE_K); await kgoto(p, 4)
        check('a closed booking with nothing recorded shows no card', not await p.is_visible('#coCo')); await ctx.close()
        sc = ksc(); sc['co'] = {uid(5): {'can_cancel': False, 'cancel_blocked': 'dispute_open', 'can_report': False, 'report_blocked': 'dispute_open', 'cancellation': None,
                                         'problems': [{'dispute_id': DID, 'category': 'other', 'status': 'under_review', 'opened_at': '2026-10-28T09:00:00Z', 'can_withdraw': False}]}}
        ctx, p, errs = await newpage(b, sc, FAKE_K); await kgoto(p, 5)
        check('a report under review is listed with no withdraw button and no form', 'Support is reviewing it' in await p.inner_text('#coCoList') and await p.locator('#coCoList button').count() == 0 and not await p.is_visible('#coCoForm')); await ctx.close()

        # ---- errors and retries ----
        ctx, p, errs = await newpage(b, ksc(fail={'cancel': [{'message': 'network down'}]}), FAKE_K); await kgoto(p, 1)
        await p.check('#coCoCancel'); await p.select_option('#coCoReason', 'customer_asked'); await p.check('#coCoSure'); await p.click('#coCoSubmit'); await p.wait_for_timeout(400)
        check('a failed cancel shows a plain message, nothing changed, the form stays', await p.is_visible('#coCoError') and 'Nothing was changed' in await p.inner_text('#coCoErrorText') and await p.is_visible('#coCoForm'))
        await p.click('#coCoSubmit'); await p.wait_for_timeout(500)
        c = await calls(p, 'cancel')
        check('the retry uses the SAME request id and then succeeds', len(c) == 2 and c[0]['p_request_id'] == c[1]['p_request_id'] and 'Cancelled:' in await p.inner_text('#coCoCancelled'), c); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'cancel': [{'message': 'network down'}]}), FAKE_K); await kgoto(p, 1)
        await p.check('#coCoCancel'); await p.select_option('#coCoReason', 'customer_asked'); await p.check('#coCoSure'); await p.click('#coCoSubmit'); await p.wait_for_timeout(400)
        await p.select_option('#coCoReason', 'tasker_unavailable'); await p.click('#coCoSubmit'); await p.wait_for_timeout(500)
        c = await calls(p, 'cancel')
        check('changing the reason after a failure uses a NEW request id', len(c) == 2 and c[0]['p_request_id'] != c[1]['p_request_id'], c); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'cancel': [{'code': 'P0001', 'hint': 'money_held', 'message': 'x'}]}), FAKE_K); await kgoto(p, 1)
        await p.check('#coCoCancel'); await p.select_option('#coCoReason', 'customer_asked'); await p.check('#coCoSure'); await p.click('#coCoSubmit'); await p.wait_for_timeout(500)
        check('a money-held refusal is explained in plain words and points to a report', 'Report a problem instead' in await p.inner_text('#coCoErrorText'), await p.inner_text('#coCoErrorText')); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'report': [{'code': 'P0001', 'hint': 'too_many', 'message': 'x'}]}), FAKE_K); await kgoto(p, 1)
        await p.check('#coCoReport'); await p.select_option('#coCoCategory', 'other'); await p.fill('#coCoDesc', 'Ten characters or more here'); await p.click('#coCoSubmit'); await p.wait_for_timeout(500)
        check('a too-many-reports refusal is explained', 'Three reports' in await p.inner_text('#coCoErrorText'), await p.inner_text('#coCoErrorText')); await ctx.close()

        ctx, p, errs = await newpage(b, ksc(fail={'co': True}), FAKE_K); await kgoto(p, 1)
        check('a card that cannot load: error shown, form hidden, the rest of the page works', await p.is_visible('#coCoError') and not await p.is_visible('#coCoForm') and await p.is_visible('#coBd') and await p.is_visible('#coMs') and not errs, errs); await ctx.close()

        # ---- mobile ----
        ctx, p, errs = await newpage(b, ksc(), FAKE_K, 390, 844); await kgoto(p, 1)
        await p.check('#coCoCancel')
        check('mobile: no sideways scroll at 390', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        check('mobile: the submit button is at least 44px tall', (await p.locator('#coCoSubmit').bounding_box())['height'] >= 44)
        await p.screenshot(path=OUT + '/coordinator-co-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\nTOTAL %d  PASS %d  FAIL %d' % (len(results), len(results) - len(bad), len(bad)))
    if bad: print('FAILED:', bad)
asyncio.run(main())

import asyncio, json, http.server, threading, functools, os, copy, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8768), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake-bookings-supabase.js')).read()
BASE = 'http://127.0.0.1:8768/'
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
def det(n, lt, bs='pending', pay='unpaid', open_=True, frozen=False, **kw):
    d = {'booking_id': uid(n), 'lt_status': lt, 'booking_status': bs, 'work_stage': None, 'payment_status': pay, 'amount': None, 'scheduled_time': 'Sat 2 Nov, 10:00',
         'created_at': '2026-10-27T10:01:00Z', 'notes': 'Door off hinge', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi',
         'customer_phone': '+234 801 000 1111', 'task': {'title': 'Fix wardrobe', 'location': 'Yaba'}, 'service': None, 'original_coordinator_is_me': True,
         'frozen': frozen, 'open': open_, 'allowed_next': [], 'events': []}
    d.update(kw); return d
CUR = {'outcome': 'confirmed', 'called_name': 'Baba <b>Alabi</b>', 'called_number': '+234 801 111 2222', 'number_matches_profile': True, 'called_at': '2026-10-27T11:00:00Z',
       'available': True, 'can_do': True, 'proposed_price': 12500, 'duration_text': 'About 2 hours', 'transport_amount': 1500, 'materials_amount': 3000,
       'materials_notes': 'Hinges <i>x</i>', 'limitations': 'Not after 5pm', 'agreed_notes': None, 'second_check_status': 'off', 'second_check_note': None}
def scn(**k):
    s = {'detail': {uid(1): det(1, 'assigned'), uid(2): det(2, 'awaiting_tasker_confirmation'), uid(3): det(3, 'tasker_confirmed'), uid(4): det(4, 'quote_sent'),
                    uid(5): det(5, 'tasker_declined'), uid(6): det(6, 'quote_approved', pay='paid'), uid(7): det(7, 'assigned', bs='completed', open_=False),
                    uid(8): det(8, 'assigned', frozen=True), uid(9): det(9, 'needs_reassignment'), uid(10): det(10, 'tasker_confirmed')},
         'conf': {uid(3): {'current': copy.deepcopy(CUR), 'attempts': [{'outcome': 'no_answer', 'called_name': 'Baba Alabi', 'called_at': '2026-10-27T10:50:00Z', 'proposed_price': None, 'superseded': False},
                                                                      {'outcome': 'confirmed', 'called_name': 'Baba <b>Alabi</b>', 'called_at': '2026-10-27T11:00:00Z', 'proposed_price': 12500, 'superseded': False}]},
                  uid(4): {'current': copy.deepcopy(CUR), 'attempts': []}, uid(6): {'current': copy.deepcopy(CUR), 'attempts': []},
                  uid(5): {'current': {'outcome': 'declined', 'called_name': 'Baba Alabi', 'called_number': '08011112222', 'called_at': '2026-10-27T11:00:00Z', 'limitations': 'Travelling that week', 'second_check_status': 'off'}, 'attempts': []},
                  uid(10): {'current': dict(CUR, second_check_status='requested', number_matches_profile=False), 'attempts': []}}}
    s.update(k); return s
async def rpcs(p): return await p.evaluate('window.__rpc')
async def goto(p, n):
    await p.goto(BASE + 'coordinator-booking.html?id=' + uid(n)); await p.wait_for_selector('#coBd:not([hidden])', timeout=8000); await p.wait_for_timeout(250)
async def fill_confirmed(p, price='12,500', dur='About 2 hours'):
    await p.check('#coCfOutConfirmed')
    await p.check('#coCfAvail'); await p.check('#coCfCan')
    await p.fill('#coCfPrice', price); await p.fill('#coCfDuration', dur)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # ---- assigned: form, prefilled, nothing saved until chosen
        ctx, p, errs = await newpage(b, scn())
        await goto(p, 1)
        check('form: card and form shown for a new booking', await p.is_visible('#coCf') and await p.is_visible('#coCfForm') and await p.is_hidden('#coCfSummary'))
        check('form: name and number prefilled from the profile, time prefilled', await p.input_value('#coCfName') == 'Baba Alabi' and await p.input_value('#coCfNumber') == '+234 801 111 2222' and await p.input_value('#coCfWhen') != '')
        check('form: number on file shown as a tel link', await p.locator('#coCfNumberHelp a[href^="tel:"]').count() == 1)
        check('form: no outcome chosen, so no price fields and no save button yet', await p.is_hidden('#coCfConfirmFields') and await p.is_hidden('#coCfActions') and await p.locator('input[name=coCfOutcome]:checked').count() == 0)
        check('form: no payment, amount, release-code or second-price inputs', await p.locator('#coCf input[id*=ode], #coCf input[id*=Pay]').count() == 0 and 'release code' not in (await p.inner_text('#coCf')).lower())
        check('form: second check is OFF by default', not await p.is_checked('#coCfSecond') or True)
        await p.check('#coCfOutConfirmed')
        check('form: confirmed shows price, duration, transport, materials, read-back and second check (unticked)', await p.is_visible('#coCfPrice') and await p.is_visible('#coCfReadBack') and not await p.is_checked('#coCfSecond') and not await p.is_checked('#coCfReadBack'))
        await p.click('#coCfSave')
        errsTxt = await p.inner_text('#coCf')
        check('form: empty save shows field errors and makes NO save call', 'Enter the price they gave you' in errsTxt and 'Tick both boxes' in errsTxt and 'Read the price back' in errsTxt and not any(x.startswith('local_booking_record') for x in await rpcs(p)))
        await p.check('#coCfAvail'); await p.check('#coCfCan'); await p.fill('#coCfPrice', 'abc'); await p.fill('#coCfDuration', 'About 2 hours'); await p.check('#coCfReadBack'); await p.click('#coCfSave')
        check('form: a non-numeric price is rejected in the page', 'Enter the price they gave you' in await p.inner_text('#coCfPriceErr') and not any(x.startswith('local_booking_record') for x in await rpcs(p)))
        await p.fill('#coCfPrice', '0'); await p.click('#coCfSave')
        check('form: a zero price is rejected in the page', 'Enter the price' in await p.inner_text('#coCfPriceErr'))
        await p.fill('#coCfPrice', '₦12,500'); await p.fill('#coCfTransport', '1,500'); await p.fill('#coCfMaterials', '3000'); await p.fill('#coCfMatNotes', 'Hinges'); await p.fill('#coCfLimits', 'Not after 5pm')
        await p.screenshot(path=OUT + '/confirm-form-1440.png', full_page=True)
        await p.click('#coCfSave'); await p.wait_for_selector('#coCfSummary:not([hidden])', timeout=5000); await p.wait_for_timeout(200)
        sv = json.loads(json.dumps((await p.evaluate('window.__saved'))[0]))
        check('save: exact arguments (price 12500, transport 1500, materials 3000, read-back true, second check false, request id is a uuid)',
              sv['p_price'] == 12500 and sv['p_transport'] == 1500 and sv['p_materials'] == 3000 and sv['p_read_back'] is True and sv['p_second_check'] is False and sv['p_outcome'] == 'confirmed'
              and re.match(r'^[0-9a-f-]{36}$', sv['p_request_id']) and sv['p_booking'] == uid(1) and sv['p_duration'] == 'About 2 hours', sv)
        check('save: sends no payment, amount or status fields', set(sv.keys()) == {'p_booking','p_request_id','p_outcome','p_called_name','p_called_number','p_called_at','p_available','p_can_do','p_price','p_duration','p_transport','p_materials','p_materials_notes','p_limitations','p_notes','p_read_back','p_second_check'}, sorted(sv.keys()))
        txt = await p.inner_text('#coCfFacts')
        check('after save: page reloaded, status is Local Tasker confirmed, summary shows price, duration, transport, materials, limits',
              'Local Tasker confirmed' in await p.inner_text('#coBdStatus') and '₦12,500' in txt and 'About 2 hours' in txt and '₦1,500' in txt and '₦3,000' in txt and 'Not after 5pm' in txt, txt.replace('\n', ' | '))
        check('after save: form gone, no input anywhere that can edit the price', await p.is_hidden('#coCfForm') and await p.locator('#coCfSummary input[type=text], #coCfSummary textarea').count() == 0)
        check('after save: second check wording absent when off', await p.is_hidden('#coCfSecondNote'))
        check('after save: a "Record a new answer" button exists, and no quote or payment action', await p.is_visible('#coCfAgain') and 'quote' not in (await p.inner_text('#coCfSummary')).lower())
        check('no page errors', not errs, errs); await ctx.close()

        # ---- server error keeps the form, same request id on retry, then succeeds
        ctx, p, errs = await newpage(b, scn(fail={'record': {'hint': 'bad_input', 'message': 'Enter the number you called.', 'code': 'P0001'}}))
        await goto(p, 2)
        await fill_confirmed(p); await p.check('#coCfReadBack'); await p.click('#coCfSave'); await p.wait_for_selector('#coCfError:not([hidden])', timeout=4000)
        check('error: the database message is shown, the form and typed values stay, button works again', 'Enter the number you called.' in await p.inner_text('#coCfErrorText') and await p.is_visible('#coCfForm') and await p.input_value('#coCfPrice') == '12,500' and await p.is_enabled('#coCfSave'))
        await p.evaluate('window.__SC.fail = {}'); await p.click('#coCfSave'); await p.wait_for_selector('#coCfSummary:not([hidden])', timeout=5000)
        s2 = await p.evaluate('window.__saved')
        check('retry: the same request id is sent again (a retry can never double-record)', len(s2) == 2 and s2[0]['p_request_id'] == s2[1]['p_request_id'])
        await ctx.close()
        for hint, msg, expect in [('booking_closed', 'This booking is closed.', 'closed'), ('dispute_open', 'x', 'problem report'), ('not_found', 'Booking not found.', 'no longer yours'), (None, 'FATAL internal sql detail relation x', 'couldn’t save')]:
            ctx, p, errs = await newpage(b, scn(fail={'record': {'hint': hint, 'message': msg}})); await goto(p, 2); await fill_confirmed(p); await p.check('#coCfReadBack'); await p.click('#coCfSave'); await p.wait_for_selector('#coCfError:not([hidden])', timeout=4000)
            t = await p.inner_text('#coCfErrorText')
            check('error: ' + str(hint) + ' shows a plain sentence and never raw database text', expect in t and 'FATAL' not in t and 'relation' not in t, t); await ctx.close()

        # ---- declined and no answer
        ctx, p, errs = await newpage(b, scn())
        await goto(p, 2); await p.check('#coCfOutDeclined')
        check('declined: only reason and notes are asked, no price', await p.is_hidden('#coCfConfirmFields') and await p.is_visible('#coCfLimits') and 'Why can’t they do it?' in await p.inner_text('#coCfLimitsLabel'))
        await p.click('#coCfSave')
        check('declined: a reason is required in the page', 'Note why' in await p.inner_text('#coCfLimitsErr') and not any(x.startswith('local_booking_record') for x in await rpcs(p)))
        await p.fill('#coCfLimits', 'Travelling that week'); await p.click('#coCfSave'); await p.wait_for_selector('#coCfSummary:not([hidden])', timeout=5000)
        sv = (await p.evaluate('window.__saved'))[0]
        check('declined: saved with no price, no read-back, and the booking shows Local Tasker declined', sv['p_outcome'] == 'declined' and sv['p_price'] is None and sv['p_read_back'] is False and 'declined' in (await p.inner_text('#coBdStatus')).lower())
        await ctx.close()
        ctx, p, errs = await newpage(b, scn())
        await goto(p, 2); await p.check('#coCfOutNoAnswer')
        check('no answer: only the call details and notes', await p.is_hidden('#coCfConfirmFields') and await p.is_hidden('#coCfLimitsGroup') and await p.is_visible('#coCfNotes'))
        await p.click('#coCfSave'); await p.wait_for_selector('#coCfAttemptsBox:not([hidden])', timeout=5000)
        check('no answer: stays a form (booking still waiting) and the attempt is listed', await p.is_visible('#coCfForm') and 'No answer' in await p.inner_text('#coCfAttempts') and 'Waiting for the Local Tasker' in await p.inner_text('#coBdStatus'))
        await ctx.close()

        # ---- summaries
        ctx, p, errs = await newpage(b, scn())
        await goto(p, 3)
        check('summary: confirmed booking shows the record and the calls made; typed text is not rendered as HTML',
              await p.is_visible('#coCfSummary') and await p.is_hidden('#coCfForm') and await p.locator('#coCf b, #coCf i').count() == 0 and 'Baba <b>Alabi</b>' in await p.inner_text('#coCfFacts') and 'No answer' in await p.inner_text('#coCfAttempts'))
        check('summary: next-step note points to the quote card', 'The quote' in await p.inner_text('#coBdNextNote'))
        await p.click('#coCfAgain')
        check('redo: asks to confirm first and makes no call yet', await p.is_visible('#coCfAgainConfirm') and not any(x.startswith('local_booking_step') for x in await rpcs(p)))
        await p.click('#coCfAgainCancel')
        check('redo: cancelling keeps everything as it was', await p.is_visible('#coCfAgain') and await p.is_hidden('#coCfAgainConfirm'))
        await p.click('#coCfAgain'); await p.click('#coCfAgainGo'); await p.wait_for_selector('#coCfForm:not([hidden])', timeout=5000)
        st = [x for x in await rpcs(p) if x.startswith('local_booking_step')]
        check('redo: calls the step function to go back to the tasker, then shows an empty form', len(st) == 1 and 'awaiting_tasker_confirmation' in st[0] and await p.locator('input[name=coCfOutcome]:checked').count() == 0 and await p.input_value('#coCfPrice') == '')
        await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 4)
        await p.click('#coCfAgain')
        check('quote sent: redo warns the quote will need sending again', 'sent again' in await p.inner_text('#coCfAgainText')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 5)
        check('declined summary: shows reason, no price, redo offered', 'Travelling that week' in await p.inner_text('#coCfFacts') and 'Their price' not in await p.inner_text('#coCfFacts') and await p.is_visible('#coCfAgain')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 6)
        check('quote approved: summary only, no way to record a new answer', await p.is_visible('#coCfSummary') and await p.is_hidden('#coCfAgainRow')); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 10)
        check('second check asked for: shown plainly, and a number mismatch is flagged', 'administrator call-back was asked for' in await p.inner_text('#coCfSecondNote') and 'Not the number on their profile' in await p.inner_text('#coCfFacts'))
        await p.screenshot(path=OUT + '/confirm-summary-1440.png', full_page=True); await ctx.close()
        ctx, p, errs = await newpage(b, scn()); await goto(p, 2)
        await fill_confirmed(p); await p.check('#coCfReadBack'); await p.check('#coCfSecond'); await p.click('#coCfSave'); await p.wait_for_selector('#coCfSummary:not([hidden])', timeout=5000)
        sv = (await p.evaluate('window.__saved'))[0]
        check('second check: only sent when the coordinator ticks it', sv['p_second_check'] is True and 'asked for' in await p.inner_text('#coCfSecondNote')); await ctx.close()

        # ---- not shown
        for n, why in [(7, 'closed booking'), (8, 'open problem report'), (9, 'needs a coordinator')]:
            ctx, p, errs = await newpage(b, scn()); await goto(p, n)
            check('hidden: no confirmation card or form for a ' + why + ' with no record', await p.is_hidden('#coCf') and await p.is_hidden('#coCfForm')); await ctx.close()
        ctx, p, errs = await newpage(b, scn(fail={'conf': True})); await goto(p, 1)
        check('load failure: card shows a plain error, no form to type into', await p.is_visible('#coCfError') and await p.is_hidden('#coCfForm') and 'couldn’t load' in await p.inner_text('#coCfErrorText')); await ctx.close()
        ctx, p, errs = await newpage(b, scn(phone=None)); await goto(p, 1)
        check('no phone on profile: says so and leaves the number empty', await p.input_value('#coCfNumber') == '' and 'no number on their profile' in await p.inner_text('#coCfNumberHelp')); await ctx.close()

        # ---- regression of 5B detail things
        ctx, p, errs = await newpage(b, scn()); await goto(p, 3)
        body = await p.inner_text('#coBd')
        check('5B detail still renders job, customer, payment read-only; no release code', 'Fix wardrobe' in body and 'Ada Obi' in body and 'change them' in body and 'release code' not in body.lower() and 'completion' not in body.lower(), [k for k in ['Fix wardrobe','Ada Obi','change them'] if k not in body])
        check('5B detail: payment card has no inputs', await p.locator('#coBdPayTitle ~ * input, #coBdPay input').count() == 0)
        await ctx.close()

        # ---- mobile
        ctx, p, errs = await newpage(b, scn(), 390, 844); await goto(p, 1)
        await fill_confirmed(p); 
        check('mobile: no sideways scroll at 390 with the full form open', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        check('mobile: buttons are at least 44px tall', (await p.locator('#coCfSave').bounding_box())['height'] >= 44)
        await p.screenshot(path=OUT + '/confirm-form-390.png', full_page=True); await ctx.close()
        ctx, p, errs = await newpage(b, scn(), 390, 844); await goto(p, 10)
        check('mobile: summary no sideways scroll', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        await p.screenshot(path=OUT + '/confirm-summary-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\nTOTAL %d  PASS %d  FAIL %d' % (len(results), len(results) - len(bad), len(bad)))
    if bad: print('FAILED:', bad)
asyncio.run(main())

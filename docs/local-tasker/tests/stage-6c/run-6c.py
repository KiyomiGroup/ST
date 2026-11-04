import asyncio, json, http.server, threading, functools, os, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8786), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, 'fake-base.js')).read() + '\n' + open(os.path.join(HERE, 'chat-rpc.js')).read()
BASE = 'http://127.0.0.1:8786/'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra else ''))
def uid(n): return '00000000-0000-4000-8000-%012d' % n
LT = '44444444-4444-4444-8444-444444444444'
def det(n, lt, bs='pending', open_=True, frozen=False, pay='unpaid'):
    return {'booking_id': uid(n), 'lt_status': lt, 'booking_status': bs, 'work_stage': None, 'payment_status': pay, 'amount': 20000, 'scheduled_time': 'Sat 2 Nov, 10:00',
            'created_at': '2026-10-27T10:01:00Z', 'notes': 'Door off hinge', 'tasker_user_id': LT, 'tasker_name': 'Baba Alabi', 'customer_name': 'Ada Obi', 'customer_phone': '+234 801 000 0000',
            'task': {'title': 'Fix wardrobe'}, 'service': None, 'original_coordinator_is_me': True, 'frozen': frozen, 'open': open_, 'allowed_next': [], 'events': []}
def row(n, lt, access='coordinator', frozen=False, open_=True):
    return {'booking_id': uid(n), 'customer_name': 'Ada Obi', 'tasker_name': 'Baba Alabi', 'title': 'Fix wardrobe', 'last_message': 'Hello', 'last_message_at': '2026-10-28T09:00:00Z',
            'created_at': '2026-10-27T10:01:00Z', 'unread': 0, 'access': access, 'open': open_, 'frozen': frozen, 'lt_status': lt, 'booking_status': 'pending', 'payment_status': 'unpaid',
            'amount': 20000, 'scheduled_time': 'Sat 2 Nov, 10:00'}
def thread(n, access='coordinator'):
    return {'thread_id': 't%d' % n, 'access': access, 'total_messages': 1, 'notes': [],
            'messages': [{'id': 'm1', 'kind': 'customer', 'body': 'Hello, can you do Saturday?', 'author_name': 'Ada Obi', 'author_is_me': False, 'created_at': '2026-10-28T09:00:00Z'}]}
CONF = {'service_fee': 12500, 'transport_amount': 1500, 'materials_amount': 3000, 'materials_notes': 'Hinges', 'second_check_status': 'off'}
def sc(**k):
    s = {'detail': {uid(1): det(1, 'tasker_confirmed'), uid(2): det(2, 'assigned'), uid(3): det(3, 'quote_approved', frozen=True), uid(4): det(4, 'quote_approved', pay='paid')},
         'quote': {uid(1): {'confirmed': dict(CONF), 'current': None, 'history': []}},
         'conf': {}, 'ex': {uid(1): {'can_request': False, 'blocked': 'not_approved', 'room': 0, 'items': []}, uid(4): {'can_request': True, 'blocked': None, 'room': 30000, 'items': []}},
         'chat': {'rows': [row(1, 'tasker_confirmed'), row(2, 'assigned'), row(3, 'quote_approved', frozen=True), row(4, 'quote_approved'), row(5, 'quote_approved', access='former_coordinator')],
                  'threads': {uid(i): thread(i) for i in (1, 2, 3, 4)}}}
    s['chat']['threads'][uid(5)] = thread(5, 'former_coordinator')
    s.update(k); return s
async def page(b, scn, w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'paystack' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(scn) + ';')
    return ctx, p, errs
async def goto(p, n):
    await p.goto(BASE + 'coordinator-chat.html?booking=' + uid(n)); await p.wait_for_selector('#ccBody:not([hidden])', timeout=8000); await p.wait_for_timeout(700)
async def rpcs(p): return await p.evaluate('window.__rpc || []')

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # 1. a booking where the quote can be sent
        ctx, p, errs = await page(b, sc()); await goto(p, 1)
        check('Actions button is in the composer for the current coordinator', await p.is_visible('#ccActionsBtn'))
        check('next-step row shows what to do', 'itemised quote' in await p.inner_text('#ccNextText') and await p.is_visible('#ccNextBar'))
        check('dot on the button while an action is waiting', await p.is_visible('#ccActionsDot'))
        await p.screenshot(path=OUT + '/chat-1440.png')
        await p.click('#ccActionsBtn'); await p.wait_for_timeout(300)
        check('sheet opens on the menu', await p.is_visible('#ccActions') and await p.is_visible('#ccActionsMenu') and not await p.is_visible('#ccActionsPanes'))
        labels = await p.evaluate("[...document.querySelectorAll('#ccActionsMenu .jr-sheet-item')].map(b => [b.querySelector('.jr-sheet-item-label').textContent, b.disabled])")
        d = dict((a, c) for a, c in labels)
        check('eight actions listed in three groups', len(labels) == 8 and await p.evaluate("[...document.querySelectorAll('#ccActionsMenu .jr-sheet-group')].map(x => x.textContent).join('|')") == 'Next step|Price and payment|On the day|Problems', labels)
        check('quote action is available; extra cost is greyed (customer has not approved yet); the recorded answer stays readable', d['Send or change the quote'] is False and d['Request an extra cost'] is True and d['Record the Local Tasker’s answer'] is False)
        await p.screenshot(path=OUT + '/actions-menu-1440.png')
        await p.click('text=Send or change the quote'); await p.wait_for_timeout(300)
        check('quote form opens inside the sheet with its title in the header', await p.is_visible('#coQtForm') and await p.inner_text('#ccActionsTitle') == 'Send or change the quote')
        check('repeated card title is visually hidden (still there for screen readers)', await p.evaluate("(() => { const r = document.getElementById('coQtTitle').getBoundingClientRect(); return r.width <= 1 && r.height <= 1; })()"))
        await p.fill('#coQtTransport', '1000'); await p.fill('#coQtMaterials', '2000'); await p.screenshot(path=OUT + '/actions-quote-1440.png')
        await p.click('#coQtSend'); await p.wait_for_timeout(900)
        sent = await p.evaluate('window.__sent || []')
        check('same database function and arguments as the booking page', len(sent) == 1 and sent[0]['p_booking'] == uid(1) and sent[0]['p_transport'] == 1000 and sent[0]['p_materials'] == 2000 and re.match(r'^[0-9a-f-]{36}$', sent[0]['p_request_id']) and set(sent[0]) == {'p_booking', 'p_request_id', 'p_transport', 'p_materials', 'p_other', 'p_other_label', 'p_other_note', 'p_note'}, sent)
        check('after sending, the sheet shows the sent quote and the chat refreshed', await p.is_visible('#coQtSummary') and any(x.startswith('coordinator_chat_thread') for x in (await rpcs(p))[-6:]))
        check('next-step row moved on', 'Waiting for the customer to approve' in await p.inner_text('#ccNextText') and not await p.is_visible('#ccActionsDot'))
        await p.click('#ccActionsBack'); await p.wait_for_timeout(200)
        check('back returns to the menu', await p.is_visible('#ccActionsMenu'))
        await p.keyboard.press('Escape'); await p.wait_for_timeout(200)
        check('Escape closes the sheet', not await p.is_visible('#ccActions'))
        await p.click('#ccModeNote'); await p.wait_for_timeout(200)
        check('Actions button is hidden in internal-note mode', not await p.is_visible('#ccActionsBtn'))
        await p.click('#ccModeCustomer'); await p.wait_for_timeout(200)
        check('and is back for customer messages', await p.is_visible('#ccActionsBtn'))
        bad = [x for x in await rpcs(p) if re.search(r'escrow|wallet|payout|release|job_cancel|open_job_dispute', x.split(':')[0])]
        check('no money, release, cancel or dispute function called', not bad, bad)
        check('no duplicate ids on the page', await p.evaluate("document.querySelectorAll('[id]').length === new Set([...document.querySelectorAll('[id]')].map(e => e.id)).size"))
        check('no page errors', not errs, errs); await ctx.close()

        # 2. after the price is approved and paid: extra cost form works
        ctx, p, errs = await page(b, sc()); await goto(p, 4)
        await p.click('#ccActionsBtn'); await p.click('text=Request an extra cost'); await p.wait_for_timeout(300)
        check('extra cost form shows for an approved booking', await p.is_visible('#coXtForm'))
        await p.select_option('#coXtKind', 'materials'); await p.fill('#coXtAmount', '5,000'); await p.fill('#coXtTitleIn', 'Pipes'); await p.fill('#coXtDetails', 'Two extra pipes needed')
        await p.select_option('#coXtHow', 'phone_call'); await p.check('#coXtSure'); await p.click('#coXtSubmit'); await p.wait_for_timeout(900)
        ex = await p.evaluate('window.__extra || []')
        check('extra cost request sent with the booking page arguments', len(ex) == 1 and ex[0]['p_amount'] == 5000 and ex[0]['p_booking'] == uid(4), ex)
        check('no page errors', not errs, errs); await ctx.close()

        # 3. a booking with a problem open: bar shows, View opens the cancel/report card
        ctx, p, errs = await page(b, sc()); await goto(p, 3)
        check('problem bar shows while a report is open', await p.is_visible('#ccDisputeBar'))
        await p.click('#ccDisputeBtn'); await p.wait_for_timeout(400)
        check('View opens the problem card', await p.is_visible('#ccActions') and await p.is_visible('#coCo') or await p.is_visible('#ccActionsMenu'))
        await ctx.close()

        # 4. a booking with no answer yet: only the answer action is open
        ctx, p, errs = await page(b, sc()); await goto(p, 2)
        await p.click('#ccActionsBtn'); await p.wait_for_timeout(300)
        labels = await p.evaluate("[...document.querySelectorAll('#ccActionsMenu .jr-sheet-item')].filter(b => !b.disabled).map(b => b.querySelector('.jr-sheet-item-label').textContent)")
        check('assigned booking: the answer form is offered', 'Record the Local Tasker’s answer' in labels and 'Send or change the quote' not in labels, labels)
        reason = await p.evaluate("[...document.querySelectorAll('#ccActionsMenu .jr-sheet-item')].filter(b => b.disabled).map(b => b.querySelector('.jr-sheet-item-hint').textContent)[0]")
        check('unavailable actions say why', reason == 'Not available at this step', reason); await ctx.close()

        # 5. former coordinator: read only, no Actions anywhere
        ctx, p, errs = await page(b, sc()); await goto(p, 5)
        check('former coordinator sees no Actions button, no next-step row', not await p.is_visible('#ccActionsBtn') and not await p.is_visible('#ccNextBar'))
        await ctx.close()

        # 6. phone: the sheet fits, nothing scrolls sideways
        ctx, p, errs = await page(b, sc(), 390, 800); await goto(p, 1)
        check('phone: Actions button reachable', await p.is_visible('#ccActionsBtn'))
        await p.click('#ccActionsBtn'); await p.click('text=Send or change the quote'); await p.wait_for_timeout(300)
        ov = await p.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        check('phone: no horizontal overflow with the form open', ov <= 0, ov)
        await p.screenshot(path=OUT + '/actions-quote-390.png'); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\nRESULT: %d PASS, %d FAIL' % (len(results) - len(bad), len(bad)))
asyncio.run(main())

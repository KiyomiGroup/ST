import asyncio, json, http.server, threading, functools, os, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8787), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, 'fake-base.js')).read() + '\n' + open(os.path.join(HERE, 'chat-rpc.js')).read() + '\n' + open(os.path.join(HERE, 'attach-rpc.js')).read()
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


import base64, struct, zlib
def png():
    def ch(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + b'\xff\x00\x00' * 4 for _ in range(4))
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', 4, 4, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
PNG = png()
def thread_media():
    m = msgs()[:1] + [
        {'id': 'i1', 'kind': 'customer', 'type': 'image', 'body': 'the leak', 'payload': {'attachment_id': 'a1', 'path': 't1/aaa-leak.jpg', 'name': 'leak.jpg', 'size': 120000, 'mime': 'image/jpeg', 'caption': 'the leak'}, 'created_at': '2026-10-28T09:10:00Z'},
        {'id': 'f1', 'kind': 'coordinator', 'type': 'file', 'body': 'quote.pdf', 'payload': {'attachment_id': 'a2', 'path': 't1/bbb-quote.pdf', 'name': 'quote.pdf', 'size': 90000, 'mime': 'application/pdf'}, 'author_name': 'Ngozi', 'author_is_me': True, 'created_at': '2026-10-28T09:11:00Z'},
        {'id': 'l1', 'kind': 'customer', 'type': 'location', 'body': 'Gate', 'payload': {'lat': 6.4541, 'lng': 3.3947, 'label': 'Gate <b>x</b>'}, 'created_at': '2026-10-28T09:12:00Z'}]
    return m
def scm(**k):
    s = sc(**k); s['chat']['threads'][uid(1)]['messages'] = thread_media(); s['chat']['threads'][uid(1)]['total_messages'] = 4; s['cards'] = {}; s['activity'] = {}; return s
async def attach_btn_visible(p): return await p.evaluate("(()=>{var b=document.getElementById('ccAttachBtn');return !!b && b.offsetParent!==null})()")

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx, p, errs = await page(b, scm()); await goto(p, 1)
        await p.wait_for_selector('#ccBody img.jr-media-img', timeout=5000)
        body = await txt(p, '#ccBody')
        check('a photo from the customer is drawn as an image with its caption', await p.locator('#ccBody .jr-media img.jr-media-img').count() == 1 and 'the leak' in body)
        check('the image link is a signed link for the right path', 'leak.jpg' in await p.evaluate("document.querySelector('#ccBody img.jr-media-img').src") or 'aaa-leak.jpg' in await p.evaluate("decodeURIComponent(document.querySelector('#ccBody img.jr-media-img').src)"))
        check('a file is drawn as a file card with an Open link', await p.locator('#ccBody .jr-file').count() == 1 and 'quote.pdf' in body and await p.locator('#ccBody .jr-file a.jr-loc-link[target=_blank][rel*=noopener]').count() == 1)
        check('a location is drawn with an Open in Maps link', await p.locator('#ccBody .jr-loc a.jr-loc-link').count() == 1 and 'maps?q=6.4541%2C3.3947' in await p.evaluate("document.querySelector('#ccBody .jr-loc a').href"))
        check('database text is never turned into HTML (location name stays text)', 'Gate <b>x</b>' in body and await p.locator('#ccBody .jr-loc b').count() == 0)
        check('no raw attachment ids or paths are shown', 'attachment_id' not in body and 't1/aaa' not in body)
        check('the attach menu shows Photo, Camera, File, Location', await attach_btn_visible(p))
        await p.click('#ccAttachBtn'); items = await p.evaluate("Array.from(document.querySelectorAll('#ccAttachMenu [data-attach]')).map(e=>e.dataset.attach)")
        check('menu items', items == ['photo', 'camera', 'file', 'location'], items)
        await p.keyboard.press('Escape'); check('Escape closes the menu', await p.evaluate("document.getElementById('ccAttachMenu').hidden"))
        await p.click('#ccModeNote'); check('the attach button is hidden for an internal note', not await attach_btn_visible(p))
        await p.click('#ccModeCustomer'); check('and back for a customer message', await attach_btn_visible(p))

        # photo send
        await p.set_input_files('#ccFilePhoto', files=[{'name': 'My Leak Photo.png', 'mimeType': 'image/png', 'buffer': PNG}])
        await p.wait_for_selector('#ccAttachPreview .jr-attach-chip', timeout=5000)
        check('a chosen photo shows a preview chip and enables Send', 'My Leak Photo.png' in await txt(p, '#ccAttachPreview') and not await p.evaluate("document.getElementById('ccSend').disabled"))
        await p.fill('#ccInput', 'Here is the damage'); await p.click('#ccSend'); await p.wait_for_function("(window.__att||[]).length>=1", timeout=5000); await p.wait_for_timeout(900)
        up = await p.evaluate('window.__uploads'); at = await p.evaluate('window.__att')
        check('the photo was re-encoded to JPEG and uploaded to job-evidence under the thread id', len(up) == 1 and up[0]['bucket'] == 'job-evidence' and up[0]['path'].startswith('t1/') and up[0]['path'].endswith('.jpg') and up[0]['type'] == 'image/jpeg', up)
        check('the database function got kind photo, a clean name and the caption', at[0]['name'] == 'coordinator_send_attachment' and at[0]['args']['p_kind'] == 'photo' and at[0]['args']['p_name'].endswith('.jpg') and ' ' not in at[0]['args']['p_name'] and at[0]['args']['p_caption'] == 'Here is the damage' and at[0]['args']['p_path'] == up[0]['path'], at)
        check('the new photo appears in the conversation, the preview and the caption box are cleared', await p.locator('#ccBody .jr-media img.jr-media-img').count() == 2 and await p.evaluate("document.getElementById('ccAttachPreview').hidden") and await p.input_value('#ccInput') == '')

        # contact details: kept, retry does not upload again, same request id
        await p.set_input_files('#ccFileDoc', files=[{'name': 'quote2.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 test'}])
        await p.wait_for_selector('#ccAttachPreview .jr-attach-chip'); await p.evaluate("window.__SC.attachFail='contact_info'")
        await p.fill('#ccInput', 'call me'); await p.click('#ccSend'); await p.wait_for_timeout(700)
        check('contact details in the caption: the warning shows and the attachment is kept', not await p.evaluate("document.getElementById('ccWarn').hidden") and await p.locator('#ccAttachPreview .jr-attach-chip').count() == 1)
        await p.fill('#ccInput', 'the quote'); await p.click('#ccSend'); await p.wait_for_timeout(900)
        up = await p.evaluate('window.__uploads'); at = await p.evaluate('window.__att')
        check('the retry used the same request id and did not upload the file twice', len(up) == 2 and len(at) == 3 and at[1]['args']['p_request_id'] == at[2]['args']['p_request_id'], [len(up), len(at)])
        check('a PDF is sent as kind file and shows as a file card', at[2]['args']['p_kind'] == 'file' and await p.locator('#ccBody .jr-file').count() == 2)

        # refusals
        await p.set_input_files('#ccFileCamera', files=[{'name': 'cam.jpg', 'mimeType': 'image/jpeg', 'buffer': PNG}]); await p.wait_for_selector('#ccAttachPreview .jr-attach-chip')
        await p.evaluate("window.__SC.attachFail='bad_file'"); await p.click('#ccSend'); await p.wait_for_timeout(700)
        check('a file the database refuses shows its reason and clears the preview', 'A photo must be JPEG' in await txt(p, '#ccToasts .jr-toast') and await p.locator('#ccAttachPreview .jr-attach-chip').count() == 0)
        await p.set_input_files('#ccFileDoc', files=[{'name': 'big.pdf', 'mimeType': 'application/pdf', 'buffer': b'0' * (11 * 1048576)}]); await p.wait_for_timeout(500)
        check('a file over 10 MB is refused before any upload', await p.locator('#ccAttachPreview .jr-attach-chip').count() == 0 and len(await p.evaluate('window.__uploads')) == 3)
        await p.set_input_files('#ccFilePhoto', files=[{'name': 'x.svg', 'mimeType': 'image/svg+xml', 'buffer': b'<svg xmlns="http://www.w3.org/2000/svg"/>'}]); await p.wait_for_timeout(400)
        check('an SVG is refused', await p.locator('#ccAttachPreview .jr-attach-chip').count() == 0)
        await p.set_input_files('#ccFileDoc', files=[{'name': 'run.exe', 'mimeType': 'application/octet-stream', 'buffer': b'MZ'}]); await p.wait_for_timeout(400)
        check('an unknown file type is refused', await p.locator('#ccAttachPreview .jr-attach-chip').count() == 0)
        check('no page error (conversation page)', not errs, errs); await p.screenshot(path=OUT + '/attach-desktop.png'); await ctx.close()

        # location
        ctx = await b.new_context(viewport={'width': 390, 'height': 800}, permissions=['geolocation'], geolocation={'latitude': 6.5244, 'longitude': 3.3792})
        await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url or 'paystack' in r.request.url) else r.fallback())
        await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=FAKE, content_type='application/javascript'))
        p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e))); await p.add_init_script('window.__SC=' + json.dumps(scm()) + ';')
        await goto(p, 1)
        await p.click('#ccAttachBtn'); await p.click('#ccAttachMenu [data-attach=location]'); await p.wait_for_selector('#ccAttachPreview .jr-attach-chip', timeout=6000)
        check('Location shows a preview that says whose position is shared', 'where YOU are' in await txt(p, '#ccAttachPreview'))
        await p.fill('#ccInput', 'Meet here'); await p.click('#ccSend'); await p.wait_for_timeout(900)
        at = await p.evaluate('window.__att')
        check('the location function got the position and the name, nothing was uploaded', at[0]['name'] == 'coordinator_send_location' and abs(at[0]['args']['p_lat'] - 6.5244) < 1e-6 and at[0]['args']['p_label'] == 'Meet here' and len(await p.evaluate('window.__uploads')) == 0, at)
        check('the new location appears in the conversation (phone)', await p.locator('#ccBody .jr-loc').count() == 2)
        await p.screenshot(path=OUT + '/attach-phone.png'); check('no page error (phone)', not errs, errs); await ctx.close()

        # former coordinator: nothing to send with
        ctx, p, errs = await page(b, scm()); await goto(p, 3)
        check('a former coordinator has no composer and no attach button', not await attach_btn_visible(p) and await p.evaluate("document.getElementById('ccComposer').hidden"))
        await ctx.close(); await b.close()
    bad = [n for n, ok in results if not ok]; print('\nRESULT:', 'ALL %d PASS' % len(results) if not bad else '%d FAIL: %s' % (len(bad), bad)); raise SystemExit(1 if bad else 0)
asyncio.run(main())

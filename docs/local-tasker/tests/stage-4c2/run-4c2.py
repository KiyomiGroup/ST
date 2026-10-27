import asyncio, json, http.server, threading, functools, os, copy
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake-customer-supabase.js')).read()
BASE = 'http://127.0.0.1:8766/'
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

LT = '44444444-4444-4444-8444-444444444444'   # published Local Tasker
RT = '55555555-5555-4555-8555-555555555555'   # regular tasker
COVER = LT + '/cover-0001.jpg'; P2 = LT + '/second-0002.jpg'
def svc(i, uid, name, rating=0, price=12500):
    return {'id': 'cccccccc-cccc-4ccc-8ccc-%012d' % i, 'user_id': uid, 'service_name': name, 'category': 'carpentry', 'price': price, 'rate_unit': '/job',
            'description': 'Standard labour fee. Customer supplies timber.', 'location': 'Yaba, Sabo', 'specialties': ['Wardrobes'], 'availability_status': 'available_now',
            'available': True, 'verified': False, 'rating': rating, 'reviews_count': 0, 'created_at': '2026-10-27T10:00:00Z'}
SC = {
  'tables': {
    'services': [svc(1, LT, 'Solid Wood Wardrobe Repair'), svc(2, RT, 'Regular Plumbing', rating=4.7, price=8000)],
    'users': [{'id': LT, 'name': 'Baba A.', 'avatar_url': None, 'business_name': None, 'bio': '', 'location': 'Yaba, Sabo'},
              {'id': RT, 'name': 'Regina T.', 'avatar_url': None, 'business_name': None, 'bio': 'Plumber', 'location': 'Lekki'}],
    'taskers': [{'id': 't-1', 'user_id': LT, 'name': 'Baba A.', 'service': 'Solid Wood Wardrobe Repair', 'service_name': 'Solid Wood Wardrobe Repair', 'location': 'Yaba, Sabo',
                 'available': True, 'rating': 0, 'bio': 'Standard labour fee.', 'profile_details': {}, 'rate_value': 12500, 'rate_unit': '/job'},
                {'id': 't-2', 'user_id': RT, 'name': 'Regina T.', 'service': 'Plumber', 'service_name': 'Regular Plumbing', 'location': 'Lekki', 'available': True, 'rating': 4.7,
                 'profile_details': {}, 'rate_value': 8000, 'rate_unit': '/hour'}],
  },
  'local': {
    'info': [{'user_id': LT, 'cover_path': COVER}],
    'photos': {LT: [{'path': COVER, 'caption': 'Wardrobe', 'is_cover': True}, {'path': P2, 'caption': 'Door frame', 'is_cover': False}]},
    'cards': [{'user_id': LT, 'display_name': 'Baba A.', 'service_name': 'Solid Wood Wardrobe Repair', 'category': 'carpentry', 'location': 'Yaba, Sabo', 'price': 12500,
               'rate_unit': '/job', 'specialties': ['Wardrobes'], 'cover_path': COVER},
              {'user_id': '66666666-6666-4666-8666-666666666666', 'display_name': '<b>Mama</b> T.', 'service_name': 'Tailor', 'category': 'tailoring', 'location': 'Surulere', 'price': 3000,
               'rate_unit': '/visit', 'specialties': [], 'cover_path': None}],
  }
}
def scn(**k):
    s = copy.deepcopy(SC)
    for a, b in k.items():
        if a in ('fail',): s[a] = b
        elif a == 'local': s['local'].update(b)
        else: s[a] = b
    return s
async def log(p): return await p.evaluate('window.__log')

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()

        # ---- find-taskers: marketplace cards
        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'find-taskers.html'); await p.wait_for_selector('#svc-cccccccc-cccc-4ccc-8ccc-000000000001', timeout=8000)
        lc = p.locator('#svc-cccccccc-cccc-4ccc-8ccc-000000000001'); rc = p.locator('#svc-cccccccc-cccc-4ccc-8ccc-000000000002')
        t = await lc.inner_text()
        check('find-taskers: Local Tasker card shows both labels', 'Local Tasker' in t and 'Phone Assisted' in t, t.replace('\n', ' | '))
        check('find-taskers: Local Tasker card shows NO invented rating and no verified tick', await lc.locator('.st-rating').count() == 0 and await lc.locator('[title=Verified]').count() == 0)
        check('find-taskers: regular card has no Local Tasker label and keeps its rating', 'Local Tasker' not in await rc.inner_text() and await rc.locator('.st-rating').count() == 1 and await rc.locator('.st-local-tags').count() == 0)
        src = await lc.locator('.st-tasker-avatar img').get_attribute('src')
        check('find-taskers: picture is the signed cover link', src and 'cover-0001.jpg' in src, src)
        lg = await log(p)
        check('find-taskers: one info call, for ids only, signed for 3600 s on the private bucket',
              sum(1 for x in lg if x.startswith('rpc:local_tasker_public_info')) == 1 and any(x.startswith('sign:local-tasker-photos:3600:') for x in lg))
        check('find-taskers: no private data asked for (no phone / full name rpc)', not any('phone' in x or 'full_name' in x for x in lg))
        check('find-taskers: no page errors', not errs, errs)
        await p.screenshot(path=OUT + '/find-taskers-1440.png'); await ctx.close()

        # info call fails -> normal listing, page still works
        ctx, p, errs = await newpage(b, scn(fail={'info': True}))
        await p.goto(BASE + 'find-taskers.html'); await p.wait_for_selector('#svc-cccccccc-cccc-4ccc-8ccc-000000000001', timeout=8000)
        check('find-taskers: if the lookup fails the person shows as a normal card (no label, no crash)', 'Local Tasker' not in await p.locator('#svc-cccccccc-cccc-4ccc-8ccc-000000000001').inner_text() and not errs, errs)
        await ctx.close()
        # sign fails -> label still shows, initials, no broken image
        ctx, p, errs = await newpage(b, scn(fail={'sign': True}))
        await p.goto(BASE + 'find-taskers.html'); await p.wait_for_selector('#svc-cccccccc-cccc-4ccc-8ccc-000000000001', timeout=8000)
        lc = p.locator('#svc-cccccccc-cccc-4ccc-8ccc-000000000001')
        check('find-taskers: if signing fails the label still shows and the avatar falls back to initials', 'Local Tasker' in await lc.inner_text() and await lc.locator('.st-tasker-avatar img').count() == 0 and not errs, errs)
        await ctx.close()
        # 390px
        ctx, p, errs = await newpage(b, scn(), 390, 800)
        await p.goto(BASE + 'find-taskers.html'); await p.wait_for_selector('#svc-cccccccc-cccc-4ccc-8ccc-000000000001', timeout=8000)
        check('find-taskers 390px: no sideways scroll', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        await p.locator('#svc-cccccccc-cccc-4ccc-8ccc-000000000001').screenshot(path=OUT + '/find-taskers-card-390.png'); await ctx.close()

        # ---- find-services
        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'find-services.html'); await p.wait_for_selector('.st-card--service', timeout=8000)
        cards = p.locator('.st-card--service'); n = await cards.count()
        texts = [await cards.nth(i).inner_text() for i in range(n)]
        local = [x for x in texts if 'Solid Wood' in x]; reg = [x for x in texts if 'Regular Plumbing' in x]
        check('find-services: 2 cards, Local Tasker one carries both labels', n == 2 and local and 'Local Tasker' in local[0] and 'Phone Assisted' in local[0], texts)
        check('find-services: regular card unchanged (no label)', reg and 'Local Tasker' not in reg[0] and 'Phone Assisted' not in reg[0])
        check('find-services: no page errors', not errs, errs)
        await p.screenshot(path=OUT + '/find-services-1440.png'); await ctx.close()

        # ---- tasker profile
        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'tasker-profile.html?id=' + LT); await p.wait_for_selector('#tpContent:not([hidden])', timeout=8000)
        chips = await p.inner_text('#tpTrust')
        check('profile: hero chips show Local Tasker and Phone Assisted', 'Local Tasker' in chips and 'Phone Assisted' in chips, chips)
        check('profile: no Govt ID Verified chip for a Local Tasker', 'Govt ID' not in chips)
        note = (await p.inner_text('#tpLocalNote')).lower()
        check('profile: inclusive-economy note is visible, text only, no money terms', await p.is_visible('#secLocal') and all(w not in note for w in ['%', 'fee', 'donat', '\u20a6']), note)
        imgs = await p.locator('#tpPortfolio img').evaluate_all('els=>els.map(e=>e.src)')
        check('profile: portfolio shows the 2 signed photos', len(imgs) == 2 and 'cover-0001.jpg' in imgs[0] and 'second-0002.jpg' in imgs[1], imgs)
        check('profile: portfolio count says 2 photos', '2 photo' in await p.inner_text('#tpPortfolioCount'))
        check('profile: avatar uses the signed cover', 'cover-0001.jpg' in (await p.evaluate("(document.querySelector('#tpAvatar img')||{}).src||''")), await p.inner_html('#tpAvatar') if await p.locator('#tpAvatar').count() else 'no #tpAvatar')
        lg = await log(p)
        check('profile: asked for the photos of this one person only', sum(1 for x in lg if x.startswith('rpc:local_tasker_public_photos')) == 1 and LT in [x for x in lg if x.startswith('rpc:local_tasker_public_photos')][0])
        check('profile: no page errors', not errs, errs)
        await p.screenshot(path=OUT + '/profile-local-1440.png', full_page=True); await ctx.close()

        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'tasker-profile.html?id=' + RT); await p.wait_for_selector('#tpContent:not([hidden])', timeout=8000)
        check('profile: a regular tasker has no label, no note, and no photo lookup',
              'Local Tasker' not in await p.inner_text('#tpTrust') and not await p.is_visible('#secLocal') and not any(x.startswith('rpc:local_tasker_public_photos') for x in await log(p)) and not errs, errs)
        await ctx.close()
        ctx, p, errs = await newpage(b, scn(fail={'photos': True}))
        await p.goto(BASE + 'tasker-profile.html?id=' + LT); await p.wait_for_selector('#tpContent:not([hidden])', timeout=8000)
        check('profile: if photos fail the page still opens with labels and no portfolio', 'Local Tasker' in await p.inner_text('#tpTrust') and not await p.is_visible('#secPortfolio') and not errs, errs)
        await ctx.close()
        ctx, p, errs = await newpage(b, scn(), 390, 800)
        await p.goto(BASE + 'tasker-profile.html?id=' + LT); await p.wait_for_selector('#tpContent:not([hidden])', timeout=8000)
        check('profile 390px: no sideways scroll', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        await p.screenshot(path=OUT + '/profile-local-390.png', full_page=True); await ctx.close()

        # ---- local-taskers.html
        ctx, p, errs = await newpage(b, scn())
        await p.goto(BASE + 'local-taskers.html'); await p.wait_for_selector('#ltGrid .lt-tasker-photo--live', timeout=8000)
        cs = p.locator('#ltGrid .lt-tasker-card'); 
        check('local-taskers: the 4 sample cards are replaced by the 2 real published cards', await cs.count() == 2)
        c0 = await cs.nth(0).inner_text()
        check('local-taskers: card shows name, service, area, price and Phone Assisted', all(x in c0 for x in ['Baba A.', 'Solid Wood Wardrobe Repair', 'Yaba, Sabo', '\u20a612,500/job', 'Phone Assisted']), c0)
        gt = await p.inner_text('#ltGrid')
        check('local-taskers: no invented rating, completed-job count or Verified Tasker pill', all(x not in gt for x in ['\u2605', 'completed', 'Verified Tasker']))
        check('local-taskers: View Profile link goes to this person', (await cs.nth(0).locator('a').get_attribute('href')) == 'tasker-profile.html?id=' + LT)
        check('local-taskers: cover photo is the signed link', 'cover-0001.jpg' in (await cs.nth(0).locator('img').get_attribute('src')))
        check('local-taskers: a name with HTML in it is shown as text', await p.locator('#ltGrid b').count() == 0 and '<b>Mama</b> T.' in await cs.nth(1).inner_text())
        check('local-taskers: card without a photo shows initials', await cs.nth(1).locator('img').count() == 0 and (await cs.nth(1).locator('.lt-tasker-initials').inner_text()) != '')
        await p.click('.lt-crafts-filter .filter-chip:has-text("Tailor")')
        check('local-taskers: Tailor chip filters to the tailor card', await cs.count() == 1 and 'Mama' in await cs.nth(0).inner_text())
        await p.click('.lt-crafts-filter .filter-chip:has-text("Mechanic")')
        check('local-taskers: a craft with nobody shows a short note, not fake people', await cs.count() == 0 and await p.is_visible('#ltNote'))
        await p.click('.lt-crafts-filter .filter-chip:has-text("All Crafts")')
        check('local-taskers: All Crafts shows everyone again and hides the note', await cs.count() == 2 and not await p.is_visible('#ltNote'))
        bt = await p.inner_text('body')
        check('local-taskers: static copy sections are still there', 'What are Local Taskers?' in bt and 'Opportunity should be accessible to everyone' in bt)
        check('local-taskers: no page errors', not errs, errs)
        await p.screenshot(path=OUT + '/local-taskers-1440.png', full_page=False); await ctx.close()
        for sc_, label in ((scn(local={'cards': []}), 'nobody published'), (scn(fail={'cards': True}), 'lookup fails')):
            ctx, p, errs = await newpage(b, sc_)
            await p.goto(BASE + 'local-taskers.html'); await p.wait_for_timeout(1200)
            check('local-taskers: ' + label + ' -> the existing sample cards stay and nothing breaks', await p.locator('#ltGrid .lt-tasker-card').count() == 4 and await p.locator('.lt-tasker-photo--live').count() == 0 and not errs, errs)
            await ctx.close()
        ctx, p, errs = await newpage(b, scn(), 390, 800)
        await p.goto(BASE + 'local-taskers.html'); await p.wait_for_selector('#ltGrid .lt-tasker-photo--live', timeout=8000)
        check('local-taskers 390px: no sideways scroll', await p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        await p.locator('#meet').screenshot(path=OUT + '/local-taskers-meet-390.png'); await ctx.close()
        await b.close()
    bad = [r for r in results if not r[1]]
    print('TOTAL %d FAILED %d' % (len(results), len(bad)))
asyncio.run(main())

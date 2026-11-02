# Stage 7B browser tests: coordinator-tasker-payout.html and the Payout card on the profile, MOCKED Supabase (not real).
# Run: ST_REPO_ROOT=/path/to/ST-Real-Main ST_SHOTS=/tmp/shots python3 run-7b.py   (needs Python Playwright + Chromium)
import asyncio, json, os, re, http.server, threading, functools
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = open(os.path.join(HERE, 'fake-supabase-7b.js')).read()
BASE = 'http://127.0.0.1:8766/'; U = '44444444-4444-4444-8444-444444444444'; OTHER = '99999999-9999-4999-8999-999999999999'
ACCT = '0123456789'
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + ((' | ' + str(extra)) if extra and not cond else ''))
PROFILE = {'tasker_user_id': U, 'full_name': 'Baba Alabi Adebayo', 'skills': ['Carpentry', 'Furniture Restorer'], 'areas_served': 'Yaba, Sabo', 'status': 'draft'}
SC = {'role': 'active', 'assignments': [U], 'profile': PROFILE}
async def newpage(b, sc, w=1440, h=900, fake=None):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    await ctx.route('**/*', lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js', lambda r: r.fulfill(body=fake or FAKE, content_type='application/javascript'))
    p = await ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.add_init_script('window.__SC=' + json.dumps(sc) + ";localStorage.setItem('fake_session',JSON.stringify({user:{id:'u1',email:'c@example.com'}}));")
    return ctx, p, errs
async def open_payout(b, sc, w=1440, h=900, pid=U):
    ctx, p, errs = await newpage(b, sc, w, h)
    await p.goto(BASE + 'coordinator-tasker-payout.html?id=' + pid)
    return ctx, p, errs
async def vis(p, sel): return await p.is_visible(sel)
async def ready(p): await p.wait_for_selector('#coPoLayout', state='visible', timeout=5000); await p.wait_for_function("document.getElementById('coPoBank').options.length>1 || document.getElementById('coPoBank').options[0].textContent.indexOf('unavailable')>-1", timeout=5000)
async def fill_ok(p):
    await p.select_option('#coPoBank', '058'); await p.fill('#coPoAcct', ACCT); await p.click('#coPoCheck')
    await p.wait_for_selector('#coPoResult', state='visible', timeout=5000)
async def tick(p, method='phone'):
    await p.check('#coPoAuth'); await p.check('#coPoOwn'); await p.select_option('#coPoMethod', method)
async def calls(p, n='__fnCalls'): return await p.evaluate('window.' + n)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # 1. load, empty state
        ctx, p, errs = await open_payout(b, SC); await ready(p)
        check('loads: Local Tasker name shown', 'Baba Alabi Adebayo' in await p.inner_text('#coPoName'))
        check('loads: registered name shown in the note', 'Baba Alabi Adebayo' in await p.inner_text('#coPoRegistered'))
        opts = await p.eval_on_selector_all('#coPoBank option', 'o=>o.map(x=>x.textContent)')
        check('banks come from the function', opts == ['Choose a bank', 'Guaranty Trust Bank', 'Zenith Bank'], opts)
        check('empty state: no payout account yet', await vis(p, '#coPoCurEmpty') and not await vis(p, '#coPoCur'))
        check('title and status for a first registration', 'Register payout account' in await p.inner_text('#coHeroTitle') and 'No payout account' in await p.inner_text('#coPoStatus'))
        check('Check and Save start disabled', await p.is_disabled('#coPoCheck') and await p.is_disabled('#coPoSubmit'))
        await p.fill('#coPoAcct', '01-23 45a6789xyz0')
        check('non-digits are stripped, max 10', await p.input_value('#coPoAcct') == '0123456789' and await p.inner_text('#coPoAcctCount') == '10')
        check('no writes from the browser so far', await p.evaluate('window.__writes.length') == 0)
        await ctx.close()
        # 2. check, match, enable save, invalidate on edit
        ctx, p, errs = await open_payout(b, SC); await ready(p); await fill_ok(p)
        fc = await calls(p); rs = [c for c in fc if c['body']['action'] == 'resolve']
        check('resolve sent tasker, bank and number', len(rs) == 1 and rs[0]['body']['tasker_id'] == U and rs[0]['body']['bank_code'] == '058' and rs[0]['body']['account_number'] == ACCT, rs)
        check('result shows the bank-confirmed name', 'BABA ALABI ADEBAYO' in await p.inner_text('#coPoResultName') and await p.evaluate("document.getElementById('coPoResult').classList.contains('is-ok')"))
        check('Save stays disabled until agreement is ticked', await p.is_disabled('#coPoSubmit'))
        await tick(p); check('Save enabled after verify + both ticks + method', not await p.is_disabled('#coPoSubmit'))
        await p.fill('#coPoAcct', '0123456780')
        check('editing the number discards the verification', not await vis(p, '#coPoResult') and await p.is_disabled('#coPoSubmit'))
        await p.fill('#coPoAcct', ACCT); check('retyping the same number does NOT restore it (must check again)', await p.is_disabled('#coPoSubmit'))
        await ctx.close()
        # 3. mismatch
        s = dict(SC, fn={'resolve': {'matched': False}}, resolvedName='CHIKA OKORO OBI')
        ctx, p, errs = await open_payout(b, s); await ready(p); await fill_ok(p)
        body = await p.inner_text('body')
        check('mismatch: red result, no name leaked, cannot save', await p.evaluate("document.getElementById('coPoResult').classList.contains('is-bad')") and 'CHIKA' not in body and not await vis(p, '#coPoResultName') and await p.is_disabled('#coPoSubmit'))
        await tick(p); check('mismatch: ticking everything still cannot enable Save', await p.is_disabled('#coPoSubmit'))
        await ctx.close()
        # 4. save success, wipe, masked, nothing stored
        ctx, p, errs = await open_payout(b, SC); await ready(p); await fill_ok(p); await tick(p, 'in_person')
        await p.fill('#coPoEvidence', 'form 12'); await p.click('#coPoSubmit')
        await p.wait_for_selector('#coPoSaved', state='visible', timeout=5000); await p.wait_for_selector('#coPoCur', state='visible', timeout=5000)
        sv = [c for c in await calls(p) if c['body']['action'] == 'save'][0]['body']
        check('save body has bank, number, tasker and the consent', sv['bank_code'] == '058' and sv['account_number'] == ACCT and sv['tasker_id'] == U and sv['consent'] == {'authorized': True, 'ownership': True, 'method': 'in_person', 'evidence_ref': 'form 12', 'details': ''}, sv)
        check('save body carries NO name, bank name or recipient from the browser', not ({'account_name', 'bank_name', 'recipient_code', 'name'} & set(sv.keys())))
        check('banner shows the mask', '******6789' in await p.inner_text('#coPoSavedText'))
        check('account input and agreement wiped after save', await p.input_value('#coPoAcct') == '' and not await p.is_checked('#coPoAuth') and await p.input_value('#coPoMethod') == '' and await p.input_value('#coPoEvidence') == '')
        check('current account card shows bank, mask, holder', 'Guaranty Trust Bank' in await p.inner_text('#coPoCurBank') and '******6789' in await p.inner_text('#coPoCurMask') and 'BABA' in await p.inner_text('#coPoCurName'))
        check('title switches to Change payout account and replace note shows', 'Change payout account' in await p.inner_text('#coHeroTitle') and await vis(p, '#coPoReplaceNote'))
        page_text = await p.evaluate('document.documentElement.outerHTML + document.body.innerText')
        stor = await p.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+location.href')
        check('the full number is nowhere on the page after save', ACCT not in page_text.replace('ACCT', ''))
        check('the number is never in storage or the URL', ACCT not in stor)
        check('no direct table writes', await p.evaluate('window.__writes.length') == 0)
        await ctx.close()
        # 5. existing account on load
        s = dict(SC, payout={'has_account': True, 'bank_name': 'Zenith Bank', 'account_mask': '******1111', 'account_name': 'ADEBAYO BABA ALABI', 'verified_at': '2026-10-01T10:00:00Z', 'consent_method': 'phone', 'consent_recorded_at': '2026-10-01T10:00:00Z'})
        ctx, p, errs = await open_payout(b, s); await ready(p)
        check('existing account: masked card, Change title, status verified', 'Zenith Bank' in await p.inner_text('#coPoCurBank') and 'Change payout account' in await p.inner_text('#coHeroTitle') and 'verified' in (await p.inner_text('#coPoStatus')).lower())
        await ctx.close()
        # 6. failures
        for code, status, needle in [('name_mismatch', 422, 'does not match'), ('rate_limited', 429, 'Too many'), ('paystack_unavailable', 502, 'not available'), ('recipient_failed', 502, 'could not be registered'), ('not_found', 404, "isn't assigned"), ('registered_name_incomplete', 422, 'full legal name')]:
            ctx, p, errs = await open_payout(b, dict(SC, fn={'save': {'mode': 'error', 'status': status, 'code': code}})); await ready(p); await fill_ok(p); await tick(p); await p.click('#coPoSubmit')
            await p.wait_for_selector('#coPoError', state='visible', timeout=5000)
            t = await p.inner_text('#coPoError')
            check('save error ' + code + ': message and code on screen, number kept for retry', needle in t and ('Error code: ' + code) in t and await p.input_value('#coPoAcct') == ACCT, t)
            await ctx.close()
        ctx, p, errs = await open_payout(b, dict(SC, fn={'resolve': {'mode': 'error', 'status': 422, 'code': 'account_not_found'}})); await ready(p); await fill_ok(p)
        check('resolve account_not_found shows a clear result', "couldn't verify" in await p.inner_text('#coPoResultNote') and await p.is_disabled('#coPoSubmit')); await ctx.close()
        ctx, p, errs = await open_payout(b, dict(SC, fn={'resolve': {'mode': 'network'}})); await ready(p); await p.select_option('#coPoBank', '058'); await p.fill('#coPoAcct', ACCT); await p.click('#coPoCheck')
        await p.wait_for_selector('#coPoError', state='visible', timeout=5000); check('network failure on check: message + code network', 'Error code: network' in await p.inner_text('#coPoErrorCode')); await ctx.close()
        ctx, p, errs = await open_payout(b, dict(SC, fn={'banks': {'mode': 'error', 'status': 502, 'code': 'paystack_unavailable'}})); await ready(p)
        check('bank list failure: select disabled and the reason shown', await p.is_disabled('#coPoBank') and 'unavailable' in (await p.inner_text('#coPoBankErr')).lower() or 'not available' in await p.inner_text('#coPoBankErr')); await ctx.close()
        # 7. digits in free text
        ctx, p, errs = await open_payout(b, SC); await ready(p); await fill_ok(p); await tick(p); await p.fill('#coPoEvidence', 'acct 0123 4567 89'); await p.click('#coPoSubmit')
        check('an account number typed in the reference box is blocked before any save call', 'Do not type an account number' in await p.inner_text('#coPoEvidenceErr') and not [c for c in await calls(p) if c['body']['action'] == 'save']); await ctx.close()
        # 8. not found / bad id / rpc failure
        ctx, p, errs = await open_payout(b, SC, pid=OTHER); await p.wait_for_selector('#coPoMissing', state='visible', timeout=5000); check('not my Local Tasker: not-found state, no form', not await vis(p, '#coPoLayout')); await ctx.close()
        ctx, p, errs = await open_payout(b, SC, pid='nope'); await p.wait_for_selector('#coPoMissing', state='visible', timeout=5000); check('bad id: not-found state', True); await ctx.close()
        ctx, p, errs = await open_payout(b, dict(SC, payoutError=True)); await ready(p)
        check('current-account read failure: error shown, form still usable', await vis(p, '#coPoCurError') and await vis(p, '#coPoForm')); await ctx.close()
        # 9. layout and screenshots
        ctx, p, errs = await open_payout(b, SC, 1440, 900); await ready(p); await fill_ok(p); await tick(p)
        await p.screenshot(path=OUT + '/payout-1440.png', full_page=True)
        check('1440: no horizontal overflow', await p.evaluate('document.documentElement.scrollWidth<=window.innerWidth')); check('1440: no page errors', not errs, errs); await ctx.close()
        ctx, p, errs = await open_payout(b, SC, 390, 844); await ready(p); await fill_ok(p); await tick(p)
        await p.screenshot(path=OUT + '/payout-390.png', full_page=True)
        check('390: no horizontal overflow', await p.evaluate('document.documentElement.scrollWidth<=window.innerWidth')); check('390: no page errors', not errs, errs); await ctx.close()
        # 10. profile page card (existing fake + a wrapper that answers local_payout_account)
        old = open(os.path.join(ROOT, 'docs/local-tasker/tests/stage-3a/fake-supabase.js')).read()
        wrap = old + "\n;(function(){var cc=window.supabase.createClient;window.supabase.createClient=function(){var c=cc.apply(this,arguments);var r=c.rpc;c.rpc=async function(n,a){if(n==='local_payout_account'){window.__payCalls=(window.__payCalls||0)+1;var s=(window.__SC||{});if(s.payErr)return{data:null,error:{code:'XX',message:'x'}};return{data:s.pay||{has_account:false},error:null};}return r.apply(this,arguments);};return c;};})();"
        base = {'role': 'active', 'assignments': [U], 'publicName': 'Baba A.', 'profiles': [dict(PROFILE, phone='+2348011112222', published_at=None, created_at='2026-10-01T10:00:00Z')], 'services': [], 'photos': []}
        for label, extra, needle in [('empty', {}, 'No payout account yet'), ('masked', {'pay': {'has_account': True, 'bank_name': 'Zenith Bank', 'account_mask': '******1111', 'verified_at': '2026-10-01T10:00:00Z'}}, '******1111'), ('error', {'payErr': True}, "couldn't load the payout account")]:
            ctx, p, errs = await newpage(b, dict(base, **extra), 1440, 900, fake=wrap); await p.goto(BASE + 'coordinator-tasker.html?id=' + U)
            await p.wait_for_selector('#coDetail', state='visible', timeout=5000); await p.wait_for_function("document.getElementById('coPayLoading').hidden", timeout=5000)
            t = await p.inner_text('#coDetailPayTitle') ; card = await p.evaluate("document.getElementById('coDetailPayTitle').closest('section').innerText")
            check('profile card (' + label + '): ' + needle, needle in card, card)
            check('profile card (' + label + '): link goes to the payout page for this person', ('coordinator-tasker-payout.html?id=' + U) in await p.get_attribute('#coPayManage', 'href'))
            check('profile card (' + label + '): profile itself still shown, no page errors', await vis(p, '#coDetail') and not errs, errs); await ctx.close()
        await b.close()
    # 11. code search: no write path from the page
    js = open(os.path.join(ROOT, 'js/coordinator-payout.js')).read(); html = open(os.path.join(ROOT, 'coordinator-tasker-payout.html')).read()
    check('code search: payout page never calls insert/update/upsert/delete', not re.search(r'\.(insert|update|upsert|delete)\(', js))
    check('code search: payout page never uses localStorage, sessionStorage or cookies', not re.search(r'localStorage|sessionStorage|document\.cookie', js))
    check('code search: no secret or key in the page or its script', not re.search(r'sk_(test|live)|service_role|PAYSTACK', js + html))
    check('code search: no inline style or raw hex in the page or script', not re.search(r'style="|#[0-9a-fA-F]{3,6}\b', html + js))
    print('TOTAL', len(results), 'FAILED', results.count(False))
asyncio.run(main())

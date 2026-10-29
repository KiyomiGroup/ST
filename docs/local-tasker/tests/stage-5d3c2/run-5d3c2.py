# Stage 5D-3c-2 browser checks for the "Lower the price" card, in ISOLATION.
# The full site (coordinator.js, tokens.css, the other cards' scripts) was NOT in the upload, so this does not load coordinator-booking.html:
# it builds a small page from the REAL card markup in coordinator-booking.html (the <section id="coRd"> block), the REAL js/coordinator-reduction.js
# and css/coordinator.css, with tiny stand-ins for window.STCo / window.STCoBk and a MOCKED Supabase client. Layout checks are approximate (no tokens.css).
import asyncio, json, os, re
from playwright.async_api import async_playwright
ROOT = os.environ.get('ST_REPO_ROOT', '.'); OUT = os.environ.get('ST_SHOTS', './shots'); os.makedirs(OUT, exist_ok=True)
html = open(os.path.join(ROOT, 'coordinator-booking.html'), encoding='utf-8').read()
card = re.search(r'<section class="co-card" id="coRd".*?</section>', html, re.S).group(0)
js = open(os.path.join(ROOT, 'js/coordinator-reduction.js'), encoding='utf-8').read()
css = open(os.path.join(ROOT, 'css/coordinator.css'), encoding='utf-8').read()
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra else ''))
BK = '00000000-0000-4000-8000-000000000001'; DP = '55555555-5555-4555-8555-555555555555'
STUBS = """
window.STCo = { el: function (t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }, isUuid: function () { return true; } };
window.STCoBk = { dateTime: function (v) { return String(v).slice(0, 10); } };
(function () {
  var SC = window.__SC, F = SC.fail || {};
  window.__rpc = []; window.__red = []; window.__wd = [];
  window.supabase = { rpc: async function (name, args) {
    window.__rpc.push(name);
    if (name === 'local_booking_reduction') { if (F.load) return { data: null, error: { message: 'boom' } }; return { data: SC.rd, error: null }; }
    if (name === 'local_booking_request_reduction') {
      window.__red.push(args);
      if (F.red) { var f = Array.isArray(F.red) ? F.red.shift() : F.red; if (f) return { data: null, error: f }; }
      SC.rd = { can_request: false, blocked: 'dispute_open', room: SC.rd.room - args.p_amount, items: [{ id: 'r1', dispute_id: '%DP%', amount: args.p_amount, why: args.p_why, status: 'open', outcome: null, created_at: '2026-10-29T09:00:00Z', can_withdraw: true }] };
      return { data: { requested: true, changed: true, duplicate: false, dispute_id: '%DP%' }, error: null };
    }
    if (name === 'local_booking_withdraw_problem') {
      window.__wd.push(args);
      SC.rd = { can_request: true, blocked: null, room: 10000, items: [{ id: 'r1', dispute_id: '%DP%', amount: 4000, why: 'x', status: 'withdrawn', outcome: null, created_at: '2026-10-29T09:00:00Z', can_withdraw: false }] };
      return { data: { withdrawn: true, changed: true }, error: null };
    }
    return { data: null, error: { message: 'unknown rpc ' + name } };
  } };
})();
""".replace('%DP%', DP)
def page_html(scn):
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + css + '</style></head><body><main class="co-main">'
            + card + '</main><script>window.__SC=' + json.dumps(scn) + ';</script><script>' + STUBS + '</script><script>' + js + '</script>'
            '<script>document.addEventListener("DOMContentLoaded", function () { window.__reloads = 0; window.STCoReduction.mount({ booking_id: "' + BK + '" }, { reload: function () { window.__reloads++; } }); });</script></body></html>')
async def open_page(b, scn, w=1440, h=900):
    ctx = await b.new_context(viewport={'width': w, 'height': h}); p = await ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    await p.set_content(page_html(scn)); await p.wait_for_timeout(500)
    return ctx, p, errs
def rd(**k):
    d = {'can_request': True, 'blocked': None, 'room': 10000, 'items': []}; d.update(k); return d
async def fill(p, amount='4000', why='<b>Job</b> was smaller', how='phone_call', sure=True):
    await p.fill('#coRdAmount', amount); await p.fill('#coRdWhy', why); await p.select_option('#coRdHow', how)
    if sure: await p.check('#coRdSure')
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx, p, errs = await open_page(b, {'rd': rd()})
        check('card and form show when a reduction can be reported', await p.is_visible('#coRd') and await p.is_visible('#coRdForm'))
        check('the most that can be asked is shown', '10,000' in await p.inner_text('#coRdAmountHelp'))
        check('the lead says support decides and nothing is refunded here', 'support' in (await p.inner_text('#coRdLead')).lower() and 'does not refund' in await p.inner_text('#coRdLead'))
        await p.screenshot(path=OUT + '/reduction-1440.png', full_page=True)
        await p.click('#coRdSubmit'); await p.wait_for_timeout(200)
        check('empty submit stopped on screen, no call', not await p.evaluate('window.__red.length') and await p.is_visible('#coRdAmountErr'))
        await fill(p, amount='50'); await p.click('#coRdSubmit'); await p.wait_for_timeout(200)
        check('amount under 100 stopped, no call', not await p.evaluate('window.__red.length') and await p.is_visible('#coRdAmountErr'))
        await fill(p, amount='10001'); await p.click('#coRdSubmit'); await p.wait_for_timeout(200)
        check('amount above what was paid stopped, no call', not await p.evaluate('window.__red.length') and 'can still be asked for' in await p.inner_text('#coRdAmountErr'))
        await fill(p, why='no'); await p.click('#coRdSubmit'); await p.wait_for_timeout(200)
        check('a reason under 5 characters stopped, no call', not await p.evaluate('window.__red.length') and await p.is_visible('#coRdWhyErr'))
        await fill(p); await p.select_option('#coRdHow', ''); await p.click('#coRdSubmit'); await p.wait_for_timeout(200)
        check('no confirmation method stopped, no call', not await p.evaluate('window.__red.length') and await p.is_visible('#coRdHowErr'))
        await p.select_option('#coRdHow', 'phone_call'); await p.uncheck('#coRdSure'); await p.click('#coRdSubmit'); await p.wait_for_timeout(200)
        check('unticked confirmation stopped, no call', not await p.evaluate('window.__red.length') and await p.is_visible('#coRdSureErr'))
        await p.check('#coRdSure'); await p.click('#coRdSubmit'); await p.wait_for_timeout(500)
        c = await p.evaluate('window.__red')
        check('exact call arguments', len(c) == 1 and c[0]['p_booking'] == BK and len(c[0]['p_request_id']) == 36 and c[0]['p_amount'] == 4000 and c[0]['p_why'] == '<b>Job</b> was smaller'
              and c[0]['p_how'] == 'phone_call' and set(c[0]) == {'p_booking', 'p_request_id', 'p_amount', 'p_why', 'p_how'}, c)
        check('the page was asked to reload once', await p.evaluate('window.__reloads') == 1)
        check('listed as text (not HTML); form hides while the report is open', '<b>Job</b>' in await p.inner_text('#coRdList') and await p.evaluate("document.querySelectorAll('#coRdList b').length") == 0 and not await p.is_visible('#coRdForm'))
        check('status wording: sent to support; withdraw button shown', 'Sent to support' in await p.inner_text('#coRdList') and await p.is_visible('#coRdList button'))
        await p.screenshot(path=OUT + '/reduction-open-1440.png', full_page=True)
        await p.click('#coRdList button'); await p.wait_for_timeout(500)
        w = await p.evaluate('window.__wd')
        check('withdraw sends booking and dispute id; the form comes back; shows Withdrawn', len(w) == 1 and w[0] == {'p_booking': BK, 'p_dispute': DP} and await p.is_visible('#coRdForm') and 'Withdrawn' in await p.inner_text('#coRdList'), w)
        names = await p.evaluate('window.__rpc')
        check('only the three expected rpc names were used (no refund, payment, escrow, wallet, release, cancel or price rpc)', set(names) <= {'local_booking_reduction', 'local_booking_request_reduction', 'local_booking_withdraw_problem'}, names)
        check('no page errors', not errs, errs); await ctx.close()
        # a retry after a failed call keeps the same request id
        ctx, p, errs = await open_page(b, {'rd': rd(), 'fail': {'red': [{'message': 'network'}, None]}})
        await fill(p); await p.click('#coRdSubmit'); await p.wait_for_timeout(400)
        check('network failure: plain message, nothing changed', 'Nothing was changed' in await p.inner_text('#coRdErrorText'))
        await p.click('#coRdSubmit'); await p.wait_for_timeout(500)
        c = await p.evaluate('window.__red')
        check('the retry uses the SAME request id (so it can never double)', len(c) == 2 and c[0]['p_request_id'] == c[1]['p_request_id'], c); await ctx.close()
        # refusals speak plainly and reload
        ctx, p, errs = await open_page(b, {'rd': rd(), 'fail': {'red': [{'hint': 'dispute_open', 'message': 'x'}]}})
        await fill(p); await p.click('#coRdSubmit'); await p.wait_for_timeout(500)
        check('server refusal (dispute_open) shows plain words', 'already open' in await p.inner_text('#coRdErrorText')); await ctx.close()
        ctx, p, errs = await open_page(b, {'rd': rd(), 'fail': {'red': [{'hint': 'over_limit', 'message': 'A reduction cannot be more than what was paid (NGN 6,000 can still be asked for).'}]}})
        await fill(p); await p.click('#coRdSubmit'); await p.wait_for_timeout(500)
        check('server refusal (over_limit) shows the server wording', 'NGN 6,000' in await p.inner_text('#coRdErrorText')); await ctx.close()
        # blocked states
        ctx, p, errs = await open_page(b, {'rd': rd(can_request=False, blocked='not_paid', room=0)})
        check('nothing paid: card shows the send-back guidance and no form', await p.is_visible('#coRd') and not await p.is_visible('#coRdForm') and 'new quote' in await p.inner_text('#coRdLead')); await ctx.close()
        ctx, p, errs = await open_page(b, {'rd': rd(can_request=False, blocked='not_approved', room=0)})
        check('not approved, nothing recorded: card hidden', not await p.is_visible('#coRd')); await ctx.close()
        ctx, p, errs = await open_page(b, {'rd': rd(can_request=False, blocked='booking_closed', room=0)})
        check('closed booking, nothing recorded: card hidden', not await p.is_visible('#coRd')); await ctx.close()
        item = {'id': 'r1', 'dispute_id': DP, 'amount': 4000, 'why': 'Smaller job', 'status': 'resolved', 'outcome': 'refund_partial', 'created_at': '2026-10-29T09:00:00Z', 'can_withdraw': False}
        ctx, p, errs = await open_page(b, {'rd': rd(can_request=False, blocked='booking_closed', room=0, items=[item])})
        check('closed booking with a decided report: card shows the decision, no withdraw button', await p.is_visible('#coRd') and 'part of the money is refunded' in await p.inner_text('#coRdList') and not await p.is_visible('#coRdList button')); await ctx.close()
        ctx, p, errs = await open_page(b, {'rd': rd(), 'fail': {'load': True}})
        check('load failure: message shown, no form', await p.is_visible('#coRd') and not await p.is_visible('#coRdForm') and 'couldn’t load' in await p.inner_text('#coRdErrorText')); await ctx.close()
        # mobile
        ctx, p, errs = await open_page(b, {'rd': rd()}, w=390, h=844)
        sw = await p.evaluate('document.documentElement.scrollWidth')
        check('390 wide: no sideways scroll', sw <= 391, sw)
        bh = await p.evaluate("document.getElementById('coRdSubmit').getBoundingClientRect().height")
        check('submit button at least 44px tall', bh >= 44, bh)
        await p.screenshot(path=OUT + '/reduction-390.png', full_page=True); await ctx.close()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print('\n%d PASS, %d FAIL' % (len(results) - len(bad), len(bad))); raise SystemExit(1 if bad else 0)
asyncio.run(main())

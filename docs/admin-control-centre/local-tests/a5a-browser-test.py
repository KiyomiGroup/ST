# LOCAL ONLY (A5a): headless browser test of admin/approvals.html against a FAKE Supabase. Proves layout and page logic, NOT real data
# and NOT the SQL. Run:  python3 a5a-browser-test.py <repo root>      (needs: pip playwright + its chromium)
import sys, json, threading, http.server, socketserver, functools, os
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(sys.argv[1]); results = []
def chk(ok, t): results.append((bool(ok), t))
class Q(socketserver.TCPServer): allow_reuse_address = True
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(H.func):
    def log_message(self, *a): pass
srv = Q(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

PENDING = [
  {'id': 'aaaaaaaa-0000-0000-0000-000000000001', 'action': 'commission.change', 'action_label': '<img src=x onerror=window.__xss=1>Commission split change', 'risk': 'critical', 'status': 'pending', 'effective_status': 'pending',
   'target_type': 'setting', 'target_id': 'commission', 'requested_at': '2026-11-09T10:00:00Z', 'expires_at': '2026-11-12T10:00:00Z', 'seconds_left': 200000, 'is_mine': False, 'requested_by_name': 'Ops One', 'decided_by_name': None},
  {'id': 'aaaaaaaa-0000-0000-0000-000000000002', 'action': 'admin.team.change', 'action_label': 'Add, remove or re-role an admin', 'risk': 'high', 'status': 'pending', 'effective_status': 'pending',
   'target_type': 'admin', 'target_id': 'u-77', 'requested_at': '2026-11-08T10:00:00Z', 'expires_at': '2026-11-09T22:30:00Z', 'seconds_left': 3000, 'is_mine': True, 'requested_by_name': 'Test Admin', 'decided_by_name': None}]
APPROVED = [{'id': 'bbbbbbbb-0000-0000-0000-000000000003', 'action': 'fee.change', 'action_label': 'Platform fee change', 'risk': 'critical', 'status': 'consumed', 'effective_status': 'consumed',
   'target_type': 'setting', 'target_id': 'fee', 'requested_at': '2026-11-05T10:00:00Z', 'expires_at': '2026-11-08T10:00:00Z', 'seconds_left': None, 'is_mine': False, 'requested_by_name': 'Ops One', 'decided_by_name': 'Kiyomi'}]
EXPIRED = [{'id': 'cccccccc-0000-0000-0000-000000000004', 'action': 'fee.change', 'action_label': 'Platform fee change', 'risk': 'medium', 'status': 'pending', 'effective_status': 'expired',
   'target_type': 'setting', 'target_id': 'fee', 'requested_at': '2026-10-01T10:00:00Z', 'expires_at': '2026-10-04T10:00:00Z', 'seconds_left': None, 'is_mine': False, 'requested_by_name': 'Ops One', 'decided_by_name': None}]
DETAIL = {'found': True, 'id': 'aaaaaaaa-0000-0000-0000-000000000001', 'action': 'commission.change', 'action_label': 'Commission split change', 'risk': 'critical', 'status': 'pending', 'effective_status': 'pending',
  'target_type': 'setting', 'target_id': 'commission', 'reason': 'Raise the platform share for the new season', 'payload': {'platform_pct': 12, 'tasker_pct': 88, 'note': '<b>x</b>'},
  'previous_value': {'platform_pct': 10, 'tasker_pct': 90, 'note': '<b>x</b>'}, 'requested_at': '2026-11-09T10:00:00Z', 'expires_at': '2026-11-12T10:00:00Z', 'seconds_left': 200000,
  'requested_by_name': 'Ops One', 'decided_at': None, 'decision_reason': None, 'decided_by_name': None, 'consumed_at': None, 'consumed_by_name': None, 'is_mine': False,
  'history': [{'at': '2026-11-09T10:00:00Z', 'action': 'approval.requested', 'outcome': 'ok', 'reason': 'Raise the platform share for the new season', 'actor_name': 'Ops One'},
              {'at': '2026-11-09T11:00:00Z', 'action': 'approval.decide', 'outcome': 'refused', 'reason': None, 'actor_name': 'Ops One'}]}

def fake(scn):
    return """(function(){ var scn=%s, P=%s, A=%s, E=%s, D=%s; window.__calls=[];
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a||{}}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['operations'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(scn.missing) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(scn.denied) return {data:null,error:{code:'42501',message:'You do not have permission'}};
   if(n==='admin_approval_counts') return ok({pending:scn.empty?0:2,approved:1,rejected:0,expired:1});
   if(n==='admin_approval_list'){
     var rows = scn.empty ? [] : (a.p_tab==='pending'?P:(a.p_tab==='approved'?A:(a.p_tab==='expired'?E:[])));
     if(a.p_search){ rows=rows.filter(function(x){return (x.action_label+x.target_id).toLowerCase().indexOf(a.p_search.toLowerCase())>=0;}); }
     if(scn.own) rows=rows.filter(function(x){return x.is_mine;});
     return ok({tab:a.p_tab,scope:scn.own?'own':'all',limit:50,offset:a.p_offset,has_more:!!scn.more&&a.p_offset===0,rows:rows}); }
   if(n==='admin_approval_detail'){
     if(scn.notfound) return ok({found:false});
     if(scn.noprev){ var d=JSON.parse(JSON.stringify(D)); d.previous_value=null; return ok(d); }
     return ok(D); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();""" % tuple(json.dumps(x) for x in (scn, PENDING, APPROVED, EXPIRED, DETAIL))

def open_page(browser, scn, w=1280):
    ctx = browser.new_context(viewport={'width': w, 'height': 900}); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    def route(r):
        u = r.request.url
        if '127.0.0.1' in u:
            if u.endswith('/js/supabaseClient.js'): return r.fulfill(content_type='text/javascript', body=fake(scn))
            return r.continue_()
        if 'jsdelivr' in u: return r.fulfill(content_type='text/javascript', body='')
        return r.abort()
    page.route('**/*', route)
    page.goto('http://127.0.0.1:%d/admin/approvals.html' % PORT)
    return page, ctx, errs
def calls(page, n): return page.evaluate('n => window.__calls.filter(c => c.n === n)', n)
def txt(page, s): return page.locator(s).first.inner_text()

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1 full access
    page, ctx, errs = open_page(b, {'perms': ['approvals.view', 'approvals.decide']})
    page.wait_for_selector('#apBody .ad-row')
    chk(page.locator('.ad-nav-link', has_text='Pending approvals').count() == 1, '1 menu item shown')
    chk(page.locator('#apBody .ad-rows .ad-row').count() == 2, '2 two pending requests listed')
    tabs = page.locator('#apTabs button').all_inner_texts()
    chk(tabs == ['Pending (2)', 'Approved (1)', 'Rejected (0)', 'Expired or cancelled (1)'], '3 four tabs with counts: %s' % tabs)
    t = txt(page, '#apBody')
    chk(page.evaluate('window.__xss') is None and '<img src=x' in t, '4 markup in an action label shown as plain text, did not run')
    chk('Critical risk' in t and 'High risk' in t and 'Pending' in t and 'By Ops One' in t and 'By Test Admin (you)' in t, '5 risk, status words and requester shown (own marked "you")')
    chk('Expires in 2 days' in t and 'Expires in 50 min' in t, '6 expiry countdown words')
    c = calls(page, 'admin_approval_list')[-1]['a']
    chk(c['p_tab'] == 'pending' and c['p_offset'] == 0 and c['p_limit'] == 50, '7 list called for the pending tab, offset 0, 50 per page')
    # detail
    page.locator('#apBody .ad-row').first.click(); page.wait_for_selector('.ad-split-detail .ad-dl')
    d = txt(page, '.ad-split-detail')
    chk(calls(page, 'admin_approval_detail')[-1]['a']['p_id'] == PENDING[0]['id'], '8 detail called with the request id')
    chk('Raise the platform share' in d and 'Ops One' in d and 'Time left' in d, '9 reason, requester and time left shown')
    rows = page.locator('.ad-split-detail table tbody tr').all_inner_texts()
    chk(len(rows) == 3, '10 diff has one row per field (%d)' % len(rows))
    chk(page.locator('.ad-split-detail table tbody tr', has_text='Platform pct').inner_text().count('Changes') == 1 and 'Changes' not in page.locator('.ad-split-detail table tbody tr', has_text='Note').inner_text(), '11 only the changed field is flagged')
    chk('<b>x</b>' in d, '12 markup inside the change shown as text')
    chk('Approval requested' in d and 'Approval decide by Ops One (Refused)' in d, '13 history lines incl. a refused one')
    chk('not on this page yet' in d and page.locator('.ad-split-detail button', has_text='Approve').count() == 0 and page.locator('.ad-split-detail button', has_text='Reject').count() == 0, '14 no Approve, Reject or Cancel button')
    chk(len([x for x in page.evaluate('window.__calls.map(c=>c.n)') if x not in ('admin_my_access', 'admin_approval_list', 'admin_approval_counts', 'admin_approval_detail')]) == 0, '15 only the read functions were called')
    # tabs and search
    page.locator('#apTabs button', has_text='Approved').click(); page.wait_for_function("document.querySelector('#apBody').innerText.includes('Approved and used')")
    chk(calls(page, 'admin_approval_list')[-1]['a']['p_tab'] == 'approved' and 'Platform fee change' in txt(page, '#apBody'), '16 Approved tab asks for approved; used request says "Approved and used"')
    page.locator('#apTabs button', has_text='Expired').click(); page.wait_for_function("document.querySelector('#apBody').innerText.includes('Expired')")
    chk('Expires in' not in txt(page, '#apBody .ad-split-list'), '17 expired row shows no countdown')
    page.locator('#apTabs button', has_text='Rejected').click(); page.wait_for_function("document.querySelector('#apBody').innerText.includes('Nothing here yet')")
    chk('No requests here yet' in txt(page, '#apBody'), '18 empty tab shows the empty state')
    page.locator('#apTabs button', has_text='Pending').click(); page.wait_for_selector('#apBody .ad-row')
    page.fill('#apSearch', 're-role'); page.locator('#apFilters button[type=submit]').click(); page.wait_for_function("document.querySelectorAll('#apBody .ad-rows .ad-row').length === 1")
    chk(calls(page, 'admin_approval_list')[-1]['a']['p_search'] == 're-role', '19 search sent to the server')
    page.fill('#apSearch', 'zzz'); page.locator('#apFilters button[type=submit]').click(); page.wait_for_function("document.querySelector('#apBody').innerText.includes('No results')")
    chk(True, '20 no-results state')
    page.locator('#apReset').click(); page.wait_for_selector('#apBody .ad-rows .ad-row')
    chk(calls(page, 'admin_approval_list')[-1]['a']['p_search'] is None, '21 Reset clears the search')
    chk(not errs, '22 no page errors %s' % errs); ctx.close()
    # pager
    page, ctx, errs = open_page(b, {'perms': ['approvals.view']}); page.wait_for_selector('#apBody .ad-row')
    page.close(); ctx.close()
    page, ctx, errs = open_page(b, {'perms': ['approvals.view'], 'more': True}); page.wait_for_selector('#apBody .ad-row')
    chk(page.locator('#apBody .ad-pager').count() == 1 and page.locator('#apBody .ad-pager button', has_text='Older').is_enabled() and not page.locator('#apBody .ad-pager button', has_text='Newer').is_enabled(), '23 pager shown when more rows exist')
    page.locator('#apBody .ad-pager button', has_text='Older').click(); page.wait_for_function("window.__calls.filter(c=>c.n==='admin_approval_list').pop().a.p_offset===50")
    chk(True, '24 Older asks for offset 50'); ctx.close()
    # request-only admin
    page, ctx, errs = open_page(b, {'perms': ['approvals.request'], 'own': True}); page.wait_for_selector('#apBody .ad-row')
    chk(page.locator('#apBody .ad-rows .ad-row').count() == 1 and 'only the requests you made' in txt(page, '#apScope'), '25 request-only admin sees only own request and a note'); ctx.close()
    # no approval permission
    page, ctx, errs = open_page(b, {'perms': ['bookings.view']}); page.wait_for_function("document.querySelector('#adMain').innerText.includes('You do not have access')")
    page.wait_for_timeout(300)
    chk('You do not have access' in txt(page, '#adMain') and 'approvals.view' in txt(page, '#adMain') and len(calls(page, 'admin_approval_list')) == 0, '26 no approval permission: no-permission box, list never called'); ctx.close()
    # empty
    page, ctx, errs = open_page(b, {'perms': ['approvals.view'], 'empty': True}); page.wait_for_selector('#apBody .ad-card')
    chk('No request is waiting for a decision' in txt(page, '#apBody'), '27 empty pending state'); ctx.close()
    # missing function / denied
    page, ctx, errs = open_page(b, {'perms': ['approvals.view'], 'missing': True}); page.wait_for_function("document.querySelector('#apBody').innerText.includes('a5a-approvals-reader.sql')")
    chk(page.locator('#apBody button', has_text='Retry').count() == 1, '28 function missing: names the SQL file and offers Retry'); ctx.close()
    page, ctx, errs = open_page(b, {'perms': ['approvals.view'], 'denied': True}); page.wait_for_function("document.querySelector('#apBody').innerText.includes('You do not have access')")
    chk(True, '29 server refusal (42501) shows the no-permission box'); ctx.close()
    # detail not found and no previous value
    page, ctx, errs = open_page(b, {'perms': ['approvals.view'], 'notfound': True}); page.wait_for_selector('#apBody .ad-row'); page.locator('#apBody .ad-row').first.click()
    page.wait_for_function("document.querySelector('.ad-split-detail').innerText.includes('not found')"); chk(True, '30 detail not found message'); ctx.close()
    page, ctx, errs = open_page(b, {'perms': ['approvals.view'], 'noprev': True}); page.wait_for_selector('#apBody .ad-row'); page.locator('#apBody .ad-row').first.click()
    page.wait_for_selector('.ad-split-detail .ad-dl'); chk('current value was not recorded' in txt(page, '.ad-split-detail') and page.locator('.ad-split-detail table tbody tr', has_text='Changes').count() == 0, '31 no recorded current value: said so, nothing flagged as changed'); ctx.close()
    # phone
    page, ctx, errs = open_page(b, {'perms': ['approvals.view', 'approvals.decide']}, 390); page.wait_for_selector('#apBody .ad-row')
    chk(not page.locator('.ad-split-detail').is_visible(), '32 phone: detail hidden before a choice')
    page.locator('#apBody .ad-row').first.click(); page.wait_for_selector('.ad-split-detail .ad-dl')
    chk(page.locator('.ad-split-detail').is_visible() and not page.locator('.ad-split-list').is_visible() and page.locator('.ad-back').is_visible(), '33 phone: detail is its own screen with a Back button')
    chk(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), '34 phone: no sideways scroll')
    page.locator('.ad-back').click(); chk(page.locator('.ad-split-list').is_visible(), '35 phone: Back returns to the list')
    chk(not errs, '36 phone: no page errors %s' % errs); ctx.close(); b.close()

fails = [t for ok, t in results if not ok]
for ok, t in results: print(('PASS ' if ok else 'FAIL ') + t)
print('RESULT: %s (%d checks)' % ('ALL PASS' if not fails else '%d FAILED' % len(fails), len(results)))
sys.exit(1 if fails else 0)

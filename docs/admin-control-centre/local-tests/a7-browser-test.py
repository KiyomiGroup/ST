# LOCAL ONLY (A7): headless browser test of admin/customers.html against a FAKE Supabase.
# Proves page logic (what is asked, how many presses, what is sent), NOT real data and NOT the SQL. Run:
#   python3 a7-browser-test.py <repo root>      (needs pip playwright + chromium)
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

def row(uid, name, status='active', removed=False, me=False, roles=(), mfa=True):
    return {'user_id': uid, 'display_name': name, 'email': uid + '@example.com', 'status': status, 'removed': removed, 'created_at': '2026-11-01T10:00:00Z',
            'last_seen_at': None, 'is_me': me, 'roles': [{'key': k, 'label': l} for k, l in roles], 'mfa_on': mfa}
TEAM = {'mfa_required': True, 'active_super_admins': 2, 'rows': [
  row('u1', 'Kiyomi', me=True, roles=[('super_admin', 'Super Admin')]),
  row('u2', '<img src=x onerror=window.__xss=1>Ops One', roles=[('operations', 'Operations Admin'), ('support', 'Support Admin')]),
  row('u3', None, status='suspended', roles=[('content', 'Content Admin')]),
  row('u4', 'Gone Admin', status='removed', removed=True)]}
PERMS = [{'key': 'admin.team.manage', 'label': 'Manage the admin team', 'group_name': 'Admin', 'sensitive': True},
         {'key': 'approvals.decide', 'label': 'Decide approvals', 'group_name': 'Approvals', 'sensitive': True},
         {'key': 'bookings.view', 'label': 'View bookings', 'group_name': 'Operations', 'sensitive': False},
         {'key': 'bookings.manage', 'label': 'Manage bookings', 'group_name': 'Operations', 'sensitive': True}]
ROLES = {'permissions': PERMS, 'roles': [
  {'key': 'super_admin', 'label': 'Super Admin', 'is_system': True, 'all_permissions': True, 'permission_keys': [p['key'] for p in PERMS], 'members': ['Kiyomi']},
  {'key': 'operations', 'label': 'Operations Admin', 'is_system': True, 'all_permissions': False, 'permission_keys': ['bookings.view'], 'members': []},
  {'key': 'support', 'label': 'Support Admin', 'is_system': True, 'all_permissions': False, 'permission_keys': [], 'members': []},
  {'key': 'content', 'label': 'Content Admin', 'is_system': True, 'all_permissions': False, 'permission_keys': [], 'members': []}]}
def mine(status, action='admin.team.change'):
    if action == 'admin.team.change':
        return {'id': 'req-1', 'action': action, 'status': status, 'target_id': 'u2', 'target_label': '<b>Ops One</b>', 'payload': {'change': 'set_roles', 'roles': ['content', 'operations']},
                'previous_value': {}, 'reason': 'x' * 12, 'requested_at': '2026-11-09T10:00:00Z', 'expires_at': '2026-11-12T10:00:00Z', 'seconds_left': 200000}
    return {'id': 'req-2', 'action': action, 'status': status, 'target_id': 'operations', 'target_label': 'Operations Admin', 'payload': {'permissions': ['bookings.manage', 'bookings.view']},
            'previous_value': {'permissions': ['bookings.view']}, 'reason': 'y' * 12, 'requested_at': '2026-11-09T10:00:00Z', 'expires_at': '2026-11-12T10:00:00Z', 'seconds_left': 200000}

def fake(scn):
    return """(function(){ var scn=%s, T=%s, R=%s, M=%s; window.__calls=[]; var applied=false, sent=false, resent=false;
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session: scn.noSession?null:{user:{id:'me'}}}});}, signOut:function(){window.__signedOut=true;return Promise.resolve({});}, updateUser:function(a){window.__calls.push({n:'updateUser',a:a}); console.log('__CALL__'+JSON.stringify({n:'updateUser',a:a}));return Promise.resolve(scn.pwFail?{error:{message:'weak'}}:{data:{},error:null});} },
   functions:{ invoke:function(n,o){ window.__calls.push({n:'invoke:'+n,a:(o&&o.body)||{}}); return new Promise(function(res){ setTimeout(function(){ if(scn.sendFail){ res({data:null,error:{context:{json:function(){return Promise.resolve({ok:false,message:scn.sendFail});}}}}); } else { if(o&&o.body&&o.body.user_id) resent=true; else sent=true; res({data:{ok:true,email:'new@example.com',email_sent:!scn.existingLogin,existing_login:!!scn.existingLogin},error:null}); } },5); }); } },
   rpc:function(n,a){ window.__calls.push({n:n,a:a||{}}); console.log('__CALL__'+JSON.stringify({n:n,a:a||{}})); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_customer_list'){ if(scn.listFail) return ok({ok:false,error:'Could not load customers.'}); return ok(scn.list||{ok:true,items:[],total:0,offset:0,limit:25,counts:{all:0,active:0,suspended:0,flagged:0,open_dispute:0}}); }
   if(n==='admin_customer_get') return ok(scn.prof);
   if(n==='admin_customer_reveal'){ if((a.p_reason||'').length<10) return ok({ok:false,error:'Write a reason of at least 10 characters.'}); return ok({ok:true,value:a.p_field==='email'?'real.person@example.com':'+2348012345678'}); }
   if(n==='admin_my_access'&&scn.notAdmin) return ok({active:false});
   if(n==='admin_invite_request'){ if(scn.reqFail) return ok({ok:false,error:'This email already has a customer, Tasker or coordinator account. Use a separate email made only for admin work.'}); return ok({ok:true,id:'inv-new'}); }
   if(n==='admin_invite_setup_pending') return ok({rows: (scn.setup&&!resent)?scn.setup:[]});
   if(n==='admin_invites_mine') return ok({rows: sent?[]:(scn.invites||[])});
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['super_admin'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(n==='admin_team_list') return ok(T);
   if(n==='admin_role_directory') return ok(R);
   if(n==='admin_team_changes_mine') return ok({rows: applied?[]:M});
   if(n==='admin_team_request_change'||n==='admin_role_request_change'){ if(scn.reqFail) return ok({ok:false,error:'This is the last active Super Admin. Appoint another Super Admin first.'}); return ok({ok:true,id:'new-1'}); }
   if(n==='admin_team_apply_change'||n==='admin_role_apply_change'){ if(scn.applyFail) return ok({ok:false,error:'The target changed after the approval was asked for. Ask again.'}); applied=true; return ok({ok:true}); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();""" % tuple(json.dumps(x) for x in (scn, TEAM, ROLES, scn.get('mine', [])))

def open_page(browser, page_name, scn, w=1280):
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
    page.goto('http://127.0.0.1:%d/admin/%s.html' % (PORT, page_name))
    return page, ctx, errs
def calls(page, n=None): return page.evaluate('n => window.__calls.filter(c => !n || c.n === n)', n)
def txt(page, s): return page.locator(s).first.inner_text()
MGR = ['admin.team.view', 'admin.team.manage', 'admin.roles.manage', 'approvals.view']
REASON = 'Needs to cover support this month'


def inv(status, email='new@example.com', name='New Person'):
    return {'id': 'inv-1', 'status': status, 'email': email, 'name': name, 'roles': ['content', 'operations'], 'reason': 'x' * 12,
            'requested_at': '2026-11-09T10:00:00Z', 'expires_at': '2026-11-12T10:00:00Z', 'seconds_left': 200000}


def item(i, name, status='active', **kw):
    d = {'id': 'c-%d' % i, 'name': name, 'joined': '2026-10-01T09:00:00Z', 'bookings': i, 'status': status, 'flagged': False, 'open_dispute': False, 'is_admin': False, 'is_tasker': False}
    d.update(kw); return d

def prof(status='active', **acc):
    a = {'id': 'c-1', 'name': 'Ada Obi', 'first_name': 'Ada', 'last_name': 'Obi', 'joined': '2026-10-01T09:00:00Z', 'location': 'Lagos', 'roles': ['customer'], 'verified': True,
         'verified_at': None, 'flagged': False, 'flagged_reason': None, 'contact_violations': 0, 'is_admin': False, 'is_tasker': False, 'is_coordinator': False}
    a.update(acc)
    return {'ok': True, 'account': a, 'contact': {'email': 'a***@example.com', 'whatsapp': '******678', 'has_email': True, 'has_whatsapp': True},
            'status': status, 'suspension': ({'reason': 'Repeated abusive messages', 'since': '2026-11-01T10:00:00Z'} if status == 'suspended' else None),
            'restrictions': ([{'id': 'f1', 'reason': 'Repeated abusive messages', 'since': '2026-11-01T10:00:00Z', 'by': 'Ops One', 'lifted_at': None, 'lift_reason': None, 'lifted_by': None}] if status == 'suspended' else []),
            'bookings': [{'id': 'b1', 'title': 'Fix sink', 'status': 'completed', 'payment_status': 'released', 'amount': 15000, 'created_at': '2026-10-05T09:00:00Z', 'worker': 'Tunde'}],
            'bookings_total': 1, 'payments': {'released': {'count': 1, 'amount': 15000}}, 'reviews': {'given_count': 2, 'given_avg': 4.5, 'received_count': 1, 'received_avg': 5},
            'disputes': [{'id': 'd1', 'category': 'quality', 'status': 'open', 'outcome': None, 'opened_at': '2026-11-02T10:00:00Z', 'resolved_at': None}],
            'gift_cards': {'redeemed_count': 1, 'redeemed_amount': 5000}, 'reports_note': 'The site has no general user-report table yet.'}

LIST = {'ok': True, 'items': [item(1, 'Ada Obi'), item(2, 'Bola Ade', 'suspended', flagged=True), item(3, '<img src=x onerror=window.__xss=1>')], 'total': 3, 'offset': 0, 'limit': 25,
        'counts': {'all': 3, 'active': 2, 'suspended': 1, 'flagged': 1, 'open_dispute': 0}}
FULL = ['customers.view', 'customers.suspend', 'pii.reveal']
R = 'Customer sent repeated abusive messages'

with sync_playwright() as p:
    b = p.chromium.launch()

    pg, cx, errs = open_page(b, 'customers', {'perms': FULL, 'list': LIST, 'prof': prof()}); pg.wait_for_selector('#cuBody .ad-row')
    chk(pg.locator('#cuBody .ad-row').count() == 3 and '3 in all' in txt(pg, '#cuBody') and '1 suspended' in txt(pg, '#cuBody'), '1 list shows 3 customers and the counts')
    chk(pg.evaluate('() => window.__xss') is None and not errs, '2 a hostile name is shown as text; no page errors')
    c = calls(pg, 'admin_customer_list')
    chk(c and c[0]['a'] == {'p_search': None, 'p_filter': 'all', 'p_offset': 0}, '3 first load asks for all, offset 0')
    pg.fill('#cuSearch', '  ada@example.com '); pg.select_option('#cuFilter', 'suspended'); pg.locator('#cuFilters button[type=submit]').click(); pg.wait_for_timeout(200)
    c = calls(pg, 'admin_customer_list')[-1]
    chk(c['a'] == {'p_search': 'ada@example.com', 'p_filter': 'suspended', 'p_offset': 0}, '4 search is trimmed and sent with the filter')
    pg.locator('#cuReset').click(); pg.wait_for_timeout(200)
    chk(calls(pg, 'admin_customer_list')[-1]['a'] == {'p_search': None, 'p_filter': 'all', 'p_offset': 0}, '5 Reset goes back to all')

    pg.locator('#cuBody .ad-row').first.click(); pg.wait_for_selector('#cuBody .ad-split-detail h2')
    t = txt(pg, '#cuBody .ad-split-detail')
    chk('Ada Obi' in t and 'a***@example.com' in t and '******678' in t and 'real.person' not in t and '+234' not in t, '6 profile shows masked contact only')
    chk('Fix sink' in t and 'Tunde' in t and '₦15,000' in t and 'quality' in t.lower() and 'no general user-report table' in t, '7 profile shows bookings, payments, dispute and the reports note')
    chk(calls(pg, 'admin_customer_get')[-1]['a'] == {'p_id': 'c-1'}, '8 profile asked for the right customer')

    # reveal
    pg.locator('#cuBody .ad-contact', has_text='Email').locator('button', has_text='Reveal').click()
    pg.locator('#cuBody textarea').first.fill('short'); pg.locator('#cuBody button', has_text='Reveal email').click()
    chk('at least 10' in txt(pg, '#cuBody .ad-error') and not calls(pg, 'admin_customer_reveal'), '9 short reason refused, nothing sent')
    pg.locator('#cuBody textarea').first.fill('Customer asked us to call them back'); pg.locator('#cuBody button', has_text='Reveal email').click()
    chk(not calls(pg, 'admin_customer_reveal') and 'logged' in txt(pg, '#cuBody .ad-note'), '10 first press sends nothing and warns it is logged')
    pg.locator('#cuBody button', has_text='Press again').click(); pg.wait_for_timeout(300)
    rc = calls(pg, 'admin_customer_reveal')
    chk(len(rc) == 1 and rc[0]['a'] == {'p_id': 'c-1', 'p_field': 'email', 'p_reason': 'Customer asked us to call them back'}, '11 second press reveals once with id, field and reason')
    chk('real.person@example.com' in txt(pg, '#cuBody .ad-split-detail') and '+234' not in txt(pg, '#cuBody .ad-split-detail'), '12 only the asked value is shown')

    # suspend
    pg.locator('#cuBody textarea').last.fill('x'); pg.locator('#cuBody button', has_text='Suspend customer').click()
    chk('at least 10' in txt(pg, '#cuBody .ad-split-detail .ad-error') and not calls(pg, 'invoke:admin-account-action'), '13 short reason refused for suspend')
    pg.locator('#cuBody textarea').last.fill(R); pg.locator('#cuBody button', has_text='Suspend customer').click()
    chk(not calls(pg, 'invoke:admin-account-action') and 'blocks the sign-in' in txt(pg, '#cuBody .ad-split-detail'), '14 first press sends nothing and explains the effect')
    pg.locator('#cuBody button', has_text='Press again').click(); pg.wait_for_timeout(400)
    ac = calls(pg, 'invoke:admin-account-action')
    chk(len(ac) == 1 and ac[0]['a'] == {'user_id': 'c-1', 'action': 'suspend', 'reason': R}, '15 second press calls the function with id, action and reason only')
    chk('Customer suspended' in pg.locator('#adToasts').inner_text() and len(calls(pg, 'admin_customer_list')) >= 3, '16 toast and the list reloads')
    chk(not errs, '17 no page errors')
    cx.close()

    # server refusal on suspend
    pg, cx, errs = open_page(b, 'customers', {'perms': FULL, 'list': LIST, 'prof': prof(), 'sendFail': 'This login is also a Tasker.'}); pg.wait_for_selector('#cuBody .ad-row')
    pg.locator('#cuBody .ad-row').first.click(); pg.wait_for_selector('#cuBody .ad-split-detail h2')
    pg.locator('#cuBody textarea').last.fill(R); pg.locator('#cuBody button', has_text='Suspend customer').click(); pg.locator('#cuBody button', has_text='Press again').click(); pg.wait_for_timeout(400)
    chk('also a Tasker' in txt(pg, '#cuBody .ad-split-detail .ad-error'), '18 server refusal text is shown')
    cx.close()

    # restore
    pg, cx, errs = open_page(b, 'customers', {'perms': FULL, 'list': LIST, 'prof': prof('suspended')}); pg.wait_for_selector('#cuBody .ad-row')
    pg.locator('#cuBody .ad-row').first.click(); pg.wait_for_selector('#cuBody .ad-split-detail h2')
    chk('Suspended since' in txt(pg, '#cuBody .ad-split-detail') and 'Repeated abusive messages' in txt(pg, '#cuBody .ad-split-detail') and pg.locator('#cuBody button', has_text='Suspend customer').count() == 0, '19 suspended profile shows reason and history, offers Restore only')
    pg.locator('#cuBody textarea').last.fill('Appeal reviewed, messages were a misunderstanding'); pg.locator('#cuBody button', has_text='Restore customer').click(); pg.locator('#cuBody button', has_text='Press again').click(); pg.wait_for_timeout(400)
    ac = calls(pg, 'invoke:admin-account-action')
    chk(len(ac) == 1 and ac[0]['a']['action'] == 'restore' and ac[0]['a']['user_id'] == 'c-1', '20 restore sends action restore')
    cx.close()

    # login that is also an admin or tasker
    pg, cx, errs = open_page(b, 'customers', {'perms': FULL, 'list': LIST, 'prof': prof(is_admin=True)}); pg.wait_for_selector('#cuBody .ad-row')
    pg.locator('#cuBody .ad-row').first.click(); pg.wait_for_selector('#cuBody .ad-split-detail h2')
    chk('Also an admin login' in txt(pg, '#cuBody .ad-split-detail') and pg.locator('#cuBody button', has_text='Suspend customer').count() == 0, '21 a login that is also an admin has no suspend form')
    cx.close()

    # view only
    pg, cx, errs = open_page(b, 'customers', {'perms': ['customers.view'], 'list': LIST, 'prof': prof()}); pg.wait_for_selector('#cuBody .ad-row')
    pg.locator('#cuBody .ad-row').first.click(); pg.wait_for_selector('#cuBody .ad-split-detail h2')
    chk(pg.locator('#cuBody button', has_text='Reveal').count() == 0 and pg.locator('#cuBody button', has_text='Suspend customer').count() == 0 and 'cannot reveal' in txt(pg, '#cuBody .ad-split-detail'), '22 view-only role: no Reveal, no Suspend')
    cx.close()

    # nav: no customers.view -> no entry; with it -> entry
    pg, cx, errs = open_page(b, 'customers', {'perms': FULL, 'list': LIST, 'prof': prof()}); pg.wait_for_selector('#cuBody .ad-row')
    chk(pg.locator('#adNav a', has_text='Customers').count() == 1, '23 Customers is in the menu')
    cx.close()

    # list failure
    pg, cx, errs = open_page(b, 'customers', {'perms': FULL, 'listFail': True}); pg.wait_for_timeout(600)
    chk('Could not load customers' in txt(pg, '#cuBody'), '24 list failure shows the message with a retry')
    cx.close()

    # empty
    pg, cx, errs = open_page(b, 'customers', {'perms': FULL}); pg.wait_for_timeout(400)
    chk('No customers yet' in txt(pg, '#cuBody'), '25 empty directory says so')
    cx.close()

    # phone
    pg, cx, errs = open_page(b, 'customers', {'perms': FULL, 'list': LIST, 'prof': prof()}, w=390); pg.wait_for_selector('#cuBody .ad-row')
    pg.locator('#cuBody .ad-row').first.click(); pg.wait_for_selector('#cuBody .ad-split-detail h2')
    chk(pg.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), '26 390px: no sideways scroll with a profile open')
    cx.close()

    b.close()

bad = [t for ok, t in results if not ok]
for ok, t in results: print(('PASS ' if ok else 'FAIL ') + t)
print('RESULT: %s (%d checks)' % ('ALL PASS' if not bad else '%d FAILED' % len(bad), len(results)))
sys.exit(1 if bad else 0)

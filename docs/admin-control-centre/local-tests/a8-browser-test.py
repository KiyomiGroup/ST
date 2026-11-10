# LOCAL ONLY (A8): headless browser test of admin/taskers.html against a FAKE Supabase.
# Proves page logic (what is asked, how many presses, what is sent), NOT real data and NOT the SQL. Run:
#   python3 a8-browser-test.py <repo root>      (needs pip playwright + chromium)
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
   if(n==='admin_tasker_list'){ if(scn.listFail) return ok({ok:false,error:'Could not load customers.'}); return ok(scn.list||{ok:true,items:[],total:0,offset:0,limit:25,counts:{all:0,active:0,suspended:0,flagged:0,open_dispute:0}}); }
   if(n==='admin_tasker_get') return ok(scn.prof);
   if(n==='admin_tasker_reveal'){ if((a.p_reason||'').length<10) return ok({ok:false,error:'Write a reason of at least 10 characters.'}); return ok({ok:true,value:a.p_field==='email'?'real.person@example.com':'+2348012345678'}); }
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
    d = {'id': 't-%d' % i, 'name': name, 'joined': '2026-10-01T09:00:00Z', 'category': 'cleaning', 'services': 1, 'bookings': i, 'status': status, 'verified': True, 'available': True, 'flagged': False, 'open_dispute': False, 'is_admin': False}
    d.update(kw); return d

def prof(status='active', money=True, **acc):
    a = {'id': 't-1', 'name': 'Tunde Bello', 'business_name': 'TB Cleaning', 'joined': '2026-10-01T09:00:00Z', 'location': 'Lagos', 'roles': ['tasker'], 'verified': True, 'verified_at': None,
         'flagged': False, 'flagged_reason': None, 'contact_violations': 0, 'available': True, 'availability_status': 'open', 'category': 'cleaning', 'has_tasker_row': True,
         'is_admin': False, 'is_customer': False, 'is_coordinator': False}
    a.update(acc)
    d = {'ok': True, 'account': a, 'contact': {'email': 't***@example.com', 'whatsapp': '******678', 'phone': '******999', 'has_email': True, 'has_whatsapp': True, 'has_phone': True},
         'status': status, 'suspension': ({'reason': 'Took payment outside the site', 'since': '2026-11-01T10:00:00Z'} if status == 'suspended' else None),
         'restrictions': ([{'id': 'f1', 'reason': 'Took payment outside the site', 'since': '2026-11-01T10:00:00Z', 'by': 'Ops One', 'lifted_at': None, 'lift_reason': None, 'lifted_by': None}] if status == 'suspended' else []),
         'services': [{'id': 's1', 'name': 'Home deep clean', 'category': 'cleaning', 'price': 12000, 'rate_unit': 'per_job', 'location': 'Lagos', 'listing_status': 'active', 'available': True, 'verified': True, 'is_main': True, 'rating': 4.5, 'reviews_count': 2, 'created_at': '2026-10-02T09:00:00Z'}],
         'takedowns': [], 'applications': [{'id': 'a1', 'status': 'pending', 'created_at': '2026-11-02T10:00:00Z', 'task_title': '<b>Paint a fence</b>', 'task_status': 'open'}], 'application_counts': {'pending': 1, 'accepted': 2},
         'bookings': [{'id': 'b1', 'title': 'Fix sink', 'status': 'completed', 'payment_status': 'released', 'amount': 15000, 'created_at': '2026-10-05T09:00:00Z', 'customer': 'Ada'}], 'bookings_total': 1, 'bookings_open': 2,
         'reviews': {'count': 2, 'avg': 4.5, 'by_rating': {'5': 1, '4': 1}}, 'review_list': [{'id': 'r1', 'rating': 5, 'comment': 'Great work', 'created_at': '2026-10-06T09:00:00Z', 'reviewer': 'Ada'}],
         'verification': [{'status': 'VERIFIED', 'provider_status': 'Approved', 'reason_codes': [], 'liveness_ok': True, 'face_match_ok': True, 'document_ok': True, 'started': '2026-10-01T09:00:00Z', 'completed_at': '2026-10-01T09:05:00Z'}],
         'plan': {'label': 'PRO', 'subscription': {'plan': 'pro', 'tier': 'pro', 'status': 'active', 'period_start': '2026-11-01T00:00:00Z', 'period_end': '2026-12-01T00:00:00Z', 'cancel_at_period_end': False, 'pending_plan': None}},
         'disputes': [{'id': 'd1', 'category': 'quality', 'status': 'open', 'outcome': None, 'opened_at': '2026-11-02T10:00:00Z', 'resolved_at': None}],
         'money_allowed': money,
         'money': ({'wallet': {'balance': 50000, 'pending_balance': 12000, 'updated_at': '2026-11-08T10:00:00Z'}, 'transactions': [{'id': 'w1', 'type': 'credit', 'amount': 10560, 'status': 'completed', 'created_at': '2026-11-08T10:00:00Z', 'booking_id': 'b1'}],
                   'withdrawals': [{'id': 'x1', 'status': 'success', 'amount': 20000, 'fee': 100, 'net_amount': 19900, 'bank_name': 'GTBank', 'account_last4': '1234', 'failure_reason': None, 'created_at': '2026-11-07T10:00:00Z', 'settled_at': None}],
                   'withdrawal_counts': {'success': {'count': 1, 'amount': 20000}}, 'bank_accounts': [{'bank_name': 'GTBank', 'account_last4': '1234', 'is_default': True, 'verified_at': None, 'removed_at': None}], 'platform_fee_rate': 0.12} if money else None)}
    return d

LIST = {'ok': True, 'items': [item(1, 'Tunde Bello'), item(2, 'Bola Ade', 'suspended', flagged=True), item(3, '<img src=x onerror=window.__xss=1>', verified=False)], 'total': 3, 'offset': 0, 'limit': 25,
        'counts': {'all': 3, 'active': 2, 'suspended': 1, 'verified': 2, 'unverified': 1, 'available': 3, 'flagged': 1, 'open_dispute': 0}}
FULL = ['taskers.view', 'taskers.suspend', 'pii.reveal', 'payouts.view']
R = 'Took payment outside the site twice'

def sel(pg):
    pg.wait_for_selector('#tkBody .ad-row'); pg.locator('#tkBody .ad-row').first.click(); pg.wait_for_selector('#tkBody .ad-split-detail h2')
def tab(pg, name): pg.locator('#tkBody .ad-tabs button', has_text=name).click(); pg.wait_for_timeout(150)
def detail(pg): return txt(pg, '#tkBody .ad-split-detail')

with sync_playwright() as p:
    b = p.chromium.launch()

    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL, 'list': LIST, 'prof': prof()}); pg.wait_for_selector('#tkBody .ad-row')
    chk(pg.locator('#tkBody .ad-row').count() == 3 and '3 in all' in txt(pg, '#tkBody') and '2 identity verified' in txt(pg, '#tkBody'), '1 list shows 3 Taskers and the counts')
    chk(pg.evaluate('() => window.__xss') is None and not errs, '2 a hostile name is shown as text; no page errors')
    chk(calls(pg, 'admin_tasker_list')[0]['a'] == {'p_search': None, 'p_filter': 'all', 'p_offset': 0}, '3 first load asks for all, offset 0')
    chk(pg.locator('#tkFilter option').count() == 8, '4 the filter has 8 choices')
    pg.fill('#tkSearch', '  cleaning '); pg.select_option('#tkFilter', 'verified'); pg.locator('#tkFilters button[type=submit]').click(); pg.wait_for_timeout(200)
    chk(calls(pg, 'admin_tasker_list')[-1]['a'] == {'p_search': 'cleaning', 'p_filter': 'verified', 'p_offset': 0}, '5 search is trimmed and sent with the filter')
    pg.locator('#tkReset').click(); pg.wait_for_timeout(200)
    chk(calls(pg, 'admin_tasker_list')[-1]['a'] == {'p_search': None, 'p_filter': 'all', 'p_offset': 0}, '6 Reset goes back to all')

    sel(pg); t = detail(pg)
    chk(calls(pg, 'admin_tasker_get')[-1]['a'] == {'p_id': 't-1'}, '7 profile asked for the right Tasker')
    chk('Tunde Bello' in t and 't***@example.com' in t and '******678' in t and '******999' in t and 'Membership: PRO' in t and 'Identity verified' in t, '8 overview: masked contact, membership and identity badges apart')
    chk('real.person' not in t and '+234' not in t, '9 no real contact value on screen')
    chk(pg.locator('#tkBody .ad-tabs button').count() == 7, '10 seven tabs with the money permission')

    tab(pg, 'Services'); t = detail(pg); chk('Home deep clean' in t and '₦12,000' in t and 'does not record who paused' in t, '11 services tab shows the service and the honest note')
    tab(pg, 'Offers'); t = detail(pg); chk('Paint a fence' in t and 'accepted' in t and 'never shown' in t and pg.evaluate('() => !document.querySelector("#tkBody .ad-split-detail b")'), '12 offers tab: counts and list; hostile markup is text')
    tab(pg, 'Bookings'); t = detail(pg); chk('Fix sink' in t and '₦15,000' in t and 'Ada' in t, '13 bookings tab')
    tab(pg, 'Reviews'); t = detail(pg); chk('Great work' in t and '4.5' in t and '5 star' in t and 'never edited' in t, '14 reviews tab is read only')
    tab(pg, 'Earnings'); t = detail(pg); chk('₦50,000' in t and '₦12,000' in t and 'GTBank ****1234' in t and '12%' in t and 'Full account numbers are never shown' in t, '15 money tab: wallet, pending, withdrawal with last 4 only, fee rate')
    chk(pg.locator('#tkBody .ad-split-detail button', has_text='Reveal').count() == 0 and pg.locator('#tkBody .ad-split-detail textarea').count() == 0, '16 money tab has no control that changes anything')
    tab(pg, 'Verification'); t = detail(pg); chk('Approved' in t and 'not identity' in t and 'pro' in t.lower() and 'Nothing here sets or removes a verified mark' in t, '17 verification and plan are shown apart')
    tab(pg, 'Overview')

    pg.locator('#tkBody .ad-contact', has_text='Phone').locator('button', has_text='Reveal').click()
    pg.locator('#tkBody textarea').first.fill('short'); pg.locator('#tkBody button', has_text='Reveal phone').click()
    chk('at least 10' in txt(pg, '#tkBody .ad-error') and not calls(pg, 'admin_tasker_reveal'), '18 short reason refused, nothing sent')
    pg.locator('#tkBody textarea').first.fill('Customer asked us to call this Tasker'); pg.locator('#tkBody button', has_text='Reveal phone').click()
    chk(not calls(pg, 'admin_tasker_reveal'), '19 first press sends nothing')
    pg.locator('#tkBody button', has_text='Press again').click(); pg.wait_for_timeout(300)
    rc = calls(pg, 'admin_tasker_reveal')
    chk(len(rc) == 1 and rc[0]['a']['p_id'] == 't-1' and rc[0]['a']['p_field'] == 'phone', '20 second press reveals once with id and field')

    pg.locator('#tkBody textarea').last.fill(R); pg.locator('#tkBody button', has_text='Suspend Tasker').click()
    chk(not calls(pg, 'invoke:admin-account-action') and '2 open or pending bookings' in detail(pg) and 'public profile stays visible' in detail(pg), '21 suspend: first press sends nothing, warns about open bookings and the public profile')
    pg.locator('#tkBody button', has_text='Press again').click(); pg.wait_for_timeout(400)
    ac = calls(pg, 'invoke:admin-account-action')
    chk(len(ac) == 1 and ac[0]['a'] == {'target': 'tasker', 'user_id': 't-1', 'action': 'suspend', 'reason': R}, '22 second press calls the function with target tasker, id, action, reason only')
    chk('Tasker suspended' in pg.locator('#adToasts').inner_text() and len(calls(pg, 'admin_tasker_list')) >= 3 and not errs, '23 toast, list reloads, no page errors')
    cx.close()

    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL, 'list': LIST, 'prof': prof('suspended')}); sel(pg)
    chk('Suspended since' in detail(pg) and 'Took payment outside' in detail(pg) and pg.locator('#tkBody button', has_text='Suspend Tasker').count() == 0, '24 suspended profile shows reason and history, offers Restore only')
    pg.locator('#tkBody textarea').last.fill('Appeal reviewed and the payment was refunded'); pg.locator('#tkBody button', has_text='Restore Tasker').click(); pg.locator('#tkBody button', has_text='Press again').click(); pg.wait_for_timeout(400)
    ac = calls(pg, 'invoke:admin-account-action'); chk(len(ac) == 1 and ac[0]['a']['action'] == 'restore' and ac[0]['a']['target'] == 'tasker', '25 restore sends action restore for the tasker target')
    cx.close()

    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL, 'list': LIST, 'prof': prof(), 'sendFail': 'This login is a coordinator.'}); sel(pg)
    pg.locator('#tkBody textarea').last.fill(R); pg.locator('#tkBody button', has_text='Suspend Tasker').click(); pg.locator('#tkBody button', has_text='Press again').click(); pg.wait_for_timeout(400)
    chk('coordinator' in txt(pg, '#tkBody .ad-split-detail .ad-error'), '26 server refusal text is shown')
    cx.close()

    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL, 'list': LIST, 'prof': prof(is_admin=True)}); sel(pg)
    chk('Also an admin login' in detail(pg) and pg.locator('#tkBody button', has_text='Suspend Tasker').count() == 0, '27 a login that is also an admin has no suspend form')
    cx.close()

    pg, cx, errs = open_page(b, 'taskers', {'perms': ['taskers.view'], 'list': LIST, 'prof': prof(money=False)}); sel(pg)
    chk(pg.locator('#tkBody .ad-tabs button').count() == 6 and pg.locator('#tkBody .ad-tabs button', has_text='Earnings').count() == 0, '28 without payouts.view there is no money tab')
    chk(pg.locator('#tkBody button', has_text='Reveal').count() == 0 and pg.locator('#tkBody button', has_text='Suspend Tasker').count() == 0 and 'cannot reveal' in detail(pg), '29 view-only role: no Reveal, no Suspend')
    cx.close()

    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL, 'list': LIST, 'prof': prof()}); pg.wait_for_selector('#tkBody .ad-row')
    chk(pg.locator('#adNav a', has_text='Regular Taskers').count() == 1, '30 Regular Taskers is in the menu')
    cx.close()
    pg, cx, errs = open_page(b, 'taskers', {'perms': ['customers.view']}); pg.wait_for_timeout(600)
    chk(pg.locator('#adNav a', has_text='Regular Taskers').count() == 0 and pg.locator('#tkBody .ad-row').count() == 0, '31 without taskers.view: no menu entry and no list')
    cx.close()

    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL, 'listFail': True}); pg.wait_for_timeout(600)
    chk('Could not load customers' in txt(pg, '#tkBody'), '32 list failure shows the message with a retry')
    cx.close()
    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL}); pg.wait_for_timeout(400)
    chk('No Taskers yet' in txt(pg, '#tkBody'), '33 empty directory says so')
    cx.close()

    pg, cx, errs = open_page(b, 'taskers', {'perms': FULL, 'list': LIST, 'prof': prof()}, w=390); sel(pg); tab(pg, 'Earnings')
    chk(pg.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), '34 390px: no sideways scroll on the money tab')
    cx.close()
    b.close()

bad = [t for ok, t in results if not ok]
for ok, t in results: print(('PASS ' if ok else 'FAIL ') + t)
print('RESULT: %s (%d checks)' % ('ALL PASS' if not bad else '%d FAILED' % len(bad), len(results)))
sys.exit(1 if bad else 0)

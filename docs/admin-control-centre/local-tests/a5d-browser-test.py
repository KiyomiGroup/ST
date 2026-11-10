# LOCAL ONLY (A5d): headless browser test of admin/team.html and admin/roles.html change flow against a FAKE Supabase.
# Proves page logic (what is asked, how many presses, what is sent), NOT real data and NOT the SQL. Run:
#   python3 a5d-browser-test.py <repo root>      (needs pip playwright + chromium)
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
    return """(function(){ var scn=%s, T=%s, R=%s, M=%s; window.__calls=[]; var applied=false;
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a||{}}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
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

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- team page, manager
    pg, cx, errs = open_page(b, 'team', {'perms': MGR}); pg.wait_for_selector('#tmBody table')
    chk(pg.locator('#tmBody tbody tr').count() == 2 and pg.locator('#tmBody tbody button', has_text='Change').count() == 1, '1 Change button only on the other active admin (not on your own row)')
    chk('Another Super Admin must change your row' in txt(pg, '#tmBody tbody tr'), '2 own row says another Super Admin must change it')
    pg.locator('#tmBody tbody button', has_text='Change').click()
    chk(pg.locator('#tmEdit input[type=checkbox]').count() == 4, '3 one checkbox per role')
    chk(pg.locator('#tmEdit input[type=checkbox]:checked').count() == 2, '4 current roles are ticked')
    pg.locator('#tmEdit button', has_text='Ask to change roles').click()
    chk('at least 10 characters' in txt(pg, '#tmEdit .ad-error') and not calls(pg, 'admin_team_request_change'), '5 short reason refused, nothing sent')
    pg.locator('#tmEdit textarea').fill(REASON)
    pg.locator('#tmEdit input[value=operations]').uncheck(); pg.locator('#tmEdit input[value=support]').uncheck()
    pg.locator('#tmEdit button', has_text='Ask to change roles').click()
    chk('at least one role' in txt(pg, '#tmEdit .ad-error') and not calls(pg, 'admin_team_request_change'), '6 no role chosen: refused, nothing sent')
    pg.locator('#tmEdit input[value=content]').check(); pg.locator('#tmEdit input[value=operations]').check()
    pg.locator('#tmEdit button', has_text='Ask to change roles').click()
    sure = pg.locator('#tmEdit').inner_text()
    chk('You are asking to set the roles of' in sure and 'Content Admin' in sure.split('to:')[-1] and 'Operations Admin' in sure.split('to:')[-1] and 'Support Admin' not in sure.split('to:')[-1], '7 first press shows exactly the roles that will be asked for')
    chk(not calls(pg, 'admin_team_request_change'), '8 first press sends nothing')
    pg.locator('#tmEdit button', has_text='Press again').click(); pg.wait_for_timeout(200)
    c = calls(pg, 'admin_team_request_change')
    chk(len(c) == 1 and sorted(c[0]['a']['p_roles']) == ['content', 'operations'] and {k: v for k, v in c[0]['a'].items() if k != 'p_roles'} == {'p_user': 'u2', 'p_change': 'set_roles', 'p_reason': REASON}, '9 second press sends one request with the right arguments (the server sorts the roles)')
    chk(pg.locator('#tmEdit').inner_text().strip() == '' , '10 form closes after success')
    chk(not calls(pg, 'admin_team_apply_change'), '11 asking never applies anything')
    chk(pg.evaluate('() => window.__xss') is None, '12 no markup run')
    # suspend path
    pg.locator('#tmBody tbody button', has_text='Change').click()
    pg.locator('#tmEdit textarea').fill(REASON)
    pg.locator('#tmEdit button', has_text='Ask to suspend').click()
    chk('SUSPEND' in pg.locator('#tmEdit').inner_text() and 'lose all admin access' in pg.locator('#tmEdit').inner_text(), '13 suspend: first press says what will happen')
    pg.locator('#tmEdit button', has_text='Press again').click(); pg.wait_for_timeout(200)
    c = calls(pg, 'admin_team_request_change')
    chk(len(c) == 2 and c[1]['a']['p_change'] == 'suspend' and c[1]['a']['p_roles'] is None, '14 suspend sends p_change suspend')
    # reactivate path
    pg.locator('#tmTabs button', has_text='Not active').click()
    chk(pg.locator('#tmBody tbody button', has_text='Change').count() == 1, '15 removed admin has no button; suspended one has')
    pg.locator('#tmBody tbody button', has_text='Change').click()
    chk(pg.locator('#tmEdit button', has_text='Ask to reactivate').count() == 1 and pg.locator('#tmEdit input[type=checkbox]').count() == 0, '16 suspended admin: only Ask to reactivate')
    pg.locator('#tmEdit textarea').fill(REASON); pg.locator('#tmEdit button', has_text='Ask to reactivate').click()
    pg.locator('#tmEdit button', has_text='Press again').click(); pg.wait_for_timeout(200)
    c = calls(pg, 'admin_team_request_change'); chk(c[-1]['a']['p_change'] == 'reactivate', '17 reactivate sends p_change reactivate')
    chk(not errs, '18 no page errors'); cx.close()

    # server refusal
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'reqFail': True}); pg.wait_for_selector('#tmBody table')
    pg.locator('#tmBody tbody button', has_text='Change').click(); pg.locator('#tmEdit textarea').fill(REASON)
    pg.locator('#tmEdit button', has_text='Ask to suspend').click(); pg.locator('#tmEdit button', has_text='Press again').click(); pg.wait_for_timeout(200)
    chk('last active Super Admin' in txt(pg, '#tmEdit .ad-error') and pg.locator('#tmEdit .ad-error').is_visible(), '19 server refusal text is shown, form stays open'); cx.close()

    # my requests panel: waiting
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'mine': [mine('pending')]}); pg.wait_for_selector('#tmBody table'); pg.wait_for_timeout(200)
    chk('Waiting for another Super Admin' in pg.locator('#tmRoot').inner_text() and pg.locator('#tmRoot button', has_text='Apply').count() == 0, '20 pending request: waiting message, no Apply button')
    chk('<b>Ops One</b>' in pg.locator('#tmRoot').inner_text() and pg.evaluate('() => !document.querySelector("#tmRoot b")'), '21 request label shown as text'); cx.close()
    # approved: apply
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'mine': [mine('approved')]}); pg.wait_for_selector('#tmBody table'); pg.wait_for_timeout(200)
    chk('set roles to Content Admin, Operations Admin' in pg.locator('#tmRoot').inner_text(), '22 approved request describes the change')
    n0 = len(calls(pg, 'admin_team_list'))
    pg.locator('#tmRoot button', has_text='Apply the approved change').click()
    chk(not calls(pg, 'admin_team_apply_change'), '23 first press applies nothing')
    pg.locator('#tmRoot button', has_text='Press again to apply').click(); pg.wait_for_timeout(300)
    c = calls(pg, 'admin_team_apply_change')
    chk(len(c) == 1 and c[0]['a'] == {'p_approval': 'req-1'}, '24 second press applies with the approval id only')
    chk(len(calls(pg, 'admin_team_list')) == n0 + 1, '25 team reloaded from the server after applying')
    chk(pg.locator('#tmRoot button', has_text='Apply').count() == 0, '26 request disappears once applied'); cx.close()
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'mine': [mine('approved')], 'applyFail': True}); pg.wait_for_selector('#tmBody table'); pg.wait_for_timeout(200)
    pg.locator('#tmRoot button', has_text='Apply the approved change').click(); pg.locator('#tmRoot button', has_text='Press again to apply').click(); pg.wait_for_timeout(300)
    chk('target changed' in pg.locator('#tmRoot').inner_text() and pg.locator('#tmRoot button', has_text='Apply').count() == 1, '27 apply refusal shown, button usable again'); cx.close()

    # view-only admin
    pg, cx, errs = open_page(b, 'team', {'perms': ['admin.team.view']}); pg.wait_for_selector('#tmBody table')
    chk(pg.locator('#tmBody button').count() == 0 and not calls(pg, 'admin_team_changes_mine') and not calls(pg, 'admin_role_directory'), '28 view-only admin: no buttons, no manage calls'); cx.close()
    # phone
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'mine': [mine('approved')]}, 390); pg.wait_for_selector('#tmBody table')
    pg.locator('#tmBody tbody button', has_text='Change').click()
    chk(pg.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), '29 phone: change panel has no sideways scroll'); cx.close()

    # ---------------- roles page
    pg, cx, errs = open_page(b, 'roles', {'perms': MGR}); pg.wait_for_selector('#rlBody table')
    chk(pg.locator('#rlBody button', has_text='Ask to change').count() == 0, '30 Super Admin tab has no edit button')
    pg.locator('#rlTabs button', has_text='Operations Admin').click()
    chk(pg.locator('#rlBody button', has_text='Ask to change this role').count() == 1, '31 other role has the edit button')
    pg.locator('#rlBody button', has_text='Ask to change this role').click()
    chk(pg.locator('#rlBody input[type=checkbox]').count() == 4 and pg.locator('#rlBody input[type=checkbox]:checked').count() == 1, '32 edit mode: a checkbox per permission, current one ticked')
    chk(pg.locator('#rlBody input[value="approvals.decide"]').is_disabled(), '33 approvals.decide checkbox is disabled (Super Admin only)')
    pg.locator('#rlBody textarea').fill(REASON)
    pg.locator('#rlBody button', has_text='Ask to change permissions').click()
    chk('Nothing is different' in txt(pg, '#rlBody .ad-error') and not calls(pg, 'admin_role_request_change'), '34 no difference: refused, nothing sent')
    pg.locator('#rlBody input[value="bookings.manage"]').check()
    pg.locator('#rlBody button', has_text='Ask to change permissions').click()
    chk('ADD bookings.manage' in pg.locator('#rlBody').inner_text() and not calls(pg, 'admin_role_request_change'), '35 first press lists exactly what is added or removed')
    pg.locator('#rlBody button', has_text='Press again').click(); pg.wait_for_timeout(250)
    c = calls(pg, 'admin_role_request_change')
    chk(len(c) == 1 and sorted(c[0]['a']['p_permissions']) == ['bookings.manage', 'bookings.view'] and c[0]['a']['p_role'] == 'operations' and c[0]['a']['p_reason'] == REASON, '36 second press sends the full permission list')
    chk(pg.locator('#rlBody input[type=checkbox]').count() == 0, '37 edit mode closes after success')
    chk(not calls(pg, 'admin_role_apply_change'), '38 asking never applies anything')
    chk(not errs, '39 no page errors'); cx.close()
    pg, cx, errs = open_page(b, 'roles', {'perms': MGR, 'mine': [mine('approved', 'admin.role.change'), mine('approved')]}); pg.wait_for_selector('#rlBody table'); pg.wait_for_timeout(300)
    chk(pg.locator('#rlRoot button', has_text='Apply the approved change').count() == 1 and 'add bookings.manage' in pg.locator('#rlRoot').inner_text(), '40 roles page shows only role requests, described as add and remove')
    pg.locator('#rlRoot button', has_text='Apply the approved change').click(); pg.locator('#rlRoot button', has_text='Press again to apply').click(); pg.wait_for_timeout(300)
    c = calls(pg, 'admin_role_apply_change'); chk(len(c) == 1 and c[0]['a'] == {'p_approval': 'req-2'}, '41 role apply sends the approval id only'); cx.close()
    pg, cx, errs = open_page(b, 'roles', {'perms': ['admin.team.view']}); pg.wait_for_selector('#rlBody table')
    pg.locator('#rlTabs button', has_text='Operations Admin').click()
    chk(pg.locator('#rlBody button').count() == 0 and not calls(pg, 'admin_team_changes_mine'), '42 view-only admin: no edit button, no manage call'); cx.close()
    pg, cx, errs = open_page(b, 'roles', {'perms': MGR}, 390); pg.wait_for_selector('#rlBody table')
    pg.locator('#rlTabs button', has_text='Operations Admin').click(); pg.locator('#rlBody button', has_text='Ask to change this role').click()
    chk(pg.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), '43 phone: roles edit mode has no sideways scroll'); cx.close()
    b.close()

bad = [t for ok, t in results if not ok]
for ok, t in results: print(('PASS ' if ok else 'FAIL ') + t)
print('%d checks, %d failed' % (len(results), len(bad))); sys.exit(1 if bad else 0)

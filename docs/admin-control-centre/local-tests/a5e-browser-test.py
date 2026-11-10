# LOCAL ONLY (A5e): headless browser test of the invite flow (admin/team.html, admin/accept-invite.html) against a FAKE Supabase.
# Proves page logic (what is asked, how many presses, what is sent), NOT real data and NOT the SQL. Run:
#   python3 a5e-browser-test.py <repo root>      (needs pip playwright + chromium)
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
    return """(function(){ var scn=%s, T=%s, R=%s, M=%s; window.__calls=[]; var applied=false, sent=false;
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session: scn.noSession?null:{user:{id:'me'}}}});}, signOut:function(){window.__signedOut=true;return Promise.resolve({});}, updateUser:function(a){window.__calls.push({n:'updateUser',a:a}); console.log('__CALL__'+JSON.stringify({n:'updateUser',a:a}));return Promise.resolve(scn.pwFail?{error:{message:'weak'}}:{data:{},error:null});} },
   functions:{ invoke:function(n,o){ window.__calls.push({n:'invoke:'+n,a:(o&&o.body)||{}}); return new Promise(function(res){ setTimeout(function(){ if(scn.sendFail){ res({data:null,error:{context:{json:function(){return Promise.resolve({ok:false,message:scn.sendFail});}}}}); } else { sent=true; res({data:{ok:true,email:'new@example.com',email_sent:!scn.existingLogin,existing_login:!!scn.existingLogin},error:null}); } },5); }); } },
   rpc:function(n,a){ window.__calls.push({n:n,a:a||{}}); console.log('__CALL__'+JSON.stringify({n:n,a:a||{}})); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access'&&scn.notAdmin) return ok({active:false});
   if(n==='admin_invite_request'){ if(scn.reqFail) return ok({ok:false,error:'This email already has a customer, Tasker or coordinator account. Use a separate email made only for admin work.'}); return ok({ok:true,id:'inv-new'}); }
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

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- team page, manager, ask for an invite
    pg, cx, errs = open_page(b, 'team', {'perms': MGR}); pg.wait_for_selector('#tmBody table')
    chk(pg.locator('#tmInviteOpen').count() == 1, '1 manager sees the Invite an admin button')
    pg.locator('#tmInviteOpen').click()
    chk(pg.locator('#tmInvite input[type=checkbox]').count() == 4 and pg.locator('#tmInvite input[type=checkbox]:checked').count() == 0, '2 one checkbox per role, none ticked')
    pg.locator('#tmInvite button', has_text='Ask to invite').click()
    chk('valid email' in txt(pg, '#tmInvite .ad-error') and not calls(pg, 'admin_invite_request'), '3 empty email refused, nothing sent')
    pg.locator('#tmInvEmail').fill('not-an-email'); pg.locator('#tmInvite button', has_text='Ask to invite').click()
    chk('valid email' in txt(pg, '#tmInvite .ad-error'), '4 bad email refused')
    pg.locator('#tmInvEmail').fill('  New@Example.COM '); pg.locator('#tmInvite button', has_text='Ask to invite').click()
    chk('at least one role' in txt(pg, '#tmInvite .ad-error') and not calls(pg, 'admin_invite_request'), '5 no role refused, nothing sent')
    pg.locator('#tmInvite input[value=content]').check(); pg.locator('#tmInvite input[value=operations]').check()
    pg.locator('#tmInvite button', has_text='Ask to invite').click()
    chk('at least 10 characters' in txt(pg, '#tmInvite .ad-error') and not calls(pg, 'admin_invite_request'), '6 short reason refused, nothing sent')
    pg.locator('#tmInvite textarea').fill(REASON); pg.locator('#tmInvName').fill('New Person')
    pg.locator('#tmInvite button', has_text='Ask to invite').click()
    sure = pg.locator('#tmInvite').inner_text()
    chk('new@example.com' in sure and 'Content Admin' in sure.split('as:')[-1] and 'Operations Admin' in sure.split('as:')[-1] and 'Support Admin' not in sure.split('as:')[-1], '7 first press shows the cleaned email and exactly the roles')
    chk(not calls(pg, 'admin_invite_request'), '8 first press sends nothing')
    pg.locator('#tmInvite button', has_text='Press again').click(); pg.wait_for_timeout(200)
    c = calls(pg, 'admin_invite_request')
    chk(len(c) == 1 and c[0]['a']['p_email'] == 'new@example.com' and sorted(c[0]['a']['p_roles']) == ['content', 'operations'] and c[0]['a']['p_reason'] == REASON and c[0]['a']['p_name'] == 'New Person', '9 second press sends one request with the right arguments')
    chk(not calls(pg, 'invoke:admin-invite') and pg.locator('#tmInvite').inner_text().strip() == '', '10 asking sends no invitation; form closes')
    chk(pg.evaluate('() => window.__xss') is None and not errs, '11 no markup run, no page errors')
    cx.close()

    # ---------------- server refusal is shown
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'reqFail': True}); pg.wait_for_selector('#tmBody table')
    pg.locator('#tmInviteOpen').click(); pg.locator('#tmInvEmail').fill('buyer@example.com'); pg.locator('#tmInvite input[value=content]').check()
    pg.locator('#tmInvite textarea').fill(REASON)
    pg.locator('#tmInvite button', has_text='Ask to invite').click(); pg.locator('#tmInvite button', has_text='Press again').click(); pg.wait_for_timeout(200)
    chk('separate email' in txt(pg, '#tmInvite .ad-error') and pg.locator('#tmInvite form').count() == 1, '12 server refusal (existing account) is shown and the form stays')
    cx.close()

    # ---------------- waiting request: no Send button
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'invites': [inv('pending', email='<img src=x onerror=window.__xss=1>@e.com')]}); pg.wait_for_selector('#tmInvites li')
    chk(pg.locator('#tmInvites button').count() == 0 and 'Waiting for another Super Admin' in txt(pg, '#tmInvites'), '13 pending invite has no Send button')
    chk(pg.evaluate('() => window.__xss') is None, '14 email shown as text, no markup run')
    cx.close()

    # ---------------- approved request: two presses, sends only the approval id
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'invites': [inv('approved')]}); pg.wait_for_selector('#tmInvites li')
    chk('new@example.com' in txt(pg, '#tmInvites') and 'Content Admin' in txt(pg, '#tmInvites') and 'Approved' in txt(pg, '#tmInvites'), '15 approved invite shows email, roles and status')
    pg.locator('#tmInvites button', has_text='Send the invitation').click()
    chk(not calls(pg, 'invoke:admin-invite') and 'Press again' in txt(pg, '#tmInvites button'), '16 first press sends nothing')
    pg.locator('#tmInvites button').click(); pg.wait_for_timeout(300)
    c = calls(pg, 'invoke:admin-invite')
    chk(len(c) == 1 and c[0]['a'] == {'approval_id': 'inv-1'}, '17 second press calls the function with ONLY the approval id (no email, no roles)')
    chk(pg.locator('#tmInvites li').count() == 0 and 'Invitation sent to new@example.com' in pg.locator('#adToasts').inner_text(), '18 success toast and the list reloads')
    cx.close()

    # ---------------- existing login: no email, said plainly
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'invites': [inv('approved')], 'existingLogin': True}); pg.wait_for_selector('#tmInvites li')
    pg.locator('#tmInvites button').click(); pg.locator('#tmInvites button').click(); pg.wait_for_timeout(300)
    chk('no email was sent' in pg.locator('#adToasts').inner_text(), '19 existing login: says no email was sent')
    cx.close()

    # ---------------- send refused by the server
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'invites': [inv('approved')], 'sendFail': 'That approval has expired. Ask again.'}); pg.wait_for_selector('#tmInvites li')
    pg.locator('#tmInvites button').click(); pg.locator('#tmInvites button').click(); pg.wait_for_timeout(300)
    chk('expired' in txt(pg, '#tmInvites .ad-error') and pg.locator('#tmInvites li').count() == 1, '20 refusal text shown, request stays listed')
    cx.close()

    # ---------------- view-only admin
    pg, cx, errs = open_page(b, 'team', {'perms': ['admin.team.view']}); pg.wait_for_selector('#tmBody table')
    chk(pg.locator('#tmInviteOpen').count() == 1 and pg.locator('#tmInviteOpen').is_hidden() or pg.locator('#tmInviteOpen').count() == 0, '21 view-only admin has no invite button')
    chk(not calls(pg, 'admin_invites_mine'), '22 view-only admin never asks for invitations')
    cx.close()

    # ---------------- phone layout
    pg, cx, errs = open_page(b, 'team', {'perms': MGR, 'invites': [inv('approved')]}, w=390); pg.wait_for_selector('#tmInvites li')
    pg.locator('#tmInviteOpen').click()
    chk(pg.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), '23 390px: no sideways scroll with the invite form and list open')
    cx.close()

    # ---------------- accept-invite page
    pg, cx, errs = open_page(b, 'accept-invite', {'perms': []}); pg.wait_for_selector('#aiForm:not([hidden])')
    chk('Choose a password' in txt(pg, '#aiIntro'), '24 with a session, the password form shows')
    pg.fill('#aiPw1', 'short'); pg.fill('#aiPw2', 'short'); pg.click('#aiBtn')
    chk('12 characters' in txt(pg, '#aiMsg') and not calls(pg, 'updateUser'), '25 short password refused, nothing sent')
    pg.fill('#aiPw1', 'a-long-password-1'); pg.fill('#aiPw2', 'a-long-password-2'); pg.click('#aiBtn')
    chk('do not match' in txt(pg, '#aiMsg') and not calls(pg, 'updateUser'), '26 mismatch refused, nothing sent')
    seen = []
    pg.on('console', lambda m: seen.append(json.loads(m.text[8:])) if m.text.startswith('__CALL__') else None)
    pg.fill('#aiPw2', 'a-long-password-1'); pg.click('#aiBtn'); pg.wait_for_timeout(600)
    ups = [c for c in seen if c['n'] == 'updateUser']; acc = [c for c in seen if c['n'] == 'admin_my_access']
    chk(len(ups) == 1 and ups[0]['a'] == {'password': 'a-long-password-1'} and acc and seen.index(acc[0]) > seen.index(ups[0]), '27 valid password is saved once, then the database is asked about admin access')
    chk(pg.url.endswith('/admin/index.html'), '28 an active admin goes to the admin home')
    cx.close()
    pg, cx, errs = open_page(b, 'accept-invite', {'perms': [], 'notAdmin': True}); pg.wait_for_selector('#aiForm:not([hidden])')
    pg.fill('#aiPw1', 'a-long-password-1'); pg.fill('#aiPw2', 'a-long-password-1'); pg.click('#aiBtn'); pg.wait_for_timeout(400)
    chk('does not have admin access' in txt(pg, '#aiMsg') and pg.evaluate('() => window.__signedOut') is True and '/accept-invite' in pg.url, '29 a login that is not an admin is signed out and told')
    cx.close()
    pg, cx, errs = open_page(b, 'accept-invite', {'perms': [], 'noSession': True}); pg.wait_for_selector('#aiMsg:not([hidden])', timeout=8000)
    chk('expired' in txt(pg, '#aiIntro') and pg.locator('#aiForm').is_hidden(), '30 no session (expired or used link): no form, clear message')
    cx.close()

    b.close()

bad = [t for ok, t in results if not ok]
for ok, t in results: print(('PASS ' if ok else 'FAIL ') + t)
print('RESULT: %s (%d checks)' % ('ALL PASS' if not bad else '%d FAILED' % len(bad), len(results)))
sys.exit(1 if bad else 0)

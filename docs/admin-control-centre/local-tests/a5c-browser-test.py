# LOCAL ONLY (A5c): headless browser test of admin/team.html and admin/roles.html against a FAKE Supabase.
# Proves layout and page logic, NOT real data and NOT the SQL. Run:  python3 a5c-browser-test.py <repo root>   (needs pip playwright + chromium)
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

TEAM = {'mfa_required': False, 'active_super_admins': 2, 'rows': [
  {'user_id': 'u1', 'display_name': 'Kiyomi', 'email': 'kiyomigroups@gmail.com', 'status': 'active', 'removed': False, 'created_at': '2026-11-07T10:00:00Z', 'last_seen_at': '2026-11-09T09:00:00Z', 'is_me': True, 'roles': [{'key': 'super_admin', 'label': 'Super Admin'}], 'mfa_on': True},
  {'user_id': 'u2', 'display_name': '<img src=x onerror=window.__xss=1>Ops One', 'email': 'ops@example.com', 'status': 'active', 'removed': False, 'created_at': '2026-11-08T10:00:00Z', 'last_seen_at': None, 'is_me': False, 'roles': [{'key': 'operations', 'label': 'Operations Admin'}, {'key': 'support', 'label': 'Support Admin'}], 'mfa_on': False},
  {'user_id': 'u3', 'display_name': None, 'email': 'old@example.com', 'status': 'suspended', 'removed': False, 'created_at': '2026-10-01T10:00:00Z', 'last_seen_at': '2026-10-05T10:00:00Z', 'is_me': False, 'roles': [], 'mfa_on': False},
  {'user_id': 'u4', 'display_name': 'Gone Admin', 'email': 'gone@example.com', 'status': 'removed', 'removed': True, 'created_at': '2026-09-01T10:00:00Z', 'last_seen_at': None, 'is_me': False, 'roles': [{'key': 'content', 'label': 'Content Admin'}], 'mfa_on': False}]}
PERMS = [
  {'key': 'admin.team.view', 'label': 'View the admin team', 'group_name': 'Admin', 'sensitive': False},
  {'key': 'admin.team.manage', 'label': 'Manage the admin team', 'group_name': 'Admin', 'sensitive': True},
  {'key': 'bookings.view', 'label': 'View bookings and tasks', 'group_name': 'Operations', 'sensitive': False},
  {'key': 'bookings.manage', 'label': 'Manage bookings and tasks', 'group_name': 'Operations', 'sensitive': True}]
ROLES = {'permissions': PERMS, 'roles': [
  {'key': 'super_admin', 'label': 'Super Admin', 'is_system': True, 'all_permissions': True, 'permission_keys': [p['key'] for p in PERMS], 'members': ['Kiyomi', 'Admin Two']},
  {'key': 'operations', 'label': 'Operations Admin', 'is_system': True, 'all_permissions': False, 'permission_keys': ['bookings.view', 'bookings.manage'], 'members': ['<b>Ops</b> One']},
  {'key': 'content', 'label': 'Content Admin', 'is_system': True, 'all_permissions': False, 'permission_keys': [], 'members': []}]}

def fake(scn):
    return """(function(){ var scn=%s, T=%s, R=%s; window.__calls=[];
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a||{}}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['super_admin'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(scn.missing) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(scn.denied) return {data:null,error:{code:'42501',message:'You do not have permission'}};
   if(n==='admin_team_list'){ var t=JSON.parse(JSON.stringify(T)); if(scn.one) t.active_super_admins=1; if(scn.mfa) t.mfa_required=true; if(scn.empty) t.rows=[]; return ok(t); }
   if(n==='admin_role_directory') return ok(scn.emptyRoles?{roles:[],permissions:[]}:R);
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();""" % tuple(json.dumps(x) for x in (scn, TEAM, ROLES))

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
def calls(page): return page.evaluate('() => window.__calls.map(c => c.n)')
def txt(page, s): return page.locator(s).first.inner_text()
SUPER = ['admin.team.view', 'approvals.view', 'audit_logs.view']   # view only: A5d adds buttons for admin.team.manage and admin.roles.manage (see a5d-browser-test.py)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- team page, full
    pg, cx, errs = open_page(b, 'team', {'perms': SUPER}); pg.wait_for_selector('#tmBody table')
    nav = pg.locator('#adNav').inner_text()
    chk('Admin team' in nav and 'Roles and permissions' in nav, '1 menu shows Admin team and Roles and permissions for a Super Admin')
    chk(pg.locator('#tmBody tbody tr').count() == 2, '2 Active tab lists the 2 active admins')
    chk('Active (2)' in txt(pg, '#tmTabs') and 'Not active (2)' in txt(pg, '#tmTabs') and 'All (4)' in txt(pg, '#tmTabs'), '3 tab counts 2, 2, 4')
    chk('Kiyomi' in txt(pg, '#tmBody') and 'You' in txt(pg, '#tmBody tbody tr'), '4 own row is marked You')
    chk('kiyomigroups@gmail.com' in txt(pg, '#tmBody'), '5 email shown')
    chk(pg.evaluate('() => window.__xss') is None and '<img' in txt(pg, '#tmBody'), '6 markup in a name is shown as text, never run')
    chk('Operations Admin' in txt(pg, '#tmBody') and 'Support Admin' in txt(pg, '#tmBody'), '7 several roles shown')
    chk('Never' in txt(pg, '#tmBody'), '8 admin who never signed in shows Never')
    chk(pg.locator('#tmBody td[data-label="Two-step"]').nth(0).inner_text() == 'On' and pg.locator('#tmBody td[data-label="Two-step"]').nth(1).inner_text() == 'Off', '9 two-step On and Off words')
    chk('not required for every admin' in txt(pg, '#tmNotes'), '10 note when two-step is not required')
    chk('Only one Super Admin' not in txt(pg, '#tmNotes'), '11 no single-Super-Admin warning when there are two')
    pg.locator('#tmTabs button', has_text='Not active').click()
    chk(pg.locator('#tmBody tbody tr').count() == 2 and 'Suspended' in txt(pg, '#tmBody') and 'Removed' in txt(pg, '#tmBody') and 'Unnamed admin' in txt(pg, '#tmBody'), '12 Not active tab: suspended, removed, unnamed')
    pg.locator('#tmTabs button', has_text='All').click()
    chk(pg.locator('#tmBody tbody tr').count() == 4, '13 All tab lists all 4')
    chk(set(calls(pg)) <= {'admin_my_access', 'admin_team_list'}, '14 only read functions were called')
    chk(pg.locator('#tmBody button, #tmBody input, #tmBody form').count() == 0, '15 no button, input or form in the table (read only)')
    chk(calls(pg).count('admin_team_list') == 1, '16 tabs filter in the page, no extra server call')
    chk(not errs, '17 no page errors'); cx.close()

    # ---- team: one Super Admin, two-step required
    pg, cx, errs = open_page(b, 'team', {'perms': SUPER, 'one': True, 'mfa': True}); pg.wait_for_selector('#tmBody table')
    chk('Only one Super Admin' in txt(pg, '#tmNotes') and 'not required' not in txt(pg, '#tmNotes'), '18 warns when only one Super Admin is active; no two-step note when required')
    cx.close()
    # ---- team: empty, missing, denied, no permission
    pg, cx, errs = open_page(b, 'team', {'perms': SUPER, 'empty': True}); pg.wait_for_selector('#tmBody')
    pg.wait_for_timeout(300); chk('Nothing here yet' in txt(pg, '#tmBody'), '19 empty state'); cx.close()
    pg, cx, errs = open_page(b, 'team', {'perms': SUPER, 'missing': True}); pg.wait_for_timeout(400)
    chk('a5c-team-read.sql' in txt(pg, '#tmBody') and 'Retry' in txt(pg, '#tmBody'), '20 function missing names the SQL file and offers Retry'); cx.close()
    pg, cx, errs = open_page(b, 'team', {'perms': SUPER, 'denied': True}); pg.wait_for_timeout(400)
    chk('do not have access' in txt(pg, '#tmBody'), '21 server refusal shows no-permission'); cx.close()
    pg, cx, errs = open_page(b, 'team', {'perms': ['approvals.view']}); pg.wait_for_timeout(400)
    chk('do not have access' in txt(pg, '#adMain') and 'admin_team_list' not in calls(pg), '22 admin without admin.team.view: no access, no team call')
    nav = pg.locator('#adNav').inner_text(); chk('Admin team' not in nav and 'Roles and permissions' not in nav, '23 menu hides both items without the permission'); cx.close()

    # ---- phone layout
    pg, cx, errs = open_page(b, 'team', {'perms': SUPER}, 390); pg.wait_for_selector('#tmBody table')
    chk(pg.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), '24 phone: no sideways scroll'); cx.close()

    # ---- roles page
    pg, cx, errs = open_page(b, 'roles', {'perms': SUPER}); pg.wait_for_selector('#rlBody table')
    chk(pg.locator('#rlTabs button').count() == 3, '25 one tab per role')
    chk('Holds every permission' in txt(pg, '#rlBody') and 'System role' in txt(pg, '#rlBody'), '26 Super Admin: every permission, System role')
    chk(pg.locator('#rlBody td[data-label="Access"]', has_text='Not allowed').count() == 0, '27 Super Admin: nothing marked Not allowed')
    chk('Kiyomi, Admin Two' in txt(pg, '#rlBody'), '28 members listed')
    chk(pg.locator('#rlBody .badge-amber', has_text='Sensitive').count() == 2, '29 sensitive permissions marked')
    chk(pg.locator('#rlBody h2', has_text='Admin').count() >= 1 and pg.locator('#rlBody h2', has_text='Operations').count() == 1, '30 permissions grouped')
    pg.locator('#rlTabs button', has_text='Operations Admin').click()
    chk('Holds 2 of 4 permissions' in txt(pg, '#rlBody'), '31 role count 2 of 4')
    chk(pg.locator('#rlBody td[data-label="Access"]', has_text='Allowed').count() >= 2 and pg.locator('#rlBody td[data-label="Access"]', has_text='Not allowed').count() == 2, '32 allowed and not allowed words (not colour alone)')
    chk('<b>Ops</b> One' in txt(pg, '#rlBody') and pg.evaluate('() => !document.querySelector("#rlBody b")'), '33 markup in a member name is text')
    pg.locator('#rlTabs button', has_text='Content Admin').click()
    chk('No active admin has this role' in txt(pg, '#rlBody') and 'Holds 0 of 4' in txt(pg, '#rlBody'), '34 role with no members and no permissions')
    chk(set(calls(pg)) <= {'admin_my_access', 'admin_role_directory'} and calls(pg).count('admin_role_directory') == 1, '35 only the read function, once')
    chk(pg.locator('#rlBody input, #rlBody form').count() == 0, '36 no checkbox or form (read only)')
    chk(not errs, '37 no page errors'); cx.close()
    # roles: admin.roles.manage alone may view; neither may not
    pg, cx, errs = open_page(b, 'roles', {'perms': ['admin.roles.manage']}); pg.wait_for_selector('#rlBody table')
    chk(True, '38 admin.roles.manage alone opens the roles page'); cx.close()
    pg, cx, errs = open_page(b, 'roles', {'perms': ['approvals.view']}); pg.wait_for_timeout(400)
    chk('do not have access' in txt(pg, '#adMain') and 'admin_role_directory' not in calls(pg), '39 neither permission: no access, no call'); cx.close()
    pg, cx, errs = open_page(b, 'roles', {'perms': SUPER, 'missing': True}); pg.wait_for_timeout(400)
    chk('a5c-team-read.sql' in txt(pg, '#rlBody'), '40 function missing names the SQL file'); cx.close()
    pg, cx, errs = open_page(b, 'roles', {'perms': SUPER}, 390); pg.wait_for_selector('#rlBody table')
    chk(pg.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), '41 phone: roles page has no sideways scroll'); cx.close()
    b.close()

bad = [t for ok, t in results if not ok]
for ok, t in results: print(('PASS ' if ok else 'FAIL ') + t)
print('%d checks, %d failed' % (len(results), len(bad))); sys.exit(1 if bad else 0)

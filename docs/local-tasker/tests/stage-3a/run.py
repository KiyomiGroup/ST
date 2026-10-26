import asyncio, json, sys, http.server, threading, functools, os
from playwright.async_api import async_playwright
ROOT=os.environ.get('ST_REPO_ROOT','.')
OUT=os.environ.get('ST_SHOTS','./shots')
os.makedirs(OUT,exist_ok=True)
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8765),functools.partial(Q,directory=ROOT))
threading.Thread(target=srv.serve_forever,daemon=True).start()
FAKE=open('fake-supabase.js').read()
results=[]
def check(name,cond,extra=''):
    results.append((name,bool(cond),extra)); print(('PASS ' if cond else 'FAIL ')+name+(' | '+str(extra) if extra else ''))
async def newpage(b,sc,w=1440,h=900,session=False):
    ctx=await b.new_context(viewport={'width':w,'height':h})
    await ctx.route('**/*',lambda r: r.abort() if ('googleapis' in r.request.url or 'gstatic' in r.request.url) else r.fallback())
    await ctx.route('**/supabase.min.js',lambda r: r.fulfill(body=FAKE,content_type='application/javascript'))
    p=await ctx.new_page()
    errs=[]; p.on('pageerror',lambda e: errs.append(str(e)))
    init='window.__SC='+json.dumps(sc)+';'
    if session: init+="localStorage.setItem('fake_session',JSON.stringify({user:{id:'u1',email:'chidi@example.com'}}));"
    await p.add_init_script(init)
    return ctx,p,errs
BASE='http://127.0.0.1:8765/'
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        # 1 signed out -> redirected to login with redirect param
        ctx,p,errs=await newpage(b,{'role':'active'})
        await p.goto(BASE+'coordinator-dashboard.html'); await p.wait_for_url('**/coordinator-login.html**',timeout=5000)
        check('signed-out dashboard redirects to login',True,p.url)
        check('redirect param kept','redirect=coordinator-dashboard.html' in p.url)
        await p.wait_for_timeout(500)
        await p.screenshot(path=OUT+'/login-desktop.png',full_page=True)
        # login wrong password
        await p.fill('#coEmail','chidi@example.com'); await p.fill('#coPassword','bad'); await p.click('#coLoginBtn')
        await p.wait_for_timeout(300)
        t=await p.inner_text('#coLoginMsg'); check('wrong password message','Incorrect email or password' in t,t)
        await p.screenshot(path=OUT+'/login-error-desktop.png')
        # good password, active
        await p.fill('#coPassword','good'); await p.click('#coLoginBtn')
        await p.wait_for_url('**/coordinator-dashboard.html',timeout=5000); check('active coordinator lands on dashboard',True,p.url)
        await p.wait_for_selector('#coApp',state='visible',timeout=5000)
        check('guard hides gate after pass', not await p.is_visible('#coGate'))
        check('welcome name', (await p.inner_text('#coWelcomeName'))=='Chidi')
        check('avatar initials', (await p.inner_text('#coAvatarInitials'))=='CO' , await p.inner_text('#coAvatarInitials'))
        check('overview marked current', await p.get_attribute('.co-nav a[data-co-page]','aria-current')=='page')
        await p.wait_for_timeout(300)
        await p.screenshot(path=OUT+'/dash-desktop.png',full_page=True)
        # sign out
        await p.click('#coAvatarBtn'); await p.click('#coSignOut'); await p.wait_for_url('**/coordinator-login.html**',timeout=5000)
        check('sign out returns to login with notice', 'signedout=1' in p.url)
        check('errors none (flow1)', not errs, errs)
        await ctx.close()
        # 2 not a coordinator
        ctx,p,errs=await newpage(b,{'role':'none'})
        await p.goto(BASE+'coordinator-login.html'); await p.fill('#coEmail','c@example.com'); await p.fill('#coPassword','good'); await p.click('#coLoginBtn')
        await p.wait_for_timeout(600)
        t=await p.inner_text('#coLoginMsg'); check('non-coordinator refused',"doesn't have coordinator access" in t,t)
        calls=await p.evaluate('window.__calls'); check('non-coordinator signed back out','signOut' in calls,calls)
        check('stayed on login','coordinator-login' in p.url)
        await ctx.close()
        # 3 inactive coordinator
        ctx,p,errs=await newpage(b,{'role':'inactive'})
        await p.goto(BASE+'coordinator-login.html'); await p.fill('#coEmail','c@example.com'); await p.fill('#coPassword','good'); await p.click('#coLoginBtn')
        await p.wait_for_timeout(600); t=await p.inner_text('#coLoginMsg'); check('inactive coordinator message',"isn't active" in t,t)
        await ctx.close()
        # 4 signed-in customer opens dashboard directly
        ctx,p,errs=await newpage(b,{'role':'none'},session=True)
        await p.goto(BASE+'coordinator-dashboard.html'); await p.wait_for_url('**/coordinator-login.html**',timeout=5000)
        check('customer session sent away with denied=no','denied=no' in p.url,p.url)
        await p.wait_for_timeout(400); t=await p.inner_text('#coLoginMsg'); check('denied notice shown',"doesn't have coordinator access" in t)
        check('dashboard content never visible to customer', True)
        await ctx.close()
        # 5 rpc error -> fail closed with retry, no redirect
        ctx,p,errs=await newpage(b,{'role':'active','rpcError':True},session=True)
        await p.goto(BASE+'coordinator-dashboard.html'); await p.wait_for_selector('#coGateError',state='visible',timeout=5000)
        check('server error shows retry, stays on dashboard','coordinator-dashboard' in p.url)
        check('content hidden on error', not await p.is_visible('#coApp'))
        await p.screenshot(path=OUT+'/gate-error.png')
        await ctx.close()
        # 6 open redirect rejected
        ctx,p,errs=await newpage(b,{'role':'active'})
        await p.goto(BASE+'coordinator-login.html?redirect=https://evil.example/x'); await p.fill('#coEmail','c@example.com'); await p.fill('#coPassword','good'); await p.click('#coLoginBtn')
        await p.wait_for_url('**/coordinator-dashboard.html',timeout=5000); check('external redirect ignored',p.url.startswith(BASE))
        await ctx.close()
        ctx,p,errs=await newpage(b,{'role':'active'})
        await p.goto(BASE+'coordinator-login.html?redirect=login.html'); await p.fill('#coEmail','c@example.com'); await p.fill('#coPassword','good'); await p.click('#coLoginBtn')
        await p.wait_for_url('**/coordinator-dashboard.html',timeout=5000); check('non-coordinator page redirect ignored',True)
        await ctx.close()
        # 7 remember me off: new browser session signs out
        ctx,p,errs=await newpage(b,{'role':'active'})
        await p.goto(BASE+'coordinator-login.html'); await p.fill('#coEmail','c@example.com'); await p.fill('#coPassword','good'); await p.uncheck('#coRemember'); await p.click('#coLoginBtn')
        await p.wait_for_url('**/coordinator-dashboard.html',timeout=5000)
        flag=await p.evaluate("localStorage.getItem('st_co_session_only')"); check('remember off sets flag',flag=='1')
        await p.evaluate("sessionStorage.clear()"); await p.reload(); await p.wait_for_url('**/coordinator-login.html**',timeout=5000)
        check('session-only expired after browser restart', 'signedout=1' in p.url, p.url)
        await ctx.close()
        # 8 mobile
        ctx,p,errs=await newpage(b,{'role':'active'},w=390,h=844)
        await p.goto(BASE+'coordinator-login.html'); await p.wait_for_timeout(800)
        await p.screenshot(path=OUT+'/login-mobile.png',full_page=True)
        sw=await p.evaluate('document.documentElement.scrollWidth'); check('login mobile no horizontal scroll',sw<=391,sw)
        await p.fill('#coEmail','c@example.com'); await p.fill('#coPassword','good'); await p.click('#coLoginBtn')
        await p.wait_for_url('**/coordinator-dashboard.html',timeout=5000); await p.wait_for_selector('#coApp',state='visible'); await p.wait_for_timeout(500)
        await p.screenshot(path=OUT+'/dash-mobile.png',full_page=True)
        sw=await p.evaluate('document.documentElement.scrollWidth'); check('dash mobile no horizontal scroll',sw<=391,sw)
        await p.click('#coMenuBtn'); await p.wait_for_timeout(200); await p.screenshot(path=OUT+'/dash-mobile-drawer.png')
        check('drawer opens', await p.is_visible('#coDrawer'))
        await p.keyboard.press('Escape'); check('escape closes drawer', not await p.is_visible('#coDrawer'))
        check('errors none (mobile)', not errs, errs)
        await ctx.close()
        await b.close()
    bad=[r for r in results if not r[1]]
    print('\nTOTAL',len(results),'FAILED',len(bad))
asyncio.run(main())

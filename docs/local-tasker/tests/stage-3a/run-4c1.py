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

import copy
BASE='http://127.0.0.1:8765/'
U='44444444-4444-4444-8444-444444444444'
OTHER='99999999-9999-4999-8999-999999999999'
PURL=BASE+'coordinator-publish.html?id='+U
CK=lambda k,ok,blocking=True: {'key':k,'ok':ok,'blocking':blocking}
ALLOK=[CK('not_retired',True),CK('public_name',True),CK('tasker_row',True),CK('agreement_profile',True),CK('agreement_publish',True),CK('agreement_photos',True),CK('service',True),CK('private_clear',True),CK('verification',False,False),CK('photo',True,False)]
NOSVC=[dict(c,ok=False) if c['key'] in ('service','agreement_publish') else c for c in ALLOK]
SVC={'id':'55555555-5555-4555-8555-555555555555','user_id':U,'service_name':'Solid Wood Wardrobe Repair','category':'carpentry','price':12500,'rate_unit':'/job','description':'Standard labour fee. Customer supplies timber.','location':'Sabo, Yaba','specialties':['Wardrobes','Doors'],'availability_status':'available_this_week','available':True,'created_at':'2026-10-26T10:00:00Z'}
def PH(i,cap=None,cover=False): return {'id':'aaaaaaaa-aaaa-4aaa-8aaa-%012d'%i,'tasker_user_id':U,'storage_path':U+'/bbbbbbbb-bbbb-4bbb-8bbb-%012d.jpg'%i,'caption':cap,'is_cover':cover,'created_at':'2026-10-27T10:0%d:00Z'%i,'removed_at':None}
BASE_SC={'role':'active','assignments':[U],'publicName':'Baba A.',
  'profiles':[{'tasker_user_id':U,'full_name':'Baba Alabi Adebayo','phone':'+2348011112222','status':'draft','skills':['Carpentry'],'areas_served':'Sabo, Yaba','published_at':None,'created_at':'2026-10-20T10:00:00Z'}],
  'services':[SVC],'photos':[PH(1,'Wardrobe',True),PH(2),PH(3),PH(4)],
  'pubState':{'status':'draft','checks':ALLOK,'services':1,'photos':4}}
def scn(**k):
    s=copy.deepcopy(BASE_SC); 
    for a,b in k.items(): s[a]=b
    return s
async def rpcs(p): return await p.evaluate('window.__rpcCalls')
async def txt(p,sel): return (await p.inner_text(sel)).strip()
async def ready(p): await p.wait_for_selector('#coEditLayout',state='visible',timeout=5000); await p.wait_for_function("document.getElementById('coPubChecksLoading').hidden",timeout=5000)

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        # 1 draft, everything ready: preview + checklist + actions
        ctx,p,errs=await newpage(b,scn(),session=True)
        await p.goto(PURL); await ready(p)
        pv=await txt(p,'.co-preview')
        check('preview shows the public name, not the full name', 'Baba A.' in pv and 'Adebayo' not in pv and 'Alabi' not in pv, pv)
        check('preview shows both labels together','Local Tasker' in pv and 'Phone Assisted' in pv)
        check('preview shows service, rate per job, area, description, specialties', all(x in pv for x in ['Solid Wood Wardrobe Repair','\u20a612,500 per job','Sabo, Yaba','Standard labour fee','Wardrobes','Doors']), pv)
        check('the page never shows the private phone number', '2348011112222' not in await p.inner_text('body') and '08011112222' not in await p.inner_text('body'))
        check('preview has the inclusive-economy note, text only','supports an inclusive economy' in await txt(p,'#coEditLayout') and 'fee' not in (await txt(p,'.co-preview-foot')).lower())
        check('preview shows at most 3 photos, signed links asked for 3 paths only', await p.locator('#coPvPhotos li').count()==3 and len(json.loads(await p.evaluate("sessionStorage.getItem('fake_signed')"))[0]['paths'])==3)
        check('checklist lists 10 items, no blocking item missing', await p.locator('#coPubChecks li').count()==10 and await p.locator('#coPubChecks li.is-bad').count()==0)
        check('recommended verification is marked recommended and does not block', 'Verification recorded (recommended)' in await txt(p,'#coPubChecks') and not await p.is_disabled('#coPubPublish'))
        check('draft shows Publish box, not the live box', await p.is_visible('#coPubDraftBox') and not await p.is_visible('#coPubLiveBox'))
        check('status chip says Draft', await txt(p,'#coPubStatus')=='Draft')
        check('back link goes to the profile', (await p.get_attribute('#coBackLink','href'))=='coordinator-tasker.html?id='+U)
        check('nav keeps My Local Taskers highlighted', await p.locator('.co-nav a[aria-current=page]').count()>=1)
        await p.screenshot(path=OUT+'/publish-desktop.png',full_page=True)
        # publish needs the confirmation tick
        await p.click('#coPubPublish')
        check('publish without ticking: field error, no rpc call', await p.is_visible('#coPubConfirmErr') and not [c for c in await rpcs(p) if c['name']=='publish_local_tasker'])
        await p.check('#coPubConfirm')
        await p.evaluate("(()=>{const b=document.getElementById('coPubPublish'); b.click(); b.click();})()")
        await p.wait_for_selector('#coPubLiveBox',state='visible',timeout=5000)
        calls=[c for c in await rpcs(p) if c['name']=='publish_local_tasker']
        check('double click publishes once, with only the tasker id', len(calls)==1 and calls[0]['args']=={'p_tasker':U}, calls)
        check('after publish: notice, live box, chip Published', 'Published.' in await txt(p,'#coPubNoticeText') and await txt(p,'#coPubStatus')=='Published' and not await p.is_visible('#coPubDraftBox'))
        await p.screenshot(path=OUT+'/publish-live-desktop.png',full_page=True)
        await p.click('#coPubRefresh'); await p.wait_for_function("document.getElementById('coPubNoticeText').textContent.indexOf('updated')>-1",timeout=5000)
        check('Update public listing calls publish again and says updated', len([c for c in await rpcs(p) if c['name']=='publish_local_tasker'])==2)
        # unpublish: two steps, reason sent
        await p.click('#coPubUnpublishOpen')
        check('unpublish needs a second step', await p.is_visible('#coPubUnpublishBox') and not [c for c in await rpcs(p) if c['name']=='unpublish_local_tasker'])
        await p.click('#coPubUnpublishCancel'); check('cancel closes it again', not await p.is_visible('#coPubUnpublishBox') and await p.is_visible('#coPubUnpublishOpen'))
        await p.click('#coPubUnpublishOpen'); await p.fill('#coPubReason','Asked to pause for two weeks'); await p.click('#coPubUnpublishConfirm')
        await p.wait_for_selector('#coPubDraftBox',state='visible',timeout=5000)
        calls=[c for c in await rpcs(p) if c['name']=='unpublish_local_tasker']
        check('unpublish sends tasker id and reason, then shows the publish box again', len(calls)==1 and calls[0]['args']=={'p_tasker':U,'p_reason':'Asked to pause for two weeks'} and 'Unpublished' in await txt(p,'#coPubNoticeText'), calls)
        check('status chip says Hidden after unpublish', await txt(p,'#coPubStatus')=='Hidden')
        check('errors none (flow)', not errs, errs)
        await ctx.close()
        # 2 not ready: missing service
        ctx,p,errs=await newpage(b,scn(pubState={'status':'draft','checks':NOSVC,'services':0,'photos':4},services=[]),session=True)
        await p.goto(PURL); await ready(p)
        check('not ready: publish disabled, two blocking items shown', await p.is_disabled('#coPubPublish') and await p.locator('#coPubChecks li.is-bad').count()==2)
        hint=await txt(p,'#coPubChecksHint'); check('hint counts what needs attention', '2 things need attention' in hint, hint)
        hrefs=await p.eval_on_selector_all('#coPubChecks li.is-bad a','els=>els.map(e=>e.getAttribute("href"))')
        check('missing items link to the service form', hrefs==['coordinator-service-edit.html?id='+U]*2, hrefs)
        check('empty preview explains what to add', await p.is_visible('#coPvEmpty'))
        await p.check('#coPubConfirm'); await p.click('#coPubPublish', force=True)
        check('disabled publish makes no rpc call', not [c for c in await rpcs(p) if c['name']=='publish_local_tasker'])
        await ctx.close()
        # 3 server refuses (stale checklist): shows code, reloads checklist
        sc=scn(pubrpc={'publish_local_tasker':{'mode':'error','hint':'not_ready','message':'This Local Tasker is not ready to publish: service'}})
        ctx,p,errs=await newpage(b,sc,session=True)
        await p.goto(PURL); await ready(p); await p.check('#coPubConfirm'); await p.click('#coPubPublish')
        await p.wait_for_selector('#coPubError',state='visible',timeout=5000); await p.wait_for_timeout(300)
        check('not_ready: code shown and nothing published', 'Error code: not_ready' in await txt(p,'#coPubErrorCode') and await p.is_visible('#coPubDraftBox'))
        check('not_ready: checklist was reloaded (status called twice)', len([c for c in await rpcs(p) if c['name']=='local_tasker_publish_status'])==2)
        await ctx.close()
        for mode,extra,code in [('error',{'hint':'not_found'},'not_found'),('network',{},'network'),('badjson',{},'bad_response'),('error',{'sqlcode':'42501'},'unauthenticated'),('error',{'sqlcode':'XX000'},'server_error')]:
            cfg=dict({'mode':mode},**extra)
            ctx,p,errs=await newpage(b,scn(pubrpc={'publish_local_tasker':cfg}),session=True)
            await p.goto(PURL); await ready(p); await p.check('#coPubConfirm'); await p.click('#coPubPublish')
            await p.wait_for_selector('#coPubError',state='visible',timeout=5000)
            c=await txt(p,'#coPubErrorCode')
            check('publish failure shows code '+code, c.startswith('Error code: '+code), c)
            check('publish failure '+code+': buttons usable again, still draft', not await p.is_disabled('#coPubPublish') and await p.is_visible('#coPubDraftBox') and await txt(p,'#coPubPublish')=='Publish')
            await ctx.close()
        ctx,p,errs=await newpage(b,scn(pubrpc={'unpublish_local_tasker':{'mode':'error','hint':'not_found'}},pubState={'status':'published','checks':ALLOK}),session=True)
        await p.goto(PURL); await ready(p); await p.click('#coPubUnpublishOpen'); await p.click('#coPubUnpublishConfirm'); await p.wait_for_selector('#coPubError',state='visible',timeout=5000)
        check('unpublish failure shows its code and keeps the live box', 'not_found' in await txt(p,'#coPubErrorCode') and await p.is_visible('#coPubLiveBox'))
        await p.evaluate("document.getElementById('coPubReason').value='x'.repeat(301)"); await p.click('#coPubUnpublishConfirm')
        check('reason over 300 characters: field error, no second call', await p.is_visible('#coPubReasonErr') and len([c for c in await rpcs(p) if c['name']=='unpublish_local_tasker'])==1)
        await ctx.close()
        # 4 already published
        ctx,p,errs=await newpage(b,scn(pubState={'status':'published','checks':ALLOK}),session=True)
        await p.goto(PURL); await ready(p)
        check('published on load: live box, chip Published, no publish box', await p.is_visible('#coPubLiveBox') and not await p.is_visible('#coPubDraftBox') and await txt(p,'#coPubStatus')=='Published')
        await ctx.close()
        stale=[dict(c,ok=False) if c['key']=='service' else c for c in ALLOK]
        ctx,p,errs=await newpage(b,scn(pubState={'status':'published','checks':stale}),session=True)
        await p.goto(PURL); await ready(p)
        check('published but checklist broken: warned, update disabled, unpublish still possible', 'no longer complete' in await txt(p,'#coPubLiveText') and await p.is_disabled('#coPubRefresh') and not await p.is_disabled('#coPubUnpublishOpen'))
        await ctx.close()
        # 5 retired
        ctx,p,errs=await newpage(b,scn(pubState={'status':'inactive','checks':[CK('not_retired',False)]+ALLOK[1:]}),session=True)
        await p.goto(PURL); await ready(p)
        check('retired: message, no publish and no unpublish', await p.is_visible('#coPubRetired') and not await p.is_visible('#coPubDraftBox') and not await p.is_visible('#coPubLiveBox'))
        await ctx.close()
        # 6 checklist cannot load: preview and page still work, no actions
        ctx,p,errs=await newpage(b,scn(pubrpc={'local_tasker_publish_status':{'mode':'error','hint':'x'}}),session=True)
        await p.goto(PURL); await p.wait_for_selector('#coPubChecksError',state='visible',timeout=5000)
        check('checklist failure: message shown, actions hidden, preview still there', not await p.is_visible('#coPubActionsCard') and 'Baba A.' in await txt(p,'.co-preview'))
        await ctx.close()
        # 7 preview parts failing do not hide the page
        ctx,p,errs=await newpage(b,scn(photosError=True,svcReadError=True,usersError=True),session=True)
        await p.goto(PURL); await ready(p)
        check('photo, service and name reads failing: page and checklist still work', await p.is_visible('#coPubChecks') and 'Public name not set' in await txt(p,'#coPvName'))
        await ctx.close()
        ctx,p,errs=await newpage(b,scn(signed={'mode':'error'}),session=True)
        await p.goto(PURL); await ready(p)
        check('signed links failing: photo tiles say Unavailable', await p.locator('#coPvPhotos .co-photo-missing').count()==3)
        await ctx.close()
        # 8 safe text
        ctx,p,errs=await newpage(b,scn(publicName='<img src=x onerror=window.__xss=1>'),session=True)
        await p.goto(PURL); await ready(p); await p.wait_for_timeout(200)
        check('public name is shown as text, not run as HTML', (await p.evaluate('window.__xss')) is None and '<img' in await txt(p,'#coPvName'))
        await ctx.close()
        # 9 not found, invalid, guard
        ctx,p,errs=await newpage(b,scn(),session=True)
        await p.goto(BASE+'coordinator-publish.html?id='+OTHER); await p.wait_for_selector('#coEditMissing',state='visible',timeout=5000)
        check("someone else's tasker: not found, no actions, no rpc", not await p.is_visible('#coPubActionsCard') and not await rpcs(p))
        await p.goto(BASE+'coordinator-publish.html?id=nope'); await p.wait_for_selector('#coEditMissing',state='visible',timeout=5000)
        await p.goto(BASE+'coordinator-publish.html'); await p.wait_for_selector('#coEditMissing',state='visible',timeout=5000)
        check('invalid and missing id show not found', True)
        await ctx.close()
        ctx,p,errs=await newpage(b,scn(overviewError=True),session=True)
        await p.goto(PURL); await p.wait_for_selector('#coEditLoadError',state='visible',timeout=5000)
        check('profile read failure shows retry and no actions', await p.is_visible('#coEditRetry') and not await p.is_visible('#coPubActionsCard'))
        await ctx.close()
        ctx,p,errs=await newpage(b,{'role':'none'},session=True)
        await p.goto(PURL); await p.wait_for_url('**/coordinator-login.html**',timeout=5000)
        check('publish page is guarded like the other pages','denied=no' in p.url)
        await ctx.close()
        # 10 profile page card
        for status,label,linktext,vis in [('draft','Not published','Preview and publish',True),('published','Published','Manage listing',True),('inactive','retired','',False)]:
            sc=scn(); sc['profiles'][0]['status']=status; sc['profiles'][0]['published_at']='2026-10-27T09:00:00Z' if status=='published' else None
            ctx,p,errs=await newpage(b,sc,session=True)
            await p.goto(BASE+'coordinator-tasker.html?id='+U); await p.wait_for_selector('#coDetail',state='visible',timeout=5000)
            t=await txt(p,'#coPubSummary')
            check('profile Publishing card (%s): text and link'%status, label.lower() in t.lower() and (await p.is_visible('#coPubLink'))==vis and (not vis or ((await txt(p,'#coPubLink'))==linktext and (await p.get_attribute('#coPubLink','href'))=='coordinator-publish.html?id='+U)), t)
            await ctx.close()
        # 11 mobile
        ctx,p,errs=await newpage(b,scn(),w=390,h=844,session=True)
        await p.goto(PURL); await ready(p); await p.wait_for_timeout(300)
        await p.screenshot(path=OUT+'/publish-mobile.png',full_page=True)
        sw=await p.evaluate('document.documentElement.scrollWidth'); check('publish page mobile no horizontal scroll',sw<=391,sw)
        small=await p.evaluate("Array.from(document.querySelectorAll('#coEditLayout input:not([type=checkbox]), #coEditLayout button, #coEditLayout .btn')).filter(e=>e.offsetParent&&e.getBoundingClientRect().height<40).map(e=>e.id||e.className)")
        check('publish page mobile: buttons and inputs at least 40px tall', not small, small)
        check('errors none (mobile)', not errs, errs)
        await ctx.close()
        await b.close()
    bad=[r for r in results if not r[1]]
    print('\nTOTAL',len(results),'FAILED',len(bad))
asyncio.run(main())

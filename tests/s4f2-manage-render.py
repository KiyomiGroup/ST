# S4f-2 behaviour check: stubbed Supabase, headless Chromium. Serve the project root first: python3 -m http.server 8766
import json, os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
BASE=dict(plan_key='professional',plan_name='Professional',is_paid=True,status='active',in_grace=False,price_kobo=1000000,membership_label='PRO',
  period_start='2026-10-20T00:00:00+01:00',period_end='2026-11-20T00:00:00+01:00',renews_at='2026-11-20T00:00:00+01:00',cancel_at_period_end=False,pending_plan=None,pending_change_at=None,
  offers=dict(unlimited=False,allowance=100,used=40,remaining=60,credits=0,next_credit_expiry=None),listings=dict(limit=5,active=3,remaining=2),
  features=dict(analytics='advanced',featured_placement=True,priority_recommendation=False,priority_support=False,early_access=False,expanded_portfolio=True))
def ent(**k): d=json.loads(json.dumps(BASE)); d.update(k); return d
PLANS=[dict(plan_key='free',name='Free',price_kobo=0,listing_limit=1,sort_order=0),dict(plan_key='starter',name='Starter',price_kobo=500000,listing_limit=2,sort_order=1),
 dict(plan_key='professional',name='Professional',price_kobo=1000000,listing_limit=5,sort_order=2),dict(plan_key='business',name='Business',price_kobo=3000000,listing_limit=20,sort_order=3)]
SVCS=[dict(id='s%d'%i,service_name='Listing %d'%i,listing_status='active',updated_at='2026-11-0%dT00:00:00Z'%(9-i)) for i in range(4)]
def stub(ent_, fail=None):
    return """(function(){var E=%s,plans=%s,svcs=%s,fail=%s;window.__calls=[];
 var session={user:{id:'u1',user_metadata:{role:'tasker'}}};
 window.supabase={auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session.user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  rpc:async(n,a)=>{window.__calls.push([n,a||{}]);
    if(n==='get_my_entitlements') return {data:E,error:null}; if(n==='get_public_plans') return {data:plans,error:null};
    if(fail&&fail[n]) return {data:null,error:{message:fail[n]}};
    if(n==='schedule_downgrade'){ if(a.p_plan===E.plan_key){E.pending_plan=null;E.pending_change_at=null;} else {E.pending_plan=a.p_plan;E.pending_change_at=E.period_end;} return {data:{ok:true},error:null}; }
    if(n==='cancel_subscription'){E.cancel_at_period_end=true;E.status='cancelling';E.renews_at=null;E.pending_plan=null;return {data:{ok:true},error:null};}
    if(n==='undo_cancel'){E.cancel_at_period_end=false;E.status='active';return {data:{ok:true},error:null};}
    if(n==='choose_active_listings'){E.listings.active=a.p_ids.length;return {data:{ok:true},error:null};}
    return {data:null,error:{message:'?'}};},
  from:(t)=>{var q={select:()=>q,eq:()=>q,in:()=>q,order:()=>t==='services'?Promise.resolve({data:svcs,error:null}):q,limit:()=>Promise.resolve({data:[],error:null}),then:(r)=>r({data:[],error:null})};return q;},
  channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}};})();""" % (json.dumps(ent_),json.dumps(PLANS),json.dumps(SVCS),json.dumps(fail))
def page(p,e,fail=None,w=1280):
    pg=p.chromium.launch().new_page(viewport={'width':w,'height':900}); errs=[]
    pg.on('pageerror',lambda x:errs.append(str(x)))
    pg.route('**/cdn.jsdelivr.net/**',lambda r:r.fulfill(status=200,body='',content_type='application/javascript'))
    pg.add_init_script(stub(e,fail)); pg.goto('http://localhost:8766/my-subscription.html'); pg.wait_for_selector('#mysubContent:not([hidden])',timeout=8000); return pg,errs
def btns(pg): return pg.eval_on_selector_all('#mysubActions .btn','els=>els.map(e=>e.innerText)')
def calls(pg): return [c for c in pg.evaluate('window.__calls') if c[0] not in('get_my_entitlements','get_public_plans','idv_my_gate')]
ok=True
def check(name,cond,extra=''):
    global ok; ok&=bool(cond); print(('PASS' if cond else 'FAIL'),name,extra)
shots=os.environ.get('SHOTS','/tmp')
with sync_playwright() as p:
    pg,er=page(p,ent()); check('active paid: buttons',btns(pg)==['See all plans','Change to a lower plan','Cancel subscription'],btns(pg))
    pg.click('text=Change to a lower plan'); L=pg.eval_on_selector_all('#mysubModalBody .mysub-choice','e=>e.map(x=>x.innerText)'); check('dialog opens, lists lower plans only',L==['Starter (2 service listings)','Free (1 service listing)'],L)
    pg.screenshot(path=f'{shots}/s4f2-dialog.png'); pg.click('#mysubModalOk'); pg.wait_for_selector('#mysubNote:not([hidden])')
    check('downgrade calls only schedule_downgrade(starter)',calls(pg)==[['schedule_downgrade',{'p_plan':'starter'}]],calls(pg))
    check('page re-read: shows scheduled change and Stay button','Starter' in pg.inner_text('#mysubBanner') and 'Stay on my plan' in btns(pg),btns(pg))
    pg.click('text=Stay on my plan'); pg.click('#mysubModalOk'); pg.wait_for_selector('#mysubNote:not([hidden])')
    check('stay clears with current plan key',calls(pg)[-1]==['schedule_downgrade',{'p_plan':'professional'}],calls(pg)[-1])
    pg.click('text=Cancel subscription'); pg.click('#mysubModalBack'); check('go back: nothing called',len(calls(pg))==2)
    pg.click('text=Cancel subscription'); pg.click('#mysubModalOk'); pg.wait_for_selector('#mysubNote:not([hidden])')
    check('cancel then Undo button only',calls(pg)[-1]==['cancel_subscription',{}] and btns(pg)==['See all plans','Undo cancellation'],btns(pg))
    pg.click('text=Undo cancellation'); pg.wait_for_selector('#mysubNote:not([hidden])')
    check('undo calls undo_cancel',calls(pg)[-1]==['undo_cancel',{}] and 'Cancel subscription' in btns(pg)); check('no page errors',not er,er)
    pg,er=page(p,ent(status='past_due',in_grace=True)); check('past due: cancel only',btns(pg)==['See all plans','Cancel subscription'],btns(pg))
    pg,er=page(p,ent(),fail={'cancel_subscription':'period_over'}); pg.click('text=Cancel subscription'); pg.click('#mysubModalOk'); pg.wait_for_selector('#mysubModalError:not([hidden])')
    check('error shown in dialog, dialog stays',pg.is_visible('#mysubModal') and 'ended' in pg.inner_text('#mysubModalError'),pg.inner_text('#mysubModalError'))
    pg,er=page(p,dict(BASE,plan_key='free',plan_name='Free',is_paid=False,status='free',price_kobo=0,listings=dict(limit=1,active=1,remaining=0)))
    check('free: only See all plans, no chooser',btns(pg)==['See all plans'] and not pg.is_visible('#mysubChooser'))
    pg,er=page(p,dict(BASE,plan_key='free',plan_name='Free',is_paid=False,status='free',price_kobo=0,listings=dict(limit=2,active=4,remaining=0)))
    check('over limit: chooser, 2 preselected, others locked',pg.is_visible('#mysubChooser') and pg.eval_on_selector_all('#mysubChooserList input','e=>e.map(x=>[x.checked,x.disabled])')==[[True,False],[True,False],[False,True],[False,True]])
    pg.screenshot(path=f'{shots}/s4f2-chooser.png',full_page=True)
    pg.click('#mysubChooserList li:nth-child(2) input'); pg.click('#mysubChooserList li:nth-child(3) input'); pg.click('#mysubChooserSave'); pg.wait_for_selector('#mysubNote:not([hidden])')
    check('chooser saves chosen ids via choose_active_listings',calls(pg)[-1]==['choose_active_listings',{'p_ids':['s0','s2']}] and not pg.is_visible('#mysubChooser'),calls(pg)[-1])
    pg,er=page(p,ent(),w=360); pg.click('text=Change to a lower plan'); check('360px: no sideways scroll',pg.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth')); pg.screenshot(path=f'{shots}/s4f2-360.png')
print('ALL PASS' if ok else 'SOME FAILED')

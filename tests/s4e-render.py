# S4e render check: stubbed Supabase, headless Chromium. Serve the project root on port 8766 first (python3 -m http.server 8766).
import json, os
from playwright.sync_api import sync_playwright
BASE=dict(plan_key='free',plan_name='Free',is_paid=False,status='free',in_grace=False,price_kobo=0,membership_label=None,
  period_start='2026-11-01T00:00:00+01:00',period_end='2026-12-01T00:00:00+01:00',renews_at=None,cancel_at_period_end=False,pending_plan=None,pending_change_at=None,
  offers=dict(unlimited=False,allowance=20,used=7,remaining=13,credits=0,next_credit_expiry=None,total_remaining=13,fair_use_day_cap=None,fair_use_month_cap=None,fair_use_day_used=None,fair_use_month_used=None,fair_use_remaining=None),
  listings=dict(limit=1,active=1,remaining=0),
  features=dict(analytics='none',featured_placement=False,priority_recommendation=False,priority_support=False,early_access=False,expanded_portfolio=False))
def paid(**kw):
    d=json.loads(json.dumps(BASE)); d.update(plan_key='professional',plan_name='Professional',is_paid=True,status='active',price_kobo=1000000,membership_label='PRO',
      period_start='2026-10-20T00:00:00+01:00',period_end='2026-11-20T00:00:00+01:00',renews_at='2026-11-20T00:00:00+01:00')
    d['offers'].update(allowance=100,used=40,remaining=60,total_remaining=60); d['listings'].update(limit=5,active=3,remaining=2)
    d['features'].update(analytics='advanced',featured_placement=True,expanded_portfolio=True); d.update(kw); return d
biz=paid(plan_key='business',plan_name='Business',price_kobo=3000000,membership_label='PREMIUM'); biz['offers'].update(unlimited=True,allowance=None,remaining=None,fair_use_day_cap=100,fair_use_month_cap=600,fair_use_day_used=12,fair_use_month_used=210,total_remaining=88)
PLANS=[{'plan_key':'free','name':'Free'},{'plan_key':'starter','name':'Starter'},{'plan_key':'professional','name':'Professional'},{'plan_key':'business','name':'Business'}]
CASES={
 'free':dict(ent=BASE),
 'paid':dict(ent=paid()),
 'business':dict(ent=biz),
 'pastdue':dict(ent=paid(status='past_due',in_grace=True)),
 'cancelling':dict(ent=paid(status='cancelling',cancel_at_period_end=True,renews_at=None)),
 'pending':dict(ent=paid(pending_plan='starter',pending_change_at='2026-11-20T00:00:00+01:00')),
 'expired':dict(ent=BASE,ended=dict(plan='professional',status='expired',current_period_end='2026-10-20T00:00:00+01:00')),
 'overlimit':dict(ent={**BASE,'listings':dict(limit=1,active=3,remaining=0),'offers':{**BASE['offers'],'used':20,'remaining':0,'credits':5,'next_credit_expiry':'2026-12-31T00:00:00+01:00'}}),
 'error':dict(fail=True),
 'signedout':dict(signed=False),
 'customer':dict(role='customer'),
}
def stub(c):
    return """(function(){var c=%s,plans=%s,signed=c.signed!==false,role=c.role||'tasker';
 var session=signed?{user:{id:'u1',user_metadata:{role:role}}}:null; window.__calls=[];
 window.supabase={auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session&&session.user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  rpc:async(n)=>{window.__calls.push(n); if(n==='get_my_entitlements') return c.fail?{data:null,error:{message:'x'}}:{data:c.ent,error:null}; if(n==='get_public_plans') return {data:plans,error:null}; return {data:null,error:{message:'?'}};},
  from:(t)=>{window.__calls.push('from:'+t); const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>Promise.resolve({data:c.ended?[c.ended]:[],error:null}),maybeSingle:async()=>({data:null}),single:async()=>({data:null}),then:(r)=>r({data:[],error:null})};return q;},
  channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}};
})();""" % (json.dumps(CASES_ACTIVE), json.dumps(PLANS))
out=os.environ.get('SHOTS','/tmp')
def run(name,w):
    global CASES_ACTIVE; CASES_ACTIVE=CASES[name]
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={'width':w,'height':900})
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.route('**/cdn.jsdelivr.net/**',lambda r:r.fulfill(status=200,body='',content_type='application/javascript'))
        pg.add_init_script(stub(name)); pg.goto('http://localhost:8766/my-subscription.html'); pg.wait_for_timeout(1500)
        if name in ('signedout','customer'):
            print(name,w,'redirected to',pg.url.split('8766')[1],'pageerrors:',errs[:3]); b.close(); return
        info=pg.evaluate("""()=>({url:location.pathname+location.search, sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth,
          content:!document.getElementById('mysubContent').hidden, error:!document.getElementById('mysubError').hidden, loading:!document.getElementById('mysubLoading').hidden,
          plan:document.getElementById('mysubPlanName').innerText, status:document.getElementById('mysubStatus').innerText,
          banner:document.getElementById('mysubBanner').hidden?null:document.getElementById('mysubBanner').innerText,
          facts:[...document.querySelectorAll('.mysub-fact')].map(f=>f.innerText.replace(/\\n/g,': ')),
          meters:[...document.querySelectorAll('.mysub-meter')].map(m=>m.innerText.replace(/\\n+/g,' | ')),
          bars:document.querySelectorAll('progress').length})""")
        if info['content'] or info['error']: pg.screenshot(path=f'{out}/s4e-{name}-{w}.png',full_page=True)
        print(name,w,json.dumps(info,ensure_ascii=False),'pageerrors:',errs[:3]); b.close()
for n in CASES: run(n,1280)
for n in ['free','business','pastdue']: run(n,360)

import json, sys
from playwright.sync_api import sync_playwright
PLANS=[
 {"plan_key":"free","name":"Free","price_kobo":0,"offers_per_month":20,"listing_limit":1,"membership_label":None,"sort_order":10,"features":{"analytics":"none","featured_placement":False,"priority_recommendation":False,"priority_support":False,"early_access":False,"expanded_portfolio":False}},
 {"plan_key":"starter","name":"Starter","price_kobo":300000,"offers_per_month":50,"listing_limit":3,"membership_label":None,"sort_order":20,"features":{"analytics":"basic","featured_placement":False,"priority_recommendation":False,"priority_support":False,"early_access":False,"expanded_portfolio":False}},
 {"plan_key":"professional","name":"Professional","price_kobo":1000000,"offers_per_month":100,"listing_limit":5,"membership_label":"PRO","sort_order":30,"features":{"analytics":"advanced","featured_placement":True,"priority_recommendation":False,"priority_support":False,"early_access":False,"expanded_portfolio":True}},
 {"plan_key":"business","name":"Business","price_kobo":3000000,"offers_per_month":None,"listing_limit":10,"membership_label":"PREMIUM","sort_order":40,"features":{"analytics":"business","featured_placement":True,"priority_recommendation":True,"priority_support":True,"early_access":True,"expanded_portfolio":True}},
]
def stub(mode):
    return """
(function(){
 var mode=%s, plans=%s;
 var session = mode.signed ? {user:{id:'u1',user_metadata:{role:'tasker'}}} : null;
 window.__rpcCalls=[];
 window.supabase={
  auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session&&session.user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  rpc:async(n)=>{window.__rpcCalls.push(n);
    if(n==='get_public_plans') return mode.fail?{data:null,error:{message:'x'}}:{data:plans,error:null};
    if(n==='get_my_entitlements') return {data:{plan_key:mode.current||'free'},error:null};
    return {data:null,error:{message:'unknown'}};},
  from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null}),single:async()=>({data:null}),then:(r)=>r({data:[],error:null})};return q;},
  channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}
 };
})();
""" % (json.dumps(mode), json.dumps(PLANS))
def run(name, mode, w, click=False):
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={'width':w,'height':900})
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.route('**/cdn.jsdelivr.net/**', lambda r:r.fulfill(status=200,body='',content_type='application/javascript'))
        pg.add_init_script(stub(mode))
        pg.goto('http://localhost:8765/subscription.html'); pg.wait_for_timeout(1200)
        info=pg.evaluate("""()=>({sw:document.documentElement.scrollWidth,cards:document.querySelectorAll('.sub-card').length,
          texts:[...document.querySelectorAll('.sub-card')].map(c=>c.innerText.replace(/\\n+/g,' | ')),
          btns:[...document.querySelectorAll('.sub-card .btn')].map(b=>b.textContent+(b.disabled?' [disabled]':'')+(b.hidden?' [hidden]':'')+(b.href?' '+b.getAttribute('href'):'')),
          err:!!document.querySelector('.sub-error'), rpc:window.__rpcCalls})""")
        if click:
            pg.locator('.sub-card[data-plan=business] button').click(); pg.wait_for_timeout(200)
            info['notice']=pg.inner_text('#pricingNotice')
        pg.screenshot(path=f'/tmp/pp-{name}-{w}.png', full_page=True)
        print(name,w,json.dumps(info,indent=1) if name in('out','fail') and w==1280 else {k:v for k,v in info.items() if k!='texts'}, 'pageerrors:',errs[:3])
        b.close()
run('out',{}, 1280); run('out',{}, 360)
run('in',{'signed':True,'current':'professional'},1280,click=False); run('in',{'signed':True,'current':'professional'},360)
run('free',{'signed':True,'current':'free'},1280,click=True)
run('fail',{'fail':True},1280)

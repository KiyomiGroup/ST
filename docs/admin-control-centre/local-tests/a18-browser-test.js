// LOCAL ONLY: headless browser test of admin/subscriptions.html against a FAKE Supabase. Proves layout and logic, not real data.
// Run: node a18-browser-test.js <repo root>   (needs Playwright)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const results = []; const chk = (ok, t) => { results.push([!!ok, t]); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
function makeFake(scn) {
  return `(function(){ var scn=${JSON.stringify(scn)}; window.__calls=[];
  var OV={ok:true,generated_at:'2026-11-13T09:00:00Z',timezone:'Africa/Lagos',
    subscribers:{total:5,by_status:{active:2,past_due:1,cancelled:1,expired:1,other:0},ending_soon:1,cancel_at_period_end:1},
    by_plan:[{plan:'pro',label:'Pro',active:1,past_due:1,ended:1},{plan:'premium',label:'Premium',active:1,past_due:0,ended:0}],
    revenue_month:scn.noRev?{allowed:false}:{allowed:true,kobo:130000050,rows:3},
    payments:scn.noPay?{allowed:false}:{allowed:true,needs_review:scn.clean?0:2,not_completed:2},
    card_authorizations:scn.cardsNone?{exists:false,rows:0}:{exists:true,rows:scn.clean?0:2}};
  var PLANS={ok:true,available:true,items:[{plan:'pro',name:'Pro',price_kobo:300000,offers_per_month:20,listing_limit:10,membership_label:'PRO',is_active:true,active:1,past_due:1,ended:1},
    {plan:'legacy',name:'Legacy',price_kobo:null,offers_per_month:null,listing_limit:null,membership_label:null,is_active:false,active:0,past_due:0,ended:1}]};
  var SUBS=[{user_id:'00000000-0000-0000-0000-000000000003',name:'<img src=x onerror=window.__xss=1>',plan:'pro',plan_label:'Pro',tier:1,status:'past_due',period_end:'2026-11-12T10:00:00Z',cancel_at_period_end:false,pending_plan:null,days_left:-1},
    {user_id:'00000000-0000-0000-0000-000000000001',name:'Ada Okoro',plan:'pro',plan_label:'Pro',tier:1,status:'active',period_end:'2026-11-16T10:00:00Z',cancel_at_period_end:true,pending_plan:'premium',days_left:3},
    {user_id:'00000000-0000-0000-0000-000000000006',name:null,plan:'legacy',plan_label:'Legacy',tier:0,status:'cancelled',period_end:'2026-09-01T10:00:00Z',cancel_at_period_end:false,pending_plan:null,days_left:-73}];
  var PAYS={review:[{reference:'PAY-9',receipt_number:null,kind:null,amount_kobo:300000,status:'paid',at:'2026-11-13T04:00:00Z',user_id:'x',name:'Emeka Eze',plan:null,reason:'Paid, but no receipt carries this reference. The plan may not have been activated.'}],
    not_paid:[{reference:'PAY-7',amount_kobo:300000,status:'failed',at:'2026-11-13T06:00:00Z',name:'Chi Nwosu',reason:null}],
    receipts:[{reference:'PAY-1',receipt_number:'RC-1',kind:'payment',amount_kobo:300000,status:'paid',at:'2026-11-11T06:00:00Z',name:'Ada Okoro',plan:'Pro',reason:null}]};
  var AUD=[{src:'admin',at:'2026-11-09T10:00:00Z',user_id:'00000000-0000-0000-0000-000000000001',name:'Ada Okoro',kind:'override',note:'Goodwill.',from_plan:'free',to_plan:'pro',actor:'a1b2c3d4',has_approval:true},
    {src:'event',at:'2026-11-05T10:00:00Z',user_id:'00000000-0000-0000-0000-000000000002',name:'Bola Ade',kind:'payment_applied',note:'Paid and activated.',from_plan:null,to_plan:'premium',actor:null,has_approval:false}];
  window.supabase={ auth:{ getSession:function(){return Promise.resolve({data:{session:{user:{id:'me'}}}});}, signOut:function(){return Promise.resolve({});} },
   rpc:function(n,a){ window.__calls.push({n:n,a:a}); return new Promise(function(res){ setTimeout(function(){ res(h(n,a||{})); },5); }); } };
  function ok(d){return {data:d,error:null};}
  function h(n,a){
   if(n==='admin_my_access') return ok({active:true,display_name:'Test Admin',roles:['finance'],permissions:scn.perms,mfa_required:false,mfa_ok:true});
   if(scn.down) return {data:null,error:{code:'PGRST202',message:'not found'}};
   if(n==='admin_subscriptions_overview') return ok(OV);
   if(n==='admin_subscription_plans') return ok(PLANS);
   if(n==='admin_subscriber_list'){ var items=SUBS.filter(function(x){ return (a.p_status==='all'||a.p_status===x.status||(a.p_status==='ended'&&x.status==='cancelled')) && (!a.p_search || String(x.name).toLowerCase().indexOf(a.p_search.toLowerCase())>=0); });
     if(scn.noSubs) items=[]; return ok({ok:true,status:a.p_status,offset:a.p_offset,page_size:25,total:items.length,items:a.p_offset>0?[]:items}); }
   if(n==='admin_subscriber_detail'){ var withR=!scn.noPay;
     return ok({ok:true,user_id:a.p_user,name:'Ada Okoro',subscription:{plan:'pro',plan_label:'Pro',tier:1,status:'active',period_end:'2026-11-16T10:00:00Z',cancel_at_period_end:true,pending_plan:'premium',started_at:'2026-10-17T10:00:00Z'},
       receipts:withR?[{receipt_number:'RC-1',reference:'PAY-1',plan_name:'Pro',kind:'payment',amount_kobo:300000,paid_at:'2026-11-11T06:00:00Z',period_start:'2026-11-11T06:00:00Z',period_end:'2026-12-11T06:00:00Z'}]:null,receipts_allowed:withR,
       timeline:[{src:'event',at:'2026-11-11T06:00:00Z',kind:'payment_applied',note:'Paid again.',from_plan:'pro',to_plan:'pro',actor:null,has_approval:false}]}); }
   if(n==='admin_subscription_payments'){ var it=PAYS[a.p_filter]||[]; return ok({ok:true,filter:a.p_filter,offset:a.p_offset,page_size:25,total:it.length,total_kobo:it.reduce(function(s,x){return s+x.amount_kobo;},0),counts:{review:1,not_paid:1,receipts:1},items:a.p_offset>0?[]:it}); }
   if(n==='admin_subscription_audit'){ var ai=AUD.filter(function(x){return a.p_source==='all'||a.p_source===x.src;}); return ok({ok:true,source:a.p_source,offset:a.p_offset,page_size:25,total:ai.length,items:a.p_offset>0?[]:ai}); }
   return {data:null,error:{code:'XX',message:'unknown '+n}}; } })();`;
}
let PORT;
async function open(browser, scn, w) {
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('127.0.0.1')) { if (u.endsWith('/js/supabaseClient.js')) return r.fulfill({ contentType: 'text/javascript', body: makeFake(scn) }); return r.continue(); } if (u.includes('jsdelivr')) return r.fulfill({ contentType: 'text/javascript', body: '' }); return r.abort(); });
  await page.goto(`http://127.0.0.1:${PORT}/admin/subscriptions.html`); return { page, ctx, errs };
}
const txt = (p, s) => p.locator(s).first().innerText();
const calls = (page, n) => page.evaluate(n => window.__calls.filter(c => c.n === n), n);
const FULL = ['subscriptions.view', 'subscriptions.payments.view', 'subscriptions.revenue.view'];
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); PORT = srv.address().port;
  const browser = await chromium.launch();
  let { page, ctx, errs } = await open(browser, { perms: FULL });
  await page.waitForSelector('#sbOverview .ad-stat'); await page.waitForSelector('#sbPlans .ad-table'); await page.waitForSelector('#sbSubList .ad-table'); await page.waitForSelector('#sbPayList .ad-table'); await page.waitForSelector('#sbAudList .ad-table');
  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT + '-desktop.png', fullPage: true }); }
  chk(await page.locator('.ad-nav-link', { hasText: 'Subscriptions' }).count() === 1, '1 menu item shown');
  const ov = await txt(page, '#sbOverview');
  chk(/Active\s*\n?\s*2/.test(ov) && ov.includes('Past due') && ov.includes('Ended') && ov.includes('Ending within 7 days') && ov.includes('Cancelled 1, expired 1'), '2 overview counts and ended = cancelled + expired');
  chk(ov.includes('₦1,300,000.50'), '3 paid this month from kobo, exact');
  chk(await page.locator('#sbOverview .ad-stat').count() === 9, '4 nine boxes with revenue and payments permission');
  const al = await txt(page, '#sbAlerts');
  chk(al.includes('2 payment(s) need review') && al.includes('subscription_card_authorizations holds 2 row(s)') && al.includes('never read or shown'), '5 banner: needs review and the saved-card table flagged (R-C)');
  const intro = await txt(page, '#sbRoot .ad-pagehead');
  chk(intro.includes('does not renew by itself') && !/auto-?renew(s|al)? (is|are) on|renews automatically/i.test(intro), '6 intro: no automatic renewal wording');
  chk((await txt(page, '#sbByPlan')).includes('Premium') && (await txt(page, '#sbByPlan')).includes('Pro'), '7 by-plan table');
  const pl = await txt(page, '#sbPlans');
  chk(pl.includes('₦3,000') && pl.includes('PRO') && pl.includes('No (inactive)') && (pl.match(/Not available/g) || []).length >= 3, '8 plans: stored price, label, inactive; unknown values say Not available, never 0');
  chk(await page.locator('#sbRoot button', { hasText: /cancel|refund|override|adjust|credit|export|approve|delete|downgrade|price|save|renew/i }).count() === 0, '9 no action button anywhere');
  chk(await page.locator('#sbRoot input[type=text], #sbRoot textarea').count() === 0, '10 no free-text entry other than search');
  // subscribers
  const rows = await page.locator('#sbSubList tbody tr:not(.ad-detail-row)').count();
  chk(rows === 3 && await page.evaluate(() => window.__xss !== 1) && (await txt(page, '#sbSubList')).includes('<img'), '11 three people; a name with HTML is text, not markup');
  chk((await txt(page, '#sbSubList')).includes('Unnamed') && (await txt(page, '#sbSubList')).includes('Ends in 3 day(s)') && (await txt(page, '#sbSubList')).includes('Marked to end') && (await txt(page, '#sbSubList')).includes('Next: premium'), '12 unnamed person, ending-soon, marked-to-end and next-plan flags');
  chk((await txt(page, '#sbSubList')).includes('Ended (cancelled)') && (await txt(page, '#sbSubList')).includes('Past due'), '13 status words, never colour alone');
  await page.locator('#sbSubList tbody tr:not(.ad-detail-row)').nth(1).locator('button', { hasText: 'Details' }).click(); await page.waitForSelector('#sbSubList .ad-detail h3');
  const dt = await txt(page, '#sbSubList .ad-detail-row:nth-of-type(4)').catch(() => '');
  const det = await page.locator('#sbSubList .ad-detail').allInnerTexts(); const dj = det.join(' ');
  chk(dj.includes('Ada Okoro') && dj.includes('Marked to end at period end') && dj.includes('Receipts') && dj.includes('RC-1') && dj.includes('₦3,000') && dj.includes('Timeline') && dj.includes('Paid again'), '14 detail: plan, receipts with amount, timeline');
  const dc = await calls(page, 'admin_subscriber_detail'); chk(dc.length === 1 && dc[0].a.p_user === '00000000-0000-0000-0000-000000000001', '15 detail asks for that person only');
  await page.locator('#sbSubList tbody tr:not(.ad-detail-row)').nth(1).locator('button', { hasText: 'Hide' }).click(); await page.waitForTimeout(50);
  chk((await page.locator('#sbSubList .ad-detail h3').count()) === 0, '16 Hide closes the detail');
  await page.fill('#sbSearch', 'ada'); await page.locator('#sbFilters button[type=submit]').click(); await page.waitForTimeout(150);
  const sc = await calls(page, 'admin_subscriber_list'); const sl = sc[sc.length - 1];
  chk(sl.a.p_search === 'ada' && sl.a.p_status === 'all' && sl.a.p_offset === 0 && await page.locator('#sbSubList tbody tr:not(.ad-detail-row)').count() === 1, '17 search sent to the server; one result');
  await page.fill('#sbSearch', 'zzz'); await page.locator('#sbFilters button[type=submit]').click(); await page.waitForTimeout(150);
  chk((await txt(page, '#sbSubList')).toLowerCase().includes('no results') || (await txt(page, '#sbSubList')).toLowerCase().includes('nothing'), '18 no match shows a no-results state');
  await page.locator('#sbReset').click(); await page.waitForTimeout(150);
  await page.locator('#sbSubTabs button', { hasText: 'Ended' }).click(); await page.waitForTimeout(150);
  const sc2 = await calls(page, 'admin_subscriber_list'); chk(sc2[sc2.length - 1].a.p_status === 'ended' && await page.locator('#sbSubTabs button[aria-pressed=true]').innerText() === 'Ended', '19 status tab sent and marked pressed');
  // payments
  chk((await txt(page, '#sbPayTabs')).includes('Needs review (1)') && (await txt(page, '#sbPayTabs')).includes('Receipts (1)'), '20 payment tabs show counts');
  await page.locator('#sbPayTabs button', { hasText: 'Needs review' }).click(); await page.waitForTimeout(150);
  const pt = await txt(page, '#sbPayList');
  chk(pt.includes('PAY-9') && pt.includes('₦3,000') && pt.includes('Emeka Eze') && pt.includes('no receipt carries this reference') && pt.includes('refund is made in Paystack by an authorised person'), '21 review row with reason; says refunds are made in Paystack');
  await page.locator('#sbPayTabs button', { hasText: 'Receipts' }).click(); await page.waitForTimeout(150);
  chk((await txt(page, '#sbPayList')).includes('PAY-1 (RC-1)'), '22 receipts tab shows reference and receipt number');
  // audit
  const ad = await txt(page, '#sbAudList');
  chk(ad.includes('Admin action') && ad.includes('Approval recorded') && ad.includes('free to pro') && ad.includes('Bola Ade') && ad.includes('Event'), '23 audit: both sources, approval flag, plan change');
  await page.locator('#sbAudTabs button', { hasText: 'Admin actions' }).click(); await page.waitForTimeout(150);
  const ac = await calls(page, 'admin_subscription_audit'); chk(ac[ac.length - 1].a.p_source === 'admin' && await page.locator('#sbAudList tbody tr').count() === 1, '24 audit filter sent');
  chk(!(await page.content()).match(/authorization_code|AUTH_SECRET/), '25 no authorization code anywhere in the page');
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '26 no sideways scroll at 1280');
  chk(errs.length === 0, '27 no page errors ' + errs.join('|')); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: FULL }, 390)); await page.waitForSelector('#sbAudList .ad-table'); await page.locator('#sbSubList tbody tr:not(.ad-detail-row)').nth(1).locator('button', { hasText: 'Details' }).click(); await page.waitForSelector('#sbSubList .ad-detail h3');
  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT + '-phone.png', fullPage: true }); }
  chk(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '28 no sideways scroll at 390 (detail open)'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['subscriptions.view'], noPay: true, noRev: true })); await page.waitForSelector('#sbOverview .ad-stat');
  chk(await page.locator('#sbPaySection').isHidden() && (await calls(page, 'admin_subscription_payments')).length === 0, '29 without payments permission: Payments hidden, never requested');
  chk(await page.locator('#sbOverview .ad-stat').count() === 6 && !(await txt(page, '#sbOverview')).includes('Paid this month') && (await txt(page, '#sbOverview')).includes('subscriptions.revenue.view'), '30 without revenue permission: no money number, permission named');
  await page.locator('#sbSubList tbody tr:not(.ad-detail-row)').nth(1).locator('button', { hasText: 'Details' }).click(); await page.waitForSelector('#sbSubList .ad-detail h3');
  const d31 = await txt(page, '#sbSubList .ad-detail:not(:empty)'); chk(d31.includes('subscriptions.payments.view') && !d31.includes('RC-1') && !d31.includes('₦3,000'), '31 detail without payments permission: no receipts, no amounts');
  const a32 = await txt(page, '#sbAlerts'); chk(a32.includes('subscriptions.payments.view') && a32.includes('not a statement that nothing needs review') && !a32.includes('No subscription payment needs review.'), '32 cannot see payments: says so, never claims nothing needs review'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: FULL, clean: true, cardsNone: true })); await page.waitForSelector('#sbOverview .ad-stat');
  chk((await txt(page, '#sbAlerts')).includes('No subscription payment needs review.') && !(await txt(page, '#sbAlerts')).includes('Needs attention'), '33 clean state says so, no banner'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: FULL, noSubs: true })); await page.waitForSelector('#sbSubList .ad-state');
  chk((await txt(page, '#sbSubList')).toLowerCase().includes('no subscriptions yet'), '34 empty subscribers state'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: FULL, down: true })); await page.waitForSelector('#sbOverview .ad-state--error'); await page.waitForTimeout(200);
  const all = await txt(page, '#sbRoot');
  chk(all.includes('The server could not answer') && !/No subscription payment needs review|Nothing needs review|No subscriptions yet|No entries/.test(all), '35 server down: errors with Retry, never "nothing needs review" or "no subscriptions"'); await ctx.close();
  ({ page, ctx } = await open(browser, { perms: ['transactions.view'] })); await page.waitForTimeout(600);
  chk(await page.locator('#sbRoot').isHidden() && (await calls(page, 'admin_subscriptions_overview')).length === 0, '36 no subscriptions.view: page hidden, nothing requested'); await ctx.close();
  await browser.close(); srv.close();
  const bad = results.filter(r => !r[0]); results.forEach(r => console.log((r[0] ? 'PASS ' : 'FAIL ') + r[1])); console.log(bad.length ? bad.length + ' FAILED' : 'ALL ' + results.length + ' PASSED'); process.exit(bad.length ? 1 : 0);
})();
